/* engine.js — the timeline. The question the whole app exists to answer.
 * ---------------------------------------------------------------------------
 * "When can I actually afford this?"
 *
 * ⚠ THE OBVIOUS VERSION IS WRONG:
 *
 *     paychecks = ceil(cost / savings_per_paycheck)
 *
 * It is optimistic in four ways it never admits to:
 *   1. It ignores the QUEUE. Item 3 cannot start saving until 1 and 2 are paid for.
 *      Run per-item and every item gets item 1's date, which is nonsense.
 *   2. It ignores that outgoings land on DATES. An annual renewal is a lump, not
 *      1/12th of itself every month.
 *   3. It assumes a flat savings rate, but pay is fortnightly-or-27 and bills are
 *      monthly, and the two beat against each other.
 *   4. It divides money that is already committed to something else.
 *
 * So: simulate a running balance forward over real dates, event by event.
 */
(function () {
  'use strict';

  var HORIZON_DAYS = 1095;   // three years. Past that, a date is fiction anyway.

  /**
   * Merge pay-ins and bill-outs into one date-ordered event stream.
   * ONE implementation, shared by the projection and the upcoming-bills view —
   * two would drift, and then the dashboard and the list would disagree.
   */
  function eventStream(income, recurring, from, to) {
    var events = [];

    (income || []).forEach(function (src) {
      if (src.active === false) return;
      Dates.occurrences(src.anchorDate, src.cadence, from, to).forEach(function (d) {
        events.push({ date: d, amount: src.netPerPayCents, kind: 'pay', label: src.label, id: src.id });
      });
    });

    (recurring || []).forEach(function (cost) {
      if (cost.active === false) return;
      var end = (cost.endsOn && cost.endsOn < to) ? cost.endsOn : to;
      if (Dates.compare(end, from) < 0) return;
      Dates.occurrences(cost.anchorDate, cost.cadence, from, end).forEach(function (d) {
        events.push({
          date: d, amount: -amountOn(cost, d), kind: 'bill',
          label: cost.name, id: cost.id, essential: !!cost.essential,
        });
      });
    });

    events.sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      // Money in before money out on the same day — a bill that lands on payday is
      // paid by that payday, not by yesterday's balance.
      return (b.amount > 0 ? 1 : 0) - (a.amount > 0 ? 1 : 0);
    });
    return events;
  }

  /** The amount in force on a date, honouring price-rise history. */
  function amountOn(cost, iso) {
    var amount = cost.amountCents;
    (cost.history || [])
      .slice()
      .sort(function (a, b) { return Dates.compare(a.fromDate, b.fromDate); })
      .forEach(function (h) { if (Dates.compare(h.fromDate, iso) <= 0) amount = h.amountCents; });
    return amount;
  }

  /**
   * Walk the queue forward and give every pending item a projected date.
   *
   * @returns Map itemId -> {date, confidence, balanceAfter, beyondHorizon, blocked}
   */
  function projectQueue(opts) {
    var startBalance = opts.startBalanceCents || 0;
    var from = opts.from || Dates.today();
    var to = Dates.addDays(from, opts.horizonDays || HORIZON_DAYS);

    var results = new Map();
    var events = eventStream(opts.income, opts.recurring, from, to);

    // Only items that still cost money, in the user's chosen order.
    var pending = Order.sorted(opts.wishlist || []).filter(function (i) {
      return i.status !== 'bought' && i.status !== 'dropped' && i.status !== 'parked';
    });

    var bought = new Set(
      (opts.wishlist || []).filter(function (i) { return i.status === 'bought'; })
                           .map(function (i) { return i.id; })
    );

    var balance = startBalance;
    var queue = pending.slice();

    function depsMet(item) {
      return (item.dependsOn || []).every(function (id) {
        return bought.has(id) || results.has(id);
      });
    }

    // Anything affordable right now, before the first event.
    drain(from);

    for (var e = 0; e < events.length && queue.length; e++) {
      balance += events[e].amount;
      drain(events[e].date);
    }

    function drain(onDate) {
      // A `while`, not an `if`: one payday can clear several cheap items at once.
      // An `if` would silently stretch the timeline by one event per item.
      var moved = true;
      while (moved && queue.length) {
        moved = false;
        for (var i = 0; i < queue.length; i++) {
          var item = queue[i];
          if (!depsMet(item)) continue;         // blocked — skip, do not stop the queue
          var owed = item.priceCents - (item.allocatedCents || 0);
          if (balance < owed) break;            // the FRONT of the queue gates the rest
          balance -= owed;
          results.set(item.id, {
            date: onDate,
            confidence: Dates.confidence(onDate, from),
            balanceAfter: balance,
          });
          queue.splice(i, 1);
          moved = true;
          break;
        }
      }
    }

    queue.forEach(function (item) {
      results.set(item.id, {
        date: null,
        beyondHorizon: true,
        blocked: !depsMet(item),
        confidence: 'guess',
      });
    });

    return results;
  }

  /** Money in and out per month, and what is left. */
  function rates(income, recurring) {
    var inPerYear = (income || []).reduce(function (s, src) {
      return src.active === false ? s : s + Dates.annualise(src.netPerPayCents, src.cadence);
    }, 0);
    var outPerYear = (recurring || []).reduce(function (s, c) {
      return c.active === false ? s : s + Dates.annualise(c.amountCents, c.cadence);
    }, 0);
    var essentialPerYear = (recurring || []).reduce(function (s, c) {
      return (c.active === false || !c.essential) ? s : s + Dates.annualise(c.amountCents, c.cadence);
    }, 0);
    return {
      inMonthly: Math.round(inPerYear / 12),
      outMonthly: Math.round(outPerYear / 12),
      essentialMonthly: Math.round(essentialPerYear / 12),
      spareMonthly: Math.round((inPerYear - outPerYear) / 12),
      inAnnual: inPerYear,
      outAnnual: outPerYear,
    };
  }

  /** The next N days of bills, for the "what is about to leave" strip. */
  function upcoming(income, recurring, days) {
    var from = Dates.today();
    return eventStream(income, recurring, from, Dates.addDays(from, days || 30));
  }

  window.Engine = {
    projectQueue: projectQueue,
    eventStream: eventStream,
    amountOn: amountOn,
    rates: rates,
    upcoming: upcoming,
  };
})();
