/* ============================================================
 * templates.js — Templates editor + live Discord preview
 * Headline feature. Bug G: bindings locked until saved.
 * ============================================================ */

/* ---------------- sample preview contexts ---------------- */
const PREVIEW_CONTEXTS = {
  default: {
    label: "Iron Shield (full RSVP)",
    ctx: {
      mission_id: 42, mission_title: "Operation Iron Shield",
      mission_body: "ARMA3 will initiate Operation Iron Shield, the final phase of the rescue campaign. Operators will conduct a direct assault, breach the compound, secure the Minister, and extract him alive. Enemy resistance is expected to be heavy and coordinated.",
      mission_starts_at: "Friday, 16 May 2026 at 8:30 PM", mission_starts_short: "8:30 PM", mission_starts_relative: "in 3 days",
      jump_url: "#", server_name: "ARMA3", channel_name: "#operations", role_names: "@ARMA III",
      user_mention: "@you", user_rsvp: "✅ Going", user_notify: "🔔 Reminders on",
      minutes_before: 30, minutes_before_human: "30 minutes",
      going_count: 4, maybe_count: 2, not_count: 1, awaiting_count: 7, eligible_count: 14,
      going_list: "• Alice\n• Bob\n• Charlie\n• Dave", maybe_list: "• Eve\n• Grace", not_list: "• Frank",
      role_mentions: "@ARMA III",
      modlist_url: "https://cdn.discordapp.com/attachments/1234/Arma3Preset_2026-05-31.html",
      modlist_text: "CBA_A3, ACE3, ACRE2, RHSUSAF, RHSAFRF, CUP Terrains Core",
      modlist_link: "[Modlist](https://cdn.discordapp.com/attachments/1234/Arma3Preset_2026-05-31.html)",
    },
  },
  fresh: {
    label: "Fresh recon (no RSVPs)",
    ctx: {
      mission_id: 41, mission_title: "Side Operation — Recon",
      mission_body: "Reconnaissance only — no contact. Mark enemy positions and exfil quietly.",
      mission_starts_at: "Sunday, 18 May 2026 at 8:30 PM", mission_starts_short: "8:30 PM", mission_starts_relative: "in 5 days",
      jump_url: "#", server_name: "ARMA3", channel_name: "#operations", role_names: "@ARMA III",
      user_mention: "@you", user_rsvp: "— No RSVP yet", user_notify: "🔔 Reminders on",
      minutes_before: 60, minutes_before_human: "60 minutes",
      going_count: 0, maybe_count: 0, not_count: 0, awaiting_count: 14, eligible_count: 14,
      going_list: "—", maybe_list: "—", not_list: "—", role_mentions: "@ARMA III",
      modlist_url: "", modlist_text: "", modlist_link: "",
    },
  },
  reminder: {
    label: "10-min reminder",
    ctx: {
      mission_id: 42, mission_title: "Operation Iron Shield",
      mission_body: "Final phase of the rescue campaign. Gear up and stage on the FOB.",
      mission_starts_at: "Today at 8:30 PM", mission_starts_short: "8:30 PM", mission_starts_relative: "in 10 minutes",
      jump_url: "#", server_name: "ARMA3", channel_name: "#operations", role_names: "@ARMA III",
      user_mention: "@you", user_rsvp: "❓ Maybe", user_notify: "🔔 Reminders on",
      minutes_before: 10, minutes_before_human: "10 minutes",
      going_count: 6, maybe_count: 1, not_count: 2, awaiting_count: 5, eligible_count: 14,
      going_list: "• Alice\n• Bob\n• Charlie\n• Dave\n• Heidi\n• Ivan", maybe_list: "• Eve", not_list: "• Frank\n• Mallory",
      role_mentions: "@ARMA III",
      modlist_url: "https://cdn.discordapp.com/attachments/1234/Arma3Preset_2026-05-31.html",
      modlist_text: "CBA_A3, ACE3, ACRE2, RHSUSAF, RHSAFRF",
      modlist_link: "[Modlist](https://cdn.discordapp.com/attachments/1234/Arma3Preset_2026-05-31.html)",
    },
  },
};

