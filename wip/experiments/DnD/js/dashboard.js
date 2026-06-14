(function () {
  const $ = DnD.$;
  const $$ = DnD.$$;

  const authModal = { el: $('#authModal') };
  const tabs = {
    login: { tab: $('.tab[data-tab=login]'), form: $('#loginForm') },
    register: { tab: $('.tab[data-tab=register]'), form: $('#registerForm') }
  };

  function showAuthTab(which) {
    Object.entries(tabs).forEach(([k, t]) => {
      t.tab.classList.toggle('active', k === which);
      t.form.classList.toggle('hidden', k !== which);
    });
  }

  $$('.tabs .tab').forEach(t => t.addEventListener('click', () => showAuthTab(t.dataset.tab)));

  function openAuth() {
    DnD.openModal('authModal');
    showAuthTab('login');
  }
  $('#btnLogin').addEventListener('click', openAuth);
  $('#btnHeroLogin').addEventListener('click', openAuth);

  $('#btnLogout').addEventListener('click', () => window.authManager.logout());

  tabs.login.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = tabs.login.form.querySelector('[data-role=error]');
    errEl.textContent = '';
    const fd = new FormData(e.target);
    try {
      await window.authManager.login(fd.get('username'), fd.get('password'));
      DnD.closeModal('authModal');
    } catch (err) {
      errEl.textContent = err.message;
    }
  });

  tabs.register.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = tabs.register.form.querySelector('[data-role=error]');
    errEl.textContent = '';
    const fd = new FormData(e.target);
    try {
      await window.authManager.register(fd.get('username'), fd.get('password'));
      await window.authManager.login(fd.get('username'), fd.get('password'));
      DnD.closeModal('authModal');
    } catch (err) {
      errEl.textContent = err.message;
    }
  });

  async function renderCampaigns() {
    const list = $('#campaignList');
    list.innerHTML = '<div class="empty">Loading…</div>';
    try {
      const campaigns = await DnD.api.campaigns.list();
      if (!campaigns.length) {
        list.innerHTML = `<div class="empty">No campaigns yet. Create one or join with an invite code.</div>`;
        return;
      }
      list.innerHTML = '';
      for (const c of campaigns) {
        const card = document.createElement('a');
        card.className = 'camp-card';
        card.href = `session.html?c=${encodeURIComponent(c.id)}`;
        card.innerHTML = `
          <div class="camp-head">
            <h3>${DnD.escape(c.name)}</h3>
            <span class="badge ${c.role === 'dm' ? 'accent' : ''}">${c.role === 'dm' ? 'DM' : 'Player'}</span>
          </div>
          <div class="desc">${DnD.escape(c.description || '')}</div>
          <div class="meta">
            <span>Invite: <code>${DnD.escape(c.inviteCode)}</code></span>
            <span>${c.ruleset === 'dnd5e' ? 'D&amp;D 5e' : DnD.escape(c.ruleset)}</span>
          </div>
        `;
        list.appendChild(card);
      }
    } catch (err) {
      list.innerHTML = `<div class="empty">Failed to load: ${DnD.escape(err.message)}</div>`;
    }
  }

  $('#btnCreate').addEventListener('click', () => DnD.openModal('createModal'));
  $('#createForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = e.target.querySelector('[data-role=error]');
    err.textContent = '';
    const fd = new FormData(e.target);
    try {
      const c = await DnD.api.campaigns.create({
        name: fd.get('name'),
        description: fd.get('description'),
        password: fd.get('password') || null
      });
      DnD.closeModal('createModal');
      DnD.toast('Campaign created', 'ok');
      location.href = `session.html?c=${encodeURIComponent(c.id)}`;
    } catch (e2) {
      err.textContent = e2.message;
    }
  });

  $('#btnJoin').addEventListener('click', () => DnD.openModal('joinModal'));
  $('#joinForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = e.target.querySelector('[data-role=error]');
    err.textContent = '';
    const fd = new FormData(e.target);
    try {
      const c = await DnD.api.campaigns.join({
        inviteCode: String(fd.get('inviteCode') || '').toUpperCase().trim(),
        password: fd.get('password') || null
      });
      DnD.closeModal('joinModal');
      DnD.toast('Joined', 'ok');
      location.href = `session.html?c=${encodeURIComponent(c.id)}`;
    } catch (e2) {
      err.textContent = e2.message;
    }
  });

  function applyAuthState() {
    const logged = window.authManager.isLoggedIn();
    $('#btnLogin').classList.toggle('hidden', logged);
    $('#btnLogout').classList.toggle('hidden', !logged);
    $('#userChip').classList.toggle('hidden', !logged);
    $('#signedOutHero').classList.toggle('hidden', logged);
    $('#dashboard').classList.toggle('hidden', !logged);
    if (logged) {
      $('#userChip').textContent = `@${window.authManager.currentUser?.username || ''}`;
      renderCampaigns();
    }
  }

  window.addEventListener('auth:login', applyAuthState);
  window.addEventListener('auth:logout', applyAuthState);
  window.addEventListener('auth:session-restored', applyAuthState);

  (async () => {
    await window.authManager.initialize();
    applyAuthState();
  })();
})();
