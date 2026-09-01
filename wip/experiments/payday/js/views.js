/* views.js — view switching, the overview, and the two adjustment flows.
 * ---------------------------------------------------------------------------
 * payday is three views, not one long page:
 *   Overview — am I on track, and what's next
 *   Items    — the list
 *   Money    — what comes in and what goes out
 *
 * The overview's job is ONE question, answered before you read anything: how
 * close am I to the next thing I want. That is the ring, and it is the only
 * bold element on the page — everything else is deliberately quiet.
 */
(function () {
  'use strict';

  var el = {};
  var RING_R = 86;
  var CIRC = 2 * Math.PI * RING_R;
  var adjustMode = 'spend';

  /* ── views ─────────────────────────────────────────────────────────────── */

  function show(name) {
    ['overview', 'items', 'money', 'spending'].forEach(function (v) {
      var section = document.getElementById('view-' + v);
      var tab = document.querySelector('.view-tab[data-view="' + v + '"]');
      var on = v === name;
      if (section) { section.hidden = !on; section.classList.toggle('is-active', on); }
      if (tab) { tab.classList.toggle('is-active', on); tab.setAttribute('aria-selected', String(on)); }
    });
    updateData(function () { settings.lastView = name; });
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  /* ── the goal ring ─────────────────────────────────────────────────────── */

  /* The next thing in the queue that still costs money. Parked and bought items
   * are skipped — the point is what you are actually saving for right now. */
  function nextGoal() {
    return Order.sorted(wishlist).find(function (i) {
      return i.status !== 'bought' && i.status !== 'dropped' && i.status !== 'parked';
    }) || null;
  }

  function renderGoal() {
    var goal = nextGoal();
    if (!goal) {
      el.goalName.textContent = wishlist.length ? 'Nothing left to buy' : 'Nothing on the list yet';
      el.goalPct.textContent = '—';
      el.goalOf.textContent = '';
      el.goalSaved.textContent = Money.format(0);
      el.goalLeft.textContent = Money.format(0);
      el.goalWhen.textContent = wishlist.length ? '' : 'Add something on the Items tab.';
      el.ringFill.style.strokeDasharray = '0 ' + CIRC;
      el.ringFill.style.strokeLinecap = 'butt';
      el.goalCard.classList.add('is-empty');
      return;
    }
    el.goalCard.classList.remove('is-empty');

    // Money set aside for this item, plus whatever is unallocated in the account.
    var allocated = goal.allocatedCents || 0;
    var pot = allocated + Math.max(0, settings.startBalanceCents || 0);
    var saved = Math.min(pot, goal.priceCents);
    var pct = goal.priceCents > 0 ? Math.min(1, saved / goal.priceCents) : 0;

    el.goalName.textContent = goal.name;
    el.goalPct.textContent = Math.round(pct * 100) + '%';
    el.goalOf.textContent = 'of ' + Money.format(goal.priceCents, { noCents: true });
    el.goalSaved.textContent = Money.format(saved);
    el.goalLeft.textContent = Money.format(Math.max(0, goal.priceCents - saved));

    el.ringFill.style.strokeDasharray = (CIRC * pct) + ' ' + CIRC;
    // stroke-linecap:round renders a dot at zero length. Nothing saved must draw
    // nothing, not a stray blob at the top of the ring.
    el.ringFill.style.strokeLinecap = pct > 0.002 ? 'round' : 'butt';

    var p = window.PaydayProjection && window.PaydayProjection.get(goal.id);
    if (!income.length) {
      el.goalWhen.innerHTML = '<span class="when when-none">Add your pay to see when →</span>';
    } else if (p && p.date) {
      el.goalWhen.innerHTML = 'You can buy it around <strong>' + Dates.pretty(p.date) + '</strong>'
        + (Dates.confidence(p.date) === 'high' ? '' : ' <span class="hedge">(estimate)</span>');
    } else {
      el.goalWhen.innerHTML = '<span class="hedge">More than three years away at this rate.</span>';
    }
  }

  /* ── the month split ───────────────────────────────────────────────────── */

  /* A donut, because the job is part-to-whole of ONE month's income. Not a line
   * (no time axis), not bars (three slices of one total reads better as a whole).
   * Three slices only — more and it becomes a pie chart nobody can read. */
  function renderSplit() {
    var r = Engine.rates(income, recurring.filter(function (c) { return !c.whatIf; }));
    var slices = [
      { key: 'essential', label: 'Essentials', value: r.essentialMonthly },
      { key: 'other', label: 'Everything else', value: Math.max(0, r.outMonthly - r.essentialMonthly) },
      { key: 'spare', label: 'Spare', value: Math.max(0, r.spareMonthly) },
    ].filter(function (s) { return s.value > 0; });

    var total = slices.reduce(function (a, s) { return a + s.value; }, 0);
    el.splitSegments.innerHTML = '';
    el.splitKey.innerHTML = '';

    if (!total) {
      el.splitKey.innerHTML = '<li class="muted">Add your pay and what goes out.</li>';
      return;
    }

    var C = 2 * Math.PI * 45;
    var offset = 0;
    slices.forEach(function (s) {
      var frac = s.value / total;
      var c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      c.setAttribute('cx', '60'); c.setAttribute('cy', '60'); c.setAttribute('r', '45');
      c.setAttribute('class', 'seg seg-' + s.key);
      // 2px of surface between segments, so adjacent slices never touch.
      c.setAttribute('stroke-dasharray', Math.max(0, C * frac - 2) + ' ' + C);
      c.setAttribute('stroke-dashoffset', -offset);
      el.splitSegments.appendChild(c);
      offset += C * frac;

      var li = document.createElement('li');
      li.innerHTML = '<span class="key-dot key-' + s.key + '"></span>'
        + '<span class="key-label">' + s.label + '</span>'
        + '<span class="key-val money">' + Money.format(s.value) + '</span>';
      el.splitKey.appendChild(li);
    });

    if (r.spareMonthly < 0) {
      var li = document.createElement('li');
      li.className = 'key-over';
      li.textContent = 'You are ' + Money.format(-r.spareMonthly) + ' over each month.';
      el.splitKey.appendChild(li);
    }
  }

  function renderUpcoming() {
    var next = Engine.upcoming(income, recurring.filter(function (c) { return !c.whatIf; }), 30)
      .filter(function (e) { return e.kind === 'bill'; });
    el.upcoming.innerHTML = next.length
      ? next.slice(0, 6).map(function (e) {
          return '<li><span class="up-when">' + Dates.pretty(e.date) + '</span>'
               + '<span class="up-what">' + esc(e.label) + '</span>'
               + '<span class="money out">' + Money.format(-e.amount) + '</span></li>';
        }).join('')
      : '<li class="muted">Nothing due in the next 30 days.</li>';
  }

  function renderQueue() {
    var items = Order.sorted(wishlist).filter(function (i) {
      return i.status !== 'bought' && i.status !== 'dropped';
    }).slice(0, 5);

    el.queuePreview.innerHTML = items.length
      ? items.map(function (i) {
          var p = window.PaydayProjection && window.PaydayProjection.get(i.id);
          var when = !income.length ? '' : (p && p.date ? Dates.pretty(p.date) : '3 yrs+');
          return '<li><span class="q-name">' + esc(i.name) + '</span>'
               + '<span class="money q-price">' + Money.format(i.priceCents, { noCents: true }) + '</span>'
               + '<span class="q-when">' + when + '</span></li>';
        }).join('')
      : '<li class="muted">Nothing queued.</li>';
  }

  /* ── adjustments ───────────────────────────────────────────────────────── */

  /* "nvm i spent this much" — an unplanned spend comes straight off the balance,
   * which pushes every projected date back. That honesty is the point: the plan
   * should react to real life rather than quietly pretend the money is still there. */
  function openAdjust(mode) {
    adjustMode = mode;
    var goal = nextGoal();
    el.adjustTitle.textContent = mode === 'spend' ? 'I spent some of it' : 'Put money aside';
    el.adjustNote.textContent = mode === 'spend'
      ? 'Comes off what you have in the account. Every date shifts to match.'
      : (goal ? 'Sets this money aside for "' + goal.name + '" so it is not counted as spare.'
              : 'Add an item first — there is nothing to put money aside for.');
    el.adjustAmount.value = '';
    el.adjustWhy.value = '';
    el.adjustModal.style.display = 'flex';
    el.adjustAmount.focus();
  }

  function saveAdjust() {
    var cents = Money.parse(el.adjustAmount.value);
    if (cents == null || cents <= 0) { el.adjustAmount.focus(); return; }
    var goal = nextGoal();

    updateData(function () {
      if (adjustMode === 'spend') {
        settings.startBalanceCents = Math.max(0, (settings.startBalanceCents || 0) - cents);
      } else if (goal) {
        // Moving money from "in the account" into "spoken for" — the total does not
        // change, but it stops looking available.
        var take = Math.min(cents, settings.startBalanceCents || 0);
        settings.startBalanceCents = (settings.startBalanceCents || 0) - take;
        var it = wishlist.find(function (i) { return i.id === goal.id; });
        if (it) { it.allocatedCents = (it.allocatedCents || 0) + cents; it.updatedAt = Date.now(); }
      }
    });
    el.adjustModal.style.display = 'none';
  }

  /* ── appearance ────────────────────────────────────────────────────────── */

  function renderSwatches() {
    var current = RoseTheme.getAccent();
    el.accentSwatches.innerHTML = Object.keys(RoseTheme.PRESETS).map(function (name) {
      var mode = RoseTheme.effective();
      return '<button type="button" class="swatch' + (current === name ? ' is-on' : '') + '"'
        + ' data-accent="' + name + '" title="' + name + '" aria-label="' + name + '"'
        + ' style="--sw:' + RoseTheme.PRESETS[name][mode] + '"></button>';
    }).join('');

    ['system', 'light', 'dark'].forEach(function (t) {
      var b = el.themeSeg.querySelector('[data-theme="' + t + '"]');
      if (b) b.classList.toggle('is-on', RoseTheme.get() === t);
    });
  }

  /* The custom accent. The user's HUE is kept; only the lightness moves, and only
   * as far as it must to stay readable. Showing the adjusted swatch beside their
   * pick makes the change visible instead of mysterious. */
  function applyCustom(hex) {
    if (!window.ColorUtils) return;
    var C = window.ColorUtils;
    var mode = RoseTheme.effective();
    var cs = getComputedStyle(document.documentElement);
    var ground = cs.getPropertyValue('--ground').trim();
    var surface = cs.getPropertyValue('--surface').trim();
    var other = mode === 'dark' ? '#FAF7FB' : '#15121B';
    var otherSurface = mode === 'dark' ? '#FFFFFF' : '#1E1926';

    /* Two derivations per theme, because the accent does two jobs (see tokens.css):
     *   fill  at 3.0:1 against the ground   — the floor for a meaningful graphic
     *   text  at 4.5:1 against an --accent-soft pill over the panel, which is the
     *         palest thing accent text lands on and so the hardest target
     * Deriving text from the FILL rather than from the raw pick keeps the hue the
     * user chose while guaranteeing the pair belong together. */
    function pair(pick, gnd, surf) {
      var fill = C.deriveAccent(pick, gnd, { minRatio: 3.0, preferRatio: 3.0, minInkRatio: 4.5 });
      if (!fill) return null;
      var pill = C.toHex(C.composite(C.parseHex(fill.hex), C.parseHex(surf), 0.14));
      var text = C.deriveAccent(fill.hex, pill, { minRatio: 4.5, preferRatio: 4.5 });
      return { fill: fill.hex, ink: fill.ink, text: (text && text.hex) || fill.hex, ratio: fill.ratio, adjusted: fill.adjusted };
    }

    var here = pair(hex, ground, surface);
    if (!here) return;
    var there = pair(hex, other, otherSurface) || here;
    var flip = mode === 'dark' ? 'light' : 'dark';

    var payload = {};
    payload[mode] = here.fill; payload[mode + 'Ink'] = here.ink; payload[mode + 'Text'] = here.text;
    payload[flip] = there.fill; payload[flip + 'Ink'] = there.ink; payload[flip + 'Text'] = there.text;
    RoseTheme.setAccent(payload);
    var d = here;
    d.hex = here.fill;

    el.derivedSwatch.style.background = d.hex;
    el.derivedNote.textContent = d.adjusted
      ? 'Adjusted to ' + d.hex + ' so text on it stays readable (' + d.ratio.toFixed(1) + ':1).'
      : 'Used as-is (' + d.ratio.toFixed(1) + ':1).';
    renderSwatches();
  }

  /* ── render ────────────────────────────────────────────────────────────── */

  function render() {
    if (!el.goalCard) return;
    renderGoal();
    renderSplit();
    renderUpcoming();
    renderQueue();
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function init() {
    [
      'goalCard', 'goalName', 'goalPct', 'goalOf', 'goalSaved', 'goalLeft', 'goalWhen',
      'ringFill', 'goalSpend', 'goalTopUp', 'splitSegments', 'splitKey', 'upcoming',
      'queuePreview', 'menuButton', 'appMenu', 'themeButton', 'themeModal', 'themeSeg',
      'accentSwatches', 'customAccent', 'derivedSwatch', 'derivedNote', 'themeClose',
      'adjustModal', 'adjustTitle', 'adjustNote', 'adjustAmount', 'adjustWhy',
      'adjustSave', 'adjustCancel',
    ].forEach(function (k) { el[k] = document.getElementById(k); });
    if (!el.goalCard) return;

    el.ringFill.style.strokeDashoffset = '0';

    document.querySelectorAll('.view-tab').forEach(function (tab) {
      tab.addEventListener('click', function () { show(tab.dataset.view); });
    });
    document.querySelectorAll('[data-goto]').forEach(function (b) {
      b.addEventListener('click', function () { show(b.dataset.goto); });
    });

    el.menuButton.addEventListener('click', function () {
      var open = el.appMenu.hasAttribute('hidden');
      if (open) el.appMenu.removeAttribute('hidden'); else el.appMenu.setAttribute('hidden', '');
      el.menuButton.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', function (e) {
      if (!el.appMenu.hasAttribute('hidden')
          && !el.appMenu.contains(e.target) && e.target !== el.menuButton) {
        el.appMenu.setAttribute('hidden', '');
        el.menuButton.setAttribute('aria-expanded', 'false');
      }
    });

    el.goalSpend.addEventListener('click', function () { openAdjust('spend'); });
    el.goalTopUp.addEventListener('click', function () { openAdjust('aside'); });
    el.adjustSave.addEventListener('click', saveAdjust);
    el.adjustCancel.addEventListener('click', function () { el.adjustModal.style.display = 'none'; });
    el.adjustAmount.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); saveAdjust(); }
    });

    el.themeButton.addEventListener('click', function () {
      el.appMenu.setAttribute('hidden', '');
      renderSwatches();
      el.themeModal.style.display = 'flex';
    });
    el.themeClose.addEventListener('click', function () { el.themeModal.style.display = 'none'; });
    el.themeSeg.addEventListener('click', function (e) {
      var b = e.target.closest('[data-theme]');
      if (!b) return;
      RoseTheme.set(b.dataset.theme);
      renderSwatches();
      render();
    });
    el.accentSwatches.addEventListener('click', function (e) {
      var b = e.target.closest('[data-accent]');
      if (!b) return;
      RoseTheme.setAccent(b.dataset.accent);
      el.derivedNote.textContent = '';
      el.derivedSwatch.style.background = 'transparent';
      renderSwatches();
    });
    el.customAccent.addEventListener('input', function () { applyCustom(el.customAccent.value); });

    [el.themeModal, el.adjustModal].forEach(function (m) {
      m.addEventListener('click', function (e) { if (e.target === m) m.style.display = 'none'; });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      el.themeModal.style.display = 'none';
      el.adjustModal.style.display = 'none';
    });

    show(settings.lastView || 'overview');
    render();
  }

  window.Views = { render: render, show: show };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
