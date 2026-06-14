/* ============================================================
 * embeds.js — Mee6-style embed builder (E11 rebuild)
 *
 * Two-view tab:
 *   - LIST VIEW: filter by channel, view modes (preview/compact/titles),
 *                click a card to edit in-place.
 *   - EDITOR VIEW: split form + live Discord-look preview, back button
 *                  returns to list. Save/Send commits via API.
 *
 * E8: insert-pickers for channels / roles / emoji on every text input.
 * E9: markdown toolbar + autocomplete in field name/value too.
 * E10: sensible defaults (message collapsed, fields open).
 * E13: Unicode emoji picker with category tabs.
 * ============================================================ */

/* ---------------- API helpers ---------------- */
async function apiListSentEmbeds(limit = 100) {
  return api(`/bots/${state.selectedBot}/guilds/${state.selectedGuild}/sent-embeds?limit=${limit}`);
}
async function apiCreateSentEmbed(channelId, contentObj, templateId = null, reactionRoles = null) {
  const body = { channel_id: String(channelId), content_json: contentObj, template_id: templateId };
  if (reactionRoles) body.reaction_roles = reactionRoles;
  return api(`/bots/${state.selectedBot}/guilds/${state.selectedGuild}/sent-embeds`, {
    method: "POST", body: JSON.stringify(body),
  });
}
async function apiEditSentEmbed(sentId, contentObj, reactionRoles = null) {
  const body = { content_json: contentObj };
  // null means "leave alone"; an explicit (possibly empty) object means
  // "replace the existing group with this".
  if (reactionRoles !== null) body.reaction_roles = reactionRoles;
  return api(`/bots/${state.selectedBot}/guilds/${state.selectedGuild}/sent-embeds/${sentId}`, {
    method: "PATCH", body: JSON.stringify(body),
  });
}
async function apiDeleteSentEmbed(sentId) {
  return api(`/bots/${state.selectedBot}/guilds/${state.selectedGuild}/sent-embeds/${sentId}`, { method: "DELETE" });
}
async function apiUploadImage(file) {
  const fd = new FormData();
  fd.append("file", file, file.name);
  return api(`/bots/${state.selectedBot}/guilds/${state.selectedGuild}/uploaded-images`, {
    method: "POST", body: fd,
  });
}

/* ---------------- module-level state ---------------- */
let _embedsTabInitialised = false;
let _embedsAll = [];
let _embedsViewMode = "preview"; // preview | compact | titles
let _embedsChannelFilter = "";
let _activeEditor = null; // { existing, model, rerender }

/* ---------------- tab loader ---------------- */
async function loadEmbedsTab() {
  if (!state.selectedBot || !state.selectedGuild) return;
  if (!_embedsTabInitialised) initEmbedsTabOnce();
  els.embedsGuildName.textContent = guildLabel();
  showListView();
  await ensureDiscordLookups();
  populateChannelFilter();
  await refreshSentEmbedsList();
}

function initEmbedsTabOnce() {
  els.embedsNewBtn.addEventListener("click", () => openEditor(null));
  els.embedsBackBtn.addEventListener("click", () => showListView());
  els.embedsCancelBtn.addEventListener("click", () => showListView());
  els.embedsSaveBtn.addEventListener("click", () => submitEditor());
  els.embedsChannelFilter.addEventListener("change", () => {
    _embedsChannelFilter = els.embedsChannelFilter.value;
    renderEmbedsList();
  });
  els.embedsViewSeg.querySelectorAll(".seg-btn").forEach((b) => {
    b.addEventListener("click", () => {
      _embedsViewMode = b.dataset.view;
      els.embedsViewSeg.querySelectorAll(".seg-btn").forEach((x) => x.classList.toggle("active", x === b));
      renderEmbedsList();
    });
  });
  _embedsTabInitialised = true;
}

function guildLabel() {
  const g = (state.guilds || []).find((x) => String(x.id) === String(state.selectedGuild));
  return g ? g.name : "";
}

function showListView() {
  els.embedsListView.hidden = false;
  els.embedsEditorView.hidden = true;
  _activeEditor = null;
}
function showEditorView() {
  els.embedsListView.hidden = true;
  els.embedsEditorView.hidden = false;
}

/* ---------------- Discord lookups (channels / roles / emoji) ---------------- */
async function ensureDiscordLookups(force = false) {
  if (!force && window.DC_LOOKUPS && window.DC_LOOKUPS._guildId === state.selectedGuild) return;
  const base = `/bots/${state.selectedBot}/guilds/${state.selectedGuild}`;
  const out = { _guildId: state.selectedGuild, channels: [], roles: [], emojis: [],
                channelsById: {}, rolesById: {}, emojisByName: {} };
  try {
    const chs = await api(`${base}/channels`);
    out.channels = chs.channels || [];
    for (const c of out.channels) out.channelsById[String(c.id)] = c;
  } catch { /* ignore */ }
  try {
    const rs = await api(`${base}/guild-roles`);
    out.roles = (rs.roles || []).filter((r) => r.name !== "@everyone");
    for (const r of out.roles) out.rolesById[String(r.id)] = r;
  } catch { /* ignore */ }
  try {
    const em = await api(`${base}/guild-emojis`);
    out.emojis = em.emojis || [];
    for (const e of out.emojis) out.emojisByName[e.name] = e;
  } catch { /* ignore */ }
  window.DC_LOOKUPS = out;
}

function populateChannelFilter() {
  const opts = ['<option value="">All channels</option>'];
  const seen = new Set();
  // Pull channels that have sent embeds + then all known channels.
  for (const c of (window.DC_LOOKUPS ? window.DC_LOOKUPS.channels : [])) {
    if (!seen.has(c.id)) { seen.add(c.id); opts.push(`<option value="${c.id}">#${escapeHtml(c.name)}</option>`); }
  }
  els.embedsChannelFilter.innerHTML = opts.join("");
  els.embedsChannelFilter.value = _embedsChannelFilter;
}

/* ============================================================
 * LIST VIEW
 * ============================================================ */
