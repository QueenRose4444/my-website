/* ============================================================
 * arma.js — Arma Management tab: rendering.
 * Sections: 1) active armaState strip  2) loadout grid
 *           3) modlist library  4) event timeline
 * Action handlers live in arma_dialogs.js.
 * ============================================================ */

function renderArma() {
  renderStrip();
  renderLoadoutDraftsBanner();
  renderLoadoutGrid();
  renderMissionsTable();
  renderModlistTable();
  renderArmaTokensTable();
  renderTimeline();
  updateDriftIndicator();
}

/* ---------------- v2e draft suggestions banner ---------------- */
async function renderLoadoutDraftsBanner() {
  const host = $("loadoutDraftsBanner");
  if (!host || typeof fetchLoadoutDrafts !== "function") return;
  const drafts = await fetchLoadoutDrafts();
  if (!drafts.length) { host.hidden = true; host.innerHTML = ""; return; }
  host.hidden = false;
  host.innerHTML = "";
  host.appendChild(el("div", { class: "drafts-banner" }, drafts.map((d) => {
    const p = d.payload || {};
    const pbo = p.mission_pbo || "?.pbo";
    const title = p.title_hint || "Mission";
    return el("div", { class: "draft-row" }, [
      el("i", { class: "fas fa-wand-magic-sparkles" }),
      el("div", { class: "draft-body" }, [
        el("strong", {}, [`Loadout suggested: ${pbo}`]),
        el("div", { class: "muted", style: "font-size:.82rem" }, [
          `from a mission post — "${title.length > 80 ? title.slice(0, 80) + "…" : title}"`,
          p.jump_url ? el("a", { href: p.jump_url, target: "_blank", style: "margin-left:.4rem;color:var(--accent)" }, [" jump →"]) : null,
        ]),
      ]),
      el("div", { class: "draft-actions" }, [
        btn("Create loadout", "fa-plus", "btn-primary sm-btn", () => acceptLoadoutDraft(d)),
        btn("Dismiss", null, "btn-ghost sm-btn", () => dismissLoadoutDraft(d)),
      ]),
    ]);
  })));
}

async function acceptLoadoutDraft(draft) {
  const p = draft.payload || {};
  // Opens the New Loadout dialog with mission_pbo prefilled; admin tweaks
  // and saves. We dismiss the draft AFTER they hit Save (best-effort).
  try {
    await openNewLoadoutDialog({ mission_pbo: p.mission_pbo, name: (p.title_hint || "").slice(0, 60) });
    try { await apiDismissDraft(draft.id); } catch { /* non-fatal */ }
    await renderLoadoutDraftsBanner();
  } catch (e) { toast(e.message || String(e), "error"); }
}

async function dismissLoadoutDraft(draft) {
  try {
    await apiDismissDraft(draft.id);
    await renderLoadoutDraftsBanner();
  } catch (e) { toast(e.message || String(e), "error"); }
}

/* ---------------- v2f access tokens table ---------------- */
async function renderArmaTokensTable() {
  const tbody = $("armaTokensTbody");
  if (!tbody) return;
  let tokens = [];
  try { tokens = (await apiListArmaTokens()).tokens || []; } catch (e) { /* silent */ }
  if (!tokens.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="muted" style="padding:.8rem;text-align:center">No access tokens generated yet. Generate one to give someone server-management access without Discord OAuth.</td></tr>`;
    return;
  }
  tbody.innerHTML = "";
  for (const t of tokens) {
    const status = t.revoked_at ? "revoked" : (t.expires_at && new Date(t.expires_at) < new Date() ? "expired" : "active");
    const tr = el("tr", {}, [
      el("td", {}, [el("strong", {}, [t.name])]),
      el("td", { class: "dt-num mono" }, [`#${t.arma_server_id}`]),
      el("td", { class: "dt-num" }, [fmtRelative(t.created_at)]),
      el("td", { class: "dt-num" }, [t.last_used_at ? fmtRelative(t.last_used_at) : "never"]),
      el("td", {}, [el("span", { class: `ld-pill ${status === "active" ? "active" : "inactive"}` }, [status])]),
      el("td", { class: "dt-actions" }, [
        kebab([
          { label: status === "active" ? "Revoke" : "Already revoked", icon: "fa-ban",
            danger: status === "active", disabled: status !== "active",
            onClick: () => revokeArmaToken(t.id, t.name) },
        ]),
      ]),
    ]);
    tbody.appendChild(tr);
  }
}

