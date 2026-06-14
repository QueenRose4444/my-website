/* ============================================================
 * arma_dialogs.js — action handlers + dialogs for the Arma tab.
 *   apply / apply&restart · new/edit loadout · modlist view/replace/
 *   new/rename/delete · pause / resume / end · reconcile drift.
 * All dialogs use the existing <dialog class="drawer"> primitive.
 * ============================================================ */

/* ============================================================
 * APPLY LOADOUT  (preview-apply → confirm → apply)
 * ============================================================ */
function openApplyDialog(ld, restart) {
  const s = liveSnap();
  const ml = modlistById(ld.modlist_id);
  const curMl = modlistById(s.active_modlist_id);
  const ev = liveEvent();
  const players = s.players || 0;
  const installing = s.power === "installing";

  const lines = [];
  // modlist
  if (ml) {
    lines.push(diffLine("ok", "fa-check", [
      el("span", { html: `Push modlist <strong>${escapeHtml(ml.name)}</strong> (${fmtBytes(ml.html_bytes)}) → <code>/modlist.html</code>` }),
      el("div", { class: "di-sub" }, [curMl ? `overwrites current “${curMl.name}” (${fmtBytes(curMl.html_bytes)})` : "no modlist is currently active"]),
    ]));
  } else {
    lines.push(diffLine("ok", "fa-check", [el("span", {}, ["No modlist push — this loadout runs vanilla"])]));
  }
  // boot mission
  lines.push(diffLine("ok", "fa-check", [
    el("span", { html: `Set boot mission to <code>${escapeHtml(ld.mission_pbo)}</code>` }),
    el("div", { class: "di-sub" }, [restart
      ? `currently ${s.mission_pretty} — restart will boot straight into this`
      : `currently ${s.mission_pretty} — admins switch live via #missions, or restart instead`]),
  ]));
  // auto-end existing event
  if (ev && ev.loadout_id !== ld.id) {
    const evLd = loadoutById(ev.loadout_id);
    lines.push(diffLine("warn", "fa-triangle-exclamation", [
      el("span", { html: `Live event <strong>#${ev.id}</strong> (${escapeHtml(evLd ? evLd.name : "—")}, started ${fmtDuration(ev.started_at)} ago) will be <strong>auto-ended</strong>` }),
      el("div", { class: "di-sub" }, [`reason “loadout_changed” — a new event starts for ${ld.name}`]),
    ]));
  }
  // restart line
  lines.push(diffLine("go", "fa-arrow-right", [
    el("span", { html: restart
      ? "Server will <strong>RESTART now</strong> — connected players are dropped"
      : "Server will <strong>not restart</strong> — keeps running the current mission" }),
  ]));

  const restartCallout = el("div", { class: "restart-callout" + (restart && players > 0 ? "" : " hidden") }, [
    el("i", { class: "fas fa-users" }),
    el("span", { html: `<strong>${players} player${players === 1 ? "" : "s"}</strong> ${players === 1 ? "is" : "are"} connected right now and will be disconnected by the restart.` }),
  ]);

  const body = [
    el("p", { class: "confirm-lead" }, ["Review what this loadout swap changes on the server before applying."]),
    el("div", { class: "diff-list" }, lines),
    restartCallout,
  ];

  const note = installing
    ? el("span", { class: "dialog-note warn" }, [el("i", { class: "fas fa-spinner" }), "Server is installing — actions disabled"])
    : el("span", { class: "dialog-note" }, [el("i", { class: "fas fa-circle-info" }), "You can change the boot default again any time"]);

  const applyCfgBtn = btn("Apply config", "fa-gear", "btn-secondary", () => { dlg.close(); doApply(ld, false); });
  const applyRsBtn = btn("Apply & restart", "fa-rocket", "btn-primary", () => { dlg.close(); doApply(ld, true); });
  if (installing) { applyCfgBtn.disabled = true; applyRsBtn.disabled = true; }

  const dlg = openDialog({
    title: `Apply loadout: ${ld.name}`, icon: restart ? "fa-rocket" : "fa-gear",
    body,
    footer: [note, btn("Cancel", null, "btn-ghost", () => dlg.close()), applyCfgBtn, applyRsBtn],
  });
}

async function doApply(ld, restart) {
  try {
    const res = await apiApplyLoadout(ld.id, restart);
    const parts = [];
    if (res.modlist_name) parts.push(`pushed modlist "${res.modlist_name}" (${fmtBytes(res.modlist_pushed_bytes)})`);
    if (res.cfg_changed) parts.push(`set boot mission ${res.boot_mission}`);
    else if (!res.cfg_changed) parts.push(`boot mission already ${res.boot_mission}`);
    if (res.restarted) parts.push("server restarting");
    else if (res.restart_error) parts.push(`restart failed: ${res.restart_error}`);
    toast(`Applied "${ld.name}" — ${parts.join(", ")}`, res.restart_error ? "error" : "ok");
    // Refresh loadouts to pick up the new last_applied_at + active_modlist_id.
    await fetchModlistsFromApi();
    await fetchLoadoutsFromApi();
    renderArma();
  } catch (e) {
    toast(e.message || String(e), "error");
  }
}

