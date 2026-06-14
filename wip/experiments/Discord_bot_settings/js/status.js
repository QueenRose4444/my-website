/* ============================================================
 * status.js — Arma 3 server status monitor (Pterodactyl)
 * ============================================================ */

const STATE_META = {
  running:    { emoji: "🟢", label: "Online",     pretty: "online" },
  starting:   { emoji: "🟡", label: "Loading",    pretty: "loading" },
  stopping:   { emoji: "🟠", label: "Loading",    pretty: "loading" },
  installing: { emoji: "🟣", label: "Installing", pretty: "installing" },
  offline:    { emoji: "🔴", label: "Offline",    pretty: "offline" },
  unknown:    { emoji: "⚪", label: "Unknown",    pretty: "unknown" },
};

function stateMeta(s) { return STATE_META[s] || STATE_META.unknown; }

async function loadArmaServers() {
  if (!state.selectedBot || !state.selectedGuild) return;
  const base = `/bots/${state.selectedBot}/guilds/${state.selectedGuild}`;
  els.statusBody.hidden = true;
  els.statusEmpty.hidden = true;
  els.statusState.innerHTML = `<div class="skel" style="height:64px"></div>`;
  try {
    const data = await api(`${base}/arma-servers`);
    state.armaServer = (data.servers || [])[0] || null;

    // populate channel pickers (reuse the channels endpoint)
    const chans = await api(`${base}/channels`);
    const opts = `<option value="">(none)</option>` + chans.channels.map((c) =>
      `<option value="${c.id}">#${escapeHtml(c.name)}</option>`).join("");
    els.statusSummaryChannel.innerHTML = opts;
    els.statusDetailChannel.innerHTML = opts;

    if (state.armaServer) renderArmaServer(state.armaServer);
    else { els.statusEmpty.hidden = false; els.statusSaveBtn.hidden = true; }
  } catch (e) {
    els.statusEmpty.hidden = false;
    els.statusSaveBtn.hidden = true;
    toast(e.message, "error");
  }
}

function renderArmaServer(s) {
  els.statusEmpty.hidden = true;
  els.statusBody.hidden = false;
  els.statusSaveBtn.hidden = false;
  els.statusDeleteBtn.hidden = s.id == null;

  els.ptPanelUrl.value = s.ptero_panel_url || "";
  // redacted key: leave the password field empty, show a placeholder hint
  els.ptClientKey.value = "";
  els.ptClientKey.placeholder = s.ptero_client_key ? "•••••••• (set — leave blank to keep)" : "ptlc_…";
  els.ptServerId.value = s.ptero_server_identifier || "";
  els.ptDisplayName.value = s.display_name || "";
  els.ptPollInterval.value = s.poll_interval_sec || 60;
  // Channel pickers: try to select the saved ID. If the picker doesn't have
  // that option (because the dropdown is empty / Discord call failed), fall
  // back to showing the ID in the manual-input field.
  setChannelField(els.statusSummaryChannel, els.statusSummaryChannelManual, s.summary_channel_id);
  setChannelField(els.statusDetailChannel, els.statusDetailChannelManual, s.detail_channel_id);
  els.statusNameTemplate.value = s.summary_channel_template || "{state_emoji} {state} {player_count}/{player_max}";
  els.statusEnabled.checked = !!s.enabled;
  els.a2sEnabled.checked = !!s.a2s_enabled;
  els.a2sHost.value = s.a2s_host || "";
  els.a2sPort.value = s.a2s_port || 2303;
  els.statusTestResult.textContent = "";
  els.statusTestResult.className = "test-result";
  els.pushModlistResult.textContent = "";
  if (s.id != null) {
    els.missionsInstalledList.innerHTML = `<div class="muted">Loading…</div>`;
    loadInstalledMissions();
  } else {
    els.missionsInstalledList.innerHTML = `<div class="muted">Save the server config first.</div>`;
  }

  renderStatusState(s);
  renderNamePreview();
}

