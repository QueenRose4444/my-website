// Central config for the D&D platform. The auth backend is the shared CF worker;
// the realtime/D&D backend is a Node server on the laptop, exposed via cloudflared.
window.DND_CONFIG = Object.freeze({
  appName: 'dnd-app',
  environment: 'wip', // 'wip' | 'live' — matches AuthManager env
  realtimeBaseUrl: 'https://dnd-backend.rosestuffs.org'
});

// A single shared AuthManager for every DnD page — tokens sync across tabs automatically.
window.authManager = new AuthManager(window.DND_CONFIG.appName, window.DND_CONFIG.environment);