async function revokeArmaToken(id, name) {
  if (!confirm(`Revoke token "${name}"? Anyone using it will lose access immediately.`)) return;
  try {
    await apiRevokeArmaToken(id);
    toast(`Revoked "${name}"`, "ok");
    await renderArmaTokensTable();
  } catch (e) { toast(e.message || String(e), "error"); }
}

/* ---------------- Installed missions (PBOs in /mpmissions) ---------------- */
function renderMissionsTable() {
  const tbody = $("missionsTbody");
  if (!tbody) return;
  tbody.innerHTML = "";
  const missions = armaState.installedMissions || [];
  if (missions.length === 0) {
    tbody.appendChild(el("tr", {}, [el("td", { colspan: "5", class: "muted", style: "padding:.8rem;text-align:center" },
      ["No mission PBOs uploaded yet. Use “Upload mission PBO” above — they'll then be pickable when you create a loadout."])]));
    return;
  }
  for (const m of missions) {
    const name = m.name || (typeof m === "string" ? m : "?");
    const isFolder = m && m.kind === "folder";
    const icon = isFolder ? "fa-folder-open" : "fa-file-code";
    const size = m.size != null ? fmtBytes(m.size) : "—";
    const modified = m.modified_at ? fmtRelative(m.modified_at) : "—";
    const usedBy = armaState.loadouts.filter((l) => !l.archived && l.mission_pbo === name);
    const tr = el("tr", {}, [
      el("td", { class: "mono" }, [el("div", { class: "dt-name" }, [
        el("i", { class: `fas ${icon}`, style: "margin-right:.4rem;color:var(--text-faint)", title: isFolder ? "unpacked folder" : "pbo" }),
        name,
      ])]),
      el("td", { class: "dt-num" }, [size]),
      el("td", { class: "dt-num" }, [modified]),
      el("td", {}, [usedBy.length
        ? el("span", {}, [usedBy.map((l) => l.name).join(", ")])
        : el("span", { class: "muted" }, ["—"])]),
      el("td", { class: "dt-actions" }, [
        kebab([
          { label: "Use in new loadout…", icon: "fa-plus", onClick: () => openNewLoadoutDialog({ mission_pbo: name }) },
          { sep: true },
          { label: usedBy.length ? `Used by ${usedBy.length} loadout${usedBy.length === 1 ? "" : "s"}` : "Delete", icon: usedBy.length ? "fa-lock" : "fa-trash", danger: !usedBy.length, disabled: !!usedBy.length, onClick: () => deleteInstalledMissionPbo(name, usedBy) },
        ]),
      ]),
    ]);
    tbody.appendChild(tr);
  }
}

async function deleteInstalledMissionPbo(name, usedBy) {
  if (usedBy && usedBy.length) { toast(`Can't delete — used by ${usedBy.length} loadout${usedBy.length === 1 ? "" : "s"}`, "error"); return; }
  if (!confirm(`Delete ${name} from /mpmissions on the server?`)) return;
  try {
    await apiDeleteInstalledMission(name);
    await fetchInstalledMissionsForLibrary();
    renderMissionsTable();
    toast(`Deleted ${name}`, "neutral");
  } catch (e) { toast(e.message || String(e), "error"); }
}

// Compact pill used in the state-strip live-status row.
function _livePill(icon, key, value) {
  return el("span", { class: "ss-live-pill" }, [
    el("i", { class: `fas ${icon}` }),
    el("span", { class: "ss-k" }, [key]),
    el("span", { class: "ss-v" }, [String(value)]),
  ]);
}

