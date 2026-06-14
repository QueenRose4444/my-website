/* ============================================================
 * api.js — auth/config bootstrap, OAuth, fetch helper
 * ============================================================ */

async function bootstrapAuthConfig() {
  if (DEMO) { CONFIG.DISCORD_CLIENT_ID = "demo-client-id"; return; }
  try {
    const res = await fetch(`${CONFIG.API_BASE}/auth/config`);
    if (!res.ok) throw new Error(`auth/config: ${res.status}`);
    CONFIG.DISCORD_CLIENT_ID = (await res.json()).client_id;
  } catch (e) {
    toast(`Backend unreachable: ${e.message}`, "error");
  }
}

/* ---------------- OAuth ---------------- */
async function startOAuth() {
  if (DEMO) { await demoLogin(); return; }
  if (!CONFIG.DISCORD_CLIENT_ID) await bootstrapAuthConfig();
  if (!CONFIG.DISCORD_CLIENT_ID) { toast("Can't reach the backend — check it's running.", "error"); return; }
  const url = new URL("https://discord.com/api/oauth2/authorize");
  url.searchParams.set("client_id", CONFIG.DISCORD_CLIENT_ID);
  url.searchParams.set("redirect_uri", CONFIG.REDIRECT_URI);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "identify guilds");
  url.searchParams.set("prompt", "none");
  window.location.href = url.toString();
}

async function demoLogin() {
  const data = await demoFetch("/auth/discord", { method: "POST", body: "{}" });
  state.user = data;
  try { localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(data)); } catch {}
  toast("Signed in (demo mode)", "ok");
  await loadMyContext();
}

async function handleOAuthCallback() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  if (!code) return;
  const cleanUrl = window.location.origin + window.location.pathname;
  window.history.replaceState({}, "", cleanUrl);
  try {
    const res = await fetch(`${CONFIG.API_BASE}/auth/discord`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, redirect_uri: CONFIG.REDIRECT_URI }),
    });
    if (!res.ok) throw new Error(`Login failed: ${res.status}`);
    const data = await res.json();
    state.user = data;
    try { localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(data)); } catch {}
    toast("Logged in", "ok");
    await loadMyContext();
  } catch (e) {
    toast(e.message || "Login error", "error");
  }
}

const UI_STATE_KEY = "discord-bot-settings:ui-state";

function hydrateFromStorage() {
  try {
    const raw = localStorage.getItem(CONFIG.STORAGE_KEY);
    if (raw) state.user = JSON.parse(raw);
  } catch {}
  try {
    const raw = localStorage.getItem(UI_STATE_KEY);
    if (raw) {
      const ui = JSON.parse(raw);
      // Pre-seed picks so the dropdowns hydrate to them once data arrives.
      if (ui.selectedBot) state.selectedBot = ui.selectedBot;
      if (ui.selectedGuild) state.selectedGuild = ui.selectedGuild;
      if (ui.activeTab) state.activeTab = ui.activeTab;
    }
  } catch {}
}

function persistUIState() {
  try {
    localStorage.setItem(UI_STATE_KEY, JSON.stringify({
      selectedBot: state.selectedBot,
      selectedGuild: state.selectedGuild,
      activeTab: state.activeTab,
    }));
  } catch {}
}

function logout() {
  try { localStorage.removeItem(CONFIG.STORAGE_KEY); } catch {}
  try { localStorage.removeItem(UI_STATE_KEY); } catch {}
  state.user = null;
  state.bots = []; state.guilds = [];
  state.selectedBot = null; state.selectedGuild = null;
  state.ready = false;
  refreshUI();
}

/* ---------------- fetch helper ---------------- */
async function api(path, opts = {}) {
  if (!state.user) throw new Error("Not logged in");
  if (DEMO) return demoFetch(path, opts);

  // For multipart bodies the browser MUST set Content-Type itself (with the
  // boundary string) — omit our default JSON header so it does.
  const isFormData = typeof FormData !== "undefined" && opts.body instanceof FormData;
  const headers = {
    ...(isFormData ? {} : { "Content-Type": "application/json" }),
    "X-User-Id": state.user.user_id,
    "X-Tracker-Token": state.user.tracker_token,
    ...(opts.headers || {}),
  };
  const res = await fetch(`${CONFIG.API_BASE}${path}`, { ...opts, headers });
  if (res.status === 401) {
    const detail = await peekDetail(res);
    if (/session expired|cache expired/i.test(detail)) {
      toast("Session expired — please log in again.", "error");
      logout();
      throw new Error("Session expired");
    }
  }
  if (!res.ok) {
    let detail = res.statusText;
    try { detail = (await res.json()).detail || detail; } catch {}
    throw new Error(detail);
  }
  return res.json();
}

async function peekDetail(res) {
  try { const d = await res.clone().json(); return d.detail || ""; } catch { return ""; }
}

/* ---------------- bootstrap after login ---------------- */
async function loadMyContext() {
  try {
    const [bots, guilds] = await Promise.all([api("/bots"), api("/me/guilds")]);
    state.bots = bots.bots || [];
    state.guilds = guilds.guilds || [];
    if (state.bots.length && (!state.selectedBot || !state.bots.some((b) => b.name === state.selectedBot))) {
      state.selectedBot = state.bots[0].name;
    }
    renderBotPicker();
    renderGuildPicker();
    state.ready = true;
    refreshUI();
    // bug B: always (re)fire the active tab's loader once context is ready,
    // flushing any load requested while we were still booting.
    await loadActiveTab();
    state.pendingLoad = false;
  } catch (e) {
    state.ready = true;
    refreshUI();
    toast(e.message, "error");
  }
}
