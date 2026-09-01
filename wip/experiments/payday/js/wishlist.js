/* wishlist.js — the items-to-buy page.
 * ---------------------------------------------------------------------------
 * app.js owns auth, sync and the modals. This file owns the list.
 *
 * It reads the script-scoped `wishlist`, `categories` and `settings` declared in
 * app.js, and changes them ONLY through updateData(), which persists locally and
 * lets sync ship the difference.
 *
 * The brief for this page is Rose's own account of why a spreadsheet failed:
 *   "the whole thing feels clunky to use? i gotta manually edit each cell"
 *   "how do i add new items quickly?"
 *   "i wanted single click to open urls instead of these click into cell then open"
 *   "the drop downs are a tiny arrow instead of a big bubble"
 *   "whats these parical tax deductables ... idk it dosent make sense to me"
 * Every one of those is a requirement below, not a nicety.
 */
(function () {
  'use strict';

  var el = {};
  var editingId = null;
  var dragId = null;
  var projection = new Map();   // itemId -> {date, confidence, beyondHorizon, blocked}

  function uid() {
    return 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function cat(id) {
    for (var i = 0; i < categories.length; i++) if (categories[i].id === id) return categories[i];
    return null;
  }

  function statusLabel(id) {
    for (var i = 0; i < STATUSES.length; i++) if (STATUSES[i].id === id) return STATUSES[i].label;
    return id;
  }

  /* Items that still cost money. `bought` and `dropped` are history; counting them
   * in the total is the single most misleading thing this page could do. */
  function isPending(item) {
    return item.status !== 'bought' && item.status !== 'dropped';
  }

  /* ── adding ────────────────────────────────────────────────────────────── */

  /* Quick-add is the whole product. Name and price are enough; nothing optional
   * may ever block a save. */
  function quickAdd() {
    var name = el.addName.value.trim();
    var cents = Money.parse(el.addPrice.value);

    if (!name) { flashInvalid(el.addName, 'Give it a name'); return; }
    if (cents == null) { flashInvalid(el.addPrice, 'Needs a price'); return; }

    var url = el.addUrl.value.trim();
    var pos = Order.end(wishlist);
    var now = Date.now();

    updateData(function () {
      wishlist.push({
        id: uid(),
        name: name,
        url: url,
        imageUrl: '',
        priceCents: cents,
        targetPriceCents: null,
        usedPriceCents: null,
        cur: settings.currency || 'AUD',
        priceSource: 'manual',
        priceCheckedAt: now,
        categoryId: el.addCategory.value || null,
        status: 'wanted',
        workUsePct: 0,
        notes: '',
        why: '',
        dependsOn: [],
        allocatedCents: 0,
        posNum: pos.posNum,
        posDen: pos.posDen,
        createdAt: now,
        updatedAt: now,
      });
    });

    el.addName.value = '';
    el.addPrice.value = '';
    el.addUrl.value = '';
    el.addName.focus();
  }

  function flashInvalid(input, message) {
    input.setAttribute('aria-invalid', 'true');
    input.classList.add('invalid');
    el.addHint.textContent = message;
    input.focus();
    setTimeout(function () {
      input.classList.remove('invalid');
      input.removeAttribute('aria-invalid');
      el.addHint.textContent = '';
    }, 2200);
  }

  /* Pasting a product URL is how an item actually starts life — as a browser tab.
   * Until the phase-2 price fetcher exists we cannot read the page, but we can at
   * least stop the user retyping the shop's name. */
  function nameFromUrl(raw) {
    try {
      var u = new URL(raw);
      var host = u.hostname.replace(/^www\./, '').split('.')[0];
      var slug = u.pathname.split('/').filter(Boolean).pop() || '';
      slug = decodeURIComponent(slug)
        .replace(/\.(html?|php|aspx)$/i, '')
        .replace(/[-_+]+/g, ' ')
        .replace(/\b\d{6,}\b/g, '')       // product ids are noise, not a name
        .replace(/\s+/g, ' ')
        .trim();
      if (slug.length > 3) {
        return slug.replace(/\b\w/g, function (c) { return c.toUpperCase(); }).slice(0, 90);
      }
      return host.charAt(0).toUpperCase() + host.slice(1);
    } catch (e) { return ''; }
  }

  /* ── editing ───────────────────────────────────────────────────────────── */

  function patch(id, changes) {
    updateData(function () {
      for (var i = 0; i < wishlist.length; i++) {
        if (wishlist[i].id === id) {
          Object.assign(wishlist[i], changes, { updatedAt: Date.now() });
          return;
        }
      }
    });
  }

  function removeItem(id) {
    var item = wishlist.find(function (i) { return i.id === id; });
    if (!item) return;
    UI.confirm({
      title: 'Remove ' + item.name + '?',
      body: 'If you might still want it, set it to Parked instead — that keeps the cost on record without it holding up the list.',
      okLabel: 'Remove it', cancelLabel: 'Keep it', danger: true,
    }).then(function (yes) {
      if (!yes) return;
      updateData(function () {
        var idx = wishlist.findIndex(function (i) { return i.id === id; });
        if (idx >= 0) wishlist.splice(idx, 1);
      });
    });
  }

  /* ── ordering ──────────────────────────────────────────────────────────── */

  /* Explicit move buttons exist alongside drag because drag-and-drop is unreliable
   * on touch and unusable from a keyboard. Rose uses a phone; these are the
   * primary control, not the fallback. */
  function move(id, delta) {
    var sorted = Order.sorted(wishlist);
    var idx = sorted.findIndex(function (i) { return i.id === id; });
    var target = idx + delta;
    if (idx < 0 || target < 0 || target >= sorted.length) return;

    var before, after;
    if (delta < 0) { before = sorted[target - 1] || null; after = sorted[target]; }
    else { before = sorted[target]; after = sorted[target + 1] || null; }

    var pos = Order.between(before, after);
    updateData(function () {
      var item = wishlist.find(function (i) { return i.id === id; });
      if (!item) return;
      item.posNum = pos.posNum; item.posDen = pos.posDen; item.updatedAt = Date.now();
      if (Order.needsRenormalise(wishlist)) Order.renormalise(wishlist);
    });
  }

  function dropOn(targetId) {
    if (!dragId || dragId === targetId) return;
    var sorted = Order.sorted(wishlist);
    var from = sorted.findIndex(function (i) { return i.id === dragId; });
    var to = sorted.findIndex(function (i) { return i.id === targetId; });
    if (from < 0 || to < 0) return;
    move(dragId, to - from);
  }

  /* ── categories ────────────────────────────────────────────────────────── */

  /* Created inline, in the row where they are needed — never in a settings page.
   * A category you have to go elsewhere to make is a category you do not make. */
  function addCategory(name) {
    name = (name || '').trim();
    if (!name) return null;
    var existing = categories.find(function (c) {
      return c.name.toLowerCase() === name.toLowerCase();
    });
    if (existing) return existing.id;
    var id = 'c' + Date.now().toString(36);
    updateData(function () { categories.push({ id: id, name: name }); });
    return id;
  }

  /* ── rendering ─────────────────────────────────────────────────────────── */

  function render() {
    if (!el.list) return;
    renderCategoryOptions();

    // Recompute the whole queue on every render. It is O(events + items) and takes
    // well under a millisecond, which is what makes live feedback during a drag
    // possible at all — see the delta preview below.
    projection = Engine.projectQueue({
      wishlist: wishlist, income: income,
      // What-if costs are excluded: they are not actually leaving the account.
      recurring: recurring.filter(function (c) { return !c.whatIf; }),
      startBalanceCents: settings.startBalanceCents || 0,
    });
    // The overview reads the same projection rather than recomputing it, so the
    // two views can never disagree about a date.
    window.PaydayProjection = projection;

    var items = Order.sorted(wishlist);
    var pending = items.filter(isPending);
    var total = pending.reduce(function (s, i) { return s + i.priceCents; }, 0);
    var allocated = pending.reduce(function (s, i) { return s + (i.allocatedCents || 0); }, 0);

    el.summaryCount.textContent = pending.length + (pending.length === 1 ? ' item' : ' items');
    el.summaryTotal.textContent = Money.format(total);
    el.summaryLeft.textContent = Money.format(Math.max(0, total - allocated));

    var bought = items.filter(function (i) { return i.status === 'bought'; });
    el.summaryBought.textContent = bought.length
      ? bought.length + ' bought · ' + Money.format(bought.reduce(function (s, i) { return s + i.priceCents; }, 0))
      : '';

    el.root.dataset.view = settings.view === 'table' ? 'table' : 'cards';
    el.viewCards.setAttribute('aria-pressed', String(settings.view !== 'table'));
    el.viewTable.setAttribute('aria-pressed', String(settings.view === 'table'));

    if (!items.length) { renderEmpty(); return; }

    el.empty.hidden = true;
    el.list.hidden = false;
    el.list.innerHTML = '';
    items.forEach(function (item, idx) {
      el.list.appendChild(settings.view === 'table' ? rowFor(item, idx, items.length)
                                                    : cardFor(item, idx, items.length));
    });
  }

  /* A brand-new list must invite the first item, not present an empty table. */
  function renderEmpty() {
    el.list.hidden = true;
    el.empty.hidden = false;
  }

  function renderCategoryOptions() {
    var current = el.addCategory.value;
    el.addCategory.innerHTML = '<option value="">No category</option>'
      + categories.map(function (c) {
          return '<option value="' + c.id + '">' + esc(c.name) + '</option>';
        }).join('')
      + '<option value="__new">+ New category…</option>';
    if (current && (current === '__new' || cat(current))) el.addCategory.value = current;
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* One click opens the shop. The card is NOT the link — a dedicated control is —
   * so clicking the card can select or expand without hijacking the pointer. */
  function storeLink(item) {
    if (!item.url) return '';
    return '<a class="store-link" href="' + esc(item.url) + '" target="_blank" rel="noopener noreferrer"'
      + ' title="Open in the shop" aria-label="Open ' + esc(item.name) + ' in the shop">↗</a>';
  }

  function chips(item) {
    var c = cat(item.categoryId);
    return '<button type="button" class="chip chip-status s-' + esc(item.status) + '" data-act="status" data-id="' + item.id + '">'
         + esc(statusLabel(item.status)) + '</button>'
         + '<button type="button" class="chip chip-cat" data-act="cat" data-id="' + item.id + '">'
         + (c ? esc(c.name) : '+ category') + '</button>';
  }

  /* The projected date, stated at a precision the projection actually supports.
   * A date 14 months out is a guess and must not be printed like a fact — the
   * label degrades to a month, then a quarter, then just a year. */
  function dateBadge(item) {
    if (!isPending(item)) return '';
    if (!income.length) {
      return '<span class="when when-none" title="Add your pay in the Money panel and payday will work out when you can afford this.">add your pay →</span>';
    }
    var p = projection.get(item.id);
    if (!p) return '';
    if (p.blocked) return '<span class="when when-blocked" title="Waiting on something earlier in your list.">needs another item first</span>';
    if (p.beyondHorizon) return '<span class="when when-far" title="More than three years away at your current savings rate.">not within 3 years</span>';
    return '<span class="when when-' + p.confidence + '" title="Projected from your pay, your subscriptions and the order of this list. '
      + (p.confidence === 'high' ? 'Reasonably reliable at this range.' : 'This far out it is an estimate.') + '">'
      + Dates.pretty(p.date) + '</span>';
  }

  function moveButtons(item, idx, count) {
    return '<div class="move">'
      + '<button type="button" class="icon" data-act="up" data-id="' + item.id + '" '
      + (idx === 0 ? 'disabled' : '') + ' aria-label="Move ' + esc(item.name) + ' up">↑</button>'
      + '<button type="button" class="icon" data-act="down" data-id="' + item.id + '" '
      + (idx === count - 1 ? 'disabled' : '') + ' aria-label="Move ' + esc(item.name) + ' down">↓</button>'
      + '</div>';
  }

  function cardFor(item, idx, count) {
    var node = document.createElement('article');
    node.className = 'card' + (isPending(item) ? '' : ' is-done');
    node.dataset.id = item.id;
    node.draggable = true;
    node.innerHTML =
        '<div class="card-media">'
      +   (item.imageUrl ? '<img src="' + esc(item.imageUrl) + '" alt="" loading="lazy">' : '<span class="noimg" aria-hidden="true">◻</span>')
      + '</div>'
      + '<div class="card-body">'
      +   '<div class="card-head">'
      +     '<h3>' + esc(item.name) + '</h3>' + storeLink(item)
      +   '</div>'
      +   '<p class="price money">' + Money.format(item.priceCents) + dateBadge(item) + '</p>'
      +   '<div class="chips">' + chips(item) + '</div>'
      +   (item.why ? '<p class="why">' + esc(item.why) + '</p>' : '')
      + '</div>'
      + '<div class="card-actions">'
      +   moveButtons(item, idx, count)
      +   '<button type="button" class="icon" data-act="edit" data-id="' + item.id + '" aria-label="Edit ' + esc(item.name) + '">✎</button>'
      +   '<button type="button" class="icon danger" data-act="del" data-id="' + item.id + '" aria-label="Remove ' + esc(item.name) + '">✕</button>'
      + '</div>';
    return node;
  }

  function rowFor(item, idx, count) {
    var node = document.createElement('div');
    node.className = 'row' + (isPending(item) ? '' : ' is-done');
    node.dataset.id = item.id;
    node.draggable = true;
    var c = cat(item.categoryId);
    node.innerHTML =
        '<span class="grip" aria-hidden="true">⠿</span>'
      + '<span class="r-name">' + esc(item.name) + storeLink(item) + '</span>'
      + '<span class="r-cat">' + (c ? esc(c.name) : '—') + '</span>'
      + '<span class="r-status"><button type="button" class="chip chip-status s-' + esc(item.status) + '" data-act="status" data-id="' + item.id + '">' + esc(statusLabel(item.status)) + '</button></span>'
      + '<span class="r-price money">' + Money.format(item.priceCents) + '</span>'
      + '<span class="r-when">' + dateBadge(item) + '</span>'
      + '<span class="r-actions">'
      +   moveButtons(item, idx, count)
      +   '<button type="button" class="icon" data-act="edit" data-id="' + item.id + '" aria-label="Edit ' + esc(item.name) + '">✎</button>'
      +   '<button type="button" class="icon danger" data-act="del" data-id="' + item.id + '" aria-label="Remove ' + esc(item.name) + '">✕</button>'
      + '</span>';
    return node;
  }

  /* ── the edit panel ────────────────────────────────────────────────────── */

  function openEdit(id) {
    var item = wishlist.find(function (i) { return i.id === id; });
    if (!item) return;
    editingId = id;

    el.editName.value = item.name;
    el.editPrice.value = Money.toInput(item.priceCents);
    el.editTarget.value = Money.toInput(item.targetPriceCents);
    el.editUsed.value = Money.toInput(item.usedPriceCents);
    el.editUrl.value = item.url || '';
    el.editImage.value = item.imageUrl || '';
    el.editWhy.value = item.why || '';
    el.editNotes.value = item.notes || '';
    el.editWork.value = String(item.workUsePct || 0);
    el.editWorkOut.textContent = (item.workUsePct || 0) + '%';

    el.editStatus.innerHTML = STATUSES.map(function (s) {
      return '<option value="' + s.id + '">' + esc(s.label) + '</option>';
    }).join('');
    el.editStatus.value = item.status;

    el.editCat.innerHTML = '<option value="">No category</option>'
      + categories.map(function (c) { return '<option value="' + c.id + '">' + esc(c.name) + '</option>'; }).join('')
      + '<option value="__new">+ New category…</option>';
    el.editCat.value = item.categoryId || '';

    el.editModal.style.display = 'flex';
    el.editName.focus();
  }

  function saveEdit() {
    if (!editingId) return;
    var cents = Money.parse(el.editPrice.value);
    if (!el.editName.value.trim()) { el.editName.focus(); return; }
    if (cents == null) { el.editPrice.focus(); return; }

    if (el.editCat.value === '__new') {
      newCategory().then(function (id) { el.editCat.value = id || ''; saveEdit(); });
      return;
    }
    var catId = el.editCat.value;

    patch(editingId, {
      name: el.editName.value.trim(),
      priceCents: cents,
      targetPriceCents: Money.parse(el.editTarget.value),
      usedPriceCents: Money.parse(el.editUsed.value),
      url: el.editUrl.value.trim(),
      imageUrl: el.editImage.value.trim(),
      why: el.editWhy.value.trim(),
      notes: el.editNotes.value.trim(),
      status: el.editStatus.value,
      categoryId: catId || null,
      workUsePct: Math.max(0, Math.min(100, Number(el.editWork.value) || 0)),
      priceCheckedAt: Date.now(),
    });
    closeEdit();
  }

  function closeEdit() {
    editingId = null;
    el.editModal.style.display = 'none';
  }

  /* ── wiring ────────────────────────────────────────────────────────────── */

  function cycleStatus(id) {
    var item = wishlist.find(function (i) { return i.id === id; });
    if (!item) return;
    var idx = STATUSES.findIndex(function (s) { return s.id === item.status; });
    patch(id, { status: STATUSES[(idx + 1) % STATUSES.length].id });
  }

  function newCategory(value) {
    return UI.ask({
      title: 'New category',
      placeholder: 'Gaming, PC parts, Server…',
      value: value || '', okLabel: 'Create',
    }).then(function (name) { return addCategory(name || ''); });
  }

  /* One dialog: tap an existing category, or type a new one. The old version was a
     native prompt() that listed categories as numbered text and asked the user to
     type a number OR a name — i.e. to parse a menu out of a sentence. */
  function pickCategory(id) {
    var item = wishlist.find(function (i) { return i.id === id; });
    if (!item) return;
    var current = cat(item.categoryId);

    UI.pick({
      title: 'Category',
      body: 'For "' + item.name + '". Tap one, or type a new name.',
      value: current ? current.name : '',
      placeholder: 'New category name',
      choices: categories.map(function (c) { return { label: c.name, value: c.id }; })
        .concat(current ? [{ label: 'No category', value: '__none' }] : []),
    }).then(function (answer) {
      if (answer === null) return;
      if (answer === '__none') { patch(id, { categoryId: null }); return; }
      // A choice returns its id; free text returns a name.
      if (categories.some(function (c) { return c.id === answer; })) {
        patch(id, { categoryId: answer });
        return;
      }
      var trimmed = String(answer).trim();
      if (!trimmed) { patch(id, { categoryId: null }); return; }
      var newId = addCategory(trimmed);
      if (newId) patch(id, { categoryId: newId });
    });
  }

  function init() {
    el.root = document.getElementById('payday');
    if (!el.root) return;

    [
      'list', 'empty', 'addName', 'addPrice', 'addUrl', 'addCategory', 'addButton', 'addHint',
      'viewCards', 'viewTable', 'summaryCount', 'summaryTotal', 'summaryLeft', 'summaryBought',
      'editModal', 'editName', 'editPrice', 'editTarget', 'editUsed', 'editUrl', 'editImage',
      'editWhy', 'editNotes', 'editStatus', 'editCat', 'editWork', 'editWorkOut',
      'editSave', 'editCancel',
    ].forEach(function (k) { el[k] = document.getElementById(k); });

    el.addButton.addEventListener('click', quickAdd);
    [el.addName, el.addPrice, el.addUrl].forEach(function (input) {
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); quickAdd(); }
      });
    });

    // Pasting a URL fills in a name, so the common case is paste → price → Enter.
    el.addUrl.addEventListener('paste', function (e) {
      var text = (e.clipboardData || window.clipboardData).getData('text');
      if (!text || !/^https?:\/\//i.test(text.trim())) return;
      setTimeout(function () {
        if (!el.addName.value.trim()) {
          var guess = nameFromUrl(text.trim());
          if (guess) { el.addName.value = guess; el.addName.select(); }
        }
      }, 0);
    });

    el.addCategory.addEventListener('change', function () {
      if (el.addCategory.value !== '__new') return;
      el.addCategory.value = '';
      newCategory().then(function (id) { if (id) el.addCategory.value = id; });
    });

    el.viewCards.addEventListener('click', function () { setView('cards'); });
    el.viewTable.addEventListener('click', function () { setView('table'); });

    el.list.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-act]');
      if (!btn) return;
      var id = btn.dataset.id;
      switch (btn.dataset.act) {
        case 'up': move(id, -1); break;
        case 'down': move(id, 1); break;
        case 'edit': openEdit(id); break;
        case 'del': removeItem(id); break;
        case 'status': cycleStatus(id); break;
        case 'cat': pickCategory(id); break;
      }
    });

    el.list.addEventListener('dragstart', function (e) {
      var node = e.target.closest('[data-id]');
      if (!node) return;
      dragId = node.dataset.id;
      node.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    el.list.addEventListener('dragover', function (e) { e.preventDefault(); });
    el.list.addEventListener('drop', function (e) {
      e.preventDefault();
      var node = e.target.closest('[data-id]');
      if (node) dropOn(node.dataset.id);
    });
    el.list.addEventListener('dragend', function () {
      dragId = null;
      Array.prototype.forEach.call(el.list.children, function (c) { c.classList.remove('dragging'); });
    });

    el.editSave.addEventListener('click', saveEdit);
    el.editCancel.addEventListener('click', closeEdit);
    el.editWork.addEventListener('input', function () {
      el.editWorkOut.textContent = el.editWork.value + '%';
    });
    el.editModal.addEventListener('click', function (e) {
      if (e.target === el.editModal) closeEdit();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && editingId) closeEdit();
    });

    render();
  }

  function setView(view) {
    updateData(function () { settings.view = view; });
  }

  window.Wishlist = { render: render, init: init };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