function _fmtUptime(ms) {
  if (!ms) return "—";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

/* ---------------- 1. ACTIVE STATE STRIP ---------------- */
// The strip now leads with a live-status badge (state/players/mission/map/uptime,
// same data the Server status tab shows but compact) and a second line that's
// Arma-Management specific (active loadout + modlist + event). Two-row layout
// keeps everything an admin wants visible without bouncing between tabs.
function renderStrip() {
  const host = $("armaStateStrip");
  const ev = liveEvent();
  const s = armaState.server || {};
  host.innerHTML = "";

  let variant = "none";
  if (s.drift) variant = "drift";
  else if (ev) variant = "live";
  host.className = "armaState-strip " + (variant === "drift" ? "drift" : variant === "live" ? "live" : "");

  const main = el("div", { class: "ss-main" });

  // Resolve real-data names (Phase 2a wires modlists to backend; Phase 2b
  // wires loadouts; Phase 2c will wire events). Mocks only via demo picker.
  const activeMlId = armaState.activeModlistId;
  const activeMl = activeMlId
    ? armaState.modlists.find((m) => Number(m.id) === Number(activeMlId))
    : null;
  const lastApplied = armaState.loadouts
    .filter((l) => l.last_run && !l.archived)
    .sort((a, b) => new Date(b.last_run) - new Date(a.last_run))[0];

  /* --- ROW 1: live server status (Pterodactyl + A2S) --- */
  const stateLabel = s.label ? s.label.toUpperCase() : "UNKNOWN";
  const badge = el("span", { class: `ss-state-badge ${s.badge || "unknown"}` }, [
    el("span", { class: "dot" }),
    el("span", {}, [s.emoji ? `${s.emoji} ` : "", stateLabel]),
  ]);
  const livePills = el("div", { class: "ss-live-pills" });
  if (s.players != null || s.players_max != null) {
    livePills.appendChild(_livePill("fa-users", "Players",
      `${s.players != null ? s.players : "?"}/${s.players_max != null ? s.players_max : "?"}`));
  }
  if (s.mission_pretty) {
    livePills.appendChild(_livePill("fa-flag-checkered", "Mission", s.mission_pretty));
  }
  if (s.map) {
    livePills.appendChild(_livePill("fa-map", "Map", s.map));
  }
  if (s.uptime_ms != null && s.power === "running") {
    livePills.appendChild(_livePill("fa-clock", "Uptime", _fmtUptime(s.uptime_ms)));
  }
  if (s.a2s_error) {
    livePills.appendChild(el("span", { class: "ss-warn-pill", title: s.a2s_error }, [
      el("i", { class: "fas fa-triangle-exclamation" }), " A2S unreachable",
    ]));
  }
  main.appendChild(el("div", { class: "ss-head live-row" }, [badge, livePills]));

  /* --- ROW 2: Arma Management headline (loadout/event) --- */
  let headlineText;
  if (variant === "drift") {
    headlineText = el("span", { class: "ss-headline" }, [
      el("i", { class: "fas fa-triangle-exclamation", style: "color:var(--warn);margin-right:.45rem" }),
      "Drift — server isn't running the expected loadout",
    ]);
  } else if (variant === "live") {
    const ld = loadoutById(ev.loadout_id);
    headlineText = el("span", { class: "ss-headline" }, [
      ld ? ld.name : `Event #${ev.id}`,
      el("span", { class: "ss-sep" }, [" · "]),
      el("span", { class: "dim" }, [`live event #${ev.id}`]),
    ]);
  } else {
    headlineText = el("span", { class: "ss-headline" }, [
      lastApplied ? `Last applied: ${lastApplied.name}` : "No loadout applied yet",
      lastApplied
        ? el("span", { class: "dim" }, [el("span", { class: "ss-sep" }, [" · "]), fmtRelative(lastApplied.last_run)])
        : el("span", { class: "dim" }, [el("span", { class: "ss-sep" }, [" · "]), "create one below to switch the server's mission + modlist"]),
    ]);
  }
  const mgmtBadge = el("span", { class: "ss-mode-badge" }, [
    el("i", { class: "fas fa-shield-halved" }), " Arma Management",
  ]);
  main.appendChild(el("div", { class: "ss-head mgmt-row" }, [mgmtBadge, headlineText]));

  /* meta + actions per variant */
  const actions = el("div", { class: "ss-actions" });

  if (variant === "drift") {
    const reason = armaState.server.drift_reason
      || `Server is running ${armaState.server.drift_actual_mission || "?"} but expected ${armaState.server.drift_expected_pbo || "?"}`;
    main.appendChild(el("div", { class: "ss-drift-note" }, [
      el("i", { class: "fas fa-triangle-exclamation" }),
      el("div", {}, [el("span", {}, [reason])]),
    ]));
    actions.appendChild(btn("Reconcile…", "fa-arrows-rotate", "btn-secondary sm-btn", () => openReconcileDialog()));
    actions.appendChild(btn("Open status", "fa-up-right-from-square", "btn-ghost sm-btn", () => goToTab("status")));
  } else if (variant === "live") {
    const metaChildren = [
      el("span", {}, [el("span", { class: "ss-k" }, ["Modlist"]),
        activeMl ? linkSpan(activeMl.name, () => openModlistView(activeMl)) : el("span", { class: "none" }, ["none"])]),
      el("span", {}, [el("span", { class: "ss-k" }, ["Event"]),
        el("span", {}, [`#${ev.id} — started ${fmtDuration(ev.started_at)} ago · ${ev.actions.length} action${ev.actions.length === 1 ? "" : "s"}`])]),
    ];
    main.appendChild(el("div", { class: "ss-meta" }, metaChildren));
    actions.appendChild(btn("End event", "fa-stop", "btn-ghost sm-btn", () => openEndDialog(ev)));
    actions.appendChild(btn("Live status", "fa-up-right-from-square", "btn-ghost sm-btn", () => goToTab("status")));
  } else {
    main.appendChild(el("div", { class: "ss-meta" }, [
      el("span", {}, [el("span", { class: "ss-k" }, ["Active modlist"]),
        activeMl
          ? linkSpan(activeMl.name, () => openModlistView(activeMl))
          : el("span", { class: "none" }, ["none — server boots vanilla"])]),
      el("span", {}, [el("span", { class: "ss-k" }, ["Live event"]),
        el("span", { class: "none" }, ["none yet · Phase 2c"])]),
    ]));
    actions.appendChild(btn("Live status", "fa-up-right-from-square", "btn-ghost sm-btn", () => goToTab("status")));
    actions.appendChild(btn("Browse loadouts", "fa-arrow-down", "btn-secondary sm-btn", () => {
      const grid = $("loadoutGridCard");
      window.scrollTo({ top: grid.offsetTop - 80, behavior: "smooth" });
    }));
  }

  host.appendChild(main);
  host.appendChild(actions);
}

/* ---------------- 2. LOADOUT GRID ---------------- */
function renderLoadoutGrid() {
  const grid = $("loadoutGrid");
  grid.innerHTML = "";
  const showArchived = $("showArchivedToggle") && $("showArchivedToggle").checked;
  const visible = armaState.loadouts.filter((l) => showArchived || !l.archived);

  if (visible.length === 0) {
    grid.appendChild(loadoutEmptyState());
  } else {
    for (const ld of visible) grid.appendChild(loadoutCard(ld));
  }
  grid.appendChild(newLoadoutCard());
}

function loadoutCard(ld) {
  const status = loadoutStatus(ld); // active | paused | inactive
  const ml = modlistById(ld.modlist_id);
  const card = el("article", { class: `loadout-card ${status}${ld.archived ? " archived" : ""}` });

  /* header: name + pill */
  const pill = {
    active:   el("span", { class: "ld-pill active" },   [el("span", { class: "dot" }), "Active"]),
    paused:   el("span", { class: "ld-pill paused" },   [el("span", { class: "dot" }), "Paused"]),
    inactive: el("span", { class: "ld-pill inactive" }, [el("span", { class: "dot" }), "Inactive"]),
  }[status];
  const nameWrap = el("div", {}, [
    el("div", { class: "lc-name" }, [ld.name]),
    ld.is_default ? el("span", { class: "src-badge", style: "margin-top:.3rem" }, [el("i", { class: "fas fa-house" }), "Boot default"]) : null,
  ]);
  card.appendChild(el("div", { class: "lc-head" }, [nameWrap, pill]));

  /* description */
  card.appendChild(el("div", { class: "lc-desc" }, [ld.description || ""]));

  /* info rows */
  const rows = el("div", { class: "lc-rows" });
  rows.appendChild(el("div", { class: "lc-row" }, [
    el("i", { class: "fas fa-flag-checkered lc-ico" }),
    el("span", { class: "lc-k" }, ["Mission"]),
    linkCode(ld.mission_pbo, () => { goToTab("status"); toast(`Jumped to ${ld.mission_pbo} in Installed missions`, "neutral"); }),
  ]));
  rows.appendChild(el("div", { class: "lc-row" }, [
    el("i", { class: "fas fa-cubes-stacked lc-ico" }),
    el("span", { class: "lc-k" }, ["Modlist"]),
    ml
      ? el("span", { class: "lc-v" }, [
          linkSpan(ml.name, () => openModlistView(ml)),
          el("small", {}, [`  (${fmtBytes(ml.html_bytes)} · `]),
          el("span", { class: "src-badge" }, [ml.source]),
          el("small", {}, [")"]),
        ])
      : el("span", { class: "lc-v", style: "color:var(--text-faint);font-style:italic;white-space:normal;overflow:visible" }, ["vanilla (no modlist)"]),
  ]));
  card.appendChild(rows);

  /* footer: actions */
  const foot = el("div", { class: "lc-foot" });
  foot.appendChild(btn("Apply", "fa-gear", "btn-secondary sm-btn", () => openApplyDialog(ld, false)));
  foot.appendChild(btn("Apply & restart", "fa-rocket", "btn-primary sm-btn", () => openApplyDialog(ld, true)));
  foot.appendChild(el("span", { class: "spacer" }));

  const lastTxt = status === "active" ? "Live now"
    : ld.last_run ? `Last run ${fmtRelative(ld.last_run)}` : "Never run";
  foot.appendChild(el("span", { class: "lc-last" }, [lastTxt]));
  foot.appendChild(kebab([
    { label: "Edit", icon: "fa-pen", onClick: () => openEditLoadout(ld) },
    { label: "Duplicate", icon: "fa-clone", onClick: () => duplicateLoadout(ld) },
    { sep: true },
    { label: ld.archived ? "Unarchive" : "Archive", icon: ld.archived ? "fa-box-open" : "fa-box-archive", onClick: () => toggleArchive(ld) },
    { label: "Delete", icon: "fa-trash", danger: true, onClick: () => deleteLoadout(ld) },
  ]));
  card.appendChild(foot);
  return card;
}

function newLoadoutCard() {
  return el("article", { class: "loadout-card new", role: "button", tabindex: "0",
    onclick: () => openNewLoadoutDialog(),
    onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openNewLoadoutDialog(); } } }, [
    el("div", { class: "new-ico" }, [el("i", { class: "fas fa-plus" })]),
    el("div", { class: "new-title" }, ["New loadout"]),
    el("div", { class: "new-sub" }, ["Pair a mission PBO with a modlist into a one-click preset."]),
  ]);
}