function renderStatusState(s) {
  const ls = s.last_state;
  els.statusPolledAt.textContent = s.last_polled_at ? `refreshed ${fmtRelative(s.last_polled_at)}` : "";
  if (!ls || !ls.state) {
    els.statusState.innerHTML = `<span class="status-no-poll">No poll data yet. Save the connection and the bot will report state on its next tick.</span>`;
    return;
  }
  const meta = stateMeta(ls.state);
  const rows = [];
  if (ls.error) {
    rows.push(`<span class="status-error"><i class="fas fa-triangle-exclamation"></i> ${escapeHtml(ls.error)}</span>`);
  }
  const res = [];
  // A2S fields first (most relevant to admins — who's on, what's running).
  if (ls.player_count != null || ls.player_max != null) {
    const pc = ls.player_count != null ? ls.player_count : "?";
    const pm = ls.player_max != null ? ls.player_max : "?";
    res.push(resPill("Players", `${pc}/${pm}`));
  }
  if (ls.current_mission) res.push(resPill("Mission", String(ls.current_mission)));
  if (ls.map_name) res.push(resPill("Map", String(ls.map_name)));
  if (typeof ls.cpu_pct === "number") res.push(resPill("CPU", `${ls.cpu_pct.toFixed(1)}%`));
  if (ls.memory_bytes != null) res.push(resPill("Memory", `${fmtBytes(ls.memory_bytes)}${ls.memory_limit_bytes ? " / " + fmtBytes(ls.memory_limit_bytes) : ""}`));
  if (ls.disk_bytes != null) res.push(resPill("Disk", fmtBytes(ls.disk_bytes)));
  if (ls.uptime_ms != null && ls.state === "running") res.push(resPill("Uptime", fmtUptime(ls.uptime_ms)));
  if (ls.a2s_error) {
    rows.push(`<span class="status-error"><i class="fas fa-triangle-exclamation"></i> A2S: ${escapeHtml(ls.a2s_error)}</span>`);
  }

  // Phase 2 (2026-06): mod install banner. Driven by the WS console watcher
  // via arma_servers.install_progress_json (real-time, faster than the 60s
  // poll loop). Banner shows while the egg is updating mods.
  const banner = renderInstallBanner(s.install_progress);

  els.statusState.innerHTML = `
    <span class="state-badge ${ls.state}"><span class="dot"></span>${meta.emoji} ${meta.label}</span>
    ${rows.join("")}
    ${banner}
    ${res.length ? `<div class="status-resources">${res.join("")}</div>` : ""}`;

  // Toggle a fast-poll loop while installing so the banner updates near-realtime.
  _maybeStartFastPoll(s);
}

function renderInstallBanner(ip) {
  if (!ip || ip.state !== "updating") return "";
  const subPhaseLabel = {
    pre: "Preparing update…",
    game_server: "Updating game server…",
    mods_check: "Checking Workshop mods…",
    mod_download: null, // handled below with the mod-by-mod card
    post: "Finalising mod updates…",
  }[ip.sub_phase] || "Updating…";
  let body = "";
  if (ip.sub_phase === "mod_download") {
    const done = ip.completed_mods != null ? ip.completed_mods : 0;
    const total = ip.total_mods != null ? ip.total_mods : "?";
    const current = ip.current_mod ? `${ip.current_mod}${ip.current_mod_id ? ` (${ip.current_mod_id})` : ""}` : "—";
    const bytes = ip.current_mod_bytes != null ? ` · ${fmtBytes(ip.current_mod_bytes)} so far` : "";
    body = `
      <div class="mip-row mip-current"><span class="mip-dot">●</span>
        Mod ${done + 1} of ${total}: <strong>${escapeHtml(current)}</strong>
        <div class="mip-sub muted">Downloading via SteamCMD${bytes}</div>
      </div>`;
  } else {
    body = `<div class="mip-row"><span class="mip-dot">●</span> ${escapeHtml(subPhaseLabel)}</div>`;
  }
  return `
    <div class="mod-install-progress">
      <div class="mip-head"><i class="fas fa-cloud-arrow-down"></i> Mod install in progress</div>
      ${body}
    </div>`;
}

let _fastPollTimer = null;
function _maybeStartFastPoll(s) {
  const installing = s && s.install_progress && s.install_progress.state === "updating";
  if (installing && !_fastPollTimer) {
    _fastPollTimer = setInterval(() => { refreshArmaState().catch(() => {}); }, 2000);
  } else if (!installing && _fastPollTimer) {
    clearInterval(_fastPollTimer);
    _fastPollTimer = null;
  }
}

function resPill(k, v) { return `<div class="res-pill"><span class="res-k">${k}</span><span class="res-v">${escapeHtml(v)}</span></div>`; }