async function refreshSentEmbedsList() {
  els.embedsList.innerHTML = `<div class="muted" style="padding:1rem">Loading…</div>`;
  try {
    const data = await apiListSentEmbeds();
    _embedsAll = data.sent_embeds || [];
    renderEmbedsList();
  } catch (e) {
    els.embedsList.innerHTML = `<div class="embeds-empty">Couldn't load: ${escapeHtml(e.message || String(e))}</div>`;
  }
}

function renderEmbedsList() {
  let rows = _embedsAll;
  if (_embedsChannelFilter) rows = rows.filter((r) => String(r.channel_id) === _embedsChannelFilter);
  if (!rows.length) {
    els.embedsList.innerHTML = `<div class="embeds-empty">
      <i class="fas fa-paper-plane" style="font-size:2.2rem;color:var(--text-faint);margin-bottom:.75rem;display:block"></i>
      ${_embedsChannelFilter ? "No embeds sent in that channel yet." : "No embeds sent yet."}
      <div style="margin-top:.5rem">
        <button class="btn btn-primary" onclick="document.getElementById('embedsNewBtn').click()">
          <i class="fas fa-plus"></i> Compose your first embed
        </button>
      </div>
    </div>`;
    return;
  }
  els.embedsList.innerHTML = rows.map(renderEmbedCard).join("");
  els.embedsList.querySelectorAll(".embed-card").forEach((card) => {
    const id = card.dataset.id;
    const row = _embedsAll.find((r) => String(r.id) === id);
    card.addEventListener("click", (e) => {
      if (e.target.closest("[data-action]")) return;
      openEditor(row);
    });
    const del = card.querySelector("[data-action='delete']");
    if (del) del.addEventListener("click", (e) => { e.stopPropagation(); deleteSentEmbed(row); });
  });
}

function renderEmbedCard(row) {
  const c = row.content || {};
  const ch = window.DC_LOOKUPS && window.DC_LOOKUPS.channelsById[row.channel_id];
  const channelLabel = ch ? `#${ch.name}` : `#${row.channel_id || "unknown"}`;
  const time = row.posted_at ? fmtRelative(row.posted_at) : "(unsent)";
  const title = c.title || c.description || c.content || "(empty)";
  const titleShort = String(title).slice(0, 80);
  return `<div class="embed-card ${_embedsViewMode}" data-id="${row.id}">
    <div class="embed-card-head">
      <span class="embed-card-channel">${escapeHtml(channelLabel)}</span>
      <strong>${escapeHtml(titleShort)}</strong>
      <span class="embed-card-time">${escapeHtml(time)}</span>
      <span class="embed-card-actions">
        <button class="btn btn-ghost sm-btn" data-action="delete" title="Delete"><i class="fas fa-trash"></i></button>
      </span>
    </div>
    <div class="embed-card-preview">${renderEmbedPreview(_normaliseToModel(c, row.channel_id))}</div>
  </div>`;
}

async function deleteSentEmbed(row) {
  if (!row) return;
  if (!confirm(`Delete this sent embed?\n\nRemoves the Discord message AND the WebUI record.`)) return;
  try {
    await apiDeleteSentEmbed(row.id);
    toast("Deleted — Discord message will be removed within ~30s", "ok");
    await refreshSentEmbedsList();
  } catch (e) { toast(e.message || String(e), "error"); }
}

/* ============================================================
 * EDITOR VIEW
 * ============================================================ */
function _normaliseToModel(content, channelId, reactionRoles) {
  const c = content || {};
  const rx = reactionRoles || null;
  return {
    channel_id: channelId ? String(channelId) : "",
    content: c.content || "",
    title: c.title || "",
    url: c.url || "",
    description: c.description || "",
    color: /^#[0-9a-fA-F]{6}$/.test(c.color || "") ? c.color : "#5865f2",
    author: { ...(c.author || {}) },
    footer: { ...(c.footer || {}) },
    thumbnail_url: c.thumbnail_url || "",
    image_url: c.image_url || "",
    timestamp: c.timestamp || "none",
    fields: Array.isArray(c.fields) ? c.fields.map((f) => ({ ...f })) : [],
    reaction_roles: {
      enabled: !!(rx && rx.entries && rx.entries.length),
      mode: (rx && rx.mode) || "toggle",
      entries: (rx && Array.isArray(rx.entries))
        ? rx.entries.map((e) => ({ emoji: e.emoji || "", role_id: String(e.role_id || "") }))
        : [],
    },
  };
}