function diffLine(kind, icon, bodyChildren) {
  return el("div", { class: `diff-line ${kind}` }, [
    el("div", { class: "di" }, [el("i", { class: `fas ${icon}` })]),
    el("div", { class: "di-body" }, bodyChildren),
  ]);
}

/* ============================================================
 * RECONCILE DRIFT
 * ============================================================ */
function openReconcileDialog() {
  const s = liveSnap();
  const ev = eventById(s.active_event_id);
  const expectedLd = ev ? loadoutById(ev.loadout_id) : null;
  const body = [
    el("p", { class: "confirm-lead" }, ["The mission running on the server no longer matches the active event. Pick how to reconcile."]),
    el("div", { class: "diff-list" }, [
      diffLine("warn", "fa-triangle-exclamation", [
        el("span", { html: `Live mission: <code>${escapeHtml(s.mission_pbo)}</code>` }),
        el("div", { class: "di-sub" }, [`event #${s.active_event_id} expects ${escapeHtml(s.drift_expected_pbo || "—")}`]),
      ]),
    ]),
  ];
  const accept = btn("Accept live mission", "fa-check", "btn-secondary", () => {
    dlg.close();
    if (ev) ev.actions.push({ t: "drift", at: new Date().toISOString(), text: "Drift reconciled — accepted live mission", payload: `event now tracks ${s.mission_pbo}` });
    s.drift = false; s.drift_expected_pbo = null;
    if (expectedLd) { s.mission_pretty = s.mission_pretty; } // keep live
    armaState.scenario = "live";
    renderArma(); toast("Reconciled — event now tracks the live mission", "ok");
  });
  const reapply = btn("Re-apply expected loadout", "fa-rotate", "btn-primary", () => {
    dlg.close();
    if (expectedLd) openApplyDialog(expectedLd, true);
  });
  const dlg = openDialog({ title: "Reconcile drift", icon: "fa-arrows-rotate", body,
    footer: [btn("Cancel", null, "btn-ghost", () => dlg.close()), accept, reapply] });
}

/* ============================================================
 * END EVENT
 * (Pause / Resume removed 2026-06 — Antistasi resumes natively from disk.
 * See plan/so-we-need-to-zesty-sunbeam.)
 * ============================================================ */
function openEndDialog(ev) {
  const ld = loadoutById(ev.loadout_id);
  const def = armaState.loadouts.find((l) => l.is_default);
  const applyDefault = el("input", { type: "checkbox" });
  const body = [
    el("p", { class: "confirm-lead" }, [`End event #${ev.id} (${ld ? ld.name : "—"}). This is a record-keeping action — it does not change the server by itself.`]),
    el("div", { class: "diff-list" }, [
      diffLine("ok", "fa-check", [el("span", {}, [`Event #${ev.id} marked ended (reason: manual)`])]),
      diffLine("go", "fa-arrow-right", [el("span", {}, ["The server keeps running whatever's loaded"])]),
    ]),
    el("div", { class: "dialog-field" }, [
      el("label", { class: "opt-toggle" }, [applyDefault,
        el("span", {}, [`Also apply default loadout (${def ? def.name : "Sandbox"}) after ending`])]),
    ]),
  ];
  const dlg = openDialog({ title: `End event #${ev.id}`, icon: "fa-stop", narrow: true, body,
    footer: [btn("Cancel", null, "btn-ghost", () => dlg.close()),
      btn("End event", "fa-stop", "btn-danger", () => { dlg.close(); doEnd(ev, applyDefault.checked); })] });
}

async function doEnd(ev, applyDefault) {
  try {
    await apiEndEvent(ev.id, "manual");
    await fetchEventsFromApi();
    if (applyDefault) {
      const def = armaState.loadouts.find((l) => l.is_default);
      if (def) { await doApply(def, true); return; }
    }
    renderArma();
    toast(`Event #${ev.id} ended`, "ok");
  } catch (e) {
    toast(e.message || String(e), "error");
  }
}

/* ============================================================
 * NEW / EDIT LOADOUT
 * ============================================================ */
async function openNewLoadoutDialog(prefill = {}) { await loadoutForm(null, prefill); }
async function openEditLoadout(ld) { await loadoutForm(ld, {}); }

