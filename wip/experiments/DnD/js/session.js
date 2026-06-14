(async function () {
  const $ = DnD.$;
  const campaignId = DnD.getQuery('c');
  if (!campaignId) { location.href = 'index.html'; return; }

  await window.authManager.initialize();
  if (!window.authManager.isLoggedIn()) { location.href = 'index.html'; return; }

  let state = {
    campaign: null,
    members: [],
    presence: new Set(),
    myRole: 'player',
    myCharacter: null,
    charsByUserId: new Map() // DM view: cache of each player's character
  };

  $('#userChip').textContent = `@${window.authManager.currentUser.username}`;

  // Load campaign details.
  let campResp;
  try {
    campResp = await DnD.api.campaigns.get(campaignId);
  } catch (e) {
    DnD.toast(e.message, 'err');
    setTimeout(() => location.href = 'index.html', 1500);
    return;
  }
  state.campaign = campResp.campaign;
  state.members = campResp.members;
  state.myRole = campResp.campaign.role;

  $('#campaignBadge').textContent = state.campaign.name;
  $('#roleBadge').textContent = state.myRole === 'dm' ? 'DM' : 'Player';
  DnD.dmPanel.revealIfDm(state.myRole === 'dm');

  // Load my bound character (if any) or pick one / create one.
  await loadMyCharacter();
  renderParty();
  populateTokenOwners();
  populateChatTargets();

  // Load recent history + map.
  try {
    const [msgs, mapState] = await Promise.all([
      DnD.api.campaigns.messages(campaignId, 200),
      DnD.api.campaigns.map(campaignId)
    ]);
    msgs.forEach(m => DnD.chat.push(m));
    DnD.map.applyState(mapState);
  } catch (e) {
    DnD.toast(`Load partial: ${e.message}`, 'err');
  }

  // Connect realtime.
  DnD.lobby.connect();
  const joinAck = await DnD.lobby.emit('lobby:join', { campaignId });
  if (joinAck.error) DnD.toast(joinAck.error, 'err');
  const presAck = await DnD.lobby.emit('presence:list', { campaignId });
  if (presAck.present) presAck.present.forEach(p => state.presence.add(p.userId));
  renderParty();

  // Self in presence.
  state.presence.add(window.authManager.currentUser.userId);

  $('#btnLeave').addEventListener('click', () => {
    DnD.lobby.disconnect();
    location.href = 'index.html';
  });

  // ---------- Character picking / binding ----------
  async function loadMyCharacter() {
    if (state.myRole === 'dm') {
      DnD.sheet.render(null);
      return;
    }
    const me = state.members.find(m => m.userId === window.authManager.currentUser.userId);
    if (me?.characterId) {
      try {
        const { character } = await DnD.api.characters.get(me.characterId);
        state.myCharacter = character;
        DnD.sheet.render(character);
        $('#editCharLink').href = `character.html?id=${character.id}`;
        return;
      } catch (_) { /* character gone or forbidden */ }
    }
    // No character yet — let the user pick from library or create one.
    const library = await DnD.api.characters.list();
    if (!library.length) {
      DnD.sheet.render(null);
      DnD.toast('Create a character first', 'err');
      setTimeout(() => location.href = `character.html?campaign=${campaignId}`, 1200);
      return;
    }
    // Simple pick: grab most-recent, bind it. The user can rebind later by editing on /character.
    const pick = library[0];
    await DnD.api.campaigns.setCharacter(campaignId, pick.id);
    // Re-bind in campaignResp members locally.
    const meMember = state.members.find(m => m.userId === window.authManager.currentUser.userId);
    if (meMember) meMember.characterId = pick.id;
    state.myCharacter = pick;
    DnD.sheet.render(pick);
    $('#editCharLink').href = `character.html?id=${pick.id}`;
  }

  // ---------- Rendering helpers ----------
  function dmStatsHtml(d) {
    const mods = DnD.RULES_5E.abilities.map(a =>
      `<span><small>${a.id.toUpperCase()}</small> ${DnD.ability.fmt(d[a.id] ?? 10)}</span>`
    ).join('');
    return `
      <div class="party-stats">
        <span class="hp">HP ${d.hp ?? 0}/${d.maxHp ?? 0}${d.tempHp ? ` +${d.tempHp}` : ''}</span>
        <span>AC ${d.ac ?? 10}</span>
        <span>Spd ${d.speed ?? 30}</span>
      </div>
      <div class="party-mods">${mods}</div>
    `;
  }

  function renderParty() {
    const list = $('#partyList');
    list.innerHTML = '';
    const entries = [];
    entries.push({
      userId: state.campaign.dmUserId,
      username: state.campaign.dmUsername,
      role: 'dm',
      characterId: null
    });
    for (const m of state.members) entries.push(m);
    for (const e of entries) {
      const online = state.presence.has(e.userId);
      const li = document.createElement('li');
      li.className = 'party-member ' + (online ? '' : 'offline') + ' ' + (e.role === 'dm' ? 'dm' : '');
      li.dataset.uid = String(e.userId);
      const label = e.username + (e.role === 'dm' ? ' · DM' : '');
      let dmStats = '';
      if (e.characterId && state.myRole === 'dm') {
        const cached = state.charsByUserId.get(e.userId);
        const charName = cached?.data?.name ? ` as ${DnD.escape(cached.data.name)}` : '';
        dmStats = `
          <div class="party-dmview" data-uid="${e.userId}">
            <small>${charName || 'loading…'}</small>
            ${cached ? dmStatsHtml(cached.data || {}) : ''}
          </div>
        `;
      }
      li.innerHTML = `
        <div class="party-row">
          <span class="party-avatar">${DnD.escape((e.username || '?').slice(0,1).toUpperCase())}</span>
          <div class="party-name">${DnD.escape(label)}<small>${e.characterId ? 'has character' : (e.role === 'dm' ? 'running the game' : 'no character')}</small></div>
        </div>
        ${dmStats}
      `;
      list.appendChild(li);
    }
    // DM convenience: fetch each player's character data once, then live-update from socket events.
    if (state.myRole === 'dm') {
      for (const m of state.members) {
        if (!m.characterId || state.charsByUserId.has(m.userId)) continue;
        DnD.api.characters.get(m.characterId).then(({ character }) => {
          state.charsByUserId.set(m.userId, character);
          applyDmStatsFor(m.userId);
        }).catch(() => {});
      }
    }
  }

  function applyDmStatsFor(userId) {
    const char = state.charsByUserId.get(userId);
    if (!char) return;
    const host = document.querySelector(`.party-dmview[data-uid="${userId}"]`);
    if (!host) return;
    const nm = char.data?.name ? ` as ${DnD.escape(char.data.name)}` : '';
    host.innerHTML = `<small>${nm}</small>${dmStatsHtml(char.data || {})}`;
  }

  function populateTokenOwners() {
    const sel = document.querySelector('#tokenForm select[name=ownerUserId]');
    if (!sel) return;
    sel.innerHTML = '<option value="">— none —</option>';
    for (const m of state.members) {
      const opt = document.createElement('option');
      opt.value = String(m.userId);
      opt.textContent = `@${m.username}`;
      sel.appendChild(opt);
    }
  }

  function populateChatTargets() {
    const members = [...state.members];
    if (state.myRole !== 'dm') {
      members.unshift({ userId: state.campaign.dmUserId, username: state.campaign.dmUsername, role: 'dm' });
    }
    DnD.chat.setTargets(members);
  }

  // ---------- Session API (called by other modules) ----------
  DnD.session = {
    campaignId: () => campaignId,
    inviteCode: () => state.campaign?.inviteCode,
    isDm: () => state.myRole === 'dm',
    members: () => state.members,
    usernameFor(uid) {
      if (uid === state.campaign.dmUserId) return state.campaign.dmUsername;
      return state.members.find(m => m.userId === uid)?.username;
    },

    chat(content) { return DnD.lobby.emit('chat:send', { campaignId, content }); },
    whisper(targetUserId, content) { return DnD.lobby.emit('chat:whisper', { campaignId, targetUserId, content }); },
    dmNote(content, sharedWith) { return DnD.lobby.emit('dm:note', { campaignId, content, sharedWith }); },

    rollDice({ expression, label, advantage, disadvantage }) {
      return DnD.lobby.emit('dice:roll', { campaignId, expression, label, advantage, disadvantage });
    },
    manualRoll({ expression, total, label }) {
      return DnD.lobby.emit('dice:manual', { campaignId, expression, total, label });
    },

    setMapImage(path) { return DnD.lobby.emit('map:set-image', { campaignId, imagePath: path }); },
    openTokenModal() { DnD.openModal('tokenModal'); },
    addToken(token) { return DnD.lobby.emit('map:add-token', { campaignId, token }); },
    moveToken(tokenId, x, y) { return DnD.lobby.emit('map:move-token', { campaignId, tokenId, x, y }); },
    removeToken(tokenId) { return DnD.lobby.emit('map:remove-token', { campaignId, tokenId }); },

    updateCharacter(data) {
      const patch = { data };
      if (state.myCharacter) patch.characterId = state.myCharacter.id;
      return DnD.lobby.emit('character:update', { campaignId, patch });
    },

    // Socket dispatch targets (called by lobby.js)
    onPresenceJoin({ userId, username }) {
      state.presence.add(userId);
      if (!state.members.some(m => m.userId === userId) && userId !== state.campaign.dmUserId) {
        // A fresh join — pull campaign again to refresh member list.
        DnD.api.campaigns.get(campaignId).then(r => {
          state.members = r.members;
          renderParty();
          populateTokenOwners();
          populateChatTargets();
        }).catch(() => {});
      } else {
        renderParty();
      }
      DnD.toast(`@${username} joined`);
    },
    onPresenceLeave({ userId, username }) {
      state.presence.delete(userId);
      renderParty();
      if (username) DnD.toast(`@${username} left`);
    },
    onChat(msg) { DnD.chat.push(msg); },
    onCharacterPublic(pub) {
      DnD.sheet.applyPublicUpdate(pub);
      if (state.myRole === 'dm') {
        const member = state.members.find(m => m.characterId === pub.characterId);
        if (!member) return;
        const cached = state.charsByUserId.get(member.userId);
        if (cached && pub.data) {
          Object.assign(cached.data, pub.data);
          applyDmStatsFor(member.userId);
        }
      }
    },
    onCharacterFull(full) {
      if (state.myCharacter && state.myCharacter.id === full.characterId) {
        state.myCharacter.data = full.data;
        DnD.sheet.render(state.myCharacter);
      }
    },

    // Pull fresh map state after a reconnect so we catch anything the DM did
    // while we were disconnected (map swap, tokens added/removed).
    async resyncAfterReconnect() {
      try {
        const mapState = await DnD.api.campaigns.map(campaignId);
        DnD.map.applyState(mapState);
      } catch (_) { /* ignore transient errors */ }
    }
  };
})();