function openEditor(existing) {
  const model = _normaliseToModel(
    existing ? existing.content : {},
    existing ? existing.channel_id : "",
    existing ? existing.reaction_roles : null,
  );
  const editorBody = els.embedsEditorBody;
  editorBody.innerHTML = "";

  els.embedsEditorTitle.textContent = existing ? `Edit embed` : "Compose new embed";
  els.embedsSaveLabel.textContent = existing ? "Save changes" : "Send";

  // Build editor.
  const form = el("div", { class: "embed-editor-form" });
  const preview = el("div", { class: "embed-editor-preview" });
  editorBody.appendChild(form);
  editorBody.appendChild(preview);

  function rerender() { preview.innerHTML = renderEmbedPreview(model); }
  const debouncedRerender = debounce(rerender, 60);

  /* Channel target */
  if (!existing) {
    const channelSel = el("select", { class: "select" });
    channelSel.appendChild(el("option", { value: "" }, ["Select a channel…"]));
    for (const ch of (window.DC_LOOKUPS ? window.DC_LOOKUPS.channels : [])) {
      channelSel.appendChild(el("option", { value: String(ch.id) }, [`#${ch.name}`]));
    }
    if (model.channel_id) channelSel.value = model.channel_id;
    channelSel.addEventListener("change", () => { model.channel_id = channelSel.value; });
    form.appendChild(buildSection("Send to channel", null, [channelSel], false));
  } else {
    const ch = window.DC_LOOKUPS && window.DC_LOOKUPS.channelsById[model.channel_id];
    form.appendChild(buildSection("Posting to", null,
      [el("div", { class: "muted" }, [ch ? `#${ch.name}` : `#${model.channel_id}`,
        " — to move this embed to a different channel, delete it and compose a new one."])], false));
  }

  /* Color (placed near top, where it's logical) */
  const colorI = el("input", { type: "color", value: model.color });
  const colorHex = el("span", { class: "color-hex" }, [model.color]);
  colorI.addEventListener("input", () => {
    model.color = colorI.value;
    colorHex.textContent = colorI.value;
    debouncedRerender();
  });
  form.appendChild(buildSection("Sidebar color",
    "The colored bar on the left of the embed.",
    [el("div", { class: "color-picker-block" }, [colorI, colorHex])], true));

  /* Message above embed (default collapsed per E10) */
  const contentI = mountTextarea(model, "content", { rows: 2,
    placeholder: "Optional plain text above the embed — supports mentions and emoji" });
  form.appendChild(buildSection("Message above embed",
    "Plain text shown above the embed itself. Use the toolbar to insert channels (#), roles (@), and emoji.",
    [contentI.wrap], true));

  /* Author */
  const authorName = mountInput(model.author, "name", { placeholder: "Author name" });
  const authorIcon = mountInput(model.author, "icon_url", { placeholder: "Author icon URL (small)" });
  const authorUrl = mountInput(model.author, "url", { placeholder: "Author URL (link)" });
  form.appendChild(buildSection("Author",
    "Tiny header row above the title with optional name + icon. Often used to credit a person or system.",
    [authorName.wrap, authorIcon.wrap, authorUrl.wrap], true));

  /* Title + URL */
  const titleI = mountInput(model, "title", { placeholder: "Embed title" });
  const urlI = mountInput(model, "url", { placeholder: "Title URL — makes the title clickable" });
  form.appendChild(buildSection("Title",
    "Bold heading at the top of the embed. The URL makes the title clickable as a link.",
    [titleI.wrap, urlI.wrap], false));

  /* Description */
  const descI = mountTextarea(model, "description", { rows: 5,
    placeholder: "Description — supports Markdown, mentions, and emoji" });
  form.appendChild(buildSection("Description",
    "Main body of the embed. Full Markdown supported (bold, italic, lists, etc.).",
    [descI.wrap], false));

  /* Fields (default OPEN per E10) */
  const fieldsHost = el("div", { class: "embed-editor-fields" });
  function renderFields() {
    fieldsHost.innerHTML = "";
    model.fields.forEach((f, i) => {
      const nameI = mountInput(f, "name", { placeholder: "Field name (heading)" });
      const valueI = mountTextarea(f, "value", { rows: 2, placeholder: "Field value (Markdown + mentions + emoji)" });
      const inlineCb = el("input", { type: "checkbox", title: "Stack side-by-side with other inline fields" });
      if (f.inline) inlineCb.checked = true;
      inlineCb.addEventListener("change", () => { model.fields[i].inline = inlineCb.checked; debouncedRerender(); });
      const removeBtn = btn("", "fa-xmark", "btn-ghost sm-btn", () => {
        model.fields.splice(i, 1); renderFields(); rerender();
      });
      const inlineLabel = el("label", { class: "opt-toggle", title: "Inline (3 per row max)", style: "font-size:.78rem;color:var(--text-faint)" },
        [inlineCb, " inline"]);
      const card = el("div", { style: "border:1px solid var(--border-soft);border-radius:.35rem;padding:.5rem;margin-bottom:.45rem;background:var(--surface-2)" }, [
        el("div", { style: "display:flex;align-items:center;gap:.5rem;margin-bottom:.35rem" }, [
          el("strong", { style: "font-size:.78rem;color:var(--text-faint)" }, [`Field ${i + 1}`]),
          inlineLabel, removeBtn,
        ]),
        nameI.wrap,
        valueI.wrap,
      ]);
      fieldsHost.appendChild(card);
    });
    fieldsHost.appendChild(btn("Add field", "fa-plus", "btn-ghost sm-btn embed-fields-add", () => {
      if (model.fields.length >= 25) { toast("Discord max is 25 fields per embed", "error"); return; }
      model.fields.push({ name: "", value: "", inline: false });
      renderFields(); rerender();
    }));
  }
  renderFields();
  form.appendChild(buildSection("Fields",
    "Named info blocks shown stacked inside the embed. Each field has a name (heading) and a value. " +
    "Toggle <code>inline</code> to put up to 3 fields side-by-side instead of stacking vertically.",
    [fieldsHost], false));

  /* Images */
  const thumbI = mountInput(model, "thumbnail_url",
    { placeholder: "Thumbnail URL — small image in upper right" });
  const imageI = mountInput(model, "image_url",
    { placeholder: "Image URL — large image below the embed" });
  const thumbDrop = makeUploadDrop(thumbI.input, model, "thumbnail_url");
  const imageDrop = makeUploadDrop(imageI.input, model, "image_url");
  form.appendChild(buildSection("Images",
    "Paste a URL or drop a file (PNG / JPEG / GIF / WebP, up to 10&nbsp;MB). Dropping the same image twice reuses the existing upload. " +
    "Thumbnail is small (upper right). Image is large (full-width below the body).",
    [thumbDrop, imageDrop], true));

  /* Footer + timestamp */
  const footerText = mountInput(model.footer, "text", { placeholder: "Footer text" });
  const footerIcon = mountInput(model.footer, "icon_url", { placeholder: "Footer icon URL" });
  const timestampSel = el("select", { class: "select" }, [
    el("option", { value: "none" }, ["No timestamp"]),
    el("option", { value: "now" }, ["Now (at time of send)"]),
  ]);
  timestampSel.value = model.timestamp;
  timestampSel.addEventListener("change", () => { model.timestamp = timestampSel.value; debouncedRerender(); });
  form.appendChild(buildSection("Footer",
    "Small text + icon at the bottom of the embed. Optional timestamp shown next to footer.",
    [footerText.wrap, footerIcon.wrap, timestampSel], true));

  /* Reaction roles — emoji↔role mappings the bot attaches once the embed is posted */
  const rxHost = el("div", { class: "rx-roles-host" });
  function renderRxRoles() {
    rxHost.innerHTML = "";
    const rr = model.reaction_roles;

    const modeSel = el("select", { class: "select" }, [
      el("option", { value: "toggle" }, ["Toggle — react adds, un-react removes"]),
      el("option", { value: "add_only" }, ["Add only — react adds; un-react does nothing"]),
      el("option", { value: "unique" }, ["Unique — picking one removes any other in this group"]),
    ]);
    modeSel.value = rr.mode || "toggle";
    modeSel.addEventListener("change", () => { rr.mode = modeSel.value; });
    rxHost.appendChild(el("div", { class: "rx-mode-row" }, [
      el("span", { class: "rx-mode-label" }, ["Mode"]), modeSel,
    ]));

    const rowsHost = el("div", { class: "rx-rows" });
    rr.entries.forEach((entry, idx) => {
      const emoI = el("input", { class: "text-input rx-emoji-input",
        placeholder: "👍 or :custom:", value: entry.emoji });
      emoI.addEventListener("input", () => { entry.emoji = emoI.value; });

      const roleSel = el("select", { class: "select rx-role-select" });
      roleSel.appendChild(el("option", { value: "" }, ["Select a role…"]));
      for (const r of (window.DC_LOOKUPS && window.DC_LOOKUPS.roles) || []) {
        roleSel.appendChild(el("option", { value: String(r.id) }, [`@${r.name}`]));
      }
      if (entry.role_id) roleSel.value = entry.role_id;
      roleSel.addEventListener("change", () => { entry.role_id = roleSel.value; });

      const removeBtn = btn("", "fa-trash", "btn-ghost sm-btn rx-row-remove", () => {
        rr.entries.splice(idx, 1); renderRxRoles();
      });

      rowsHost.appendChild(el("div", { class: "rx-row" }, [emoI, roleSel, removeBtn]));
    });
    rxHost.appendChild(rowsHost);

    rxHost.appendChild(btn("Add row", "fa-plus", "btn-ghost sm-btn", () => {
      if (rr.entries.length >= 20) {
        toast("Discord caps reactions per message at 20", "error"); return;
      }
      rr.entries.push({ emoji: "", role_id: "" });
      renderRxRoles();
    }));
  }
  renderRxRoles();
  form.appendChild(buildSection("Reaction roles",
    "Users get a role by reacting with the matching emoji on this embed. Leave empty to skip. " +
    "Existing reaction roles on this message will be replaced when you save.",
    [rxHost], true));

  function mountInput(target, key, opts) {
    const input = el("input", { class: "text-input", placeholder: opts.placeholder, value: target[key] || "" });
    input.addEventListener("input", () => { target[key] = input.value; debouncedRerender(); });
    const wrap = makeFormattableInputWrap(input);
    bindAutocomplete(input);
    return { input, wrap };
  }
  function mountTextarea(target, key, opts) {
    const input = el("textarea", { class: "text-input", rows: String(opts.rows || 3), placeholder: opts.placeholder }, [target[key] || ""]);
    input.addEventListener("input", () => { target[key] = input.value; debouncedRerender(); });
    const wrap = makeFormattableInputWrap(input);
    bindAutocomplete(input);
    return { input, wrap };
  }

  /* Wraps an image-URL input with a drag/drop zone + Upload button.
   * Drops + file picks POST to the upload endpoint, then write the returned
   * URL back into the input + the model so the preview updates instantly. */
  function makeUploadDrop(inputEl, target, key) {
    const status = el("div", { class: "upload-status muted" }, []);
    const fileInput = el("input", { type: "file", accept: "image/png,image/jpeg,image/gif,image/webp", style: "display:none" });
    const uploadBtn = el("button", { class: "btn-ghost sm-btn", type: "button" },
      [el("i", { class: "fa-solid fa-cloud-arrow-up" }), " Upload"]);
    uploadBtn.addEventListener("click", () => fileInput.click());

    const wrap = el("div", { class: "upload-drop" }, [
      el("div", { class: "upload-drop-inputrow" }, [inputEl.parentElement || inputEl, uploadBtn]),
      el("div", { class: "upload-drop-hint" }, ["Drop an image here, or click Upload"]),
      status,
      fileInput,
    ]);

    async function handleFile(file) {
      if (!file) return;
      if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) {
        toast("Only PNG, JPEG, GIF, or WebP images are allowed", "error");
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        toast("Image too large — max 10 MB per file", "error");
        return;
      }
      wrap.classList.add("uploading");
      status.textContent = `Uploading ${file.name} (${(file.size / 1024).toFixed(0)} KB)...`;
      try {
        const res = await apiUploadImage(file);
        inputEl.value = res.url;
        target[key] = res.url;
        inputEl.dispatchEvent(new Event("input", { bubbles: true }));
        status.textContent = res.deduped
          ? "Reused existing upload (same image)."
          : "Uploaded.";
        setTimeout(() => { status.textContent = ""; }, 2500);
      } catch (e) {
        status.textContent = `Upload failed: ${e.message}`;
      } finally {
        wrap.classList.remove("uploading");
      }
    }
    fileInput.addEventListener("change", () => handleFile(fileInput.files[0]));
    ["dragenter", "dragover"].forEach((ev) => wrap.addEventListener(ev, (e) => {
      e.preventDefault(); e.stopPropagation(); wrap.classList.add("drag-over");
    }));
    ["dragleave", "drop"].forEach((ev) => wrap.addEventListener(ev, (e) => {
      e.preventDefault(); e.stopPropagation(); wrap.classList.remove("drag-over");
    }));
    wrap.addEventListener("drop", (e) => {
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) handleFile(f);
    });
    return wrap;
  }

  _activeEditor = { existing, model, rerender };
  rerender();
  showEditorView();
  window.scrollTo({ top: 0, behavior: "instant" });
}

