window.DnD = window.DnD || {};

// Socket.IO client wrapper. Owns the connection, presence, and event dispatch.
// All emits return promises so the session layer can await acks.
DnD.lobby = (() => {
  let socket = null;
  let lastJoinArgs = null;    // remembered so we can re-join a room after a reconnect
  let hadConnected = false;   // distinguish initial connect from a reconnect

  function connect() {
    if (socket) return socket;
    socket = io(window.DND_CONFIG.realtimeBaseUrl, {
      auth: { token: window.authManager.authToken },
      transports: ['websocket', 'polling'],
      reconnection: true
    });

    socket.on('connect', () => {
      setConn('ok', 'connected');
      // Socket.IO drops room memberships across reconnects. Re-join and re-sync
      // state so we don't miss broadcasts (e.g. a map swap) that fired while
      // the tab was backgrounded / throttled.
      if (hadConnected && lastJoinArgs) {
        socket.emit('lobby:join', lastJoinArgs);
        DnD.session?.resyncAfterReconnect?.();
      }
      hadConnected = true;
    });
    socket.on('disconnect', () => setConn('bad', 'disconnected'));
    socket.on('connect_error', (e) => setConn('bad', e.message || 'error'));

    socket.on('presence:join', (p) => DnD.session?.onPresenceJoin(p));
    socket.on('presence:leave', (p) => DnD.session?.onPresenceLeave(p));
    socket.on('chat:new', (m) => DnD.session?.onChat(m));
    socket.on('character:public-update', (p) => DnD.session?.onCharacterPublic(p));
    socket.on('character:full-update', (p) => DnD.session?.onCharacterFull(p));
    socket.on('map:image', (p) => DnD.map?.setImage(p.imagePath));
    socket.on('map:token-added', (p) => DnD.map?.renderToken(p.token));
    socket.on('map:token-moved', (p) => DnD.map?.moveTokenLocal(p.tokenId, p.x, p.y));
    socket.on('map:token-removed', (p) => DnD.map?.removeTokenLocal(p.tokenId));

    return socket;
  }

  function setConn(kind, text) {
    const el = document.getElementById('connChip');
    if (!el) return;
    el.textContent = text;
    el.classList.remove('ok', 'bad');
    if (kind) el.classList.add(kind);
  }

  function emit(event, payload) {
    if (event === 'lobby:join') lastJoinArgs = payload;
    return new Promise((resolve) => {
      if (!socket) return resolve({ error: 'no socket' });
      socket.emit(event, payload, (ack) => resolve(ack || { ok: true }));
    });
  }

  function disconnect() {
    socket?.disconnect();
    socket = null;
  }

  return { connect, emit, disconnect, get socket() { return socket; } };
})();