const PLACEHOLDER_TOKENS = [
  "server_name", "mission_id", "mission_title", "mission_body",
  "mission_starts_at", "mission_starts_short", "mission_starts_relative", "jump_url",
  "channel_name", "role_names", "user_id", "user_mention", "user_rsvp", "user_notify",
  "minutes_before", "minutes_before_human",
  "going_count", "maybe_count", "not_count", "awaiting_count", "eligible_count",
  "going_list", "maybe_list", "not_list", "role_mentions",
  "modlist_url", "modlist_text", "modlist_link",
];

let lastTokenTarget = null; // last focused token-able input

/* ---------------- default template seeds ---------------- */
function makeDefaultTemplate(kind) {
  const seeds = {
    mission_dm: { name: "Mission DM", json_blob: {
      color: "#57f287", title: "🎯 Mission announcement — {server_name}", timestamp: "message",
      fields: [
        { name: "Channel", value: "{channel_name}", inline: true },
        { name: "Role(s)", value: "{role_names}", inline: true },
        { name: "Starts", value: "{mission_starts_at} ({mission_starts_relative})", inline: false },
        { name: "Message", value: "{mission_body}", inline: false },
        { name: "Jump", value: "[Original message]({jump_url})", inline: false },
        { name: "Your status", value: "{user_notify} · {user_rsvp}", inline: false },
      ] } },
    reminder_dm: { name: "Reminder DM", json_blob: {
      color: "#faa61a", title: "⏰ {minutes_before_human} reminder — {server_name}", timestamp: "start",
      fields: [
        { name: "Starts", value: "{mission_starts_at} ({mission_starts_relative})", inline: false },
        { name: "Message", value: "{mission_body}", inline: false },
        { name: "Jump", value: "[Original message]({jump_url})", inline: false },
        { name: "Your status", value: "{user_notify} · {user_rsvp}", inline: false },
      ] } },
    rsvp_summary: { name: "RSVP summary", json_blob: {
      color: "#5865f2", title: "🎯 {mission_title}", description: "Starts {mission_starts_at} ({mission_starts_relative})\n[Original message]({jump_url})",
      fields: [
        { name: "✅ Going ({going_count})", value: "{going_list}", inline: true },
        { name: "❓ Maybe ({maybe_count})", value: "{maybe_list}", inline: true },
        { name: "❌ Not going ({not_count})", value: "{not_list}", inline: true },
      ], footer: { text: "Mission #{mission_id} · Awaiting {awaiting_count} / {eligible_count}" } } },
    announcement: { name: "Announcement", json_blob: {
      color: "#5865f2", title: "**{mission_title}**", description: "{mission_body}\n\nStarts {mission_starts_at} ({mission_starts_relative})",
      footer: { text: "{server_name}" } } },
    freeform: { name: "Freeform embed", json_blob: {
      color: "#5865f2", title: "Server rules", description: "Edit this template however you like — no mission-related placeholders are substituted in freeform mode.",
      fields: [], timestamp: "none" } },
  };
  const seed = seeds[kind] || { name: "Untitled", json_blob: { fields: [], timestamp: "none" } };
  return { id: null, kind, name: seed.name, is_default: false, json_blob: JSON.parse(JSON.stringify(seed.json_blob)) };
}