async function loadoutForm(existing, prefill) {
  // Fetch real installed PBOs from the Arma server before building the picker.
  let installed;
  try {
    installed = (await apiListInstalledMissions()).map((m) => m.name);
  } catch (e) {
    toast(`Couldn't list installed missions: ${e.message || e}`, "error");
    installed = [];
  }
  const nameI = el("input", { class: "text-input", placeholder: "Op Iron Shield", value: existing ? existing.name : (prefill.name || "") });
  const descI = el("textarea", { class: "text-input", rows: "2", placeholder: "Short admin notes…" }, [existing ? existing.description : ""]);

  // mission picker (paired with manual input — §05 channel-picker pattern)
  // Picker is rebuilt whenever the modlist selection changes so virtual
  // missions contributed by mods like Antistasi Ultimate can appear in their
  // own optgroup. The manual input is the source of truth for the saved value.
  const initialMission = existing ? existing.mission_pbo : (prefill.mission_pbo || "");
  const missionSel = makeSelect("ldMissionSel", [{ value: "", label: "Select an installed mission…" }], "");
  const missionManual = el("input", { class: "text-input mono", placeholder: "…or paste Name.MapName.pbo / Name.MapName", value: initialMission });
  function rebuildMissionOptions() {
    const selectedModlistId = modSel ? modSel.value : "";
    const selectedModlist = selectedModlistId
      ? armaState.modlists.find((m) => String(m.id) === selectedModlistId)
      : null;
    const virtuals = (selectedModlist && selectedModlist.virtual_missions) || [];
    const currentValue = missionManual.value || "";
    // Clear + rebuild.
    while (missionSel.firstChild) missionSel.removeChild(missionSel.firstChild);
    missionSel.appendChild(el("option", { value: "" }, ["Select a mission…"]));
    if (installed.length) {
      const og = document.createElement("optgroup");
      og.label = "Installed in /mpmissions";
      for (const m of installed) og.appendChild(el("option", { value: m }, [m]));
      missionSel.appendChild(og);
    }
    if (virtuals.length) {
      const og = document.createElement("optgroup");
      og.label = `Virtual (from ${selectedModlist ? selectedModlist.name : "modlist"})`;
      for (const m of virtuals) og.appendChild(el("option", { value: m }, [m]));
      missionSel.appendChild(og);
    }
    // Preserve the current selection if it matches any option, else leave at "".
    if (currentValue && [...missionSel.options].some((o) => o.value === currentValue)) {
      missionSel.value = currentValue;
    }
  }
  missionSel.addEventListener("change", () => { if (missionSel.value) missionManual.value = missionSel.value; });
  missionManual.addEventListener("change", () => { rebuildMissionOptions(); });

  // modlist picker
  const modOpts = armaState.modlists.map((m) => ({ value: String(m.id), label: `${m.name} (${fmtBytes(m.html_bytes)})` }));
  const modSel = makeSelect("ldModSel", [{ value: "", label: "Vanilla — no modlist" }, ...modOpts], existing && existing.modlist_id ? String(existing.modlist_id) : "");
  modSel.addEventListener("change", rebuildMissionOptions);
  rebuildMissionOptions();

  const isDefault = el("input", { type: "checkbox" });
  if (existing && existing.is_default) isDefault.checked = true;

  // Optional mission params — body of class Mission1 { class Params { ... } }.
  // One ``key = value;`` per line. Empty = empty Params block.
  const paramsI = el("textarea", {
    class: "text-input mono", rows: "3",
    placeholder: "autoLoadLastGame = 60;\nLogLevel = 2;",
  }, [existing && existing.mission_params ? existing.mission_params : ""]);

  // Optional A2S display name override. Lets admins teach the drift detector
  // what the mission reports as its display name (Antistasi Ultimate reports
  // ``Antistasi Ultimate - Altis`` for template ``Antistasi_Altis.Altis``).
  const a2sI = el("input", {
    class: "text-input mono",
    placeholder: "Antistasi Ultimate - Altis",
    value: existing && existing.expected_a2s_name ? existing.expected_a2s_name : "",
  });

  // Inline upload — mission PBO. Hidden file input + small button. On success
  // refreshes the installed-missions list and picks the new mission.
  const missionUploadInput = el("input", { type: "file", accept: ".pbo", hidden: "" });
  const missionUploadBtn = btn("Upload new .pbo…", "fa-cloud-arrow-up", "btn-ghost sm-btn",
    () => missionUploadInput.click());
  missionUploadInput.addEventListener("change", async () => {
    const f = missionUploadInput.files && missionUploadInput.files[0];
    if (!f) return;
    missionUploadBtn.disabled = true;
    try {
      await apiUploadMissionPbo(f, f.name, false);
      const fresh = await apiListInstalledMissions();
      installed = fresh.map((m) => m.name);
      missionManual.value = f.name;
      rebuildMissionOptions();
      toast(`Uploaded "${f.name}"`, "ok");
    } catch (e) {
      toast(e.message || String(e), "error");
    } finally {
      missionUploadBtn.disabled = false;
      missionUploadInput.value = "";
    }
  });

  // Inline upload — modlist HTML. Asks for a name then uploads.
  const modlistUploadInput = el("input", { type: "file", accept: ".html,.htm", hidden: "" });
  const modlistUploadBtn = btn("Upload new modlist…", "fa-cloud-arrow-up", "btn-ghost sm-btn",
    () => modlistUploadInput.click());
  modlistUploadInput.addEventListener("change", async () => {
    const f = modlistUploadInput.files && modlistUploadInput.files[0];
    if (!f) return;
    const defaultName = f.name.replace(/\.html?$/i, "");
    const givenName = prompt("Name for this modlist:", defaultName);
    if (!givenName) { modlistUploadInput.value = ""; return; }
    modlistUploadBtn.disabled = true;
    try {
      const res = await apiCreateModlistFromFile(f, givenName.trim(), null, false);
      await fetchModlistsFromApi();
      // Rebuild modlist picker options.
      while (modSel.firstChild) modSel.removeChild(modSel.firstChild);
      modSel.appendChild(el("option", { value: "" }, ["Vanilla — no modlist"]));
      for (const m of armaState.modlists) {
        modSel.appendChild(el("option", { value: String(m.id) }, [`${m.name} (${fmtBytes(m.html_bytes)})`]));
      }
      if (res && res.id) modSel.value = String(res.id);
      rebuildMissionOptions();
      toast(`Uploaded "${givenName}"`, "ok");
    } catch (e) {
      toast(e.message || String(e), "error");
    } finally {
      modlistUploadBtn.disabled = false;
      modlistUploadInput.value = "";
    }
  });

  const body = [
    el("div", { class: "field-grid" }, [
      el("div", { class: "fg-row" }, [el("label", {}, ["Name"]), nameI]),
      el("div", { class: "fg-row" }, [el("label", {}, ["Description ", el("small", {}, ["optional"])]), descI]),
      el("div", { class: "fg-row" }, [
        el("label", {}, ["Mission ", el("small", {}, ["pick from /mpmissions (PBO or unpacked folder like Antistasi_Altis.Altis), or paste a name"])]),
        selectWrap(missionSel), missionManual,
        el("div", { style: "margin-top:.25rem" }, [missionUploadBtn, missionUploadInput]),
      ]),
      el("div", { class: "fg-row" }, [
        el("label", {}, ["Modlist ", el("small", {}, ["pushed to /modlist.html on apply"])]),
        selectWrap(modSel),
        el("div", { style: "margin-top:.25rem" }, [modlistUploadBtn, modlistUploadInput]),
      ]),
      el("div", { class: "fg-row" }, [
        el("label", {}, [
          "Mission params ",
          el("small", {}, [
            "optional — body of ",
            el("code", {}, ["class Params"]),
            ". E.g. Antistasi's ",
            el("code", {}, ["autoLoadLastGame = 60;"]),
          ]),
        ]),
        paramsI,
      ]),
      el("div", { class: "fg-row" }, [
        el("label", {}, [
          "Expected A2S name ",
          el("small", {}, [
            "optional — what A2S reports as the running mission. Used by drift detection. ",
            "Leave blank to auto-derive from the template name. Set this for missions ",
            "that pick their own display name (e.g. Antistasi → ",
            el("code", {}, ["Antistasi Ultimate - Altis"]),
            ").",
          ]),
        ]),
        a2sI,
      ]),
      el("div", { class: "fg-row" }, [
        el("label", { class: "opt-toggle" }, [isDefault, el("span", {}, ["Boot default — the mission the server boots into (usually Sandbox)"])]),
      ]),
    ]),
  ];

  async function save() {
    const name = nameI.value.trim();
    const pbo = (missionSel.value || missionManual.value).trim();
    if (!name) { toast("Name is required", "error"); return; }
    if (!pbo) { toast("Pick a mission PBO", "error"); return; }
    const modlist_id = modSel.value ? Number(modSel.value) : null;
    const mission_params = paramsI.value.trim() || null;
    const expected_a2s_name = a2sI.value.trim() || null;
    try {
      if (existing) {
        await apiPatchLoadout(existing.id, {
          name, description: descI.value.trim(), mission_pbo: pbo,
          modlist_id, is_default: isDefault.checked, mission_params, expected_a2s_name,
        });
        toast(`Saved "${name}"`, "ok");
      } else {
        await apiCreateLoadout({
          name, description: descI.value.trim(), mission_pbo: pbo,
          modlist_id, is_default: isDefault.checked, mission_params, expected_a2s_name,
        });
        toast(`Created "${name}"`, "ok");
      }
      dlg.close();
      await fetchLoadoutsFromApi();
      renderArma();
    } catch (e) {
      toast(e.message || String(e), "error");
    }
  }

  const dlg = openDialog({
    title: existing ? `Edit loadout` : "New loadout", icon: "fa-list-check", body,
    footer: [existing ? btn("Delete", "fa-trash", "btn-danger", () => { dlg.close(); deleteLoadout(existing); }) : el("span", { class: "spacer" }),
      el("span", { class: "spacer" }),
      btn("Cancel", null, "btn-ghost", () => dlg.close()),
      btn(existing ? "Save loadout" : "Create loadout", "fa-floppy-disk", "btn-primary", save)],
  });
}

