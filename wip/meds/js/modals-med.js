// ================================================
// modals-med.js — configuring a medication and its supply:
//                 add/edit med, add containers, edit one container
// ================================================
(function () {
    'use strict';
    const D = window.MedData;
    const { Icons, escapeHtml, openModal, toast, todayYmd, uid } = window.UI;
    const Store = () => window.Store;
    // Other modal files, looked up when called rather than at load, so the five
    // files have no load order between them.
    const M = () => window.Modals;

    // ------------------------------------------------
    // Add pens to supply
    // ------------------------------------------------
    function addPens(medOverride) {
        const S = Store();
        const med = medOverride || S.activeMed();
        if (!med) return;
        const shots = S.medShots(med.id);
        // pill-type meds: packs come in ONE tablet strength — default to what
        // they already stock (or the smallest strength), never a slot TOTAL
        // like 10mg-meaning-2×5mg
        const flexible = med.type && med.type !== 'injection';
        const ownedStrengths = [...new Set(S.medPens(med.id).map(p => p.dose))];
        let dose = flexible
            ? (ownedStrengths.length === 1 ? ownedStrengths[0] : Math.min.apply(null, med.doses))
            : (med.preferredNextDose != null ? med.preferredNextDose : (shots[0] ? shots[0].dose : med.doses[0]));
        const pkgPens = med.pensPerPackage || 1;

        openModal({
            title: 'Add to supply',
            sub: `One package of ${med.name} = ${pkgPens} ${D.containerName(med)}${pkgPens === 1 ? '' : 's'} × ${med.penCapacity} ${med.type === 'pill' ? 'tablet' : 'dose'}${med.penCapacity === 1 ? '' : 's'}.`,
            bodyHtml: `
                <div class="field">
                    <label>Dose (${escapeHtml(med.unit)})</label>
                    <div class="chip-grp" id="penDoseChips">
                        ${med.doses.map(x => `<button class="chip ${dose === x ? 'active' : ''}" data-dose="${x}">${x}${escapeHtml(med.unit)}</button>`).join('')}
                    </div>
                </div>
                <div class="field-row">
                    <div class="field nomb"><label>Picked up on (backdating is fine)</label><input type="date" id="penAcquired" value="${todayYmd()}"></div>
                    <div class="field nomb"><label>Note (optional)</label><input id="penNote" placeholder="e.g. pharmacy / batch / refill #2"></div>
                </div>
                <div class="field">
                    <button class="link no-ml" id="advToggle">↓ adjust package size (rare)</button>
                    <div class="field-row" id="advRow" style="display:none;margin-top:10px">
                        <div class="field nomb"><label>${(() => { const w = D.containerPlural(med, 2); return w.charAt(0).toUpperCase() + w.slice(1); })()} in this package</label><input type="number" min="1" id="penCount" value="${pkgPens}"></div>
                        <div class="field nomb"><label>${med.type === 'pill' ? 'Tablets' : 'Doses'} per ${D.containerName(med)}</label><input type="number" min="1" id="penCap" value="${med.penCapacity}"></div>
                    </div>
                </div>
                <div class="pen-hint" id="penSummary"></div>`,
            footHtml: `
                <button class="btn ghost" data-act="cancel">Cancel</button>
                <button class="btn primary" data-act="save">${Icons.plus} Add to supply</button>`,
            onMount(modal, close) {
                const summary = modal.querySelector('#penSummary');
                const refresh = () => {
                    const count = parseInt(modal.querySelector('#penCount').value) || 1;
                    const cap = parseInt(modal.querySelector('#penCap').value) || 1;
                    summary.innerHTML = `Adding <strong>${count}</strong> ${D.containerPlural(med, count)} of <strong>${dose}${escapeHtml(med.unit)}</strong> = <strong>${count * cap}</strong> ${med.type === 'pill' ? 'tablet' : 'dose'}${count * cap === 1 ? '' : 's'} to supply.`;
                };
                refresh();
                modal.querySelector('#penDoseChips').addEventListener('click', e => {
                    const b = e.target.closest('[data-dose]');
                    if (!b) return;
                    dose = parseFloat(b.dataset.dose);
                    modal.querySelectorAll('#penDoseChips .chip').forEach(c => c.classList.toggle('active', parseFloat(c.dataset.dose) === dose));
                    refresh();
                });
                modal.querySelector('#advToggle').addEventListener('click', () => {
                    const row = modal.querySelector('#advRow');
                    const show = row.style.display === 'none';
                    row.style.display = show ? '' : 'none';
                    modal.querySelector('#advToggle').textContent = show ? '↑ hide package overrides' : '↓ adjust package size (rare)';
                });
                modal.querySelector('#penCount').addEventListener('input', refresh);
                modal.querySelector('#penCap').addEventListener('input', refresh);
                modal.querySelector('[data-act="cancel"]').addEventListener('click', close);
                modal.querySelector('[data-act="save"]').addEventListener('click', () => {
                    const count = parseInt(modal.querySelector('#penCount').value) || 1;
                    const cap = parseInt(modal.querySelector('#penCap').value) || 1;
                    const note = modal.querySelector('#penNote').value.trim();
                    const acquired = modal.querySelector('#penAcquired').value || null;
                    Store().update(s => {
                        for (let i = 0; i < count; i++) {
                            s.pens.push({
                                id: uid('pen'), medId: med.id, dose, capacity: cap, used: 0,
                                openedDate: null, exhaustedDate: null, note,
                                acquiredDate: acquired,
                            });
                        }
                    });
                    toast(`${count * cap} dose${count * cap === 1 ? '' : 's'} added to supply`);
                    close();
                });
            },
        });
    }

    // ------------------------------------------------
    // Edit one supply container — fix mistakes: strength,
    // capacity, used-so-far, dates, or retire it entirely
    // ------------------------------------------------
    function editPen(penId) {
        const S = Store();
        const raw = S.state.pens.find(p => p.id === penId);
        if (!raw) return;
        const med = S.state.meds.find(m => m.id === raw.medId)
            || (S.state.trashedMeds || []).find(m => m.id === raw.medId);
        if (!med) { toast('This item belongs to a deleted medication'); return; }
        const derived = S.medPens(med.id).find(p => p.id === penId) || raw;
        const cn = D.containerName(med);
        const unitWord = med.type === 'pill' ? 'tablets' : 'doses';
        const assigned = S.state.shots.filter(x => x.penId === penId).length;
        let markEmpty = !!raw.manuallyExhausted;

        openModal({
            title: `Edit ${cn}`,
            sub: `${med.name} · ${assigned} logged dose${assigned === 1 ? '' : 's'} draw${assigned === 1 ? 's' : ''} from this ${cn}`,
            bodyHtml: `
                <div class="field-row">
                    <div class="field nomb"><label>Strength (${escapeHtml(med.unit)})</label>
                        <input type="number" min="0" step="any" id="epDose" value="${derived.dose}"></div>
                    <div class="field nomb"><label>Capacity (${unitWord})</label>
                        <input type="number" min="1" step="any" id="epCap" value="${derived.capacity}"></div>
                </div>
                <div class="field-row">
                    <div class="field nomb"><label>Used so far (${unitWord})</label>
                        <input type="number" min="0" step="any" id="epUsed" value="${Math.round(derived.used * 100) / 100}"></div>
                    <div class="field nomb"><label>Opened on (blank = auto from doses)</label>
                        <input type="date" id="epOpened" value="${raw.openedDate || ''}"></div>
                </div>
                <div class="field-row">
                    <div class="field nomb"><label>Picked up on (backdating is fine)</label>
                        <input type="date" id="epAcquired" value="${raw.acquiredDate || ''}"></div>
                    <div class="field nomb"><label>Note</label>
                        <input id="epNote" value="${escapeHtml(raw.note || '')}" placeholder="optional"></div>
                </div>
                <div class="chip-grp" style="margin-top:4px">
                    <button class="chip ${markEmpty ? 'active' : ''}" id="epEmpty">Mark as empty / retired</button>
                </div>
                <div class="pen-hint">Retired ${D.containerPlural(med, 2)} stop being suggested for new doses. "Used" corrections stick even as more doses get logged.</div>`,
            footHtml: `
                <button class="btn ghost" data-act="cancel">Cancel</button>
                <button class="btn primary" data-act="save">Save</button>`,
            onMount(modal, close) {
                modal.querySelector('#epEmpty').addEventListener('click', () => {
                    markEmpty = !markEmpty;
                    modal.querySelector('#epEmpty').classList.toggle('active', markEmpty);
                });
                modal.querySelector('[data-act="cancel"]').addEventListener('click', close);
                modal.querySelector('[data-act="save"]').addEventListener('click', () => {
                    const newDose = parseFloat(modal.querySelector('#epDose').value);
                    const newCap = parseFloat(modal.querySelector('#epCap').value);
                    const wantUsed = parseFloat(modal.querySelector('#epUsed').value);
                    const opened = modal.querySelector('#epOpened').value || null;
                    const acquired = modal.querySelector('#epAcquired').value || null;
                    const note = modal.querySelector('#epNote').value.trim();
                    S.update(s => {
                        const p = s.pens.find(x => x.id === penId);
                        if (!p) return;
                        if (!isNaN(newDose) && newDose > 0) p.dose = newDose;
                        if (!isNaN(newCap) && newCap > 0) p.capacity = newCap;
                        p.openedDate = opened;
                        p.acquiredDate = acquired;
                        p.note = note;
                        if (!isNaN(wantUsed)) {
                            // store the manual correction as an offset on top of
                            // whatever the assigned doses consume — future logs
                            // keep counting from the corrected number
                            const shotSum = s.shots.filter(x => x.penId === penId)
                                .reduce((a, x) => a + D.doseConsumption(x.dose, p), 0);
                            p.usedOffset = Math.round((wantUsed - shotSum) * 1000) / 1000;
                        }
                        p.manuallyExhausted = markEmpty;
                        if (markEmpty) p.exhaustedDate = p.exhaustedDate || D.ymd(new Date());
                        else p.exhaustedDate = null; // recompute re-derives if truly full
                    });
                    toast('Supply updated');
                    close();
                });
            },
        });
    }

    // ------------------------------------------------
    // Add / edit medication (preset or custom)
    // ------------------------------------------------
    function addMed(editMed) {
        const isEdit = !!editMed;
        let mode = isEdit ? 'custom' : 'preset';
        let preset = null;

        // value + unit pair for durations so "3 hours" doesn't have to be typed as 0.125 days
        const durVal = (days, dflt, allowPerDay) => {
            const v = m2 => Math.round(m2 * 100) / 100;
            if (days == null || isNaN(days)) return { val: dflt != null ? dflt : '', unit: 'days' };
            // sub-daily frequencies read most naturally as "N × per day"
            if (allowPerDay && days > 0 && days < 0.95) {
                const per = 1 / days;
                if (Math.abs(per - Math.round(per)) < 0.06) return { val: Math.round(per), unit: 'perday' };
            }
            // pick the natural unit: minutes under an hour, hours under a day
            if (days > 0 && days < 1 / 24) return { val: v(days * 1440), unit: 'minutes' };
            return days < 0.99 ? { val: v(days * 24), unit: 'hours' } : { val: v(days), unit: 'days' };
        };
        const durRow = (id, label, days, dflt, ph, allowPerDay) => {
            const d0 = durVal(days, dflt, allowPerDay);
            return `<div class="field nomb"><label>${label}</label>
                <div class="freq-row">
                    <input type="number" min="0" step="0.5" id="${id}" value="${d0.val}" placeholder="${ph || ''}">
                    <select id="${id}Unit">
                        ${allowPerDay ? `<option value="perday" ${d0.unit === 'perday' ? 'selected' : ''}>× per day</option>` : ''}
                        <option value="minutes" ${d0.unit === 'minutes' ? 'selected' : ''}>minutes</option>
                        <option value="hours" ${d0.unit === 'hours' ? 'selected' : ''}>hours</option>
                        <option value="days" ${d0.unit === 'days' ? 'selected' : ''}>days</option>
                        <option value="weeks">weeks</option>
                    </select>
                </div></div>`;
        };

        const customFormHtml = m => `
            <div class="field-row">
                <div class="field nomb"><label>Name</label><input id="cmName" value="${escapeHtml(m ? m.name : '')}" placeholder="e.g. Trulicity"></div>
                <div class="field nomb"><label>Generic / active</label><input id="cmGeneric" value="${escapeHtml(m ? m.generic || '' : '')}" placeholder="optional"></div>
            </div>
            <div class="field"><label>Type</label>
                <div class="chip-grp" id="cmType">
                    ${['injection', 'pill', 'patch', 'gel', 'liquid', 'cream'].map(tp => `<button class="chip ${(m ? (m.type || 'injection') : 'injection') === tp ? 'active' : ''}" data-type="${tp}">${tp}</button>`).join('')}
                </div>
            </div>
            <div class="field"><label>Available doses (comma separated)</label>
                <input id="cmDoses" value="${m ? m.doses.join(', ') : ''}" placeholder="e.g. 2.5, 5, 7.5, 10, 12.5, 15"></div>
            <div class="field-row">
                <div class="field nomb"><label>Unit</label>
                    <select id="cmUnit">${['mg', 'mcg', 'IU', 'units', 'ml'].map(u => `<option ${m && m.unit === u ? 'selected' : ''}>${u}</option>`).join('')}</select></div>
                ${durRow('cmFreq', 'How often — e.g. 3 × per day, 12 hours, 1 week', m ? m.frequency : 7, 7, '', true)}
            </div>
            <div class="field-row" id="cmPenRow">
                <div class="field nomb"><label>Doses per container (pen, pack, bottle…)</label><input type="number" id="cmCap" value="${m ? m.penCapacity : 4}"></div>
                <div class="field nomb"><label>Containers per package</label><input type="number" id="cmPkg" value="${m ? m.pensPerPackage || 1 : 1}"></div>
            </div>
            <div class="field-row">
                ${durRow('cmHl', 'Half-life', m ? m.halfLife : 5, 5)}
                ${durRow('cmTtp', 'Time to peak (optional)', m && m.timeToPeak ? m.timeToPeak : null, '', '0')}
            </div>
            <div class="field-row">
                <div class="field nomb"><label>Colour</label><input type="color" id="cmColor" value="${m ? m.color || '#5fc8c8' : '#5fc8c8'}" class="color-input"></div>
                <div class="field nomb"><label>Category (for grouping)</label>
                    <select id="cmCategory">${D.CATEGORY_ORDER.map(c => `<option ${((m && m.category) || 'Other') === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
            </div>
            <div class="field">
                <label>Usual day of week (weekly meds) — Auto detects from your history</label>
                <div class="chip-grp" id="cmSchedDay">
                    ${['auto', 'daily'].concat(D.DAY_NAMES).map(dn => `<button class="chip sm ${(m && m.scheduleDay ? m.scheduleDay : 'auto') === dn ? 'active' : ''}" data-day="${dn}">${dn === 'auto' ? 'Auto' : dn === 'daily' ? 'Every day' : dn.slice(0, 3)}</button>`).join('')}
                </div>
            </div>
            <div class="field">
                <label>Usual time(s) of day — one row per daily dose: count × strength (e.g. 23:00 · 2 × 5mg). Blank = auto-detect</label>
                <div class="time-list" id="cmTimes">
                    ${(() => {
                        const slots = D.getScheduleSlots(m || {});
                        // always show at least one time input — daily meds set their
                        // usual time here (leave blank to keep auto-detect)
                        const list = slots.length ? slots
                            : (m && m.scheduleTime && m.scheduleTime !== 'auto' ? [{ time: m.scheduleTime, dose: null }] : [{ time: '', dose: null }]);
                        return list.map(sl => {
                            // show exactly what the user typed (count/per persisted);
                            // legacy slots without it fall back to the supply-based split
                            const b = sl.count >= 1 && sl.per > 0 ? { count: sl.count, per: sl.per }
                                : (sl.dose != null && m
                                    ? D.doseBreakdown(m, sl.dose, Store().state.pens)
                                    : { count: 1, per: sl.dose != null ? sl.dose : '' });
                            return `<span class="time-item"><input type="time" value="${sl.time}" data-schedtime><input type="number" min="1" step="1" value="${b.count}" data-schedcount title="How many at once — 2 × 5mg = a 10mg dose"><span class="dim-sm">×</span><input type="number" min="0" step="any" value="${b.per != null ? b.per : ''}" data-scheddose placeholder="dose" title="Strength of each (blank = usual)"><button type="button" class="icon-btn xs" data-deltime title="Remove">✕</button></span>`;
                        }).join('');
                    })()}
                    <button type="button" class="btn small" id="cmAddTime">+ add time</button>
                </div>
            </div>
            <div class="field">
                <label>Chart y-step (blank = auto)</label>
                <input type="number" step="0.1" min="0" id="cmGraphStep" value="${m && m.graphStep ? m.graphStep : ''}" placeholder="e.g. 2">
            </div>
            <div class="field-row">
                ${durRow('cmLateOk', 'Late dose still OK within (0 = always skip)', m && m.missedDose ? m.missedDose.takeWithinDays : null, '', '0')}
                ${durRow('cmMinGap', 'Min gap between doses', m && m.missedDose ? m.missedDose.minGapDays : null, '', 'e.g. 3')}
            </div>
            <div class="field">
                <label>Per-dose half-life override <button class="link" id="cmAdvToggle">${m && m.dose2halfLife ? 'hide' : 'show'}</button></label>
                <div id="cmDoseHl" style="display:${m && m.dose2halfLife ? '' : 'none'}"></div>
            </div>`;

        openModal({
            title: isEdit ? `Edit ${editMed.name}` : 'Add medication',
            sub: isEdit ? 'Changes only affect this account.' : 'Pick a preset or set up something custom.',
            bodyHtml: `
                ${isEdit ? '' : `
                <div class="chip-grp" style="margin-bottom:16px" id="modeChips">
                    <button class="chip ${mode === 'preset' ? 'active' : ''}" data-mode="preset">From preset</button>
                    <button class="chip ${mode === 'custom' ? 'active' : ''}" data-mode="custom">Custom med</button>
                </div>
                <div id="presetWrap">
                    <div class="field"><input id="presetSearch" placeholder="Search presets…"></div>
                    <div class="preset-grid" id="presetGrid"></div>
                    <div id="presetDetails"></div>
                </div>`}
                <div id="customWrap" style="display:${mode === 'custom' || isEdit ? '' : 'none'}">${customFormHtml(editMed)}</div>`,
            footHtml: `
                <button class="btn ghost" data-act="cancel">Cancel</button>
                <button class="btn primary" data-act="save" ${isEdit ? '' : 'disabled'}>${Icons.check} ${isEdit ? 'Save changes' : 'Add medication'}</button>`,
            onMount(modal, close) {
                const saveBtn = modal.querySelector('[data-act="save"]');
                const refreshSaveState = () => {
                    if (mode === 'preset') { saveBtn.disabled = !preset; return; }
                    const name = modal.querySelector('#cmName').value.trim();
                    const doses = parseDoses();
                    saveBtn.disabled = !(name && doses.length);
                };
                const parseDoses = () => (modal.querySelector('#cmDoses') ? modal.querySelector('#cmDoses').value : '')
                    .split(',').map(x => parseFloat(x.trim())).filter(n => !isNaN(n) && n > 0);

                const renderPresets = filter => {
                    const grid = modal.querySelector('#presetGrid');
                    if (!grid) return;
                    const q = (filter || '').toLowerCase();
                    const existing = new Set(Store().state.meds.map(m => m.presetId));
                    const matches = D.MED_PRESETS.filter(p => !q
                        || p.name.toLowerCase().includes(q)
                        || (p.generic || '').toLowerCase().includes(q)
                        || (p.category || '').toLowerCase().includes(q));
                    const card = p => `<button class="preset ${preset && preset.presetId === p.presetId ? 'active' : ''} ${existing.has(p.presetId) ? 'dim' : ''}" data-preset="${p.presetId}">
                            <div class="p-name">${p.name}<span class="p-type">${p.type}</span></div>
                            <div class="p-meta">${p.generic} · ${p.doses.length} doses · ${D.fmtFreq(p.frequency)}${existing.has(p.presetId) ? ' · added' : ''}</div>
                        </button>`;
                    grid.innerHTML = D.CATEGORY_ORDER
                        .map(cat => {
                            const group = matches.filter(p => p.category === cat);
                            if (!group.length) return '';
                            return `<div class="preset-cat">${cat}</div>` + group.map(card).join('');
                        })
                        .join('') || '<div class="empty pad-sm"><div class="em-sub">No matches — try a custom med</div></div>';
                    // details of the selected preset, with a route to tweak them
                    const det = modal.querySelector('#presetDetails');
                    if (det) det.innerHTML = !preset ? '' : `
                        <div class="pen-hint col preset-details">
                            <div><strong>${preset.name}</strong> — ${D.fmtFreq(preset.frequency)} · half-life ${D.fmtDur(preset.halfLife)}${preset.timeToPeak ? ` · peaks after ${D.fmtDur(preset.timeToPeak)}` : ''} · ${preset.penCapacity} ${preset.type === 'pill' ? 'tablets' : 'doses'} per ${D.containerName(preset)}</div>
                            <div>Doses: ${preset.doses.join(', ')} ${preset.unit}</div>
                            <button type="button" class="btn small" id="presetEditBtn" style="margin-top:6px">${Icons.edit} Edit these details before adding</button>
                        </div>`;
                };
                renderPresets();

                const presetGrid = modal.querySelector('#presetGrid');
                if (presetGrid) presetGrid.addEventListener('click', e => {
                    const b = e.target.closest('[data-preset]');
                    if (!b) return;
                    preset = D.MED_PRESETS.find(p => p.presetId === b.dataset.preset);
                    renderPresets(modal.querySelector('#presetSearch').value);
                    refreshSaveState();
                });
                const presetSearch = modal.querySelector('#presetSearch');
                if (presetSearch) presetSearch.addEventListener('input', () => renderPresets(presetSearch.value));

                const modeChips = modal.querySelector('#modeChips');
                if (modeChips) modeChips.addEventListener('click', e => {
                    const b = e.target.closest('[data-mode]');
                    if (!b) return;
                    mode = b.dataset.mode;
                    modeChips.querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c.dataset.mode === mode));
                    modal.querySelector('#presetWrap').style.display = mode === 'preset' ? '' : 'none';
                    modal.querySelector('#customWrap').style.display = mode === 'custom' ? '' : 'none';
                    refreshSaveState();
                });

                // custom form behaviour — DELEGATED from customWrap so the form
                // can be re-rendered (e.g. prefilled from a preset) without rebinding
                const customWrap = modal.querySelector('#customWrap');
                let customBase = editMed || null; // the med the form was rendered from
                let cmSchedDay = customBase && customBase.scheduleDay ? customBase.scheduleDay : 'auto';
                let cmType = customBase ? (customBase.type || 'injection') : 'injection';

                // per-dose half-life grid follows the main half-life UNIT select —
                // stored values are always days, shown/entered in hours/days/weeks
                let doseHlEdits = {}; // dose -> days, survives unit switches/re-renders
                const hlUnitFactor = () => {
                    const sel = modal.querySelector('#cmHlUnit');
                    const u = sel ? sel.value : 'days';
                    return u === 'minutes' ? 1 / 1440 : u === 'hours' ? 1 / 24 : u === 'weeks' ? 7 : 1;
                };
                const renderDoseHl = () => {
                    const doseHlWrap = modal.querySelector('#cmDoseHl');
                    if (!doseHlWrap) return;
                    const doses = parseDoses();
                    const src = Object.assign({}, (customBase && customBase.dose2halfLife) || {}, doseHlEdits);
                    const f = hlUnitFactor();
                    const sel = modal.querySelector('#cmHlUnit');
                    const suffix = { minutes: 'min', hours: 'h', weeks: 'w' }[sel ? sel.value : 'days'] || 'd';
                    const round = v => Math.round(v * 100) / 100;
                    doseHlWrap.innerHTML = doses.length === 0
                        ? '<div class="pen-hint">Enter doses first.</div>'
                        : `<div class="dose-hl-grid">${doses.map(x => `
                            <div class="dose-hl-cell"><span>${x}</span><input type="number" step="0.1" data-dosehl="${x}" value="${src[x] != null ? round(src[x] / f) : ''}" placeholder="${modal.querySelector('#cmHl').value || '5'}"><span class="dim-sm">${suffix}</span></div>`).join('')}</div>`;
                };

                const renderCustomForm = m => {
                    customBase = m || null;
                    customWrap.innerHTML = customFormHtml(m);
                    cmSchedDay = m && m.scheduleDay ? m.scheduleDay : 'auto';
                    cmType = m ? (m.type || 'injection') : 'injection';
                    if (m && m.dose2halfLife) renderDoseHl();
                };

                customWrap.addEventListener('click', e => {
                    const dayBtn = e.target.closest('#cmSchedDay [data-day]');
                    if (dayBtn) {
                        cmSchedDay = dayBtn.dataset.day;
                        customWrap.querySelectorAll('#cmSchedDay .chip').forEach(c => c.classList.toggle('active', c.dataset.day === cmSchedDay));
                        return;
                    }
                    if (e.target.closest('#cmAddTime')) {
                        const timesWrap = customWrap.querySelector('#cmTimes');
                        const span = document.createElement('span');
                        span.className = 'time-item';
                        span.innerHTML = '<input type="time" data-schedtime><input type="number" min="1" step="1" value="1" data-schedcount title="How many at once — 2 × 5mg = a 10mg dose"><span class="dim-sm">×</span><input type="number" min="0" step="any" data-scheddose placeholder="dose" title="Strength of each (blank = usual)"><button type="button" class="icon-btn xs" data-deltime title="Remove">✕</button>';
                        timesWrap.insertBefore(span, customWrap.querySelector('#cmAddTime'));
                        return;
                    }
                    const del = e.target.closest('[data-deltime]');
                    if (del) { del.closest('.time-item').remove(); return; }
                    const typeBtn = e.target.closest('#cmType [data-type]');
                    if (typeBtn) {
                        cmType = typeBtn.dataset.type;
                        customWrap.querySelectorAll('#cmType .chip').forEach(c => c.classList.toggle('active', c.dataset.type === cmType));
                        return;
                    }
                    const advToggle = e.target.closest('#cmAdvToggle');
                    if (advToggle) {
                        const doseHlWrap = customWrap.querySelector('#cmDoseHl');
                        const show = doseHlWrap.style.display === 'none';
                        doseHlWrap.style.display = show ? '' : 'none';
                        advToggle.textContent = show ? 'hide' : 'show';
                        if (show) renderDoseHl();
                    }
                });
                customWrap.addEventListener('input', e => {
                    if (e.target.id === 'cmDoses') {
                        const doseHlWrap = customWrap.querySelector('#cmDoseHl');
                        if (doseHlWrap && doseHlWrap.style.display !== 'none') renderDoseHl();
                        refreshSaveState();
                    }
                    if (e.target.id === 'cmName') refreshSaveState();
                    const dh = e.target.closest('[data-dosehl]');
                    if (dh) {
                        const v = parseFloat(dh.value);
                        const key = parseFloat(dh.dataset.dosehl);
                        if (!isNaN(v) && v > 0) doseHlEdits[key] = v * hlUnitFactor();
                        else delete doseHlEdits[key];
                    }
                });
                customWrap.addEventListener('change', e => {
                    // switching the half-life unit re-labels the per-dose grid
                    if (e.target.id === 'cmHlUnit') {
                        const doseHlWrap = customWrap.querySelector('#cmDoseHl');
                        if (doseHlWrap && doseHlWrap.style.display !== 'none') renderDoseHl();
                    }
                });
                if (editMed && editMed.dose2halfLife) renderDoseHl();

                // "Edit these details before adding" — preset values, custom form
                modal.addEventListener('click', e => {
                    if (!e.target.closest('#presetEditBtn') || !preset) return;
                    mode = 'custom';
                    const modeChipsEl = modal.querySelector('#modeChips');
                    if (modeChipsEl) modeChipsEl.querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c.dataset.mode === 'custom'));
                    modal.querySelector('#presetWrap').style.display = 'none';
                    customWrap.style.display = '';
                    renderCustomForm(Object.assign({}, preset));
                    refreshSaveState();
                });

                modal.querySelector('[data-act="cancel"]').addEventListener('click', close);
                saveBtn.addEventListener('click', () => {
                    if (mode === 'preset' && preset) {
                        const id = preset.presetId + '-' + Date.now().toString(36);
                        const med = Object.assign({}, preset, { id });
                        Store().update(s => { s.meds.push(med); s.activeMedId = med.id; });
                        toast(`${med.name} added`);
                        close();
                        // straight into the history estimator — Cancel = just starting
                        M().backfill(med);
                        return;
                    }
                    const name = modal.querySelector('#cmName').value.trim();
                    const doses = parseDoses();
                    if (!name || !doses.length) return;
                    // duration inputs carry their own hours/days/weeks unit
                    const durDays = id => {
                        const v = parseFloat(modal.querySelector('#' + id).value);
                        if (isNaN(v)) return null;
                        const u = modal.querySelector('#' + id + 'Unit').value;
                        if (u === 'perday') return v > 0 ? Math.round((1 / v) * 100) / 100 : null;
                        return u === 'minutes' ? v / 1440 : u === 'hours' ? v / 24 : u === 'weeks' ? v * 7 : v;
                    };
                    const medPayload = {
                        name,
                        generic: modal.querySelector('#cmGeneric').value.trim(),
                        type: cmType,
                        doses,
                        frequency: durDays('cmFreq') || 7,
                        halfLife: durDays('cmHl') || 5,
                        timeToPeak: durDays('cmTtp') || 0,
                        penCapacity: parseInt(modal.querySelector('#cmCap').value) || 4,
                        pensPerPackage: parseInt(modal.querySelector('#cmPkg').value) || 1,
                        unit: modal.querySelector('#cmUnit').value,
                        color: modal.querySelector('#cmColor').value,
                        category: modal.querySelector('#cmCategory').value,
                        scheduleDay: cmSchedDay,
                        scheduleTimes: Array.from(modal.querySelectorAll('#cmTimes .time-item')).map(item => {
                            const time = item.querySelector('[data-schedtime]').value;
                            const per = parseFloat(item.querySelector('[data-scheddose]').value);
                            const cntEl = item.querySelector('[data-schedcount]');
                            const count = cntEl ? (parseInt(cntEl.value) || 1) : 1;
                            // stored dose = the TOTAL taken at that time; count/per
                            // remember exactly how the user typed it (2 × 5mg)
                            const total = (!isNaN(per) && per > 0) ? Math.round(per * count * 1000) / 1000 : null;
                            return /^\d{1,2}:\d{2}$/.test(time)
                                ? { time, dose: total, count: total != null ? count : null, per: total != null ? per : null }
                                : null;
                        }).filter(Boolean),
                        graphStep: parseFloat(modal.querySelector('#cmGraphStep').value) || null,
                    };
                    medPayload.scheduleTime = (medPayload.scheduleTimes[0] && medPayload.scheduleTimes[0].time) || 'auto';
                    if (customBase && customBase.presetId) medPayload.presetId = customBase.presetId;
                    // 2+ usual times a day only make sense with a multi-daily
                    // frequency — derive it so the slot schedule actually applies
                    if (medPayload.scheduleTimes.length >= 2 && medPayload.frequency >= 0.95) {
                        medPayload.frequency = Math.round((1 / medPayload.scheduleTimes.length) * 100) / 100;
                    }
                    // missed-dose window — keep the preset's note + source, override the
                    // numbers (entered with hour/day/week units, stored in days)
                    const lateOk = durDays('cmLateOk');
                    const minGap = durDays('cmMinGap');
                    // customBase = whatever the form was rendered from (an edited med
                    // OR a preset being tweaked before adding) — keep its guidance
                    if (lateOk != null || minGap != null) {
                        const base = (customBase && customBase.missedDose) || {};
                        medPayload.missedDose = Object.assign({}, base, {
                            takeWithinDays: lateOk != null ? lateOk : (base.takeWithinDays || 0),
                            minGapDays: minGap != null ? minGap : (base.minGapDays || 1),
                        });
                    } else if (customBase && customBase.missedDose) {
                        medPayload.missedDose = customBase.missedDose;
                    }
                    // pharmacology extras the form has no fields for ride along too
                    if (customBase) {
                        ['titration', 'splitDose', 'clicksPerDose'].forEach(k => {
                            if (customBase[k] != null && medPayload[k] == null) medPayload[k] = customBase[k];
                        });
                    }
                    const hlInputs = modal.querySelectorAll('[data-dosehl]');
                    const doseHlWrap = modal.querySelector('#cmDoseHl');
                    if (doseHlWrap && doseHlWrap.style.display !== 'none' && hlInputs.length) {
                        const map = {};
                        const f = hlUnitFactor(); // entered in the selected unit, stored in days
                        hlInputs.forEach(inp => {
                            const v = parseFloat(inp.value);
                            if (!isNaN(v) && v > 0) map[parseFloat(inp.dataset.dosehl)] = v * f;
                        });
                        // clearing every box removes the overrides (null overwrites on edit)
                        medPayload.dose2halfLife = Object.keys(map).length ? map : null;
                    }
                    const newMed = isEdit ? null
                        : Object.assign({ id: name.toLowerCase().replace(/\s+/g, '-') + '-' + Date.now().toString(36) }, medPayload);
                    Store().update(s => {
                        if (isEdit) {
                            const i = s.meds.findIndex(x => x.id === editMed.id);
                            if (i >= 0) s.meds[i] = Object.assign({}, s.meds[i], medPayload);
                        } else {
                            s.meds.push(newMed);
                            s.activeMedId = newMed.id;
                        }
                    });
                    toast(isEdit ? 'Medication updated' : `${name} added`);
                    close();
                    // straight into the history estimator — Cancel = just starting
                    if (newMed) M().backfill(newMed);
                });
            },
        });
    }

    // Each file adds to the shared namespace rather than replacing it, so app.js can
    // keep one reference and the load order below stops mattering.
    Object.assign(window.Modals = window.Modals || {}, { addPens, editPen, addMed });
})();