function loadoutEmptyState() {
  return el("div", { class: "loadout-empty list-armaState" }, [
    el("i", { class: "fas fa-list-check ls-ico" }),
    el("h4", {}, ["No loadouts yet"]),
    el("p", {}, ["A loadout pairs one mission PBO with one modlist so you can swap your whole server setup with a single click."]),
    btn("Create your first loadout", "fa-plus", "btn-primary", () => openNewLoadoutDialog()),
  ]);
}

/* ---------------- 3. MODLIST LIBRARY ---------------- */
function renderModlistTable() {
  const tbody = $("modlistTbody");
  tbody.innerHTML = "";
  for (const ml of armaState.modlists) {
    const isActive = armaState.server.active_modlist_id === ml.id || armaState.activeModlistId === ml.id;
    const usedBy = armaState.loadouts.filter((l) => l.modlist_id === ml.id && !l.archived);
    const tr = el("tr", {}, [
      el("td", {}, [
        el("div", { class: "dt-name" }, [ml.name]),
        el("div", { class: "dt-desc" }, [ml.description || ""]),
      ]),
      el("td", { class: "dt-num" }, [fmtBytes(ml.html_bytes)]),
      el("td", {}, [el("span", { class: "src-badge" }, [ml.source])]),
      el("td", { class: "dt-num" }, [fmtRelative(ml.updated_at)]),
      el("td", { style: "text-align:center" }, [
        el("span", { class: "active-dot" + (isActive ? "" : " off"), title: isActive ? "Active modlist" : "Not active" }),
      ]),
      el("td", { class: "dt-actions" }, [
        el("button", { class: "dt-link", onclick: () => openModlistView(ml) }, ["View"]),
        el("span", { style: "color:var(--text-faint);margin:0 .45rem" }, ["·"]),
        kebab([
          { label: "View", icon: "fa-eye", onClick: () => openModlistView(ml) },
          { label: "Replace HTML…", icon: "fa-file-arrow-up", onClick: () => openReplaceModlist(ml) },
          { label: "Rename…", icon: "fa-i-cursor", onClick: () => renameModlist(ml) },
          { label: isActive ? "Already active" : "Set as active", icon: "fa-circle-dot", onClick: () => setActiveModlist(ml) },
          { sep: true },
          { label: usedBy.length ? `Used by ${usedBy.length} loadout${usedBy.length === 1 ? "" : "s"}` : "Delete", icon: usedBy.length ? "fa-lock" : "fa-trash", danger: !usedBy.length, disabled: !!usedBy.length, onClick: () => deleteModlist(ml, usedBy) },
        ]),
      ]),
    ]);
    tbody.appendChild(tr);
  }
}

