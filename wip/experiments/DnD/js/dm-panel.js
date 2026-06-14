window.DnD = window.DnD || {};

DnD.dmPanel = (() => {
  function revealIfDm(isDm) {
    document.querySelectorAll('[data-dm]').forEach(el => el.classList.toggle('hidden', !isDm));
  }

  const btnCopyInvite = document.getElementById('btnCopyInvite');
  if (btnCopyInvite) {
    btnCopyInvite.addEventListener('click', async () => {
      const code = DnD.session?.inviteCode();
      if (!code) return;
      try { await navigator.clipboard.writeText(code); DnD.toast(`Invite code ${code} copied`, 'ok'); }
      catch { prompt('Invite code', code); }
    });
  }

  const btnDmNote = document.getElementById('btnDmNote');
  if (btnDmNote) {
    btnDmNote.addEventListener('click', () => {
      const targets = document.getElementById('noteTargets');
      targets.innerHTML = '';
      for (const m of DnD.session?.members() || []) {
        if (m.role === 'dm') continue;
        const id = `nt_${m.userId}`;
        targets.insertAdjacentHTML('beforeend',
          `<label><input type="checkbox" id="${id}" value="${m.userId}" /> @${DnD.escape(m.username)}</label>`);
      }
      DnD.openModal('noteModal');
    });
  }

  const noteForm = document.getElementById('noteForm');
  if (noteForm) {
    noteForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(noteForm);
      const content = String(fd.get('content') || '').trim();
      if (!content) return;
      const sharedWith = Array.from(noteForm.querySelectorAll('#noteTargets input:checked')).map(c => Number(c.value));
      DnD.session?.dmNote(content, sharedWith);
      DnD.closeModal('noteModal');
      noteForm.reset();
    });
  }

  // Token modal — DM adds a token with optional image + owner assignment.
  const tokenForm = document.getElementById('tokenForm');
  if (tokenForm) {
    tokenForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = tokenForm.querySelector('[data-role=error]');
      err.textContent = '';
      const fd = new FormData(tokenForm);
      try {
        let imagePath = null;
        const imgFile = tokenForm.querySelector('[name=tokenImage]').files[0];
        if (imgFile) {
          const up = await DnD.api.uploads.file(imgFile, { campaignId: DnD.session?.campaignId(), purpose: 'token' });
          imagePath = up.path;
        }
        const ownerRaw = fd.get('ownerUserId');
        DnD.session?.addToken({
          label: fd.get('label'),
          kind: fd.get('kind'),
          color: fd.get('color'),
          ownerUserId: ownerRaw ? Number(ownerRaw) : null,
          imagePath
        });
        DnD.closeModal('tokenModal');
        tokenForm.reset();
      } catch (e2) {
        err.textContent = e2.message;
      }
    });
  }

  return { revealIfDm };
})();
