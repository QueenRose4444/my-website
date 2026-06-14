/* ============================================================
 * app.js — bootstrap, element cache, events, routing, lifecycle
 * ============================================================ */

const EL_IDS = [
  "loginBtn", "loginBtnLarge", "loggedInBox", "logoutBtn", "userAvatar", "userName",
  "sidebar", "botPicker", "guildPicker",
  "loginPanel", "emptyGuildPanel", "bootPanel",
  "settingsPanel", "missionsPanel", "composePanel", "templatesPanel", "armaManagementPanel",
  "embedsPanel", "rolesPanel",
  "settingsGuildName", "missionsGuildName", "composeGuildName", "templatesGuildName", "armaManagementGuildName",
  "armaPreviewBanner", "armaScenarioSeg",
  // settings
  "settingsSaveBtn", "defaultOptIn", "optInSub", "remindersChips", "defaultTimezone",
  "rsvpChannel", "autoroleRole", "monitoredRoles", "addRolePicker", "addRoleBtn",
  "detectionRules", "addRuleBtn", "modlistChannel", "modlistChannelChips", "modlistChannelPicker", "modlistCurrent", "modlistUpdated",
  "modlistEditBtn", "modlistClearBtn",
  "ruleDialog", "ruleForm", "ruleMatch", "ruleTemplate", "ruleAllKinds", "rulePriority", "ruleCancelBtn",
  "modlistDialog", "modlistForm", "modlistUrlInput", "modlistTextInput", "modlistCancelBtn",
  "missionModlistDialog", "missionModlistForm", "missionModlistUrl", "missionModlistText", "missionModlistCancelBtn",
  // missions
  "missionsSeg", "missionsList",
  "missionDrawer", "drawerTitle", "drawerBody", "drawerClose", "drawerCancel", "drawerReschedule", "drawerRemind", "drawerCloseBtn",
  "rescheduleDialog", "rescheduleForm", "rescheduleWhen", "rescheduleTz", "rescheduleCancelBtn",
  // compose
  "composeSubmitBtn", "composeChannel", "composeRolePicker", "composeRoleChips",
  "composeWhen", "composeTz", "composeTitle", "composeBody", "composeTemplate",
  "composeModlistUrl", "composeModlistText",
  "composeModlistLibrary", "composeModlistFile", "composeModlistNewName",
  // templates
  "templatesSeg", "templatesList", "newTemplateBtn", "templateEditor", "editorEmpty", "previewPane",
  "tplName", "tplIsDefault", "tplColorPicker", "tplColor", "tplAuthorName", "tplAuthorIcon",
  "tplTitle", "tplUrl", "tplDescription", "tplContent", "tplFields", "tplAddField",
  "tplFooterText", "tplFooterIcon", "tplThumb", "tplImage", "tplTimestamp",
  "tplRoleBindings", "tplRoleBindPicker", "tplRoleBindBtn", "tplBindLocked", "tplPlaceholders",
  "tplDeleteBtn", "tplDuplicateBtn", "tplSaveBtn", "tplPreview", "previewContext", "previewFraming",
  // embeds + roles (Phase 1+2 2026-06)
  "embedsGuildName", "embedsNewBtn", "embedsList",
  "embedsListView", "embedsEditorView", "embedsEditorBody", "embedsEditorTitle",
  "embedsBackBtn", "embedsCancelBtn", "embedsSaveBtn", "embedsSaveLabel",
  "embedsChannelFilter", "embedsViewSeg",
  "rolesGuildName", "rolesNewBtn", "rolesRefreshBtn", "rolesList", "rolesPermBanner", "rolesPermMessage",
  "reactionRolesCard", "reactionRolesToggle", "reactionRolesBody", "reactionRolesNewBtn", "reactionRolesList",
  // status
  "statusPanel", "statusGuildName", "statusSaveBtn", "statusEmpty", "statusAddBtn", "statusBody",
  "ptPanelUrl", "ptClientKey", "ptKeyToggle", "ptServerId", "ptDisplayName", "ptPollInterval",
  "statusTestBtn", "statusTestResult", "statusSummaryChannel", "statusNameTemplate", "statusNamePreview",
  "statusTemplateTokens",
  "statusDetailChannel", "statusPolledAt", "statusState", "statusRefreshBtn",
  "statusEnabled", "statusDeleteBtn",
  "statusSummaryChannelManual", "statusDetailChannelManual",
  "statusImportExportToggle", "statusImportExportBody",
  "statusJsonBlob", "statusJsonExportBtn", "statusJsonImportBtn", "statusJsonCopyBtn",
  "statusRestartBtn",
  "missionPboFile", "missionPboName", "missionPboRestart", "missionPboUploadBtn", "missionPboResult",
  "a2sEnabled", "a2sHost", "a2sPort",
  "missionsInstalledRefreshBtn", "missionsInstalledList",
  "pushModlistBtn", "pushModlistResult",
  "uploadModlistFile", "uploadModlistSaveAsCurrent", "uploadModlistBtn", "uploadModlistResult",
  // misc
  "tzList", "toastHost",
];