/* ---------------- load + list ---------------- */
async function loadTemplates() {
  if (!state.selectedBot || !state.selectedGuild) return;
  els.templatesList.innerHTML = Array.from({ length: 3 }).map(() => `<div class="skel tpl-list-skel"></div>`).join("");
  try {
    const data = await api(`/bots/${state.selectedBot}/guilds/${state.selectedGuild}/templates?kind=${encodeURIComponent(state.templatesKind)}`);
    state.templates = data.templates || [];
    state.roleBindings = data.role_bindings || [];
    if (state.rolesCache.length === 0) await refreshRolesCache();
    renderTemplatesList();
    if (state.editingTemplate) {
      renderTemplateEditor();
    } else {
      // Auto-open this kind's guild default so admins land on a useful screen
      // instead of the empty placeholder. Falls through to empty state if no
      // default exists for the kind.
      const def = state.templates.find((t) => t.is_default);
      if (def) {
        state.editingTemplate = {
          ...def,
          json_blob: typeof def.json_blob === "string"
            ? JSON.parse(def.json_blob)
            : JSON.parse(JSON.stringify(def.json_blob)),
        };
        openTemplateEditor();
      }
    }
  } catch (e) {
    els.templatesList.innerHTML = `<div class="tpl-list-empty">Couldn't load templates.</div>`;
    toast(e.message, "error");
  }
}

async function refreshRolesCache() {
  try {
    const data = await api(`/bots/${state.selectedBot}/guilds/${state.selectedGuild}/settings`);
    state.rolesCache = data.available_roles || [];
  } catch { state.rolesCache = []; }
}

function renderTemplatesList() {
  const items = state.templates.map((t) => {
    const active = state.editingTemplate && state.editingTemplate.id === t.id && t.id != null;
    return `
      <div class="template-item${active ? " active" : ""}" data-tid="${t.id}">
        <div class="template-item-name">${escapeHtml(t.name)}${t.is_default ? '<span class="template-item-badge">DEFAULT</span>' : ""}</div>
        <div class="template-item-meta">${TEMPLATE_KIND_LABEL[t.kind] || t.kind}</div>
      </div>`;
  }).join("");
  els.templatesList.innerHTML = items ||
    `<div class="tpl-list-empty">No ${TEMPLATE_KIND_LABEL[state.templatesKind]} templates yet. Click <strong>New template</strong>.</div>`;
  els.templatesList.querySelectorAll("[data-tid]").forEach((row) =>
    row.addEventListener("click", () => {
      const t = state.templates.find((x) => String(x.id) === row.dataset.tid);
      if (!t) return;
      state.editingTemplate = { ...t, json_blob: typeof t.json_blob === "string" ? JSON.parse(t.json_blob) : JSON.parse(JSON.stringify(t.json_blob)) };
      openTemplateEditor();
    }));
}

/* ---------------- editor open/close ---------------- */
function openTemplateEditor() {
  els.editorEmpty.hidden = true;
  els.templateEditor.hidden = false;
  renderTemplateEditor();
  renderTemplatesList();
}
function closeTemplateEditor() {
  state.editingTemplate = null;
  els.templateEditor.hidden = true;
  els.editorEmpty.hidden = false;
  renderTemplatePreview();
  renderTemplatesList();
}

function renderTemplateEditor() {
  const t = state.editingTemplate;
  if (!t) return;
  const j = t.json_blob || {};
  els.tplName.value = t.name || "";
  els.tplIsDefault.checked = !!t.is_default;
  els.tplColor.value = j.color || "";
  els.tplColorPicker.value = /^#[0-9a-fA-F]{6}$/.test(j.color || "") ? j.color : "#5865f2";
  els.tplAuthorName.value = (j.author && j.author.name) || "";
  els.tplAuthorIcon.value = (j.author && j.author.icon_url) || "";
  els.tplTitle.value = j.title || "";
  els.tplUrl.value = j.url || "";
  els.tplDescription.value = j.description || "";
  els.tplContent.value = j.content || "";
  els.tplFooterText.value = (j.footer && j.footer.text) || "";
  els.tplFooterIcon.value = (j.footer && j.footer.icon_url) || "";
  els.tplThumb.value = j.thumbnail_url || "";
  els.tplImage.value = j.image_url || "";
  els.tplTimestamp.value = j.timestamp || "none";
  els.tplDeleteBtn.hidden = t.id == null;
  renderFieldsEditor();
  renderRoleBindings();
  renderTemplatePreview();
}

