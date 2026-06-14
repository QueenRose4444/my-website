/* ============================================================
 * arma_api.js — real-backend wrappers for the Arma Management tab.
 *
 * Replaces the in-browser mock data in arma_data.js for the entities
 * that have backend endpoints (currently: modlists only; loadouts +
 * events get wired here as later phases ship).
 *
 * The tab's render functions read from `armaState.modlists` etc, so
 * these wrappers fetch from the backend and replace those arrays
 * before any render happens.
 * ============================================================ */

/* ---------------- modlists ---------------- */

async function fetchModlistsFromApi() {
  if (!state.selectedBot || !state.selectedGuild) return;
  // Phase 2c will replace this with real event/state fetches.
  armaState.events = [];
  if (armaState.server) {
    armaState.server.active_event_id = null;
  }
  const data = await api(
    `/bots/${state.selectedBot}/guilds/${state.selectedGuild}/modlists`
  );
  // Adapt API shape → armaState shape used by renderModlistTable.
  // is_active is per-row from the API; we also keep armaState.activeModlistId
  // as a single id for the loadout grid + state strip to read.
  armaState.modlists = (data.modlists || []).map((m) => ({
    id: m.id,
    name: m.name,
    description: m.description || "",
    html_bytes: m.html_bytes,
    source: m.source,
    source_ref: m.source_ref,
    updated_at: m.updated_at,
    archived_at: m.archived_at,
    _is_active: !!m.is_active,
  }));
  const activeId = data.active_modlist_id ? Number(data.active_modlist_id) : null;
  armaState.activeModlistId = activeId;
  if (armaState.server) {
    // The state-strip reads server.active_modlist_id — keep it in sync.
    armaState.server.active_modlist_id = activeId;
  }
}

async function apiCreateModlistFromFile(file, name, description, setActiveAfter) {
  const fd = new FormData();
  fd.append("file", file, file.name);
  fd.append("name", name);
  if (description) fd.append("description", description);
  const res = await api(
    `/bots/${state.selectedBot}/guilds/${state.selectedGuild}/modlists/upload`,
    { method: "POST", body: fd },
  );
  if (setActiveAfter && res && res.id) {
    await apiSetActiveModlist(res.id);
  }
  return res;
}

async function apiReplaceModlistHtml(modlistId, file) {
  const fd = new FormData();
  fd.append("file", file, file.name);
  return api(
    `/bots/${state.selectedBot}/guilds/${state.selectedGuild}/modlists/${modlistId}/replace`,
    { method: "POST", body: fd },
  );
}

async function apiRenameModlist(modlistId, name) {
  return api(
    `/bots/${state.selectedBot}/guilds/${state.selectedGuild}/modlists/${modlistId}`,
    { method: "PATCH", body: JSON.stringify({ name }) },
  );
}

async function apiSetActiveModlist(modlistId) {
  return api(
    `/bots/${state.selectedBot}/guilds/${state.selectedGuild}/modlists/${modlistId}/set-active`,
    { method: "POST" },
  );
}

async function apiArchiveModlist(modlistId) {
  return api(
    `/bots/${state.selectedBot}/guilds/${state.selectedGuild}/modlists/${modlistId}`,
    { method: "DELETE" },
  );
}

async function apiGetModlistDetail(modlistId) {
  return api(
    `/bots/${state.selectedBot}/guilds/${state.selectedGuild}/modlists/${modlistId}`,
  );
}

/* ---------------- loadouts ---------------- */

// armaState.loadouts is read by renderLoadoutGrid and others. The loadout
// grid is scoped to one Arma server — we pick the first arma_server for the
// selected guild (mirrors how the Server status tab handles its single
// server today; multi-server UI is a v3 concern).
async function fetchLoadoutsFromApi() {
  if (!state.selectedBot || !state.selectedGuild) return;
  // Find the Arma server id for this guild. Cached on armaState for reuse.
  if (!armaState._armaServerId) {
    const data = await api(`/bots/${state.selectedBot}/guilds/${state.selectedGuild}/arma-servers`);
    const first = (data.servers || [])[0];
    if (!first || !first.id) {
      armaState.loadouts = [];
      return;
    }
    armaState._armaServerId = first.id;
  }
  const data = await api(
    `/bots/${state.selectedBot}/guilds/${state.selectedGuild}/arma-servers/${armaState._armaServerId}/loadouts`
  );
  armaState.loadouts = (data.loadouts || []).map((l) => ({
    id: l.id,
    name: l.name,
    description: l.description || "",
    mission_pbo: l.mission_pbo,
    modlist_id: l.modlist_id,
    is_default: !!l.is_default,
    last_run: l.last_applied_at,
    archived: !!l.archived_at,
    save_dir: l.save_dir || null,
    mission_params: l.mission_params || null,
    expected_a2s_name: l.expected_a2s_name || null,
  }));
}

