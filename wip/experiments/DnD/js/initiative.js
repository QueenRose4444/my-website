window.DnD = window.DnD || {};

// Initiative tracker widget. DM drives the list (add PC/NPC, start/advance/end,
// tweak HP inline). Players see read-only and get a "Your turn!" nudge when
// their PC becomes current.
DnD.initiative = (() => {
  const listEl   = document.getElementById('initList');
  const statusEl = document.getElementById('initStatus');
  if (!listEl || !statusEl) return null;

  const btnAddPc   = document.getElementById('btnInitAddPc');
  const btnAddNpc  = document.getElementById('btnInitAddNpc');
  const btnStart   = document.getElementById('btnInitStart');
  const btnAdvance = document.getElementById('btnInitAdvance');
  const btnEnd     = document.getElementById('btnInitEnd');

  const addPcForm  = document.getElementById('initAddPcForm');
  const addNpcForm = document.getElementById('initAddNpcForm');
  const btnRollPc  = document.getElementById('btnRollInitPc');

  const originalTitle = document.title;
  let state = { combatants: [], round: 0, turnIndex: 0, active: false };

  function isDm() { return DnD.session?.isDm(); }
  function myUserId() { return window.authManager.currentUser?.userId; }

  function currentCombatant() {
    if (!state.active || !state.combatants.length) return null;
    return state.combatants[state.turnIndex] || null;
  }

  function render() {
    const cur = currentCombatant();
    if (state.active) {
      statusEl.textContent = `Round ${state.round} · ${cur ? cur.label : '—'}`;
      statusEl.classList.add('active');
    } else {
      statusEl.textContent = state.combatants.length
        ? `${state.combatants.length} combatants queued.`
        : 'No combat running.';
      statusEl.classList.remove('active');
    }

    listEl.innerHTML = '';
    state.combatants.forEach((c, i) => {
      const li = document.createElement('li');
      li.className = 'init-row' + (state.active && i === state.turnIndex ? ' current' : '');
      if (c.kind === 'pc') li.classList.add('pc');
      if (c.kind === 'npc') li.classList.add('npc');
      const hp = c.hpMax != null
        ? `<span class="init-hp">${c.hpCur ?? c.hpMax}/${c.hpMax}</span>`
        : '';
      const swatch = c.color ? `<span class="init-swatch" style="background:${DnD.escape(c.color)}"></span>` : '';
      li.innerHTML = `
        <span class="init-pos">${i + 1}</span>
        ${swatch}
        <span class="init-label">${DnD.escape(c.label || '—')}</span>
        <span class="init-score">${c.initiative ?? 0}</span>
        ${hp}
        ${isDm() ? `
          <span class="init-dm">
            <button class="btn tiny ghost" data-action="hp-dmg" title="Damage">−</button>
            <button class="btn tiny ghost" data-action="hp-heal" title="Heal">+</button>
            <button class="btn tiny ghost" data-action="edit" title="Edit">…</button>
            <button class="btn tiny ghost" data-action="remove" title="Remove">×</button>
          </span>
        ` : ''}
      `;
      li.dataset.id = c.id;
      listEl.appendChild(li);
    });

    if (btnAdvance) btnAdvance.disabled = !state.active;
    if (btnEnd) btnEnd.disabled = !state.active && !state.combatants.length;
    if (btnStart) btnStart.disabled = state.active || !state.combatants.length;

    nudgeYourTurn(cur);
  }

  let lastYourTurnId = null;
  function nudgeYourTurn(cur) {
    if (!state.active) {
      document.title = originalTitle;
      lastYourTurnId = null;
      return;
    }
    const mine = cur && cur.kind === 'pc' && cur.userId === myUserId();
    if (mine && lastYourTurnId !== cur.id) {
      DnD.toast('Your turn!', 'ok');
      document.title = `★ Your turn — ${originalTitle}`;
      lastYourTurnId = cur.id;
    } else if (!mine) {
      document.title = originalTitle;
      lastYourTurnId = null;
    }
  }

  listEl.addEventListener('click', async (e) => {
    if (!isDm()) return;
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const li = btn.closest('.init-row');
    if (!li) return;
    const id = li.dataset.id;
    const c = state.combatants.find(x => x.id === id);
    if (!c) return;

    if (btn.dataset.action === 'remove') {
      if (!confirm(`Remove "${c.label}" from initiative?`)) return;
      const ack = await DnD.lobby.emit('init:remove', { campaignId: DnD.session.campaignId(), id });
      if (ack.error) DnD.toast(ack.error, 'err');
      return;
    }
    if (btn.dataset.action === 'hp-dmg' || btn.dataset.action === 'hp-heal') {
      const raw = prompt(btn.dataset.action === 'hp-dmg' ? 'Damage amount' : 'Heal amount', '5');
      const n = Math.max(0, Number(raw) | 0);
      if (!n) return;
      if (c.kind === 'pc' && c.userId) {
        // Route PC HP through the character socket so the sheet stays the source of truth.
        DnD.session?.applyHpDeltaForMember(c.userId, btn.dataset.action === 'hp-dmg' ? -n : n);
      } else {
        const cur = c.hpCur ?? c.hpMax ?? 0;
        const max = c.hpMax ?? cur;
        let next = btn.dataset.action === 'hp-dmg' ? Math.max(0, cur - n) : Math.min(max, cur + n);
        const ack = await DnD.lobby.emit('init:update', {
          campaignId: DnD.session.campaignId(),
          id, patch: { hpCur: next }
        });
        if (ack.error) DnD.toast(ack.error, 'err');
      }
      return;
    }
    if (btn.dataset.action === 'edit') {
      const label = prompt('Label', c.label);
      if (label == null) return;
      const initRaw = prompt('Initiative', String(c.initiative ?? 0));
      if (initRaw == null) return;
      const patch = { label, initiative: Number(initRaw) || 0 };
      if (c.kind === 'npc') {
        const hpRaw = prompt('HP (cur/max, blank skips)', c.hpMax != null ? String(c.hpMax) : '');
        if (hpRaw) {
          const n = Math.max(0, Number(hpRaw) | 0);
          patch.hpCur = n; patch.hpMax = n;
        }
      }
      const ack = await DnD.lobby.emit('init:update', { campaignId: DnD.session.campaignId(), id, patch });
      if (ack.error) DnD.toast(ack.error, 'err');
    }
  });

  if (btnStart)   btnStart.addEventListener('click', async () => {
    const ack = await DnD.lobby.emit('init:start', { campaignId: DnD.session.campaignId() });
    if (ack.error) DnD.toast(ack.error, 'err');
  });
  if (btnAdvance) btnAdvance.addEventListener('click', async () => {
    const ack = await DnD.lobby.emit('init:advance', { campaignId: DnD.session.campaignId() });
    if (ack.error) DnD.toast(ack.error, 'err');
  });
  if (btnEnd)     btnEnd.addEventListener('click', async () => {
    if (!confirm('End combat? This clears all combatants.')) return;
    const ack = await DnD.lobby.emit('init:end', { campaignId: DnD.session.campaignId() });
    if (ack.error) DnD.toast(ack.error, 'err');
  });

  function populatePcPicker() {
    const sel = addPcForm?.querySelector('select[name=memberId]');
    if (!sel) return;
    sel.innerHTML = '';
    for (const m of DnD.session?.members() || []) {
      if (!m.characterId) continue;
      const opt = document.createElement('option');
      opt.value = String(m.userId);
      opt.dataset.characterId = m.characterId;
      opt.textContent = `@${m.username}`;
      sel.appendChild(opt);
    }
    if (!sel.options.length) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'No bound PCs in the party';
      sel.appendChild(opt);
    }
  }

  if (btnAddPc) btnAddPc.addEventListener('click', () => {
    populatePcPicker();
    DnD.openModal('initAddPcModal');
  });
  if (btnAddNpc) btnAddNpc.addEventListener('click', () => {
    DnD.openModal('initAddNpcModal');
  });

  if (btnRollPc) {
    btnRollPc.addEventListener('click', async () => {
      const sel = addPcForm.querySelector('select[name=memberId]');
      const userId = Number(sel.value);
      if (!userId) return;
      const char = await DnD.session?.characterForMember(userId);
      const dex = Number(char?.data?.dex ?? 10);
      const mod = Math.floor((dex - 10) / 2);
      const d20 = 1 + Math.floor(Math.random() * 20);
      const total = d20 + mod;
      addPcForm.querySelector('input[name=initiative]').value = String(total);
      // Also shout it into chat so everyone sees the roll that decided order.
      const expr = `1d20${mod >= 0 ? '+' : ''}${mod}`;
      DnD.session?.manualRoll({ expression: expr, total, label: `Initiative · @${DnD.session.usernameFor(userId)}` });
    });
  }

  if (addPcForm) {
    addPcForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = addPcForm.querySelector('[data-role=error]');
      err.textContent = '';
      const fd = new FormData(addPcForm);
      const sel = addPcForm.querySelector('select[name=memberId]');
      const userId = Number(fd.get('memberId'));
      if (!userId) { err.textContent = 'Pick a party member'; return; }
      const opt = sel.options[sel.selectedIndex];
      const characterId = opt?.dataset?.characterId || null;
      const char = await DnD.session?.characterForMember(userId);
      const label = char?.data?.name
        ? `${char.data.name} (@${DnD.session.usernameFor(userId)})`
        : `@${DnD.session.usernameFor(userId)}`;
      const hpMax = char?.data?.maxHp ?? null;
      const hpCur = char?.data?.hp ?? hpMax;
      const ack = await DnD.lobby.emit('init:add-pc', {
        campaignId: DnD.session.campaignId(),
        userId, characterId, label,
        initiative: Number(fd.get('initiative')) || 0,
        hpCur, hpMax
      });
      if (ack.error) { err.textContent = ack.error; return; }
      DnD.closeModal('initAddPcModal');
      addPcForm.reset();
    });
  }

  if (addNpcForm) {
    addNpcForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = addNpcForm.querySelector('[data-role=error]');
      err.textContent = '';
      const fd = new FormData(addNpcForm);
      const ack = await DnD.lobby.emit('init:add-npc', {
        campaignId: DnD.session.campaignId(),
        label: String(fd.get('label') || '').trim(),
        initiative: Number(fd.get('initiative')) || 0,
        hp: Number(fd.get('hp')) || null,
        color: fd.get('color') || null
      });
      if (ack.error) { err.textContent = ack.error; return; }
      DnD.closeModal('initAddNpcModal');
      addNpcForm.reset();
    });
  }

  function applyState(next) {
    state = next || state;
    render();
  }

  return { applyState, render };
})();
