window.DnD = window.DnD || {};

// Thin wrapper around fetchWithAuth so we can talk to BOTH backends:
//   - the CF auth worker (for auth-only endpoints, if ever needed here)
//   - the laptop realtime backend (for all D&D persistent + live data)
DnD.api = (() => {
  const base = window.DND_CONFIG.realtimeBaseUrl;

  async function req(method, path, body, opts = {}) {
    if (!window.authManager.isLoggedIn()) {
      throw new Error('Not logged in');
    }
    const url = base + path;
    const options = { method, headers: {} };
    if (body !== undefined) {
      options.body = JSON.stringify(body);
    }
    if (opts.signal) options.signal = opts.signal;

    const res = await window.authManager.fetchWithAuth(url, options);
    let data = null;
    try { data = await res.clone().json(); } catch { /* not JSON */ }
    if (!res.ok) {
      const msg = (data && (data.error || data.message)) || `${method} ${path} failed (${res.status})`;
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  // fetchWithAuth always sets Content-Type: application/json. For multipart we bypass it and
  // handle auth manually here, so uploads work.
  async function uploadFile(file, { campaignId = null, purpose = 'misc' } = {}) {
    const url = base + '/api/uploads';
    const fd = new FormData();
    fd.append('file', file);
    fd.append('purpose', purpose);
    if (campaignId) fd.append('campaignId', campaignId);

    if (window.authManager.isTokenExpired(window.authManager.authToken)) {
      await window.authManager.attemptRefreshToken();
    }
    let res = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${window.authManager.authToken}` },
      body: fd
    });
    if (res.status === 401) {
      const refreshed = await window.authManager.attemptRefreshToken();
      if (refreshed) {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${window.authManager.authToken}` },
          body: fd
        });
      }
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `upload failed (${res.status})`);
    return data;
  }

  return {
    campaigns: {
      list: () => req('GET', '/api/campaigns').then(r => r.campaigns),
      create: (body) => req('POST', '/api/campaigns', body).then(r => r.campaign),
      get:    (id) => req('GET', `/api/campaigns/${id}`),
      patch:  (id, body) => req('PATCH', `/api/campaigns/${id}`, body).then(r => r.campaign),
      join:   (body) => req('POST', '/api/campaigns/join', body).then(r => r.campaign),
      setCharacter: (id, characterId) => req('POST', `/api/campaigns/${id}/set-character`, { characterId }),
      messages: (id, limit = 200) => req('GET', `/api/campaigns/${id}/messages?limit=${limit}`).then(r => r.messages),
      map: (id) => req('GET', `/api/campaigns/${id}/map`),
      initiative: (id) => req('GET', `/api/campaigns/${id}/initiative`).then(r => r.state)
    },
    maps: {
      list:   (campaignId) => req('GET', `/api/campaigns/${campaignId}/maps`),
      create: (campaignId, body) => req('POST', `/api/campaigns/${campaignId}/maps`, body),
      patch:  (campaignId, mapId, body) => req('PATCH', `/api/campaigns/${campaignId}/maps/${mapId}`, body).then(r => r.map),
      remove: (campaignId, mapId) => req('DELETE', `/api/campaigns/${campaignId}/maps/${mapId}`),
      activate: (campaignId, mapId) => req('POST', `/api/campaigns/${campaignId}/maps/${mapId}/activate`)
    },
    encounters: {
      list:   (campaignId) => req('GET', `/api/campaigns/${campaignId}/encounter-images`).then(r => r.images),
      create: (campaignId, body) => req('POST', `/api/campaigns/${campaignId}/encounter-images`, body).then(r => r.image),
      remove: (campaignId, imgId) => req('DELETE', `/api/campaigns/${campaignId}/encounter-images/${imgId}`)
    },
    characters: {
      list: (campaignId) => req('GET', '/api/characters' + (campaignId ? `?campaignId=${campaignId}` : '')).then(r => r.characters),
      create: (body) => req('POST', '/api/characters', body).then(r => r.character),
      get:    (id) => req('GET', `/api/characters/${id}`),
      patch:  (id, body) => req('PATCH', `/api/characters/${id}`, body).then(r => r.character),
      remove: (id) => req('DELETE', `/api/characters/${id}`)
    },
    uploads: {
      file: uploadFile,
      url: (publicPath) => publicPath ? (base + publicPath) : null
    }
  };
})();
