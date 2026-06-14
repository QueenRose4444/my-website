/* ============================================================
 * settings.js — Server settings page
 * ============================================================ */

async function loadSettings() {
  if (!state.selectedBot || !state.selectedGuild) return;
  const base = `/bots/${state.selectedBot}/guilds/${state.selectedGuild}`;
  // loading skeleton for monitored roles
  els.monitoredRoles.innerHTML = `<span class="skel" style="width:120px;height:30px;border-radius:999px"></span><span class="skel" style="width:90px;height:30px;border-radius:999px"></span>`;
  try {
    const data = await api(`${base}/settings`);
    const s = data.settings;

    els.defaultOptIn.checked = !!s.default_opt_in;
    updateOptInSub();
    renderRemindersChips((s.default_reminders || "").split(",").filter(Boolean).map(Number));
    els.defaultTimezone.value = s.default_timezone || "";

    state.pendingSettings = null;
    els.settingsSaveBtn.disabled = true;

    // channels for RSVP picker
    const chans = await api(`${base}/channels`);
    els.rsvpChannel.innerHTML = `<option value="">(none)</option>` + chans.channels.map((c) =>
      `<option value="${c.id}" ${String(s.rsvp_channel_id) === String(c.id) ? "selected" : ""}>#${escapeHtml(c.name)}</option>`
    ).join("");

    // E6 (2026-06): autorole picker — list every available role.
    if (els.autoroleRole) {
      els.autoroleRole.innerHTML = `<option value="">(disabled)</option>` + (data.available_roles || []).map((r) =>
        `<option value="${r.id}" ${String(s.autorole_role_id) === String(r.id) ? "selected" : ""}>${escapeHtml(r.name)}</option>`
      ).join("");
      els.autoroleRole.onchange = () => markDirty({ autorole_role_id: Number(els.autoroleRole.value) || 0 });
    }

    renderMonitoredRoles(data.monitored_roles, data.available_roles);

    // populate channel-backed pickers shared by RSVP + modlist (legacy single
    // hidden; v2 multi-chip below).
    const modlistChan = $("modlistChannel");
    if (modlistChan) {
      modlistChan.innerHTML = `<option value="">(none)</option>` + chans.channels.map((c) =>
        `<option value="${c.id}">#${escapeHtml(c.name)}</option>`).join("");
    }
    // v2 multi-channel chip picker
    state._modlistChannelIds = Array.isArray(s.modlist_channel_ids)
      ? s.modlist_channel_ids.map(String) : [];
    state._channelsForPicker = chans.channels;
    renderModlistChannelChips();

    // new sections (fire-and-forget; they manage their own skeleton/error)
    state.rolesCache = data.available_roles || [];
    loadDetectionRules();
    loadModlist();
  } catch (e) {
    els.monitoredRoles.innerHTML = `<span class="role-empty">Couldn't load settings.</span>`;
    toast(e.message, "error");
  }
}

function updateOptInSub() {
  els.optInSub.innerHTML = els.defaultOptIn.checked
    ? "members will receive reminders by default"
    : "members must <code>/missions optin</code> to receive reminders";
}