async function submitEditor() {
  if (!_activeEditor) return;
  const { existing, model } = _activeEditor;
  if (!existing && !model.channel_id) { toast("Pick a channel first", "error"); return; }
  const payload = serializeModel(model);
  const rxPayload = serializeRxRoles(model);
  // Frontend validation — every rx-role row must have both emoji and role.
  if (rxPayload && rxPayload.entries.some((e) => !e.emoji || !e.role_id)) {
    toast("Every reaction-role row needs both an emoji and a role", "error"); return;
  }
  try {
    if (existing) {
      await apiEditSentEmbed(existing.id, payload, rxPayload);
      toast("Edit queued — Discord message updates within ~30s", "ok");
    } else {
      await apiCreateSentEmbed(model.channel_id, payload, null, rxPayload);
      toast("Send queued — embed posts within ~30s", "ok");
    }
    await refreshSentEmbedsList();
    showListView();
  } catch (e) { toast(e.message || String(e), "error"); }
}

/* Returns null if rx-roles weren't touched, or a {mode, entries} payload.
 * Empty entries is a meaningful value (= delete existing group). */
function serializeRxRoles(m) {
  const rr = m.reaction_roles;
  if (!rr) return null;
  return { mode: rr.mode || "toggle",
    entries: (rr.entries || [])
      .filter((e) => e.emoji || e.role_id)
      .map((e) => ({ emoji: e.emoji.trim(), role_id: String(e.role_id) })) };
}

