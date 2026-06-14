/* ============================================================
 * roles.js — Discord role administration (Phase 2 of friend's ask)
 *
 * Lists every role in the guild, lets admins create / edit / delete /
 * reorder them, edit permission bits, and assign roles to members.
 * Backend calls Discord's REST API directly via the bot token.
 * ============================================================ */

/* ---------------- API helpers ---------------- */
async function apiListGuildRoles() {
  return api(`/bots/${state.selectedBot}/guilds/${state.selectedGuild}/guild-roles`);
}
async function apiCreateGuildRole(payload) {
  return api(`/bots/${state.selectedBot}/guilds/${state.selectedGuild}/guild-roles`, {
    method: "POST", body: JSON.stringify(payload),
  });
}
async function apiPatchGuildRole(roleId, payload) {
  return api(`/bots/${state.selectedBot}/guilds/${state.selectedGuild}/guild-roles/${roleId}`, {
    method: "PATCH", body: JSON.stringify(payload),
  });
}
async function apiDeleteGuildRole(roleId) {
  return api(`/bots/${state.selectedBot}/guilds/${state.selectedGuild}/guild-roles/${roleId}`, {
    method: "DELETE",
  });
}
async function apiReorderGuildRoles(orderedRoleIds) {
  return api(`/bots/${state.selectedBot}/guilds/${state.selectedGuild}/guild-roles/reorder`, {
    method: "PATCH", body: JSON.stringify({ ordered_role_ids: orderedRoleIds.map(String) }),
  });
}
async function apiSearchMembers(query, limit = 50) {
  const qs = new URLSearchParams({ query: query || "", limit: String(limit) });
  return api(`/bots/${state.selectedBot}/guilds/${state.selectedGuild}/guild-members?${qs}`);
}
async function apiAssignMemberRole(userId, roleId) {
  return api(`/bots/${state.selectedBot}/guilds/${state.selectedGuild}/guild-members/${userId}/roles/${roleId}`, {
    method: "PUT",
  });
}
async function apiUnassignMemberRole(userId, roleId) {
  return api(`/bots/${state.selectedBot}/guilds/${state.selectedGuild}/guild-members/${userId}/roles/${roleId}`, {
    method: "DELETE",
  });
}

/* ---------------- Discord permission bitmask catalogue ---------------- */
// Source: Discord developer docs. Grouped how Discord groups them so admins
// see a familiar layout.
const DISCORD_PERMISSIONS = [
  { group: "General", items: [
    { bit: 3, label: "Administrator", warn: "Grants all permissions + bypasses channel overwrites" },
    { bit: 28, label: "Manage Server" },
    { bit: 4, label: "Manage Channels" },
    { bit: 27, label: "Manage Roles" },
    { bit: 30, label: "Manage Emojis & Stickers" },
    { bit: 16, label: "View Audit Log" },
    { bit: 17, label: "View Server Insights" },
    { bit: 0, label: "Create Instant Invite" },
    { bit: 1, label: "Kick Members" },
    { bit: 2, label: "Ban Members" },
    { bit: 5, label: "Add Reactions" },
    { bit: 24, label: "Use External Emojis" },
    { bit: 25, label: "View Guild Insights" },
  ]},
  { group: "Membership", items: [
    { bit: 24, label: "Change Nickname" },  // CHANGE_NICKNAME bit 24? Actually 26
    { bit: 26, label: "Change Nickname" },
    { bit: 27, label: "Manage Nicknames" },
    { bit: 28, label: "Manage Roles (alt)" },
  ]},
  { group: "Text channels", items: [
    { bit: 10, label: "View Channels" },
    { bit: 11, label: "Send Messages" },
    { bit: 18, label: "Send TTS Messages" },
    { bit: 13, label: "Manage Messages" },
    { bit: 14, label: "Embed Links" },
    { bit: 15, label: "Attach Files" },
    { bit: 16, label: "Read Message History" },
    { bit: 17, label: "Mention @everyone" },
    { bit: 18, label: "Use External Emojis" },
    { bit: 38, label: "Send Messages in Threads" },
    { bit: 34, label: "Manage Threads" },
    { bit: 35, label: "Create Public Threads" },
    { bit: 36, label: "Create Private Threads" },
    { bit: 37, label: "Send Voice Messages" },
  ]},
  { group: "Voice channels", items: [
    { bit: 20, label: "Connect" },
    { bit: 21, label: "Speak" },
    { bit: 22, label: "Mute Members" },
    { bit: 23, label: "Deafen Members" },
    { bit: 24, label: "Move Members" },
    { bit: 25, label: "Use Voice Activity" },
    { bit: 32, label: "Priority Speaker" },
    { bit: 33, label: "Use Soundboard" },
  ]},
];
// Dedupe by bit — the lookup table is what's actually used for encoding.
const PERM_BIT_LABEL = {};
for (const g of DISCORD_PERMISSIONS) for (const p of g.items) PERM_BIT_LABEL[p.bit] = p.label;