document.addEventListener("DOMContentLoaded", init);

function init() {
  EL_IDS.forEach((id) => { els[id] = $(id); });
  els.tabBtns = document.querySelectorAll(".tab-btn");

  populateTimezoneList();
  renderPlaceholderTokens();
  renderPreviewContextOptions();
  bindEvents();
  hydrateFromStorage();
  bootstrapAuthConfig();
  refreshUI();
  handleOAuthCallback();
  if (state.user) loadMyContext();
}

/* ---------------- timezone datalist ---------------- */
// Curated timezone list: ONE entry per distinct (offset, region) combination
// with BOTH the standard and daylight abbreviations + offsets surfaced. We
// can't reliably auto-derive "AEST/AEDT" from Intl alone — the browser only
// reports the abbrev currently in effect — so the map below names them
// explicitly for each region that has DST.
//
// Sort order is by standard-offset descending (NZ → Sydney → Tokyo → … → LA).
// `iana` is the canonical IANA tz stored when this option is picked.
const _TZ_CATALOG = [
  { iana: "Pacific/Auckland",     stdAbbr: "NZST", dstAbbr: "NZDT", stdOff: "+12",    dstOff: "+13",    city: "Auckland" },
  { iana: "Pacific/Honolulu",     stdAbbr: "HST",  dstAbbr: null,   stdOff: "-10",    dstOff: null,     city: "Honolulu" },
  { iana: "Australia/Sydney",     stdAbbr: "AEST", dstAbbr: "AEDT", stdOff: "+10",    dstOff: "+11",    city: "Sydney" },
  { iana: "Australia/Brisbane",   stdAbbr: "AEST", dstAbbr: null,   stdOff: "+10",    dstOff: null,     city: "Brisbane" },
  { iana: "Australia/Adelaide",   stdAbbr: "ACST", dstAbbr: "ACDT", stdOff: "+09:30", dstOff: "+10:30", city: "Adelaide" },
  { iana: "Australia/Darwin",     stdAbbr: "ACST", dstAbbr: null,   stdOff: "+09:30", dstOff: null,     city: "Darwin" },
  { iana: "Australia/Perth",      stdAbbr: "AWST", dstAbbr: null,   stdOff: "+08",    dstOff: null,     city: "Perth" },
  { iana: "Asia/Tokyo",           stdAbbr: "JST",  dstAbbr: null,   stdOff: "+09",    dstOff: null,     city: "Tokyo" },
  { iana: "Asia/Seoul",           stdAbbr: "KST",  dstAbbr: null,   stdOff: "+09",    dstOff: null,     city: "Seoul" },
  { iana: "Asia/Singapore",       stdAbbr: "SGT",  dstAbbr: null,   stdOff: "+08",    dstOff: null,     city: "Singapore" },
  { iana: "Asia/Hong_Kong",       stdAbbr: "HKT",  dstAbbr: null,   stdOff: "+08",    dstOff: null,     city: "Hong Kong" },
  { iana: "Asia/Bangkok",         stdAbbr: "ICT",  dstAbbr: null,   stdOff: "+07",    dstOff: null,     city: "Bangkok" },
  { iana: "Asia/Kolkata",         stdAbbr: "IST",  dstAbbr: null,   stdOff: "+05:30", dstOff: null,     city: "Kolkata (Mumbai)" },
  { iana: "Asia/Dubai",           stdAbbr: "GST",  dstAbbr: null,   stdOff: "+04",    dstOff: null,     city: "Dubai" },
  { iana: "Europe/Moscow",        stdAbbr: "MSK",  dstAbbr: null,   stdOff: "+03",    dstOff: null,     city: "Moscow" },
  { iana: "Europe/Berlin",        stdAbbr: "CET",  dstAbbr: "CEST", stdOff: "+01",    dstOff: "+02",    city: "Berlin (Paris/Rome/Madrid)" },
  { iana: "Europe/London",        stdAbbr: "GMT",  dstAbbr: "BST",  stdOff: "+00",    dstOff: "+01",    city: "London" },
  { iana: "Europe/Dublin",        stdAbbr: "GMT",  dstAbbr: "IST",  stdOff: "+00",    dstOff: "+01",    city: "Dublin" },
  { iana: "UTC",                  stdAbbr: "UTC",  dstAbbr: null,   stdOff: "+00",    dstOff: null,     city: "UTC" },
  { iana: "Atlantic/Azores",      stdAbbr: "AZOT", dstAbbr: "AZOST",stdOff: "-01",    dstOff: "+00",    city: "Azores" },
  { iana: "America/Sao_Paulo",    stdAbbr: "BRT",  dstAbbr: null,   stdOff: "-03",    dstOff: null,     city: "São Paulo" },
  { iana: "America/Halifax",      stdAbbr: "AST",  dstAbbr: "ADT",  stdOff: "-04",    dstOff: "-03",    city: "Halifax" },
  { iana: "America/New_York",     stdAbbr: "EST",  dstAbbr: "EDT",  stdOff: "-05",    dstOff: "-04",    city: "New York (Toronto)" },
  { iana: "America/Chicago",      stdAbbr: "CST",  dstAbbr: "CDT",  stdOff: "-06",    dstOff: "-05",    city: "Chicago (Mexico City)" },
  { iana: "America/Denver",       stdAbbr: "MST",  dstAbbr: "MDT",  stdOff: "-07",    dstOff: "-06",    city: "Denver" },
  { iana: "America/Phoenix",      stdAbbr: "MST",  dstAbbr: null,   stdOff: "-07",    dstOff: null,     city: "Phoenix" },
  { iana: "America/Los_Angeles",  stdAbbr: "PST",  dstAbbr: "PDT",  stdOff: "-08",    dstOff: "-07",    city: "Los Angeles (Vancouver)" },
  { iana: "America/Anchorage",    stdAbbr: "AKST", dstAbbr: "AKDT", stdOff: "-09",    dstOff: "-08",    city: "Anchorage" },
];

