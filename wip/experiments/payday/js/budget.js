/* budget.js — income and recurring costs.
 * ---------------------------------------------------------------------------
 * The two inputs the timeline needs. Without them every item is dateless.
 *
 * ⚠ INCOME IS ENTERED AS TAKE-HOME PAY, NOT GROSS. Tax handling comes later, so
 * the timeline has to work from the figure that actually lands in the account. A
 * tax module may OFFER to work this out from a gross salary; it must never require
 * one, or every timeline without tax details stops working.
 *
 * ⚠ NOTHING HERE MAY FAIL SILENTLY. Calling input.focus() and returning when a
 * field is wrong is, from the outside, a dead button — and a part-typed
 * <input type="date"> reads as '' and hits exactly that path. Every rejection says
 * what is wrong, and a missing date is filled in rather than treated as an error.
 */
(function () {
  'use strict';

  var el = {};
  var editing = null;   // { kind: 'income'|'cost', id }

  function uid(p) { return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  /* ── feedback ──────────────────────────────────────────────────────────── */

  var hintTimer = {};

  /** Say what is wrong, put the cursor on it, and mark the field. */
  function reject(hintEl, input, message) {
    if (input) {
      input.classList.add('invalid');
      input.setAttribute('aria-invalid', 'true');
      input.focus();
      if (input.select) input.select();
    }
    if (hintEl) {
      hintEl.textContent = message;
      hintEl.classList.remove('ok');
      clearTimeout(hintTimer[hintEl.id]);
      hintTimer[hintEl.id] = setTimeout(function () { clearHint(hintEl, input); }, 4000);
    }
    return false;
  }

  function clearHint(hintEl, input) {
    if (hintEl) { hintEl.textContent = ''; hintEl.classList.remove('ok'); }
    if (input) { input.classList.remove('invalid'); input.removeAttribute('aria-invalid'); }
  }

  /** Confirm that something landed. An add that works in silence looks broken too. */
  function confirmed(hintEl, message) {
    if (!hintEl) return;
    hintEl.textContent = message;
    hintEl.classList.add('ok');
    clearTimeout(hintTimer[hintEl.id]);
    hintTimer[hintEl.id] = setTimeout(function () { clearHint(hintEl); }, 3000);
  }

  /**
   * A date field that is empty, or half-typed, reports ''. That must never be a
   * hard stop — fall back to today, put it in the box so the user can see what was
   * assumed, and carry on.
   */
  function dateOr(input, fallback) {
    var v = (input.value || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
    input.value = fallback;
    return fallback;
  }

  /* ── adding ────────────────────────────────────────────────────────────── */

  function addIncome() {
    var label = el.incLabel.value.trim() || 'Pay';
    var cents = Money.parse(el.incAmount.value);
    if (cents == null) return reject(el.incHint, el.incAmount, 'How much lands in your account each time?');
    if (cents <= 0) return reject(el.incHint, el.incAmount, 'That needs to be more than zero.');

    var anchor = dateOr(el.incDate, Dates.today());

    updateData(function () {
      income.push({
        id: uid('in'), label: label, netPerPayCents: cents,
        cadence: el.incCadence.value, anchorDate: anchor,
        active: true, updatedAt: Date.now(),
      });
    });
    clearHint(el.incHint, el.incAmount);
    clearHint(null, el.incLabel);
    confirmed(el.incHint, 'Added ' + label + ' — ' + Money.format(cents) + ' '
      + cadenceLabel(el.incCadence.value).toLowerCase() + '.');
    el.incLabel.value = ''; el.incAmount.value = '';
    el.incLabel.focus();
    return true;
  }

  function addCost() {
    var name = el.costName.value.trim();
    if (!name) return reject(el.costHint, el.costName, 'Give it a name first.');
    var cents = Money.parse(el.costAmount.value);
    if (cents == null) return reject(el.costHint, el.costAmount, 'How much is ' + name + '?');
    if (cents <= 0) return reject(el.costHint, el.costAmount, 'That needs to be more than zero.');

    var anchor = dateOr(el.costDate, Dates.today());
    var whatIf = el.costWhatIf.checked;

    updateData(function () {
      recurring.push({
        id: uid('rc'), name: name, amountCents: cents,
        cadence: el.costCadence.value, anchorDate: anchor,
        categoryId: null, essential: el.costEssential.checked, workUsePct: 0,
        whatIf: whatIf,
        endsOn: null, history: [], active: true, updatedAt: Date.now(),
      });
    });
    clearHint(el.costHint, el.costAmount);
    clearHint(null, el.costName);
    confirmed(el.costHint, (whatIf ? 'Added ' + name + ' as a what-if — nothing comes out.'
                                  : 'Added ' + name + ' — ' + Money.format(cents) + ' '
                                    + cadenceLabel(el.costCadence.value).toLowerCase() + '.'));
    el.costName.value = ''; el.costAmount.value = '';
    el.costEssential.checked = false; el.costWhatIf.checked = false;
    el.costName.focus();
    return true;
  }

  /* ── editing ───────────────────────────────────────────────────────────── */

  /* Income and costs are the same shape wearing different labels, so one modal
   * covers both; the two flags are simply hidden for income. */

  function find(kind, id) {
    var list = kind === 'income' ? income : recurring;
    return list.find(function (x) { return x.id === id; }) || null;
  }

  var INCOME_CADENCES = ['weekly', 'fortnightly', 'four_weekly', 'monthly'];
  var COST_CADENCES = ['weekly', 'fortnightly', 'four_weekly', 'monthly', 'quarterly', 'annual'];

  function openEdit(kind, id) {
    var it = find(kind, id);
    if (!it) return;
    editing = { kind: kind, id: id };

    var isInc = kind === 'income';
    el.mmTitle.textContent = isInc ? 'Edit pay' : 'Edit what goes out';
    el.mmName.value = isInc ? it.label : it.name;
    el.mmAmount.value = Money.toInput(isInc ? it.netPerPayCents : it.amountCents);
    el.mmAmountLabel.textContent = isInc ? 'Take-home each time' : 'Amount';
    el.mmDateLabel.textContent = isInc ? 'A real pay date' : 'Next one due';
    el.mmDate.value = it.anchorDate || Dates.today();

    var opts = isInc ? INCOME_CADENCES : COST_CADENCES;
    el.mmCadence.innerHTML = opts.map(function (c) {
      return '<option value="' + c + '"' + (c === it.cadence ? ' selected' : '') + '>'
        + esc(cadenceLabel(c)) + '</option>';
    }).join('');

    el.mmFlags.hidden = isInc;
    el.mmEssential.checked = !isInc && !!it.essential;
    el.mmWhatIf.checked = !isInc && !!it.whatIf;

    clearHint(el.mmHint, el.mmAmount);
    el.mmName.classList.remove('invalid');
    el.moneyModal.style.display = 'flex';
    el.mmName.focus();
    el.mmName.select();
  }

  function closeEdit() {
    editing = null;
    el.moneyModal.style.display = 'none';
  }

  function saveEdit() {
    if (!editing) return;
    var isInc = editing.kind === 'income';
    var name = el.mmName.value.trim();
    if (!name) return reject(el.mmHint, el.mmName, 'It needs a name.');
    var cents = Money.parse(el.mmAmount.value);
    if (cents == null || cents <= 0) return reject(el.mmHint, el.mmAmount, 'That amount does not look right.');
    var anchor = dateOr(el.mmDate, Dates.today());

    var ref = editing;
    updateData(function () {
      var it = find(ref.kind, ref.id);
      if (!it) return;
      it.cadence = el.mmCadence.value;
      it.anchorDate = anchor;
      it.updatedAt = Date.now();
      if (isInc) {
        it.label = name;
        it.netPerPayCents = cents;
      } else {
        it.name = name;
        it.amountCents = cents;
        it.essential = el.mmEssential.checked;
        it.whatIf = el.mmWhatIf.checked;
      }
    });
    closeEdit();
    return true;
  }

  /* Removal is permanent and there is no undo, so it asks first — in-page, never a
   * native confirm(). */
  async function removeFrom(kind, id) {
    var it = find(kind, id);
    if (!it) return;
    var label = kind === 'income' ? it.label : it.name;
    var ok = await UI.confirm({
      title: 'Remove ' + label + '?',
      body: 'It stops counting towards your money straight away. This cannot be undone.',
      okLabel: 'Remove', danger: true,
    });
    if (!ok) return;
    updateData(function () {
      var list = kind === 'income' ? income : recurring;
      var idx = list.findIndex(function (x) { return x.id === id; });
      if (idx >= 0) list.splice(idx, 1);
    });
  }

  /* ── render ────────────────────────────────────────────────────────────── */

  function cadenceLabel(c) {
    return (Dates.CADENCES[c] || {}).label || c;
  }

  /** "Fortnightly · next 12 Sep" — the meta line, kept short enough not to crowd. */
  function meta(it) {
    if (!it.anchorDate) return cadenceLabel(it.cadence);
    var when = Dates.pretty(nextOccurrence(it));
    // pretty() returns relative words inside six weeks. "next today" is not English;
    // those cases want "due today", and "overdue" already reads as a full phrase.
    var phrase = when === 'overdue' ? 'overdue'
      : (when === 'today' || when === 'tomorrow') ? 'due ' + when
      : 'next ' + when;
    return cadenceLabel(it.cadence) + ' · ' + phrase;
  }

  /* The stored anchor may be months in the past. Showing "from 2026-08-30" made the
   * user work out the next date themselves; roll it forward instead. */
  function nextOccurrence(it) {
    var today = Dates.today();
    var hits = Dates.occurrences(it.anchorDate, it.cadence, today, Dates.addDays(today, 400));
    return hits.length ? hits[0] : it.anchorDate;
  }

  function row(kind, it, opts) {
    opts = opts || {};
    var name = kind === 'income' ? it.label : it.name;
    var cents = kind === 'income' ? it.netPerPayCents : it.amountCents;
    var d = document.createElement('div');
    d.className = 'money-row' + (opts.whatIf ? ' is-whatif' : '');
    d.dataset.kind = kind;
    d.dataset.id = it.id;
    d.innerHTML =
        '<button type="button" class="mr-open" data-edit aria-label="Edit ' + esc(name) + '">'
      +   '<span class="mr-name">' + esc(name)
      +     (opts.whatIf ? ' <span class="tag tag-maybe">what if</span>' : '')
      +     (it.essential ? ' <span class="tag">essential</span>' : '')
      +   '</span>'
      +   '<span class="mr-meta">' + esc(meta(it)) + '</span>'
      +   '<span class="mr-amt money ' + (kind === 'income' ? 'in' : 'out') + '">'
      +     Money.format(cents) + '</span>'
      + '</button>'
      + (opts.whatIf ? '<button type="button" class="ghost sm" data-adopt aria-label="Add ' + esc(name) + ' for real">Add for real</button>' : '')
      + '<button type="button" class="icon danger" data-del aria-label="Remove ' + esc(name) + '">✕</button>';
    return d;
  }

  function render() {
    if (!el.incList) return;

    el.incList.innerHTML = '';
    if (!income.length) {
      el.incList.innerHTML = '<p class="muted">No pay added yet.</p>';
    } else {
      income.forEach(function (src) { el.incList.appendChild(row('income', src)); });
    }

    var real = recurring.filter(function (c) { return !c.whatIf; });
    var maybes = recurring.filter(function (c) { return c.whatIf; });

    el.costList.innerHTML = '';
    if (!real.length) {
      el.costList.innerHTML = '<p class="muted">Nothing going out yet.</p>';
    } else {
      real.forEach(function (c) { el.costList.appendChild(row('cost', c)); });
    }

    renderWhatIf(maybes);

    var r = Engine.rates(income, real);
    el.rateIn.textContent = Money.format(r.inMonthly);
    el.rateOut.textContent = Money.format(r.outMonthly);
    el.rateSpare.textContent = Money.format(r.spareMonthly);
    el.rateSpare.classList.toggle('negative', r.spareMonthly < 0);

    // Don't fight the user's cursor: rewriting the box while it has focus moves the
    // caret to the end mid-type.
    if (document.activeElement !== el.startBalance) {
      el.startBalance.value = Money.toInput(settings.startBalanceCents || 0);
    }
  }

  /* What-if costs: added, but not taken out. The panel answers the actual question —
   * not "what does it cost" (you know that) but "how much later does it make
   * everything", which is the number that decides whether you sign up. */
  function renderWhatIf(maybes) {
    if (!el.whatIfPanel) return;
    el.whatIfPanel.hidden = maybes.length === 0;
    if (!maybes.length) return;

    el.whatIfList.innerHTML = '';
    maybes.forEach(function (c) { el.whatIfList.appendChild(row('cost', c, { whatIf: true })); });

    var real = recurring.filter(function (c) { return !c.whatIf; });
    var withAll = recurring;
    var before = Engine.rates(income, real);
    var after = Engine.rates(income, withAll);

    var goal = Order.sorted(wishlist).find(function (i) {
      return i.status !== 'bought' && i.status !== 'dropped' && i.status !== 'parked';
    });

    var line = 'Together they would cost <strong class="money out">'
      + Money.format(after.outMonthly - before.outMonthly) + '</strong> a month, leaving <strong class="money">'
      + Money.format(after.spareMonthly) + '</strong> spare instead of <strong class="money">'
      + Money.format(before.spareMonthly) + '</strong>.';

    if (goal && income.length) {
      var a = Engine.projectQueue({ wishlist: wishlist, income: income, recurring: real,
        startBalanceCents: settings.startBalanceCents || 0 }).get(goal.id);
      var b = Engine.projectQueue({ wishlist: wishlist, income: income, recurring: withAll,
        startBalanceCents: settings.startBalanceCents || 0 }).get(goal.id);
      if (a && b) {
        if (!b.date && a.date) {
          line += ' <strong>' + esc(goal.name) + '</strong> would go beyond three years.';
        } else if (a.date && b.date) {
          var days = Dates.diffDays(a.date, b.date);
          line += days > 0
            ? ' <strong>' + esc(goal.name) + '</strong> would slip from ' + Dates.pretty(a.date)
              + ' to <strong>' + Dates.pretty(b.date) + '</strong> — about '
              + (days >= 14 ? Math.round(days / 7) + ' weeks' : days + ' days') + ' later.'
            : ' <strong>' + esc(goal.name) + '</strong> would still land ' + Dates.pretty(a.date) + '.';
        }
      }
    }
    el.whatIfImpact.innerHTML = line;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ── wiring ────────────────────────────────────────────────────────────── */

  function listClicks(e) {
    var host = e.target.closest('.money-row');
    if (!host) return;
    var kind = host.dataset.kind, id = host.dataset.id;

    if (e.target.closest('[data-del]')) { removeFrom(kind, id); return; }
    if (e.target.closest('[data-adopt]')) {
      updateData(function () {
        var c = find('cost', id);
        if (c) { c.whatIf = false; c.updatedAt = Date.now(); }
      });
      return;
    }
    if (e.target.closest('[data-edit]')) openEdit(kind, id);
  }

  function init() {
    [
      'incLabel', 'incAmount', 'incCadence', 'incDate', 'incAdd', 'incList', 'incHint',
      'costName', 'costAmount', 'costCadence', 'costDate', 'costEssential', 'costWhatIf',
      'costAdd', 'costList', 'costHint', 'whatIfPanel', 'whatIfList', 'whatIfImpact',
      'rateIn', 'rateOut', 'rateSpare', 'startBalance',
      'moneyModal', 'mmTitle', 'mmName', 'mmAmount', 'mmAmountLabel', 'mmCadence',
      'mmDate', 'mmDateLabel', 'mmFlags', 'mmEssential', 'mmWhatIf', 'mmHint',
      'mmSave', 'mmCancel', 'mmDelete',
    ].forEach(function (k) { el[k] = document.getElementById(k); });
    if (!el.incAdd) return;

    // Sensible defaults so the fields are never empty-and-invalid.
    el.incDate.value = el.incDate.value || Dates.today();
    el.costDate.value = el.costDate.value || Dates.today();

    el.incAdd.addEventListener('click', addIncome);
    el.costAdd.addEventListener('click', addCost);

    [el.incLabel, el.incAmount, el.incDate].forEach(function (i) {
      i.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); addIncome(); } });
    });
    [el.costName, el.costAmount, el.costDate].forEach(function (i) {
      i.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); addCost(); } });
    });
    // Typing into a field that was just marked wrong clears the mark.
    [[el.incAmount, el.incHint], [el.incLabel, el.incHint],
     [el.costAmount, el.costHint], [el.costName, el.costHint],
     [el.mmName, el.mmHint], [el.mmAmount, el.mmHint]].forEach(function (pair) {
      pair[0].addEventListener('input', function () { clearHint(pair[1], pair[0]); });
    });

    el.incList.addEventListener('click', listClicks);
    el.costList.addEventListener('click', listClicks);
    if (el.whatIfList) el.whatIfList.addEventListener('click', listClicks);

    el.mmSave.addEventListener('click', saveEdit);
    el.mmCancel.addEventListener('click', closeEdit);
    el.mmDelete.addEventListener('click', function () {
      if (!editing) return;
      var ref = editing;
      closeEdit();
      removeFrom(ref.kind, ref.id);
    });
    el.mmName.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); saveEdit(); } });
    el.mmAmount.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); saveEdit(); } });
    el.moneyModal.addEventListener('click', function (e) { if (e.target === el.moneyModal) closeEdit(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && el.moneyModal.style.display === 'flex') closeEdit();
    });

    el.startBalance.addEventListener('change', function () {
      var c = Money.parse(el.startBalance.value);
      updateData(function () { settings.startBalanceCents = c == null ? 0 : c; });
    });

    render();
  }

  window.Budget = { render: render, init: init };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