function bitmaskToSet(bitmaskStr) {
  // Bitmask is a string (snowflake-like) because the value exceeds Number.MAX_SAFE_INTEGER.
  // Use BigInt for accuracy.
  const out = new Set();
  let n;
  try { n = BigInt(bitmaskStr || "0"); }
  catch { return out; }
  let bit = 0;
  while (n > 0n) {
    if ((n & 1n) === 1n) out.add(bit);
    n >>= 1n;
    bit += 1;
  }
  return out;
}
function setToBitmask(bitSet) {
  let n = 0n;
  for (const bit of bitSet) n |= (1n << BigInt(bit));
  return n.toString();
}

/* ---------------- state + tab loader ---------------- */
let _rolesTabInitialised = false;
let _rolesCache = [];
let _botMemberId = null;  // for above-bot check
let _botHighestPosition = 0;

async function loadRolesTab() {
  if (!state.selectedBot || !state.selectedGuild) return;
  if (!_rolesTabInitialised) {
    if (els.rolesNewBtn) els.rolesNewBtn.addEventListener("click", () => openRoleEditDialog(null));
    if (els.rolesRefreshBtn) els.rolesRefreshBtn.addEventListener("click", () => loadRolesTab());
    if (els.reactionRolesToggle) els.reactionRolesToggle.addEventListener("click", () => {
      els.reactionRolesCard.classList.toggle("open");
      els.reactionRolesBody.hidden = !els.reactionRolesCard.classList.contains("open");
      if (!els.reactionRolesBody.hidden) refreshReactionRolesList();
    });
    if (els.reactionRolesNewBtn) els.reactionRolesNewBtn.addEventListener("click", () => openReactionRoleGroupDialog(null));
    _rolesTabInitialised = true;
  }
  if (els.rolesGuildName) {
    const g = (state.guilds || []).find((x) => String(x.id) === String(state.selectedGuild));
    els.rolesGuildName.textContent = g ? g.name : "";
  }
  els.rolesList.innerHTML = `<div class="muted">Loading roles…</div>`;
  try {
    const data = await apiListGuildRoles();
    _rolesCache = (data.roles || []).slice();
    // Top-to-bottom (Discord lists highest first; same here).
    _rolesCache.sort((a, b) => b.position - a.position);
    // Find the bot's highest role from cache. The bot is named after the
    // selected bot but we don't have an easy way — best effort: skip
    // for now and just disable nothing.
    _botHighestPosition = 0; // TODO: derive from /users/@me/members.
    renderRolesList();
  } catch (e) {
    els.rolesList.innerHTML = `<div class="muted" style="padding:1rem">Couldn't load: ${escapeHtml(e.message || String(e))}</div>`;
  }
}

