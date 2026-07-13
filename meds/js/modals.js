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
        if (!meds.length && set.weightTrackingEnabled === false) { addMed(); return; }
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
                    if (e.target.closest('[data-sheet-addmed]')) { close(); addMed(); }
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
    // Edit one supply item — fix mistakes: strength, size,
    // how much is used, dates, or retire it entirely
    // ------------------------------------------------
    function editPen(penId) {
        const S = Store();
        const raw = S.state.pens.find(p => p.id === penId);
        if (!raw) return;
        const med = S.state.meds.find(m => m.id === raw.medId) || (S.state.trashedMeds || []).find(m => m.id === raw.medId);
        if (!med) { toast('This item belongs to a deleted medication'); return; }
        const derived = S.medPens(med.id).find(p => p.id === penId) || raw;
        const cn = D.containerName(med);
        const doseWord = med.type === 'pill' ? 'tablets' : 'doses';
        let markEmpty = !!raw.manuallyExhausted;

        openModal({
            title: `Edit ${cn}`,
            sub: `${med.name} — corrections apply immediately.`,
            bodyHtml: `
                <div class="field-row">
                    <div class="field nomb"><label>Strength (${escapeHtml(med.unit)})</label>
                        <input type="number" min="0" step="any" id="epDose" value="${raw.dose}"></div>
                    <div class="field nomb"><label>${doseWord.charAt(0).toUpperCase() + doseWord.slice(1)} per ${cn}</label>
                        <input type="number" min="1" step="1" id="epCap" value="${raw.capacity}"></div>
                </div>
                <div class="field">
                    <label>${doseWord.charAt(0).toUpperCase() + doseWord.slice(1)} used so far (${(Math.round(derived.used * 10) / 10)} now — logged doses count automatically)</label>
                    <input type="number" min="0" step="any" id="epUsed" value="${Math.round(derived.used * 100) / 100}">
                </div>
                <div class="field-row">
                    <div class="field nomb"><label>Picked up on</label><input type="date" id="epAcquired" value="${raw.acquiredDate || ''}"></div>
                    <div class="field nomb"><label>First used on</label><input type="date" id="epOpened" value="${raw.openedDate || ''}"></div>
                </div>
                <div class="field"><label>Note</label><input id="epNote" value="${escapeHtml(raw.note || '')}"></div>
                <div class="field">
                    <button class="chip ${markEmpty ? 'active' : ''}" id="epEmpty">${markEmpty ? '✓ ' : ''}Mark as finished / lost (retire it)</button>
                </div>`,
            footHtml: `
                <button class="btn ghost" data-act="cancel">Cancel</button>
                <button class="btn primary" data-act="save">Save changes</button>`,
            onMount(modal, close) {
                modal.querySelector('#epEmpty').addEventListener('click', () => {
                    markEmpty = !markEmpty;
                    const b = modal.querySelector('#epEmpty');
                    b.classList.toggle('active', markEmpty);
                    b.textContent = (markEmpty ? '✓ ' : '') + 'Mark as finished / lost (retire it)';
                });
                modal.querySelector('[data-act="cancel"]').addEventListener('click', close);
                modal.querySelector('[data-act="save"]').addEventListener('click', () => {
                    const newDose = parseFloat(modal.querySelector('#epDose').value);
                    const newCap = parseInt(modal.querySelector('#epCap').value);
                    const wantUsed = parseFloat(modal.querySelector('#epUsed').value);
                    const acquired = modal.querySelector('#epAcquired').value || null;
                    const opened = modal.querySelector('#epOpened').value || null;
                    const note = modal.querySelector('#epNote').value.trim();
                    S.update(s => {
                        const p = s.pens.find(x => x.id === penId);
                        if (!p) return;
                        if (!isNaN(newDose) && newDose > 0) p.dose = newDose;
                        if (!isNaN(newCap) && newCap > 0) p.capacity = newCap;
                        p.acquiredDate = acquired;
                        p.openedDate = opened;
                        p.note = note;
                        // the entered "used" becomes an offset on top of what the
                        // assigned doses consume, so future logs still count
                        if (!isNaN(wantUsed) && wantUsed >= 0) {
                            const shotSum = s.shots.filter(x => x.penId === penId)
                                .reduce((a, x) => a + D.doseConsumption(x.dose, p), 0);
                            p.usedOffset = Math.round((wantUsed - shotSum) * 1000) / 1000;
                        }
                        p.manuallyExhausted = markEmpty || null;
                        p.exhaustedDate = markEmpty ? (p.exhaustedDate || D.ymd(new Date())) : null;
                    });
                    toast('Supply item updated');
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
                        backfill(med);
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
                    if (newMed) backfill(newMed);
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
                    <p class="confirm-text">Download a JSON backup of all your doses, weights, meds, supply and settings. The file also works with the old site's import.</p>
                    <div class="pen-hint col">
                        <div><strong>${S.state.shots.length}</strong> doses · <strong>${S.state.weights.length}</strong> weights · <strong>${S.state.meds.length}</strong> meds · <strong>${S.state.pens.length}</strong> supply items</div>
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
            drawer.querySelector('[data-act="close"]').addEventListener('click', close);
            drawer.querySelectorAll('[data-set]').forEach(b => b.addEventListener('click', () => {
                const key = b.dataset.set;
                let val = b.dataset.val;
                S.update(s => {
                    if (key === 'goalKg' || key === 'startKg') val = parseFloat(val);
                    s.settings[key] = val;
                });
                if (key === 'theme' || key === 'accent' || key === 'textScale') window.App.applyTheme();
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
            act('[data-act="import-export"]', () => { close(); importExport(); });
            act('[data-act="replay-onboarding"]', () => { close(); window.Onboarding.start(true); });
            act('[data-act="reset"]', async () => {
                const ok = await confirmModal('Reset ALL data (doses, weights, meds, supply, settings)? This also clears your server copy if signed in.', { danger: true, yesLabel: 'Reset everything' });
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
            sub: 'Your local data differs from your account. Merge keeps everything from both.',
            noBackdropClose: true,
            noClose: true,
            bodyHtml: `
                <div class="conflict-grid">
                    <div class="data-column"><h3>This device</h3>${fmtSum(localSum)}</div>
                    <div class="data-column"><h3>Your account</h3>${fmtSum(serverSum)}</div>
                </div>
                <p class="dim-sm" style="margin-top:10px">Merge combines both copies section by section — doses, weights, meds and supply are joined with duplicates removed. Items deleted on only one side will come back.</p>`,
            footHtml: `
                <button class="btn" data-act="local">${Icons.upload} Keep this device</button>
                <button class="btn" data-act="server">${Icons.download} Keep account copy</button>
                <button class="btn primary" data-act="merge">${Icons.refresh} Merge both</button>`,
            onMount(modal, close) {
                modal.querySelector('[data-act="local"]').addEventListener('click', () => { S.resolveConflict(false); close(); });
                modal.querySelector('[data-act="server"]').addEventListener('click', () => { S.resolveConflict(true); close(); });
                modal.querySelector('[data-act="merge"]').addEventListener('click', () => {
                    S.resolveConflictMerge();
                    close();
                    toast('Merged both copies');
                });
            },
        });
    }

    window.Modals = { logShot, logSheet, logWeight, addPens, editPen, addMed, backfill, importExport, settingsDrawer, authModal, changePasswordModal, syncConflict };
})();
