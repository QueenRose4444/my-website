// ================================================
// modals-log.js — recording that something happened:
//                 a dose, a weight, the mobile log menu, and the
//                 backfill estimator for doses taken before install
// ================================================
(function () {
    'use strict';
    const D = window.MedData;
    const { Icons, escapeHtml, openModal, toast, todayYmd, nowHm, uid, liveClock } = window.UI;
    const Store = () => window.Store;
    // Other modal files, looked up when called rather than at load, so the five
    // files have no load order between them.
    const M = () => window.Modals;

    // ------------------------------------------------
    // Log / edit shot
    // ------------------------------------------------
    function logShot(initial, prefill) {
        const S = Store();
        // editing from the all-meds history: honour the shot's own med — a
        // trashed med's dose must NEVER silently reattach to the active med
        let med;
        if (initial && initial.medId) {
            med = S.state.meds.find(m => m.id === initial.medId)
                || (S.state.trashedMeds || []).find(m => m.id === initial.medId);
            if (!med) { toast('This dose belongs to a deleted medication'); return; }
        } else {
            med = S.activeMed();
        }
        if (!med) return M().addMed();
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

        // slot-aware default: logging near the 23:00 slot pre-picks that slot's dose
        const ndForDefault = !initial ? D.predictNextDose(med, shots, set) : null;
        let dose = initial ? initial.dose
            : (ndForDefault && ndForDefault.dose != null ? ndForDefault.dose
                : (med.preferredNextDose != null ? med.preferredNextDose : (lastShot ? lastShot.dose : med.doses[0])));
        let loc = suggestedLoc;
        let penId = initial ? (initial.penId || '') : null; // null = auto

        const cn = D.containerName(med);
        const penHintHtml = () => {
            const sug = D.suggestPenForShot(pens, med, dose);
            if (penId === '') return `<div class="pen-hint">Not drawing from supply.</div>`;
            const pen = penId ? pens.find(p => p.id === penId) : sug.pen;
            if (!pen) return `<div class="pen-hint warn">${Icons.alert} No usable ${cn} in supply for ${dose}${escapeHtml(med.unit)}. Save anyway, or add one first.</div>`;
            const left = Math.round((pen.capacity - pen.used) * 100) / 100;
            let splitNote = '';
            if (pen.dose !== dose) {
                if (med.splitDose) splitNote = ` · split: <strong>≈${Math.round(D.clicksForDose(dose, pen.dose, med.clicksPerDose))} clicks</strong> from the ${pen.dose}${escapeHtml(med.unit)} ${cn} <span class="dim-sm">(community-measured — not official Lilly guidance)</span>`;
                else if (med.type === 'pill') splitNote = ` · <strong>${Math.round(D.doseConsumption(dose, pen) * 100) / 100}× ${pen.dose}${escapeHtml(med.unit)}</strong> tablets`;
            }
            const openNote = (!penId && sug.isNewOpen) ? 'Will open new' : 'Using';
            const doseWord = med.type === 'pill' ? 'tablet' : 'dose';
            return `<div class="pen-hint">${openNote} <strong>${pen.dose}${escapeHtml(med.unit)}</strong> ${cn} — ${left} ${doseWord}${left === 1 ? '' : 's'} left${splitNote}.</div>`;
        };

        const flexible = med.splitDose || (med.type && med.type !== 'injection');
        const eligiblePens = () => pens.filter(p => p.medId === med.id && !p.exhaustedDate &&
            ((p.capacity - p.used) >= D.doseConsumption(dose, p) - 0.001 || !p.openedDate) &&
            (flexible || p.dose === dose));

        openModal({
            title: initial ? `Edit ${med.name} ${isInjection ? 'shot' : 'dose'}` : `Log ${med.name} ${isInjection ? 'shot' : 'dose'}`,
            sub: `${med.generic || 'custom'} · ${med.penCapacity} per ${cn}`,
            bodyHtml: `
                <div class="field">
                    <label>Dose (${escapeHtml(med.unit)})</label>
                    <div class="chip-grp" id="doseChips">
                        ${med.doses.map(x => `<button class="chip ${dose === x ? 'active' : ''}" data-dose="${x}">${x}${escapeHtml(med.unit)}</button>`).join('')}
                    </div>
                </div>
                <div class="field-row">
                    <div class="field nomb"><label>Date — any past date works</label><input type="date" id="shotDate" value="${defaultDate}"></div>
                    <div class="field nomb"><label>Time</label><input type="time" id="shotTime" value="${initial ? initial.time : (prefill && prefill.date ? String(new Date().getHours()).padStart(2, '0') + ':00' : nowHm())}"></div>
                </div>
                ${locOn ? `
                <div class="field">
                    <label>Injection location · suggested: <span class="txt-accent">${escapeHtml(suggestedLoc)}</span></label>
                    <div class="bodydiag" id="locGrid">
                        ${locs.map(L => `<button class="bd-loc ${loc === L ? 'active' : ''} ${L === suggestedLoc ? 'next' : ''}" data-loc="${escapeHtml(L)}">${escapeHtml(L)}</button>`).join('')}
                    </div>
                </div>` : ''}
                <div class="field">
                    <label>From which ${cn}</label>
                    <select id="penSelect">
                        <option value="auto">Auto (smart routing)</option>
                        ${eligiblePens().map(p => `<option value="${escapeHtml(p.id)}" ${penId === p.id ? 'selected' : ''}>${p.dose}${escapeHtml(med.unit)} · ${Math.round((p.capacity - p.used) * 10) / 10} of ${p.capacity} left · ${p.openedDate ? 'opened ' + D.fmtDateShort(p.openedDate) : 'unopened'}</option>`).join('')}
                        <option value="" ${penId === '' ? 'selected' : ''}>— don't draw from supply —</option>
                    </select>
                    <div id="penHint">${penHintHtml()}</div>
                </div>`,
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
                        if (usePenId === null) {
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
                            // a hand-edited dose is confirmed real — drop the "est"
                            // flag so "Remove estimated" can't delete it
                            if (i >= 0) s.shots[i] = Object.assign({}, s.shots[i], payload, { estimated: false });
                        } else {
                            s.shots.push(Object.assign({ id: uid('shot') }, payload));
                        }
                        // logging a dose clears the manual next-dose override —
                        // it applied to THIS dose, whatever was actually taken
                        const m = s.meds.find(x => x.id === med.id);
                        if (m && !initial && m.preferredNextDose != null) m.preferredNextDose = null;
                    });
                    toast(initial ? 'Dose updated' : 'Dose logged');
                    close();
                });
            },
        });
    }

    // ------------------------------------------------
    // Log mini-menu — the centre button on the mobile bar
    // ------------------------------------------------
    function logSheet() {
        const S = Store();
        const set = S.state.settings;
        const meds = S.state.meds;
        if (!meds.length && set.weightTrackingEnabled === false) { M().addMed(); return; }
        const rows = meds.map(m => {
            const nd = D.predictNextDose(m, S.medShots(m.id), set);
            const late = nd ? D.lateDoseStatus(m, nd) : null;
            const sub = !nd ? 'no doses yet'
                : late ? 'overdue'
                : `next ${D.fmtTimeStr(nd.time, set)} ${D.dayLabel(nd.date).toLowerCase()} · ${D.fmtDoseCount(m, nd.dose, S.state.pens)}`;
            return `<button class="sheet-row" data-sheet-med="${escapeHtml(m.id)}">
                <span class="ml-dot" style="background:${escapeHtml(m.color || '#5fc8c8')}"></span>
                <span class="sheet-main">Log dose — ${escapeHtml(m.name)}</span>
                <span class="sheet-sub ${late ? 'txt-danger' : ''}">${escapeHtml(sub)}</span>
            </button>`;
        }).join('');
        openModal({
            title: 'Log…',
            bodyHtml: `<div class="sheet-rows">
                ${rows}
                ${set.weightTrackingEnabled !== false ? `<button class="sheet-row" data-sheet-weight>
                    <span class="qicon sm">${Icons.scale}</span>
                    <span class="sheet-main">Log weight</span>
                </button>` : ''}
                ${!meds.length ? `<button class="sheet-row" data-sheet-addmed>
                    <span class="qicon sm">${Icons.plus}</span>
                    <span class="sheet-main">Add a medication</span>
                </button>` : ''}
            </div>`,
            onMount(modal, close) {
                modal.addEventListener('click', e => {
                    const medBtn = e.target.closest('[data-sheet-med]');
                    if (medBtn) {
                        const id = medBtn.dataset.sheetMed;
                        Store().update(st => { st.activeMedId = id; }, { silent: true });
                        close();
                        logShot();
                        return;
                    }
                    if (e.target.closest('[data-sheet-weight]')) { close(); logWeight(); }
                    if (e.target.closest('[data-sheet-addmed]')) { close(); M().addMed(); }
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
    // Backfill estimator (used by onboarding + meds page)
    // Estimates past doses so levels/graphs start correct.
    // ------------------------------------------------
    function backfill(med, onDone) {
        const S = Store();
        let currentDose = med.preferredNextDose != null ? med.preferredNextDose : med.doses[Math.floor(med.doses.length / 2)] || med.doses[0];
        // multi-daily meds default straight to the daily-plan editor
        let mode = (med.frequency || 7) < 0.9 ? 'plan' : 'auto'; // 'auto' | 'manual' | 'plan'
        // show the frequency in its natural unit — "3 × per day" for slot
        // meds, hours for sub-daily, days otherwise
        let freqVal = med.frequency || 7, freqUnit = 'days';
        if (freqVal < 0.95) {
            const per = 1 / freqVal;
            if (Math.abs(per - Math.round(per)) < 0.06) { freqVal = Math.round(per); freqUnit = 'perday'; }
            else { freqVal = Math.round(freqVal * 24 * 10) / 10; freqUnit = 'hours'; }
        }

        const stepRowsHtml = () => med.doses.filter(x => x <= currentDose).map(x => `
            <div class="bf-step"><span class="bf-dose">${x}${escapeHtml(med.unit)}</span>
            <input type="number" min="0" data-step="${x}" value="${x === currentDose ? '' : 4}" placeholder="${x === currentDose ? 'until today' : 'weeks'}">
            <span class="dim-sm">weeks</span></div>`).join('');

        // daily plan rows: time + count × dose (e.g. 23:00 · 2 × 5mg = 10mg)
        const existingSlots = D.getScheduleSlots(med);
        const planDefaults = existingSlots.length
            ? existingSlots.map(sl => ({ time: sl.time, count: 1, dose: sl.dose != null ? sl.dose : (med.doses[0] || 5) }))
            : [{ time: '08:00', count: 1, dose: med.doses[0] || 5 }];
        const planRowHtml = r => `
            <div class="bf-plan-row">
                <input type="time" value="${r ? r.time : ''}" data-plan-time>
                <input type="number" min="1" step="1" value="${r ? r.count : 1}" data-plan-count title="How many at once">
                <span class="dim-sm">×</span>
                <input type="number" min="0" step="any" value="${r ? r.dose : ''}" data-plan-dose placeholder="dose">
                <span class="dim-sm">${escapeHtml(med.unit)}</span>
                <button type="button" class="icon-btn xs" data-plan-del title="Remove">✕</button>
            </div>`;

        openModal({
            title: `Already taking ${med.name}?`,
            sub: 'Estimates your past doses so charts and levels start out right. Estimated doses get an “est” tag and can be removed later. Just starting this med? Hit Cancel — nothing else needed.',
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
                            <input type="number" min="0" step="0.5" id="bfFreqVal" value="${freqVal}">
                            <select id="bfFreqUnit">
                                <option value="perday" ${freqUnit === 'perday' ? 'selected' : ''}>× per day</option>
                                <option value="hours" ${freqUnit === 'hours' ? 'selected' : ''}>hours</option>
                                <option value="days" ${freqUnit === 'days' ? 'selected' : ''}>days</option>
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
                    <label>How should we estimate your history?</label>
                    <div class="chip-grp" id="bfMode">
                        <button class="chip ${mode === 'auto' ? 'active' : ''}" data-mode="auto">Standard schedule</button>
                        <button class="chip ${mode === 'manual' ? 'active' : ''}" data-mode="manual">I'll detail each dose</button>
                        <button class="chip ${mode === 'plan' ? 'active' : ''}" data-mode="plan">Daily plan (times × doses)</button>
                    </div>
                </div>
                <div id="bfManual" style="display:${mode === 'manual' ? '' : 'none'}">
                    <label class="field-label">Time spent at each dose</label>
                    <div id="bfSteps">${stepRowsHtml()}</div>
                </div>
                <div id="bfPlan" style="display:${mode === 'plan' ? '' : 'none'}">
                    <label class="field-label">Your daily plan — e.g. 5pm 1×5${escapeHtml(med.unit)}, 8pm 1×5${escapeHtml(med.unit)}, 11pm 2×5${escapeHtml(med.unit)}</label>
                    <div id="bfPlanRows">${planDefaults.map(planRowHtml).join('')}</div>
                    <button type="button" class="btn small" id="bfPlanAdd" style="margin-top:6px">${Icons.plus} add time</button>
                    <div class="dim-sm" style="margin-top:8px">This plan is also saved to the med, so “next dose” follows it from now on.</div>
                </div>
                <div class="pen-hint" id="bfPreview"></div>`,
            footHtml: `
                <button class="btn ghost" data-act="cancel">Cancel</button>
                <button class="btn primary" data-act="save">${Icons.wand} Add estimated doses</button>`,
            onMount(modal, close) {
                const freqDays = () => {
                    const v = parseFloat(modal.querySelector('#bfFreqVal').value) || 7;
                    const u = modal.querySelector('#bfFreqUnit').value;
                    if (u === 'perday') return v > 0 ? Math.round((1 / v) * 100) / 100 : 1;
                    return u === 'hours' ? v / 24 : u === 'weeks' ? v * 7 : v;
                };
                const collectPlanSlots = () => Array.from(modal.querySelectorAll('.bf-plan-row')).map(row => {
                    const time = row.querySelector('[data-plan-time]').value;
                    const count = parseInt(row.querySelector('[data-plan-count]').value) || 1;
                    const dose = parseFloat(row.querySelector('[data-plan-dose]').value);
                    return { time, dose: (!isNaN(dose) && dose > 0) ? Math.round(count * dose * 1000) / 1000 : null };
                }).filter(sl => /^\d{1,2}:\d{2}$/.test(sl.time) && sl.dose > 0);

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
                    if (mode === 'plan') {
                        opts.dailySlots = collectPlanSlots();
                        // daily plans need a start — default to 4 weeks back
                        if (!opts.startDate) opts.startDate = D.ymd(D.addDays(new Date(), -28));
                    } else if (mode === 'manual') {
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
                        const opts = buildOpts();
                        const shots = D.estimateBackfillShots(opts);
                        const first = shots[0];
                        const tail = mode === 'plan'
                            ? ` (${opts.dailySlots.length} per day: ${opts.dailySlots.map(sl => `${sl.time} ${sl.dose}${med.unit}`).join(', ')})`
                            : `, ending on ${currentDose}${escapeHtml(med.unit)}`;
                        modal.querySelector('#bfPreview').innerHTML = shots.length
                            ? `Will add <strong>${shots.length}</strong> estimated dose${shots.length === 1 ? '' : 's'} from <strong>${D.fmtDateShort(first.timestamp)}</strong> to <strong>${D.fmtDateShort(shots[shots.length - 1].timestamp)}</strong>${tail}.`
                            : 'Nothing to add with these settings.';
                    } catch (e) { modal.querySelector('#bfPreview').textContent = 'Could not build a preview.'; }
                };

                // plan mode replaces the single-dose/frequency questions
                const applyModeVisibility = () => {
                    modal.querySelector('#bfManual').style.display = mode === 'manual' ? '' : 'none';
                    modal.querySelector('#bfPlan').style.display = mode === 'plan' ? '' : 'none';
                    modal.querySelector('#bfDose').closest('.field').style.display = mode === 'plan' ? 'none' : '';
                    modal.querySelector('#bfFreqVal').closest('.field-row').style.display = mode === 'plan' ? 'none' : '';
                };
                applyModeVisibility();
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
                    applyModeVisibility();
                    preview();
                });
                modal.querySelector('#bfPlanAdd').addEventListener('click', () => {
                    const rows = modal.querySelector('#bfPlanRows');
                    rows.insertAdjacentHTML('beforeend', planRowHtml(null));
                    preview();
                });
                modal.querySelector('#bfPlan').addEventListener('click', e => {
                    const del = e.target.closest('[data-plan-del]');
                    if (del) { del.closest('.bf-plan-row').remove(); preview(); }
                });
                modal.querySelector('#bfPlan').addEventListener('input', preview);
                modal.querySelector('#bfPlan').addEventListener('change', preview);
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
                        // keep the med's schedule in step with what was estimated
                        if (m) {
                            if (mode === 'plan') {
                                // daily plan becomes the med's ongoing schedule so
                                // "next dose" follows the right slot at the right dose
                                const slots = collectPlanSlots();
                                if (slots.length) {
                                    m.scheduleTimes = slots;
                                    m.scheduleTime = slots[0].time;
                                    m.frequency = Math.round((1 / slots.length) * 100) / 100;
                                }
                            } else {
                                const fd = buildOpts().frequencyDays;
                                if (Math.abs(fd - m.frequency) > 0.01) m.frequency = Math.round(fd * 100) / 100;
                            }
                        }
                    });
                    toast(`${shots.length} estimated doses added`);
                    close();
                    if (onDone) onDone();
                });
            },
        });
    }

    // Each file adds to the shared namespace rather than replacing it, so app.js can
    // keep one reference and the load order below stops mattering.
    Object.assign(window.Modals = window.Modals || {}, { logShot, logSheet, logWeight, backfill });
})();
