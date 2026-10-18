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
    // Log / edit entry
    // ------------------------------------------------
    function logDose(initial, prefill) {
        const S = Store();
        // editing from the all-meds history: honour the entry's own med — a
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
        const doseLog = S.medDoses(med.id);
        const containers = S.medContainers(med.id);
        const lastEntry = doseLog.find(x => !initial || x.id !== initial.id);
        const isInjection = !med.type || med.type === 'injection';
        const locOn = set.shotLocationTrackingEnabled && isInjection;
        const locs = set.shotLocations && set.shotLocations.length ? set.shotLocations : D.DEFAULT_LOCATIONS;

        const suggestedLoc = (() => {
            if (initial && initial.location) return initial.location;
            if (!lastEntry || !lastEntry.location) return locs[0];
            return locs[(locs.indexOf(lastEntry.location) + 1) % locs.length];
        })();

        // slot-aware default: logging near the 23:00 slot pre-picks that slot's dose
        const ndForDefault = !initial ? D.predictNextDose(med, doseLog, set) : null;
        let dose = initial ? initial.dose
            : (ndForDefault && ndForDefault.dose != null ? ndForDefault.dose
                : (med.preferredNextDose != null ? med.preferredNextDose : (lastEntry ? lastEntry.dose : med.doses[0])));
        let loc = suggestedLoc;
        let penId = initial ? (initial.penId || '') : null; // null = auto

        const cn = D.containerName(med);
        const penHintHtml = () => {
            const sug = D.suggestContainerForDose(containers, med, dose);
            if (penId === '') return `<div class="container-hint">Not drawing from supply.</div>`;
            const container = penId ? containers.find(p => p.id === penId) : sug.container;
            if (!container) return `<div class="container-hint warn">${Icons.alert} No usable ${cn} in supply for ${escapeHtml(D.fmtDoseUnit(dose, med.unit))}. Save anyway, or add one first.</div>`;
            const left = Math.round((container.capacity - container.used) * 100) / 100;
            let splitNote = '';
            if (container.dose !== dose) {
                if (med.splitDose) splitNote = ` · split: <strong>≈${Math.round(D.clicksForDose(dose, container.dose, med.clicksPerDose))} clicks</strong> from the ${container.dose}${escapeHtml(med.unit)} ${cn} <span class="dim-sm">(community-measured — not official Lilly guidance)</span>`;
                else if (med.type === 'pill') splitNote = ` · <strong>${Math.round(D.doseConsumption(dose, container) * 100) / 100}× ${container.dose}${escapeHtml(med.unit)}</strong> tablets`;
            }
            const openNote = (!penId && sug.isNewOpen) ? 'Will open new' : 'Using';
            const doseWord = med.type === 'pill' ? 'tablet' : 'dose';
            return `<div class="container-hint">${openNote} <strong>${container.dose}${escapeHtml(med.unit)}</strong> ${cn} — ${left} ${doseWord}${left === 1 ? '' : 's'} left${splitNote}.</div>`;
        };

        const flexible = med.splitDose || (med.type && med.type !== 'injection');
        const eligiblePens = () => containers.filter(p => p.medId === med.id && !p.exhaustedDate &&
            ((p.capacity - p.used) >= D.doseConsumption(dose, p) - 0.001 || !p.openedDate) &&
            (flexible || p.dose === dose));

        /**
         * The 24-hour ingredient picture for the dose currently selected.
         *
         * 🔴 IT WARNS. IT DOES NOT BLOCK. Deliberate: a tracker
         * that refuses to record something a person has already swallowed stops being
         * a record of what happened, and they then have every reason to lie to it or
         * stop using it — exactly when the data matters most.
         *
         * Which is why it has to be HERE, in the body, visible while the dose is being
         * chosen — not a confirmation after the Save button. Before the decision it can
         * change the decision; after it, all it can change is the honesty of the log.
         */
        let modalEl = null;   // set in onMount; the first render happens before it exists
        /** When this dose is being logged FOR: the form's date and time, not "now". */
        function chosenTs() {
            const d = modalEl && modalEl.querySelector('#shotDate');
            const t = modalEl && modalEl.querySelector('#shotTime');
            if (d && d.value) {
                const ts = new Date(d.value + 'T' + ((t && t.value) || '09:00')).getTime();
                if (!isNaN(ts)) return ts;
            }
            return initial && initial.timestamp ? initial.timestamp : Date.now();
        }
        function ceilingPanelHtml() {
            const st = Store().state;
            const at = chosenTs();
            // What is already in the body at that time: every other dose (never the one
            // being edited, which would count itself twice), from every med the doses
            // belong to, stopped and trashed ones included, since they were still taken.
            const allMeds = st.meds.concat(st.trashedMeds || []);
            const others = st.shots.filter(x => !initial || x.id !== initial.id);
            const ownOthers = Store().medDoses(med.id).filter(x => !initial || x.id !== initial.id);
            const rows = D.ceilingCheck(allMeds, others, med, dose, at);
            const nsaids = D.concurrentNsaids(allMeds, others, at, med, dose);
            const bad = rows.filter(r => r.level !== 'ok');
            // An early dose is a warning even when nothing is near a ceiling, and the two
            // constraints can be violated independently (which is why both are checked).
            const allowed = D.nextAllowedDose(med, ownOthers, allMeds, others, dose, at);
            if (!bad.length && !nsaids.length && !(allowed && allowed.reason === 'gap')) return '';

            const tooSoon = (allowed && allowed.reason === 'gap') ? `<div class="ceil-row near">
                <div>That is sooner than the label's minimum gap.</div>
                <div class="dim-sm">The next one is due from
                    <strong>${D.fmtTime(allowed.at, st.settings)}</strong>${
                        D.fmtDateShort(allowed.at) !== D.fmtDateShort(Date.now())
                            ? ' on ' + D.fmtDateShort(allowed.at) : ''}.
                    ${escapeHtml((med.missedDose && med.missedDose.note) || '')}</div>
            </div>` : '';

            const body = bad.map(r => {
                const name = escapeHtml(r.substance.name.toLowerCase());
                const L = r.limits || {};
                // WHOSE limit, and on what authority. "You are over the limit" is
                // a number; "this is the over-the-counter figure, here is the label, and
                // here is what actually goes wrong" is the part that can change a
                // decision — or tell the user the limit is simply the wrong one for them.
                const whose = L.basis === 'user' ? 'your own limit'
                    : L.basis === 'otc' ? 'the over-the-counter limit'
                    : L.basis === 'prescription' ? 'the prescribing label'
                    : L.basis === 'unverified' ? 'an unverified figure' : 'the published limit';
                const cite = L.source ? `<a href="${escapeHtml(window.UI.safeUrl(L.source.url))}" target="_blank" rel="noopener noreferrer">${escapeHtml(L.source.label)}</a>` : '';
                if (r.level === 'over') {
                    return `<div class="ceil-row over">
                        <div><strong>That is more ${name} than ${escapeHtml(whose)} allows in a day.</strong></div>
                        <div class="dim-sm">${D.fmtAmount(r.already)} mg already in the last 24 hours,
                            plus ${D.fmtAmount(r.adding)} mg now = <strong>${D.fmtAmount(r.total)} mg</strong>
                            against ${D.fmtAmount(r.ceiling)} mg.</div>
                        ${L.harm ? `<div class="ceil-harm">${escapeHtml(L.harm)}</div>` : ''}
                        ${r.safeAt ? `<div class="ceil-when">Enough will have cleared by
                            <strong>${D.fmtTime(r.safeAt, st.settings)}</strong>${
                                D.fmtDateShort(r.safeAt) !== D.fmtDateShort(Date.now())
                                    ? ' on ' + D.fmtDateShort(r.safeAt) : ''} — waiting until then keeps you inside it.</div>`
                            : `<div class="ceil-when">This single dose is over the daily limit on its own, so waiting will not help.</div>`}
                        <div class="ceil-acts">
                            ${cite ? `<span class="dim-sm">${cite}</span>` : ''}
                            <button class="link" data-act="edit-limit" data-sub="${escapeHtml(r.substance.id)}">
                                ${L.basis === 'user' ? 'Change my limit' : 'This is not my limit'}</button>
                        </div>
                    </div>`;
                }
                return `<div class="ceil-row near">
                    <div>${Math.round(r.pct * 100)}% of ${escapeHtml(whose)} for ${name} once this is logged
                        <span class="dim-sm">(${D.fmtAmount(r.total)} of ${D.fmtAmount(r.ceiling)} mg)</span></div>
                    ${cite ? `<div class="dim-sm">${cite}</div>` : ''}
                </div>`;
            }).join('');

            const nsaidHtml = nsaids.length ? `<div class="ceil-row near">
                <div>Two anti-inflammatories at once — ${escapeHtml(nsaids.join(' and '))}.</div>
                <div class="dim-sm">They work the same way, so taking both adds the stomach, kidney and
                    heart risk without adding much pain relief.</div>
            </div>` : '';

            return `<div class="ceil-panel ${bad.some(r => r.level === 'over') ? 'is-over' : ''}">
                ${tooSoon}${body}${nsaidHtml}
                <div class="dim-sm ceil-foot">The dose will still be saved — this is a heads-up, not a
                    lock. Limits are typical-adult figures and take no account of your liver, kidneys,
                    weight or anything else you take.</div>
            </div>`;
        }

        openModal({
            title: initial ? `Edit ${med.name} ${isInjection ? 'entry' : 'dose'}` : `Log ${med.name} ${isInjection ? 'entry' : 'dose'}`,
            sub: `${med.generic || 'custom'} · ${med.penCapacity} per ${cn}`,
            bodyHtml: `
                <div class="field">
                    <label>Dose (${escapeHtml(med.unit)})</label>
                    <div class="chip-grp" id="doseChips">
                        ${med.doses.map(x => `<button class="chip ${dose === x ? 'active' : ''}" data-dose="${x}">${escapeHtml(D.fmtDoseUnit(x, med.unit))}</button>`).join('')}
                    </div>
                </div>
                <div class="field-row">
                    <div class="field nomb"><label>Date — any past date works</label><input type="date" id="shotDate" value="${defaultDate}"></div>
                    <div class="field nomb"><label>Time</label><input type="time" id="shotTime" value="${initial ? initial.time : (prefill && prefill.date ? String(new Date().getHours()).padStart(2, '0') + ':00' : nowHm())}"></div>
                </div>
                <div class="field"><label>Note <span class="dim-sm">— optional</span></label>
                    <input id="shotNote" maxlength="300" value="${escapeHtml((initial && initial.note) || '')}" placeholder="how it worked, side effects…"></div>
                ${locOn ? `
                <div class="field">
                    <label>Injection location · suggested: <span class="txt-accent">${escapeHtml(suggestedLoc)}</span></label>
                    <div class="bodydiag" id="locGrid">
                        ${locs.map(L => `<button class="bd-loc ${loc === L ? 'active' : ''} ${L === suggestedLoc ? 'next' : ''}" data-loc="${escapeHtml(L)}">${escapeHtml(L)}</button>`).join('')}
                    </div>
                </div>` : ''}
                <div id="ceilingPanel">${ceilingPanelHtml()}</div>
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
                <button class="btn primary" data-act="save">${Icons.check} ${initial ? 'Save changes' : 'Save ' + (isInjection ? 'entry' : 'dose')}</button>`,
            onMount(modal, close) {
                modalEl = modal;
                if (!initial && !(prefill && prefill.date)) liveClock(modal, '#shotDate', '#shotTime');
                const hint = modal.querySelector('#penHint');
                // The limits depend on WHEN, so moving the date or time re-checks them.
                ['#shotDate', '#shotTime'].forEach(sel => {
                    const el = modal.querySelector(sel);
                    if (el) el.addEventListener('change', () => {
                        const cp = modal.querySelector('#ceilingPanel');
                        if (cp) cp.innerHTML = ceilingPanelHtml();
                    });
                });
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
                    const cp = modal.querySelector('#ceilingPanel');
                    if (cp) cp.innerHTML = ceilingPanelHtml();
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
                modal.addEventListener('click', e => {
                    const b = e.target.closest('[data-act="edit-limit"]');
                    if (!b) return;
                    // Straight from the warning to the thing that fixes it, because the
                    // moment somebody thinks "that is not my limit" is the moment they
                    // will actually change it.
                    close();
                    M().editLimit(b.dataset.sub);
                });
                modal.querySelector('[data-act="save"]').addEventListener('click', () => {
                    const date = modal.querySelector('#shotDate').value;
                    const time = modal.querySelector('#shotTime').value || '09:00';
                    if (!date) { toast('Pick a date', 'error'); return; }
                    const ts = new Date(date + 'T' + time).getTime();
                    if (isNaN(ts)) { toast('Invalid date/time', 'error'); return; }

                    Store().update(s => {
                        // resolve container
                        let usePenId = penId;
                        if (usePenId === null) usePenId = Store().pickContainer(s, med, dose, date);
                        if (usePenId) {
                            const p = s.pens.find(x => x.id === usePenId);
                            if (p && !p.openedDate) p.openedDate = date;
                        }
                        const note = (modal.querySelector('#shotNote') || {}).value;
                        const payload = {
                            medId: med.id, dose, date, time, timestamp: ts,
                            location: locOn ? loc : null,
                            penId: usePenId || null,
                            ...(note && note.trim() ? { note: note.trim() } : {}),
                        };
                        if (initial) {
                            const i = s.shots.findIndex(x => x.id === initial.id);
                            // a hand-edited dose is confirmed real — drop the "est"
                            // flag so "Remove estimated" can't delete it
                            if (i >= 0) {
                                s.shots[i] = Object.assign({}, s.shots[i], payload, { estimated: false });
                                // a note cleared in the form is cleared on the dose
                                if (!payload.note) delete s.shots[i].note;
                            }
                        } else {
                            s.shots.push(Object.assign({ id: uid('entry') }, payload));
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
        // In the order the person picks from (Settings > Medication order; Smart by default).
        const medsOn = set.medsTrackingEnabled !== false;
        const meds = medsOn ? D.orderMedsForPicker(S.state.meds, S.state.shots, set) : [];
        const pain = !!set.painTrackingEnabled;
        if (!medsOn && set.weightTrackingEnabled === false && !pain) { toast('Turn on something to track in Settings'); return; }
        if (!meds.length && set.weightTrackingEnabled === false && !pain) { M().addMed(); return; }
        const checkinDue = pain && set.painScale === 'dvprs' && window.Pain
            && !window.Pain.checkinDoneOn(S.state.pains, todayYmd());
        const rows = meds.map(m => {
            const nd = D.predictNextDose(m, S.medDoses(m.id), set);
            const late = nd ? D.lateDoseStatus(m, nd) : null;
            const sub = !nd ? 'no doses yet'
                : late ? 'overdue'
                : `next ${D.slotLabel(nd, set)} ${D.dayLabel(nd.date).toLowerCase()} · ${D.fmtDoseCount(m, nd.dose, S.state.pens)}`;
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
                ${pain ? `<button class="sheet-row" data-sheet-pain>
                    <span class="qicon sm">${Icons.pain}</span>
                    <span class="sheet-main">Log pain</span>
                </button>` : ''}
                ${checkinDue ? `<button class="sheet-row" data-sheet-checkin>
                    <span class="qicon sm">${Icons.check}</span>
                    <span class="sheet-main">Daily pain check-in</span>
                    <span class="sheet-sub">not done today</span>
                </button>` : ''}
                ${set.weightTrackingEnabled !== false ? `<button class="sheet-row" data-sheet-weight>
                    <span class="qicon sm">${Icons.scale}</span>
                    <span class="sheet-main">Log weight</span>
                </button>` : ''}
                ${medsOn && !meds.length ? `<button class="sheet-row" data-sheet-addmed>
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
                        logDose();
                        return;
                    }
                    if (e.target.closest('[data-sheet-weight]')) { close(); logWeight(); }
                    if (e.target.closest('[data-sheet-pain]')) { close(); M().logPain(); }
                    if (e.target.closest('[data-sheet-checkin]')) { close(); M().painCheckin(); }
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
        // multi-daily meds default straight to the daily-plan editor.
        // A PRN med has no interval to estimate from, so it starts in 'manual' — the user
        // types the doses they actually took, rather than the app inventing a rhythm.
        let mode = D.isPRN(med) ? 'manual' : ((med.frequency || 7) < 0.9 ? 'plan' : 'auto');
        // show the frequency in its natural unit — "3 × per day" for slot
        // meds, hours for sub-daily, days otherwise. PRN has none, so the field seeds
        // at weekly purely as a starting point if they switch to 'auto' anyway; it is
        // never written back to the med (see the save handler).
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
                        ${med.doses.map(x => `<button class="chip ${currentDose === x ? 'active' : ''}" data-dose="${x}">${escapeHtml(D.fmtDoseUnit(x, med.unit))}</button>`).join('')}
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
                <div class="container-hint" id="bfPreview"></div>`,
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
                // The daily-plan editor has no anchor control — it is about estimating
                // past doses, not naming times. But its result REPLACES
                // `med.scheduleTimes` wholesale, so without this every "before bed" the
                // user had set would be silently erased by running a backfill. Anchors
                // are carried over by matching the clock time, which is the only thing
                // the two lists have in common.
                const anchorAt = (() => {
                    const byTime = {};
                    D.getScheduleSlots(med).forEach(sl => { if (sl.anchor) byTime[sl.time] = sl.anchor; });
                    return t => byTime[t] || null;
                })();
                const collectPlanSlots = () => Array.from(modal.querySelectorAll('.bf-plan-row')).map(row => {
                    const time = row.querySelector('[data-plan-time]').value;
                    const count = parseInt(row.querySelector('[data-plan-count]').value) || 1;
                    const dose = parseFloat(row.querySelector('[data-plan-dose]').value);
                    const anchor = anchorAt(time);
                    return { time, dose: (!isNaN(dose) && dose > 0) ? Math.round(count * dose * 1000) / 1000 : null,
                        ...(anchor ? { anchor } : {}) };
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
                        const doseLog = D.estimateBackfillDoses(opts);
                        const first = doseLog[0];
                        const tail = mode === 'plan'
                            ? ` (${opts.dailySlots.length} per day: ${opts.dailySlots.map(sl => `${sl.time} ${sl.dose}${med.unit}`).join(', ')})`
                            : `, ending on ${currentDose}${escapeHtml(med.unit)}`;
                        modal.querySelector('#bfPreview').innerHTML = doseLog.length
                            ? `Will add <strong>${doseLog.length}</strong> estimated dose${doseLog.length === 1 ? '' : 's'} from <strong>${D.fmtDateShort(first.timestamp)}</strong> to <strong>${D.fmtDateShort(doseLog[doseLog.length - 1].timestamp)}</strong>${tail}.`
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
                    const doseLog = D.estimateBackfillDoses(buildOpts());
                    if (!doseLog.length) { toast('Nothing to add', 'error'); return; }
                    Store().update(s => {
                        // avoid duplicating real logged doses on the same days
                        const existingDays = new Set(s.shots.filter(x => x.medId === med.id).map(x => x.date));
                        const fresh = doseLog.filter(x => !existingDays.has(x.date));
                        s.shots = s.shots.concat(fresh);
                        // build container history for the estimates
                        const m = s.meds.find(x => x.id === med.id);
                        if (m && (!m.type || m.type === 'injection')) {
                            const { containers, assignment } = D.inferContainersFromDoses(fresh, m);
                            // The flag is what "Remove estimated" looks for; the note is only
                            // what the supply table shows.
                            containers.forEach(p => { p.estimated = true; p.note = 'estimated'; });
                            s.shots.forEach(x => { if (assignment[x.id]) x.penId = assignment[x.id]; });
                            s.pens = s.pens.concat(containers);
                        }
                        // keep the med's schedule in step with what was estimated — but
                        // NEVER for a PRN med. Backfill needs an interval to estimate
                        // past doses from, and writing that interval back would silently
                        // convert "take when needed" into a schedule, restoring the exact
                        // overdue behaviour a PRN med must not have. The estimate is still allowed;
                        // it just does not become the med's schedule.
                        if (m && !D.isPRN(m)) {
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
                    toast(`${doseLog.length} estimated doses added`);
                    close();
                    if (onDone) onDone();
                });
            },
        });
    }

    // ------------------------------------------------
    // Missed-slot catch-up
    //
    // "Which scheduled doses did I not log?" — answered per SLOT, not per day. The
    // bulk estimator above de-duplicates by day, which is right for a once-daily med
    // and silently wrong for a multi-slot one; this is the other feature, kept
    // separate on purpose so each has one correct answer.
    //
    // Everything starts UNTICKED. The app does not know whether a dose was taken and
    // not logged, or genuinely skipped, and guessing "taken" would write medication
    // history the user never confirmed. Ticking is the confirmation.
    // ------------------------------------------------
    function catchUp(med, onDone) {
        const S = Store();
        const set = S.state.settings;
        const missed = D.missedSlots(med, S.medDoses(med.id), { days: 7 });

        if (!missed.length) {
            toast(`${med.name}: nothing missed in the last 7 days`);
            return;
        }

        // group by day, newest first — that is the order you remember your day in
        const byDay = [];
        missed.slice().reverse().forEach(sl => {
            const g = byDay.find(x => x.date === sl.date);
            (g || (byDay[byDay.push({ date: sl.date, slots: [] }) - 1])).slots.push(sl);
        });

        const rowHtml = sl => {
            const label = D.slotLabel(sl, set);
            const dose = sl.dose != null ? sl.dose
                : (med.preferredNextDose != null ? med.preferredNextDose : null);
            return `<label class="cu-row">
                <input type="checkbox" data-cu="${escapeHtml(String(sl.ts))}" data-cu-dose="${dose != null ? dose : ''}">
                <span class="cu-time">${escapeHtml(label)}</span>
                <span class="cu-dose">${dose != null ? escapeHtml(D.fmtDoseCount(med, dose, S.state.pens)) : '<span class="dim">usual dose</span>'}</span>
            </label>`;
        };

        openModal({
            title: `Catch up — ${med.name}`,
            bodyHtml: `
                <p class="confirm-text">${missed.length} scheduled dose${missed.length === 1 ? '' : 's'}
                in the last 7 days ${missed.length === 1 ? 'has' : 'have'} nothing logged against
                ${missed.length === 1 ? 'it' : 'them'}. Tick the ones you actually took.</p>
                <p class="dim-sm">Anything left unticked stays missed — it is not logged, and not
                marked as skipped either.</p>
                <div class="cu-list">
                    ${byDay.map(g => `
                        <div class="cu-day">
                            <div class="cu-day-head">
                                <span>${escapeHtml(D.dayLabel(g.date))}</span>
                                <span class="dim-sm">${escapeHtml(D.fmtDate(g.date, set))}</span>
                                <button type="button" class="link" data-cu-all="${escapeHtml(g.date)}">all</button>
                            </div>
                            ${g.slots.map(rowHtml).join('')}
                        </div>`).join('')}
                </div>`,
            footHtml: `
                <button class="btn ghost" data-act="no">Cancel</button>
                <button class="btn primary" data-act="yes" disabled>Log 0 doses</button>`,
            onMount(modal, close) {
                const boxes = () => Array.from(modal.querySelectorAll('[data-cu]'));
                const saveBtn = modal.querySelector('[data-act="yes"]');
                const sync = () => {
                    const n = boxes().filter(b => b.checked).length;
                    saveBtn.disabled = n === 0;
                    saveBtn.textContent = `Log ${n} dose${n === 1 ? '' : 's'}`;
                };
                modal.addEventListener('change', e => { if (e.target.dataset.cu != null) sync(); });
                modal.addEventListener('click', e => {
                    const all = e.target.closest('[data-cu-all]');
                    if (!all) return;
                    e.preventDefault();
                    const day = all.closest('.cu-day');
                    const rows = Array.from(day.querySelectorAll('[data-cu]'));
                    const turnOn = rows.some(r => !r.checked);
                    rows.forEach(r => { r.checked = turnOn; });
                    sync();
                });
                modal.querySelector('[data-act="no"]').addEventListener('click', close);
                saveBtn.addEventListener('click', () => {
                    const chosen = boxes().filter(b => b.checked);
                    if (!chosen.length) return;
                    const fallback = med.preferredNextDose != null ? med.preferredNextDose
                        : (S.medDoses(med.id)[0] || {}).dose;
                    Store().update(s => {
                        chosen.forEach(b => {
                            const ts = Number(b.dataset.cu);
                            const dose = b.dataset.cuDose !== '' ? Number(b.dataset.cuDose) : fallback;
                            if (!(dose > 0)) return;
                            const dt = new Date(ts);
                            s.shots.push({
                                id: uid('entry'),
                                medId: med.id,
                                dose,
                                timestamp: ts,
                                date: D.ymd(dt),
                                time: nowHmFrom(dt),
                                location: null,
                                penId: null,
                                // NOT `estimated` — the user confirmed each of these by
                                // hand. `estimated` marks machine guesses, and "Remove
                                // estimated" would delete these along with them.
                            });
                        });
                    });
                    toast(`${chosen.length} dose${chosen.length === 1 ? '' : 's'} logged`);
                    close();
                    if (onDone) onDone();
                });
            },
        });
    }

    /** 'HH:MM' for a Date, zero-padded. */
    function nowHmFrom(dt) {
        return String(dt.getHours()).padStart(2, '0') + ':' + String(dt.getMinutes()).padStart(2, '0');
    }

    // Each file adds to the shared namespace rather than replacing it, so app.js can
    // keep one reference and the load order below stops mattering.
    Object.assign(window.Modals = window.Modals || {}, { logDose, logSheet, logWeight, backfill, catchUp });
})();