function duplicateLoadout(ld) {
  const copy = { ...ld, id: armaState.nextLoadoutId++, name: ld.name + " (copy)", is_default: false, last_run: null };
  const idx = armaState.loadouts.indexOf(ld);
  armaState.loadouts.splice(idx + 1, 0, copy);
  renderArma(); toast(`Duplicated “${ld.name}”`, "ok");
}
function toggleArchive(ld) {
  ld.archived = !ld.archived;
  renderArma(); toast(ld.archived ? `Archived “${ld.name}”` : `Unarchived “${ld.name}”`, "neutral");
}
function deleteLoadout(ld) {
  const body = [el("p", {}, [el("span", { html: `Delete loadout <strong>${escapeHtml(ld.name)}</strong>? It's soft-deleted (kept in the DB, hidden from the grid).` })])];
  const dlg = openDialog({ title: "Delete loadout", icon: "fa-trash", narrow: true, body,
    footer: [btn("Cancel", null, "btn-ghost", () => dlg.close()),
      btn("Delete", "fa-trash", "btn-danger", async () => {
        try {
          await apiArchiveLoadout(ld.id);
          dlg.close();
          await fetchLoadoutsFromApi();
          renderArma();
          toast(`Deleted "${ld.name}"`, "neutral");
        } catch (e) { toast(e.message || String(e), "error"); }
      })] });
}

