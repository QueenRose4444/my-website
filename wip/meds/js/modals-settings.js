// ================================================
// modals-settings.js — the settings drawer, and import/export
//                      (which is reached from it)
// ================================================
(function () {
    'use strict';
    const D = window.MedData;
    const { Icons, $, $$, escapeHtml, openModal, confirmModal, toast, todayYmd, whenAgo } = window.UI;
    const Store = () => window.Store;
    // Other modal files, looked up when called rather than at load, so the five
    // files have no load order between them.
    const M = () => window.Modals;

    // ------------------------------------------------
    // Import / export
    // ------------------------------------------------
    // WHAT AN IMPORT WILL DO IS SHOWN BEFORE IT DOES IT.
    //
    // Both actions are previewed the same way — added / removed / changed /
    // unchanged, per section, counted from the real merge rather than described.
    // Removals are the number that matters and are given their own line.
    //
    // Merge and replace are NOT peers. Merge is the button; replace is a separate,
    // clearly destructive action that names the number of entries it will delete
    // before it will run. A segmented control made "wipe everything" one tap away
    // from "keep everything", which is how a backup that was not a superset
    // destroyed a year of dose records.

    /** One row per collection that actually changes. */
    function importPreviewHtml(preview) {
        const rows = preview.collections.filter(c => c.added || c.removed || c.changed);
        const t = preview.totals;
        const lines = rows.map(c => {
            const bits = [];
            if (c.added) bits.push(`<strong>+${c.added}</strong> added`);
            if (c.changed) bits.push(`<strong>${c.changed}</strong> changed`);
            if (c.removed) bits.push(`<strong class="txt-danger">−${c.removed}</strong> deleted`);
            bits.push(`${c.identical} unchanged`);
            return `<p><strong>${escapeHtml(c.label)}</strong> — ${bits.join(' · ')}</p>`;
        }).join('');

        const nothing = !rows.length
            ? '<p>Nothing would change — this backup matches what is already here.</p>' : '';

        const warn = t.removed
            ? `<div class="pen-hint warn" style="margin-top:10px">${Icons.alert}
                 <div><strong>This will delete ${t.removed} ${t.removed === 1 ? 'entry' : 'entries'}</strong>
                 that ${t.removed === 1 ? 'is' : 'are'} here now and not in the backup.
                 Deleted entries are removed from your other devices too.</div></div>`
            : `<div class="pen-hint" style="margin-top:10px">${Icons.check}
                 <div>Nothing will be deleted.</div></div>`;

        return `
            <div class="data-column" style="margin-top:10px">
                <h3>${preview.mode === 'replace' ? 'Replacing would' : 'Merging would'}</h3>
                ${lines || nothing}
            </div>
            ${warn}`;
    }

    function importExport() {
        const S = Store();
        let parsed = null;

        openModal({
            title: 'Import / export data',
            sub: 'Bring data in from the old site, or back everything up.',
            bodyHtml: `
                <div class="chip-grp" style="margin-bottom:16px" id="ieMode">
                    <button class="chip active" data-mode="import">Import</button>
                    <button class="chip" data-mode="export">Export</button>
                </div>
                <div id="importWrap">
                    <div class="field"><label>Backup file</label>
                        <input type="file" id="ieFile" accept=".json,application/json" class="file-input"></div>
                    <div class="field"><label>or paste JSON</label>
                        <textarea id="iePaste" rows="4" placeholder='{"shotHistory":[...],"weightHistory":[...],"userSettings":{...}}'></textarea></div>
                    <div id="iePreview"></div>
                    <div id="ieReplaceWrap" style="display:none;margin-top:14px;padding-top:12px;border-top:1px solid var(--border)">
                        <p class="dim-sm" style="margin-bottom:8px">Or throw away what is here and keep only the backup:</p>
                        <button class="btn danger" data-act="replace">${Icons.trash || ''} Replace everything instead…</button>
                    </div>
                </div>
                <div id="exportWrap" style="display:none">
                    <p class="confirm-text">Download a JSON backup of all your doses, weights, meds, supply and settings. The file also works with the old site's import.</p>
                    <div class="pen-hint col">
                        <div><strong>${S.state.shots.length}</strong> doses · <strong>${S.state.weights.length}</strong> weights · <strong>${S.state.meds.length}</strong> meds · <strong>${S.state.pens.length}</strong> supply items</div>
                    </div>
                </div>`,
            footHtml: `
                <button class="btn ghost" data-act="cancel">Cancel</button>
                <button class="btn primary" data-act="go" disabled>${Icons.check} Merge into my data</button>`,
            onMount(modal, close) {
                const goBtn = modal.querySelector('[data-act="go"]');
                let mode = 'import';
                const preview = modal.querySelector('#iePreview');
                const replaceWrap = modal.querySelector('#ieReplaceWrap');

                let kindHtml = '';
                const showPreview = (mergeOrReplace) => {
                    // Counted before anything is applied — this is the whole point.
                    preview.innerHTML = kindHtml + importPreviewHtml(S.previewImport(parsed, mergeOrReplace));
                };

                const handleText = text => {
                    try {
                        parsed = S.parseBackup(text);
                        const kind = parsed.kind === 'v2' ? 'v2 backup' : 'v1 / old-site backup';
                        kindHtml = `<div class="pen-hint col"><div>Read as a <strong>${kind}</strong></div></div>`;
                        showPreview('merge');
                        replaceWrap.style.display = '';
                        goBtn.disabled = false;
                    } catch (e) {
                        parsed = null;
                        kindHtml = '';
                        preview.innerHTML = `<div class="pen-hint warn">${Icons.alert} ${escapeHtml(e.message)}</div>`;
                        replaceWrap.style.display = 'none';
                        goBtn.disabled = true;
                    }
                };

                modal.querySelector('#ieMode').addEventListener('click', e => {
                    const b = e.target.closest('[data-mode]');
                    if (!b) return;
                    mode = b.dataset.mode;
                    modal.querySelectorAll('#ieMode .chip').forEach(c => c.classList.toggle('active', c.dataset.mode === mode));
                    modal.querySelector('#importWrap').style.display = mode === 'import' ? '' : 'none';
                    modal.querySelector('#exportWrap').style.display = mode === 'export' ? '' : 'none';
                    goBtn.innerHTML = mode === 'import' ? `${Icons.check} Merge into my data` : `${Icons.download} Download backup`;
                    goBtn.disabled = mode === 'import' ? !parsed : false;
                });
                modal.querySelector('#ieFile').addEventListener('change', e => {
                    const f = e.target.files && e.target.files[0];
                    if (!f) return;
                    const r = new FileReader();
                    r.onload = ev => handleText(ev.target.result);
                    r.readAsText(f);
                });
                modal.querySelector('#iePaste').addEventListener('input', e => { if (e.target.value.trim()) handleText(e.target.value); });
                modal.querySelector('[data-act="cancel"]').addEventListener('click', close);

                // The destructive path. It shows the replace preview — which is a
                // different set of numbers from the merge preview — and will not
                // run until the confirmation, which NAMES the deletions, is agreed.
                modal.querySelector('[data-act="replace"]').addEventListener('click', async () => {
                    if (!parsed) return;
                    const p = S.previewImport(parsed, 'replace');
                    showPreview('replace');
                    const n = p.totals.removed;
                    const msg = n
                        ? `This deletes ${n} ${n === 1 ? 'entry' : 'entries'} that ${n === 1 ? 'is' : 'are'} here now and not in the backup, on this device and on every device signed in to your account. It cannot be undone. Merging instead would keep all of it.`
                        : 'Replace everything with the backup? Nothing here would be deleted, since the backup already contains all of it.';
                    const ok = await confirmModal(msg, {
                        danger: true,
                        title: n ? `Delete ${n} ${n === 1 ? 'entry' : 'entries'}?` : 'Replace everything?',
                        yesLabel: n ? `Delete ${n} and replace` : 'Replace everything',
                    });
                    // Backing out puts the panel back on what the button says it
                    // will do, so the two can never disagree on screen.
                    if (!ok) { showPreview('merge'); return; }
                    await S.importBackup(parsed, 'replace');
                    toast(n ? `Replaced — ${n} deleted` : 'Replaced from backup');
                    close();
                });

                goBtn.addEventListener('click', async () => {
                    if (mode === 'export') {
                        const blob = S.exportBackup();
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `med-tracker-backup-${todayYmd()}.json`;
                        document.body.appendChild(a); a.click(); a.remove();
                        URL.revokeObjectURL(url);
                        toast('Backup downloaded');
                        return;
                    }
                    if (!parsed) return;
                    await S.importBackup(parsed, 'merge');
                    toast('Import complete — nothing was deleted');
                    close();
                });
            },
        });
    }

    // ------------------------------------------------
    // Settings drawer
    // ------------------------------------------------
    function settingsDrawer() {
        const S = Store();
        const back = document.createElement('div');
        back.className = 'drawer-back';
        const drawer = document.createElement('div');
        drawer.className = 'drawer';
        document.body.appendChild(back);
        document.body.appendChild(drawer);
        const close = () => { back.remove(); drawer.remove(); };
        back.addEventListener('click', close);

        const render = () => {
            const set = S.state.settings;
            const loggedIn = S.isLoggedIn();
            // Changes the sync made on its own — a catch-up from the account copy,
            // a silent merge. Listed here because the toast that announced one is
            // long gone by the time somebody notices what it did.
            const syncActions = S.recentSyncActions ? S.recentSyncActions() : [];
            const chip = (group, val, label, cur) => `<button class="chip ${cur === val ? 'active' : ''}" data-set="${group}" data-val="${escapeHtml(String(val))}">${label}</button>`;
            const locs = set.shotLocations || [];

            drawer.innerHTML = `
                <div class="drawer-head"><h2>Settings</h2><button class="icon-btn" data-act="close">${Icons.close}</button></div>

                <div class="setting-block">
                    <div class="sr-label">Account</div>
                    ${loggedIn ? `
                        <div class="sr-sub" style="margin-bottom:8px">Signed in as <strong class="txt-accent">${escapeHtml(S.auth.currentUser ? S.auth.currentUser.username : 'user')}</strong> — data syncs automatically.</div>
                        <div class="sr-sub sync-line" style="margin-bottom:8px">${{
                            syncing: '<span class="pill">⟳ Syncing…</span>',
                            synced: '<span class="pill success"><span class="pill-dot"></span>Synced to your account</span>',
                            error: '<span class="pill danger"><span class="pill-dot"></span>Sync error — will retry</span>',
                        }[S.syncStatus] || '<span class="pill"><span class="pill-dot"></span>Sync idle</span>'}</div>
                        <div class="chip-grp">
                            <button class="chip" data-act="change-pass">Change password</button>
                            <button class="chip" data-act="logout">Log out</button>
                        </div>` : `
                        <div class="sr-sub" style="margin-bottom:8px">Not signed in — data only lives in this browser.</div>
                        <div class="chip-grp">
                            <button class="chip" data-act="login">Log in</button>
                            <button class="chip" data-act="register">Register</button>
                        </div>`}
                </div>

                ${syncActions.length ? `
                <div class="setting-block">
                    <div class="sr-label">Recent sync actions</div>
                    <div class="sr-sub" style="margin-bottom:8px">Changes sync made on its own. Putting one back asks your other device before anything there changes.</div>
                    <div class="sync-action-list">
                        ${syncActions.map(a => `
                            <div class="sync-action">
                                <span class="sa-text">
                                    <span class="sa-msg">${escapeHtml(a.message)}</span>
                                    <span class="sa-when">${escapeHtml(whenAgo(a.at))}</span>
                                </span>
                                <button class="btn small ghost" data-revert="${escapeHtml(a.id)}">Revert</button>
                            </div>`).join('')}
                    </div>
                </div>` : ''}

                <div class="setting-block">
                    <div class="sr-label">Appearance</div>
                    <div class="setting-row"><span class="sr-sub">Theme</span>
                        <div class="chip-grp">${chip('theme', 'dark', 'Dark', set.theme)}${chip('theme', 'light', 'Light', set.theme)}</div></div>
                    <div class="setting-row"><span class="sr-sub">Accent</span>
                        <div class="swatch-row">
                            ${[['teal', '#5fc8c8'], ['violet', '#a78bfa'], ['amber', '#f0b955'], ['green', '#6fcf97'], ['rose', '#f48fb1']].map(([k, c]) =>
                                `<button class="swatch-btn ${set.accent === k ? 'active' : ''}" style="background:${c}" data-set="accent" data-val="${k}"></button>`).join('')}
                        </div></div>
                </div>

                <div class="setting-block">
                    <div class="sr-label">Mobile text size</div>
                    <div class="setting-row"><span class="sr-sub">Bigger text on phones</span>
                        <div class="chip-grp">${[['md', 'Normal'], ['lg', 'Large'], ['xl', 'Extra large']].map(([v, l]) =>
                            `<button class="chip ${(set.textScale || 'lg') === v ? 'active' : ''}" data-set="textScale" data-val="${v}">${l}</button>`).join('')}</div></div>
                </div>

                <div class="setting-block">
                    <div class="sr-label">Formats</div>
                    <div class="setting-row"><span class="sr-sub">Time</span>
                        <div class="chip-grp">${chip('timeFormat', '12hr', '12h', set.timeFormat)}${chip('timeFormat', '24hr', '24h', set.timeFormat)}</div></div>
                    <div class="setting-row"><span class="sr-sub">Date</span>
                        <div class="chip-grp">${chip('dateFormat', 'dd/mm/yyyy', 'DD/MM', set.dateFormat)}${chip('dateFormat', 'mm/dd/yyyy', 'MM/DD', set.dateFormat)}${chip('dateFormat', 'yyyy/mm/dd', 'YYYY/MM', set.dateFormat)}</div></div>
                    <div class="setting-row"><span class="sr-sub">Week starts</span>
                        <div class="chip-grp">${['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
                            .map(dn => chip('weekStart', dn, dn.slice(0, 3), set.weekStart)).join('')}</div></div>
                </div>

                <div class="setting-block">
                    <div class="sr-label">Weight</div>
                    <div class="setting-row"><span class="sr-sub">Track weight</span>
                        <div class="toggle ${set.weightTrackingEnabled !== false ? 'on' : ''}" data-toggle="weightTrackingEnabled"></div></div>
                    <div class="setting-row"><span class="sr-sub">Unit</span>
                        <div class="chip-grp">${chip('weightUnit', 'kg', 'kg', set.weightUnit)}${chip('weightUnit', 'lbs', 'lbs', set.weightUnit)}${chip('weightUnit', 'st-lbs', 'st & lbs', set.weightUnit)}</div></div>
                    <div class="setting-row"><span class="sr-sub">Goal weight (${D.unitLabel(set.weightUnit)})</span>
                        <input class="setting-input" type="number" step="0.1" data-num="goalKg" value="${set.goalKg != null ? D.weightValue(set.goalKg, set.weightUnit).toFixed(1) : ''}" placeholder="—"></div>
                    <div class="setting-row"><span class="sr-sub">Start weight (${D.unitLabel(set.weightUnit)})</span>
                        <input class="setting-input" type="number" step="0.1" data-num="startKg" value="${set.startKg != null ? D.weightValue(set.startKg, set.weightUnit).toFixed(1) : ''}" placeholder="auto"></div>
                    <div class="setting-row"><span class="sr-sub">Show BMI</span>
                        <div class="toggle ${set.showBmi ? 'on' : ''}" data-toggle="showBmi"></div></div>
                    ${set.showBmi ? `<div class="setting-row"><span class="sr-sub">Height (cm)</span>
                        <input class="setting-input" type="number" step="0.1" data-num="userHeight" value="${set.userHeight != null ? set.userHeight : ''}" placeholder="e.g. 170"></div>` : ''}
                </div>

                <div class="setting-block">
                    <div class="sr-label">Injection sites</div>
                    <div class="setting-row"><span class="sr-sub">Track locations</span>
                        <div class="toggle ${set.shotLocationTrackingEnabled ? 'on' : ''}" data-toggle="shotLocationTrackingEnabled"></div></div>
                    ${set.shotLocationTrackingEnabled ? `
                    <div class="loc-list">
                        ${locs.map((L, i) => `
                            <div class="loc-row">
                                <span>${escapeHtml(L)}</span>
                                <span class="loc-btns">
                                    <button class="icon-btn xs" data-loc-up="${i}" ${i === 0 ? 'disabled' : ''}>${Icons.arrowUp}</button>
                                    <button class="icon-btn xs" data-loc-dn="${i}" ${i === locs.length - 1 ? 'disabled' : ''}>${Icons.arrowDn}</button>
                                    <button class="icon-btn xs" data-loc-del="${i}">${Icons.close}</button>
                                </span>
                            </div>`).join('')}
                        <div class="loc-add">
                            <input id="newLoc" placeholder="Add location…">
                            <button class="btn small" data-act="add-loc">Add</button>
                        </div>
                    </div>` : ''}
                </div>

                <div class="setting-block">
                    <div class="sr-label">Dashboard layout</div>
                    <div class="setting-row"><span class="sr-sub">Chart order</span>
                        <div class="chip-grp">${chip('chartOrder', 'level-first', 'Med level first', set.chartOrder)}${chip('chartOrder', 'weight-first', 'Weight first', set.chartOrder)}</div></div>
                    <div class="setting-row"><span class="sr-sub">Med level chart</span><div class="toggle ${set.showMedLevel ? 'on' : ''}" data-toggle="showMedLevel"></div></div>
                    <div class="setting-row"><span class="sr-sub">Weight chart</span><div class="toggle ${set.showWeight ? 'on' : ''}" data-toggle="showWeight"></div></div>
                    <div class="setting-row"><span class="sr-sub">Calendar</span><div class="toggle ${set.showCalendar ? 'on' : ''}" data-toggle="showCalendar"></div></div>
                    <div class="setting-row"><span class="sr-sub">Stats grid</span><div class="toggle ${set.showStats ? 'on' : ''}" data-toggle="showStats"></div></div>
                    <div class="setting-row"><span class="sr-sub">Med graph: days ahead</span>
                        <span style="display:inline-flex;gap:6px;align-items:center">
                            <button class="chip ${set.medProjection === 'auto' || set.medProjection == null ? 'active' : ''}" data-act="proj-auto">Auto</button>
                            <input class="setting-input" style="width:70px" type="number" min="0" max="365" data-proj
                                value="${set.medProjection !== 'auto' && set.medProjection != null ? set.medProjection : ''}" placeholder="auto">
                        </span></div>
                    <div class="setting-row"><span class="sr-sub">History: rows per page</span>
                        <div class="chip-grp">${['10', '20', '30', '50', '100'].map(v =>
                            chip('historyPageSize', v, v, String(set.historyPageSize || 20))).join('')}</div></div>
                </div>

                <div class="setting-block">
                    <div class="sr-label">Notifications</div>
                    ${!(window.Push && window.Push.supported()) ? `
                        <div class="sr-sub">This browser can't do push notifications.${/iPhone|iPad/.test(navigator.userAgent) ? ' On iPhone/iPad: add the site to your Home Screen first (iOS 16.4+), then check again.' : ''}</div>`
                    : !loggedIn ? `
                        <div class="sr-sub">Sign in to get dose & supply reminders on this device.</div>`
                    : `
                        <div class="setting-row"><span class="sr-sub">Dose & supply reminders (this device)</span>
                            <div class="toggle ${set.pushEnabled ? 'on' : ''}" data-act="push-toggle"></div></div>
                        <div class="setting-row"><span class="sr-sub">Supply alert when ≤ this many days left</span>
                            <input class="setting-input" style="width:70px" type="number" min="0" step="0.5" data-num="supplyAlertDays" value="${set.supplyAlertDays != null ? set.supplyAlertDays : 1}"></div>
                        ${set.pushEnabled ? `<div class="chip-grp" style="margin-top:6px"><button class="chip" data-act="push-test">Send test notification</button></div>` : ''}`}
                </div>

                <div class="setting-block">
                    <div class="sr-label">Data</div>
                    <div class="drawer-btn-col">
                        <button class="btn" data-act="import-export">${Icons.refresh} Import / export data</button>
                        <button class="btn" data-act="replay-onboarding">${Icons.wand} Replay setup wizard</button>
                        <button class="btn ghost danger-text" data-act="reset">${Icons.trash} Reset all data</button>
                    </div>
                </div>

                <div class="drawer-foot">
                    <a href="${escapeHtml(D.REPO_URL)}" target="_blank" rel="noopener">
                        <svg viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.55v-2.15c-3.2.7-3.87-1.37-3.87-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.75 2.69 1.25 3.34.95.1-.74.4-1.25.72-1.53-2.55-.29-5.23-1.28-5.23-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.1 11.1 0 0 1 5.78 0c2.21-1.49 3.18-1.18 3.18-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.38-5.25 5.66.41.35.77 1.05.77 2.12v3.14c0 .3.21.66.8.55A10.52 10.52 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z"/></svg>
                        View source on GitHub
                    </a>
                </div>`;

            // bindings
            $('[data-act="close"]', drawer).addEventListener('click', close);
            $$('[data-set]', drawer).forEach(b => b.addEventListener('click', () => {
                const key = b.dataset.set;
                let val = b.dataset.val;
                S.update(s => {
                    if (key === 'goalKg' || key === 'startKg') val = parseFloat(val);
                    s.settings[key] = val;
                });
                if (key === 'theme' || key === 'accent' || key === 'textScale') window.App.applyTheme();
                render();
            }));
            $$('[data-toggle]', drawer).forEach(t => t.addEventListener('click', () => {
                S.update(s => { s.settings[t.dataset.toggle] = !s.settings[t.dataset.toggle]; });
                render();
            }));
            $$('[data-num]', drawer).forEach(inp => inp.addEventListener('change', () => {
                const key = inp.dataset.num;
                const v = parseFloat(inp.value);
                S.update(s => {
                    if (isNaN(v)) { s.settings[key] = null; return; }
                    if (key === 'goalKg' || key === 'startKg') {
                        const u = s.settings.weightUnit;
                        s.settings[key] = u === 'lbs' ? D.lbsToKg(v) : u === 'st-lbs' ? v * 14 / 2.20462 : v;
                    } else s.settings[key] = v;
                });
            }));
            const projAuto = $('[data-act="proj-auto"]', drawer);
            if (projAuto) projAuto.addEventListener('click', () => {
                S.update(s => { s.settings.medProjection = 'auto'; });
                render();
            });
            const projInput = $('[data-proj]', drawer);
            if (projInput) projInput.addEventListener('change', () => {
                const v = parseInt(projInput.value);
                S.update(s => { s.settings.medProjection = isNaN(v) ? 'auto' : Math.max(0, Math.min(365, v)); });
                render();
            });
            // locations
            $$('[data-loc-up]', drawer).forEach(b => b.addEventListener('click', () => {
                const i = parseInt(b.dataset.locUp);
                S.update(s => { const a = s.settings.shotLocations; [a[i - 1], a[i]] = [a[i], a[i - 1]]; });
                render();
            }));
            $$('[data-loc-dn]', drawer).forEach(b => b.addEventListener('click', () => {
                const i = parseInt(b.dataset.locDn);
                S.update(s => { const a = s.settings.shotLocations; [a[i], a[i + 1]] = [a[i + 1], a[i]]; });
                render();
            }));
            $$('[data-loc-del]', drawer).forEach(b => b.addEventListener('click', () => {
                const i = parseInt(b.dataset.locDel);
                S.update(s => { s.settings.shotLocations.splice(i, 1); });
                render();
            }));
            const addLocBtn = $('[data-act="add-loc"]', drawer);
            if (addLocBtn) addLocBtn.addEventListener('click', () => {
                const inp = $('#newLoc', drawer);
                const v = inp.value.trim();
                if (!v) return;
                S.update(s => { if (!s.settings.shotLocations.includes(v)) s.settings.shotLocations.push(v); });
                render();
            });
            // account / data actions
            const act = (sel, fn) => { const b = $(sel, drawer); if (b) b.addEventListener('click', fn); };
            act('[data-act="login"]', () => { close(); M().authModal('login'); });
            act('[data-act="register"]', () => { close(); M().authModal('register'); });
            act('[data-act="change-pass"]', () => { close(); M().changePasswordModal(); });
            act('[data-act="logout"]', () => { S.auth.logout(); close(); });
            act('[data-act="push-toggle"]', async () => {
                try {
                    if (S.state.settings.pushEnabled) {
                        await window.Push.disable();
                        toast('Reminders off for this device');
                    } else {
                        await window.Push.enable();
                        toast('Reminders on — schedule synced');
                    }
                } catch (e) {
                    toast(e.message || 'Could not change notifications');
                }
                render();
            });
            act('[data-act="push-test"]', async () => {
                try {
                    const r = await window.Push.test();
                    toast(`Test sent to ${r.devices} device${r.devices === 1 ? '' : 's'} — check your notifications`);
                } catch (e) {
                    toast(e.message || 'Test failed');
                }
            });
            // Putting an automatic change back is itself destructive to the account
            // copy (it publishes older data), so it is confirmed here — unlike the
            // Revert on the toast, where the click IS the confirmation because the
            // change just happened and is still on screen.
            $$('[data-revert]', drawer).forEach(b => b.addEventListener('click', async () => {
                const id = b.dataset.revert;
                const entry = (S.recentSyncActions ? S.recentSyncActions() : []).find(a => a.id === id);
                const ok = await confirmModal(
                    `Put this device back to how it was before "${entry ? entry.message : 'this change'}"? `
                    + 'Your other device keeps its own data and will be asked what to do.',
                    { yesLabel: 'Revert it' });
                if (!ok) return;
                await S.revertSyncAction(id);
                render();
            }));
            act('[data-act="import-export"]', () => { close(); importExport(); });
            act('[data-act="replay-onboarding"]', () => { close(); window.Onboarding.start(true); });
            act('[data-act="reset"]', async () => {
                const ok = await confirmModal('Reset ALL data (doses, weights, meds, supply, settings)? This also clears your server copy if signed in.', { danger: true, yesLabel: 'Reset everything' });
                if (ok) { S.resetAll(); close(); toast('All data reset'); }
            });
        };
        render();
    }

    // Each file adds to the shared namespace rather than replacing it, so app.js can
    // keep one reference and the load order below stops mattering.
    Object.assign(window.Modals = window.Modals || {}, { importExport, settingsDrawer });
})();