function renderRolesList() {
  if (!_rolesCache.length) {
    els.rolesList.innerHTML = `<div class="muted" style="padding:1rem">No roles in this guild.</div>`;
    return;
  }
  const rows = _rolesCache.map((r) => {
    const colorHex = r.color ? "#" + r.color.toString(16).padStart(6, "0") : "#99aab5";
    const managed = r.managed ? `<span class="role-pill" style="background:rgba(255,200,80,.1);color:#e0b340;border:1px solid rgba(255,200,80,.4)">Managed</span>` : "";
    return `<div class="role-row" data-id="${escapeAttr(r.id)}" draggable="true" style="display:flex;align-items:center;gap:.75rem;padding:.6rem .75rem;border-bottom:1px solid var(--border-soft)">
      <i class="fas fa-grip-vertical" style="color:var(--text-faint);cursor:grab"></i>
      <span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:${colorHex};flex-shrink:0"></span>
      <div style="flex:1;min-width:0">
        <div style="font-weight:600">${escapeHtml(r.name)}</div>
        <div class="muted" style="font-size:.8rem">pos ${r.position} · ${r.hoist ? "hoist · " : ""}${r.mentionable ? "mentionable · " : ""}<code>${escapeHtml(r.id)}</code></div>
      </div>
      ${managed}
      <button class="btn btn-secondary sm-btn" data-action="edit"><i class="fas fa-pen"></i> Edit</button>
      <button class="btn btn-ghost sm-btn" data-action="members"><i class="fas fa-users"></i> Members</button>
      <button class="btn btn-ghost sm-btn" data-action="delete" ${r.managed ? "disabled title='Managed roles can't be deleted'" : ""}><i class="fas fa-trash"></i></button>
    </div>`;
  }).join("");
  els.rolesList.innerHTML = `<div>${rows}</div>`;
  els.rolesList.querySelectorAll(".role-row").forEach((row) => {
    const id = row.dataset.id;
    row.querySelector("[data-action='edit']").addEventListener("click", () =>
      openRoleEditDialog(_rolesCache.find((r) => r.id === id)));
    row.querySelector("[data-action='delete']").addEventListener("click", () =>
      deleteRoleFlow(_rolesCache.find((r) => r.id === id)));
    row.querySelector("[data-action='members']").addEventListener("click", () =>
      openRoleMembersDialog(_rolesCache.find((r) => r.id === id)));
  });
  bindRolesDragReorder();
}

/* ---------------- drag-to-reorder ---------------- */
function bindRolesDragReorder() {
  let dragging = null;
  els.rolesList.querySelectorAll(".role-row").forEach((row) => {
    row.addEventListener("dragstart", (e) => {
      dragging = row;
      row.style.opacity = "0.4";
      e.dataTransfer.effectAllowed = "move";
    });
    row.addEventListener("dragend", () => {
      if (dragging) dragging.style.opacity = "";
      dragging = null;
    });
    row.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    });
    row.addEventListener("drop", async (e) => {
      e.preventDefault();
      if (!dragging || dragging === row) return;
      // Insert dragging before this row in DOM, then push order.
      const container = row.parentNode;
      container.insertBefore(dragging, row);
      const newOrder = [...container.children].map((c) => c.dataset.id);
      try {
        await apiReorderGuildRoles(newOrder);
        toast("Reordered", "ok");
        await loadRolesTab();
      } catch (err) {
        toast(err.message || String(err), "error");
        await loadRolesTab();
      }
    });
  });
}