/* ============================================================
 * MODLIST  — view / new / replace / rename / set-active / delete
 * ============================================================ */
function fakeModlistHtml(ml) {
  const mods = {
    1: ["CBA_A3", "SOG Prairie Fire", "CUP Terrains – Core", "CUP Terrains – Maps", "Unsung Vietnam War Mod", "ACE3"],
    2: ["CBA_A3", "ACE3", "ACRE2", "RHSUSAF", "RHSAFRF", "RHSGREF", "Enhanced Movement"],
    3: ["CBA_A3"],
    4: ["CBA_A3", "ACE3", "RHSUSAF", "RHSAFRF"],
    5: ["CBA_A3", "ACE3", "Legacy Pack"],
  }[ml.id] || ["CBA_A3"];
  const rows = mods.map((m) => `<tr data-type="ModContainer"><td data-type="DisplayName">${escapeHtml(m)}</td><td><a href="https://steamcommunity.com/sharedfiles/" data-type="Link">Steam</a></td></tr>`).join("");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Arma 3 - Preset ${escapeHtml(ml.name)}</title>
<style>body{font-family:Arial;background:#fff;color:#000;margin:1.5rem}h1{font-size:1.1rem}table{border-collapse:collapse;width:100%}td{border-top:1px solid #ccc;padding:.35rem .5rem;font-size:.85rem}a{color:#08c}</style>
</head><body><h1>Arma 3 &mdash; Preset <strong>${escapeHtml(ml.name)}</strong></h1>
<p>${mods.length} mods · exported for the launcher</p><table>${rows}</table></body></html>`;
}

async function openModlistView(ml) {
  // Fetch the real HTML blob from the backend (list view excludes it for size).
  let html = "";
  try {
    const detail = await apiGetModlistDetail(ml.id);
    html = detail.html || "";
  } catch (e) {
    toast(`Couldn't load modlist HTML: ${e.message || e}`, "error");
    return;
  }
  const frame = el("iframe", { class: "ml-frame", sandbox: "", srcdoc: html });
  const raw = el("pre", { class: "ml-raw" }, [html]);
  raw.parentNode || (raw.hidden = true);

  const seg = el("div", { class: "seg-control mini ml-view-tabs" }, [
    el("button", { class: "seg-btn active", "data-v": "rendered" }, ["Rendered"]),
    el("button", { class: "seg-btn", "data-v": "raw" }, ["Raw HTML"]),
  ]);
  seg.addEventListener("click", (e) => {
    const b = e.target.closest(".seg-btn"); if (!b) return;
    seg.querySelectorAll(".seg-btn").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    const v = b.dataset.v; frame.hidden = v !== "rendered"; raw.hidden = v !== "raw";
  });

  const meta = el("div", { class: "dr-meta-grid" }, [
    drStat("Size", fmtBytes(ml.html_bytes)),
    drStat("Source", ml.source),
    drStat("Updated", fmtRelative(ml.updated_at)),
    drStat("Origin", ml.source_ref || "—"),
  ]);

  const body = [
    el("p", { class: "muted", style: "margin:0 0 .4rem" }, [ml.description || ""]),
    meta, seg, frame, raw,
    el("p", { class: "muted", style: "font-size:.8rem;margin-top:.6rem" }, ["Rendered in a sandboxed iframe — launcher scripts are blocked, so the mod table is static."]),
  ];
  const dlg = openDialog({ title: ml.name, icon: "fa-cubes-stacked", body,
    footer: [btn("Replace HTML…", "fa-file-arrow-up", "btn-secondary", () => { dlg.close(); openReplaceModlist(ml); }),
      el("span", { class: "spacer" }),
      btn("Copy raw", "fa-copy", "btn-ghost", () => { navigator.clipboard && navigator.clipboard.writeText(html); toast("Copied raw HTML", "ok"); }),
      btn("Close", null, "btn-secondary", () => dlg.close())] });
}

