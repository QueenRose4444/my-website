/* ============================================================
 * compose.js — New mission compose form
 * ============================================================ */

async function loadComposeForm() {
  if (!state.selectedBot || !state.selectedGuild) return;
  const base = `/bots/${state.selectedBot}/guilds/${state.selectedGuild}`;

  // default time = 1 hour from now, rounded up to next 15 min
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
  els.composeWhen.value = toDatetimeLocalValue(d);
  if (!els.composeTz.value) els.composeTz.value = localTimezone();

  try {
    const chans = await api(`${base}/channels`);
    state.channelsCache = chans.channels;
    els.composeChannel.innerHTML = chans.channels.map((c) =>
      `<option value="${c.id}">#${escapeHtml(c.name)}</option>`).join("");

    const settings = await api(`${base}/settings`);
    state.rolesCache = settings.available_roles || [];
    // pre-populate with monitored roles
    state.composeRoleIds = (settings.monitored_roles || []).map((r) => String(r.id));
    renderComposeRolePicker();
    renderComposeRoleChips();

    const tpls = await api(`${base}/templates?kind=announcement`);
    els.composeTemplate.innerHTML = `<option value="">(use bot default)</option>` +
      tpls.templates.map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join("");

    // Populate the modlist-library picker from the live modlists endpoint.
    const ml = await api(`${base}/modlists`).catch(() => ({ modlists: [] }));
    const opts = (ml.modlists || []).map((m) => {
      const dot = m.is_active ? " · active" : "";
      return `<option value="${m.id}">${escapeHtml(m.name)} (${fmtBytes(m.html_bytes)}${dot})</option>`;
    }).join("");
    els.composeModlistLibrary.innerHTML = `<option value="">(none — use guild's active modlist)</option>` + opts;
  } catch (e) { toast(e.message, "error"); }
}

function renderComposeRolePicker() {
  const chosen = new Set(state.composeRoleIds);
  const candidates = state.rolesCache.filter((r) => !chosen.has(String(r.id)) && String(r.id) !== String(state.selectedGuild));
  els.composeRolePicker.innerHTML = `<option value="">Add a role…</option>` +
    candidates.map((r) => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join("");
}

function renderComposeRoleChips() {
  const chosen = state.composeRoleIds;
  els.composeRoleChips.innerHTML = chosen.length
    ? chosen.map((rid) => {
        const r = state.rolesCache.find((x) => String(x.id) === String(rid));
        const name = r ? r.name : `role-${rid}`;
        return `<span class="role-pill">
          <span class="role-color" style="background:${roleColor(r ? r.color : 0)}"></span>
          ${escapeHtml(name)}
          <button data-remove="${rid}" title="Remove" aria-label="Remove ${escapeAttr(name)}">×</button>
        </span>`;
      }).join("")
    : `<span class="role-empty">No roles selected. Add at least one before posting.</span>`;
  els.composeRoleChips.querySelectorAll("[data-remove]").forEach((b) =>
    b.addEventListener("click", () => {
      state.composeRoleIds = state.composeRoleIds.filter((x) => String(x) !== b.dataset.remove);
      renderComposeRolePicker();
      renderComposeRoleChips();
    }));
}

async function submitNewMission() {
  if (!els.composeChannel.value) return toast("Pick a channel", "error");
  if (state.composeRoleIds.length === 0) return toast("Pick at least one role", "error");
  if (!els.composeWhen.value) return toast("Set a date and time", "error");
  if (!els.composeTz.value.trim()) return toast("Set a timezone", "error");
  if (!els.composeTitle.value.trim()) return toast("Title required", "error");
  if (!els.composeBody.value.trim()) return toast("Body required", "error");

  els.composeSubmitBtn.disabled = true;
  els.composeSubmitBtn.innerHTML = `<span class="spinner"></span> Posting…`;
  try {
    // Resolve modlist for this mission. Three sources, picked in priority order:
    //   1. Upload a new file (creates a library entry first, then references its URL)
    //   2. Pick an existing library entry
    //   3. Fallback: pasted URL + plain-text notes (advanced section)
    let modlist_url = els.composeModlistUrl.value.trim() || null;
    let modlist_text = els.composeModlistText.value.trim() || null;

    const uploadedFile = els.composeModlistFile.files && els.composeModlistFile.files[0];
    if (uploadedFile) {
      const name = (els.composeModlistNewName.value || "").trim() || uploadedFile.name.replace(/\.html?$/i, "");
      const fd = new FormData();
      fd.append("file", uploadedFile, uploadedFile.name);
      fd.append("name", name);
      const res = await api(
        `/bots/${state.selectedBot}/guilds/${state.selectedGuild}/modlists/upload`,
        { method: "POST", body: fd },
      );
      modlist_text = modlist_text || `Modlist library #${res.id} — ${name}`;
      // The bot stores library entries by id; mission row stores text+url. We
      // surface the new entry in text so admins can trace it; pushing to the
      // server uses the active_modlist_id flow.
    } else if (els.composeModlistLibrary.value) {
      // Picked an existing library entry — set it active so the bot uses it.
      const mlId = els.composeModlistLibrary.value;
      try {
        await api(
          `/bots/${state.selectedBot}/guilds/${state.selectedGuild}/modlists/${mlId}/set-active`,
          { method: "POST" },
        );
      } catch (e) { /* non-fatal; user can re-activate from the library */ }
      modlist_text = modlist_text || `Library entry #${mlId}`;
    }

    const body = {
      channel_id: Number(els.composeChannel.value),
      role_ids: state.composeRoleIds.map(Number),
      when_local: els.composeWhen.value.replace("T", " "),
      tz: els.composeTz.value.trim(),
      title: els.composeTitle.value.trim(),
      body: els.composeBody.value,
      template_id: els.composeTemplate.value ? Number(els.composeTemplate.value) : null,
      modlist_url,
      modlist_text,
    };
    await api(`/bots/${state.selectedBot}/guilds/${state.selectedGuild}/missions`, {
      method: "POST", body: JSON.stringify(body),
    });
    toast("Mission queued — the bot will post within ~30s", "ok");
    // keep channel/roles/tz/template; reset title + body + modlist inputs
    els.composeTitle.value = "";
    els.composeBody.value = "";
    els.composeModlistUrl.value = "";
    els.composeModlistText.value = "";
    els.composeModlistFile.value = "";
    els.composeModlistNewName.value = "";
    els.composeModlistLibrary.value = "";
    els.composeTitle.focus();
  } catch (e) {
    toast(e.message, "error");
  } finally {
    els.composeSubmitBtn.disabled = false;
    els.composeSubmitBtn.innerHTML = `<i class="fas fa-paper-plane"></i> Post mission`;
  }
}