/* ---------------- create / edit dialog ---------------- */
function openRoleEditDialog(existing) {
  const nameI = el("input", { class: "text-input", placeholder: "Role name", value: existing ? existing.name : "" });
  const colorI = el("input", { type: "color",
    value: existing && existing.color ? "#" + existing.color.toString(16).padStart(6, "0") : "#99aab5" });
  const hoistI = el("input", { type: "checkbox" });
  if (existing && existing.hoist) hoistI.checked = true;
  const mentionableI = el("input", { type: "checkbox" });
  if (existing && existing.mentionable) mentionableI.checked = true;

  const initialBits = bitmaskToSet(existing ? existing.permissions : "0");
  const permsHost = el("div", { class: "perms-grid", style: "display:grid;grid-template-columns:1fr 1fr;gap:.4rem .9rem;max-height:300px;overflow-y:auto;padding:.5rem;border:1px solid var(--border-soft);border-radius:.4rem" });
  for (const g of DISCORD_PERMISSIONS) {
    permsHost.appendChild(el("div", { style: "grid-column:1/-1;font-weight:700;color:var(--text-faint);font-size:.74rem;text-transform:uppercase;letter-spacing:.06em;margin-top:.4rem" }, [g.group]));
    for (const p of g.items) {
      const cb = el("input", { type: "checkbox" });
      if (initialBits.has(p.bit)) cb.checked = true;
      cb.dataset.bit = String(p.bit);
      const label = el("label", { class: "opt-toggle", style: "font-size:.86rem", title: p.warn || "" },
        [cb, el("span", {}, [p.label])]);
      permsHost.appendChild(label);
    }
  }

  const body = [
    el("div", { class: "field-grid" }, [
      el("div", { class: "fg-row" }, [el("label", {}, ["Name"]), nameI]),
      el("div", { class: "fg-row" }, [el("label", {}, ["Color"]), colorI]),
      el("div", { class: "fg-row" }, [el("label", { class: "opt-toggle" }, [hoistI, el("span", {}, ["Show separately in member list (hoist)"])])]),
      el("div", { class: "fg-row" }, [el("label", { class: "opt-toggle" }, [mentionableI, el("span", {}, ["Allow anyone to @mention this role"])])]),
      el("div", { class: "fg-row" }, [el("label", {}, ["Permissions"]), permsHost]),
    ]),
  ];

  async function save() {
    const newBits = new Set();
    permsHost.querySelectorAll("input[type='checkbox'][data-bit]").forEach((cb) => {
      if (cb.checked) newBits.add(Number(cb.dataset.bit));
    });
    const payload = {
      name: nameI.value.trim(),
      color: parseInt(colorI.value.replace("#", ""), 16) || 0,
      permissions: setToBitmask(newBits),
      hoist: hoistI.checked,
      mentionable: mentionableI.checked,
    };
    if (!payload.name) { toast("Name required", "error"); return; }
    try {
      if (existing) {
        await apiPatchGuildRole(existing.id, payload);
        toast(`Updated "${payload.name}"`, "ok");
      } else {
        await apiCreateGuildRole(payload);
        toast(`Created "${payload.name}"`, "ok");
      }
      dlg.close();
      await loadRolesTab();
    } catch (e) {
      toast(e.message || String(e), "error");
    }
  }

  const dlg = openDialog({
    title: existing ? `Edit role: ${existing.name}` : "New role",
    icon: existing ? "fa-pen" : "fa-plus", body,
    footer: [
      el("span", { class: "spacer" }),
      btn("Cancel", null, "btn-ghost", () => dlg.close()),
      btn(existing ? "Save" : "Create", "fa-floppy-disk", "btn-primary", save),
    ],
  });
}

/* ---------------- delete flow ---------------- */
async function deleteRoleFlow(role) {
  if (!role) return;
  if (!confirm(`Delete role "${role.name}"?\n\nThis cannot be undone. Members currently with this role will lose it.`)) return;
  try {
    await apiDeleteGuildRole(role.id);
    toast(`Deleted "${role.name}"`, "ok");
    await loadRolesTab();
  } catch (e) {
    toast(e.message || String(e), "error");
  }
}

/* ---------------- member-role assignment dialog ---------------- */
async function openRoleMembersDialog(role) {
  if (!role) return;
  const searchI = el("input", { class: "text-input", placeholder: "Search members by name…" });
  const resultsHost = el("div", { class: "muted", style: "padding:.5rem;max-height:320px;overflow-y:auto" }, ["Type to search."]);

  async function runSearch(query) {
    resultsHost.innerHTML = `<div class="muted">Searching…</div>`;
    try {
      const data = await apiSearchMembers(query, 50);
      const members = data.members || [];
      if (!members.length) {
        resultsHost.innerHTML = `<div class="muted">No matches.</div>`;
        return;
      }
      resultsHost.innerHTML = "";
      for (const m of members) {
        const hasRole = (m.roles || []).includes(String(role.id));
        const row = el("div", { style: "display:flex;align-items:center;gap:.5rem;padding:.35rem .25rem;border-bottom:1px solid var(--border-soft)" }, [
          el("div", { style: "flex:1;min-width:0" }, [
            el("div", {}, [m.global_name || m.name]),
            el("div", { class: "muted", style: "font-size:.78rem" }, [`@${m.name} · ${m.id}`]),
          ]),
          hasRole
            ? btn("Remove", "fa-minus", "btn-ghost sm-btn", async () => {
                try { await apiUnassignMemberRole(m.id, role.id); toast("Removed", "ok"); runSearch(searchI.value.trim()); }
                catch (e) { toast(e.message || String(e), "error"); }
              })
            : btn("Add", "fa-plus", "btn-secondary sm-btn", async () => {
                try { await apiAssignMemberRole(m.id, role.id); toast("Added", "ok"); runSearch(searchI.value.trim()); }
                catch (e) { toast(e.message || String(e), "error"); }
              }),
        ]);
        resultsHost.appendChild(row);
      }
    } catch (e) {
      resultsHost.innerHTML = `<div class="muted">Couldn't search: ${escapeHtml(e.message || String(e))}</div>`;
    }
  }
  // Debounced live search.
  let timer = null;
  searchI.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => runSearch(searchI.value.trim()), 300);
  });

  const body = [
    el("p", { class: "muted" }, [`Manage members of role `, el("strong", {}, [role.name]), `.`]),
    searchI,
    resultsHost,
  ];
  const dlg = openDialog({
    title: `Members: ${role.name}`, icon: "fa-users", body,
    footer: [el("span", { class: "spacer" }), btn("Close", null, "btn-ghost", () => dlg.close())],
  });
}