// Mission PBO upload — mirrors the modlist library upload shape (file + name
// + optional auto-create-loadout). Posts to the same upload-mission endpoint
// the Server status tab uses.
function openMissionPboUploadDialog() {
  const fileI = el("input", { type: "file", accept: ".pbo", class: "text-input" });
  const filenameI = el("input", { class: "text-input mono", placeholder: "Auto: uses uploaded filename" });
  const restartAfter = el("input", { type: "checkbox" });
  const createLoadout = el("input", { type: "checkbox" });
  const loadoutName = el("input", { class: "text-input", placeholder: "Op Iron Shield", disabled: "" });
  createLoadout.addEventListener("change", () => { loadoutName.disabled = !createLoadout.checked ? "" : null; });

  fileI.addEventListener("change", () => {
    const f = fileI.files && fileI.files[0];
    if (f && !filenameI.value) filenameI.value = f.name;
    if (f && !loadoutName.value) loadoutName.value = f.name.replace(/\.[A-Za-z0-9]+\.pbo$/i, "").replace(/_/g, " ");
  });

  const body = [
    el("p", { class: "muted", style: "margin:0 0 .5rem" }, [
      "Upload a mission ", el("code", {}, [".pbo"]), " to ", el("code", {}, ["/mpmissions"]),
      " on the Arma server. The filename must follow ", el("code", {}, ["Name.MapName.pbo"]),
      " (the map suffix tells the server which terrain to load).",
    ]),
    el("div", { class: "field-grid" }, [
      el("div", { class: "fg-row" }, [el("label", {}, ["Mission PBO ", el("small", {}, ["max 50 MB"])]), fileI]),
      el("div", { class: "fg-row" }, [el("label", {}, ["Filename override ", el("small", {}, ["leave blank to use uploaded filename"])]), filenameI]),
      el("div", { class: "fg-row" }, [el("label", { class: "opt-toggle" }, [restartAfter, el("span", {}, ["Restart server after upload (required for the server to see the new mission in #missions)"])])]),
      el("div", { class: "fg-row" }, [el("label", { class: "opt-toggle" }, [createLoadout, el("span", {}, ["Also create a loadout for this mission"])])]),
      el("div", { class: "fg-row" }, [el("label", {}, ["Loadout name ", el("small", {}, ["only if 'Also create a loadout' is ticked"])]), loadoutName]),
    ]),
  ];

  async function upload() {
    const f = fileI.files && fileI.files[0];
    if (!f) { toast("Pick a .pbo file", "error"); return; }
    const name = (filenameI.value || f.name).trim();
    if (!/\.pbo$/i.test(name)) { toast("Filename must end in .pbo", "error"); return; }
    if (!/\./.test(name.slice(0, -4))) { toast("Filename must be Name.MapName.pbo (map suffix matters)", "error"); return; }
    if (f.size > 50 * 1024 * 1024) { toast(`File is ${(f.size / 1024 / 1024).toFixed(1)} MB — max is 50 MB`, "error"); return; }
    try {
      const res = await apiUploadMissionPbo(f, name, restartAfter.checked);
      toast(`Uploaded ${res.filename} (${fmtBytes(res.bytes)})${res.restarted ? " — restarting" : ""}`, "ok");
      if (createLoadout.checked) {
        const ldName = (loadoutName.value || name.replace(/\.[A-Za-z0-9]+\.pbo$/i, "")).trim();
        if (ldName) {
          try {
            await apiCreateLoadout({ name: ldName, mission_pbo: name, modlist_id: null, is_default: false });
            toast(`Created loadout "${ldName}"`, "ok");
          } catch (e) { toast(`Loadout create failed: ${e.message || e}`, "error"); }
        }
      }
      dlg.close();
      await fetchInstalledMissionsForLibrary();
      await fetchLoadoutsFromApi();
      renderArma();
    } catch (e) { toast(e.message || String(e), "error"); }
  }

  const dlg = openDialog({
    title: "Upload mission PBO", icon: "fa-flag-checkered", narrow: true, body,
    footer: [btn("Cancel", null, "btn-ghost", () => dlg.close()),
      btn("Upload", "fa-cloud-arrow-up", "btn-primary", upload)],
  });
}