/* ---------------- fields editor ---------------- */
function renderFieldsEditor() {
  const t = state.editingTemplate;
  const fields = (t.json_blob.fields = t.json_blob.fields || []);
  els.tplFields.innerHTML = fields.map((f, i) => `
    <div class="field-row" data-i="${i}">
      <div class="field-main">
        <input class="text-input field-name-input" data-k="name" value="${escapeAttr(f.name || "")}" placeholder="Field name" data-token-target>
        <textarea class="text-input" data-k="value" placeholder="Field value" data-token-target>${escapeHtml(f.value || "")}</textarea>
      </div>
      <div class="field-side">
        <label class="field-inline-lbl"><input type="checkbox" data-k="inline" ${f.inline ? "checked" : ""}> inline</label>
        <div class="field-arrows">
          <button class="icon-mini" data-act="up" title="Move up" ${i === 0 ? "disabled" : ""}><i class="fas fa-chevron-up"></i></button>
          <button class="icon-mini" data-act="down" title="Move down" ${i === fields.length - 1 ? "disabled" : ""}><i class="fas fa-chevron-down"></i></button>
        </div>
        <button class="icon-mini del" data-act="del" title="Remove"><i class="fas fa-xmark"></i></button>
      </div>
    </div>`).join("") || `<p class="muted" style="margin:0">No fields. Use <strong>Add field</strong> to create one.</p>`;

  els.tplFields.querySelectorAll(".field-row").forEach((row) => {
    const i = Number(row.dataset.i);
    row.querySelectorAll("[data-k]").forEach((inp) =>
      inp.addEventListener("input", () => {
        const f = t.json_blob.fields[i];
        f[inp.dataset.k] = inp.type === "checkbox" ? inp.checked : inp.value;
        renderTemplatePreview();
      }));
    row.querySelector('[data-act="del"]').addEventListener("click", () => {
      t.json_blob.fields.splice(i, 1); renderFieldsEditor(); renderTemplatePreview();
    });
    const up = row.querySelector('[data-act="up"]');
    const down = row.querySelector('[data-act="down"]');
    if (up) up.addEventListener("click", () => {
      if (i === 0) return; const a = t.json_blob.fields; [a[i - 1], a[i]] = [a[i], a[i - 1]];
      renderFieldsEditor(); renderTemplatePreview();
    });
    if (down) down.addEventListener("click", () => {
      const a = t.json_blob.fields; if (i === a.length - 1) return; [a[i + 1], a[i]] = [a[i], a[i + 1]];
      renderFieldsEditor(); renderTemplatePreview();
    });
  });
  registerTokenTargets();
}

/* ---------------- editor → model sync ---------------- */
function syncEditorToTemplate() {
  const t = state.editingTemplate;
  if (!t) return;
  const j = t.json_blob;
  t.name = els.tplName.value;
  t.is_default = els.tplIsDefault.checked;
  j.color = els.tplColor.value.trim() || undefined;
  j.title = els.tplTitle.value || undefined;
  j.url = els.tplUrl.value || undefined;
  j.description = els.tplDescription.value || undefined;
  j.content = els.tplContent.value || undefined;
  j.thumbnail_url = els.tplThumb.value || undefined;
  j.image_url = els.tplImage.value || undefined;
  j.timestamp = els.tplTimestamp.value || "none";
  const aName = els.tplAuthorName.value.trim(), aIcon = els.tplAuthorIcon.value.trim();
  j.author = (aName || aIcon) ? { name: aName, icon_url: aIcon || undefined } : undefined;
  const fText = els.tplFooterText.value.trim(), fIcon = els.tplFooterIcon.value.trim();
  j.footer = (fText || fIcon) ? { text: fText, icon_url: fIcon || undefined } : undefined;
  renderTemplatePreview();
}

