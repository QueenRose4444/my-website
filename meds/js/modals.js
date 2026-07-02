// ================================================
// modals.js — log shot/weight, pens, add/edit med,
// backfill estimator, import/export, settings drawer,
// auth modals, sync conflict
// ================================================
(function () {
    'use strict';
    const D = window.MedData;
    const { Icons, escapeHtml, openModal, confirmModal, toast } = window.UI;
    const Store = () => window.Store;

    const todayYmd = () => D.ymd(new Date());
    const nowHm = () => D.hm(new Date());
    const uid = p => p + '-' + Date.now() + '-' + Math.floor(Math.random() * 9999);

    // keep default date/time inputs ticking with the real clock until the user
    // touches them — people open the modal, get distracted, and log later
    function liveClock(modal, dateSel, timeSel) {
        const dateEl = modal.querySelector(dateSel);
        const timeEl = modal.querySelector(timeSel);
        if (!dateEl || !timeEl) return;
        let touched = false;
        [dateEl, timeEl].forEach(el => {
            el.addEventListener('input', () => { touched = true; });
            el.addEventListener('change', () => { touched = true; });
        });
        const iv = setInterval(() => {
            if (!document.contains(timeEl)) { clearInterval(iv); return; }
            if (touched || document.activeElement === timeEl || document.activeElement === dateEl) return;
            timeEl.value = nowHm();
            dateEl.value = todayYmd();
        }, 15000);
    }

    // ------------------------------------------------
    // Log / edit shot
    // ------------------------------------------------
    function logShot(initial, prefill) {
        const S = Store();
        const med = S.activeMed();
        if (!med) return addMed();
        const defaultDate = initial ? initial.date : (prefill && prefill.date) || todayYmd();
        const set = S.state.settings;
        const shots = S.medShots(med.id);
        const pens = S.medPens(med.id);
        const lastShot = shots.find(x => !initial || x.id !== initial.id);
        const isInjection = !med.type || med.type === 'injection';
        const locOn = set.shotLocationTrackingEnabled && isInjection;
        const locs = set.shotLocations && set.shotLocations.length ? set.shotLocations : D.DEFAULT_LOCATIONS;

        const suggestedLoc = (() => {
            if (initial && initial.location) return initial.location;
            if (!lastShot || !lastShot.location) return locs[0];
            return locs[(locs.indexOf(lastShot.location) + 1) % locs.length];
        })();

        let dose = initial ? initial.dose : (med.preferredNextDose != null ? med.preferredNextDose : (lastShot ? lastShot.dose : med.doses[0]));
        let loc = suggestedLoc;
        let penId = initial ? (initial.penId || '') : null; // null = auto

        const penHintHtml = () => {
            if (!isInjection) return '';
            const sug = D.suggestPenForShot(pens, med, dose);
            if (penId === '') return `<div class="pen-hint">Not drawing from supply.</div>`;
            const pen = penId ? pens.find(p => p.id === penId) : sug.pen;
            if (!pen) return `<div class="pen-hint warn">${Icons.alert} No usable pen in supply for ${dose}${escapeHtml(med.unit)}. Save anyway, or add a pack first.</div>`;
            const left = Math.round((pen.capacity - pen.used) * 100) / 100;
            const splitNote = med.splitDose && pen.dose !== dose
                ? ` · split: <strong>≈${Math.round(D.clicksForDose(dose, pen.dose, med.clicksPerDose))} clicks</strong> from the ${pen.dose}${escapeHtml(med.unit)} pen`
                : '';
            const openNote = (!penId && sug.isNewOpen) ? 'Will open new' : 'Using';
            return `<div class="pen-hint">${openNote} <strong>${pen.dose}${escapeHtml(med.unit)}</strong> pen — ${left} dose${left === 1 ? '' : 's'} left${splitNote}.</div>`;
        };

        const eligiblePens = () => pens.filter(p => p.medId === med.id && !p.exhaustedDate &&
            ((p.capacity - p.used) >= D.doseConsumption(dose, p) - 0.001 || !p.openedDate) &&
            (med.splitDose || p.dose === dose));

        openModal({
            title: initial ? `Edit ${med.name} ${isInjection ? 'shot' : 'dose'}` : `Log ${med.name} ${isInjection ? 'shot' : 'dose'}`,
            sub: `${med.generic || 'custom'}${isInjection ? ` · pen capacity ${med.penCapacity}` : ''}`,
            bodyHtml: `
                <div class="field">
                    <label>Dose (${escapeHtml(med.unit)})</label>
                    <div class="chip-grp" id="doseChips">
                        ${med.doses.map(x => `<button class="chip ${dose === x ? 'active' : ''}" data-dose="${x}">${x}${escapeHtml(med.unit)}</button>`).join('')}
                    </div>
                </div>
                <div class="field-row">
                    <div class="field nomb"><label>Date — any past date works</label><input type="date" id="shotDate" value="${defaultDate}"></div>
                    <div class="field nomb"><label>Time</label><input type="time" id="shotTime" value="${initial ? initial.time : nowHm()}"></div>
                </div>
                ${locOn ? `
                <div class="field">
                    <label>Injection location · suggested: <span class="txt-accent">${escapeHtml(suggestedLoc)}</span></label>
                    <div class="bodydiag" id="locGrid">
                        ${locs.map(L => `<button class="bd-loc ${loc === L ? 'active' : ''} ${L === suggestedLoc ? 'next' : ''}" data-loc="${escapeHtml(L)}">${escapeHtml(L)}</button>`).join('')}
                    </div>
                </div>` : ''}
                ${isInjection ? `
                <div class="field">
                    <label>From which pen</label>
                    <select id="penSelect">
                        <option value="auto">Auto (smart routing)</option>
                        ${eligiblePens().map(p => `<option value="${escapeHtml(p.id)}" ${penId === p.id ? 'selected' : ''}>${p.dose}${escapeHtml(med.unit)} · ${Math.round((p.capacity - p.used) * 10) / 10} of ${p.capacity} left · ${p.openedDate ? 'opened ' + D.fmtDateShort(p.openedDate) : 'unopened'}</option>`).join('')}
                        <option value="" ${penId === '' ? 'selected' : ''}>— don't draw from supply —</option>
                    </select>
                    <div id="penHint">${penHintHtml()}</div>
                </div>` : ''}`,
            footHtml: `
                <button class="btn ghost" data-act="cancel">Cancel</button>
                <button class="btn primary" data-act="save">${Icons.check} ${initial ? 'Save changes' : 'Save ' + (isInjection ? 'shot' : 'dose')}</button>`,
            onMount(modal, close) {
                if (!initial && !(prefill && prefill.date)) liveClock(modal, '#shotDate', '#shotTime');
                const hint = modal.querySelector('#penHint');
                modal.querySelector('#doseChips').addEventListener('click', e => {
                    const b = e.target.closest('[data-dose]');
                    if (!b) return;
                    dose = parseFloat(b.dataset.dose);
                    modal.querySelectorAll('#doseChips .chip').forEach(c => c.classList.toggle('active', parseFloat(c.dataset.dose) === dose));
                    const sel = modal.querySelector('#penSelect');
                    if (sel) {
                        const cur = sel.value;
                        sel.innerHTML = `<option value="auto">Auto (smart routing)</option>` +
                            eligiblePens().map(p => `<option value="${escapeHtml(p.id)}">${p.dose}${escapeHtml(med.unit)} · ${Math.round((p.capacity - p.used) * 10) / 10} of ${p.capacity} left · ${p.openedDate ? 'opened ' + D.fmtDateShort(p.openedDate) : 'unopened'}</option>`).join('') +
                            `<option value="">— don't draw from supply —</option>`;
                        sel.value = ['auto', ''].includes(cur) ? cur : 'auto';
                        penId = sel.value === 'auto' ? null : sel.value;
                    }
                    if (hint) hint.innerHTML = penHintHtml();
                });
                const locGrid = modal.querySelector('#locGrid');
                if (locGrid) locGrid.addEventListener('click', e => {
                    const b = e.target.closest('[data-loc]');
                    if (!b) return;
                    loc = b.dataset.loc;
                    locGrid.querySelectorAll('.bd-loc').forEach(c => c.classList.toggle('active', c.dataset.loc === loc));
                });
                const penSel = modal.querySelector('#penSelect');
                if (penSel) penSel.addEventListener('change', () => {
                    penId = penSel.value === 'auto' ? null : penSel.value;
                    if (hint) hint.innerHTML = penHintHtml();
                });
                modal.querySelector('[data-act="cancel"]').addEventListener('click', close);
                modal.querySelector('[data-act="save"]').addEventListener('click', () => {
                    const date = modal.querySelector('#shotDate').value;
                    const time = modal.querySelector('#shotTime').value || '09:00';
                    if (!date) { toast('Pick a date', 'error'); return; }
                    const ts = new Date(date + 'T' + time).getTime();
                    if (isNaN(ts)) { toast('Invalid date/time', 'error'); return; }

                    Store().update(s => {
                        // resolve pen
                        let usePenId = penId;
                        if (isInjection && usePenId === null) {
                            const sug = D.suggestPenForShot(D.recomputePenState(s.pens.filter(p => p.medId === med.id), s.shots), med, dose);
                            if (sug.pen) {
                                usePenId = sug.pen.id;
                                if (sug.isNewOpen) {
                                    const p = s.pens.find(x => x.id === sug.pen.id);
                                    if (p && !p.openedDate) p.openedDate = date;
                                }
                            } else usePenId = '';
                        }
                        if (usePenId) {
                            const p = s.pens.find(x => x.id === usePenId);
                            if (p && !p.openedDate) p.openedDate = date;
                        }
                        const payload = {
                            medId: med.id, dose, date, time, timestamp: ts,
                            location: locOn ? loc : null,
                            penId: usePenId || null,
                        };
                        if (initial) {
                            const i = s.shots.findIndex(x => x.id === initial.id);
                            if (i >= 0) s.shots[i] = Object.assign({}, s.shots[i], payload);
                        } else {
                            s.shots.push(Object.assign({ id: uid('shot') }, payload));
                        }
                        // logging a dose clears the manual next-dose override
                        const m = s.meds.find(x => x.id === med.id);
                        if (m && !initial && m.preferredNextDose != null && m.preferredNextDose !== dose) m.preferredNextDose = null;
                    });
                    toast(initial ? 'Dose updated' : 'Dose logged');
                    close();
                });
            },
        });
    }

    // ------------------------------------------------
    // Log / edit weight (kg, lbs, st-lbs aware)
    // ------------------------------------------------
    function logWeight(initial) {
        const S = Store();
        const set = S.state.settings;
        const unit = set.weightUnit;
        const weights = S.sortedWeights();
        const last = weights[weights.length - 1];

        // only EDITS pre-fill the value; new entries get an empty box with the
        // last weight as a placeholder hint (pre-filling looked like fake data)
        let valHtml;
        if (unit === 'st-lbs') {
            const v = initial ? D.kgToStLbs(initial.kg) : null;
            const ph = last ? D.kgToStLbs(last.kg) : { st: 'st', lbs: 'lbs' };
            valHtml = `<div class="field"><label>Weight (stone / pounds)</label>
                <div class="field-row nomb">
                    <input type="number" id="wSt" placeholder="${v ? '' : (last ? 'last: ' + ph.st : 'st')}" value="${v ? v.st : ''}">
                    <input type="number" step="0.1" id="wLbs" placeholder="${v ? '' : (last ? Math.round(ph.lbs * 10) / 10 : 'lbs')}" value="${v ? (Math.round(v.lbs * 10) / 10) : ''}">
                </div></div>`;
        } else {
            const v = initial ? D.weightValue(initial.kg, unit).toFixed(1) : '';
            const ph = last ? `last: ${D.weightValue(last.kg, unit).toFixed(1)}` : `e.g. ${unit === 'lbs' ? '225.4' : '102.5'}`;
            valHtml = `<div class="field"><label>Weight (${unit})</label>
                <input type="number" step="0.1" id="wVal" value="${v}" placeholder="${ph}" inputmode="decimal" autofocus></div>`;
        }

        openModal({
            title: initial ? 'Edit weight' : 'Log weight',
            sub: initial ? '' : 'Tip: weigh at the same time of day for the cleanest trend',
            bodyHtml: `
                ${valHtml}
                <div class="field-row">
                    <div class="field nomb"><label>Date</label><input type="date" id="wDate" value="${initial ? initial.date : todayYmd()}"></div>
                    <div class="field nomb"><label>Time</label><input type="time" id="wTime" value="${initial ? initial.time : nowHm()}"></div>
                </div>`,
            footHtml: `
                <button class="btn ghost" data-act="cancel">Cancel</button>
                <button class="btn primary" data-act="save">${Icons.check} ${initial ? 'Save changes' : 'Save weight'}</button>`,
            onMount(modal, close) {
                if (!initial) liveClock(modal, '#wDate', '#wTime');
                modal.querySelector('[data-act="cancel"]').addEventListener('click', close);
                modal.querySelector('[data-act="save"]').addEventListener('click', () => {
                    let kg;
                    if (unit === 'st-lbs') {
                        const st = parseFloat(modal.querySelector('#wSt').value);
                        const lbs = parseFloat(modal.querySelector('#wLbs').value);
                        if (isNaN(st) && isNaN(lbs)) { toast('Enter a weight', 'error'); return; }
                        kg = D.stLbsToKg(st, lbs);
                    } else {
                        const v = parseFloat(modal.querySelector('#wVal').value);
                        if (isNaN(v) || v <= 0) { toast('Enter a valid weight', 'error'); return; }
                        kg = unit === 'lbs' ? D.lbsToKg(v) : v;
                    }
                    kg = Math.round(kg * 100) / 100;
                    const date = modal.querySelector('#wDate').value;
                    const time = modal.querySelector('#wTime').value || '08:00';
                    const ts = new Date(date + 'T' + time).getTime();
                    if (!date || isNaN(ts)) { toast('Invalid date/time', 'error'); return; }
                    Store().update(s => {
                        if (initial) {
                            const i = s.weights.findIndex(x => x.id === initial.id);
                            if (i >= 0) s.weights[i] = Object.assign({}, s.weights[i], { date, time, timestamp: ts, kg });
                        } else {
                            s.weights.push({ id: uid('w'), date, time, timestamp: ts, kg });
                        }
                        if (s.settings.startKg == null) {
                            const sorted = s.weights.slice().sort((a, b) => a.timestamp - b.timestamp);
                            s.settings.startKg = sorted[0] ? sorted[0].kg : null;
                        }
                    });
                    toast(initial ? 'Weight updated' : 'Weight logged');
                    close();
                });
            },
        });
    }

    // ------------------------------------------------
    // Add pens to supply
    // ------------------------------------------------
    function addPens(medOverride) {
        const S = Store();
        const med = medOverride || S.activeMed();
        if (!med) return;
        const shots = S.medShots(med.id);
        let dose = med.preferredNextDose != null ? med.preferredNextDose : (shots[0] ? shots[0].dose : med.doses[0]);
        const pkgPens = med.pensPerPackage || 1;

        openModal({
            title: 'Add to supply',
            sub: `One package of ${med.name} = ${pkgPens} pen${pkgPens === 1 ? '' : 's'} × ${med.penCapacity} dose${med.penCapacity === 1 ? '' : 's'}.`,
            bodyHtml: `
                <div class="field">
                    <label>Dose (${escapeHtml(med.unit)})</label>
                    <div class="chip-grp" id="penDoseChips">
                        ${med.doses.map(x => `<button class="chip ${dose === x ? 'active' : ''}" data-dose="${x}">${x}${escapeHtml(med.unit)}</button>`).join('')}
                    </div>
                </div>
                <div class="field"><label>Note (optional)</label><input id="penNote" placeholder="e.g. pharmacy / batch / refill #2"></div>
                <div class="field">
                    <button class="link no-ml" id="advToggle">↓ adjust package size (rare)</button>
                    <div class="field-row" id="advRow" style="display:none;margin-top:10px">
                        <div class="field nomb"><label>Pens in this package</label><input type="number" min="1" id="penCount" value="${pkgPens}"></div>
                        <div class="field nomb"><label>Doses per pen</label><input type="number" min="1" id="penCap" value="${med.penCapacity}"></div>
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
                    summary.innerHTML = `Adding <strong>${count}</strong> pen${count === 1 ? '' : 's'} of <strong>${dose}${escapeHtml(med.unit)}</strong> = <strong>${count * cap}</strong> dose${count * cap === 1 ? '' : 's'} to supply.`;
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
                    Store().update(s => {
                        for (let i = 0; i < count; i++) {
                            s.pens.push({
                                id: uid('pen'), medId: med.id, dose, capacity: cap, used: 0,
                                openedDate: null, exhaustedDate: null, note,
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
    // Add / edit medication (preset or custom)
    // ------------------------------------------------
    function addMed(editMed) {
        const isEdit = !!editMed;
        let mode = isEdit ? 'custom' : 'preset';
        let preset = null;

        const customFormHtml = m => `
            <div class="field-row">
                <div class="field nomb"><label>Name</label><input id="cmName" value="${escapeHtml(m ? m.name : '')}" placeholder="e.g. Trulicity"></div>
                <div class="field nomb"><label>Generic / active</label><input id="cmGeneric" value="${escapeHtml(m ? m.generic || '' : '')}" placeholder="optional"></div>
            </div>
            <div class="field"><label>Type</label>
                <div class="chip-grp" id="cmType">
                    ${['injection', 'pill', 'liquid', 'cream'].map(tp => `<button class="chip ${(m ? (m.type || 'injection') : 'injection') === tp ? 'active' : ''}" data-type="${tp}">${tp}</button>`).join('')}
                </div>
            </div>
            <div class="field"><label>Available doses (comma separated)</label>
                <input id="cmDoses" value="${m ? m.doses.join(', ') : ''}" placeholder="e.g. 2.5, 5, 7.5, 10, 12.5, 15"></div>
            <div class="field-row">
                <div class="field nomb"><label>Unit</label>
                    <select id="cmUnit">${['mg', 'mcg', 'IU', 'units', 'ml'].map(u => `<option ${m && m.unit === u ? 'selected' : ''}>${u}</option>`).join('')}</select></div>
                <div class="field nomb"><label>Frequency (days)</label><input type="number" step="0.5" id="cmFreq" value="${m ? m.frequency : 7}"></div>
            </div>
            <div class="field-row" id="cmPenRow">
                <div class="field nomb"><label>Doses per pen</label><input type="number" id="cmCap" value="${m ? m.penCapacity : 4}"></div>
                <div class="field nomb"><label>Pens per package</label><input type="number" id="cmPkg" value="${m ? m.pensPerPackage || 1 : 1}"></div>
            </div>
            <div class="field-row">
                <div class="field nomb"><label>Half-life (days)</label><input type="number" step="0.1" id="cmHl" value="${m ? m.halfLife : 5}"></div>
                <div class="field nomb"><label>Time to peak (days, optional)</label><input type="number" step="0.1" id="cmTtp" value="${m && m.timeToPeak ? m.timeToPeak : ''}" placeholder="0"></div>
            </div>
            <div class="field"><label>Colour</label><input type="color" id="cmColor" value="${m ? m.color || '#5fc8c8' : '#5fc8c8'}" class="color-input"></div>
            <div class="field">
                <label>Usual day of week (weekly meds) — Auto detects from your history</label>
                <div class="chip-grp" id="cmSchedDay">
                    ${['auto'].concat(D.DAY_NAMES).map(dn => `<button class="chip sm ${(m && m.scheduleDay ? m.scheduleDay : 'auto') === dn ? 'active' : ''}" data-day="${dn}">${dn === 'auto' ? 'Auto' : dn.slice(0, 3)}</button>`).join('')}
                </div>
            </div>
            <div class="field-row">
                <div class="field nomb"><label>Usual time of day (blank = auto)</label>
                    <input type="time" id="cmSchedTime" value="${m && m.scheduleTime && m.scheduleTime !== 'auto' ? m.scheduleTime : ''}"></div>
                <div class="field nomb"><label>Chart y-step (blank = auto)</label>
                    <input type="number" step="0.1" min="0" id="cmGraphStep" value="${m && m.graphStep ? m.graphStep : ''}" placeholder="e.g. 2"></div>
            </div>
            <div class="field-row">
                <div class="field nomb"><label>Late dose OK within (days)</label>
                    <input type="number" step="0.5" min="0" id="cmLateOk" value="${m && m.missedDose ? m.missedDose.takeWithinDays : ''}" placeholder="0 = always skip"></div>
                <div class="field nomb"><label>Min gap between doses (days)</label>
                    <input type="number" step="0.5" min="0" id="cmMinGap" value="${m && m.missedDose ? m.missedDose.minGapDays : ''}" placeholder="e.g. 3"></div>
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
                    grid.innerHTML = D.MED_PRESETS
                        .filter(p => !q || p.name.toLowerCase().includes(q) || (p.generic || '').toLowerCase().includes(q))
                        .map(p => `<button class="preset ${preset && preset.presetId === p.presetId ? 'active' : ''} ${existing.has(p.presetId) ? 'dim' : ''}" data-preset="${p.presetId}">
                            <div class="p-name">${p.name}<span class="p-type">${p.type}</span></div>
                            <div class="p-meta">${p.generic} · ${p.doses.length} doses · every ${p.frequency < 1 ? '<1' : p.frequency}d${existing.has(p.presetId) ? ' · added' : ''}</div>
                        </button>`).join('') || '<div class="empty pad-sm"><div class="em-sub">No matches — try a custom med</div></div>';
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

                // custom form behaviour
                let cmSchedDay = editMed && editMed.scheduleDay ? editMed.scheduleDay : 'auto';
                const schedDayChips = modal.querySelector('#cmSchedDay');
                if (schedDayChips) schedDayChips.addEventListener('click', e => {
                    const b = e.target.closest('[data-day]');
                    if (!b) return;
                    cmSchedDay = b.dataset.day;
                    schedDayChips.querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c.dataset.day === cmSchedDay));
                });
                const typeChips = modal.querySelector('#cmType');
                let cmType = editMed ? (editMed.type || 'injection') : 'injection';
                if (typeChips) typeChips.addEventListener('click', e => {
                    const b = e.target.closest('[data-type]');
                    if (!b) return;
                    cmType = b.dataset.type;
                    typeChips.querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c.dataset.type === cmType));
                    modal.querySelector('#cmPenRow').style.display = cmType === 'injection' ? '' : 'none';
                });
                if (modal.querySelector('#cmPenRow')) modal.querySelector('#cmPenRow').style.display = cmType === 'injection' ? '' : 'none';

                const advToggle = modal.querySelector('#cmAdvToggle');
                const doseHlWrap = modal.querySelector('#cmDoseHl');
                const renderDoseHl = () => {
                    const doses = parseDoses();
                    const existing = (editMed && editMed.dose2halfLife) || {};
                    doseHlWrap.innerHTML = doses.length === 0
                        ? '<div class="pen-hint">Enter doses first.</div>'
                        : `<div class="dose-hl-grid">${doses.map(x => `
                            <div class="dose-hl-cell"><span>${x}</span><input type="number" step="0.1" data-dosehl="${x}" value="${existing[x] != null ? existing[x] : ''}" placeholder="${modal.querySelector('#cmHl').value || '5'}"><span class="dim-sm">d</span></div>`).join('')}</div>`;
                };
                if (advToggle) advToggle.addEventListener('click', () => {
                    const show = doseHlWrap.style.display === 'none';
                    doseHlWrap.style.display = show ? '' : 'none';
                    advToggle.textContent = show ? 'hide' : 'show';
                    if (show) renderDoseHl();
                });
                if (editMed && editMed.dose2halfLife) renderDoseHl();
                const dosesInput = modal.querySelector('#cmDoses');
                if (dosesInput) dosesInput.addEventListener('input', () => {
                    if (doseHlWrap.style.display !== 'none') renderDoseHl();
                    refreshSaveState();
                });
                const nameInput = modal.querySelector('#cmName');
                if (nameInput) nameInput.addEventListener('input', refreshSaveState);

                modal.querySelector('[data-act="cancel"]').addEventListener('click', close);
                saveBtn.addEventListener('click', () => {
                    if (mode === 'preset' && preset) {
                        const id = preset.presetId + '-' + Date.now().toString(36);
                        const med = Object.assign({}, preset, { id });
                        Store().update(s => { s.meds.push(med); s.activeMedId = med.id; });
                        toast(`${med.name} added`);
                        close();
                        return;
                    }
                    const name = modal.querySelector('#cmName').value.trim();
                    const doses = parseDoses();
                    if (!name || !doses.length) return;
                    const medPayload = {
                        name,
                        generic: modal.querySelector('#cmGeneric').value.trim(),
                        type: cmType,
                        doses,
                        frequency: parseFloat(modal.querySelector('#cmFreq').value) || 7,
                        halfLife: parseFloat(modal.querySelector('#cmHl').value) || 5,
                        timeToPeak: parseFloat(modal.querySelector('#cmTtp').value) || 0,
                        penCapacity: cmType === 'injection' ? (parseInt(modal.querySelector('#cmCap').value) || 4) : 1,
                        pensPerPackage: cmType === 'injection' ? (parseInt(modal.querySelector('#cmPkg').value) || 1) : 1,
                        unit: modal.querySelector('#cmUnit').value,
                        color: modal.querySelector('#cmColor').value,
                        scheduleDay: cmSchedDay,
                        scheduleTime: modal.querySelector('#cmSchedTime').value || 'auto',
                        graphStep: parseFloat(modal.querySelector('#cmGraphStep').value) || null,
                    };
                    // missed-dose window — keep the preset's note + source, override the numbers
                    const lateOk = parseFloat(modal.querySelector('#cmLateOk').value);
                    const minGap = parseFloat(modal.querySelector('#cmMinGap').value);
                    if (!isNaN(lateOk) || !isNaN(minGap)) {
                        const base = (editMed && editMed.missedDose) || {};
                        medPayload.missedDose = Object.assign({}, base, {
                            takeWithinDays: !isNaN(lateOk) ? lateOk : (base.takeWithinDays || 0),
                            minGapDays: !isNaN(minGap) ? minGap : (base.minGapDays || 1),
                        });
                    } else if (editMed && editMed.missedDose) {
                        medPayload.missedDose = editMed.missedDose;
                    }
                    const hlInputs = modal.querySelectorAll('[data-dosehl]');
                    if (doseHlWrap.style.display !== 'none' && hlInputs.length) {
                        const map = {};
                        hlInputs.forEach(inp => {
                            const v = parseFloat(inp.value);
                            if (!isNaN(v) && v > 0) map[parseFloat(inp.dataset.dosehl)] = v;
                        });
                        if (Object.keys(map).length) medPayload.dose2halfLife = map;
                    }
                    Store().update(s => {
                        if (isEdit) {
                            const i = s.meds.findIndex(x => x.id === editMed.id);
                            if (i >= 0) s.meds[i] = Object.assign({}, s.meds[i], medPayload);
                        } else {
                            const med = Object.assign({ id: name.toLowerCase().replace(/\s+/g, '-') + '-' + Date.now().toString(36) }, medPayload);
                            s.meds.push(med);
                            s.activeMedId = med.id;
                        }
                    });
                    toast(isEdit ? 'Medication updated' : `${name} added`);
                    close();
                });
            },
        });
    }

    // ------------------------------------------------
    // Backfill estimator (used by onboarding + meds page)
    // Estimates past doses so levels/graphs start correct.
    // ------------------------------------------------
    function backfill(med, onDone) {
        const S = Store();
        let currentDose = med.preferredNextDose != null ? med.preferredNextDose : med.doses[Math.floor(med.doses.length / 2)] || med.doses[0];
        let mode = 'auto'; // 'auto' | 'manual'
        let freqVal = med.frequency || 7, freqUnit = 'days';

        const stepRowsHtml = () => med.doses.filter(x => x <= currentDose).map(x => `
            <div class="bf-step"><span class="bf-dose">${x}${escapeHtml(med.unit)}</span>
            <input type="number" min="0" data-step="${x}" value="${x === currentDose ? '' : 4}" placeholder="${x === currentDose ? 'until today' : 'weeks'}">
            <span class="dim-sm">weeks</span></div>`).join('');

        openModal({
            title: `Backfill ${med.name} history`,
            sub: 'Estimates your past doses so charts and levels start out right. Estimated doses are marked and can be removed later.',
            bodyHtml: `
                <div class="field">
                    <label>What dose are you on now? (${escapeHtml(med.unit)})</label>
                    <div class="chip-grp" id="bfDose">
                        ${med.doses.map(x => `<button class="chip ${currentDose === x ? 'active' : ''}" data-dose="${x}">${x}${escapeHtml(med.unit)}</button>`).join('')}
                    </div>
                </div>
                <div class="field-row">
                    <div class="field nomb"><label>How often do you take it?</label>
                        <div class="freq-row">
                            <input type="number" min="1" step="1" id="bfFreqVal" value="${freqVal}">
                            <select id="bfFreqUnit">
                                <option value="hours">hours</option>
                                <option value="days" selected>days</option>
                                <option value="weeks">weeks</option>
                            </select>
                        </div>
                    </div>
                    <div class="field nomb"><label>Usual time of day</label><input type="time" id="bfTime" value="09:00"></div>
                </div>
                <div class="field-row">
                    <div class="field nomb"><label>Last dose taken on</label><input type="date" id="bfLast" value="${todayYmd()}"></div>
                    <div class="field nomb"><label>Started the med on (optional)</label><input type="date" id="bfStart"></div>
                </div>
                <div class="field">
                    <label>How should we estimate the steps before ${currentDose}${escapeHtml(med.unit)}?</label>
                    <div class="chip-grp" id="bfMode">
                        <button class="chip active" data-mode="auto">Standard schedule</button>
                        <button class="chip" data-mode="manual">I'll detail each dose</button>
                    </div>
                </div>
                <div id="bfManual" style="display:none">
                    <label class="field-label">Time spent at each dose</label>
                    <div id="bfSteps">${stepRowsHtml()}</div>
                </div>
                <div class="pen-hint" id="bfPreview"></div>`,
            footHtml: `
                <button class="btn ghost" data-act="cancel">Cancel</button>
                <button class="btn primary" data-act="save">${Icons.wand} Add estimated doses</button>`,
            onMount(modal, close) {
                const freqDays = () => {
                    const v = parseFloat(modal.querySelector('#bfFreqVal').value) || 7;
                    const u = modal.querySelector('#bfFreqUnit').value;
                    return u === 'hours' ? v / 24 : u === 'weeks' ? v * 7 : v;
                };
                const buildOpts = () => {
                    const opts = {
                        med, currentDose,
                        frequencyDays: freqDays(),
                        timeOfDay: modal.querySelector('#bfTime').value || '09:00',
                        lastDoseDate: modal.querySelector('#bfLast').value || todayYmd(),
                        startDate: modal.querySelector('#bfStart').value || null,
                        locations: S.state.settings.shotLocationTrackingEnabled && (!med.type || med.type === 'injection')
                            ? S.state.settings.shotLocations : null,
                    };
                    if (mode === 'manual') {
                        const steps = [];
                        modal.querySelectorAll('[data-step]').forEach(inp => {
                            const stepDose = parseFloat(inp.dataset.step);
                            let weeks = parseFloat(inp.value);
                            if (stepDose === currentDose && isNaN(weeks)) {
                                // last step: until today from startDate if given, else default 4w
                                weeks = 4;
                            }
                            if (!isNaN(weeks) && weeks > 0) steps.push({ dose: stepDose, count: Math.max(1, Math.round(weeks * 7 / freqDays())) });
                        });
                        if (steps.length) opts.steps = steps;
                    }
                    return opts;
                };
                const preview = () => {
                    try {
                        const shots = D.estimateBackfillShots(buildOpts());
                        const first = shots[0];
                        modal.querySelector('#bfPreview').innerHTML = shots.length
                            ? `Will add <strong>${shots.length}</strong> estimated dose${shots.length === 1 ? '' : 's'} from <strong>${D.fmtDateShort(first.timestamp)}</strong> to <strong>${D.fmtDateShort(shots[shots.length - 1].timestamp)}</strong>, ending on ${currentDose}${escapeHtml(med.unit)}.`
                            : 'Nothing to add with these settings.';
                    } catch (e) { modal.querySelector('#bfPreview').textContent = 'Could not build a preview.'; }
                };
                preview();

                modal.querySelector('#bfDose').addEventListener('click', e => {
                    const b = e.target.closest('[data-dose]');
                    if (!b) return;
                    currentDose = parseFloat(b.dataset.dose);
                    modal.querySelectorAll('#bfDose .chip').forEach(c => c.classList.toggle('active', parseFloat(c.dataset.dose) === currentDose));
                    modal.querySelector('#bfSteps').innerHTML = stepRowsHtml();
                    preview();
                });
                modal.querySelector('#bfMode').addEventListener('click', e => {
                    const b = e.target.closest('[data-mode]');
                    if (!b) return;
                    mode = b.dataset.mode;
                    modal.querySelectorAll('#bfMode .chip').forEach(c => c.classList.toggle('active', c.dataset.mode === mode));
                    modal.querySelector('#bfManual').style.display = mode === 'manual' ? '' : 'none';
                    preview();
                });
                ['#bfFreqVal', '#bfFreqUnit', '#bfTime', '#bfLast', '#bfStart'].forEach(sel =>
                    modal.querySelector(sel).addEventListener('change', preview));
                modal.querySelector('#bfManual').addEventListener('input', preview);

                modal.querySelector('[data-act="cancel"]').addEventListener('click', close);
                modal.querySelector('[data-act="save"]').addEventListener('click', () => {
                    const shots = D.estimateBackfillShots(buildOpts());
                    if (!shots.length) { toast('Nothing to add', 'error'); return; }
                    Store().update(s => {
                        // avoid duplicating real logged doses on the same days
                        const existingDays = new Set(s.shots.filter(x => x.medId === med.id).map(x => x.date));
                        const fresh = shots.filter(x => !existingDays.has(x.date));
                        s.shots = s.shots.concat(fresh);
                        // build pen history for the estimates
                        const m = s.meds.find(x => x.id === med.id);
                        if (m && (!m.type || m.type === 'injection')) {
                            const { pens, assignment } = D.inferPensFromShots(fresh, m);
                            pens.forEach(p => { p.note = 'estimated'; });
                            s.shots.forEach(x => { if (assignment[x.id]) x.penId = assignment[x.id]; });
                            s.pens = s.pens.concat(pens);
                        }
                        // store the chosen frequency on the med if customised
                        if (m) {
                            const fd = buildOpts().frequencyDays;
                            if (Math.abs(fd - m.frequency) > 0.01) m.frequency = Math.round(fd * 100) / 100;
                        }
                    });
                    toast(`${shots.length} estimated doses added`);
                    close();
                    if (onDone) onDone();
                });
            },
        });
    }

    // ------------------------------------------------
    // Import / export
    // ------------------------------------------------
    function importExport() {
        const S = Store();
        let parsed = null;
        let mergeMode = 'merge';

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
                    <div class="field" style="margin-top:12px"><label>Existing data</label>
                        <div class="chip-grp" id="ieMerge">
                            <button class="chip active" data-merge="merge">Merge (keep current)</button>
                            <button class="chip" data-merge="replace">Replace (wipe current)</button>
                        </div>
                    </div>
                </div>
                <div id="exportWrap" style="display:none">
                    <p class="confirm-text">Download a JSON backup of all your doses, weights, meds, pens and settings. The file also works with the old site's import.</p>
                    <div class="pen-hint col">
                        <div><strong>${S.state.shots.length}</strong> doses · <strong>${S.state.weights.length}</strong> weights · <strong>${S.state.meds.length}</strong> meds · <strong>${S.state.pens.length}</strong> pens</div>
                    </div>
                </div>`,
            footHtml: `
                <button class="btn ghost" data-act="cancel">Cancel</button>
                <button class="btn primary" data-act="go" disabled>${Icons.check} Import</button>`,
            onMount(modal, close) {
                const goBtn = modal.querySelector('[data-act="go"]');
                let mode = 'import';
                const preview = modal.querySelector('#iePreview');

                const handleText = text => {
                    try {
                        parsed = S.parseBackup(text);
                        const counts = parsed.kind === 'v2'
                            ? { s: parsed.state.shots.length, w: parsed.state.weights.length, kind: 'v2 backup' }
                            : { s: parsed.payload.shotHistory.length, w: parsed.payload.weightHistory.length, kind: 'v1 / old-site backup' };
                        preview.innerHTML = `<div class="pen-hint col"><div><strong>${counts.s}</strong> doses · <strong>${counts.w}</strong> weights detected (${counts.kind})</div></div>`;
                        goBtn.disabled = false;
                    } catch (e) {
                        parsed = null;
                        preview.innerHTML = `<div class="pen-hint warn">${Icons.alert} ${escapeHtml(e.message)}</div>`;
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
                    goBtn.innerHTML = mode === 'import' ? `${Icons.check} Import` : `${Icons.download} Download backup`;
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
                modal.querySelector('#ieMerge').addEventListener('click', e => {
                    const b = e.target.closest('[data-merge]');
                    if (!b) return;
                    mergeMode = b.dataset.merge;
                    modal.querySelectorAll('#ieMerge .chip').forEach(c => c.classList.toggle('active', c.dataset.merge === mergeMode));
                });
                modal.querySelector('[data-act="cancel"]').addEventListener('click', close);
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
                    if (mergeMode === 'replace') {
                        const ok = await confirmModal('Replace ALL current data with the imported backup? This cannot be undone.', { danger: true, yesLabel: 'Replace everything' });
                        if (!ok) return;
                    }
                    S.importBackup(parsed, mergeMode);
                    toast('Import complete');
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
            const chip = (group, val, label, cur) => `<button class="chip ${cur === val ? 'active' : ''}" data-set="${group}" data-val="${escapeHtml(String(val))}">${label}</button>`;
            const locs = set.shotLocations || [];

            drawer.innerHTML = `
                <div class="drawer-head"><h2>Settings</h2><button class="icon-btn" data-act="close">${Icons.close}</button></div>

                <div class="setting-block">
                    <div class="sr-label">Account</div>
                    ${loggedIn ? `
                        <div class="sr-sub" style="margin-bottom:8px">Signed in as <strong class="txt-accent">${escapeHtml(S.auth.currentUser ? S.auth.currentUser.username : 'user')}</strong> — data syncs automatically.</div>
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
                    <div class="sr-label">Formats</div>
                    <div class="setting-row"><span class="sr-sub">Time</span>
                        <div class="chip-grp">${chip('timeFormat', '12hr', '12h', set.timeFormat)}${chip('timeFormat', '24hr', '24h', set.timeFormat)}</div></div>
                    <div class="setting-row"><span class="sr-sub">Date</span>
                        <div class="chip-grp">${chip('dateFormat', 'dd/mm/yyyy', 'DD/MM', set.dateFormat)}${chip('dateFormat', 'mm/dd/yyyy', 'MM/DD', set.dateFormat)}${chip('dateFormat', 'yyyy/mm/dd', 'YYYY/MM', set.dateFormat)}</div></div>
                    <div class="setting-row"><span class="sr-sub">Week starts</span>
                        <div class="chip-grp">${chip('weekStart', 'Monday', 'Mon', set.weekStart)}${chip('weekStart', 'Sunday', 'Sun', set.weekStart)}${chip('weekStart', 'Saturday', 'Sat', set.weekStart)}</div></div>
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
                </div>

                <div class="setting-block">
                    <div class="sr-label">Data</div>
                    <div class="drawer-btn-col">
                        <button class="btn" data-act="import-export">${Icons.refresh} Import / export data</button>
                        <button class="btn" data-act="replay-onboarding">${Icons.wand} Replay setup wizard</button>
                        <button class="btn ghost danger-text" data-act="reset">${Icons.trash} Reset all data</button>
                    </div>
                </div>`;

            // bindings
            drawer.querySelector('[data-act="close"]').addEventListener('click', close);
            drawer.querySelectorAll('[data-set]').forEach(b => b.addEventListener('click', () => {
                const key = b.dataset.set;
                let val = b.dataset.val;
                S.update(s => {
                    if (key === 'goalKg' || key === 'startKg') val = parseFloat(val);
                    s.settings[key] = val;
                });
                if (key === 'theme' || key === 'accent') window.App.applyTheme();
                render();
            }));
            drawer.querySelectorAll('[data-toggle]').forEach(t => t.addEventListener('click', () => {
                S.update(s => { s.settings[t.dataset.toggle] = !s.settings[t.dataset.toggle]; });
                render();
            }));
            drawer.querySelectorAll('[data-num]').forEach(inp => inp.addEventListener('change', () => {
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
            const projAuto = drawer.querySelector('[data-act="proj-auto"]');
            if (projAuto) projAuto.addEventListener('click', () => {
                S.update(s => { s.settings.medProjection = 'auto'; });
                render();
            });
            const projInput = drawer.querySelector('[data-proj]');
            if (projInput) projInput.addEventListener('change', () => {
                const v = parseInt(projInput.value);
                S.update(s => { s.settings.medProjection = isNaN(v) ? 'auto' : Math.max(0, Math.min(365, v)); });
                render();
            });
            // locations
            drawer.querySelectorAll('[data-loc-up]').forEach(b => b.addEventListener('click', () => {
                const i = parseInt(b.dataset.locUp);
                S.update(s => { const a = s.settings.shotLocations; [a[i - 1], a[i]] = [a[i], a[i - 1]]; });
                render();
            }));
            drawer.querySelectorAll('[data-loc-dn]').forEach(b => b.addEventListener('click', () => {
                const i = parseInt(b.dataset.locDn);
                S.update(s => { const a = s.settings.shotLocations; [a[i], a[i + 1]] = [a[i + 1], a[i]]; });
                render();
            }));
            drawer.querySelectorAll('[data-loc-del]').forEach(b => b.addEventListener('click', () => {
                const i = parseInt(b.dataset.locDel);
                S.update(s => { s.settings.shotLocations.splice(i, 1); });
                render();
            }));
            const addLocBtn = drawer.querySelector('[data-act="add-loc"]');
            if (addLocBtn) addLocBtn.addEventListener('click', () => {
                const inp = drawer.querySelector('#newLoc');
                const v = inp.value.trim();
                if (!v) return;
                S.update(s => { if (!s.settings.shotLocations.includes(v)) s.settings.shotLocations.push(v); });
                render();
            });
            // account / data actions
            const act = (sel, fn) => { const b = drawer.querySelector(sel); if (b) b.addEventListener('click', fn); };
            act('[data-act="login"]', () => { close(); authModal('login'); });
            act('[data-act="register"]', () => { close(); authModal('register'); });
            act('[data-act="change-pass"]', () => { close(); changePasswordModal(); });
            act('[data-act="logout"]', () => { S.auth.logout(); close(); });
            act('[data-act="import-export"]', () => { close(); importExport(); });
            act('[data-act="replay-onboarding"]', () => { close(); window.Onboarding.start(true); });
            act('[data-act="reset"]', async () => {
                const ok = await confirmModal('Reset ALL data (doses, weights, meds, pens, settings)? This also clears your server copy if signed in.', { danger: true, yesLabel: 'Reset everything' });
                if (ok) { S.resetAll(); close(); toast('All data reset'); }
            });
        };
        render();
    }

    // ------------------------------------------------
    // Auth modals
    // ------------------------------------------------
    function authModal(kind) {
        const isLogin = kind === 'login';
        openModal({
            title: isLogin ? 'Log in' : 'Create account',
            sub: isLogin ? 'Your data syncs to your account automatically.' : 'Free account so your data follows you across devices.',
            bodyHtml: `
                <div class="field"><label>Username</label><input id="authUser" autocomplete="username"></div>
                <div class="field"><label>Password</label><input id="authPass" type="password" autocomplete="${isLogin ? 'current-password' : 'new-password'}" minlength="4"></div>
                ${isLogin ? '' : '<div class="field"><label>Confirm password</label><input id="authPass2" type="password" minlength="4"></div>'}
                <div class="error-text" id="authErr"></div>`,
            footHtml: `
                <button class="btn ghost" data-act="cancel">Cancel</button>
                <button class="btn primary" data-act="go">${Icons.check} ${isLogin ? 'Log in' : 'Register'}</button>`,
            onMount(modal, close) {
                const err = modal.querySelector('#authErr');
                modal.querySelector('[data-act="cancel"]').addEventListener('click', close);
                const go = async () => {
                    err.textContent = '';
                    const user = modal.querySelector('#authUser').value.trim();
                    const pass = modal.querySelector('#authPass').value;
                    if (!user || !pass) { err.textContent = 'Fill in both fields.'; return; }
                    try {
                        if (isLogin) {
                            await Store().auth.login(user, pass);
                            close();
                        } else {
                            const p2 = modal.querySelector('#authPass2').value;
                            if (pass !== p2) { err.textContent = 'Passwords do not match.'; return; }
                            await Store().auth.register(user, pass);
                            toast('Registered! Logging you in…');
                            await Store().auth.login(user, pass);
                            close();
                        }
                    } catch (e) { err.textContent = e.message; }
                };
                modal.querySelector('[data-act="go"]').addEventListener('click', go);
                modal.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
            },
        });
    }

    function changePasswordModal() {
        openModal({
            title: 'Change password',
            bodyHtml: `
                <div class="field"><label>Current password</label><input id="cpCur" type="password" autocomplete="current-password"></div>
                <div class="field"><label>New password</label><input id="cpNew" type="password" autocomplete="new-password" minlength="4"></div>
                <div class="field"><label>Confirm new password</label><input id="cpNew2" type="password" minlength="4"></div>
                <div class="error-text" id="cpErr"></div>`,
            footHtml: `
                <button class="btn ghost" data-act="cancel">Cancel</button>
                <button class="btn primary" data-act="go">${Icons.check} Update password</button>`,
            onMount(modal, close) {
                modal.querySelector('[data-act="cancel"]').addEventListener('click', close);
                modal.querySelector('[data-act="go"]').addEventListener('click', async () => {
                    const err = modal.querySelector('#cpErr');
                    err.textContent = '';
                    const cur = modal.querySelector('#cpCur').value;
                    const nw = modal.querySelector('#cpNew').value;
                    if (nw !== modal.querySelector('#cpNew2').value) { err.textContent = 'New passwords do not match.'; return; }
                    try {
                        const data = await Store().auth.changePassword(cur, nw);
                        toast(data.message || 'Password updated');
                        close();
                    } catch (e) { err.textContent = e.message; }
                });
            },
        });
    }

    // ------------------------------------------------
    // Sync conflict modal
    // ------------------------------------------------
    function syncConflict() {
        const S = Store();
        const localSum = S.summary(S.state);
        const serverSum = S.summary(S._pendingServerState || {});
        const set = S.state.settings;
        const fmtSum = sum => `
            <p><strong>Last update:</strong> ${sum.lastUpdate ? D.fmtDate(sum.lastUpdate, set) + ' ' + D.fmtTime(sum.lastUpdate, set) : 'none'}</p>
            <p><strong>Entries:</strong> ${sum.shotCount} doses, ${sum.weightCount} weights</p>
            <p><strong>Last dose:</strong> ${sum.lastShot ? D.fmtDate(sum.lastShot.timestamp, set) + ' · ' + sum.lastShot.dose : '—'}</p>
            <p><strong>Last weight:</strong> ${sum.lastWeight ? D.fmtDate(sum.lastWeight.timestamp, set) + ' · ' + D.fmtWeight(sum.lastWeight.kg, set.weightUnit, true) : '—'}</p>`;

        openModal({
            title: 'Data sync conflict',
            sub: 'Your local data differs from your account. Pick which copy to keep.',
            noBackdropClose: true,
            noClose: true,
            bodyHtml: `
                <div class="conflict-grid">
                    <div class="data-column"><h3>This device</h3>${fmtSum(localSum)}</div>
                    <div class="data-column"><h3>Your account</h3>${fmtSum(serverSum)}</div>
                </div>`,
            footHtml: `
                <button class="btn" data-act="local">${Icons.upload} Keep this device</button>
                <button class="btn primary" data-act="server">${Icons.download} Keep account copy</button>`,
            onMount(modal, close) {
                modal.querySelector('[data-act="local"]').addEventListener('click', () => { S.resolveConflict(false); close(); });
                modal.querySelector('[data-act="server"]').addEventListener('click', () => { S.resolveConflict(true); close(); });
            },
        });
    }

    window.Modals = { logShot, logWeight, addPens, addMed, backfill, importExport, settingsDrawer, authModal, changePasswordModal, syncConflict };
})();