async function apiCreateLoadout(payload) {
  return api(
    `/bots/${state.selectedBot}/guilds/${state.selectedGuild}/arma-servers/${armaState._armaServerId}/loadouts`,
    { method: "POST", body: JSON.stringify(payload) },
  );
}
async function apiPatchLoadout(loadoutId, payload) {
  return api(
    `/bots/${state.selectedBot}/guilds/${state.selectedGuild}/arma-servers/${armaState._armaServerId}/loadouts/${loadoutId}`,
    { method: "PATCH", body: JSON.stringify(payload) },
  );
}
async function apiArchiveLoadout(loadoutId) {
  return api(
    `/bots/${state.selectedBot}/guilds/${state.selectedGuild}/arma-servers/${armaState._armaServerId}/loadouts/${loadoutId}`,
    { method: "DELETE" },
  );
}
async function apiApplyLoadout(loadoutId, restartAfter) {
  return api(
    `/bots/${state.selectedBot}/guilds/${state.selectedGuild}/arma-servers/${armaState._armaServerId}/loadouts/${loadoutId}/apply`,
    { method: "POST", body: JSON.stringify({ restart_after: !!restartAfter }) },
  );
}
// DEPRECATED 2026-06 — Antistasi resumes natively from disk; save snapshot
// system retired. Endpoints still exist but return 410. Helpers commented
// out (not deleted) so the path back is short. See plan/so-we-need-to-zesty-sunbeam.
// async function apiListSnapshots(loadoutId) {
//   return api(`/bots/${state.selectedBot}/guilds/${state.selectedGuild}/arma-servers/${armaState._armaServerId}/loadouts/${loadoutId}/snapshots`);
// }
// async function apiCreateSnapshot(loadoutId, name, description) {
//   return api(
//     `/bots/${state.selectedBot}/guilds/${state.selectedGuild}/arma-servers/${armaState._armaServerId}/loadouts/${loadoutId}/snapshots`,
//     { method: "POST", body: JSON.stringify({ name, description: description || null }) },
//   );
// }
// async function apiRestoreSnapshot(loadoutId, snapshotId) {
//   return api(
//     `/bots/${state.selectedBot}/guilds/${state.selectedGuild}/arma-servers/${armaState._armaServerId}/loadouts/${loadoutId}/snapshots/${snapshotId}/restore`,
//     { method: "POST" },
//   );
// }
// async function apiDeleteSnapshot(loadoutId, snapshotId) {
//   return api(
//     `/bots/${state.selectedBot}/guilds/${state.selectedGuild}/arma-servers/${armaState._armaServerId}/loadouts/${loadoutId}/snapshots/${snapshotId}`,
//     { method: "DELETE" },
//   );
// }