/* ---------------- 4. EVENT TIMELINE ---------------- */
function renderTimeline() {
  const host = $("eventTimeline");
  host.innerHTML = "";
  // newest first by started_at
  const evs = [...armaState.events].sort((a, b) => new Date(b.started_at) - new Date(a.started_at));
  if (evs.length === 0) {
    host.appendChild(el("div", { class: "list-armaState" }, [
      el("i", { class: "fas fa-clock-rotate-left ls-ico" }),
      el("h4", {}, ["No events yet"]),
      el("p", {}, ["Applying a loadout starts an event. Drift detections and the event lifecycle show up here."]),
    ]));
    return;
  }
  for (const ev of evs) host.appendChild(timelineGroup(ev));
}

function timelineGroup(ev) {
  // Paused state removed 2026-06 — events are either live or ended.
  const live = !ev.ended_at;
  const kind = live ? "live" : "ended";
  const ld = loadoutById(ev.loadout_id);
  const open = live;

  const badge = el("span", { class: `tl-badge ${kind}` }, [kind === "live" ? "Live" : "Ended"]);

  const rows = el("div", { class: "tl-rows" });
  for (const a of [...ev.actions].reverse()) rows.appendChild(timelineRow(a));

  const group = el("div", { class: `tl-group ${kind}${open ? " open" : ""}` });
  const head = el("div", { class: "tl-group-head" }, [
    el("span", { class: "tl-event-dot" }),
    el("i", { class: "fas fa-chevron-right disc-caret" }),
    el("span", { class: "tl-title" }, [el("span", { class: "tl-num" }, [`#${ev.id}`]), ld ? ld.name : "—"]),
    badge,
    el("span", { class: "tl-when" }, [live ? `started ${fmtDuration(ev.started_at)} ago` : fmtRelative(ev.ended_at)]),
  ]);
  head.addEventListener("click", () => { group.classList.toggle("open"); rows.hidden = !group.classList.contains("open"); });
  rows.hidden = !open;
  group.appendChild(head);
  group.appendChild(rows);
  return group;
}

