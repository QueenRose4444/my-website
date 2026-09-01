/* spending.js — the import flow and the Spending view.
 * ---------------------------------------------------------------------------
 * statements.js does the reading and the sanitising and knows nothing about the
 * page. This file is the other half: pick a file, show the user what payday is
 * about to keep, and only then write it.
 *
 * ⚠ THE PREVIEW IS THE CONSENT STEP (plans/07-import.md §7.3). It shows the
 * SANITISED rows next to what was removed, before a single row is stored. That is
 * both the safety check and the moment a sanitiser mistake becomes visible — so
 * never "streamline" it into an automatic import.
 *
 * ⚠ EVERY IMPORT IS A BATCH, AND A BATCH IS UNDOABLE IN ONE ACTION. That is the
 * real safety net behind the deduplication guesswork below.
 */
(function () {
  'use strict';

  var el = {};
  var pending = null;   // the parsed-but-not-yet-saved import

  function uid(p) { return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* The dedupe salt is per user and lives in synced settings, so the same
   * transaction hashes identically on the phone and the PC. Generated once. */
  function dedupeSalt() {
    if (!settings.dedupeSalt) {
      var a = new Uint8Array(16);
      if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(a);
      else for (var i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256);
      var salt = Array.prototype.map.call(a, function (b) { return b.toString(16).padStart(2, '0'); }).join('');
      updateData(function () { settings.dedupeSalt = salt; });
    }
    return settings.dedupeSalt;
  }

  /* ── reading a file ──────────────────────────────────────────────────────
   * ⚠ FileReader only. No fetch, no upload, no worker that could be pointed
   * anywhere else. The file is read into a string in this tab and nowhere else. */

  async function handleFile(file) {
    if (!file) return;
    var text;
    try {
      text = await file.text();
    } catch (e) {
      await UI.confirm({ title: 'Could not read that file', body: String(e && e.message || e), okLabel: 'OK', cancelLabel: '' });
      return;
    }
    if (!text.trim()) {
      await UI.confirm({ title: 'That file is empty', body: 'Nothing to import.', okLabel: 'OK', cancelLabel: '' });
      return;
    }

    var format = Statements.detect(text);
    pending = { file: file.name, format: format, text: text, csv: null, map: null, rows: [], warnings: [] };

    if (format === 'ofx') {
      var o = Statements.parseOFX(text);
      pending.rows = o.rows; pending.warnings = o.warnings;
      // OFX carries YYYYMMDD, so there is nothing to ask. Say so explicitly —
      // leaving the mapping null reads as "order not yet decided" downstream and
      // left the Import button disabled on the one format that is unambiguous.
      pending.map = { dateOrder: 'ymd' };
    } else if (format === 'qif') {
      var q = Statements.parseQIF(text);
      pending.warnings = q.warnings;
      // QIF dates come back unordered (a/b/y) for exactly the same reason CSV ones
      // do — 03/09 is either the 3rd of September or the 9th of March.
      var order = Statements.detectDateOrder(q.rows.map(function (r) { return [r.date]; }), 0);
      pending.qifRaw = q.rows;
      pending.map = { dateOrder: order };
      pending.rows = resolveQIF(q.rows, order);
    } else {
      pending.csv = Statements.parseCSV(text);
      pending.map = Statements.guessMapping(pending.csv.rows);
      pending.rows = Statements.buildFromCSV(pending.csv, pending.map).rows;
    }

    await openPreview();
  }

  function resolveQIF(rows, order) {
    if (!order) return [];
    return rows.map(function (r) {
      return { date: Statements.resolveDate(r.date, order), amountCents: r.amountCents, raw: r.raw, fitid: null };
    }).filter(function (r) { return r.date; });
  }

  /* ── preview ─────────────────────────────────────────────────────────────── */

  async function openPreview() {
    buildMappingControls();
    await refreshPreview();
    el.importModal.style.display = 'flex';
    el.impCancel.focus();
  }

  function colOptions(selected, allowNone) {
    if (!pending.csv) return '';
    var header = pending.map.hasHeader ? pending.csv.rows[0] : null;
    var cols = Math.max.apply(null, pending.csv.rows.map(function (r) { return r.length; }));
    var out = allowNone ? '<option value="-1"' + (selected < 0 ? ' selected' : '') + '>(none)</option>' : '';
    for (var i = 0; i < cols; i++) {
      var label = header && header[i] ? header[i] : 'Column ' + (i + 1);
      out += '<option value="' + i + '"' + (i === selected ? ' selected' : '') + '>' + esc(label) + '</option>';
    }
    return out;
  }

  function buildMappingControls() {
    var isCsv = !!pending.csv;
    el.impMapping.hidden = !isCsv && pending.format !== 'qif';

    if (isCsv) {
      el.mapDate.innerHTML = colOptions(pending.map.date, false);
      el.mapAmount.innerHTML = colOptions(pending.map.amount, false);
      el.mapDesc.innerHTML = colOptions(pending.map.desc, true);
      [el.mapDate, el.mapAmount, el.mapDesc].forEach(function (s) { s.closest('.field').hidden = false; });
      // A two-column debit/credit file has no single amount column to choose.
      el.mapAmount.closest('.field').hidden = pending.map.debit >= 0 || pending.map.credit >= 0;
    } else {
      [el.mapDate, el.mapAmount, el.mapDesc].forEach(function (s) { s.closest('.field').hidden = true; });
    }

    /* ⚠ T-74. When the sample never contains a day above 12, DD/MM and MM/DD are
     * indistinguishable and payday must ASK. Guessing American on an Australian
     * statement silently mangles the first twelve days of every month, and nothing
     * on screen would ever show it. So: no default selected, and Import stays
     * disabled until a choice is made. */
    var order = pending.map ? pending.map.dateOrder : null;
    var fixed = order === 'ymd' || order === 'named';
    el.mapOrder.closest('.field').hidden = fixed;
    if (!fixed) {
      el.mapOrder.innerHTML =
          '<option value=""' + (order ? '' : ' selected') + ' disabled>Which is it?</option>'
        + '<option value="dmy"' + (order === 'dmy' ? ' selected' : '') + '>Day first — 03/09 is 3 September</option>'
        + '<option value="mdy"' + (order === 'mdy' ? ' selected' : '') + '>Month first — 03/09 is 9 March</option>';
    }
  }

  function readMapping() {
    if (pending.csv) {
      pending.map.date = +el.mapDate.value;
      if (!el.mapAmount.closest('.field').hidden) pending.map.amount = +el.mapAmount.value;
      pending.map.desc = +el.mapDesc.value;
    }
    if (!el.mapOrder.closest('.field').hidden) {
      pending.map.dateOrder = el.mapOrder.value || null;
    }
  }

  async function refreshPreview() {
    // Re-read the rows under the current mapping.
    if (pending.csv) {
      var built = Statements.buildFromCSV(pending.csv, pending.map);
      pending.rows = pending.map.dateOrder ? built.rows : [];
      pending.warnings = built.warnings;
    } else if (pending.format === 'qif') {
      pending.rows = resolveQIF(pending.qifRaw || [], pending.map.dateOrder);
    }

    var needsOrder = !pending.map || !pending.map.dateOrder;
    var salt = dedupeSalt();
    var seen = new Set(transactions.map(function (t) { return t.dedupe; }));

    // Sanitise and key every row. This is where the raw text stops existing.
    var prepared = [];
    for (var i = 0; i < pending.rows.length; i++) {
      var r = pending.rows[i];
      var s = Statements.sanitise(r.raw, r.amountCents);
      var key = await Statements.dedupeKey(salt, r);
      prepared.push({
        date: r.date, amountCents: r.amountCents, merchant: s.merchant,
        confidence: s.confidence, dropped: s.dropped, dedupe: key,
        duplicate: seen.has(key), raw: r.raw,
      });
    }
    pending.prepared = prepared;

    var dupes = prepared.filter(function (p) { return p.duplicate; }).length;
    var unknown = prepared.filter(function (p) { return p.confidence === 'unrecognised'; }).length;
    var dates = prepared.map(function (p) { return p.date; }).sort();
    pending.range = dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null;

    el.impTitle.textContent = 'Check this before it is saved';
    el.impSummary.textContent = needsOrder
      ? 'First, say which way round the dates are written.'
      : pending.file + ' · ' + pending.format.toUpperCase() + ' · ' + prepared.length
        + ' transaction' + (prepared.length === 1 ? '' : 's')
        + (pending.range ? ', ' + pending.range.from + ' to ' + pending.range.to : '');

    var warn = [];
    if (needsOrder) warn.push('Every date in this file could be read two ways. Pick one — payday will not guess.');
    (pending.warnings || []).forEach(function (w) { warn.push(w); });
    if (dupes) warn.push(dupes + ' row' + (dupes === 1 ? ' looks like one' : 's look like ones') + ' you have already imported. They are ticked below and will be brought in anyway — check them, and delete any that really are repeats.');
    if (unknown) warn.push(unknown + ' merchant name' + (unknown === 1 ? '' : 's') + ' could not be cleaned up confidently. They are marked so you can rename them.');
    el.impWarn.innerHTML = warn.map(esc).join('<br>');
    el.impWarn.classList.toggle('ok', !warn.length);

    // ⚠ The preview shows the SANITISED value in "Kept as" and the removed detail in
    // "Dropped". The raw text is visible here only because nothing has been stored
    // yet and it never leaves the tab — that is the point of showing it.
    var show = prepared.slice(0, 20);
    el.impPreview.querySelector('tbody').innerHTML = show.map(function (p) {
      return '<tr' + (p.duplicate ? ' class="is-dupe"' : '') + '>'
        + '<td>' + esc(p.date) + '</td>'
        + '<td><span class="pv-merchant">' + esc(p.merchant) + '</span>'
        + (p.confidence === 'unrecognised' ? ' <span class="tag tag-maybe">check</span>' : '')
        + (p.duplicate ? ' <span class="tag">seen before</span>' : '')
        + '<span class="pv-raw">' + esc(p.raw) + '</span></td>'
        + '<td class="num money ' + (p.amountCents < 0 ? 'out' : 'in') + '">' + Money.format(p.amountCents) + '</td>'
        + '<td class="pv-dropped">' + (p.dropped.length ? esc(p.dropped.join(', ')) : '—') + '</td>'
        + '</tr>';
    }).join('') || '<tr><td colspan="4" class="muted">Nothing to show yet.</td></tr>';

    el.impMore.textContent = prepared.length > 20
      ? 'Showing the first 20 of ' + prepared.length + '. The rest are handled the same way.' : '';

    el.impConfirm.disabled = needsOrder || !prepared.length;
    el.impConfirm.textContent = prepared.length
      ? 'Import ' + prepared.length + ' transaction' + (prepared.length === 1 ? '' : 's')
      : 'Import';
  }

  /* ── committing ──────────────────────────────────────────────────────────── */

  function commit() {
    if (!pending || !pending.prepared || !pending.prepared.length) return;
    var batchId = uid('b');
    var now = Date.now();
    var rows = pending.prepared;

    updateData(function () {
      batches.push({
        id: batchId, at: now, source: pending.file, format: pending.format,
        count: rows.length,
        from: pending.range ? pending.range.from : null,
        to: pending.range ? pending.range.to : null,
      });
      rows.forEach(function (p) {
        // ⚠ p.raw is deliberately NOT carried across. Once this runs, the original
        // description is gone for good (§7.4) — re-import the file if it is needed.
        transactions.push({
          id: uid('t'), date: p.date, amountCents: p.amountCents,
          merchant: p.merchant, categoryId: null, batchId: batchId,
          dedupe: p.dedupe, note: '', updatedAt: now,
        });
      });
    });

    pending = null;
    el.importModal.style.display = 'none';
    Views.show('spending');
  }

  async function removeBatch(id) {
    var b = batches.find(function (x) { return x.id === id; });
    if (!b) return;
    var n = transactions.filter(function (t) { return t.batchId === id; }).length;
    var ok = await UI.confirm({
      title: 'Remove this import?',
      body: 'Takes out all ' + n + ' transaction' + (n === 1 ? '' : 's') + ' that came from ' + b.source + '. Nothing else is touched.',
      okLabel: 'Remove them', danger: true,
    });
    if (!ok) return;
    updateData(function () {
      // Splice in place rather than reassigning: sync's getState() closed over these
      // arrays, and swapping the binding would leave it reading the old one.
      for (var i = transactions.length - 1; i >= 0; i--) {
        if (transactions[i].batchId === id) transactions.splice(i, 1);
      }
      var bi = batches.findIndex(function (x) { return x.id === id; });
      if (bi >= 0) batches.splice(bi, 1);
    });
  }

  /* ── the view ────────────────────────────────────────────────────────────── */

  var MONTH_NAMES = ['January','February','March','April','May','June',
                     'July','August','September','October','November','December'];

  /**
   * A whole month's worth, not the last 30 days — a part-month total invites a
   * comparison with a full one and always looks like an improvement.
   *
   * The month is the most recent one PRESENT IN THE DATA, not the previous calendar
   * month. A statement usually covers a period that has already ended, so anchoring
   * to "last month" showed an empty panel with nothing explaining why.
   */
  function reportMonth() {
    if (!transactions.length) return null;
    var latest = transactions.reduce(function (m, t) { return t.date > m ? t.date : m; }, transactions[0].date);
    var p = Dates.parse(latest);
    var from = p.y + '-' + String(p.m).padStart(2, '0') + '-01';
    return { from: from, to: Dates.addDays(Dates.addMonths(from, 1), -1),
             label: MONTH_NAMES[p.m - 1] + ' ' + p.y };
  }

  function render() {
    if (!el.spSummary) return;
    var any = transactions.length > 0;
    el.spSummary.hidden = !any;
    el.spBody.hidden = !any;
    // Full-height invitation while it is the only thing to do; a slim bar afterwards.
    el.dropzone.classList.toggle('is-compact', any);
    if (!any) return;

    var dates = transactions.map(function (t) { return t.date; }).sort();
    el.spCount.textContent = String(transactions.length);
    el.spRange.textContent = dates.length === 1
      ? dates[0]
      : dates[0] + ' → ' + dates[dates.length - 1];

    var win = reportMonth();
    var inWin = transactions.filter(function (t) { return t.date >= win.from && t.date <= win.to; });
    // Name the month on the labels, so a figure can never be read as the wrong period.
    el.spOutLabel.textContent = 'Out in ' + win.label;
    el.spInLabel.textContent = 'In in ' + win.label;
    el.merchantTitle.textContent = 'Where it went \u00b7 ' + win.label;
    var out = inWin.reduce(function (a, t) { return a + (t.amountCents < 0 ? -t.amountCents : 0); }, 0);
    var inn = inWin.reduce(function (a, t) { return a + (t.amountCents > 0 ? t.amountCents : 0); }, 0);
    el.spOut.textContent = Money.format(out);
    el.spIn.textContent = Money.format(inn);

    // Merchants by spend over that same window, biggest first.
    var byMerchant = new Map();
    inWin.forEach(function (t) {
      if (t.amountCents >= 0) return;
      var e = byMerchant.get(t.merchant) || { cents: 0, n: 0 };
      e.cents += -t.amountCents; e.n++;
      byMerchant.set(t.merchant, e);
    });
    var list = Array.from(byMerchant.entries()).sort(function (a, b) { return b[1].cents - a[1].cents; }).slice(0, 12);
    var top = list.length ? list[0][1].cents : 1;
    el.merchantList.innerHTML = list.length
      ? list.map(function (e) {
          return '<li><button type="button" class="m-name" data-rename="' + esc(e[0])
            + '" title="Rename this merchant">' + esc(e[0]) + '</button>'
            + '<span class="m-bar"><span style="inline-size:' + Math.round(e[1].cents / top * 100) + '%"></span></span>'
            + '<span class="m-amt money out">' + Money.format(e[1].cents) + '</span>'
            + '<span class="m-n">' + e[1].n + '×</span></li>';
        }).join('')
      : '<li class="muted">Nothing went out in ' + esc(win.label) + '.</li>';

    el.batchList.innerHTML = batches.slice().sort(function (a, b) { return b.at - a.at; }).map(function (b) {
      return '<div class="money-row"><div class="mr-open is-static">'
        + '<span class="mr-name">' + esc(b.source) + '</span>'
        + '<span class="mr-meta">' + b.count + ' rows' + (b.from ? ' · ' + b.from + ' → ' + b.to : '') + '</span>'
        + '<span class="mr-amt">' + b.format.toUpperCase() + '</span></div>'
        + '<button type="button" class="icon danger" data-del-batch="' + b.id + '" aria-label="Remove this import">✕</button></div>';
    }).join('') || '<p class="muted">No imports yet.</p>';
  }

  /* Where the sanitiser could not confidently reduce a name, the user gets to fix
   * it — and the fix applies to every transaction carrying that name, past and
   * future, which is the point of canonicalising at all (plan §7.2). */
  async function renameMerchant(current) {
    var name = await UI.ask({
      title: 'Rename this merchant',
      body: 'Applies to every transaction currently filed under "' + current + '".',
      value: current, okLabel: 'Rename',
    });
    if (name == null) return;
    name = String(name).trim();
    if (!name || name === current) return;
    updateData(function () {
      transactions.forEach(function (t) {
        if (t.merchant === current) { t.merchant = name; t.updatedAt = Date.now(); }
      });
    });
  }

  /* ── wiring ──────────────────────────────────────────────────────────────── */

  function init() {
    [
      'dropzone', 'fileInput', 'pickFile', 'spSummary', 'spBody', 'spCount', 'spRange',
      'spOut', 'spIn', 'spOutLabel', 'spInLabel', 'merchantList', 'merchantTitle', 'batchList',
      'importModal', 'impTitle', 'impSummary', 'impMapping', 'impWarn', 'impPreview',
      'impMore', 'impCancel', 'impConfirm',
      'mapDate', 'mapAmount', 'mapDesc', 'mapOrder',
    ].forEach(function (k) { el[k] = document.getElementById(k); });
    if (!el.dropzone) return;

    el.pickFile.addEventListener('click', function () { el.fileInput.click(); });
    el.fileInput.addEventListener('change', function () {
      handleFile(el.fileInput.files[0]);
      el.fileInput.value = '';       // so the same file can be picked twice
    });

    ['dragenter', 'dragover'].forEach(function (ev) {
      el.dropzone.addEventListener(ev, function (e) { e.preventDefault(); el.dropzone.classList.add('is-over'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      el.dropzone.addEventListener(ev, function (e) { e.preventDefault(); el.dropzone.classList.remove('is-over'); });
    });
    el.dropzone.addEventListener('drop', function (e) {
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
    });

    [el.mapDate, el.mapAmount, el.mapDesc, el.mapOrder].forEach(function (sel) {
      sel.addEventListener('change', function () { readMapping(); refreshPreview(); });
    });

    el.impConfirm.addEventListener('click', commit);
    el.impCancel.addEventListener('click', function () { pending = null; el.importModal.style.display = 'none'; });
    el.importModal.addEventListener('click', function (e) {
      if (e.target === el.importModal) { pending = null; el.importModal.style.display = 'none'; }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && el.importModal.style.display === 'flex') {
        pending = null; el.importModal.style.display = 'none';
      }
    });

    el.batchList.addEventListener('click', function (e) {
      var b = e.target.closest('[data-del-batch]');
      if (b) removeBatch(b.dataset.delBatch);
    });

    el.merchantList.addEventListener('click', function (e) {
      var b = e.target.closest('[data-rename]');
      if (b) renameMerchant(b.dataset.rename);
    });

    render();
  }

  window.Spending = { render: render, init: init };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