function fmtBytes(b) {
  if (b == null) return "—";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0, n = b;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}
function fmtUptime(ms) {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

function renderNamePreview() {
  const tpl = els.statusNameTemplate.value || "{state_emoji} {state} {player_count}/{player_max}";
  const s = state.armaServer || {};
  const ls = s.last_state || {};
  const meta = stateMeta(ls.state);
  const ctx = {
    state: meta.pretty,
    state_emoji: meta.emoji,
    state_label: meta.label,
    server_name: ls.name || s.display_name || els.ptDisplayName.value || "Server",
    player_count: ls.player_count != null ? ls.player_count : "—",
    player_max: ls.player_max != null ? ls.player_max : "—",
    current_mission: ls.current_mission || "—",
    map_name: ls.map_name || "—",
  };
  let out = substitutePlaceholders(tpl, ctx);
  if (out.length > 95) out = out.slice(0, 95);
  els.statusNamePreview.textContent = out || "—";
}

/* ---------------- helpers ---------------- */
// Channel-picker + ID field combo: picker shows the resolved channel NAME
// when the saved ID matches a known channel; the manual input ALWAYS shows
// the saved ID so admins can verify what's actually stored. On save the
// picker wins if it has a non-empty selection; otherwise the manual ID is
// used (so pasting an ID for a channel the bot can't see still works).
function setChannelField(picker, manual, value) {
  if (value == null || value === "") {
    picker.value = "";
    manual.value = "";
    return;
  }
  const str = String(value);
  const hasOption = Array.from(picker.options).some((o) => o.value === str);
  picker.value = hasOption ? str : "";
  manual.value = str;
}

// Picker wins if a non-empty option is selected, otherwise the manual input.
// Returns a STRING (or null). Don't ever call Number() on a Discord snowflake —
// 19-digit IDs lose precision through IEEE-754 double, silently writing a
// different (wrong) channel ID to the DB and causing the bot to no-op when it
// can't find that channel.
function readChannelField(picker, manual) {
  const picked = picker.value && picker.value.trim();
  if (picked) return picked;
  const m = (manual.value || "").trim();
  return m || null;
}

// Two-way sync between a channel picker and its companion manual-ID input.
// - Picker change → mirror the selected ID into manual.
// - Manual input change → if the typed ID matches a known option, select it
//   in the picker (so the dropdown's name label updates to match).
function bindChannelPair(picker, manual) {
  if (!picker || !manual) return;
  picker.addEventListener("change", () => {
    manual.value = picker.value || "";
  });
  manual.addEventListener("input", () => {
    const v = (manual.value || "").trim();
    const hasOption = v && Array.from(picker.options).some((o) => o.value === v);
    picker.value = hasOption ? v : "";
  });
}

/* ---------------- build upsert body ---------------- */
function buildArmaBody() {
  const body = {
    display_name: els.ptDisplayName.value.trim(),
    ptero_panel_url: els.ptPanelUrl.value.trim(),
    ptero_server_identifier: els.ptServerId.value.trim(),
    summary_channel_id: readChannelField(els.statusSummaryChannel, els.statusSummaryChannelManual),
    summary_channel_template: els.statusNameTemplate.value.trim() || "{state_emoji} {state} {player_count}/{player_max}",
    detail_channel_id: readChannelField(els.statusDetailChannel, els.statusDetailChannelManual),
    poll_interval_sec: Math.max(15, Number(els.ptPollInterval.value) || 60),
    enabled: els.statusEnabled.checked,
    a2s_enabled: els.a2sEnabled.checked,
    a2s_host: els.a2sHost.value.trim() || null,
    a2s_port: Math.min(65535, Math.max(1, Number(els.a2sPort.value) || 2303)),
  };
  // only send the key if the admin typed a new one — empty preserves the stored key
  const key = els.ptClientKey.value.trim();
  if (key) body.ptero_client_key = key;
  return body;
}

/* ---------------- import / export ---------------- */
function exportArmaToJson() {
  // Dump current form values (not the stored row) so the admin can copy what's
  // about to be saved. Redact the API key (don't leak secrets through clipboard).
  const blob = {
    display_name: els.ptDisplayName.value.trim(),
    ptero_panel_url: els.ptPanelUrl.value.trim(),
    ptero_client_key: els.ptClientKey.value.trim() || "(unchanged)",
    ptero_server_identifier: els.ptServerId.value.trim(),
    summary_channel_id: readChannelField(els.statusSummaryChannel, els.statusSummaryChannelManual),
    summary_channel_template: els.statusNameTemplate.value.trim() || "{state_emoji} {state} {player_count}/{player_max}",
    detail_channel_id: readChannelField(els.statusDetailChannel, els.statusDetailChannelManual),
    poll_interval_sec: Math.max(15, Number(els.ptPollInterval.value) || 60),
    enabled: els.statusEnabled.checked,
    a2s_enabled: els.a2sEnabled.checked,
    a2s_host: els.a2sHost.value.trim() || null,
    a2s_port: Math.min(65535, Math.max(1, Number(els.a2sPort.value) || 2303)),
  };
  els.statusJsonBlob.value = JSON.stringify(blob, null, 2);
  els.statusJsonBlob.focus();
  els.statusJsonBlob.select();
}

function importArmaFromJson() {
  const raw = (els.statusJsonBlob.value || "").trim();
  if (!raw) { toast("Paste a JSON snippet first", "error"); return; }
  let obj;
  try { obj = JSON.parse(raw); } catch (e) { toast(`Bad JSON: ${e.message}`, "error"); return; }
  if (typeof obj !== "object" || obj == null) { toast("JSON must be an object", "error"); return; }

  if (obj.display_name != null) els.ptDisplayName.value = String(obj.display_name);
  if (obj.ptero_panel_url != null) els.ptPanelUrl.value = String(obj.ptero_panel_url);
  if (obj.ptero_client_key && obj.ptero_client_key !== "(unchanged)") {
    els.ptClientKey.value = String(obj.ptero_client_key);
  }
  if (obj.ptero_server_identifier != null) els.ptServerId.value = String(obj.ptero_server_identifier);
  if (obj.summary_channel_template != null) els.statusNameTemplate.value = String(obj.summary_channel_template);
  if (obj.poll_interval_sec != null) els.ptPollInterval.value = String(obj.poll_interval_sec);
  if (obj.enabled != null) els.statusEnabled.checked = !!obj.enabled;
  if (obj.summary_channel_id !== undefined) {
    setChannelField(els.statusSummaryChannel, els.statusSummaryChannelManual, obj.summary_channel_id);
  }
  if (obj.detail_channel_id !== undefined) {
    setChannelField(els.statusDetailChannel, els.statusDetailChannelManual, obj.detail_channel_id);
  }
  if (obj.a2s_enabled != null) els.a2sEnabled.checked = !!obj.a2s_enabled;
  if (obj.a2s_host != null) els.a2sHost.value = String(obj.a2s_host);
  if (obj.a2s_port != null) els.a2sPort.value = String(obj.a2s_port);
  renderNamePreview();
  toast("Form filled — click Save changes to apply", "ok");
}

async function copyArmaJsonToClipboard() {
  if (!els.statusJsonBlob.value.trim()) exportArmaToJson();
  try {
    await navigator.clipboard.writeText(els.statusJsonBlob.value);
    toast("Copied to clipboard", "ok");
  } catch {
    els.statusJsonBlob.focus();
    els.statusJsonBlob.select();
    toast("Couldn't auto-copy — selected the text for you to Ctrl+C", "error");
  }
}

/* ---------------- mission upload + power ---------------- */
async function uploadMissionPbo() {
  const s = state.armaServer;
  if (!s || s.id == null) {
    toast("Save the Arma server config first", "error");
    return;
  }
  const f = els.missionPboFile.files && els.missionPboFile.files[0];
  if (!f) { toast("Pick a .pbo file first", "error"); return; }
  const filename = (els.missionPboName.value || f.name || "").trim();
  if (!/\.pbo$/i.test(filename)) { toast("Filename must end in .pbo", "error"); return; }
  if (!/\./.test(filename.slice(0, -4))) {
    toast("Filename must look like Name.MapName.pbo (the map suffix matters)", "error"); return;
  }
  if (f.size > 50 * 1024 * 1024) {
    toast(`File is ${(f.size / 1024 / 1024).toFixed(1)} MB — max is 50 MB`, "error"); return;
  }

  els.missionPboUploadBtn.disabled = true;
  els.missionPboResult.textContent = "Uploading…";
  try {
    const fd = new FormData();
    fd.append("file", f, filename);
    fd.append("filename", filename);
    fd.append("restart_after", String(!!els.missionPboRestart.checked));
    const res = await api(
      `/bots/${state.selectedBot}/guilds/${state.selectedGuild}/arma-servers/${s.id}/upload-mission`,
      { method: "POST", body: fd }
    );
    if (res.restarted) {
      els.missionPboResult.innerHTML = `✓ Uploaded <code>${escapeHtml(res.filename)}</code> (${fmtBytes(res.bytes)}) — server restarting now.`;
    } else if (res.restart_error) {
      els.missionPboResult.innerHTML = `⚠ Uploaded <code>${escapeHtml(res.filename)}</code> but restart failed: ${escapeHtml(res.restart_error)}.`;
    } else {
      els.missionPboResult.innerHTML = `✓ Uploaded <code>${escapeHtml(res.filename)}</code> (${fmtBytes(res.bytes)}). Restart the server manually before it'll show in <code>#missions</code>.`;
    }
    toast("Mission uploaded", "ok");
    els.missionPboFile.value = "";
    els.missionPboName.value = "";
  } catch (e) {
    els.missionPboResult.innerHTML = `<span class="status-error">${escapeHtml(e.message || String(e))}</span>`;
    toast(e.message || "Upload failed", "error");
  } finally {
    els.missionPboUploadBtn.disabled = false;
  }
}

async function restartArmaServer() {
  const s = state.armaServer;
  if (!s || s.id == null) { toast("Save the Arma server config first", "error"); return; }
  if (!confirm("Restart the Arma server now? Active players will be dropped.")) return;
  els.statusRestartBtn.disabled = true;
  try {
    const fd = new FormData();
    fd.append("signal", "restart");
    await api(
      `/bots/${state.selectedBot}/guilds/${state.selectedGuild}/arma-servers/${s.id}/power`,
      { method: "POST", body: fd }
    );
    toast("Restart signal sent", "ok");
    // Force a poll refresh shortly after the restart begins.
    setTimeout(refreshArmaState, 3000);
  } catch (e) {
    toast(e.message || "Restart failed", "error");
  } finally {
    els.statusRestartBtn.disabled = false;
  }
}

async function saveArmaServer() {
  const s = state.armaServer;
  const isNew = !s || s.id == null;
  const body = buildArmaBody();
  if (!body.ptero_panel_url) return toast("Panel URL required", "error");
  if (!body.ptero_server_identifier) return toast("Server identifier required", "error");
  if (isNew && !els.ptClientKey.value.trim()) return toast("Client API key required for a new server", "error");

  els.statusSaveBtn.disabled = true;
  const base = `/bots/${state.selectedBot}/guilds/${state.selectedGuild}/arma-servers`;
  try {
    if (isNew) { await api(base, { method: "POST", body: JSON.stringify(body) }); toast("Server added", "ok"); }
    else { await api(`${base}/${s.id}`, { method: "PATCH", body: JSON.stringify(body) }); toast("Server saved", "ok"); }
    await loadArmaServers();
  } catch (e) { toast(e.message, "error"); }
  finally { els.statusSaveBtn.disabled = false; }
}

async function testArmaConnection() {
  const s = state.armaServer;
  els.statusTestResult.className = "test-result pending";
  els.statusTestResult.innerHTML = `<span class="spinner"></span> Testing…`;
  if (!s || s.id == null) {
    els.statusTestResult.className = "test-result err";
    els.statusTestResult.innerHTML = `<i class="fas fa-circle-exclamation"></i> Save the server first, then test.`;
    return;
  }
  try {
    const data = await api(`/bots/${state.selectedBot}/guilds/${state.selectedGuild}/arma-servers`);
    const fresh = (data.servers || []).find((x) => x.id === s.id);
    state.armaServer = fresh;
    const ls = fresh && fresh.last_state;
    if (ls && ls.error) {
      els.statusTestResult.className = "test-result err";
      els.statusTestResult.innerHTML = `<i class="fas fa-circle-exclamation"></i> ${escapeHtml(ls.error)}`;
    } else if (ls && ls.state && ls.state !== "unknown") {
      els.statusTestResult.className = "test-result ok";
      els.statusTestResult.innerHTML = `<i class="fas fa-circle-check"></i> Connected — ${stateMeta(ls.state).label}`;
    } else {
      els.statusTestResult.className = "test-result pending";
      els.statusTestResult.innerHTML = `<i class="fas fa-hourglass-half"></i> Awaiting first poll…`;
    }
    renderStatusState(fresh);
    renderNamePreview();
  } catch (e) {
    els.statusTestResult.className = "test-result err";
    els.statusTestResult.innerHTML = `<i class="fas fa-circle-exclamation"></i> ${escapeHtml(e.message)}`;
  }
}

async function refreshArmaState() {
  const s = state.armaServer;
  if (!s || s.id == null) return;
  els.statusRefreshBtn.disabled = true;
  els.statusRefreshBtn.innerHTML = `<span class="spinner"></span> Refreshing…`;
  try {
    const data = await api(`/bots/${state.selectedBot}/guilds/${state.selectedGuild}/arma-servers`);
    const fresh = (data.servers || []).find((x) => x.id === s.id);
    if (fresh) { state.armaServer = fresh; renderStatusState(fresh); renderNamePreview(); }
  } catch (e) { toast(e.message, "error"); }
  finally { els.statusRefreshBtn.disabled = false; els.statusRefreshBtn.innerHTML = `<i class="fas fa-rotate-right"></i> Refresh now`; }
}

async function deleteArmaServer() {
  const s = state.armaServer;
  if (!s || s.id == null) return;
  if (!confirm(`Delete the “${s.display_name || s.ptero_server_identifier}” monitor? This won't touch any Discord channels.`)) return;
  try {
    await api(`/bots/${state.selectedBot}/guilds/${state.selectedGuild}/arma-servers/${s.id}`, { method: "DELETE" });
    toast("Server deleted", "ok");
    state.armaServer = null;
    await loadArmaServers();
  } catch (e) { toast(e.message, "error"); }
}

function addArmaServer() {
  state.armaServer = { id: null, enabled: true, poll_interval_sec: 60, summary_channel_template: "{state_emoji} {state} {player_count}/{player_max}", a2s_port: 2303 };
  renderArmaServer(state.armaServer);
}

/* ---------------- installed missions ---------------- */
async function loadInstalledMissions() {
  const s = state.armaServer;
  if (!s || s.id == null) {
    els.missionsInstalledList.innerHTML = `<div class="muted">Save the server config first.</div>`;
    return;
  }
  els.missionsInstalledList.innerHTML = `<div class="skel" style="height:48px"></div>`;
  try {
    const data = await api(
      `/bots/${state.selectedBot}/guilds/${state.selectedGuild}/arma-servers/${s.id}/missions-installed`
    );
    renderInstalledMissions(data.missions || []);
  } catch (e) {
    els.missionsInstalledList.innerHTML = `<div class="status-error">${escapeHtml(e.message || String(e))}</div>`;
  }
}

function renderInstalledMissions(missions) {
  if (!missions.length) {
    els.missionsInstalledList.innerHTML = `<div class="muted">No missions in <code>/mpmissions</code> yet — upload a <code>.pbo</code> above, or SFTP-upload an unpacked mission folder (e.g. Antistasi).</div>`;
    return;
  }
  els.missionsInstalledList.innerHTML = missions.map((m) => {
    const isFolder = m.kind === "folder";
    const icon = isFolder ? "fa-folder-open" : "fa-file-code";
    const sizeStr = m.size != null ? fmtBytes(m.size) : "—";
    const kindLabel = isFolder ? "folder" : "pbo";
    return `
    <div class="installed-mission-row" data-name="${escapeHtml(m.name)}">
      <div class="mission-file">
        <div class="mission-file-name mono"><i class="fas ${icon}" title="${kindLabel}"></i> ${escapeHtml(m.name)}</div>
        <div class="mission-file-meta muted">${kindLabel} · ${sizeStr} · modified ${escapeHtml(m.modified_at || "—")}</div>
      </div>
      <div class="mission-file-actions">
        <button type="button" class="btn btn-secondary sm-btn" data-action="boot"><i class="fas fa-power-off"></i> Set as boot default</button>
        <button type="button" class="btn btn-danger sm-btn" data-action="delete"><i class="fas fa-trash"></i> Delete</button>
      </div>
    </div>`;
  }).join("");

  els.missionsInstalledList.querySelectorAll(".installed-mission-row").forEach((row) => {
    const name = row.dataset.name;
    row.querySelector('[data-action="boot"]').addEventListener("click", () => setBootDefault(name));
    row.querySelector('[data-action="delete"]').addEventListener("click", () => deleteInstalledMission(name));
  });
}

async function setBootDefault(name) {
  const s = state.armaServer;
  if (!s || s.id == null) return;
  if (!confirm(
    `Set ${name} as the boot mission?\n\n` +
    `Rewrites class Missions {} in server.cfg. Takes effect on the NEXT server start — doesn't change the currently-running mission. Sandbox stays as the default unless you switch it back.`
  )) return;
  try {
    const res = await api(
      `/bots/${state.selectedBot}/guilds/${state.selectedGuild}/arma-servers/${s.id}/set-boot-default`,
      { method: "POST", body: JSON.stringify({ filename: name }) }
    );
    if (res.updated) toast(`Boot mission set to ${res.boot_mission}`, "ok");
    else toast(res.note || "server.cfg already matches", "ok");
  } catch (e) {
    toast(e.message || "Failed to set boot mission", "error");
  }
}

async function deleteInstalledMission(name) {
  const s = state.armaServer;
  if (!s || s.id == null) return;
  if (!confirm(`Delete ${name} from /mpmissions?\n\nThis is permanent — the file is removed from the server.`)) return;
  try {
    await api(
      `/bots/${state.selectedBot}/guilds/${state.selectedGuild}/arma-servers/${s.id}/missions-installed/delete`,
      { method: "POST", body: JSON.stringify({ names: [name] }) }
    );
    toast(`Deleted ${name}`, "ok");
    await loadInstalledMissions();
  } catch (e) {
    toast(e.message || "Delete failed", "error");
  }
}

/* ---------------- upload modlist (file picker) ---------------- */
async function uploadModlistToArma() {
  const s = state.armaServer;
  if (!s || s.id == null) { toast("Save the Arma server config first", "error"); return; }
  const f = els.uploadModlistFile.files && els.uploadModlistFile.files[0];
  if (!f) { toast("Pick a .html file first", "error"); return; }
  if (f.size > 2 * 1024 * 1024) {
    toast(`File is ${(f.size / 1024).toFixed(0)} KB — max is 2 MB`, "error"); return;
  }
  els.uploadModlistBtn.disabled = true;
  els.uploadModlistResult.textContent = "Uploading…";
  try {
    const fd = new FormData();
    fd.append("file", f, f.name);
    fd.append("also_save_as_current", String(!!els.uploadModlistSaveAsCurrent.checked));
    const res = await api(
      `/bots/${state.selectedBot}/guilds/${state.selectedGuild}/arma-servers/${s.id}/upload-modlist`,
      { method: "POST", body: fd }
    );
    els.uploadModlistResult.innerHTML = `✓ Uploaded <code>${escapeHtml(res.original_filename || f.name)}</code> → <code>/modlist.html</code> (${fmtBytes(res.bytes)}).`;
    toast("Modlist uploaded & pushed", "ok");
    els.uploadModlistFile.value = "";
  } catch (e) {
    els.uploadModlistResult.innerHTML = `<span class="status-error">${escapeHtml(e.message || String(e))}</span>`;
    toast(e.message || "Upload failed", "error");
  } finally {
    els.uploadModlistBtn.disabled = false;
  }
}

/* ---------------- push modlist ---------------- */
async function pushModlistToArma() {
  const s = state.armaServer;
  if (!s || s.id == null) { toast("Save the Arma server config first", "error"); return; }
  els.pushModlistBtn.disabled = true;
  els.pushModlistResult.textContent = "Pushing…";
  try {
    const res = await api(
      `/bots/${state.selectedBot}/guilds/${state.selectedGuild}/arma-servers/${s.id}/push-modlist`,
      { method: "POST" }
    );
    els.pushModlistResult.innerHTML = `✓ Pushed <code>${fmtBytes(res.bytes)}</code> to <code>/modlist.html</code>.`;
    toast("Modlist pushed", "ok");
  } catch (e) {
    els.pushModlistResult.innerHTML = `<span class="status-error">${escapeHtml(e.message || String(e))}</span>`;
    toast(e.message || "Push failed", "error");
  } finally {
    els.pushModlistBtn.disabled = false;
  }
}