function serializeModel(m) {
  const out = {
    color: m.color || null,
    content: m.content || null,
    title: m.title || null,
    url: m.url || null,
    description: m.description || null,
    thumbnail_url: m.thumbnail_url || null,
    image_url: m.image_url || null,
    timestamp: m.timestamp || "none",
  };
  if (m.author && (m.author.name || m.author.icon_url || m.author.url)) out.author = { ...m.author };
  if (m.footer && (m.footer.text || m.footer.icon_url)) out.footer = { ...m.footer };
  if (m.fields && m.fields.length) {
    out.fields = m.fields.filter((f) => f.name || f.value).map((f) => ({ ...f }));
  }
  return out;
}

function buildSection(title, helpHtml, children, collapsed) {
  const head = el("div", { class: "embed-editor-section-head", style: "display:flex;align-items:center;gap:.4rem;cursor:pointer" }, [
    el("i", { class: "fas fa-caret-down caret", style: "transition:transform .15s" }),
    el("span", {}, [title]),
  ]);
  const body = el("div", { class: "embed-editor-section-body" }, [
    helpHtml ? el("div", { class: "embed-editor-section-help", html: helpHtml }) : null,
    ...children,
  ]);
  const wrap = el("div", { class: "embed-editor-section" + (collapsed ? " collapsed" : "") }, [head, body]);
  head.addEventListener("click", () => {
    wrap.classList.toggle("collapsed");
    head.querySelector(".caret").style.transform = wrap.classList.contains("collapsed") ? "rotate(-90deg)" : "";
  });
  if (collapsed) head.querySelector(".caret").style.transform = "rotate(-90deg)";
  return wrap;
}

/* ============================================================
 * Inputs with markdown toolbar + insertion picker buttons (E8/E9)
 * ============================================================ */
function makeFormattableInputWrap(input) {
  const toolbar = makeFormatToolbar(input);
  return el("div", { style: "margin:.25rem 0" }, [toolbar, input]);
}

function makeFormatToolbar(input) {
  const isTextarea = input.tagName === "TEXTAREA";
  const wrap = (before, after) => {
    const s = input.selectionStart, e = input.selectionEnd;
    const v = input.value;
    input.value = v.slice(0, s) + before + v.slice(s, e) + after + v.slice(e);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.focus();
    input.setSelectionRange(s + before.length, e + before.length);
  };
  const insertAtCursor = (text) => {
    const s = input.selectionStart, e = input.selectionEnd;
    input.value = input.value.slice(0, s) + text + input.value.slice(e);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.focus();
    const pos = s + text.length;
    input.setSelectionRange(pos, pos);
  };
  const tb = el("div", { class: "md-toolbar" });
  const mkBtn = (icon, title, onClick) => {
    const b = el("button", { type: "button", title }, [el("i", { class: `fas ${icon}` })]);
    b.addEventListener("mousedown", (e) => { e.preventDefault(); onClick(); });
    return b;
  };
  tb.appendChild(mkBtn("fa-bold", "Bold (Ctrl+B)", () => wrap("**", "**")));
  tb.appendChild(mkBtn("fa-italic", "Italic (Ctrl+I)", () => wrap("*", "*")));
  tb.appendChild(mkBtn("fa-underline", "Underline (Ctrl+U)", () => wrap("__", "__")));
  tb.appendChild(mkBtn("fa-strikethrough", "Strikethrough", () => wrap("~~", "~~")));
  if (isTextarea) {
    tb.appendChild(mkBtn("fa-code", "Inline code", () => wrap("`", "`")));
    tb.appendChild(mkBtn("fa-file-code", "Code block", () => wrap("```\n", "\n```")));
    tb.appendChild(mkBtn("fa-quote-right", "Quote", () => wrap("> ", "")));
    tb.appendChild(mkBtn("fa-eye-slash", "Spoiler", () => wrap("||", "||")));
    tb.appendChild(mkBtn("fa-heading", "Heading", () => wrap("### ", "")));
  }
  tb.appendChild(el("span", { class: "md-sep" }));
  tb.appendChild(mkBtn("fa-hashtag", "Insert channel", () => openInsertPicker(input, "channel", tb)));
  tb.appendChild(mkBtn("fa-at", "Insert role mention", () => openInsertPicker(input, "role", tb)));
  if (window.DC_LOOKUPS && window.DC_LOOKUPS.emojis && window.DC_LOOKUPS.emojis.length) {
    tb.appendChild(mkBtn("fa-face-grin-stars", "Insert custom emoji", () => openInsertPicker(input, "customEmoji", tb)));
  }
  tb.appendChild(mkBtn("fa-face-smile", "Insert emoji", () => openInsertPicker(input, "unicodeEmoji", tb)));
  // Bind shortcut keys.
  input.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
      if (e.key === "b") { e.preventDefault(); wrap("**", "**"); }
      else if (e.key === "i") { e.preventDefault(); wrap("*", "*"); }
      else if (e.key === "u") { e.preventDefault(); wrap("__", "__"); }
    }
  });
  return tb;
}

/* ============================================================
 * Insertion picker (E8/E13)
 * Modes: channel | role | customEmoji | unicodeEmoji
 * ============================================================ */
