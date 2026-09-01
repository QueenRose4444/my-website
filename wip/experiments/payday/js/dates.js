/* dates.js — plain-date cadence arithmetic.
 * ---------------------------------------------------------------------------
 * ⚠ EVERYTHING HERE WORKS ON 'YYYY-MM-DD' STRINGS, NOT Date OBJECTS OR TIMESTAMPS.
 *
 * A pay date is a CALENDAR date, not an instant. Store "every fortnight from
 * 2026-07-03" as a UTC timestamp and add 14*86400*1000, and it drifts an hour at
 * each DST boundary; after enough boundaries it lands on the wrong day. The bug
 * appears months later and is very hard to see.
 *
 * ⚠ Rose is in Australia/Brisbane, which has NO daylight saving. This class of bug
 * will therefore NEVER show up in her own testing. It is prevented here by
 * construction, not by observation.
 *
 * Date objects are used only as a calendar, always via UTC accessors so no local
 * timezone can shift the day.
 */
(function () {
  'use strict';

  var MS_DAY = 86400000;

  function parse(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    if (!m) return null;
    return { y: +m[1], m: +m[2], d: +m[3] };
  }

  function fmt(p) {
    return p.y + '-' + String(p.m).padStart(2, '0') + '-' + String(p.d).padStart(2, '0');
  }

  function toUTC(iso) {
    var p = parse(iso);
    return p ? Date.UTC(p.y, p.m - 1, p.d) : NaN;
  }

  function fromUTC(ms) {
    var d = new Date(ms);
    return fmt({ y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() });
  }

  function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }

  var Dates = {
    parse: parse,
    format: fmt,

    /** Today, in the user's civil time — not UTC's today. */
    today: function () {
      var n = new Date();
      return fmt({ y: n.getFullYear(), m: n.getMonth() + 1, d: n.getDate() });
    },

    addDays: function (iso, n) { return fromUTC(toUTC(iso) + n * MS_DAY); },

    diffDays: function (a, b) { return Math.round((toUTC(b) - toUTC(a)) / MS_DAY); },

    compare: function (a, b) { return a < b ? -1 : a > b ? 1 : 0; },

    /**
     * Add whole months, CLAMPING the day to the target month's length.
     *
     * ⚠ Clamp, never roll. The 31st in a 30-day month becomes the 30th, NOT the 1st
     * of the following month. Rolling forward drifts the whole series permanently:
     * Jan 31 -> Mar 3 -> Apr 3 -> ... and the cadence has quietly changed.
     * The day is always taken from the ORIGINAL anchor, so 31 Jan -> 28 Feb -> 31 Mar
     * rather than getting stuck at 28.
     */
    addMonths: function (iso, n, anchorDay) {
      var p = parse(iso);
      if (!p) return null;
      var day = anchorDay || p.d;
      var total = (p.y * 12 + (p.m - 1)) + n;
      var y = Math.floor(total / 12);
      var m = (total % 12) + 1;
      return fmt({ y: y, m: m, d: Math.min(day, daysInMonth(y, m)) });
    },

    /** Cadences, with the number of occurrences in an average year. */
    CADENCES: {
      weekly:      { label: 'Weekly',       perYear: 365.25 / 7 },
      fortnightly: { label: 'Fortnightly',  perYear: 365.25 / 14 },
      four_weekly: { label: 'Every 4 weeks', perYear: 365.25 / 28 },
      monthly:     { label: 'Monthly',      perYear: 12 },
      quarterly:   { label: 'Quarterly',    perYear: 4 },
      annual:      { label: 'Yearly',       perYear: 1 },
    },

    /**
     * Every occurrence of a cadence in [from, to], generated from a real anchor.
     *
     * ⚠ NEVER derive a schedule by dividing a year. `annual / 26` is not a
     * fortnightly pay: a year holds 26.089 fortnights, so roughly every eleventh
     * year has 27 pay dates. Dividing by 26 and multiplying back overstates income.
     * The same applies to `annual / 12` for monthly — it does not line up with real
     * dates. Generate the dates; count them; divide by what you counted.
     *
     * ⚠ 'four_weekly' is 13 payments a year, NOT 12. Treating it as monthly
     * understates the annual cost by about 8%. It is a real billing cadence.
     */
    occurrences: function (anchor, cadence, from, to) {
      var out = [];
      if (!parse(anchor) || !parse(from) || !parse(to)) return out;
      var spec = Dates.CADENCES[cadence];
      if (!spec) return out;

      var anchorDay = parse(anchor).d;
      var step = { weekly: 7, fortnightly: 14, four_weekly: 28 }[cadence];
      var cur = anchor;

      if (step) {
        // Jump most of the way in whole steps rather than iterating from the anchor,
        // which may be years back.
        var gap = Dates.diffDays(anchor, from);
        if (gap > 0) cur = Dates.addDays(anchor, Math.floor(gap / step) * step);
        while (Dates.compare(cur, from) < 0) cur = Dates.addDays(cur, step);
        while (Dates.compare(cur, to) <= 0) { out.push(cur); cur = Dates.addDays(cur, step); }
        return out;
      }

      var months = { monthly: 1, quarterly: 3, annual: 12 }[cadence];
      var n = 0;
      // Walk back to at most one period before `from`, then forward.
      var guard = 0;
      cur = anchor;
      while (Dates.compare(cur, from) < 0 && guard++ < 4000) {
        n += 1; cur = Dates.addMonths(anchor, n * months, anchorDay);
      }
      guard = 0;
      while (Dates.compare(cur, to) <= 0 && guard++ < 4000) {
        if (Dates.compare(cur, from) >= 0) out.push(cur);
        n += 1; cur = Dates.addMonths(anchor, n * months, anchorDay);
      }
      return out;
    },

    /**
     * Per-period amount from an annual figure — by COUNTING real dates in the
     * financial year, not by dividing by a nominal period count. This is what makes
     * a 27-fortnight year come out right.
     */
    perPeriodFromAnnual: function (annualCents, anchor, cadence, fyStart, fyEnd) {
      var dates = Dates.occurrences(anchor, cadence, fyStart, fyEnd);
      if (!dates.length) return 0;
      return Math.round(annualCents / dates.length);
    },

    /** Annualise a per-period amount, using the true average periods per year. */
    annualise: function (amountCents, cadence) {
      var spec = Dates.CADENCES[cadence];
      return spec ? Math.round(amountCents * spec.perYear) : 0;
    },

    /** Human-friendly, and honest about precision — see confidence bands. */
    pretty: function (iso, todayIso) {
      var p = parse(iso);
      if (!p) return '—';
      var days = Dates.diffDays(todayIso || Dates.today(), iso);
      var MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      if (days < 0) return 'overdue';
      if (days === 0) return 'today';
      if (days === 1) return 'tomorrow';
      // Beyond about six weeks a day-precise date is false precision; beyond six
      // months even a month is optimistic. See 06-wishlist.md §7.
      if (days <= 42) return p.d + ' ' + MONTHS[p.m - 1];
      if (days <= 182) return MONTHS[p.m - 1] + ' ' + p.y;
      if (days <= 550) return 'Q' + Math.ceil(p.m / 3) + ' ' + p.y;
      return p.y + '+';
    },

    /** How much to trust a projected date, by distance. */
    confidence: function (iso, todayIso) {
      var days = Dates.diffDays(todayIso || Dates.today(), iso);
      if (days <= 42) return 'high';
      if (days <= 182) return 'medium';
      if (days <= 550) return 'low';
      return 'guess';
    },
  };

  window.Dates = Dates;
})();
