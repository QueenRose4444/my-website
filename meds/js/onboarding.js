// ================================================
// onboarding.js — first-run wizard
// welcome → import old data → pick med → backfill
// history estimate → weight setup → done
// ================================================
(function () {
    'use strict';
    const D = window.MedData;
    const { Icons, escapeHtml, toast } = window.UI;

    let overlay = null;

    function maybeStart() {
        const S = window.Store;
        if (S.state.settings.onboardedAt) return false;
        if (S.hasData()) return false;
        start(false);
        return true;
    }

    function start(isReplay) {
        if (overlay) overlay.remove();
        const S = window.Store;
        const v1Local = S.detectV1Local();

        const ctx = {
            name: S.state.user.name || '',
            importChoice: null,      // 'v1-local' | 'file' | 'fresh'
            importedFile: null,      // parsed backup
            preset: null,
            customLater: false,
            historyMode: null,       // 'new' | 'estimate' | 'skip'
            trackWeight: true,
            currentW: '', startW: '', startWDate: '', goalW: '', maintain: false,
            unit: S.state.settings.weightUnit || 'kg',
        };

        let stepIndex = 0;

        const steps = () => {
            const list = ['welcome'];
            list.push('import');
            if (ctx.importChoice !== 'v1-local' && ctx.importChoice !== 'file') list.push('med');
            if (ctx.importChoice === 'fresh' && ctx.preset) list.push('history');
            list.push('weight');
            return list;
        };

        function render() {
            const stepList = steps();
            if (stepIndex >= stepList.length) { finish(); return; }
            const step = stepList[stepIndex];
            const total = stepList.length;

            let title = '', sub = '', body = '', canNext = true, nextLabel = 'Continue';

            if (step === 'welcome') {
                title = 'Welcome';
                sub = 'Track doses, weight, supply and levels — all in one place.';
                body = `
                    <div class="field">
                        <label>What should we call you? (optional)</label>
                        <input id="obName" value="${escapeHtml(ctx.name)}" placeholder="Your name or nickname" autocomplete="nickname">
                    </div>
                    ${v1Local ? `<div class="pen-hint">${Icons.refresh} We found <strong>${v1Local.shotHistory.length} doses</strong> and <strong>${v1Local.weightHistory.length} weights</strong> from the old meds page on this device — you can import them in the next step.</div>` : ''}`;
            }

            if (step === 'import') {
                title = 'Bring your data with you';
                sub = 'Import from the old meds page, a backup file, or start fresh.';
                const opt = (key, label, desc, disabled) => `
                    <button class="preset ${ctx.importChoice === key ? 'active' : ''}" data-import="${key}" ${disabled ? 'disabled' : ''}>
                        <div class="p-name">${label}</div>
                        <div class="p-meta">${desc}</div>
                    </button>`;
                // show the date range of the browser copy so stale data is obvious
                let v1Desc = '';
                if (v1Local) {
                    const stamps = v1Local.shotHistory.concat(v1Local.weightHistory)
                        .map(x => new Date(x.dateTime).getTime()).filter(t => !isNaN(t));
                    const newest = stamps.length ? Math.max.apply(null, stamps) : null;
                    const stale = newest && (Date.now() - newest) > 30 * 86400000;
                    v1Desc = `${v1Local.shotHistory.length} doses · ${v1Local.weightHistory.length} weights · last entry ${newest ? D.fmtDateShort(newest) + ' ' + new Date(newest).getFullYear() : '?'}`
                        + (stale ? ' — looks old! If you have a newer backup export, use the file option instead' : '');
                }
                body = `
                    <div class="preset-grid one-col">
                        ${v1Local ? opt('v1-local', 'Import this browser’s copy of the old meds page', v1Desc) : ''}
                        ${opt('file', 'Import a backup file (recommended)', 'JSON export from the old or new site — always your freshest data')}
                        ${opt('fresh', 'Start fresh', 'Set everything up from scratch')}
                    </div>
                    <div class="field" id="obFileWrap" style="display:${ctx.importChoice === 'file' ? '' : 'none'};margin-top:10px">
                        <label>Backup file</label>
                        <input type="file" id="obFile" accept=".json,application/json" class="file-input">
                        <div id="obFileInfo"></div>
                    </div>`;
                canNext = !!ctx.importChoice && (ctx.importChoice !== 'file' || !!ctx.importedFile);
            }

            if (step === 'med') {
                title = 'Pick your medication';
                sub = 'You can add more later, or set up a custom one.';
                body = `
                    <div class="preset-grid">
                        ${D.MED_PRESETS.map(p => `
                            <button class="preset ${ctx.preset && ctx.preset.presetId === p.presetId ? 'active' : ''}" data-preset="${p.presetId}">
                                <div class="p-name">${p.name}<span class="p-type">${p.type}</span></div>
                                <div class="p-meta">${p.generic} · every ${p.frequency < 1 ? '<1' : p.frequency}d</div>
                            </button>`).join('')}
                    </div>
                    <button class="link no-ml" id="obCustomLater">${ctx.customLater ? '✓ ' : ''}I'll set up a custom med after</button>`;
                canNext = !!ctx.preset || ctx.customLater;
            }

            if (step === 'history') {
                const medName = ctx.preset ? ctx.preset.name : 'it';
                title = `Already taking ${medName}?`;
                sub = 'If you have been for a while, we can estimate your past doses so your graphs and current med level start out right.';
                const opt = (key, label, desc) => `
                    <button class="preset ${ctx.historyMode === key ? 'active' : ''}" data-history="${key}">
                        <div class="p-name">${label}</div>
                        <div class="p-meta">${desc}</div>
                    </button>`;
                body = `
                    <div class="preset-grid one-col">
                        ${opt('new', 'No — just starting', 'First dose will be your first log')}
                        ${opt('estimate', 'Yes — estimate my history', 'We’ll guesstimate past doses from a standard schedule (you can fine-tune each step)')}
                        ${opt('skip', 'Yes — but skip the estimate', 'Start tracking from today only')}
                    </div>`;
                canNext = !!ctx.historyMode;
            }

            if (step === 'weight') {
                title = 'Track weight too?';
                sub = 'Optional — adds the weight chart, goal progress and stats.';
                // pre-fill from imported data so the wizard matches what the
                // page will show afterwards
                if (!ctx.prefillDone) {
                    const info = importedWeightInfo();
                    if (info) {
                        if (info.unit && ['kg', 'lbs', 'st-lbs'].includes(info.unit)) ctx.unit = info.unit;
                        const disp = kg => kg != null && !isNaN(kg) ? D.weightValue(kg, ctx.unit).toFixed(1) : '';
                        if (!ctx.currentW) ctx.currentW = disp(info.currentKg);
                        if (!ctx.startW) ctx.startW = disp(info.startKg);
                        if (!ctx.startWDate) ctx.startWDate = info.startDate || '';
                        if (!ctx.goalW) ctx.goalW = disp(info.goalKg);
                        ctx.prefill = info;
                    }
                    ctx.prefillDone = true;
                }
                const u = ctx.unit;
                body = `
                    ${ctx.prefill ? `<div class="pen-hint" style="margin-bottom:14px">${Icons.check} Pre-filled from your imported data — tweak anything that looks off.</div>` : ''}
                    <div class="chip-grp" style="margin-bottom:14px" id="obTrackW">
                        <button class="chip ${ctx.trackWeight ? 'active' : ''}" data-tw="yes">Yes, track weight</button>
                        <button class="chip ${!ctx.trackWeight ? 'active' : ''}" data-tw="no">Not for me</button>
                    </div>
                    <div id="obWFields" style="display:${ctx.trackWeight ? '' : 'none'}">
                        <div class="chip-grp" style="margin-bottom:14px" id="obUnit">
                            ${['kg', 'lbs', 'st-lbs'].map(x => `<button class="chip ${u === x ? 'active' : ''}" data-unit="${x}">${x === 'st-lbs' ? 'st & lbs' : x}</button>`).join('')}
                        </div>
                        <div class="field"><label>Current weight (${u === 'st-lbs' ? 'decimal stone' : u})</label>
                            <input type="number" step="0.1" id="obCurW" value="${ctx.currentW}" inputmode="decimal"></div>
                        <div class="field-row">
                            <div class="field nomb"><label>Starting weight (optional)</label>
                                <input type="number" step="0.1" id="obStartW" value="${ctx.startW}" inputmode="decimal"></div>
                            <div class="field nomb"><label>…measured on</label>
                                <input type="date" id="obStartWDate" value="${ctx.startWDate}"></div>
                        </div>
                        <div class="field"><label>Goal weight (optional)</label>
                            <input type="number" step="0.1" id="obGoalW" value="${ctx.goalW}" ${ctx.maintain ? 'disabled' : ''} inputmode="decimal"></div>
                        <button class="link no-ml" id="obMaintain">${ctx.maintain ? '✓ ' : ''}No goal — maintaining my weight</button>
                    </div>`;
                nextLabel = 'Get started';
            }

            overlay.innerHTML = `
                <div class="onb">
                    <div class="onb-prog">${stepList.map((_, i) => `<div class="${i <= stepIndex ? 'done' : ''}"></div>`).join('')}</div>
                    <div class="onb-step">Step ${stepIndex + 1} of ${total}</div>
                    <h1>${title}</h1>
                    <p>${sub}</p>
                    ${body}
                    <div class="onb-foot">
                        <button class="btn ghost" id="obBack">${stepIndex === 0 ? 'Skip setup' : 'Back'}</button>
                        <button class="btn primary" id="obNext" ${canNext ? '' : 'disabled'}>${nextLabel}</button>
                    </div>
                </div>`;

            // ---- bindings ----
            const next = overlay.querySelector('#obNext');
            overlay.querySelector('#obBack').addEventListener('click', () => {
                if (stepIndex === 0) { skip(); return; }
                stepIndex--; render();
            });
            next.addEventListener('click', () => {
                if (step === 'welcome') ctx.name = overlay.querySelector('#obName').value.trim();
                if (step === 'weight') {
                    ctx.currentW = overlay.querySelector('#obCurW') ? overlay.querySelector('#obCurW').value : '';
                    ctx.startW = overlay.querySelector('#obStartW') ? overlay.querySelector('#obStartW').value : '';
                    ctx.startWDate = overlay.querySelector('#obStartWDate') ? overlay.querySelector('#obStartWDate').value : '';
                    ctx.goalW = overlay.querySelector('#obGoalW') ? overlay.querySelector('#obGoalW').value : '';
                }
                stepIndex++;
                render();
            });

            if (step === 'import') {
                overlay.querySelectorAll('[data-import]').forEach(b => b.addEventListener('click', () => {
                    ctx.importChoice = b.dataset.import;
                    render();
                }));
                const fileInp = overlay.querySelector('#obFile');
                if (fileInp) fileInp.addEventListener('change', e => {
                    const f = e.target.files && e.target.files[0];
                    if (!f) return;
                    const r = new FileReader();
                    r.onload = ev => {
                        try {
                            ctx.importedFile = window.Store.parseBackup(ev.target.result);
                            const c = ctx.importedFile.kind === 'v2'
                                ? { s: ctx.importedFile.state.shots.length, w: ctx.importedFile.state.weights.length }
                                : { s: ctx.importedFile.payload.shotHistory.length, w: ctx.importedFile.payload.weightHistory.length };
                            overlay.querySelector('#obFileInfo').innerHTML = `<div class="pen-hint">${Icons.check} ${c.s} doses · ${c.w} weights ready to import</div>`;
                            overlay.querySelector('#obNext').disabled = false;
                        } catch (err) {
                            ctx.importedFile = null;
                            overlay.querySelector('#obFileInfo').innerHTML = `<div class="pen-hint warn">${Icons.alert} ${escapeHtml(err.message)}</div>`;
                        }
                    };
                    r.readAsText(f);
                });
            }

            if (step === 'med') {
                overlay.querySelectorAll('[data-preset]').forEach(b => b.addEventListener('click', () => {
                    ctx.preset = D.MED_PRESETS.find(p => p.presetId === b.dataset.preset);
                    ctx.customLater = false;
                    render();
                }));
                overlay.querySelector('#obCustomLater').addEventListener('click', () => {
                    ctx.customLater = !ctx.customLater;
                    if (ctx.customLater) ctx.preset = null;
                    render();
                });
            }

            if (step === 'history') {
                overlay.querySelectorAll('[data-history]').forEach(b => b.addEventListener('click', () => {
                    ctx.historyMode = b.dataset.history;
                    render();
                }));
            }

            if (step === 'weight') {
                const captureTyped = () => {
                    const g = id => overlay.querySelector(id);
                    if (g('#obCurW')) ctx.currentW = g('#obCurW').value;
                    if (g('#obStartW')) ctx.startW = g('#obStartW').value;
                    if (g('#obStartWDate')) ctx.startWDate = g('#obStartWDate').value;
                    if (g('#obGoalW')) ctx.goalW = g('#obGoalW').value;
                };
                overlay.querySelector('#obTrackW').addEventListener('click', e => {
                    const b = e.target.closest('[data-tw]');
                    if (!b) return;
                    captureTyped();
                    ctx.trackWeight = b.dataset.tw === 'yes';
                    render();
                });
                const unitGrp = overlay.querySelector('#obUnit');
                if (unitGrp) unitGrp.addEventListener('click', e => {
                    const b = e.target.closest('[data-unit]');
                    if (!b) return;
                    ctx.currentW = overlay.querySelector('#obCurW').value;
                    ctx.startW = overlay.querySelector('#obStartW').value;
                    ctx.goalW = overlay.querySelector('#obGoalW').value;
                    ctx.startWDate = overlay.querySelector('#obStartWDate').value;
                    ctx.unit = b.dataset.unit;
                    render();
                });
                const maintainBtn = overlay.querySelector('#obMaintain');
                if (maintainBtn) maintainBtn.addEventListener('click', () => {
                    ctx.goalW = overlay.querySelector('#obGoalW').value;
                    ctx.currentW = overlay.querySelector('#obCurW').value;
                    ctx.startW = overlay.querySelector('#obStartW').value;
                    ctx.startWDate = overlay.querySelector('#obStartWDate').value;
                    ctx.maintain = !ctx.maintain;
                    if (ctx.maintain) ctx.goalW = '';
                    render();
                });
            }
        }

        // goal / start / current weight hiding inside the chosen import source,
        // so the wizard can pre-fill instead of looking like the data is missing
        function importedWeightInfo() {
            let payload = null, v2state = null;
            if (ctx.importChoice === 'v1-local' && v1Local) payload = v1Local;
            else if (ctx.importChoice === 'file' && ctx.importedFile) {
                if (ctx.importedFile.kind === 'v1') payload = ctx.importedFile.payload;
                else v2state = ctx.importedFile.state;
            }
            if (payload) {
                const ws = (payload.weightHistory || []).slice()
                    .filter(x => !isNaN(new Date(x.dateTime)) && !isNaN(parseFloat(x.weightKg)))
                    .sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime));
                const us = payload.userSettings || {};
                return {
                    unit: us.weightUnit === 'lb' ? 'lbs' : (us.weightUnit || null),
                    goalKg: us.goalWeight != null ? parseFloat(us.goalWeight) : null,
                    startKg: ws[0] ? parseFloat(ws[0].weightKg) : null,
                    startDate: ws[0] ? D.ymd(new Date(ws[0].dateTime)) : '',
                    currentKg: ws.length ? parseFloat(ws[ws.length - 1].weightKg) : null,
                };
            }
            if (v2state) {
                const ws = (v2state.weights || []).slice().sort((a, b) => a.timestamp - b.timestamp);
                const st = v2state.settings || {};
                return {
                    unit: st.weightUnit || null,
                    goalKg: st.goalKg != null ? st.goalKg : null,
                    startKg: st.startKg != null ? st.startKg : (ws[0] ? ws[0].kg : null),
                    startDate: ws[0] ? ws[0].date : '',
                    currentKg: ws.length ? ws[ws.length - 1].kg : null,
                };
            }
            return null;
        }

        function toKg(v) {
            const n = parseFloat(v);
            if (isNaN(n)) return null;
            if (ctx.unit === 'lbs') return D.lbsToKg(n);
            if (ctx.unit === 'st-lbs') return n * 14 / 2.20462;
            return n;
        }

        function skip() {
            window.Store.update(s => { s.settings.onboardedAt = Date.now(); });
            overlay.remove(); overlay = null;
        }

        function finish() {
            const S = window.Store;
            let backfillMed = null;

            // imports first
            if (ctx.importChoice === 'v1-local' && v1Local) {
                S.importBackup({ kind: 'v1', payload: v1Local }, 'merge');
                toast('Old site data imported');
            } else if (ctx.importChoice === 'file' && ctx.importedFile) {
                S.importBackup(ctx.importedFile, 'merge');
                toast('Backup imported');
            }

            S.update(s => {
                if (ctx.name) s.user.name = ctx.name;
                s.settings.onboardedAt = Date.now();
                s.settings.weightTrackingEnabled = ctx.trackWeight;
                if (ctx.trackWeight) {
                    s.settings.weightUnit = ctx.unit;
                    const curKg = toKg(ctx.currentW);
                    const startKg = toKg(ctx.startW);
                    const goalKg = ctx.maintain ? null : toKg(ctx.goalW);
                    if (goalKg != null) s.settings.goalKg = Math.round(goalKg * 10) / 10;
                    if (startKg != null) {
                        s.settings.startKg = Math.round(startKg * 10) / 10;
                        // only create a history entry when we know WHEN it was measured —
                        // otherwise it would land on today and corrupt the trend
                        if (ctx.startWDate) {
                            const ts = new Date(ctx.startWDate + 'T08:00').getTime();
                            if (!isNaN(ts) && !s.weights.some(w => w.date === ctx.startWDate)) {
                                s.weights.push({ id: 'w-ob-start-' + ts, date: ctx.startWDate, time: '08:00', timestamp: ts, kg: Math.round(startKg * 10) / 10 });
                            }
                        }
                    }
                    if (curKg != null) {
                        // don't re-log a "today" entry when the value is just the
                        // pre-filled latest weight from the import
                        const unchangedPrefill = ctx.prefill && ctx.prefill.currentKg != null
                            && Math.abs(curKg - ctx.prefill.currentKg) < 0.05;
                        const today = D.ymd(new Date());
                        if (!unchangedPrefill && !s.weights.some(w => w.date === today)) {
                            const ts = Date.now();
                            s.weights.push({ id: 'w-ob-cur-' + ts, date: today, time: D.hm(new Date()), timestamp: ts, kg: Math.round(curKg * 10) / 10 });
                        }
                        if (s.settings.startKg == null) s.settings.startKg = Math.round(curKg * 10) / 10;
                    }
                }
                if (ctx.preset && !s.meds.some(m => m.presetId === ctx.preset.presetId)) {
                    const med = Object.assign({}, ctx.preset, { id: ctx.preset.presetId + '-' + Date.now().toString(36) });
                    s.meds.push(med);
                    s.activeMedId = med.id;
                    if (ctx.historyMode === 'estimate') backfillMed = med;
                }
            });

            overlay.remove(); overlay = null;

            if (backfillMed) {
                window.Modals.backfill(backfillMed);
            } else if (ctx.customLater) {
                window.Modals.addMed();
            }
        }

        overlay = document.createElement('div');
        overlay.className = 'onb-back';
        document.body.appendChild(overlay);
        if (isReplay) {
            // replays shouldn't re-offer imports that would duplicate data
            ctx.importChoice = 'fresh';
        }
        render();
    }

    window.Onboarding = { start, maybeStart };
})();