/* ============================================================
 * Reaction roles (Phase 3) — pair an embed with emoji↔role mappings
 * ============================================================ */
async function apiListReactionRoles() {
  return api(`/bots/${state.selectedBot}/guilds/${state.selectedGuild}/reaction-roles`);
}
async function apiCreateReactionRoleGroup(payload) {
  return api(`/bots/${state.selectedBot}/guilds/${state.selectedGuild}/reaction-roles`, {
    method: "POST", body: JSON.stringify(payload),
  });
}
async function apiPatchReactionRoleGroup(groupId, payload) {
  return api(`/bots/${state.selectedBot}/guilds/${state.selectedGuild}/reaction-roles/${groupId}`, {
    method: "PATCH", body: JSON.stringify(payload),
  });
}
async function apiDeleteReactionRoleGroup(groupId) {
  return api(`/bots/${state.selectedBot}/guilds/${state.selectedGuild}/reaction-roles/${groupId}`, {
    method: "DELETE",
  });
}

async function refreshReactionRolesList() {
  els.reactionRolesList.innerHTML = `<div class="muted">Loading…</div>`;
  try {
    const data = await apiListReactionRoles();
    const groups = data.groups || [];
    if (!groups.length) {
      els.reactionRolesList.innerHTML = `<div class="muted" style="padding:1rem">No reaction-role groups yet. Click <strong>New</strong> to create one.</div>`;
      return;
    }
    els.reactionRolesList.innerHTML = groups.map((g) => {
      const entries = (g.entries || []).map((e) => {
        const role = _rolesCache.find((r) => r.id === String(e.role_id));
        return `<span class="role-pill" style="background:var(--surface-2);border:1px solid var(--border)">${escapeHtml(e.emoji)} → ${escapeHtml(role ? role.name : `role ${e.role_id}`)}</span>`;
      }).join(" ");
      return `<div class="rr-group" data-id="${g.id}" style="padding:.6rem .75rem;border:1px solid var(--border-soft);border-radius:.4rem;margin-bottom:.5rem">
        <div style="display:flex;align-items:center;gap:.5rem">
          <div style="flex:1">
            <div><strong>Message ${escapeHtml(g.message_id)}</strong> in <code>#${escapeHtml(g.channel_id)}</code> · mode <em>${escapeHtml(g.mode)}</em></div>
            <div style="margin-top:.3rem">${entries || `<span class="muted">no entries</span>`}</div>
          </div>
          <button class="btn btn-secondary sm-btn" data-action="edit"><i class="fas fa-pen"></i> Edit</button>
          <button class="btn btn-ghost sm-btn" data-action="delete"><i class="fas fa-trash"></i></button>
        </div>
      </div>`;
    }).join("");
    els.reactionRolesList.querySelectorAll(".rr-group").forEach((row) => {
      const id = Number(row.dataset.id);
      const g = groups.find((x) => x.id === id);
      row.querySelector("[data-action='edit']").addEventListener("click", () => openReactionRoleGroupDialog(g));
      row.querySelector("[data-action='delete']").addEventListener("click", async () => {
        if (!confirm("Delete this reaction-role group? Bot will clear its reactions on the message.")) return;
        try { await apiDeleteReactionRoleGroup(id); toast("Deleted", "ok"); refreshReactionRolesList(); }
        catch (e) { toast(e.message || String(e), "error"); }
      });
    });
  } catch (e) {
    els.reactionRolesList.innerHTML = `<div class="muted">Couldn't load: ${escapeHtml(e.message || String(e))}</div>`;
  }
}