// openSavesDialog removed 2026-06 — see plan/so-we-need-to-zesty-sunbeam.
// Antistasi handles its own save persistence; named save snapshots solved
// a problem we don't actually have. Keep this comment as a breadcrumb in
// case we ever re-introduce.

function openGenerateArmaTokenDialog() {
  if (!armaState._armaServerId) {
    toast("Save an Arma server config on the Server status tab first", "error");
    return;
  }
  const nameI = el("input", { class: "text-input", placeholder: "Co-admin Pete" });
  const expiryI = el("input", { type: "datetime-local", class: "text-input" });
  const body = [
    el("p", { class: "muted", style: "margin:0 0 .5rem" }, [
      "The token is shown ONCE — copy it immediately. The holder can manage Arma server #",
      String(armaState._armaServerId),
      " via the standalone ", el("code", {}, ["./arma/"]), " page.",
    ]),
    el("div", { class: "field-grid" }, [
      el("div", { class: "fg-row" }, [el("label", {}, ["Name ", el("small", {}, ["who is this for?"])]), nameI]),
      el("div", { class: "fg-row" }, [el("label", {}, ["Expires ", el("small", {}, ["optional — leave blank for no expiry"])]), expiryI]),
    ]),
  ];
  async function generate() {
    const name = nameI.value.trim();
    if (!name) { toast("Name is required", "error"); return; }
    let expiresAt = null;
    if (expiryI.value) {
      expiresAt = new Date(expiryI.value).toISOString();
    }
    try {
      const res = await apiCreateArmaToken(name, armaState._armaServerId, expiresAt);
      dlg.close();
      openTokenRevealDialog(res.name, res.token);
      await renderArmaTokensTable();
    } catch (e) { toast(e.message || String(e), "error"); }
  }
  const dlg = openDialog({
    title: "Generate access token", icon: "fa-key", narrow: true, body,
    footer: [btn("Cancel", null, "btn-ghost", () => dlg.close()),
      btn("Generate", "fa-key", "btn-primary", generate)],
  });
}

function openTokenRevealDialog(name, token) {
  const armaUrl = `${window.location.origin}${window.location.pathname.replace(/\/$/, "")}/arma/`;
  const tokenI = el("input", { class: "text-input mono", value: token, readonly: "", style: "font-size:0.85rem" });
  const urlI = el("input", { class: "text-input mono", value: armaUrl, readonly: "", style: "font-size:0.85rem" });
  const body = [
    el("p", {}, [el("strong", { style: "color:var(--warn)" }, ["Save this now — it won't be shown again."])]),
    el("div", { class: "field-grid" }, [
      el("div", { class: "fg-row" }, [el("label", {}, ["Token"]), tokenI,
        btn("Copy", "fa-copy", "btn-secondary sm-btn",
          () => { navigator.clipboard.writeText(token); toast("Token copied", "ok"); })]),
      el("div", { class: "fg-row" }, [el("label", {}, ["Standalone URL"]), urlI,
        btn("Copy URL", "fa-copy", "btn-secondary sm-btn",
          () => { navigator.clipboard.writeText(armaUrl); toast("URL copied", "ok"); })]),
    ]),
    el("p", { class: "muted", style: "margin-top:.5rem;font-size:.82rem" }, [
      `Send "${name}" both the URL and the token. They paste the token on first visit and get scoped access to this Arma server only.`,
    ]),
  ];
  const dlg = openDialog({
    title: `Token created: ${name}`, icon: "fa-circle-check", narrow: true, body,
    footer: [btn("Done", "fa-check", "btn-primary", () => dlg.close())],
  });
}