// Get the abbreviation Intl reports as currently in effect for a tz, so we
// can dim/bold the relevant half of the AEST/AEDT pair.
function _currentTzAbbrev(iana) {
  try {
    const parts = new Intl.DateTimeFormat("en-AU", { timeZone: iana, timeZoneName: "short" }).formatToParts(new Date());
    return parts.find((p) => p.type === "timeZoneName")?.value || "";
  } catch { return ""; }
}
function _currentTimeInTz(iana) {
  try {
    const parts = new Intl.DateTimeFormat("en-AU", {
      timeZone: iana, hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(new Date());
    return (parts.find((p) => p.type === "hour")?.value || "??") + ":" +
           (parts.find((p) => p.type === "minute")?.value || "??");
  } catch { return "??:??"; }
}

// Build the label "AEST/AEDT  +10/+11  Sydney · 19:23 now"
function _tzLabel(entry) {
  const time = _currentTimeInTz(entry.iana);
  let abbr = entry.stdAbbr;
  let off = entry.stdOff;
  if (entry.dstAbbr) {
    abbr = `${entry.stdAbbr}/${entry.dstAbbr}`;
    off = `${entry.stdOff}/${entry.dstOff}`;
  }
  return `${abbr}  ${off}  ${entry.city} · ${time} now`;
}

function populateTimezoneList() {
  // Datalist for the compose/reschedule inline inputs — full IANA set so any
  // typed value autocompletes.
  const allTzs = (Intl.supportedValuesOf && Intl.supportedValuesOf("timeZone")) || _TZ_CATALOG.map((e) => e.iana);
  els.tzList.innerHTML = allTzs.map((t) => `<option value="${t}"></option>`).join("");

  if (els.defaultTimezone && els.defaultTimezone.tagName === "SELECT") {
    const local = localTimezone();
    const localEntry = _TZ_CATALOG.find((e) => e.iana === local);
    const localLabel = localEntry ? _tzLabel(localEntry) : `${local} · ${_currentTimeInTz(local)} now`;
    const mkOpt = (e) => `<option value="${escapeHtml(e.iana)}">${escapeHtml(_tzLabel(e))}</option>`;
    const parts = [
      `<option value="">(use local — ${escapeHtml(localLabel)})</option>`,
      `<optgroup label="Curated regions (one per offset; both DST + standard shown)">`,
      ..._TZ_CATALOG.map(mkOpt),
      `</optgroup>`,
    ];
    // Also include an "All IANA timezones" group at the bottom in case the
    // admin needs a tz that isn't curated (e.g. America/Argentina/Salta).
    const curatedSet = new Set(_TZ_CATALOG.map((e) => e.iana));
    const rest = allTzs.filter((t) => !curatedSet.has(t)).sort();
    if (rest.length) {
      parts.push(`<optgroup label="All IANA timezones (full list)">`);
      parts.push(...rest.map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)} · ${escapeHtml(_currentTimeInTz(t))} now</option>`));
      parts.push(`</optgroup>`);
    }
    els.defaultTimezone.innerHTML = parts.join("");
    // Default to "use local" placeholder when nothing is saved.
  }
  els.rescheduleTz.value = localTimezone();
  els.composeTz.value = localTimezone();
}

/* ---------------- events ---------------- */
function bindEvents() {
  els.loginBtn.addEventListener("click", startOAuth);
  els.loginBtnLarge.addEventListener("click", startOAuth);
  els.logoutBtn.addEventListener("click", logout);

  els.botPicker.addEventListener("change", async () => {
    state.selectedBot = els.botPicker.value || null;
    state.rolesCache = [];
    renderGuildPicker();
    persistUIState();
    refreshUI();
    await loadActiveTab();
  });
  els.guildPicker.addEventListener("change", async () => {
    state.selectedGuild = els.guildPicker.value || null;
    state.pendingSettings = null;
    state.rolesCache = [];
    state.editingTemplate = null;
    closeTemplateEditor();
    persistUIState();
    refreshUI();
    await loadActiveTab();
  });

  // tabs (data-driven via data-target — bug H)
  els.tabBtns.forEach((b) =>
    b.addEventListener("click", () => goToTab(b.dataset.tab)));

  // sidebar groups: collapse/expand, persisted to localStorage. Auto-expand
  // a collapsed group when one of its children becomes the active tab so the
  // user can never "lose" the active button behind a collapsed header.
  document.querySelectorAll(".sidebar-group").forEach((g) => {
    const key = `sidebar-group:${g.dataset.group}`;
    if (localStorage.getItem(key) === "collapsed") g.classList.add("collapsed");
    const header = g.querySelector(".sidebar-group-header");
    header.addEventListener("click", () => {
      g.classList.toggle("collapsed");
      header.setAttribute("aria-expanded", String(!g.classList.contains("collapsed")));
      localStorage.setItem(key, g.classList.contains("collapsed") ? "collapsed" : "open");
    });
  });

  // missions segment
  els.missionsSeg.querySelectorAll(".seg-btn").forEach((b) =>
    b.addEventListener("click", async () => { state.missionsState = b.dataset.state; await loadMissions(); }));

  // templates kind segment
  els.templatesSeg.querySelectorAll(".seg-btn").forEach((b) =>
    b.addEventListener("click", async () => {
      els.templatesSeg.querySelectorAll(".seg-btn").forEach((x) => x.classList.toggle("active", x === b));
      state.templatesKind = b.dataset.kind;
      closeTemplateEditor();
      setKindFramingDefault();
      await loadTemplates();
    }));

  // settings
  els.defaultOptIn.addEventListener("change", () => { updateOptInSub(); markDirty({ default_opt_in: els.defaultOptIn.checked }); });
  els.defaultTimezone.addEventListener("change", () => {
    // Empty value = "(use local — Etc/GMT-8)" placeholder. Resolve to the
    // browser's local IANA timezone so the backend gets a valid string.
    const raw = (els.defaultTimezone.value || "").trim();
    markDirty({ default_timezone: raw || localTimezone() });
  });
  els.rsvpChannel.addEventListener("change", () => markDirty({ rsvp_channel_id: els.rsvpChannel.value || 0 }));
  els.settingsSaveBtn.addEventListener("click", saveSettings);
  els.addRoleBtn.addEventListener("click", addRole);

  // detection rules
  els.addRuleBtn.addEventListener("click", () => openRuleDialog(null));
  els.ruleForm.addEventListener("submit", submitRule);
  els.ruleCancelBtn.addEventListener("click", () => els.ruleDialog.close());
  els.ruleDialog.addEventListener("click", (e) => { if (e.target === els.ruleDialog) els.ruleDialog.close(); });
  els.ruleAllKinds.addEventListener("change", () => populateRuleTemplatePicker(els.ruleTemplate.value));

  // modlist
  // Legacy single-channel picker — removed in v2 in favour of the chip-list
  // (modlistChannelChips + modlistChannelPicker). Element may not exist.
  if (els.modlistChannel) {
    els.modlistChannel.addEventListener("change", () => {
      markDirty({ modlist_channel_id: els.modlistChannel.value || 0 });
    });
  }
  els.modlistEditBtn.addEventListener("click", openModlistDialog);
  els.modlistClearBtn.addEventListener("click", clearModlist);
  els.modlistForm.addEventListener("submit", submitModlist);
  els.modlistCancelBtn.addEventListener("click", () => els.modlistDialog.close());
  els.modlistDialog.addEventListener("click", (e) => { if (e.target === els.modlistDialog) els.modlistDialog.close(); });

  // mission modlist override
  els.missionModlistForm.addEventListener("submit", submitMissionModlist);
  els.missionModlistCancelBtn.addEventListener("click", () => els.missionModlistDialog.close());
  els.missionModlistDialog.addEventListener("click", (e) => { if (e.target === els.missionModlistDialog) els.missionModlistDialog.close(); });

  // mission drawer
  els.drawerClose.addEventListener("click", () => els.missionDrawer.close());
  els.drawerCloseBtn.addEventListener("click", () => els.missionDrawer.close());
  els.drawerCancel.addEventListener("click", cancelMissionFromDrawer);
  els.drawerReschedule.addEventListener("click", openRescheduleDialog);
  if (els.drawerRemind) els.drawerRemind.addEventListener("click", remindMissionFromDrawer);
  els.missionDrawer.addEventListener("click", (e) => { if (e.target === els.missionDrawer) els.missionDrawer.close(); });
  els.rescheduleForm.addEventListener("submit", submitReschedule);
  els.rescheduleCancelBtn.addEventListener("click", () => els.rescheduleDialog.close());
  els.rescheduleDialog.addEventListener("click", (e) => { if (e.target === els.rescheduleDialog) els.rescheduleDialog.close(); });

  // compose
  els.composeSubmitBtn.addEventListener("click", submitNewMission);
  els.composeRolePicker.addEventListener("change", () => {
    const id = els.composeRolePicker.value;
    if (!id) return;
    if (!state.composeRoleIds.includes(id)) state.composeRoleIds.push(id);
    els.composeRolePicker.value = "";
    renderComposeRoleChips();
  });

  // templates editor
  els.newTemplateBtn.addEventListener("click", newTemplate);
  els.tplSaveBtn.addEventListener("click", saveTemplate);
  els.tplDeleteBtn.addEventListener("click", deleteTemplateClicked);
  els.tplDuplicateBtn.addEventListener("click", duplicateTemplate);
  els.tplAddField.addEventListener("click", () => {
    const t = state.editingTemplate; if (!t) return;
    t.json_blob.fields = t.json_blob.fields || [];
    t.json_blob.fields.push({ name: "Field", value: "Value", inline: false });
    renderFieldsEditor(); renderTemplatePreview();
  });
  els.tplColorPicker.addEventListener("input", () => { els.tplColor.value = els.tplColorPicker.value; syncEditorToTemplate(); });
  els.tplColor.addEventListener("input", () => {
    const v = els.tplColor.value.trim();
    if (/^#?[0-9a-fA-F]{6}$/.test(v)) els.tplColorPicker.value = v.startsWith("#") ? v : "#" + v;
    syncEditorToTemplate();
  });
  ["tplName", "tplIsDefault", "tplAuthorName", "tplAuthorIcon", "tplTitle", "tplUrl",
   "tplDescription", "tplContent", "tplFooterText", "tplFooterIcon", "tplThumb", "tplImage", "tplTimestamp"]
    .forEach((id) => { els[id].addEventListener("input", syncEditorToTemplate); els[id].addEventListener("change", syncEditorToTemplate); });
  els.tplRoleBindBtn.addEventListener("click", bindRoleToTemplate);
  registerTokenTargets();

  // preview controls
  els.previewContext.addEventListener("change", () => { state.previewContextKey = els.previewContext.value; renderTemplatePreview(); });
  els.previewFraming.querySelectorAll(".seg-btn").forEach((b) =>
    b.addEventListener("click", () => {
      els.previewFraming.querySelectorAll(".seg-btn").forEach((x) => x.classList.toggle("active", x === b));
      state.previewFraming = b.dataset.framing;
      renderTemplatePreview();
    }));

  // server status
  els.statusAddBtn.addEventListener("click", addArmaServer);
  els.statusSaveBtn.addEventListener("click", saveArmaServer);
  els.statusTestBtn.addEventListener("click", testArmaConnection);
  els.statusRefreshBtn.addEventListener("click", refreshArmaState);
  els.statusDeleteBtn.addEventListener("click", deleteArmaServer);
  els.statusNameTemplate.addEventListener("input", renderNamePreview);
  els.ptDisplayName.addEventListener("input", renderNamePreview);
  // Keep picker and manual-ID input in sync both directions.
  bindChannelPair(els.statusSummaryChannel, els.statusSummaryChannelManual);
  bindChannelPair(els.statusDetailChannel, els.statusDetailChannelManual);
  // Click any token chip to insert it at the cursor position in the template.
  els.statusTemplateTokens.addEventListener("click", (e) => {
    const btn = e.target.closest(".token-chip");
    if (!btn) return;
    insertAtCursor(els.statusNameTemplate, btn.dataset.token);
    renderNamePreview();
  });
  els.ptKeyToggle.addEventListener("click", () => {
    const t = els.ptClientKey.type === "password" ? "text" : "password";
    els.ptClientKey.type = t;
    els.ptKeyToggle.innerHTML = `<i class="fas ${t === "password" ? "fa-eye" : "fa-eye-slash"}"></i>`;
  });
  // Import / export
  els.statusImportExportToggle.addEventListener("click", () => {
    els.statusImportExportBody.hidden = !els.statusImportExportBody.hidden;
  });
  els.statusJsonExportBtn.addEventListener("click", exportArmaToJson);
  els.statusJsonImportBtn.addEventListener("click", importArmaFromJson);
  els.statusJsonCopyBtn.addEventListener("click", copyArmaJsonToClipboard);
  // Mission upload + power
  els.statusRestartBtn.addEventListener("click", restartArmaServer);
  els.missionPboUploadBtn.addEventListener("click", uploadMissionPbo);
  els.missionPboFile.addEventListener("change", () => {
    // Suggest the picked file's name as the filename override (admin can edit).
    const f = els.missionPboFile.files && els.missionPboFile.files[0];
    if (f && !els.missionPboName.value) els.missionPboName.value = f.name;
  });
  els.missionsInstalledRefreshBtn.addEventListener("click", loadInstalledMissions);
  els.pushModlistBtn.addEventListener("click", pushModlistToArma);
  els.uploadModlistBtn.addEventListener("click", uploadModlistToArma);
}

/* ---------------- tab routing ---------------- */
function goToTab(tab) {
  if (state.selectedGuild == null) return; // tabs locked until a guild is selected
  state.activeTab = tab;
  els.tabBtns.forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  // Auto-expand a collapsed group if the active tab lives inside it.
  const activeBtn = [...els.tabBtns].find((b) => b.dataset.tab === tab);
  const parentGroup = activeBtn && activeBtn.closest(".sidebar-group");
  if (parentGroup && parentGroup.classList.contains("collapsed")) {
    parentGroup.classList.remove("collapsed");
    parentGroup.querySelector(".sidebar-group-header").setAttribute("aria-expanded", "true");
    localStorage.setItem(`sidebar-group:${parentGroup.dataset.group}`, "open");
  }
  persistUIState();
  refreshUI();
  loadActiveTab();
}

async function loadActiveTab() {
  if (!state.ready || !state.selectedBot || !state.selectedGuild) { state.pendingLoad = true; return; }
  if (state.activeTab === "settings") await loadSettings();
  else if (state.activeTab === "missions") await loadMissions();
  else if (state.activeTab === "compose") await loadComposeForm();
  else if (state.activeTab === "templates") await loadTemplates();
  else if (state.activeTab === "embeds") await loadEmbedsTab();
  else if (state.activeTab === "roles") await loadRolesTab();
  else if (state.activeTab === "arma-management") loadArmaManagement();
  else if (state.activeTab === "status") await loadArmaServers();
}

/* ---------------- Arma Management tab ---------------- */
let _armaTabInitialised = false;
let _armaRefreshTimer = null;
const _ARMA_REFRESH_MS = 30_000;
async function loadArmaManagement() {
  if (!_armaTabInitialised) {
    initArmaTabOnce();
    _armaTabInitialised = true;
  }
  try {
    if (typeof fetchArmaServerLiveState === "function") await fetchArmaServerLiveState();
    if (typeof fetchModlistsFromApi === "function") await fetchModlistsFromApi();
    if (typeof fetchLoadoutsFromApi === "function") await fetchLoadoutsFromApi();
    if (typeof fetchInstalledMissionsForLibrary === "function") await fetchInstalledMissionsForLibrary();
    if (typeof fetchEventsFromApi === "function") await fetchEventsFromApi();
  } catch (e) {
    toast(`Couldn't load Arma Management: ${e.message || e}`, "error");
  }
  if (typeof renderArma === "function") renderArma();

  // Periodic refresh so drift transitions + live-state changes show up
  // without the admin switching tabs. Matches the bot's poll cadence.
  if (_armaRefreshTimer) clearInterval(_armaRefreshTimer);
  _armaRefreshTimer = setInterval(async () => {
    if (state.activeTab !== "arma-management") {
      clearInterval(_armaRefreshTimer);
      _armaRefreshTimer = null;
      return;
    }
    try {
      if (typeof fetchArmaServerLiveState === "function") await fetchArmaServerLiveState();
      if (typeof fetchEventsFromApi === "function") await fetchEventsFromApi();
      if (typeof renderArma === "function") renderArma();
    } catch { /* swallow background-refresh errors */ }
  }, _ARMA_REFRESH_MS);
}

function initArmaTabOnce() {
  // Collapsibles for missions library + modlist library + event timeline
  // (mirrors shell.js from the design output, minus the standalone bootstrap).
  bindCollapsible("missionsLibraryCard", "missionsLibraryToggle", "missionsLibraryBody");
  bindCollapsible("modlistLibraryCard", "modlistLibraryToggle", "modlistLibraryBody");
  bindCollapsible("armaTokensCard", "armaTokensToggle", "armaTokensBody");
  bindCollapsible("eventTimelineCard", "eventTimelineToggle", "eventTimelineBody");
  const newTokenBtn = $("newArmaTokenBtn");
  if (newTokenBtn) newTokenBtn.addEventListener("click", openGenerateArmaTokenDialog);
  const refreshTokensBtn = $("refreshArmaTokensBtn");
  if (refreshTokensBtn) refreshTokensBtn.addEventListener("click", renderArmaTokensTable);
  // Mission upload + refresh buttons in the Installed missions card.
  const upBtn = $("uploadMissionPboBtn");
  if (upBtn) upBtn.addEventListener("click", openMissionPboUploadDialog);
  const refBtn = $("refreshMissionsListBtn");
  if (refBtn) refBtn.addEventListener("click", async () => {
    await fetchInstalledMissionsForLibrary();
    renderMissionsTable();
  });
  // New-loadout / new-modlist buttons (handlers in arma_dialogs.js).
  const nl = $("newLoadoutBtn"); if (nl) nl.addEventListener("click", () => openNewLoadoutDialog());
  const nm = $("newModlistBtn"); if (nm) nm.addEventListener("click", () => openNewModlist());
  const arch = $("showArchivedToggle");
  if (arch) arch.addEventListener("change", () => { if (typeof renderLoadoutGrid === "function") renderLoadoutGrid(); });
  // Preview scenario picker (mock data only — until v2 backend is built).
  const seg = els.armaScenarioSeg;
  if (seg) {
    seg.addEventListener("click", (e) => {
      const b = e.target.closest(".seg-btn"); if (!b) return;
      seg.querySelectorAll(".seg-btn").forEach((x) => x.classList.toggle("active", x === b));
      if (typeof setScenario === "function") setScenario(b.dataset.scenario);
      if (typeof renderArma === "function") renderArma();
    });
  }
}

function bindCollapsible(cardId, toggleId, bodyId) {
  const card = $(cardId), toggle = $(toggleId), body = $(bodyId);
  if (!card || !toggle || !body) return;
  toggle.addEventListener("click", () => {
    const open = !card.classList.contains("open");
    card.classList.toggle("open", open);
    body.hidden = !open;
  });
}

/* ---------------- pickers ---------------- */
function renderBotPicker() {
  // If a stored selectedBot is no longer in the list, fall back to the first
  // available — keeps refresh-persistence working without leaving a stale pick.
  if (state.bots.length && (!state.selectedBot || !state.bots.some((b) => b.name === state.selectedBot))) {
    state.selectedBot = state.bots[0].name;
  }
  els.botPicker.innerHTML = state.bots.map((b) =>
    `<option value="${b.name}" ${b.name === state.selectedBot ? "selected" : ""}>${escapeHtml(b.label)}</option>`).join("");
}

function renderGuildPicker() {
  const list = state.guilds.filter((g) => g.bot_name === state.selectedBot);
  if (!list.length) { els.guildPicker.innerHTML = `<option value="">(no servers)</option>`; state.selectedGuild = null; return; }
  if (!state.selectedGuild || !list.some((g) => g.guild_id === state.selectedGuild)) state.selectedGuild = list[0].guild_id;
  els.guildPicker.innerHTML = list.map((g) =>
    `<option value="${g.guild_id}" ${g.guild_id === state.selectedGuild ? "selected" : ""}>${escapeHtml(g.name)}</option>`).join("");
}

/* ---------------- refreshUI ---------------- */
const CONTENT_PANELS = ["loginPanel", "emptyGuildPanel", "bootPanel", "settingsPanel", "missionsPanel", "composePanel", "templatesPanel", "embedsPanel", "rolesPanel", "armaManagementPanel", "statusPanel"];

function refreshUI() {
  const loggedIn = !!state.user;
  els.loginBtn.hidden = loggedIn;
  els.loggedInBox.hidden = !loggedIn;
  if (loggedIn) {
    els.userName.textContent = state.user.username || "User";
    els.userAvatar.src = userAvatarUrl(state.user);
  }

  const hasGuild = !!state.selectedGuild;
  els.sidebar.classList.toggle("locked", !hasGuild);
  CONTENT_PANELS.forEach((p) => { els[p].hidden = true; });

  if (!loggedIn) { els.loginPanel.hidden = false; return; }
  if (!state.ready) { els.bootPanel.hidden = false; return; }
  if (!hasGuild) { els.emptyGuildPanel.hidden = false; return; }

  // data-driven: show the panel whose tab matches activeTab AND highlight its
  // sidebar button (refreshUI runs on every state change, including hydrate
  // from localStorage on page load — without this the activeTab gets restored
  // but the button stays on whichever was active before).
  const activeBtn = [...els.tabBtns].find((b) => b.dataset.tab === state.activeTab) || els.tabBtns[0];
  els.tabBtns.forEach((b) => b.classList.toggle("active", b === activeBtn));
  const targetId = activeBtn ? activeBtn.dataset.target : "settingsPanel";
  if (els[targetId]) els[targetId].hidden = false;

  const guildName = (state.guilds.find((g) => g.guild_id === state.selectedGuild) || {}).name || "";
  const sub = guildName ? guildName : "";
  els.settingsGuildName.textContent = sub;
  els.missionsGuildName.textContent = sub;
  els.composeGuildName.textContent = sub;
  els.templatesGuildName.textContent = sub;
  if (els.armaManagementGuildName) els.armaManagementGuildName.textContent = sub;
  els.statusGuildName.textContent = sub;
}