function renderMonitoredRoles(monitored, available) {
  els.monitoredRoles.innerHTML = monitored.length
    ? monitored.map((r) =>
        `<span class="role-pill">
           <span class="role-color" style="background:${roleColor(r.color)}"></span>
           ${escapeHtml(r.name)}
           <button data-role-id="${r.id}" title="Remove" aria-label="Remove ${escapeAttr(r.name)}">×</button>
         </span>`).join("")
    : `<span class="role-empty">No roles are monitored yet. Add a role so its mentions trigger DMs.</span>`;
  els.monitoredRoles.querySelectorAll("button[data-role-id]").forEach((b) =>
    b.addEventListener("click", () => removeRole(b.dataset.roleId)));

  const monitoredIds = new Set(monitored.map((r) => String(r.id)));
  const candidates = (available || []).filter((r) => String(r.id) !== String(state.selectedGuild) && !monitoredIds.has(String(r.id)));
  els.addRolePicker.innerHTML = `<option value="">Select a role…</option>` + candidates.map((r) =>
    `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join("");
}

function markDirty(patch) {
  state.pendingSettings = { ...(state.pendingSettings || {}), ...patch };
  els.settingsSaveBtn.disabled = false;
}

function renderModlistChannelChips() {
  const host = els.modlistChannelChips;
  if (!host) return;
  const ids = state._modlistChannelIds || [];
  const chans = state._channelsForPicker || [];
  // Render the currently-selected chips.
  host.innerHTML = ids.length
    ? ids.map((id) => {
        const c = chans.find((x) => String(x.id) === String(id));
        const name = c ? c.name : `channel-${id}`;
        return `<span class="role-pill">
          <i class="fas fa-hashtag" style="color:var(--text-faint);font-size:.78em"></i>
          ${escapeHtml(name)}
          <small class="muted" style="font-family:monospace;font-size:.7rem;margin-left:.35rem">${id}</small>
          <button data-chip-id="${id}" title="Remove" aria-label="Remove ${escapeAttr(name)}">×</button>
        </span>`;
      }).join("")
    : `<span class="role-empty">No modlist channels set yet. Add at least one so the bot listens for HTML attachments.</span>`;
  host.querySelectorAll("button[data-chip-id]").forEach((b) =>
    b.addEventListener("click", () => {
      state._modlistChannelIds = state._modlistChannelIds.filter((id) => String(id) !== String(b.dataset.chipId));
      renderModlistChannelChips();
      renderModlistChannelPicker();
      markDirty({ modlist_channel_ids: state._modlistChannelIds });
    }));
  renderModlistChannelPicker();
}

function renderModlistChannelPicker() {
  const picker = els.modlistChannelPicker;
  if (!picker) return;
  const used = new Set((state._modlistChannelIds || []).map(String));
  const chans = state._channelsForPicker || [];
  const available = chans.filter((c) => !used.has(String(c.id)));
  picker.innerHTML = `<option value="">Add a channel…</option>` +
    available.map((c) => `<option value="${c.id}">#${escapeHtml(c.name)}</option>`).join("");
  if (!picker._chipChangeWired) {
    picker.addEventListener("change", () => {
      const v = picker.value;
      if (!v) return;
      state._modlistChannelIds = [...(state._modlistChannelIds || []), v];
      picker.value = "";
      renderModlistChannelChips();
      markDirty({ modlist_channel_ids: state._modlistChannelIds });
    });
    picker._chipChangeWired = true;
  }
}

async function saveSettings() {
  if (!state.pendingSettings) return;
  els.settingsSaveBtn.disabled = true;
  try {
    const body = { ...state.pendingSettings };
    if (body.rsvp_channel_id === 0) body.rsvp_channel_id = null;
    if (body.modlist_channel_id === 0) body.modlist_channel_id = null;
    await api(`/bots/${state.selectedBot}/guilds/${state.selectedGuild}/settings`, {
      method: "PATCH", body: JSON.stringify(body),
    });
    toast("Settings saved", "ok");
    state.pendingSettings = null;
    await loadSettings();
  } catch (e) {
    toast(e.message, "error");
    els.settingsSaveBtn.disabled = false;
  }
}

/* ---------------- reminder chips ---------------- */
function renderRemindersChips(values) {
  const v = [...new Set(values)].sort((a, b) => b - a);
  els.remindersChips.innerHTML = v.map((n) =>
    `<span class="chip">${humaniseMinutes(n)}<button data-chip="${n}" aria-label="Remove ${humaniseMinutes(n)}">×</button></span>`
  ).join("") + `<input type="text" class="chip-add" placeholder="+ e.g. 60m, 2h, 1d" aria-label="Add reminder window">`;

  els.remindersChips.querySelectorAll("button[data-chip]").forEach((b) =>
    b.addEventListener("click", () => {
      const n = Number(b.dataset.chip);
      const next = v.filter((x) => x !== n);
      if (next.length === 0) { toast("Keep at least one reminder window.", "error"); return; }
      renderRemindersChips(next);
      markDirty({ default_reminders: next.join(",") });
    }));

  const input = els.remindersChips.querySelector("input.chip-add");
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== ",") return;
    e.preventDefault();
    const n = parseHumanMinutes(input.value);
    if (!Number.isInteger(n) || n < 1 || n > REMINDER_MAX_MINUTES) {
      toast(`Reminder must be 1 minute to ${REMINDER_MAX_MINUTES / 1440} days.`, "error");
      return;
    }
    if (v.includes(n)) { input.value = ""; return; }
    const next = [...v, n].sort((a, b) => b - a);
    renderRemindersChips(next);
    markDirty({ default_reminders: next.join(",") });
    els.remindersChips.querySelector("input.chip-add").focus();
  });
}

/* ---------------- monitored roles mutations ---------------- */
async function addRole() {
  const id = els.addRolePicker.value;
  if (!id) return;
  try {
    await api(`/bots/${state.selectedBot}/guilds/${state.selectedGuild}/roles`, {
      method: "POST", body: JSON.stringify({ role_id: Number(id) }),
    });
    toast("Role added", "ok");
    await loadSettings();
  } catch (e) { toast(e.message, "error"); }
}

