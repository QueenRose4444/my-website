/* ============================================================
 * missions.js — Missions list, detail drawer, reschedule
 * ============================================================ */

async function loadMissions() {
  if (!state.selectedBot || !state.selectedGuild) return;
  // keep seg-control in sync with state
  els.missionsSeg.querySelectorAll(".seg-btn").forEach((b) =>
    b.classList.toggle("active", b.dataset.state === state.missionsState));

  // loading skeletons
  els.missionsList.innerHTML = Array.from({ length: 3 }).map(() => `
    <div class="mission-skel">
      <div class="skel skel-id"></div>
      <div><div class="skel skel-line-1"></div><div class="skel skel-line-2"></div></div>
      <div class="skel skel-tally"></div>
    </div>`).join("");

  try {
    const data = await api(`/bots/${state.selectedBot}/guilds/${state.selectedGuild}/missions?state=${state.missionsState}`);
    const list = data.missions || [];
    if (!list.length) { renderMissionsEmpty(); return; }
    els.missionsList.innerHTML = list.map(renderMissionRow).join("");
    els.missionsList.querySelectorAll("[data-mission]").forEach((row) => {
      row.setAttribute("tabindex", "0");
      row.addEventListener("click", () => openMissionDrawer(Number(row.dataset.mission)));
      row.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openMissionDrawer(Number(row.dataset.mission)); }
      });
    });
  } catch (e) {
    els.missionsList.innerHTML = `
      <div class="list-state">
        <i class="fas fa-triangle-exclamation ls-ico"></i>
        <h4>Couldn't load missions</h4>
        <p>${escapeHtml(e.message)}</p>
        <button class="btn btn-secondary" onclick="loadMissions()"><i class="fas fa-rotate-right"></i> Retry</button>
      </div>`;
    toast(e.message, "error");
  }
}

function renderMissionsEmpty() {
  const map = {
    upcoming: ["No upcoming missions", "Nothing scheduled yet. Compose one to notify your roles.", true],
    past: ["No past missions", "Once missions wrap up, they'll appear here.", false],
    all: ["No missions yet", "Compose your first mission to get started.", true],
  };
  const [h, p, showCta] = map[state.missionsState] || map.all;
  els.missionsList.innerHTML = `
    <div class="list-state">
      <i class="fas fa-flag ls-ico"></i>
      <h4>${h}</h4>
      <p>${p}</p>
      ${showCta ? `<button class="btn btn-primary" onclick="goToTab('compose')"><i class="fas fa-feather-pointed"></i> New mission</button>` : ""}
    </div>`;
}