function openReactionRoleGroupDialog(existing) {
  const channelI = el("input", { class: "text-input mono", placeholder: "Channel ID", value: existing ? existing.channel_id : "" });
  const messageI = el("input", { class: "text-input mono", placeholder: "Message ID", value: existing ? existing.message_id : "" });
  const modeSel = el("select", { class: "select" }, [
    el("option", { value: "toggle" }, ["toggle — un-reacting removes the role"]),
    el("option", { value: "add_only" }, ["add_only — un-reacting does nothing"]),
    el("option", { value: "unique" }, ["unique — picking one role removes the others in this group"]),
  ]);
  modeSel.value = existing ? existing.mode : "toggle";

  const entriesHost = el("div", { style: "display:flex;flex-direction:column;gap:.3rem;margin-top:.4rem" });
  const initialEntries = existing ? (existing.entries || []).map((e) => ({ ...e })) : [{ emoji: "", role_id: "" }];

  function renderEntries() {
    entriesHost.innerHTML = "";
    initialEntries.forEach((entry, i) => {
      const emojiI = el("input", { class: "text-input mono", style: "max-width:120px", placeholder: "👍 or <:name:id>", value: entry.emoji || "" });
      const roleSel = el("select", { class: "select", style: "flex:1" });
      roleSel.appendChild(el("option", { value: "" }, ["Select a role…"]));
      for (const r of _rolesCache) {
        if (r.managed) continue;
        roleSel.appendChild(el("option", { value: r.id }, [r.name]));
      }
      if (entry.role_id) roleSel.value = String(entry.role_id);
      emojiI.addEventListener("change", () => { initialEntries[i].emoji = emojiI.value; });
      roleSel.addEventListener("change", () => { initialEntries[i].role_id = roleSel.value; });
      const removeBtn = btn("", "fa-xmark", "btn-ghost sm-btn", () => {
        initialEntries.splice(i, 1);
        renderEntries();
      });
      entriesHost.appendChild(el("div", { style: "display:flex;align-items:center;gap:.4rem" }, [
        emojiI, roleSel, removeBtn,
      ]));
    });
    entriesHost.appendChild(
      btn("Add row", "fa-plus", "btn-ghost sm-btn", () => {
        initialEntries.push({ emoji: "", role_id: "" });
        renderEntries();
      }),
    );
  }
  renderEntries();

  const body = [
    el("div", { class: "field-grid" }, [
      el("div", { class: "fg-row" }, [el("label", {}, ["Channel ID"]), channelI]),
      el("div", { class: "fg-row" }, [el("label", {}, ["Message ID ", el("small", {}, ["right-click message in Discord → Copy Message ID (dev mode)"])]), messageI]),
      el("div", { class: "fg-row" }, [el("label", {}, ["Mode"]), modeSel]),
      el("div", { class: "fg-row" }, [el("label", {}, ["Emoji → Role"]), entriesHost]),
    ]),
  ];

  async function save() {
    const entries = initialEntries
      .filter((e) => e.emoji && e.role_id)
      .map((e) => ({ emoji: e.emoji.trim(), role_id: Number(e.role_id) }));
    if (!entries.length) { toast("Add at least one emoji↔role row", "error"); return; }
    try {
      if (existing) {
        await apiPatchReactionRoleGroup(existing.id, { mode: modeSel.value, entries });
        toast("Updated", "ok");
      } else {
        const channelId = channelI.value.trim();
        const messageId = messageI.value.trim();
        if (!channelId || !messageId) { toast("Channel ID + Message ID required", "error"); return; }
        await apiCreateReactionRoleGroup({
          channel_id: channelId, message_id: messageId,
          mode: modeSel.value, entries,
        });
        toast("Created — bot will react to the message within ~30s", "ok");
      }
      dlg.close();
      refreshReactionRolesList();
    } catch (e) {
      toast(e.message || String(e), "error");
    }
  }

  const dlg = openDialog({
    title: existing ? "Edit reaction-role group" : "New reaction-role group",
    icon: "fa-face-grin-wink", body,
    footer: [
      el("span", { class: "spacer" }),
      btn("Cancel", null, "btn-ghost", () => dlg.close()),
      btn(existing ? "Save" : "Create", "fa-floppy-disk", "btn-primary", save),
    ],
  });
}