function openInsertPicker(input, mode, anchor) {
  closeInsertPickers();
  const dlg = el("div", { class: "insert-picker" });
  const search = el("input", { type: "text", placeholder: "Search…" });
  const head = el("div", { class: "insert-picker-search" }, [search]);
  const body = el("div", { class: "insert-picker-body" });
  dlg.appendChild(head); dlg.appendChild(body);
  document.body.appendChild(dlg);
  positionFloater(dlg, anchor, /*scrollOffset*/ false);
  search.focus();

  const insertAtCursor = (text) => {
    const s = input.selectionStart, e = input.selectionEnd;
    input.value = input.value.slice(0, s) + text + input.value.slice(e);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.focus();
    const pos = s + text.length;
    input.setSelectionRange(pos, pos);
  };

  function render(q) {
    body.innerHTML = "";
    const ql = (q || "").toLowerCase();
    if (mode === "channel") {
      const items = ((window.DC_LOOKUPS && window.DC_LOOKUPS.channels) || []).filter((c) => c.name.toLowerCase().includes(ql)).slice(0, 100);
      for (const c of items) {
        const row = el("div", { class: "insert-picker-item" }, [
          el("span", { class: "ac-color", style: "background:#5865f2" }),
          `#${c.name}`,
        ]);
        row.addEventListener("mousedown", (e) => { e.preventDefault(); insertAtCursor(`<#${c.id}>`); closeInsertPickers(); });
        body.appendChild(row);
      }
    } else if (mode === "role") {
      const items = ((window.DC_LOOKUPS && window.DC_LOOKUPS.roles) || []).filter((r) => r.name.toLowerCase().includes(ql)).slice(0, 100);
      for (const r of items) {
        const colorHex = r.color ? "#" + r.color.toString(16).padStart(6, "0") : "#99aab5";
        const row = el("div", { class: "insert-picker-item" }, [
          el("span", { class: "ac-color", style: `background:${colorHex}` }),
          `@${r.name}`,
        ]);
        row.addEventListener("mousedown", (e) => { e.preventDefault(); insertAtCursor(`<@&${r.id}>`); closeInsertPickers(); });
        body.appendChild(row);
      }
    } else if (mode === "customEmoji") {
      const items = ((window.DC_LOOKUPS && window.DC_LOOKUPS.emojis) || []).filter((em) => em.name.toLowerCase().includes(ql)).slice(0, 200);
      const grid = el("div", { class: "insert-picker-grid" });
      for (const em of items) {
        const b = el("button", { type: "button", title: `:${em.name}:` }, [
          el("img", { class: "ac-em", src: `https://cdn.discordapp.com/emojis/${em.id}.${em.animated ? "gif" : "webp"}?size=32`, alt: em.name }),
        ]);
        b.addEventListener("mousedown", (e) => { e.preventDefault(); insertAtCursor(em.animated ? `<a:${em.name}:${em.id}>` : `<:${em.name}:${em.id}>`); closeInsertPickers(); });
        grid.appendChild(b);
      }
      body.appendChild(grid);
    } else if (mode === "unicodeEmoji") {
      const filtered = UNICODE_EMOJI_CATALOGUE.flatMap((cat) => {
        const items = cat.items.filter(([_, name]) => !ql || name.toLowerCase().includes(ql));
        return items.length ? [{ name: cat.name, items }] : [];
      });
      for (const cat of filtered.slice(0, 12)) {
        body.appendChild(el("div", { class: "insert-picker-cat" }, [cat.name]));
        const grid = el("div", { class: "insert-picker-grid" });
        for (const [emoji, name] of cat.items.slice(0, 80)) {
          const b = el("button", { type: "button", title: name }, [emoji]);
          b.addEventListener("mousedown", (e) => { e.preventDefault(); insertAtCursor(emoji); closeInsertPickers(); });
          grid.appendChild(b);
        }
        body.appendChild(grid);
      }
    }
    if (!body.children.length) {
      body.appendChild(el("div", { style: "padding:1rem;text-align:center;color:var(--text-faint)" }, ["No matches"]));
    }
  }
  render("");
  search.addEventListener("input", () => render(search.value.trim()));
  search.addEventListener("keydown", (e) => { if (e.key === "Escape") closeInsertPickers(); });
  // Close on outside click.
  setTimeout(() => document.addEventListener("mousedown", _outsidePickerHandler, true), 0);
}
function _outsidePickerHandler(e) {
  if (e.target.closest(".insert-picker")) return;
  if (e.target.closest(".md-toolbar")) return;
  closeInsertPickers();
}
function closeInsertPickers() {
  document.querySelectorAll(".insert-picker").forEach((d) => d.remove());
  document.removeEventListener("mousedown", _outsidePickerHandler, true);
}

/* ============================================================
 * Autocomplete on direct typing (# @ : triggers)
 * ============================================================ */