function firstMeaningfulLine(raw) {
  const lines = (raw || "").split("\n").map((s) => s.trim()).filter(Boolean);
  let i = 0;
  // skip leading lines that are just role/channel mention pings
  while (i < lines.length && /^[@#]/.test(lines[i])) i++;
  const pick = lines[i] || lines[0] || "Mission";
  return pick.replace(/[*_`~>]/g, "").trim().slice(0, 80) || "Mission";
}

function missionDisplayTitle(m) {
  const custom = (m.title || "").trim();
  if (custom) return custom;
  return firstMeaningfulLine(m.raw_content);
}

function renderMissionRow(m) {
  const when = fmtDateTime(m.mission_utc, { dateStyle: "full", timeStyle: "short" });
  const t = m.rsvp_counts || { going: 0, maybe: 0, not: 0 };
  return `
    <div class="mission-row${m.cancelled ? " cancelled" : ""}" data-mission="${m.id}" role="button" aria-label="Mission ${m.id}">
      <span class="mission-id">#${m.id}</span>
      <div class="mission-meta">
        <div class="mission-title"><i class="fas fa-flag mi"></i>${escapeHtml(missionDisplayTitle(m))}${m.cancelled ? ' <span class="muted">(cancelled)</span>' : ""}</div>
        <div class="mission-when">${escapeHtml(when)} · <a href="${escapeAttr(m.jump_url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">jump ↗</a></div>
      </div>
      <div class="mission-tally">
        <span class="tally-pill going">✅ ${t.going}</span>
        <span class="tally-pill maybe">❓ ${t.maybe}</span>
        <span class="tally-pill not">❌ ${t.not}</span>
      </div>
    </div>`;
}

/* ---------------- drawer ---------------- */
async function openMissionDrawer(id) {
  try {
    const m = await api(`/bots/${state.selectedBot}/guilds/${state.selectedGuild}/missions/${id}`);
    state.drawerMission = m;
    renderDrawerBody(m);
    if (!els.missionDrawer.open) els.missionDrawer.showModal();
  } catch (e) { toast(e.message, "error"); }
}

/* bug F: render the body in place — never close/reopen on save */
function renderDrawerBody(m) {
  const started = new Date(m.mission_utc).getTime() < Date.now();
  const locked = m.cancelled || started;
  els.drawerTitle.textContent = `Mission #${m.id}`;
  const when = fmtDateTime(m.mission_utc, { dateStyle: "full", timeStyle: "short" });
  const titleValue = m.title || "";
  const fallback = firstMeaningfulLine(m.raw_content);

  els.drawerBody.innerHTML = `
    <div class="dr-section-label">Title</div>
    <div class="dr-title-row">
      <input id="drawerTitleInput" class="text-input" maxlength="240" value="${escapeAttr(titleValue)}" placeholder="${escapeAttr(fallback)}">
      <button id="drawerTitleSave" class="btn btn-primary" disabled><i class="fas fa-check"></i> Save</button>
    </div>
    <p class="muted" style="margin:0.4rem 0 0">Leave empty to use the first line of the mission's content.</p>

    <div class="dr-meta-grid">
      <div class="dr-stat"><div class="k">Starts</div><div class="v">${escapeHtml(when)}</div><div class="v rel">${escapeHtml(fmtRelative(m.mission_utc))}</div></div>
      <div class="dr-stat"><div class="k">State</div><div class="v"><span class="status-pill ${m.cancelled ? "cancelled" : "active"}">${m.cancelled ? "● Cancelled" : "● Active"}</span></div>
        <div class="v rel"><a href="${escapeAttr(m.jump_url)}" target="_blank" rel="noopener">Original message ↗</a></div></div>
    </div>

    <div class="dr-section-label">RSVPs</div>
    <div class="dr-rsvps">
      <span class="tally-pill going">✅ Going ${m.rsvps.going.length}</span>
      <span class="tally-pill maybe">❓ Maybe ${m.rsvps.maybe.length}</span>
      <span class="tally-pill not">❌ Not going ${m.rsvps.not.length}</span>
    </div>

    <div class="dr-section-label">Content</div>
    <pre>${escapeHtml(m.raw_content)}</pre>

    <div class="dr-section-label">Modlist${m.template_override_id ? ` <span class="dr-override-badge"><i class="fas fa-filter"></i> template override #${m.template_override_id}</span>` : ""}</div>
    <div class="dr-modlist">
      <div class="ml-line"><span class="ml-k">Preset</span>${m.modlist_url
        ? `<span class="ml-v"><a href="${escapeAttr(m.modlist_url)}" target="_blank" rel="noopener">${escapeHtml(decodeURIComponent(String(m.modlist_url).split("/").pop().split("?")[0]) || "preset.html")} ↗</a></span>`
        : `<span class="ml-v dim">—</span>`}</div>
      <div class="ml-line"><span class="ml-k">Text</span>${m.modlist_text
        ? `<span class="ml-v">${escapeHtml(m.modlist_text)}</span>`
        : `<span class="ml-v dim">—</span>`}</div>
    </div>
    <button id="drawerModlistOverride" type="button" class="btn btn-secondary sm-btn"><i class="fas fa-pen"></i> Override…</button>
  `;

  const titleInput = $("drawerTitleInput");
  const titleSave = $("drawerTitleSave");
  titleInput.addEventListener("input", () => { titleSave.disabled = titleInput.value === titleValue; });
  titleSave.addEventListener("click", () => saveMissionTitle(titleInput.value));
  titleInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !titleSave.disabled) { e.preventDefault(); saveMissionTitle(titleInput.value); }
  });

  els.drawerCancel.disabled = locked;
  els.drawerReschedule.disabled = locked;
  els.drawerCancel.title = locked ? (m.cancelled ? "Already cancelled" : "Mission has already started") : "";
  if (els.drawerRemind) {
    els.drawerRemind.disabled = locked;
    els.drawerRemind.title = locked
      ? (m.cancelled ? "Mission was cancelled" : "Mission has already started")
      : "Re-fire reminder DMs to opted-in members";
  }

  const mlBtn = $("drawerModlistOverride");
  if (mlBtn) mlBtn.addEventListener("click", () => openMissionModlistDialog(m));
}

function openMissionModlistDialog(m) {
  els.missionModlistUrl.value = m.modlist_url || "";
  els.missionModlistText.value = m.modlist_text || "";
  els.missionModlistDialog.showModal();
}

async function submitMissionModlist(e) {
  e.preventDefault();
  const m = state.drawerMission;
  if (!m) return;
  try {
    await api(`/bots/${state.selectedBot}/guilds/${state.selectedGuild}/missions/${m.id}/modlist`,
      { method: "PATCH", body: JSON.stringify({ url: els.missionModlistUrl.value.trim(), text: els.missionModlistText.value.trim() }) });
    toast("Mission modlist updated", "ok");
    els.missionModlistDialog.close();
    const refreshed = await api(`/bots/${state.selectedBot}/guilds/${state.selectedGuild}/missions/${m.id}`);
    state.drawerMission = refreshed;
    renderDrawerBody(refreshed);
  } catch (err) { toast(err.message, "error"); }
}

async function saveMissionTitle(newTitle) {
  if (!state.drawerMission) return;
  try {
    const updated = await api(
      `/bots/${state.selectedBot}/guilds/${state.selectedGuild}/missions/${state.drawerMission.id}`,
      { method: "PATCH", body: JSON.stringify({ title: newTitle }) });
    state.drawerMission = updated;
    toast("Title updated", "ok");
    renderDrawerBody(updated);   // re-render in place — no flicker
    loadMissions();
  } catch (e) { toast(e.message, "error"); }
}

// Phase 3 (2026-06): /missionsadmin remind parity. Queues a web_action that
// the bot picks up within ~30s and re-fires reminder DMs via the same path
// the slash command uses.
async function remindMissionFromDrawer() {
  const m = state.drawerMission;
  if (!m) return;
  if (!confirm(`Re-fire reminder DMs for mission #${m.id}?\n\nAll opted-in members get pinged again. (Same as /missionsadmin remind ${m.id}.)`)) return;
  els.drawerRemind.disabled = true;
  try {
    await api(`/bots/${state.selectedBot}/guilds/${state.selectedGuild}/missions/${m.id}/remind`, { method: "POST" });
    toast("Reminders queued — DMs go out within ~30s", "ok");
  } catch (e) {
    toast(e.message || String(e), "error");
  } finally {
    els.drawerRemind.disabled = false;
  }
}

async function cancelMissionFromDrawer() {
  const m = state.drawerMission;
  if (!m) return;
  if (!confirm(`Cancel mission #${m.id}? This stops all reminders and notifies role members.`)) return;
  try {
    await api(`/bots/${state.selectedBot}/guilds/${state.selectedGuild}/missions/${m.id}/cancel`, { method: "POST" });
    toast("Mission cancelled — bot updates within ~30s", "ok");
    const refreshed = await api(`/bots/${state.selectedBot}/guilds/${state.selectedGuild}/missions/${m.id}`);
    state.drawerMission = refreshed;
    renderDrawerBody(refreshed);
    loadMissions();
  } catch (e) { toast(e.message, "error"); }
}

function openRescheduleDialog() {
  const m = state.drawerMission;
  if (!m) return;
  els.rescheduleWhen.value = toDatetimeLocalValue(new Date(m.mission_utc));
  if (!els.rescheduleTz.value) els.rescheduleTz.value = localTimezone();
  els.rescheduleDialog.showModal();
}

async function submitReschedule(e) {
  e.preventDefault();
  const m = state.drawerMission;
  if (!m) return;
  const when_local = els.rescheduleWhen.value.replace("T", " ");
  const tz = els.rescheduleTz.value.trim();
  try {
    const res = await api(`/bots/${state.selectedBot}/guilds/${state.selectedGuild}/missions/${m.id}/reschedule`,
      { method: "POST", body: JSON.stringify({ when_local, tz }) });
    toast("Rescheduled — members re-notified within ~30s", "ok");
    els.rescheduleDialog.close();
    if (res.mission_utc) { m.mission_utc = res.mission_utc; renderDrawerBody(m); }
    loadMissions();
  } catch (err) { toast(err.message, "error"); }
}