async function removeRole(roleId) {
  try {
    await api(`/bots/${state.selectedBot}/guilds/${state.selectedGuild}/roles/${roleId}`, { method: "DELETE" });
    toast("Role removed", "ok");
    await loadSettings();
  } catch (e) { toast(e.message, "error"); }
}

/* ============================================================
 * Detection rules
 * ============================================================ */
let editingRuleId = null;

function templateName(id) {
  const t = state.templates.find((x) => String(x.id) === String(id));
  return t ? t.name : null;
}
function templateLabel(t) { return `${t.name} (${TEMPLATE_KIND_LABEL[t.kind] || t.kind})`; }

async function loadDetectionRules() {
  const host = els.detectionRules;
  host.innerHTML = `<div class="skel" style="height:46px"></div><div class="skel" style="height:46px"></div>`;
  try {
    // need the template list to resolve names — load it if we don't have it yet
    if (!state.templatesAllCache || state.templatesAllCacheGuild !== state.selectedGuild) await loadAllTemplatesForPickers();
    const data = await api(`/bots/${state.selectedBot}/guilds/${state.selectedGuild}/detection-rules`);
    state.detectionRules = (data.rules || []).slice().sort((a, b) => a.priority - b.priority || new Date(a.created_at) - new Date(b.created_at));
    renderDetectionRules();
  } catch (e) {
    host.innerHTML = `<div class="rules-empty"><i class="fas fa-triangle-exclamation"></i><p>Couldn't load rules: ${escapeHtml(e.message)}</p></div>`;
  }
}

/* loads every kind into a flat cache used by the rule picker + name resolution */
async function loadAllTemplatesForPickers() {
  try {
    const data = await api(`/bots/${state.selectedBot}/guilds/${state.selectedGuild}/templates`);
    state.templatesAllCache = data.templates || [];
    state.templatesAllCacheGuild = state.selectedGuild;
    // keep state.templates populated for name lookups too
    if (!state.templates.length) state.templates = state.templatesAllCache;
  } catch { state.templatesAllCache = state.templatesAllCache || []; }
}

function allTemplates() { return state.templatesAllCache || []; }
function ruleTemplateName(id) {
  const t = allTemplates().find((x) => String(x.id) === String(id));
  return t ? t.name : null;
}

function renderDetectionRules() {
  const rules = state.detectionRules || [];
  if (!rules.length) {
    els.detectionRules.innerHTML = `
      <div class="rules-empty">
        <i class="fas fa-filter"></i>
        <p>No rules yet. Every parseable mission uses the server's default template. Add a rule to route specific keywords to specific templates.</p>
      </div>`;
    return;
  }
  els.detectionRules.innerHTML =
    `<div class="rule-row head"><span>Priority</span><span>Match text</span><span>Template</span><span>Actions</span></div>` +
    rules.map((r) => {
      const name = ruleTemplateName(r.template_id);
      const tplCell = name
        ? escapeHtml(name)
        : `<span class="tpl-gone"><i class="fas fa-triangle-exclamation"></i> template gone</span>`;
      return `
      <div class="rule-row" data-rule="${r.id}">
        <span class="rule-prio">${r.priority}</span>
        <span class="rule-match" title="${escapeAttr(r.match_text)}">${escapeHtml(r.match_text)}</span>
        <span class="rule-tpl">${tplCell}</span>
        <span class="rule-actions">
          <button class="icon-mini" data-edit="${r.id}" title="${name ? "Edit" : "Re-bind"}"><i class="fas fa-pen"></i></button>
          <button class="icon-mini del" data-del="${r.id}" title="Delete"><i class="fas fa-xmark"></i></button>
        </span>
      </div>`;
    }).join("");
  els.detectionRules.querySelectorAll("[data-edit]").forEach((b) =>
    b.addEventListener("click", () => openRuleDialog(Number(b.dataset.edit))));
  els.detectionRules.querySelectorAll("[data-del]").forEach((b) =>
    b.addEventListener("click", () => deleteRule(Number(b.dataset.del))));
}

function openRuleDialog(ruleId) {
  editingRuleId = ruleId || null;
  const rule = ruleId ? state.detectionRules.find((r) => r.id === ruleId) : null;
  $("ruleDialogTitle").textContent = rule ? "Edit detection rule" : "Add detection rule";
  els.ruleMatch.value = rule ? rule.match_text : "";
  els.rulePriority.value = rule ? rule.priority : 0;
  els.ruleAllKinds.checked = false;
  populateRuleTemplatePicker(rule ? rule.template_id : null);
  els.ruleDialog.showModal();
  setTimeout(() => els.ruleMatch.focus(), 50);
}