function bindAutocomplete(input) {
  let dropdown = null;
  let activeIndex = 0;
  let activeMode = null;
  let activeStart = -1;
  let lastItems = [];

  function close() {
    if (dropdown) { dropdown.remove(); dropdown = null; }
    activeMode = null; activeStart = -1; lastItems = [];
  }
  function openWith(mode, start) {
    activeMode = mode; activeStart = start; activeIndex = 0;
    if (!dropdown) {
      dropdown = el("div", { class: "mention-autocomplete" });
      document.body.appendChild(dropdown);
    }
    refresh();
  }
  function refresh() {
    if (!activeMode || !window.DC_LOOKUPS) { close(); return; }
    const fragment = input.value.slice(activeStart + 1, input.selectionStart);
    if (/\s/.test(fragment)) { close(); return; }
    const q = fragment.toLowerCase();
    let pool = [];
    if (activeMode === "#") pool = (window.DC_LOOKUPS.channels || []).slice(0, 80);
    if (activeMode === "@") pool = (window.DC_LOOKUPS.roles || []).slice(0, 80);
    if (activeMode === ":") pool = (window.DC_LOOKUPS.emojis || []).slice(0, 80);
    lastItems = pool.filter((x) => x.name.toLowerCase().includes(q)).slice(0, 10);
    if (!lastItems.length) { close(); return; }
    dropdown.innerHTML = "";
    lastItems.forEach((it, i) => {
      const row = el("div", { class: "mention-ac-item" + (i === activeIndex ? " active" : "") });
      if (activeMode === "#") row.innerHTML = `<span class="ac-color" style="background:#5865f2"></span> #${escapeHtml(it.name)}`;
      else if (activeMode === "@") {
        const c = it.color ? "#" + it.color.toString(16).padStart(6, "0") : "#99aab5";
        row.innerHTML = `<span class="ac-color" style="background:${c}"></span> @${escapeHtml(it.name)}`;
      } else if (activeMode === ":") {
        const url = `https://cdn.discordapp.com/emojis/${it.id}.${it.animated ? "gif" : "webp"}?size=32`;
        row.innerHTML = `<img src="${escapeAttr(url)}" alt=""> :${escapeHtml(it.name)}:`;
      }
      row.addEventListener("mousedown", (e) => { e.preventDefault(); pick(i); });
      dropdown.appendChild(row);
    });
    positionFloater(dropdown, input, /*scrollOffset*/ true);
  }
  function pick(i) {
    const it = lastItems[i];
    if (!it) { close(); return; }
    const before = input.value.slice(0, activeStart);
    const after = input.value.slice(input.selectionStart);
    let token;
    if (activeMode === "#") token = `<#${it.id}>`;
    else if (activeMode === "@") token = `<@&${it.id}>`;
    else if (activeMode === ":") token = it.animated ? `<a:${it.name}:${it.id}>` : `<:${it.name}:${it.id}>`;
    input.value = before + token + after;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.focus();
    const newPos = (before + token).length;
    input.setSelectionRange(newPos, newPos);
    close();
  }
  input.addEventListener("input", () => {
    const pos = input.selectionStart;
    const upto = input.value.slice(0, pos);
    const m = upto.match(/[#@:][^\s#@:]*$/);
    if (!m) { close(); return; }
    const trigger = m[0][0];
    const start = pos - m[0].length;
    openWith(trigger, start);
  });
  input.addEventListener("keydown", (e) => {
    if (!dropdown) return;
    if (e.key === "ArrowDown") { e.preventDefault(); activeIndex = Math.min(lastItems.length - 1, activeIndex + 1); refresh(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); activeIndex = Math.max(0, activeIndex - 1); refresh(); }
    else if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pick(activeIndex); }
    else if (e.key === "Escape") { close(); }
  });
  input.addEventListener("blur", () => { setTimeout(close, 150); });
}

/* ============================================================
 * Discord-look preview (same renderer style as templates.js)
 * ============================================================ */
function renderEmbedPreview(m) {
  const content = m.content;
  const title = m.title;
  const desc = m.description;
  const author = (m.author && m.author.name) ? m.author : null;
  const footer = (m.footer && m.footer.text) ? m.footer : null;
  const color = m.color || "#5865f2";
  const fields = m.fields || [];
  const hasEmbed = title || desc || author || footer || m.image_url || m.thumbnail_url || fields.length > 0;
  if (!content && !hasEmbed) {
    return `<div class="dc-empty">Fill in any field to see the preview.</div>`;
  }
  const fieldHtml = [];
  let rowBuf = [];
  const flush = () => {
    if (!rowBuf.length) return;
    fieldHtml.push(rowBuf.map((f) =>
      `<div class="dc-field"><div class="dc-field-name">${renderInlineMarkdown(f.name)}</div><div class="dc-field-value">${renderInlineMarkdown(f.value)}</div></div>`).join(""));
    rowBuf = [];
  };
  for (const f of fields) {
    if (!f.name && !f.value) continue;
    if (!f.inline) { flush(); fieldHtml.push(`<div class="dc-field full"><div class="dc-field-name">${renderInlineMarkdown(f.name)}</div><div class="dc-field-value">${renderInlineMarkdown(f.value)}</div></div>`); }
    else { if (rowBuf.length === 3) flush(); rowBuf.push(f); }
  }
  flush();
  let tsText = "";
  if (m.timestamp === "now") tsText = "Today at " + new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const footerInner = footer ? `
    <div class="dc-footer">
      ${footer.icon_url ? `<img src="${escapeAttr(footer.icon_url)}" alt="">` : ""}
      <span>${renderInlineMarkdown(footer.text)}</span>
      ${tsText ? `<span class="dc-footer-sep">•</span><span>${escapeHtml(tsText)}</span>` : ""}
    </div>` : (tsText ? `<div class="dc-footer"><span>${escapeHtml(tsText)}</span></div>` : "");
  const channelLabel = (() => {
    const ch = window.DC_LOOKUPS && window.DC_LOOKUPS.channelsById[m.channel_id];
    return ch ? ch.name : "channel";
  })();
  return `
    <div class="dc-channel-banner"><i class="fas fa-hashtag"></i> ${escapeHtml(channelLabel)}</div>
    <div class="dc-msg">
      <div class="dc-avatar">B</div>
      <div class="dc-msg-content">
        <div class="dc-msg-head">
          <span class="dc-msg-name">Bot</span><span class="dc-bot-tag">BOT</span>
          <span class="dc-msg-time">Today at ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
        </div>
        ${content ? `<div class="dc-msg-text">${renderInlineMarkdown(content)}</div>` : ""}
        ${hasEmbed ? `
          <div class="dc-embed" style="border-left-color:${escapeAttr(color)}">
            <div class="dc-embed-body">
              ${author ? `<div class="dc-author">${author.icon_url ? `<img src="${escapeAttr(author.icon_url)}" alt="">` : ""}<span>${escapeHtml(author.name)}</span></div>` : ""}
              ${title ? `<div class="dc-title">${m.url ? `<a href="${escapeAttr(m.url)}" target="_blank" rel="noopener">${renderInlineMarkdown(title)}</a>` : renderInlineMarkdown(title)}</div>` : ""}
              ${desc ? `<div class="dc-desc">${renderInlineMarkdown(desc)}</div>` : ""}
              ${fieldHtml.length ? `<div class="dc-fields">${fieldHtml.join("")}</div>` : ""}
              ${m.image_url ? `<img class="dc-image" src="${escapeAttr(m.image_url)}" alt="">` : ""}
              ${footerInner}
            </div>
            ${m.thumbnail_url ? `<img class="dc-thumb" src="${escapeAttr(m.thumbnail_url)}" alt="">` : ""}
          </div>` : ""}
      </div>
    </div>`;
}

/* ============================================================
 * E13: Unicode emoji catalogue (curated, ~150 most-used)
 * ============================================================ */
const UNICODE_EMOJI_CATALOGUE = [
  { name: "Smileys", items: [
    ["😀","grinning"],["😃","smiley"],["😄","smile"],["😁","grin"],["😆","laughing"],
    ["😅","sweat smile"],["🤣","rofl"],["😂","joy"],["🙂","slight smile"],["🙃","upside down"],
    ["😉","wink"],["😊","blush"],["😇","innocent"],["🥰","loving"],["😍","heart eyes"],
    ["🤩","star eyes"],["😘","kiss"],["😗","kissing"],["😋","yum"],["😛","tongue"],
    ["😜","wink tongue"],["🤪","zany"],["😏","smirk"],["😎","cool"],["🤓","nerd"],
    ["😐","neutral"],["😶","speechless"],["🙄","eye roll"],["😬","grimace"],["🤥","liar"],
    ["😮","open mouth"],["😯","hushed"],["😲","astonished"],["😴","sleeping"],["😪","drowsy"],
    ["🤤","drooling"],["😵","dizzy"],["🤐","zipper mouth"],["🥴","woozy"],["🤢","nauseated"],
  ]},
  { name: "Gestures", items: [
    ["👍","thumbs up"],["👎","thumbs down"],["👏","clap"],["🙌","raised hands"],["🤝","handshake"],
    ["🙏","praying"],["👐","open hands"],["👋","wave"],["🤙","call me"],["🤘","rock on"],
    ["🤞","fingers crossed"],["✌️","peace"],["👌","ok hand"],["✋","raised hand"],["🖐️","hand splayed"],
    ["☝️","point up"],["👆","point up"],["👉","point right"],["👈","point left"],["👇","point down"],
    ["💪","muscle"],["🤜","right fist"],["🤛","left fist"],["✊","raised fist"],["👊","fist bump"],
  ]},
  { name: "Hearts & Symbols", items: [
    ["❤️","red heart"],["🧡","orange heart"],["💛","yellow heart"],["💚","green heart"],
    ["💙","blue heart"],["💜","purple heart"],["🖤","black heart"],["🤍","white heart"],
    ["💔","broken heart"],["❣️","heart exclamation"],["💕","two hearts"],["💖","sparkling heart"],
    ["💘","cupid"],["💝","heart with ribbon"],["💓","beating heart"],["💗","growing heart"],
    ["💞","revolving hearts"],["💟","heart decoration"],
    ["⭐","star"],["🌟","glow star"],["✨","sparkles"],["⚡","lightning"],["🔥","fire"],
    ["💯","100"],["✅","check"],["❌","cross"],["⚠️","warning"],["🚫","prohibited"],
    ["💯","100"],["🔔","bell"],["🔕","muted bell"],["📌","pin"],["📎","paperclip"],
  ]},
  { name: "Objects & Places", items: [
    ["🎉","party"],["🎊","confetti"],["🎁","gift"],["🎂","cake"],["🍰","slice cake"],
    ["📅","calendar"],["📆","date"],["🕐","clock"],["⏰","alarm"],["⌛","hourglass"],
    ["📍","red pin"],["🌍","earth"],["🌎","earth americas"],["🌏","earth asia"],["🗺️","map"],
    ["🚀","rocket"],["✈️","plane"],["🚗","car"],["🏠","house"],["🏢","office"],
    ["💻","laptop"],["📱","phone"],["🖥️","desktop"],["⌨️","keyboard"],["🖱️","mouse"],
    ["📧","email"],["💌","letter"],["📝","memo"],["📓","notebook"],["📚","books"],
    ["🎮","game"],["🎯","target"],["⚽","soccer"],["🏆","trophy"],["🥇","first place"],
  ]},
  { name: "Animals & Nature", items: [
    ["🐶","dog"],["🐱","cat"],["🐭","mouse"],["🐹","hamster"],["🐰","rabbit"],
    ["🦊","fox"],["🐻","bear"],["🐼","panda"],["🐨","koala"],["🐯","tiger"],
    ["🦁","lion"],["🐮","cow"],["🐷","pig"],["🐸","frog"],["🐵","monkey"],
    ["🐔","chicken"],["🐧","penguin"],["🐦","bird"],["🐤","chick"],["🦅","eagle"],
    ["🌸","cherry blossom"],["🌺","hibiscus"],["🌻","sunflower"],["🌹","rose"],["🌷","tulip"],
    ["🌳","tree"],["🌲","evergreen"],["🌴","palm tree"],["🍀","clover"],["🌱","seedling"],
  ]},
];

/* ---------------- utils ---------------- */
function debounce(fn, ms) {
  let t = null;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/**
 * Position ``floater`` relative to ``anchor`` (an input/textarea/button).
 * Flips above the anchor when there isn't enough room below the viewport,
 * and clamps horizontally so it doesn't run off either edge.
 *
 * ``scrollOffset`` controls whether the floater is position:absolute
 * (page coords — add scroll) or position:fixed (viewport coords).
 */
function positionFloater(floater, anchor, scrollOffset) {
  // Force layout to measure actual rendered size.
  floater.style.left = "0px";
  floater.style.top = "0px";
  const rect = anchor.getBoundingClientRect();
  const fRect = floater.getBoundingClientRect();
  const fh = fRect.height || 360;
  const fw = fRect.width || 320;
  const vh = window.innerHeight;
  const vw = window.innerWidth;
  const margin = 6;

  // Decide above vs below by available room. Prefer below; flip if cramped.
  const roomBelow = vh - rect.bottom;
  const roomAbove = rect.top;
  const placeAbove = roomBelow < fh + margin && roomAbove > roomBelow;

  let top = placeAbove ? rect.top - fh - margin : rect.bottom + margin;
  // Clamp vertically to stay in viewport.
  if (top < margin) top = margin;
  if (top + fh > vh - margin) top = Math.max(margin, vh - fh - margin);

  // Horizontal: anchor's left, but clamp so floater stays on-screen.
  let left = rect.left;
  if (left + fw > vw - margin) left = Math.max(margin, vw - fw - margin);
  if (left < margin) left = margin;

  if (scrollOffset) {
    top += window.scrollY;
    left += window.scrollX;
  }
  floater.style.top = `${top}px`;
  floater.style.left = `${left}px`;
}
