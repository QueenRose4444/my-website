/* ============================================================
 * arma_standalone.js — bootstrap for the token-only /arma page.
 *
 * Differences from the main UI's app.js:
 * - No Discord OAuth, no bot/guild picker. The token IS the scope.
 * - All API calls hit /api/v1/arma-token/... (token-scoped endpoints)
 *   instead of /api/v1/bots/{bot}/guilds/{gid}/arma-servers/{srv}/...
 * - Reuses arma.js render functions + arma_dialogs.js + util.js verbatim
 *   by overriding the api() function and the fetchXxxFromApi() loaders.
 * ============================================================ */

const TOKEN_KEY = "arma-management:token";

// Backend base — same Cloudflare-tunneled URL the main UI uses. Read from a
// small inline config if we ever want to override per-deploy; for now hard-coded.
const ARMA_BACKEND_URL = "https://discord-bot-settings.rosestuffs.org";

// `state` is referenced by some shared util code; create a minimal stub.
const state = {
  selectedBot: null,   // unused in token mode
  selectedGuild: null, // unused in token mode
  ready: false,
};

let _armaToken = null;

/* ---------- HTTP helper (token-aware) ---------- */
async function api(path, opts = {}) {
  // `path` always starts with "/bots/.../arma-servers/.../X" in the main UI.
  // Here we rewrite those to the token-scoped equivalents.
  const url = ARMA_BACKEND_URL + "/api/v1" + _rewritePathForToken(path);
  const isFormData = typeof FormData !== "undefined" && opts.body instanceof FormData;
  const headers = {
    ...(isFormData ? {} : { "Content-Type": "application/json" }),
    "X-Arma-Token": _armaToken || "",
    ...(opts.headers || {}),
  };
  const res = await fetch(url, { ...opts, headers });
  if (res.status === 401 || res.status === 403) {
    // Token rejected — show the gate again.
    localStorage.removeItem(TOKEN_KEY);
    location.reload();
    throw new Error("Token invalid or revoked");
  }
  const txt = await res.text();
  let data = null;
  try { data = txt ? JSON.parse(txt) : null; } catch { /* non-JSON */ }
  if (!res.ok) {
    const msg = (data && (data.detail || data.error)) || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

// Rewrite /bots/{bot}/guilds/{gid}/arma-servers/{srv}/SUFFIX → /arma-token/SUFFIX
function _rewritePathForToken(path) {
  const m = path.match(/^\/bots\/[^/]+\/guilds\/[^/]+\/arma-servers\/[^/]+(\/.*)?$/);
  if (m) return "/arma-token" + (m[1] || "");
  // Also handle /bots/{bot}/guilds/{gid}/modlists*
  const m2 = path.match(/^\/bots\/[^/]+\/guilds\/[^/]+(\/modlists.*)$/);
  if (m2) return "/arma-token" + m2[1];
  // Fallthrough — try as-is (in case a handler builds a token-native URL).
  return path;
}

/* ---------- Loader overrides ---------- */
// arma_api.js (which lives in main UI's /js/) is NOT loaded here. We
// re-implement the loaders inline against the token endpoints.
async function fetchArmaServerLiveState() {
  try {
    const data = await api("/arma-token/state");
    const srv = data.server || {};
    const ls = srv.last_state || {};
    const PRETTY = { running: ["online","running","🟢"], starting: ["loading","starting","🟡"],
      stopping: ["loading","stopping","🟠"], installing: ["installing","installing","🟣"],
      offline: ["offline","offline","🔴"], unknown: ["unknown","unknown","⚪"] };
    const [label, badge, emoji] = PRETTY[ls.state || "unknown"] || PRETTY.unknown;
    armaState._armaServerId = srv.id;
    armaState.server = {
      power: ls.state || "unknown", label, badge, emoji,
      server_name: ls.name || srv.display_name || "Arma 3",
      map: ls.map_name || null,
      mission_pretty: ls.current_mission || null,
      mission_pbo: ls.current_mission ? `${ls.current_mission}.pbo` : null,
      players: ls.player_count != null ? ls.player_count : null,
      players_max: ls.player_max != null ? ls.player_max : null,
      uptime_ms: ls.uptime_ms != null ? ls.uptime_ms : null,
      a2s_error: ls.a2s_error || null,
      active_modlist_id: armaState.server ? armaState.server.active_modlist_id : null,
      active_loadout_id: null, active_event_id: null,
      drift: false, drift_expected_pbo: null,
    };
  } catch (e) { /* logged via toast on caller side */ }
}

async function fetchModlistsFromApi() {
  armaState.events = [];
  const data = await api("/arma-token/modlists");
  const activeId = data.active_modlist_id ? Number(data.active_modlist_id) : null;
  armaState.modlists = (data.modlists || []).map((m) => ({
    id: m.id, name: m.name, description: m.description || "",
    html_bytes: m.html_bytes, source: m.source, source_ref: m.source_ref,
    updated_at: m.updated_at, archived_at: m.archived_at, _is_active: !!m.is_active,
  }));
  armaState.activeModlistId = activeId;
  if (armaState.server) armaState.server.active_modlist_id = activeId;
}

async function fetchLoadoutsFromApi() {
  const data = await api("/arma-token/loadouts");
  armaState.loadouts = (data.loadouts || []).map((l) => ({
    id: l.id, name: l.name, description: l.description || "",
    mission_pbo: l.mission_pbo, modlist_id: l.modlist_id,
    is_default: !!l.is_default, last_run: l.last_applied_at, archived: !!l.archived_at,
  }));
}

async function fetchInstalledMissionsForLibrary() {
  try {
    const data = await api("/arma-token/missions-installed");
    armaState.installedMissions = data.missions || [];
  } catch { armaState.installedMissions = []; }
}

async function fetchEventsFromApi() {
  try {
    const [evRes, actRes] = await Promise.all([
      api("/arma-token/events?state=all&limit=50"),
      api("/arma-token/event-actions?limit=200"),
    ]);
    const events = evRes.events || [];
    const allActions = actRes.actions || [];
    const byEvent = {};
    for (const a of allActions) {
      if (a.event_id == null) continue;
      (byEvent[a.event_id] = byEvent[a.event_id] || []).push({
        t: a.action, at: a.taken_at,
        text: _humanizeAction(a),
        payload: a.payload ? JSON.stringify(a.payload, null, 2) : "",
      });
    }
    armaState.events = events.map((ev) => ({
      id: ev.id, loadout_id: ev.loadout_id, started_at: ev.started_at,
      last_active_at: ev.last_active_at, ended_at: ev.ended_at,
      ended_reason: ev.ended_reason, notes: ev.notes || "",
      actions: (byEvent[ev.id] || []).reverse(),
    }));
    // pause concept deprecated 2026-06 — see plan/so-we-need-to-zesty-sunbeam.
    const live = events.find((e) => !e.ended_at);
    if (armaState.server) {
      armaState.server.active_event_id = live ? live.id : null;
      armaState.server.active_loadout_id = live ? live.loadout_id : null;
    }
  } catch { armaState.events = []; }
}

function _humanizeAction(a) {
  const p = a.payload || {};
  if (a.action === "apply_config")   return `Applied loadout (config only)${p.modlist_name ? ` — pushed ${p.modlist_name}` : ""}`;
  if (a.action === "apply_restart")  return `Applied loadout (restart)${p.modlist_name ? ` — pushed ${p.modlist_name}` : ""}`;
  if (a.action === "apply_reapply")  return `Re-applied loadout${p.modlist_name ? ` — ${p.modlist_name}` : ""}`;
  if (a.action === "end")            return `Event ended — reason: ${p.reason || "unknown"}`;
  if (a.action === "drift_detected") return `Drift — running ${p.current_mission_name || p.current_pbo} (expected ${p.expected_pbo})`;
  if (a.action === "drift_cleared")  return `Drift cleared`;
  // pause/resume deprecated 2026-06; humanizer kept for old action rows.
  if (a.action === "save_pause")     return `Event paused — snapshot saved (deprecated)`;
  if (a.action === "resume")         return `Event resumed (deprecated)`;
  return a.action;
}

/* ---------- arma_api.js function shims (used by arma.js + arma_dialogs.js) ---------- */
async function apiCreateLoadout(payload) {
  return api(`/arma-token/loadouts`, { method: "POST", body: JSON.stringify(payload) });
}
async function apiPatchLoadout(id, payload) {
  return api(`/arma-token/loadouts/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
}
async function apiArchiveLoadout(id) {
  return api(`/arma-token/loadouts/${id}`, { method: "DELETE" });
}
async function apiApplyLoadout(id, restartAfter) {
  return api(`/arma-token/loadouts/${id}/apply`,
    { method: "POST", body: JSON.stringify({ restart_after: !!restartAfter }) });
}
async function apiListInstalledMissions() {
  const data = await api("/arma-token/missions-installed");
  return data.missions || [];
}
async function apiUploadMissionPbo(file, filename, restartAfter) {
  const fd = new FormData();
  fd.append("file", file, file.name);
  if (filename) fd.append("filename", filename);
  fd.append("restart_after", String(!!restartAfter));
  return api("/arma-token/upload-mission", { method: "POST", body: fd });
}
async function apiDeleteInstalledMission(filename) {
  return api("/arma-token/missions-installed/delete",
    { method: "POST", body: JSON.stringify({ names: [filename] }) });
}
async function apiCreateModlistFromFile(file, name, description, setActiveAfter) {
  const fd = new FormData();
  fd.append("file", file, file.name);
  fd.append("name", name);
  if (description) fd.append("description", description);
  const res = await api("/arma-token/modlists/upload", { method: "POST", body: fd });
  if (setActiveAfter && res && res.id) {
    await api(`/arma-token/modlists/${res.id}/set-active`, { method: "POST" });
  }
  return res;
}
async function apiReplaceModlistHtml(/* not supported via token yet */) {
  throw new Error("Modlist replace not yet available via access token. Ask the admin.");
}
async function apiRenameModlist(/* not supported via token yet */) {
  throw new Error("Modlist rename not yet available via access token. Ask the admin.");
}
async function apiSetActiveModlist(id) {
  return api(`/arma-token/modlists/${id}/set-active`, { method: "POST" });
}
async function apiArchiveModlist(id) {
  return api(`/arma-token/modlists/${id}`, { method: "DELETE" });
}
async function apiGetModlistDetail(id) {
  return api(`/arma-token/modlists/${id}`);
}
async function apiEndEvent(eventId, reason, notes) {
  return api(`/arma-token/events/${eventId}/end`,
    { method: "POST", body: JSON.stringify({ reason, notes }) });
}
// Tokens UI / pause / resume not exposed on the standalone page.
async function apiListArmaTokens() { return { tokens: [] }; }
async function renderArmaTokensTable() { /* no-op in standalone */ }

/* ---------- Boot ---------- */
async function tryToken(token) {
  _armaToken = token;
  // Hit /whoami; if it errors we'll fall back to the gate.
  return api("/arma-token/whoami");
}

async function boot() {
  const stored = (() => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } })();
  if (stored) {
    try {
      const me = await tryToken(stored);
      localStorage.setItem(TOKEN_KEY, stored);
      await showMain(me);
      return;
    } catch (e) {
      console.warn("Stored token rejected:", e.message);
    }
  }
  showGate();
}

function showGate() {
  $("tokenGate").hidden = false;
  $("mainShell").hidden = true;
  $("tokenSubmit").addEventListener("click", async () => {
    const v = $("tokenInput").value.trim();
    if (!v) { $("tokenError").textContent = "Paste your token"; return; }
    $("tokenError").textContent = "";
    try {
      const me = await tryToken(v);
      localStorage.setItem(TOKEN_KEY, v);
      $("tokenGate").hidden = true;
      await showMain(me);
    } catch (e) {
      $("tokenError").textContent = e.message || "Token rejected";
    }
  });
  $("tokenInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("tokenSubmit").click();
  });
}

async function showMain(me) {
  $("mainShell").hidden = false;
  $("serverNameSpan").textContent = "· " + (me.server_display_name || `Server #${me.arma_server_id}`);
  armaState._armaServerId = me.arma_server_id;
  // Collapsibles (mirror app.js bindCollapsible).
  for (const [card, toggle, body] of [
    ["missionsLibraryCard", "missionsLibraryToggle", "missionsLibraryBody"],
    ["modlistLibraryCard", "modlistLibraryToggle", "modlistLibraryBody"],
    ["eventTimelineCard", "eventTimelineToggle", "eventTimelineBody"],
  ]) {
    const c = $(card), t = $(toggle), b = $(body);
    if (!c || !t || !b) continue;
    t.addEventListener("click", () => {
      const open = !c.classList.contains("open");
      c.classList.toggle("open", open); b.hidden = !open;
    });
  }
  $("newLoadoutBtn").addEventListener("click", () => openNewLoadoutDialog());
  $("newModlistBtn").addEventListener("click", () => openNewModlist());
  $("uploadMissionPboBtn").addEventListener("click", () => openMissionPboUploadDialog());
  $("refreshMissionsListBtn").addEventListener("click", async () => {
    await fetchInstalledMissionsForLibrary(); renderArma();
  });
  $("logoutBtn").addEventListener("click", () => {
    if (!confirm("Forget the access token from this browser?")) return;
    localStorage.removeItem(TOKEN_KEY);
    location.reload();
  });
  $("showArchivedToggle").addEventListener("change", () => renderLoadoutGrid());
  // Initial load + render.
  await refreshAll();
  // Poll the live state every 30s so the strip stays fresh.
  setInterval(() => fetchArmaServerLiveState().then(() => renderStrip()).catch(() => {}), 30000);
}

async function refreshAll() {
  try {
    await fetchArmaServerLiveState();
    await fetchModlistsFromApi();
    await fetchLoadoutsFromApi();
    await fetchInstalledMissionsForLibrary();
    await fetchEventsFromApi();
  } catch (e) {
    toast(`Couldn't load: ${e.message || e}`, "error");
  }
  renderArma();
}

document.addEventListener("DOMContentLoaded", boot);