// Pull the live server state (Pterodactyl + A2S) into armaState.server so the
// state strip can show real status/players/mission/uptime. We reuse the data
// the bot's poll loop persists into arma_servers.last_state_json, so this is
// just a DB read on the backend — no extra Pterodactyl/A2S round-trip.
async function fetchArmaServerLiveState() {
  if (!state.selectedBot || !state.selectedGuild) return;
  const data = await api(
    `/bots/${state.selectedBot}/guilds/${state.selectedGuild}/arma-servers`
  );
  const first = (data.servers || [])[0];
  if (!first) return;
  if (!armaState._armaServerId) armaState._armaServerId = first.id;
  // last_state is the parsed JSON (backend already scrubs the raw string field).
  const ls = first.last_state || {};
  // Map Pterodactyl/A2S state names into the strip's badge classes/labels.
  const PRETTY = { running: ["online","running","🟢"], starting: ["loading","starting","🟡"],
    stopping: ["loading","stopping","🟠"], installing: ["installing","installing","🟣"],
    offline: ["offline","offline","🔴"], unknown: ["unknown","unknown","⚪"] };
  const [label, badge, emoji] = PRETTY[ls.state || "unknown"] || PRETTY.unknown;
  armaState.server = {
    power: ls.state || "unknown",
    label, badge, emoji,
    server_name: ls.name || first.display_name || "Arma 3",
    map: ls.map_name || null,
    mission_pretty: ls.current_mission || null,
    mission_pbo: ls.current_mission ? `${ls.current_mission}.pbo` : null,
    players: ls.player_count != null ? ls.player_count : null,
    players_max: ls.player_max != null ? ls.player_max : null,
    uptime_ms: ls.uptime_ms != null ? ls.uptime_ms : null,
    last_polled_at: first.last_polled_at,
    a2s_error: ls.a2s_error || null,
    // Phase 2 (2026-06): live mod-install progress from the WS watcher.
    // Banner reads this directly. Null when no install is in flight.
    install_progress: first.install_progress || null,
    // Carry through the active-modlist + event ids previously set by other
    // fetchers (modlist + future events fetcher).
    active_modlist_id: armaState.server ? armaState.server.active_modlist_id : null,
    active_loadout_id: armaState.server ? armaState.server.active_loadout_id : null,
    active_event_id: armaState.server ? armaState.server.active_event_id : null,
    drift: false,
    drift_expected_pbo: null,
  };
}

/* ---------------- events + drift ---------------- */

// Fetch events (live + recent paused/ended) + the server-scoped action log
// (powers the event timeline). Populates armaState.events in the shape arma.js
// already expects (id, loadout_id, started_at, paused_at, ended_at, actions[]).
async function fetchEventsFromApi() {
  if (!state.selectedBot || !state.selectedGuild || !armaState._armaServerId) return;
  const base = `/bots/${state.selectedBot}/guilds/${state.selectedGuild}/arma-servers/${armaState._armaServerId}`;
  let events, allActions;
  try {
    const [evRes, actRes] = await Promise.all([
      api(`${base}/events?state=all&limit=50`),
      api(`${base}/event-actions?limit=200`),
    ]);
    events = evRes.events || [];
    allActions = actRes.actions || [];
  } catch (e) {
    armaState.events = [];
    return;
  }
  // Group actions by event_id; attach to each event row.
  const byEvent = {};
  for (const a of allActions) {
    if (a.event_id == null) continue;
    (byEvent[a.event_id] = byEvent[a.event_id] || []).push({
      t: a.action.replace(/^apply_/, "swap").replace(/_/g, " "),
      at: a.taken_at,
      text: _humanizeAction(a),
      payload: a.payload ? JSON.stringify(a.payload, null, 2) : "",
    });
  }
  armaState.events = events.map((ev) => ({
    id: ev.id,
    loadout_id: ev.loadout_id,
    started_at: ev.started_at,
    last_active_at: ev.last_active_at,
    ended_at: ev.ended_at,
    ended_reason: ev.ended_reason,
    notes: ev.notes || "",
    actions: (byEvent[ev.id] || []).reverse(), // oldest action first inside an event card
  }));
  // Surface the live event on the server snapshot. (paused_at field
  // deprecated 2026-06 but old data may still have it set — treat as live.)
  const live = events.find((e) => !e.ended_at);
  if (armaState.server) {
    armaState.server.active_event_id = live ? live.id : null;
    armaState.server.active_loadout_id = live ? live.loadout_id : null;
  }
  // Drift detection: if any drift_detected action is more recent than the
  // last drift_cleared for the live event, flag the strip.
  if (live && armaState.server) {
    const evActs = (allActions || []).filter((a) => a.event_id === live.id);
    let mostRecent = null;
    for (const a of evActs) {
      if (a.action === "drift_detected" || a.action === "drift_cleared") {
        if (!mostRecent || new Date(a.taken_at) > new Date(mostRecent.taken_at)) {
          mostRecent = a;
        }
      }
    }
    if (mostRecent && mostRecent.action === "drift_detected") {
      armaState.server.drift = true;
      const p = mostRecent.payload || {};
      armaState.server.drift_expected_pbo = p.expected_pbo || null;
      armaState.server.drift_actual_mission = p.current_mission || null;
      armaState.server.drift_reason = p.reason || null;
      armaState.server.drift_mission_match = p.mission_match !== false;
      armaState.server.drift_modlist_match = p.modlist_match !== false;
    }
  }
}