const TL_ICON = { swap: "fa-arrow-right-arrow-left", end: "fa-flag-checkered", drift: "fa-triangle-exclamation" };
function timelineRow(a) {
  const row = el("div", { class: `tl-row ${a.t}` });
  row.appendChild(el("div", { class: "tl-ico" }, [el("i", { class: `fas ${TL_ICON[a.t] || "fa-circle"}` })]));
  const body = el("div", { class: "tl-body" });
  body.appendChild(el("div", { class: "tl-summary" }, [a.text]));
  body.appendChild(el("div", { class: "tl-time" }, [fmtRelative(a.at)]));
  if (a.payload) {
    let shown = false;
    const payload = el("div", { class: "tl-payload", hidden: "" }, [a.payload]);
    const exp = el("button", { class: "tl-expand", onclick: () => { shown = !shown; payload.hidden = !shown; exp.textContent = shown ? "Hide details" : "Show details"; } }, ["Show details"]);
    body.appendChild(exp);
    body.appendChild(payload);
  }
  row.appendChild(body);
  return row;
}

/* ---------------- shared small builders ---------------- */
function btn(label, icon, cls, onClick) {
  return el("button", { class: `btn ${cls}`, onclick: onClick }, [
    icon ? el("i", { class: `fas ${icon}` }) : null, label,
  ]);
}
function linkSpan(text, onClick) {
  return el("button", { class: "dt-link", onclick: (e) => { e.stopPropagation(); onClick(); } }, [text]);
}
function linkCode(text, onClick) {
  return el("code", { class: "lc-v", style: "cursor:pointer", onclick: (e) => { e.stopPropagation(); onClick(); }, title: "Jump to Server status → Installed missions" }, [text]);
}

