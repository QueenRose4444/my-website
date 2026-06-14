(async function () {
  const $ = DnD.$;

  await window.authManager.initialize();
  if (!window.authManager.isLoggedIn()) {
    location.href = 'index.html';
    return;
  }
  $('#userChip').textContent = `@${window.authManager.currentUser.username}`;

  const raceSel = $('#raceSelect');
  const classSel = $('#classSelect');
  DnD.RULES_5E.races.forEach(r => raceSel.insertAdjacentHTML('beforeend', `<option>${DnD.escape(r)}</option>`));
  DnD.RULES_5E.classes.forEach(c => classSel.insertAdjacentHTML('beforeend', `<option>${DnD.escape(c)}</option>`));

  const skillsGrid = $('#skillsGrid');
  DnD.RULES_5E.skills.forEach(s => {
    skillsGrid.insertAdjacentHTML('beforeend', `
      <div class="skill-row">
        <input type="checkbox" data-skill="${s.id}" />
        <span class="skill-name">${s.label} <small style="color:var(--ink-mute)">(${s.ability})</small></span>
        <span class="skill-mod" data-skill-mod="${s.id}">+0</span>
      </div>
    `);
  });

  let state = {
    id: DnD.getQuery('id'),
    campaignIdOnCreate: DnD.getQuery('campaign'),
    portraitPath: null,
    inventory: [],
    data: {}
  };

  async function loadLibrary() {
    const list = await DnD.api.characters.list();
    const ul = $('#libraryList');
    ul.innerHTML = '';
    list.forEach(c => {
      const li = document.createElement('li');
      if (c.id === state.id) li.classList.add('active');
      li.innerHTML = `<strong>${DnD.escape(c.data.name || 'Unnamed')}</strong>
        <small>${DnD.escape([c.data.race, c.data.class, c.data.level ? `Lv ${c.data.level}` : null].filter(Boolean).join(' · ') || '—')}</small>`;
      li.addEventListener('click', () => { location.href = `character.html?id=${c.id}`; });
      ul.appendChild(li);
    });
    if (!list.length) ul.innerHTML = `<li class="empty small">No characters yet.</li>`;
  }

  function renderInventory() {
    const ul = $('#inventoryList');
    ul.innerHTML = '';
    state.inventory.forEach((item, i) => {
      const li = document.createElement('li');
      li.innerHTML = `
        <span class="qty">×${Number(item.qty) || 1}</span>
        <span>${DnD.escape(item.name)}</span>
        <span class="notes">${DnD.escape(item.notes || '')}</span>
        <button class="btn tiny ghost" data-rm="${i}">✕</button>
      `;
      ul.appendChild(li);
    });
    ul.querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', () => {
      state.inventory.splice(Number(b.dataset.rm), 1);
      renderInventory();
      autosave();
    }));
  }

  function abilitiesFromForm() {
    const f = $('#charForm');
    return {
      str: Number(f.str.value), dex: Number(f.dex.value), con: Number(f.con.value),
      int: Number(f.int.value), wis: Number(f.wis.value), cha: Number(f.cha.value)
    };
  }

  function refreshSkillMods() {
    const abilities = abilitiesFromForm();
    const level = Number($('#charForm').level.value) || 1;
    const prof = DnD.proficiencyBonus(level);
    DnD.RULES_5E.skills.forEach(s => {
      const cb = skillsGrid.querySelector(`[data-skill="${s.id}"]`);
      const out = skillsGrid.querySelector(`[data-skill-mod="${s.id}"]`);
      const mod = DnD.ability.mod(abilities[s.ability]) + (cb.checked ? prof : 0);
      out.textContent = (mod >= 0 ? '+' : '') + mod;
    });
  }

  function collect() {
    const f = $('#charForm');
    const fd = new FormData(f);
    const obj = {};
    fd.forEach((v, k) => { obj[k] = v; });
    const skillsProf = {};
    skillsGrid.querySelectorAll('[data-skill]').forEach(cb => { skillsProf[cb.dataset.skill] = cb.checked; });
    return {
      name: obj.name || '',
      race: obj.race || '',
      class: obj.class || '',
      level: Number(obj.level) || 1,
      background: obj.background || '',
      alignment: obj.alignment || '',
      str: Number(obj.str), dex: Number(obj.dex), con: Number(obj.con),
      int: Number(obj.int), wis: Number(obj.wis), cha: Number(obj.cha),
      hp: Number(obj.hp), maxHp: Number(obj.maxHp), tempHp: Number(obj.tempHp || 0),
      ac: Number(obj.ac), speed: Number(obj.speed), initiativeBonus: Number(obj.initiativeBonus || 0),
      skillsProf,
      inventory: state.inventory,
      features: obj.features || '',
      notes: obj.notes || ''
    };
  }

  function fill(data) {
    const f = $('#charForm');
    for (const k of ['name','race','class','level','background','alignment','str','dex','con','int','wis','cha','hp','maxHp','tempHp','ac','speed','initiativeBonus','features','notes']) {
      if (f[k] && data[k] !== undefined) f[k].value = data[k];
    }
    state.inventory = Array.isArray(data.inventory) ? data.inventory : [];
    renderInventory();
    skillsGrid.querySelectorAll('[data-skill]').forEach(cb => {
      cb.checked = !!(data.skillsProf && data.skillsProf[cb.dataset.skill]);
    });
    refreshSkillMods();
  }

  async function loadOrInit() {
    if (state.id) {
      try {
        const { character } = await DnD.api.characters.get(state.id);
        state.portraitPath = character.portraitPath;
        if (character.portraitPath) {
          $('#portraitPreview').style.backgroundImage = `url('${DnD.api.uploads.url(character.portraitPath)}')`;
        }
        fill(character.data || {});
        $('#charStatus').textContent = 'editing';
        return;
      } catch (e) {
        DnD.toast(e.message, 'err');
      }
    }
    fill({ name: '', level: 1, str:10, dex:10, con:10, int:10, wis:10, cha:10, hp:10, maxHp:10, ac:10, speed:30, inventory: [] });
    $('#charStatus').textContent = 'new';
  }

  async function save() {
    const data = collect();
    const body = { data, portraitPath: state.portraitPath };
    try {
      if (state.id) {
        const updated = await DnD.api.characters.patch(state.id, body);
        DnD.toast('Saved', 'ok');
        state.id = updated.id;
      } else {
        const created = await DnD.api.characters.create(body);
        state.id = created.id;
        DnD.toast('Created', 'ok');
        if (state.campaignIdOnCreate) {
          try {
            await DnD.api.campaigns.setCharacter(state.campaignIdOnCreate, created.id);
          } catch (_) { /* not a member, ignore */ }
          setTimeout(() => location.href = `session.html?c=${encodeURIComponent(state.campaignIdOnCreate)}`, 400);
        } else {
          history.replaceState(null, '', `character.html?id=${created.id}`);
        }
      }
      await loadLibrary();
    } catch (e) { DnD.toast(e.message, 'err'); }
  }

  const autosave = DnD.debounce(save, 800);

  // Inventory add (not a real <form> — it's nested inside charForm)
  const invAdd = $('#inventoryAdd');
  const invName = invAdd.querySelector('[name="invName"]');
  const invQty = invAdd.querySelector('[name="invQty"]');
  const invNotes = invAdd.querySelector('[name="invNotes"]');
  $('#btnAddInventory').addEventListener('click', () => {
    const nm = String(invName.value || '').trim();
    if (!nm) { invName.focus(); return; }
    state.inventory.push({
      name: nm,
      qty: Number(invQty.value) || 1,
      notes: String(invNotes.value || '')
    });
    invName.value = '';
    invQty.value = 1;
    invNotes.value = '';
    invName.focus();
    renderInventory();
    autosave();
  });

  // Portrait upload
  $('#portraitInput').addEventListener('change', async () => {
    const f = $('#portraitInput').files[0];
    if (!f) return;
    try {
      const up = await DnD.api.uploads.file(f, { purpose: 'portrait' });
      state.portraitPath = up.path;
      $('#portraitPreview').style.backgroundImage = `url('${DnD.api.uploads.url(up.path)}')`;
      autosave();
    } catch (e) { DnD.toast(e.message, 'err'); }
  });

  // Abilities / level / skill-prof changes → refresh mods + autosave
  $('#charForm').addEventListener('input', refreshSkillMods);
  $('#charForm').addEventListener('change', () => { refreshSkillMods(); autosave(); });
  skillsGrid.addEventListener('change', () => { refreshSkillMods(); autosave(); });

  $('#btnSave').addEventListener('click', save);
  $('#btnNewChar').addEventListener('click', () => { location.href = 'character.html'; });

  $('#btnExport').addEventListener('click', () => {
    const data = collect();
    const name = (data.name || 'character').replace(/[^a-z0-9_-]+/gi, '_');
    DnD.download(`${name}.json`, JSON.stringify({ version: 1, ruleset: 'dnd5e', portraitPath: state.portraitPath, data }, null, 2));
  });

  $('#importFile').addEventListener('change', async () => {
    const f = $('#importFile').files[0];
    if (!f) return;
    try {
      const text = await f.text();
      const obj = JSON.parse(text);
      if (obj.data) fill(obj.data);
      if (obj.portraitPath) {
        state.portraitPath = obj.portraitPath;
        $('#portraitPreview').style.backgroundImage = `url('${DnD.api.uploads.url(obj.portraitPath)}')`;
      }
      autosave();
    } catch (e) { DnD.toast(e.message, 'err'); }
  });

  $('#btnDelete').addEventListener('click', async () => {
    if (!state.id) { location.href = 'character.html'; return; }
    if (!confirm('Delete this character?')) return;
    try {
      await DnD.api.characters.remove(state.id);
      DnD.toast('Deleted', 'ok');
      location.href = 'character.html';
    } catch (e) { DnD.toast(e.message, 'err'); }
  });

  await loadLibrary();
  await loadOrInit();
})();
