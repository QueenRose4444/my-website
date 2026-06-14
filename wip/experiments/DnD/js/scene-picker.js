window.DnD = window.DnD || {};

// Scene picker: DM creates named maps, switches between them, renames / deletes.
// Players see the dropdown read-only so they know which scene they're looking at.
DnD.scenePicker = (() => {
  const sel = document.getElementById('scenePicker');
  if (!sel) return null;

  const btnNew    = document.getElementById('btnNewMap');
  const btnRename = document.getElementById('btnRenameMap');
  const btnDelete = document.getElementById('btnDeleteMap');
  const newForm   = document.getElementById('newMapForm');

  let maps = [];
  let activeId = null;

  function isDm() { return DnD.session?.isDm(); }

  function render() {
    sel.innerHTML = '';
    if (!maps.length) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = isDm() ? '— no maps (create one) —' : '— no map —';
      sel.appendChild(opt);
    } else {
      for (const m of maps) {
        const opt = document.createElement('option');
        opt.value = m.id;
        opt.textContent = m.name;
        if (m.id === activeId) opt.selected = true;
        sel.appendChild(opt);
      }
    }
    sel.disabled = !isDm() || !maps.length;
    if (btnRename) btnRename.disabled = !activeId;
    if (btnDelete) btnDelete.disabled = !activeId;
  }

  function setMaps(list, active) {
    maps = Array.isArray(list) ? list.slice() : [];
    activeId = active || null;
    render();
  }

  function setActive(id) {
    activeId = id || null;
    render();
  }

  sel.addEventListener('change', async () => {
    if (!isDm()) return;
    const id = sel.value;
    if (!id || id === activeId) return;
    try {
      const ack = await DnD.lobby.emit('map:set-active', { campaignId: DnD.session.campaignId(), mapId: id });
      if (ack.error) throw new Error(ack.error);
      activeId = id;
    } catch (e) {
      DnD.toast(e.message, 'err');
      render();
    }
  });

  if (btnNew && newForm) {
    btnNew.addEventListener('click', () => DnD.openModal('newMapModal'));
    newForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = newForm.querySelector('[data-role=error]');
      err.textContent = '';
      const fd = new FormData(newForm);
      const name = String(fd.get('name') || '').trim();
      if (!name) return;
      try {
        let imagePath = null;
        const f = newForm.querySelector('[name=mapImage]').files[0];
        if (f) {
          const up = await DnD.api.uploads.file(f, { campaignId: DnD.session.campaignId(), purpose: 'map' });
          imagePath = up.path;
        }
        const { map, activeMapId } = await DnD.api.maps.create(DnD.session.campaignId(), { name, imagePath, makeActive: true });
        maps.push(map);
        if (activeMapId) {
          activeId = activeMapId;
          // Server route set the active map but didn't broadcast the swap (that's a socket-only event).
          // Push it through the socket so every client (including us) re-renders off one code path.
          DnD.lobby.emit('map:set-active', { campaignId: DnD.session.campaignId(), mapId: activeMapId });
        }
        render();
        DnD.closeModal('newMapModal');
        newForm.reset();
      } catch (e2) {
        err.textContent = e2.message;
      }
    });
  }

  if (btnRename) {
    btnRename.addEventListener('click', async () => {
      if (!activeId) return;
      const cur = maps.find(m => m.id === activeId);
      const name = prompt('Rename map', cur?.name || '');
      if (!name || name === cur?.name) return;
      try {
        const updated = await DnD.api.maps.patch(DnD.session.campaignId(), activeId, { name });
        const i = maps.findIndex(m => m.id === activeId);
        if (i >= 0) maps[i] = updated;
        render();
      } catch (e) { DnD.toast(e.message, 'err'); }
    });
  }

  if (btnDelete) {
    btnDelete.addEventListener('click', async () => {
      if (!activeId) return;
      const cur = maps.find(m => m.id === activeId);
      if (!confirm(`Delete map "${cur?.name}"? Switch scenes first if this is the active one.`)) return;
      try {
        await DnD.api.maps.remove(DnD.session.campaignId(), activeId);
        maps = maps.filter(m => m.id !== activeId);
        render();
      } catch (e) { DnD.toast(e.message, 'err'); }
    });
  }

  return { setMaps, setActive, addMap(m) { maps.push(m); render(); }, removeMap(id) { maps = maps.filter(m => m.id !== id); if (activeId === id) activeId = null; render(); } };
})();