/* kebab popover menu */
function kebab(items) {
  const wrap = el("div", { class: "kebab-wrap" });
  const trigger = el("button", { class: "btn btn-ghost icon-btn", title: "More", "aria-label": "More actions" }, [el("i", { class: "fas fa-ellipsis-vertical" })]);
  let menu = null;
  const hostCard = () => wrap.closest(".loadout-card");
  function close() {
    if (!menu) return;
    menu.remove();
    menu = null;
    const host = hostCard();
    if (host) host.classList.remove("kebab-open");
    document.removeEventListener("click", onDoc, true);
  }
  function onDoc(e) { if (menu && !wrap.contains(e.target)) close(); }
  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    if (menu) { close(); return; }
    document.querySelectorAll(".kebab-menu").forEach((m) => m.remove());
    document.querySelectorAll(".loadout-card.kebab-open").forEach((c) => c.classList.remove("kebab-open"));
    menu = el("div", { class: "kebab-menu" });
    for (const it of items) {
      if (!it) continue;
      if (it.sep) { menu.appendChild(el("div", { class: "menu-sep" })); continue; }
      const b = el("button", { class: it.danger ? "danger" : "", disabled: it.disabled ? "" : null,
        onclick: (ev) => { ev.stopPropagation(); if (it.disabled) return; close(); it.onClick(); } },
        [el("i", { class: `fas ${it.icon}` }), it.label]);
      menu.appendChild(b);
    }
    wrap.appendChild(menu);
    const host = hostCard();
    if (host) host.classList.add("kebab-open");
    setTimeout(() => document.addEventListener("click", onDoc, true), 0);
  });
  wrap.appendChild(trigger);
  return wrap;
}

/* drift indicator on sidebar tab + tab banner handled in strip */
function updateDriftIndicator() {
  const tabBtn = document.querySelector('.tab-btn[data-tab="arma"]');
  if (!tabBtn) return;
  let dot = tabBtn.querySelector(".drift-dot");
  const drift = !!liveSnap().drift;
  if (drift && !dot) tabBtn.appendChild(el("span", { class: "drift-dot", title: "Drift detected" }));
  if (!drift && dot) dot.remove();
}

/* expand the timeline card programmatically */
function openTimeline() {
  const card = $("eventTimelineCard");
  card.classList.add("open");
  $("eventTimelineBody").hidden = false;
  window.scrollTo({ top: card.offsetTop - 80, behavior: "smooth" });
}
