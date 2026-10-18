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
    // Add containers to supply
    // ------------------------------------------------
    function addContainers(medOverride) {
        const S = Store();
        const med = medOverride || S.activeMed();
        if (!med) return;
        const doseLog = S.medDoses(med.id);
        // pill-type meds: packs come in ONE tablet strength — default to what
        // they already stock (or the smallest strength), never a slot TOTAL
        // like 10mg-meaning-2×5mg
        const flexible = med.type && med.type !== 'injection';
        const ownedStrengths = [...new Set(S.medContainers(med.id).map(p => p.dose))];
        let dose = flexible
            ? (ownedStrengths.length === 1 ? ownedStrengths[0] : Math.min.apply(null, med.doses))
            : (med.preferredNextDose != null ? med.preferredNextDose : (doseLog[0] ? doseLog[0].dose : med.doses[0]));
        const pkgContainers = med.pensPerPackage || 1;

        openModal({
            title: 'Add to supply',
            sub: `One package of ${med.name} = ${pkgContainers} ${D.containerName(med)}${pkgContainers === 1 ? '' : 's'} × ${med.penCapacity} ${med.type === 'pill' ? 'tablet' : 'dose'}${med.penCapacity === 1 ? '' : 's'}.`,
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
                        <div class="field nomb"><label>${(() => { const w = D.containerPlural(med, 2); return w.charAt(0).toUpperCase() + w.slice(1); })()} in this package</label><input type="number" min="1" id="containerCount" value="${pkgContainers}"></div>
                        <div class="field nomb"><label>${med.type === 'pill' ? 'Tablets' : 'Doses'} per ${D.containerName(med)}</label><input type="number" min="1" id="containerCap" value="${med.penCapacity}"></div>
                    </div>
                </div>
                <div class="container-hint" id="penSummary"></div>`,
            footHtml: `
                <button class="btn ghost" data-act="cancel">Cancel</button>
                <button class="btn primary" data-act="save">${Icons.plus} Add to supply</button>`,
            onMount(modal, close) {
                const summary = modal.querySelector('#penSummary');
                const refresh = () => {
                    const count = parseInt(modal.querySelector('#containerCount').value) || 1;
                    const cap = parseInt(modal.querySelector('#containerCap').value) || 1;
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
                modal.querySelector('#containerCount').addEventListener('input', refresh);
                modal.querySelector('#containerCap').addEventListener('input', refresh);
                modal.querySelector('[data-act="cancel"]').addEventListener('click', close);
                modal.querySelector('[data-act="save"]').addEventListener('click', () => {
                    const count = parseInt(modal.querySelector('#containerCount').value) || 1;
                    const cap = parseInt(modal.querySelector('#containerCap').value) || 1;
                    const note = modal.querySelector('#penNote').value.trim();
                    const acquired = modal.querySelector('#penAcquired').value || null;
                    Store().update(s => {
                        for (let i = 0; i < count; i++) {
                            s.pens.push({
                                id: uid('container'), medId: med.id, dose, capacity: cap, used: 0,
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
        const derived = S.medContainers(med.id).find(p => p.id === penId) || raw;
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
                <div class="container-hint">Retired ${D.containerPlural(med, 2)} stop being suggested for new doses. "Used" corrections stick even as more doses get logged.</div>`,
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
    /**
     * The substance link on a med.
     *
     * Optional, and deliberately so: a med with no substance keeps the legacy
     * single-exponential model and loses nothing. Linking one is what buys the
     * Bateman curve, the combined-substance view and the therapeutic window.
     *
     * Only ONE ingredient is editable here. Multi-ingredient products (Panadeine
     * Forte) are a stage-5 concern and the data model already carries them — the
     * editor just does not offer a way to build one yet, which is better than
     * offering a half-working one.
     */
    function substanceFieldHtml(m) {
        const all = Store().allSubstances();
        const ing = (m && m.ingredients && m.ingredients[0]) || null;
        const curr = ing ? ing.substanceId : '';
        const currSub = curr ? all.find(x => x.id === curr) : null;
        const currForms = currSub ? window.Substances.saltFormsFor(currSub.id) : {};
        const hasForms = Object.keys(currForms).length > 0;
        const group = (label, list) => list.length
            ? `<optgroup label="${label}">${list.map(x =>
                `<option value="${escapeHtml(x.id)}"${curr === x.id ? ' selected' : ''}>${escapeHtml(x.name)}</option>`).join('')}</optgroup>`
            : '';
        const mine = all.filter(x => x.custom);
        const curated = all.filter(x => !x.custom);
        return `<div class="field">
            <label>What it contains <span class="dim-sm">— optional; links this product to the
                pharmacology, so it can be added up with anything else that delivers the same
                molecule</span></label>
            <div class="freq-row">
                <select id="cmSubstance">
                    <option value=""${curr ? '' : ' selected'}>— not linked —</option>
                    ${group('Yours', mine)}
                    ${group('Curated', curated)}
                    <option value="__new">+ Add a substance…</option>
                </select>
                <input type="number" min="0" step="any" id="cmSubPer"
                    value="${ing && ing.mgPerDoseUnit != null ? ing.mgPerDoseUnit : 1}"
                    title="mg of the substance per unit of dose. 1 when the dose is already in mg of it; 500 for a 500 mg tablet counted as tablets.">
            </div>
            <div id="cmSubSaltRow" style="${hasForms ? '' : 'display:none'}">
                <div class="dim-sm" style="margin-top:8px">Salt form
                    <select id="cmSubSalt">${(() => {
                        const forms = currForms;
                        return ['<option value="">— none / free base —</option>'].concat(
                            Object.keys(forms).map(k => `<option value="${escapeHtml(k)}"${
                                ing && ing.salt === k ? ' selected' : ''}>${escapeHtml(k.replace(/-/g, ' '))} (x${forms[k]})</option>`)).join('');
                    })()}</select>
                    — what is on the box is the salt; the chart needs the base
                </div>
            </div>
        </div>`;
    }

    /**
     * Create a user substance. Everything is optional except a name, because a
     * half-known substance is still worth recording — it just will not draw a curve
     * until it has a half-life and a time to peak, and the form says so rather than
     * filling the gaps in.
     */
    function addSubstance(onSaved) {
        openModal({
            title: 'Add a substance',
            sub: 'Yours alone. It syncs with your account and is never shared.',
            bodyHtml: `
                <div class="field"><label>Name</label>
                    <input id="nsName" placeholder="e.g. Pregabalin"></div>
                <div class="field-row">
                    <div class="field nomb"><label>Half-life (hours)</label>
                        <input type="number" min="0" step="any" id="nsHl" placeholder="leave blank if unknown"></div>
                    <div class="field nomb"><label>Peaks after (hours)</label>
                        <input type="number" min="0" step="any" id="nsTmax" placeholder="optional"></div>
                </div>
                <div class="field-row">
                    <div class="field nomb"><label>Works for (hours)</label>
                        <input type="number" min="0" step="any" id="nsDur" placeholder="optional"></div>
                    <div class="field nomb"><label>Also sold as</label>
                        <input id="nsAka" placeholder="brand names, comma separated"></div>
                </div>
                <div class="field"><label>Where these numbers came from</label>
                    <input id="nsSource" placeholder="a label, a leaflet, your prescriber…"></div>
                <div class="note">
                    Anything you add here is marked as <strong>yours</strong> and never as sourced,
                    so it stays visibly different from the built-in figures. Leave a box blank rather
                    than guessing: a missing half-life hides the curve, and a wrong one draws a
                    confident line that is not true.
                </div>`,
            footHtml: `<button class="btn" data-act="cancel">Cancel</button>
                <button class="btn primary" data-act="save">Add substance</button>`,
            onMount(modal, close) {
                modal.querySelector('[data-act="cancel"]').addEventListener('click', close);
                modal.querySelector('[data-act="save"]').addEventListener('click', () => {
                    const name = modal.querySelector('#nsName').value.trim();
                    if (!name) { window.UI.toast('Give it a name first'); return; }
                    const num = id => {
                        const v = parseFloat(modal.querySelector(id).value);
                        return isFinite(v) && v > 0 ? v : undefined;
                    };
                    const src = modal.querySelector('#nsSource').value.trim();
                    const aka = modal.querySelector('#nsAka').value.split(',')
                        .map(x => x.trim()).filter(Boolean);
                    const id = Store().saveSubstance({
                        name,
                        halfLifeH: num('#nsHl'),
                        tmaxH: num('#nsTmax'),
                        durationH: num('#nsDur'),
                        aka: aka.length ? aka : undefined,
                        note: src ? 'Added by you. Source given: ' + src : 'Added by you, with no source recorded.',
                    });
                    if (!id) {
                        // The one refusal: a name that slugs onto a curated id.
                        window.UI.toast('There is already a built-in substance with that name');
                        return;
                    }
                    close();
                    if (onSaved) onSaved(id);
                });
            },
        });
    }

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
        /**
         * The anchor picker on a schedule row. Optional by design — "" is a plain clock
         * time, which is what most slots are and must stay the zero-effort default.
         * Defined once so the two places that build a time row (initial render and
         * "+ add time") cannot drift apart.
         */
        const anchorSelectHtml = (selected) => `<select data-schedanchor title="Name this time, e.g. before bed">
            <option value=""${!selected ? ' selected' : ''}>—</option>
            ${D.SCHEDULE_ANCHORS.map(a => `<option value="${a.id}"${selected === a.id ? ' selected' : ''}>${a.label}</option>`).join('')}
        </select>`;

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

        // Four groups instead of one long scroll: what it is, when it is taken, how it
        // is supplied, and the pharmacology and chart details most people never need,
        // which start folded away. Every field keeps its id, so nothing that reads the
        // form changes.
        const customFormHtml = m => `
            <div class="form-group"><div class="fg-title">Basics</div>
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
                    <select id="cmUnit">${(() => {
                        // The med's own unit is always offered, so an edit can never
                        // silently turn a tablet med into an mg one.
                        const units = ['mg', 'mcg', 'IU', 'units', 'ml', 'tablet'];
                        if (m && m.unit && units.indexOf(m.unit) === -1) units.push(m.unit);
                        return units.map(u => `<option ${m && m.unit === u ? 'selected' : ''}>${escapeHtml(u)}</option>`).join('');
                    })()}</select></div>
            </div>
            <div class="field-row">
                <div class="field nomb"><label>Colour</label><input type="color" id="cmColor" value="${m ? m.color || '#5fc8c8' : '#5fc8c8'}" class="color-input"></div>
                <div class="field nomb"><label>Category (for grouping)</label>
                    <select id="cmCategory">${D.CATEGORY_ORDER.map(c => `<option ${((m && m.category) || 'Other') === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
            </div>
            </div>
            <div class="form-group"><div class="fg-title">Schedule</div>
            <div class="field-row">
                ${durRow('cmFreq', 'How often — e.g. 3 × per day, 12 hours, 1 week', m ? m.frequency : 7, 7, '', true)}
            </div>
            <div class="field prn-field">
                <label class="check-line">
                    <input type="checkbox" id="cmPRN" ${m && D.isPRN(m) ? 'checked' : ''}>
                    <span>Take only when needed (PRN)</span>
                </label>
                <div class="dim-sm prn-note">No schedule, no reminders, and never overdue. Doses are still
                    logged and charted exactly the same.</div>
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
                            return `<span class="time-item"><input type="time" value="${sl.time}" data-schedtime>${anchorSelectHtml(sl.anchor)}<input type="number" min="1" step="1" value="${b.count}" data-schedcount title="How many at once — 2 × 5mg = a 10mg dose"><span class="dim-sm">×</span><input type="number" min="0" step="any" value="${b.per != null ? b.per : ''}" data-scheddose placeholder="dose" title="Strength of each (blank = usual)"><button type="button" class="icon-btn xs" data-deltime title="Remove">✕</button></span>`;
                        }).join('');
                    })()}
                    <button type="button" class="btn small" id="cmAddTime">+ add time</button>
                </div>
            </div>
            <div class="field-row">
                ${durRow('cmLateOk', 'Late dose still OK within (0 = always skip)', m && m.missedDose ? m.missedDose.takeWithinDays : null, '', '0')}
                ${durRow('cmMinGap', 'Min gap between doses', m && m.missedDose ? m.missedDose.minGapDays : null, '', 'e.g. 3')}
            </div>
            </div>
            <div class="form-group"><div class="fg-title">Supply</div>
            <div class="field-row" id="cmPenRow">
                <div class="field nomb"><label>Doses per container (container, pack, bottle…)</label><input type="number" id="cmCap" value="${m ? m.penCapacity : 4}"></div>
                <div class="field nomb"><label>Containers per package</label><input type="number" id="cmPkg" value="${m ? m.pensPerPackage || 1 : 1}"></div>
            </div>
            </div>
            <details class="form-group fg-advanced">
                <summary class="fg-title">Advanced <span class="dim-sm">— half-life, what it contains, chart</span></summary>
            <div class="field-row">
                ${durRow('cmHl', 'Half-life (leave empty if unknown)', m ? m.halfLife : null, '', 'unknown')}
                ${durRow('cmTtp', 'Time to peak (optional)', m && m.timeToPeak ? m.timeToPeak : null, '', '0')}
            </div>
            ${substanceFieldHtml(m)}
            <div class="field">
                <label>Chart y-step (blank = auto)</label>
                <input type="number" step="0.1" min="0" id="cmGraphStep" value="${m && m.graphStep ? m.graphStep : ''}" placeholder="e.g. 2">
            </div>
            <div class="field">
                <label>Per-dose half-life override <button class="link" id="cmAdvToggle">${m && m.dose2halfLife ? 'hide' : 'show'}</button></label>
                <div id="cmDoseHl" style="display:${m && m.dose2halfLife ? '' : 'none'}"></div>
            </div>            </details>`;

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
                        // Brands live in `aka`, so searching "Elvanse" has to
                        // find a preset called "Vyvanse". Without this line the drug
                        // would be unfindable by the name on its box.
                        || (p.aka || []).some(a => a.toLowerCase().includes(q))
                        || (p.category || '').toLowerCase().includes(q));
                    const card = p => `<button class="preset ${preset && preset.presetId === p.presetId ? 'active' : ''} ${existing.has(p.presetId) ? 'dim' : ''}" data-preset="${p.presetId}">
                            <div class="p-name">${p.name}<span class="p-type">${p.type}</span></div>
                            <div class="p-meta">${p.generic} · ${p.doses.length} doses · ${D.fmtFreq(p.frequency)}${existing.has(p.presetId) ? ' · added' : ''}</div>
                            ${(p.aka || []).length ? `<div class="p-aka dim-sm">also sold as ${escapeHtml(p.aka[0])}</div>` : ''}
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
                        <div class="container-hint col preset-details">
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
                        ? '<div class="container-hint">Enter doses first.</div>'
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
                        // Built from the same helper as the rendered rows — a second
                        // hand-written copy of this markup is how a new row would quietly
                        // end up without an anchor picker.
                        span.innerHTML = '<input type="time" data-schedtime>' + anchorSelectHtml('')
                            + '<input type="number" min="1" step="1" value="1" data-schedcount title="How many at once — 2 × 5mg = a 10mg dose"><span class="dim-sm">×</span><input type="number" min="0" step="any" data-scheddose placeholder="dose" title="Strength of each (blank = usual)"><button type="button" class="icon-btn xs" data-deltime title="Remove">✕</button>';
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
                // The substance select does two things: "+ Add a substance…" opens
                // the creator and then selects what it made, and choosing a substance
                // shows or hides the salt row — which only exists for the handful that
                // are dispensed as one.
                customWrap.addEventListener('change', e => {
                    if (e.target.id !== 'cmSubstance') return;
                    const sel = e.target;
                    if (sel.value === '__new') {
                        sel.value = sel.dataset.prev || '';
                        addSubstance(newId => {
                            const fresh = customWrap.querySelector('#cmSubstance');
                            if (!fresh) return;
                            const all = Store().allSubstances();
                            const made = all.find(x => x.id === newId);
                            if (!made) return;
                            const opt = document.createElement('option');
                            opt.value = made.id; opt.textContent = made.name;
                            sel.insertBefore(opt, sel.querySelector('option[value="__new"]'));
                            sel.value = made.id;
                            sel.dispatchEvent(new Event('change', { bubbles: true }));
                        });
                        return;
                    }
                    sel.dataset.prev = sel.value;
                    const sub = Store().allSubstances().find(x => x.id === sel.value);
                    const row = customWrap.querySelector('#cmSubSaltRow');
                    const saltSel = customWrap.querySelector('#cmSubSalt');
                    const forms = sub ? window.Substances.saltFormsFor(sub.id) : {};
                    const any = Object.keys(forms).length > 0;
                    if (row) row.style.display = any ? '' : 'none';
                    if (saltSel && any) {
                        saltSel.innerHTML = ['<option value="">— none / free base —</option>'].concat(
                            Object.keys(forms).map(k => `<option value="${escapeHtml(k)}"${
                                sub.defaultSalt === k ? ' selected' : ''}>${escapeHtml(k.replace(/-/g, ' '))} (x${forms[k]})</option>`)
                        ).join('');
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
                // "How often" and "take when needed" contradict each other, so only one of
                // them can be live at a time. Leaving the interval editable while PRN is
                // ticked reads as though it still applies — it does not, and the saved
                // value would be discarded, which is worse than it being greyed out.
                const syncPrn = () => {
                    const box = customWrap.querySelector('#cmPRN');
                    if (!box) return;
                    const on = box.checked;
                    ['cmFreq', 'cmFreqUnit'].forEach(id => {
                        const el = customWrap.querySelector('#' + id);
                        if (el) el.disabled = on;
                    });
                    const row = customWrap.querySelector('#cmFreq');
                    const field = row && row.closest('.field');
                    if (field) field.classList.toggle('is-disabled', on);
                };
                syncPrn();

                customWrap.addEventListener('change', e => {
                    // switching the half-life unit re-labels the per-dose grid
                    if (e.target.id === 'cmHlUnit') {
                        const doseHlWrap = customWrap.querySelector('#cmDoseHl');
                        if (doseHlWrap && doseHlWrap.style.display !== 'none') renderDoseHl();
                    }
                    if (e.target.id === 'cmPRN') syncPrn();
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
                    const subSel = modal.querySelector('#cmSubstance');
                    const subId = subSel && subSel.value && subSel.value !== '__new' ? subSel.value : '';
                    const subPer = parseFloat((modal.querySelector('#cmSubPer') || {}).value);
                    const subSalt = (modal.querySelector('#cmSubSalt') || {}).value || undefined;
                    const medPayload = {
                        name,
                        generic: modal.querySelector('#cmGeneric').value.trim(),
                        type: cmType,
                        doses,
                        // null (not 0, not a sentinel) means PRN — see D.isPRN.
                        frequency: (modal.querySelector('#cmPRN') || {}).checked
                            ? null : (durDays('cmFreq') || 7),
                        // Empty means unknown, and unknown draws no curve. A
                        // made-up 5 days here would give such a med a fictional one,
                        // and outvote the half-life of the substance it is linked to.
                        halfLife: durDays('cmHl'),
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
                            const anchorEl = item.querySelector('[data-schedanchor]');
                            const anchor = anchorEl && anchorEl.value ? anchorEl.value : null;
                            // stored dose = the TOTAL taken at that time; count/per
                            // remember exactly how the user typed it (2 × 5mg)
                            const total = (!isNaN(per) && per > 0) ? Math.round(per * count * 1000) / 1000 : null;
                            // The time still has to be valid — the anchor is a label ON a
                            // time, never a replacement for one, so this validator is
                            // deliberately unchanged.
                            return /^\d{1,2}:\d{2}$/.test(time)
                                ? { time, dose: total, count: total != null ? count : null, per: total != null ? per : null,
                                    ...(anchor ? { anchor } : {}) }
                                : null;
                        }).filter(Boolean),
                        graphStep: parseFloat(modal.querySelector('#cmGraphStep').value) || null,
                    };
                    medPayload.scheduleTime = (medPayload.scheduleTimes[0] && medPayload.scheduleTimes[0].time) || 'auto';
                    if (customBase && customBase.presetId) medPayload.presetId = customBase.presetId;
                    // An explicit choice — including explicitly NONE — is the
                    // user's, and is marked as such so upgradeMedFromPreset never
                    // quietly puts the preset's ingredients back (and so preset
                    // reconciliation never offers to overwrite it).
                    // Only the FIRST ingredient is on the form, so the rest of a
                    // combination product (Panadeine Forte's codeine) is carried over
                    // untouched. Rebuilding the list from the one field deleted it.
                    if (subId) {
                        const rest = (customBase && Array.isArray(customBase.ingredients))
                            ? customBase.ingredients.slice(1) : [];
                        medPayload.ingredients = [Object.assign({},
                            (customBase && customBase.ingredients && customBase.ingredients[0]) || {}, {
                                substanceId: subId,
                                mgPerDoseUnit: subPer > 0 ? subPer : 1,
                            })].concat(rest);
                        if (subSalt) medPayload.ingredients[0].salt = subSalt;
                        else delete medPayload.ingredients[0].salt;
                    } else {
                        medPayload.ingredients = null;
                    }
                    // 2+ usual times a day only make sense with a multi-daily
                    // frequency — derive it so the slot schedule actually applies
                    // …but never for a PRN med. `null >= 0.95` is already false so this
                    // happens to be safe, but only by coercion — spelling it out so a
                    // later edit cannot quietly give an as-needed med an interval again.
                    if (!D.isPRN(medPayload)
                        && medPayload.scheduleTimes.length >= 2 && medPayload.frequency >= 0.95) {
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
                    // Provenance follows what the user actually changed. A field edited
                    // here is theirs from now on; one left alone keeps its provenance,
                    // so a curated number still gets corrections. Marking everything
                    // 'user' froze curated values; marking nothing let the next load
                    // revert an edit back to the preset (presetDiff's auto rows).
                    // Durations round-trip through rounded display units, so a number
                    // within 0.1% of the original is the original, kept exactly.
                    if (customBase) {
                        const prov = Object.assign({}, customBase._prov || {});
                        const same = (a, b) => {
                            if (typeof a === 'number' && typeof b === 'number')
                                return Math.abs(a - b) <= 1e-3 * Math.max(Math.abs(a), Math.abs(b));
                            return JSON.stringify(a == null ? null : a) === JSON.stringify(b == null ? null : b);
                        };
                        Store().PROVENANCE_FIELDS.forEach(k => {
                            if (!(k in medPayload)) return;
                            if (same(medPayload[k], customBase[k])) medPayload[k] = customBase[k];
                            else prov[k] = 'user';
                        });
                        medPayload._prov = prov;
                    } else {
                        medPayload._prov = { ingredients: 'user' };
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
    Object.assign(window.Modals = window.Modals || {}, { addContainers, editPen, addMed });
})();