function _humanizeAction(a) {
  const p = a.payload || {};
  if (a.action === "apply_config")  return `Applied loadout (config only)${p.modlist_name ? ` — pushed ${p.modlist_name}` : ""}`;
  if (a.action === "apply_restart") return `Applied loadout (restart)${p.modlist_name ? ` — pushed ${p.modlist_name}` : ""}`;
  if (a.action === "apply_reapply") return `Re-applied loadout${p.modlist_name ? ` — ${p.modlist_name}` : ""}`;
  if (a.action === "end")           return `Event ended — reason: ${p.reason || "unknown"}`;
  if (a.action === "drift_detected") return p.reason ? `Drift detected — ${p.reason}` : `Drift detected — running ${p.current_mission || p.current_mission_name} (expected ${p.expected_pbo})`;
  if (a.action === "drift_cleared")  return `Drift cleared — back on expected mission`;
  // pause/resume/save actions deprecated 2026-06 — kept here in case
  // pre-existing rows are still in the DB so the timeline doesn't show raw codes.
  if (a.action === "save_pause")     return `Event paused — snapshot saved (deprecated)`;
  if (a.action === "resume")         return `Event resumed (deprecated)`;
  return a.action;
}

async function apiEndEvent(eventId, reason = "manual", notes) {
  return api(
    `/bots/${state.selectedBot}/guilds/${state.selectedGuild}/arma-servers/${armaState._armaServerId}/events/${eventId}/end`,
    { method: "POST", body: JSON.stringify({ reason, notes }) },
  );
}

// Installed mission PBOs (for the loadout form's mission_pbo picker).
async function apiListInstalledMissions() {
  if (!armaState._armaServerId) return [];
  const data = await api(
    `/bots/${state.selectedBot}/guilds/${state.selectedGuild}/arma-servers/${armaState._armaServerId}/missions-installed`
  );
  return data.missions || [];
}

// Cached for the Installed missions table on the Arma Management tab.
async function fetchInstalledMissionsForLibrary() {
  armaState.installedMissions = await apiListInstalledMissions().catch(() => []);
}

async function apiUploadMissionPbo(file, filename, restartAfter) {
  if (!armaState._armaServerId) throw new Error("No Arma server configured");
  const fd = new FormData();
  fd.append("file", file, file.name);
  if (filename) fd.append("filename", filename);
  fd.append("restart_after", String(!!restartAfter));
  return api(
    `/bots/${state.selectedBot}/guilds/${state.selectedGuild}/arma-servers/${armaState._armaServerId}/upload-mission`,
    { method: "POST", body: fd },
  );
}

async function apiDeleteInstalledMission(filename) {
  if (!armaState._armaServerId) throw new Error("No Arma server configured");
  return api(
    `/bots/${state.selectedBot}/guilds/${state.selectedGuild}/arma-servers/${armaState._armaServerId}/missions-installed/delete`,
    { method: "POST", body: JSON.stringify({ names: [filename] }) },
  );
}

/* ---------------- v2e loadout draft suggestions ---------------- */
async function fetchLoadoutDrafts() {
  if (!state.selectedBot || !state.selectedGuild) return [];
  try {
    const data = await api(`/bots/${state.selectedBot}/guilds/${state.selectedGuild}/loadout-drafts`);
    return data.drafts || [];
  } catch { return []; }
}

async function apiDismissDraft(actionId) {
  return api(
    `/bots/${state.selectedBot}/guilds/${state.selectedGuild}/loadout-drafts/dismiss`,
    { method: "POST", body: JSON.stringify({ action_id: actionId }) },
  );
}

/* ---------------- v2f arma access tokens ---------------- */
async function apiListArmaTokens() {
  return api(`/bots/${state.selectedBot}/guilds/${state.selectedGuild}/arma-tokens`);
}
async function apiCreateArmaToken(name, armaServerId, expiresAt) {
  return api(
    `/bots/${state.selectedBot}/guilds/${state.selectedGuild}/arma-tokens`,
    { method: "POST", body: JSON.stringify({ name, arma_server_id: armaServerId, expires_at: expiresAt || null }) },
  );
}
async function apiRevokeArmaToken(tokenId) {
  return api(
    `/bots/${state.selectedBot}/guilds/${state.selectedGuild}/arma-tokens/${tokenId}`,
    { method: "DELETE" },
  );
}