/* ---------------- role bindings (bug G) ---------------- */
function renderRoleBindings() {
  const t = state.editingTemplate;
  const saved = t.id != null;
  els.tplBindLocked.hidden = saved;
  els.tplRoleBindings.parentElement.classList.toggle("bindings-disabled", !saved);
  // re-enable the helper text line regardless
  els.tplBindLocked.classList.remove("bindings-disabled");

  const bound = state.roleBindings.filter((b) => b.kind === t.kind && saved && String(b.template_id) === String(t.id));
  const boundIds = new Set(bound.map((b) => String(b.role_id)));
  els.tplRoleBindings.innerHTML = bound.length
    ? bound.map((b) => {
        const r = state.rolesCache.find((x) => String(x.id) === String(b.role_id));
        const name = r ? r.name : `role-${b.role_id}`;
        return `<span class="role-pill">
          <span class="role-color" style="background:${roleColor(r ? r.color : 0)}"></span>
          ${escapeHtml(name)}
          <button data-unbind="${b.role_id}" title="Unbind">×</button>
        </span>`;
      }).join("")
    : `<span class="role-empty">No role bindings yet.</span>`;
  els.tplRoleBindings.querySelectorAll("[data-unbind]").forEach((b) =>
    b.addEventListener("click", () => unbindRoleFromTemplate(Number(b.dataset.unbind))));

  const candidates = state.rolesCache.filter((r) => !boundIds.has(String(r.id)) && String(r.id) !== String(state.selectedGuild));
  els.tplRoleBindPicker.innerHTML = `<option value="">Select a role…</option>` +
    candidates.map((r) => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join("");
}

async function bindRoleToTemplate() {
  const t = state.editingTemplate;
  if (!t || t.id == null) { toast("Save the template first, then bind roles.", "error"); return; }
  const roleId = els.tplRoleBindPicker.value;
  if (!roleId) return;
  try {
    await api(`/bots/${state.selectedBot}/guilds/${state.selectedGuild}/role-bindings`, {
      method: "POST", body: JSON.stringify({ role_id: Number(roleId), kind: t.kind, template_id: t.id }) });
    toast("Role bound", "ok");
    await loadTemplates();
  } catch (e) { toast(e.message, "error"); }
}

async function unbindRoleFromTemplate(roleId) {
  const t = state.editingTemplate;
  if (!t) return;
  try {
    await api(`/bots/${state.selectedBot}/guilds/${state.selectedGuild}/role-bindings`, {
      method: "POST", body: JSON.stringify({ role_id: roleId, kind: t.kind, template_id: null }) });
    toast("Unbound", "ok");
    await loadTemplates();
  } catch (e) { toast(e.message, "error"); }
}

/* ---------------- save / delete / duplicate ---------------- */
async function saveTemplate() {
  const t = state.editingTemplate;
  if (!t) return;
  if (!t.name.trim()) { toast("Name required", "error"); return; }
  const cleanBlob = JSON.parse(JSON.stringify(t.json_blob));
  const body = { kind: t.kind, name: t.name.trim(), json_blob: cleanBlob, is_default: t.is_default };
  els.tplSaveBtn.disabled = true;
  try {
    if (t.id == null) {
      const res = await api(`/bots/${state.selectedBot}/guilds/${state.selectedGuild}/templates`, { method: "POST", body: JSON.stringify(body) });
      t.id = res.id;
      toast("Template created", "ok");
    } else {
      await api(`/bots/${state.selectedBot}/guilds/${state.selectedGuild}/templates/${t.id}`, { method: "PATCH", body: JSON.stringify(body) });
      toast("Template saved", "ok");
    }
    await loadTemplates();
    renderTemplateEditor(); // unlock bindings now that it has an id
  } catch (e) { toast(e.message, "error"); }
  finally { els.tplSaveBtn.disabled = false; }
}

async function deleteTemplateClicked() {
  const t = state.editingTemplate;
  if (!t || t.id == null) return;
  if (!confirm(`Delete template “${t.name}”? This also removes any role bindings.`)) return;
  try {
    await api(`/bots/${state.selectedBot}/guilds/${state.selectedGuild}/templates/${t.id}`, { method: "DELETE" });
    toast("Template deleted", "ok");
    closeTemplateEditor();
    await loadTemplates();
  } catch (e) { toast(e.message, "error"); }
}

function duplicateTemplate() {
  const t = state.editingTemplate;
  if (!t) return;
  state.editingTemplate = { ...t, id: null, name: t.name + " (copy)", is_default: false, json_blob: JSON.parse(JSON.stringify(t.json_blob)) };
  openTemplateEditor();
  toast("Duplicated — click Save to persist", "neutral");
}

function newTemplate() {
  state.editingTemplate = makeDefaultTemplate(state.templatesKind);
  openTemplateEditor();
}

/* ---------------- token cheat sheet ---------------- */
function renderPlaceholderTokens() {
  els.tplPlaceholders.innerHTML = PLACEHOLDER_TOKENS.map((tok) =>
    `<button type="button" class="token-chip" data-token="{${tok}}">{${tok}}</button>`).join("");
  els.tplPlaceholders.querySelectorAll(".token-chip").forEach((b) =>
    b.addEventListener("click", () => insertToken(b.dataset.token)));
}

function registerTokenTargets() {
  document.querySelectorAll("#templateEditor [data-token-target]").forEach((el) => {
    if (el.__tokenBound) return;
    el.__tokenBound = true;
    el.addEventListener("focus", () => { lastTokenTarget = el; });
  });
}

function insertToken(token) {
  const el = lastTokenTarget && document.contains(lastTokenTarget) ? lastTokenTarget : els.tplDescription;
  el.focus();
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  el.value = el.value.slice(0, start) + token + el.value.slice(end);
  const pos = start + token.length;
  el.setSelectionRange(pos, pos);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

/* ---------------- preview controls ---------------- */
function renderPreviewContextOptions() {
  els.previewContext.innerHTML = Object.entries(PREVIEW_CONTEXTS)
    .map(([k, v]) => `<option value="${k}">${escapeHtml(v.label)}</option>`).join("");
  els.previewContext.value = state.previewContextKey;
}

function setKindFramingDefault() {
  state.previewFraming = (state.templatesKind === "mission_dm" || state.templatesKind === "reminder_dm") ? "dm" : "channel";
  els.previewFraming.querySelectorAll(".seg-btn").forEach((b) =>
    b.classList.toggle("active", b.dataset.framing === state.previewFraming));
}

/* ---------------- live preview render ---------------- */
function renderTemplatePreview() {
  const t = state.editingTemplate;
  if (!t) { els.tplPreview.innerHTML = `<div class="dc-empty">Select or create a template to see the preview.</div>`; return; }
  const j = t.json_blob || {};
  const ctx = (PREVIEW_CONTEXTS[state.previewContextKey] || PREVIEW_CONTEXTS.default).ctx;

  const content = substitutePlaceholders(j.content, ctx);
  const title = substitutePlaceholders(j.title, ctx);
  const desc = substitutePlaceholders(j.description, ctx);
  const author = (j.author && j.author.name)
    ? { name: substitutePlaceholders(j.author.name, ctx), icon_url: substitutePlaceholders(j.author.icon_url, ctx) } : null;
  const footer = (j.footer && j.footer.text)
    ? { text: substitutePlaceholders(j.footer.text, ctx), icon_url: substitutePlaceholders(j.footer.icon_url, ctx) } : null;
  const color = /^#[0-9a-fA-F]{6}$/.test(j.color || "") ? j.color : "#5865f2";
  const thumb = substitutePlaceholders(j.thumbnail_url, ctx);
  const image = substitutePlaceholders(j.image_url, ctx);
  const fields = (j.fields || []).map((f) => ({
    name: substitutePlaceholders(f.name, ctx), value: substitutePlaceholders(f.value, ctx), inline: !!f.inline,
  }));

  const hasEmbed = title || desc || author || footer || image || thumb || fields.length > 0;
  if (!content && !hasEmbed) {
    els.tplPreview.innerHTML = `<div class="dc-empty">Add at least a title, description, or a field to see a preview.</div>`;
    return;
  }

  // field layout: consecutive inline fields share rows of up to 3
  const fieldHtml = [];
  let rowBuf = [];
  const flush = () => {
    if (!rowBuf.length) return;
    fieldHtml.push(rowBuf.map((f) =>
      `<div class="dc-field"><div class="dc-field-name">${renderInlineMarkdown(f.name)}</div><div class="dc-field-value">${renderInlineMarkdown(f.value)}</div></div>`).join(""));
    rowBuf = [];
  };
  for (const f of fields) {
    if (!f.inline) { flush(); fieldHtml.push(`<div class="dc-field full"><div class="dc-field-name">${renderInlineMarkdown(f.name)}</div><div class="dc-field-value">${renderInlineMarkdown(f.value)}</div></div>`); }
    else { if (rowBuf.length === 3) flush(); rowBuf.push(f); }
  }
  flush();

  // timestamp text
  let tsText = "";
  if (j.timestamp === "message") tsText = "Today at " + new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  else if (j.timestamp === "start") tsText = ctx.mission_starts_at;

  // framing banner
  let banner = "";
  if (state.previewFraming === "dm") {
    banner = `<div class="dc-dm-banner"><span class="dc-dm-avatar">A</span><span class="dm-name">Arma3</span><span class="dm-tag">BOT — Direct Message</span></div>`;
  } else {
    banner = `<div class="dc-channel-banner"><i class="fas fa-hashtag"></i> ${escapeHtml((ctx.channel_name || "#channel").replace(/^#/, ""))}</div>`;
  }

  const footerInner = footer ? `
    <div class="dc-footer">
      ${footer.icon_url ? `<img src="${escapeAttr(footer.icon_url)}" alt="">` : ""}
      <span>${escapeHtml(footer.text)}</span>
      ${tsText ? `<span class="dc-footer-sep">•</span><span>${escapeHtml(tsText)}</span>` : ""}
    </div>` : (tsText ? `<div class="dc-footer"><span>${escapeHtml(tsText)}</span></div>` : "");

  els.tplPreview.innerHTML = `
    ${banner}
    <div class="dc-msg">
      <div class="dc-avatar">A</div>
      <div class="dc-msg-content">
        <div class="dc-msg-head">
          <span class="dc-msg-name">Arma3</span><span class="dc-bot-tag">BOT</span>
          <span class="dc-msg-time">Today at ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
        </div>
        ${content ? `<div class="dc-msg-text">${renderInlineMarkdown(content)}</div>` : ""}
        ${hasEmbed ? `
          <div class="dc-embed" style="border-left-color:${escapeAttr(color)}">
            <div class="dc-embed-body">
              ${author ? `<div class="dc-author">${author.icon_url ? `<img src="${escapeAttr(author.icon_url)}" alt="">` : ""}<span>${escapeHtml(author.name)}</span></div>` : ""}
              ${title ? `<div class="dc-title">${j.url ? `<a href="${escapeAttr(substitutePlaceholders(j.url, ctx))}" target="_blank" rel="noopener">${renderInlineMarkdown(title)}</a>` : renderInlineMarkdown(title)}</div>` : ""}
              ${desc ? `<div class="dc-desc">${renderInlineMarkdown(desc)}</div>` : ""}
              ${fieldHtml.length ? `<div class="dc-fields">${fieldHtml.join("")}</div>` : ""}
              ${image ? `<img class="dc-image" src="${escapeAttr(image)}" alt="">` : ""}
              ${footerInner}
            </div>
            ${thumb ? `<img class="dc-thumb" src="${escapeAttr(thumb)}" alt="">` : ""}
          </div>` : ""}
      </div>
    </div>`;
}