function populateRuleTemplatePicker(selectedId) {
  const all = allTemplates();
  const list = els.ruleAllKinds.checked ? all : all.filter((t) => t.kind === "mission_dm");
  const pool = list.length ? list : all; // if no mission_dm templates, fall back to all
  els.ruleTemplate.innerHTML = pool.map((t) =>
    `<option value="${t.id}" ${String(t.id) === String(selectedId) ? "selected" : ""}>${escapeHtml(templateLabel(t))}</option>`).join("")
    || `<option value="">(no templates — create one first)</option>`;
}

async function submitRule(e) {
  e.preventDefault();
  const match_text = els.ruleMatch.value.trim();
  const template_id = Number(els.ruleTemplate.value);
  const priority = Number(els.rulePriority.value) || 0;
  if (!match_text) { toast("Match text required", "error"); return; }
  if (!template_id) { toast("Pick a template", "error"); return; }
  const base = `/bots/${state.selectedBot}/guilds/${state.selectedGuild}/detection-rules`;
  try {
    if (editingRuleId) await api(`${base}/${editingRuleId}`, { method: "PATCH", body: JSON.stringify({ match_text, template_id, priority }) });
    else await api(base, { method: "POST", body: JSON.stringify({ match_text, template_id, priority }) });
    toast(editingRuleId ? "Rule updated" : "Rule added", "ok");
    els.ruleDialog.close();
    await loadDetectionRules();
  } catch (err) { toast(err.message, "error"); }
}

async function deleteRule(ruleId) {
  if (!confirm("Delete this detection rule?")) return;
  try {
    await api(`/bots/${state.selectedBot}/guilds/${state.selectedGuild}/detection-rules/${ruleId}`, { method: "DELETE" });
    toast("Rule deleted", "ok");
    await loadDetectionRules();
  } catch (e) { toast(e.message, "error"); }
}

/* ============================================================
 * Modlist
 * ============================================================ */
async function loadModlist() {
  els.modlistCurrent.innerHTML = `<div class="skel" style="height:52px"></div>`;
  try {
    const m = await api(`/bots/${state.selectedBot}/guilds/${state.selectedGuild}/modlist`);
    state.modlist = m || {};
    renderModlist();
  } catch (e) {
    els.modlistCurrent.innerHTML = `<span class="modlist-empty">Couldn't load modlist.</span>`;
  }
}

function renderModlist() {
  const m = state.modlist || {};
  if (els.modlistChannel && m.channel_id != null) els.modlistChannel.value = String(m.channel_id);
  els.modlistUpdated.textContent = m.updated_at ? `updated ${fmtRelative(m.updated_at)}` : "";

  const parts = [];
  if (m.url) {
    const fname = decodeURIComponent(String(m.url).split("/").pop().split("?")[0]) || "preset.html";
    parts.push(`<div class="modlist-preset"><i class="fas fa-file-code"></i> <a href="${escapeAttr(m.url)}" target="_blank" rel="noopener">${escapeHtml(fname)} ↗</a></div>`);
  }
  if (m.text) parts.push(`<div class="modlist-text-box">${escapeHtml(m.text)}</div>`);
  els.modlistCurrent.innerHTML = parts.length ? parts.join("") : `<span class="modlist-empty">No modlist cached yet. Post a preset in the modlist channel, or set one manually.</span>`;
}

function openModlistDialog() {
  const m = state.modlist || {};
  els.modlistUrlInput.value = m.url || "";
  els.modlistTextInput.value = m.text || "";
  els.modlistDialog.showModal();
}

async function submitModlist(e) {
  e.preventDefault();
  await saveModlist({ url: els.modlistUrlInput.value.trim(), text: els.modlistTextInput.value });
  els.modlistDialog.close();
}

async function clearModlist() {
  if (!confirm("Clear the server's cached modlist? The bot will repopulate it on the next post in the modlist channel.")) return;
  await saveModlist({ url: "", text: "" });
}

async function saveModlist(body) {
  try {
    await api(`/bots/${state.selectedBot}/guilds/${state.selectedGuild}/modlist`, { method: "POST", body: JSON.stringify(body) });
    toast("Modlist saved", "ok");
    await loadModlist();
  } catch (e) { toast(e.message, "error"); }
}