function openNewModlist() { modlistForm(null); }
function openReplaceModlist(ml) { modlistForm(ml, true); }

function modlistForm(existing, replaceMode) {
  const nameI = el("input", { class: "text-input", placeholder: "Vietnam Pack", value: existing ? existing.name : "", disabled: replaceMode ? "" : null });
  const descI = el("input", { class: "text-input", placeholder: "Short description…", value: existing ? existing.description : "" });
  const fileI = el("input", { type: "file", accept: ".html,text/html", class: "text-input" });
  const setActive = el("input", { type: "checkbox" });

  const body = [
    el("div", { class: "field-grid" }, [
      el("div", { class: "fg-row" }, [el("label", {}, ["Name ", existing ? el("small", {}, ["(locked while replacing)"]) : el("small", {}, ["unique per server"])]), nameI]),
      el("div", { class: "fg-row" }, [el("label", {}, ["Description ", el("small", {}, ["optional"])]), descI]),
      el("div", { class: "fg-row" }, [el("label", {}, ["Launcher export ", el("small", {}, [".html from the Arma 3 launcher"])]), fileI]),
      replaceMode ? null : el("div", { class: "fg-row" }, [el("label", { class: "opt-toggle" }, [setActive, el("span", {}, ["Set as the active modlist"])])]),
    ]),
  ];
  async function save() {
    const name = nameI.value.trim();
    if (!name) { toast("Name is required", "error"); return; }
    const file = fileI.files && fileI.files[0];
    if (!existing && !file) { toast("Pick a launcher .html file", "error"); return; }
    if (replaceMode && !file) { toast("Pick the replacement .html file", "error"); return; }
    try {
      if (existing && replaceMode) {
        await apiReplaceModlistHtml(existing.id, file);
        toast(`Replaced “${name}”`, "ok");
      } else if (existing) {
        await apiRenameModlist(existing.id, name);
        toast(`Saved “${name}”`, "ok");
      } else {
        await apiCreateModlistFromFile(file, name, descI.value.trim() || null, setActive.checked);
        toast(`Added “${name}”`, "ok");
      }
      dlg.close();
      await fetchModlistsFromApi();
      renderArma();
    } catch (e) {
      toast(e.message || String(e), "error");
    }
  }
  const dlg = openDialog({ title: replaceMode ? `Replace: ${existing.name}` : "New modlist", icon: "fa-cubes-stacked", narrow: true, body,
    footer: [btn("Cancel", null, "btn-ghost", () => dlg.close()),
      btn(replaceMode ? "Replace HTML" : "Add modlist", "fa-floppy-disk", "btn-primary", save)] });
}

function renameModlist(ml) {
  const nameI = el("input", { class: "text-input", value: ml.name });
  const body = [el("div", { class: "fg-row" }, [el("label", {}, ["Name"]), nameI])];
  const dlg = openDialog({ title: "Rename modlist", icon: "fa-i-cursor", narrow: true, body,
    footer: [btn("Cancel", null, "btn-ghost", () => dlg.close()),
      btn("Save", "fa-check", "btn-primary", async () => {
        const v = nameI.value.trim();
        if (!v) { toast("Name required", "error"); return; }
        try {
          await apiRenameModlist(ml.id, v);
          dlg.close();
          await fetchModlistsFromApi();
          renderArma();
          toast("Renamed", "ok");
        } catch (e) { toast(e.message || String(e), "error"); }
      })] });
}
async function setActiveModlist(ml) {
  try {
    await apiSetActiveModlist(ml.id);
    await fetchModlistsFromApi();
    renderArma();
    toast(`“${ml.name}” is now the active modlist`, "ok");
  } catch (e) { toast(e.message || String(e), "error"); }
}
function deleteModlist(ml, usedBy) {
  if (usedBy && usedBy.length) { toast(`Can't delete — used by ${usedBy.length} loadout${usedBy.length === 1 ? "" : "s"}`, "error"); return; }
  const dlg = openDialog({ title: "Delete modlist", icon: "fa-trash", narrow: true,
    body: [el("p", {}, [el("span", { html: `Delete modlist <strong>${escapeHtml(ml.name)}</strong>?` })])],
    footer: [btn("Cancel", null, "btn-ghost", () => dlg.close()),
      btn("Delete", "fa-trash", "btn-danger", async () => {
        try {
          await apiArchiveModlist(ml.id);
          dlg.close();
          await fetchModlistsFromApi();
          renderArma();
          toast(`Deleted “${ml.name}”`, "neutral");
        } catch (e) { toast(e.message || String(e), "error"); }
      })] });
}

function drStat(k, v) { return el("div", { class: "dr-stat" }, [el("div", { class: "k" }, [k]), el("div", { class: "v" }, [v])]); }
