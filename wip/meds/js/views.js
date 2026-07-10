// ================================================
// views.js — dashboard, history, calendar, meds pages
// ================================================
(function () {
    'use strict';
    const D = window.MedData;
    const { Icons, escapeHtml } = window.UI;

    // view-local state that survives re-renders
    const local = {
        historyTab: 'shots',
        calMonth: null,   // {y, m}
        expandedMedId: null,
        pickingNextDose: false,
        bannerDismissed: false,
    };

    // ------------------------------------------------
    // derived data for the active med
    // ------------------------------------------------
    function derive() {
        const Store = window.Store;
        const s = Store.state;
        const med = Store.activeMed();
        const shots = med ? Store.medShots(med.id) : [];
        const pens = med ? Store.medPens(med.id) : [];
        const isInjection = med ? (!med.type || med.type === 'injection') : false;
        const supplyMap = med ? D.supplyByDose(pens, med.id) : {};
        const totalSupply = Object.values(supplyMap).reduce((a, b) => a + b, 0);
        const lastShot = shots[0] || null;
        const nextDose = med ? D.predictNextDose(med, shots, s.settings) : null;
        const targetDose = med ? (med.preferredNextDose != null ? med.preferredNextDose : (lastShot ? lastShot.dose : null)) : null;

        const inProgressCandidates = pens.filter(p => p.openedDate && p.used < p.capacity - 0.001 && !p.exhaustedDate);
        const inProgressPen = targetDose != null
            ? (inProgressCandidates.find(p => p.dose === targetDose) || inProgressCandidates[0])
            : inProgressCandidates[0];

        // weight stats
        const weights = Store.sortedWeights();
        const latest = weights[weights.length - 1] || null;
        const startKg = s.settings.startKg != null ? s.settings.startKg : (weights[0] ? weights[0].kg : null);
        const goalKg = s.settings.goalKg;
        const totalLost = latest && startKg != null ? startKg - latest.kg : 0;
        const toGo = latest && goalKg != null ? latest.kg - goalKg : null;
        const progress = (startKg != null && goalKg != null && latest && startKg !== goalKg)
            ? Math.min(100, Math.max(0, ((startKg - latest.kg) / (startKg - goalKg)) * 100)) : 0;

        let lostThisWeek = 0;
        if (weights.length > 1 && latest) {
            const target = latest.timestamp - 7 * 86400000;
            const prev = weights.slice(0, -1).reduce((best, cur) =>
                Math.abs(cur.timestamp - target) < Math.abs(best.timestamp - target) ? cur : best);
            lostThisWeek = prev.kg - latest.kg;
        }
        let avgWeekly = 0;
        if (weights.length > 1 && latest) {
            const first = weights[0];
            const wks = Math.max(1, (latest.timestamp - first.timestamp) / (7 * 86400000));
            avgWeekly = (first.kg - latest.kg) / wks;
        }
        let bmi = null;
        if (s.settings.showBmi && s.settings.userHeight && latest) {
            const hm = s.settings.userHeight / 100;
            if (hm > 0) bmi = latest.kg / (hm * hm);
        }

        return {
            s, med, shots, pens, isInjection, supplyMap, totalSupply, lastShot, nextDose, targetDose,
            inProgressPen, weights, latest, startKg, goalKg, totalLost, toGo, progress, lostThisWeek, avgWeekly, bmi,
        };
    }

    // ------------------------------------------------
    // shared chrome: med switcher + low-supply banner
    // ------------------------------------------------
    function medSwitcherHtml(d, allowAll) {
        const meds = d.s.meds;
        const allMode = allowAll && meds.length > 1 && d.s.settings.dashAll !== false;
        return `<div class="med-switcher">
            ${allowAll && meds.length > 1 ? `
                <button class="med-pill ${allMode ? 'active' : ''}" data-action="dash-all">All meds</button>` : ''}
            ${meds.map(m => `
                <button class="med-pill ${!allMode && m.id === d.s.activeMedId ? 'active' : ''}" data-action="select-med" data-id="${escapeHtml(m.id)}">
                    <span class="pill-swatch" style="background:${escapeHtml(m.color || '#5fc8c8')}"></span>${escapeHtml(m.name)}
                </button>`).join('')}
            <button class="med-pill add" data-action="add-med">${Icons.plus} Add med</button>
        </div>`;
    }

    // ------------------------------------------------
    // All-meds overview — every med's level, next dose,
    // est. peak/low, supply, and a log button in one card
    // ------------------------------------------------
    function overviewCardHtml(d) {
        const Store = window.Store;
        const set = d.s.settings;
        const rows = d.s.meds.map(m => {
            const shots = Store.medShots(m.id);
            const pens = Store.medPens(m.id);
            const nd = D.predictNextDose(m, shots, set);
            const late = nd ? D.lateDoseStatus(m, nd) : null;
            const level = D.medLevelAt(shots, m, Date.now());
            const ext = shots.length ? D.levelExtremes(shots, m, nd ? new Date(nd.date).getTime() : null) : null;
            const supply = D.supplyByDose(pens, m.id);
            const totalSupply = Object.values(supply).reduce((a, b) => a + b, 0);
            const nextTxt = !nd ? '<span class="dim">no doses yet</span>'
                : late ? `<span class="txt-danger">overdue — was ${D.fmtTimeStr(nd.time, set)} ${D.dayLabel(nd.date).toLowerCase()}</span>`
                : `${D.fmtTimeStr(nd.time, set)} <span class="dim-sm">${D.dayLabel(nd.date).toLowerCase()}</span> · ${nd.dose}${escapeHtml(m.unit)}`;
            return `<div class="ov-row">
                <div class="ov-med"><span class="ml-dot" style="background:${escapeHtml(m.color || '#5fc8c8')}"></span>${escapeHtml(m.name)}</div>
                <div class="ov-cell"><span class="k">In system</span><span class="v tabular-mono">${level.toFixed(level >= 100 ? 0 : 2)} ${escapeHtml(m.unit)}</span></div>
                <div class="ov-cell"><span class="k">Next dose</span><span class="v">${nextTxt}</span></div>
                <div class="ov-cell"><span class="k">Peak / low</span><span class="v">${ext
                    ? `${ext.peak.v.toFixed(ext.peak.v >= 100 ? 0 : 1)} @ ${D.fmtTime(ext.peak.ts, set)} · ${ext.low.v.toFixed(ext.low.v >= 100 ? 0 : 1)} @ ${D.fmtTime(ext.low.ts, set)}`
                    : '<span class="dim">—</span>'}</span></div>
                <div class="ov-cell"><span class="k">Supply</span><span class="v ${totalSupply === 0 ? 'txt-danger' : ''}">${totalSupply} dose${totalSupply === 1 ? '' : 's'}</span></div>
                <button class="btn small primary" data-action="log-shot-for" data-id="${escapeHtml(m.id)}">${Icons.plus} Log</button>
            </div>`;
        }).join('');
        return `<div class="card overview-card">
            <div class="card-head"><div class="card-title">All medications — right now</div>
                <span class="pill">${d.s.meds.length} meds</span></div>
            <div class="ov-rows">${rows}</div>
        </div>`;
    }

    function bannerHtml(d) {
        if (local.bannerDismissed || !d.med || d.targetDose == null) return '';
        // count how many of the NEXT dose the supply can actually serve —
        // flexible meds (pills, split-dose pens) can pull from other strengths
        const flexible = d.med.splitDose || (d.med.type && d.med.type !== 'injection');
        const left = d.pens
            .filter(p => !p.exhaustedDate && (flexible || p.dose === d.targetDose))
            .reduce((a, p) => a + Math.max(0, Math.floor((p.capacity - p.used) / D.doseConsumption(d.targetDose, p) + 1e-6)), 0);
        if (left > 1) return '';
        const danger = left === 0;
        const cn = D.containerName(d.med);
        return `<div class="banner ${danger ? 'danger' : ''}">
            <div class="b-icon">${danger ? Icons.alert : Icons.pen}</div>
            <div class="b-text">
                <strong>${danger ? `No ${d.targetDose}${d.med.unit} ${D.containerPlural(d.med, 2)} in supply` : `${left} dose left in ${d.targetDose}${d.med.unit} supply`}</strong>
                <div class="b-sub">${danger ? 'Tell us when you’ve picked up a new pack so tracking stays right' : 'Order a refill soon to avoid running out'}</div>
            </div>
            <button class="btn primary small" data-action="add-pens">Got a new pack</button>
            <button class="b-close icon-btn" data-action="dismiss-banner">${Icons.close}</button>
        </div>`;
    }

    // ------------------------------------------------
    // Dashboard
    // ------------------------------------------------
    function nextDoseCardHtml(d) {
        const set = d.s.settings;
        if (!d.med) {
            return `<div class="next-dose"><div class="empty">
                <div class="em-title">No medication yet</div>
                <div class="em-sub">Add a medication to start tracking</div>
                <button class="btn primary" style="margin-top:14px" data-action="add-med">${Icons.plus} Add medication</button>
            </div></div>`;
        }
        const currentLevel = D.medLevelAt(d.shots, d.med, Date.now());
        const nd = d.nextDose;
        const locOn = set.shotLocationTrackingEnabled && d.isInjection;

        const dosePicker = local.pickingNextDose ? `
            <div class="chip-grp" style="margin-top:6px;gap:4px">
                ${d.med.doses.map(x => `<button class="chip sm ${nd && nd.dose === x ? 'active' : ''}" data-action="set-next-dose" data-dose="${x}">${x}${escapeHtml(d.med.unit)}</button>`).join('')}
            </div>` : (nd ? `
            <div class="v">${nd.dose}${escapeHtml(d.med.unit)} · ${D.fmtDateShort(nd.date)}</div>
            ${locOn && nd.location ? `<div class="vsub">${escapeHtml(nd.location)}</div>` : ''}` : `<div class="v dim">—</div>`);

        const estCount = d.shots.filter(x => x.estimated).length;
        return `<div class="next-dose">
            <div class="pill-row">
                <span class="pill accent"><span class="pill-dot"></span>${nd ? 'Next dose' : 'No history yet'}</span>
                <span style="display:inline-flex;gap:6px">
                    ${estCount ? `<span class="pill warn" title="Generated by the history estimator — manage in History">${estCount} est. doses</span>` : ''}
                    <span class="pill">${escapeHtml(d.med.name)} · ${escapeHtml(d.med.unit)}</span>
                </span>
            </div>
            ${nd ? (() => {
                const late = D.lateDoseStatus(d.med, nd);
                const usual = nd.usualDay
                    ? ` · usually ${nd.usualDay}s${nd.scheduleSource === 'auto' ? ' (detected)' : ''}`
                    : (nd.usualTimes && nd.usualTimes.length
                        ? ` · usually ${nd.usualTimes.map(t => D.fmtTimeStr(t, set)).join(' / ')}${nd.scheduleSource === 'auto' ? ' (detected)' : ''}`
                        : '');
                let lateHtml = '';
                if (late) {
                    const days = late.daysLate < 1.5 ? `${Math.round(late.daysLate * 24)} h` : `${Math.round(late.daysLate)} days`;
                    const info = late.info;
                    const advice = late.action === 'take'
                        ? `Official guidance: it's OK to take it now${info && info.takeWithinDays ? ` (within ${info.takeWithinDays} days)` : ''}, then continue your usual schedule.`
                        : (info ? info.note : 'This late, it\'s usually best to skip to your next scheduled dose.');
                    lateHtml = `<div class="pen-hint warn late-hint">
                        <div><strong>${days} overdue.</strong> ${escapeHtml(advice)}
                        ${info && info.sourceUrl ? ` <a class="src-link" href="${escapeHtml(info.sourceUrl)}" target="_blank" rel="noopener">Source: ${escapeHtml(info.sourceLabel || 'official guidance')} ↗</a>` : ''}
                        <span class="disclaimer">We're not doctors — check the source or ask your pharmacist.</span></div>
                    </div>`;
                }
                // multi-daily meds: the TIME is the headline, the day is secondary
                const multiDaily = (d.med.frequency || 7) < 0.95;
                const big = late ? 'Overdue' : (multiDaily ? D.fmtTimeStr(nd.time, set) : D.dayLabel(nd.date));
                const small = late ? '' : (multiDaily ? D.dayLabel(nd.date) : D.fmtTimeStr(nd.time, set));
                return `
                <div class="when-line">
                    <span class="when-day ${late ? 'overdue' : ''}">${big}</span>
                    ${small ? `<span class="when-time">${small}</span>` : ''}
                </div>
                <div class="when-sub">${late ? 'was due ' : ''}${D.fmtDate(nd.date, set)}${multiDaily && !late ? '' : ' · ' + D.fmtTimeStr(nd.time, set)} · ${nd.dose}${escapeHtml(d.med.unit)}${locOn && nd.location ? ' · ' + escapeHtml(nd.location) : ''}${usual}</div>
                ${lateHtml}`;
            })() : `
                <div class="when-line"><span class="when-day dim">—</span></div>
                <div class="when-sub">Log your first ${d.isInjection ? 'shot' : 'dose'} to see predictions</div>`}
            <div class="dose-meta">
                <div class="meta-cell">
                    <div class="k">Last ${d.isInjection ? 'shot' : 'dose'}</div>
                    ${d.lastShot ? `
                        <div class="v">${d.lastShot.dose}${escapeHtml(d.med.unit)} · ${D.fmtDateShort(d.lastShot.date)}</div>
                        ${locOn && d.lastShot.location ? `<div class="vsub">${escapeHtml(d.lastShot.location)}</div>` : ''}`
                        : '<div class="v dim">—</div>'}
                </div>
                <div class="meta-cell">
                    <div class="k">Est. med level</div>
                    <div class="v tabular-mono">${currentLevel.toFixed(3)} <span class="dim-sm">${escapeHtml(d.med.unit)}</span></div>
                    <div class="vsub">half-life ${D.fmtDur(d.med.halfLife)}${d.med.dose2halfLife ? ' · per-dose' : ''}</div>
                </div>
                <div class="meta-cell">
                    <div class="k k-flex"><span>Next ${d.isInjection ? 'shot' : 'dose'}</span>
                        ${nd ? `<button class="link" data-action="toggle-next-dose-pick">${local.pickingNextDose ? 'cancel' : 'change'}</button>` : ''}
                    </div>
                    ${dosePicker}
                </div>
            </div>
        </div>`;
    }

    function weightCardHtml(d) {
        const set = d.s.settings;
        const unit = set.weightUnit;
        return `<div class="card">
            <div class="card-head">
                <div class="card-title">Current weight</div>
                ${d.goalKg != null ? `<span class="pill"><span class="pill-dot" style="background:var(--success)"></span>${d.progress.toFixed(0)}%</span>` : ''}
            </div>
            <div class="stat-value lg">${d.latest ? D.fmtWeight(d.latest.kg, unit) : '—'}<span class="unit">${D.unitLabel(unit)}</span></div>
            ${d.latest && d.startKg != null && Math.abs(d.totalLost) > 0.04 ? `
                <div class="stat-delta ${d.totalLost > 0 ? 'pos' : 'neg'}" style="margin-top:8px">
                    ${d.totalLost > 0 ? Icons.arrowDn : Icons.arrowUp} ${D.fmtWeight(Math.abs(d.totalLost), unit, true)} lost${d.toGo != null && d.toGo > 0.04 ? ` <span class="dim-sm">· ${D.fmtWeight(d.toGo, unit, true)} to go</span>` : ''}
                </div>` : ''}
            ${d.bmi != null ? `<div class="stat-delta neutral" style="margin-top:4px">BMI ${d.bmi.toFixed(1)}</div>` : ''}
            ${d.goalKg != null && d.startKg != null ? `
                <div class="progress-track"><div class="progress-fill" style="width:${d.progress}%"></div></div>
                <div class="progress-ends"><span>${D.fmtWeight(d.startKg, unit, true)}</span><span>goal ${D.fmtWeight(d.goalKg, unit, true)}</span></div>` : ''}
        </div>`;
    }

    function supplyCardHtml(d) {
        if (!d.med) return '';
        // works for every type: pens, pill packs, patch boxes, gel bottles…
        const cn = D.containerName(d.med);
        const sortedDoses = Object.keys(d.supplyMap).map(Number).sort((a, b) => a - b);
        const pillCls = d.totalSupply === 0 ? 'danger' : d.totalSupply <= 2 ? 'warn' : 'success';
        const doseWord = d.med.type === 'pill' ? 'tablet' : 'dose';

        const targetInProgress = d.pens.find(p => p.dose === d.targetDose && p.openedDate && p.used < p.capacity - 0.001 && !p.exhaustedDate);
        const targetUnopened = d.pens.find(p => p.dose === d.targetDose && !p.openedDate && !p.exhaustedDate);
        const footPen = targetInProgress || targetUnopened;
        let footHtml = '';
        if (footPen) {
            const isOpen = !!targetInProgress;
            const firstDoseDate = footPen.openedDate || (d.nextDose ? d.nextDose.date : new Date());
            const est = D.addDays(firstDoseDate, Math.max(0, Math.ceil(footPen.capacity - footPen.used) - 1) * (d.med.frequency || 7));
            footHtml = `<div class="pen-foot">
                <div><div class="k">${isOpen ? 'In progress' : 'Will open'}</div>
                    <div class="v">${footPen.dose}${escapeHtml(d.med.unit)} · ${(Math.round((footPen.capacity - footPen.used) * 10) / 10)}/${footPen.capacity} left</div></div>
                <div style="text-align:right"><div class="k">${cn.charAt(0).toUpperCase() + cn.slice(1)} empties</div><div class="v">${D.fmtDateShort(est)}</div></div>
            </div>`;
        }

        return `<div class="card pen-card">
            <div class="card-head">
                <div class="card-title">Supply</div>
                <span class="pill ${pillCls}"><span class="pill-dot"></span>${d.totalSupply} ${doseWord}${d.totalSupply === 1 ? '' : 's'} left</span>
            </div>
            ${sortedDoses.length ? `<div class="supply-grid">
                ${sortedDoses.map(x => {
                    const isNext = d.targetDose === x;
                    const isInUse = d.inProgressPen && d.inProgressPen.dose === x;
                    const penCount = d.pens.filter(p => p.dose === x && !p.exhaustedDate && (p.capacity - p.used) > 0.001).length;
                    const sub = [`${penCount} ${D.containerPlural(d.med, penCount)}`, isNext ? 'next dose' : (isInUse ? 'in use' : null)].filter(Boolean).join(' · ');
                    return `<div class="supply-cell ${isNext ? 'active' : ''}">
                        <div class="sc-dose">${x}${escapeHtml(d.med.unit)}</div>
                        <div class="sc-num">${d.supplyMap[x]}</div>
                        <div class="sc-sub">${sub}</div>
                    </div>`;
                }).join('')}
            </div>` : `<div class="empty pad-sm"><div class="em-title">Nothing in supply</div><div class="em-sub">Add a ${cn === 'pen' ? 'package' : cn} to start tracking</div></div>`}
            ${footHtml}
            <div class="btn-row">
                <button class="btn grow" data-action="add-pens">${Icons.plus} Add to supply</button>
            </div>
        </div>`;
    }

    function statsGridHtml(d) {
        const unit = d.s.settings.weightUnit;
        const f = kg => kg == null ? '—' : D.fmtWeight(kg, unit);
        const cards = [
            { label: 'Start', value: f(d.startKg) },
            { label: 'Current', value: d.latest ? f(d.latest.kg) : '—' },
            { label: 'Goal', value: f(d.goalKg) },
            { label: 'To go', value: d.toGo != null ? f(Math.max(0, d.toGo)) : '—', hint: d.goalKg != null ? `${d.progress.toFixed(0)}% of goal` : null },
            { label: 'Total lost', value: f(Math.abs(d.totalLost)), delta: d.totalLost > 0 ? 'pos' : 'neutral', deltaText: d.totalLost > 0 ? 'down' : '' },
            { label: 'This week', value: f(Math.abs(d.lostThisWeek)), delta: d.lostThisWeek > 0.04 ? 'pos' : d.lostThisWeek < -0.04 ? 'neg' : 'neutral', deltaText: d.lostThisWeek > 0.04 ? 'down' : d.lostThisWeek < -0.04 ? 'up' : 'flat' },
            { label: 'Avg weekly', value: f(d.avgWeekly), hint: 'rolling' },
            { label: 'Doses logged', value: String(d.shots.length), unitTxt: d.med ? d.med.name.toLowerCase() : '' },
        ];
        return `<div class="stats-grid">
            ${cards.map(c => `<div class="card stat">
                <div class="stat-label">${c.label}</div>
                <div class="stat-value">${c.value}${c.unitTxt ? `<span class="unit">${escapeHtml(c.unitTxt)}</span>` : ''}</div>
                ${c.delta && c.deltaText ? `<div class="stat-delta ${c.delta}">${c.delta === 'pos' ? Icons.arrowDn : c.delta === 'neg' ? Icons.arrowUp : ''}${c.deltaText}</div>` : ''}
                ${c.hint ? `<div class="stat-delta neutral">${c.hint}</div>` : ''}
            </div>`).join('')}
        </div>`;
    }

    function calendarCardHtml(d) {
        return `<div class="card calendar-card" id="dashCalendar">${miniCalendarHtml(d, local.calMonth)}</div>`;
    }

    function miniCalendarHtml(d, view) {
        const set = d.s.settings;
        const now = new Date();
        const v = view || { y: now.getFullYear(), m: now.getMonth() };
        const wsName = set.weekStart || 'Monday';
        const wsOffset = { Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 }[wsName] || 0;
        const dowBase = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
        const dows = Array.from({ length: 7 }, (_, i) => dowBase[(i + wsOffset) % 7]);

        const doseMap = {};
        d.shots.forEach(x => { doseMap[x.date] = x; });
        const predicted = d.nextDose ? D.ymd(d.nextDose.date) : null;
        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

        const first = new Date(v.y, v.m, 1);
        const startWd = (first.getDay() - wsOffset + 7) % 7;
        const dim = new Date(v.y, v.m + 1, 0).getDate();
        const prevDim = new Date(v.y, v.m, 0).getDate();
        const todayY = D.ymd(new Date());

        let cells = '';
        for (let i = 0; i < 42; i++) {
            const dayNum = i - startWd + 1;
            let date, label, out = false;
            if (dayNum < 1) { date = new Date(v.y, v.m - 1, prevDim + dayNum); label = prevDim + dayNum; out = true; }
            else if (dayNum > dim) { date = new Date(v.y, v.m + 1, dayNum - dim); label = dayNum - dim; out = true; }
            else { date = new Date(v.y, v.m, dayNum); label = dayNum; }
            const dy = D.ymd(date);
            const cls = ['cal-day'];
            if (out) cls.push('out');
            if (dy === todayY) cls.push('today');
            if (doseMap[dy] && !out) cls.push('dose');
            if (dy === predicted && !out) cls.push('predicted');
            cells += `<div class="${cls.join(' ')}" ${!out ? `data-action="cal-day" data-date="${dy}" title="Log a dose on ${dy}"` : ''}>${label}${doseMap[dy] && !out ? '<span class="dose-mark"></span>' : ''}</div>`;
        }

        return `
            <div class="cal-head">
                <div class="cal-title">${monthNames[v.m]} ${v.y}</div>
                <div class="cal-nav">
                    <button data-action="cal-prev" aria-label="Previous month">${Icons.chevL}</button>
                    <button class="btn ghost small" data-action="cal-today">Today</button>
                    <button data-action="cal-next" aria-label="Next month">${Icons.chevR}</button>
                </div>
            </div>
            <div class="cal-grid">
                ${dows.map(x => `<div class="cal-dow">${x}</div>`).join('')}
                ${cells}
            </div>
            <div class="cal-legend">
                <span><span class="swatch dose"></span>Dose logged</span>
                <span><span class="swatch predicted"></span>Predicted next</span>
            </div>`;
    }

    function renderDashboard(el) {
        const d = derive();
        const set = d.s.settings;
        const showWeight = set.weightTrackingEnabled !== false;

        const medRange = set.medRange || 'm';
        const projDays = (set.medProjection == null || set.medProjection === 'auto')
            ? (window.Charts.AUTO_PROJ[medRange] != null ? window.Charts.AUTO_PROJ[medRange] : 7)
            : Math.max(0, Number(set.medProjection) || 0);

        // which meds the level chart shows: all-in-one (default), a category
        // group ('cat:ADHD' — e.g. total stimulant picture), or a single med
        const multiMed = d.s.meds.length > 1;
        const medCat = m => m.category || 'Other';
        // categories the user has 2+ meds in get their own group chip
        const groupCats = D.CATEGORY_ORDER.filter(cat => d.s.meds.filter(m => medCat(m) === cat).length >= 2);
        const rawScope = set.medLevelScope;
        const scope = multiMed && rawScope && rawScope !== 'all'
            && (rawScope.startsWith('cat:') ? groupCats.includes(rawScope.slice(4)) : d.s.meds.some(m => m.id === rawScope))
            ? rawScope : 'all';
        const scopedMeds = scope === 'all' ? d.s.meds
            : scope.startsWith('cat:') ? d.s.meds.filter(m => medCat(m) === scope.slice(4))
            : d.s.meds.filter(m => m.id === scope);
        const scopedSingle = scopedMeds.length === 1 ? scopedMeds[0] : null;
        const density = set.medYDensity || 'auto';
        const hasCustomStep = !!(scopedSingle && scopedSingle.graphStep > 0);
        const scopeChips = `
            <div class="chart-scope-row">
                ${multiMed ? `<div class="chip-grp chart-scope">
                    <button class="chip sm ${scope === 'all' ? 'active' : ''}" data-action="med-scope" data-id="all">All meds</button>
                    ${groupCats.map(cat => `<button class="chip sm ${scope === 'cat:' + cat ? 'active' : ''}" data-action="med-scope" data-id="cat:${escapeHtml(cat)}">${escapeHtml(cat)}</button>`).join('')}
                    ${d.s.meds.map(m => `<button class="chip sm ${scope === m.id ? 'active' : ''}" data-action="med-scope" data-id="${escapeHtml(m.id)}"><span class="ml-dot" style="background:${escapeHtml(m.color || '#5fc8c8')}"></span>${escapeHtml(m.name)}</button>`).join('')}
                </div>` : '<span></span>'}
                <div class="yaxis-groups">
                    <div class="chip-grp chart-scope yaxis-ctl" title="How tall the chart is — taller = steeper, more dramatic peaks">
                        <span class="yaxis-label">Peaks</span>
                        ${[['s', 'S'], ['m', 'M'], ['l', 'L'], ['xl', 'XL']].map(([k, l]) =>
                            `<button class="chip sm ${(set.medChartHeight || 'm') === k ? 'active' : ''}" data-action="med-height" data-val="${k}">${l}</button>`).join('')}
                    </div>
                    <div class="chip-grp chart-scope yaxis-ctl" title="How the left axis numbers are spaced">
                        <span class="yaxis-label">Y axis</span>
                        <button class="chip sm ${!hasCustomStep && density === 'auto' ? 'active' : ''}" data-action="med-ydensity" data-val="auto">Auto</button>
                        <button class="chip sm ${!hasCustomStep && density === 'fine' ? 'active' : ''}" data-action="med-ydensity" data-val="fine">Fine</button>
                        <button class="chip sm ${!hasCustomStep && density === 'coarse' ? 'active' : ''}" data-action="med-ydensity" data-val="coarse">Coarse</button>
                        ${scopedSingle ? `<input class="ystep-input ${hasCustomStep ? 'active' : ''}" type="number" min="0" step="0.1" inputmode="decimal"
                            placeholder="step ${escapeHtml(scopedSingle.unit)}" value="${hasCustomStep ? scopedSingle.graphStep : ''}"
                            data-ystep data-id="${escapeHtml(scopedSingle.id)}" title="Exact spacing, e.g. 2 → 0/2/4/6 ${escapeHtml(scopedSingle.unit)}">` : ''}
                    </div>
                </div>
            </div>`;

        const medLevelSection = set.showMedLevel && d.med ? `
            <div class="card">
                <div class="card-head wrap">
                    <div>
                        <div class="card-title">Estimated medication level</div>
                        <div class="chart-sub">
                            <span class="tabular-mono big-num">${D.medLevelAt(d.shots, d.med, Date.now()).toFixed(3)}</span>
                            <span class="dim-sm">${escapeHtml(d.med.unit)} now${multiMed ? ' (' + escapeHtml(d.med.name) + ')' : ''}</span>
                            <span class="pill">half-life ${D.fmtDur(d.med.halfLife)}${d.med.dose2halfLife ? ' · per-dose' : ''}</span>
                            ${projDays > 0 ? `<span class="pill" title="Change in Settings → Dashboard layout">+${projDays}d ahead</span>` : ''}
                        </div>
                    </div>
                    <div class="range-tabs">
                        ${[['w', '7d'], ['14', '14d'], ['m', '1M'], ['3m', '3M'], ['6m', '6M'], ['y', '1Y'], ['all', 'All']].map(([k, l]) =>
                            `<button class="${medRange === k ? 'active' : ''}" data-action="med-range" data-range="${k}">${l}</button>`).join('')}
                    </div>
                </div>
                ${scopeChips}
                <div class="chart-wrap" id="medLevelChart" style="height:${{ s: 220, m: 300, l: 400, xl: 520 }[set.medChartHeight || 'm'] || 300}px"></div>
            </div>` : '';

        const weightSection = showWeight && set.showWeight ? `
            <div class="${set.showCalendar ? 'main-grid' : ''}">
                <div class="card ${set.showCalendar ? 'chart-card' : ''}">
                    <div class="card-head wrap">
                        <div>
                            <div class="card-title">Weight trend</div>
                            <div class="chart-sub">
                                <span class="tabular-mono big-num">${d.latest ? D.fmtWeight(d.latest.kg, set.weightUnit) : '—'}</span>
                                <span class="dim-sm">${D.unitLabel(set.weightUnit)}</span>
                                ${d.lostThisWeek > 0.05 ? `<span class="pill success">${Icons.arrowDn} ${D.fmtWeight(d.lostThisWeek, set.weightUnit, true)} this week</span>` : ''}
                            </div>
                        </div>
                        <div class="range-tabs">
                            ${[['w', '7d'], ['14', '14d'], ['m', '1M'], ['3m', '3M'], ['6m', '6M'], ['y', '1Y'], ['all', 'All']].map(([k, l]) =>
                                `<button class="${set.weightRange === k ? 'active' : ''}" data-action="weight-range" data-range="${k}">${l}</button>`).join('')}
                        </div>
                    </div>
                    <div class="chart-wrap tall" id="weightChart"></div>
                </div>
                ${set.showCalendar ? calendarCardHtml(d) : ''}
            </div>` : (set.showCalendar ? `<div class="main-grid">${calendarCardHtml(d)}</div>` : '');

        const sections = set.chartOrder === 'weight-first'
            ? [weightSection, medLevelSection] : [medLevelSection, weightSection];

        // all-meds overview replaces the single-med hero when selected
        const allMode = d.s.meds.length > 1 && set.dashAll !== false;
        const heroHtml = allMode
            ? `<div class="hero-grid ${showWeight ? 'ov-grid' : 'no-weight'}">
                ${overviewCardHtml(d)}
                ${showWeight ? weightCardHtml(d) : ''}
            </div>`
            : `<div class="hero-grid ${showWeight ? '' : 'no-weight'}">
                ${nextDoseCardHtml(d)}
                ${showWeight ? weightCardHtml(d) : ''}
                ${supplyCardHtml(d)}
            </div>`;

        el.innerHTML = `
            ${medSwitcherHtml(d, true)}
            ${allMode ? '' : bannerHtml(d)}
            ${heroHtml}
            <div class="quick-row ${showWeight ? '' : 'single'}">
                ${allMode ? '' : `
                <button class="quick-btn" data-action="log-shot" ${!d.med ? 'disabled' : ''}>
                    <span class="qicon">${Icons.syringe}</span>
                    <span class="qtext">
                        <span class="qlabel">Log ${d.isInjection || !d.med ? 'shot' : 'dose'}</span>
                        <span class="qsub">${d.med ? escapeHtml(d.med.name) + ' · ' + (d.lastShot ? 'last: ' + D.dayLabel(d.lastShot.date).toLowerCase() : 'no doses yet') : 'add a medication first'}</span>
                    </span>
                    <span class="qarrow">${Icons.chevR}</span>
                </button>`}
                ${showWeight ? `
                <button class="quick-btn" data-action="log-weight">
                    <span class="qicon">${Icons.scale}</span>
                    <span class="qtext">
                        <span class="qlabel">Log weight</span>
                        <span class="qsub">${d.latest ? 'last: ' + D.fmtWeight(d.latest.kg, set.weightUnit, true) + ' · ' + D.dayLabel(new Date(d.latest.timestamp)).toLowerCase() : 'no weights yet'}</span>
                    </span>
                    <span class="qarrow">${Icons.chevR}</span>
                </button>` : ''}
            </div>
            <div class="sections">${sections.filter(Boolean).join('')}</div>
            ${showWeight && set.showStats ? statsGridHtml(d) : ''}`;

        const ml = el.querySelector('#medLevelChart');
        if (ml) {
            const Store = window.Store;
            const series = scopedMeds.map(m => ({ med: m, shots: Store.medShots(m.id) }));
            const single = series.length === 1 ? series[0].med : null;
            window.Charts.medLevel(ml, {
                series, range: medRange, projection: projDays,
                graphStep: single && single.graphStep > 0 ? single.graphStep : null,
                density: set.medYDensity || 'auto',
                settings: set,
            });
        }
        const wc = el.querySelector('#weightChart');
        if (wc) window.Charts.weight(wc, { weights: d.weights, unit: set.weightUnit, range: set.weightRange, goalKg: d.goalKg, settings: set });
    }

    // ------------------------------------------------
    // History
    // ------------------------------------------------
    function renderHistory(el) {
        const d = derive();
        const set = d.s.settings;
        const tab = local.historyTab;
        const weights = d.weights.slice().sort((a, b) => b.timestamp - a.timestamp);
        const hasEstimated = d.shots.some(x => x.estimated);

        let body = '';
        if (tab === 'shots') {
            body = `<div class="card table-card">
                ${hasEstimated ? `<div class="table-note">
                    <span>${Icons.wand} Doses marked <span class="pill sm">est</span> were estimated during onboarding.</span>
                    <button class="btn small" data-action="clear-estimated">Remove estimated</button>
                </div>` : ''}
                <div class="tbl-scroll"><table class="tbl">
                    <thead><tr><th>Date</th><th>Time</th><th>Dose</th>${set.shotLocationTrackingEnabled ? '<th>Location</th>' : ''}<th></th></tr></thead>
                    <tbody>
                    ${d.shots.length === 0 ? `<tr><td colspan="5"><div class="empty"><div class="em-title">No doses yet</div></div></td></tr>` : ''}
                    ${d.shots.map(x => `<tr>
                        <td>${D.fmtDate(x.timestamp, set)}</td>
                        <td>${D.fmtTimeStr(x.time, set)}</td>
                        <td>${x.dose}${d.med ? escapeHtml(d.med.unit) : 'mg'}${x.estimated ? ' <span class="pill sm">est</span>' : ''}</td>
                        ${set.shotLocationTrackingEnabled ? `<td>${escapeHtml(x.location || '—')}</td>` : ''}
                        <td><div class="tbl-actions">
                            <button data-action="edit-shot" data-id="${escapeHtml(x.id)}" title="Edit">${Icons.edit}</button>
                            <button data-action="delete-shot" data-id="${escapeHtml(x.id)}" title="Delete">${Icons.trash}</button>
                        </div></td>
                    </tr>`).join('')}
                    </tbody>
                </table></div>
            </div>`;
        } else if (tab === 'weights') {
            body = `<div class="card table-card"><div class="tbl-scroll"><table class="tbl">
                <thead><tr><th>Date</th><th>Time</th><th>Weight</th><th>Δ prev</th><th></th></tr></thead>
                <tbody>
                ${weights.length === 0 ? `<tr><td colspan="5"><div class="empty"><div class="em-title">No weights yet</div></div></td></tr>` : ''}
                ${weights.map((x, i) => {
                    const next = weights[i + 1];
                    const delta = next ? x.kg - next.kg : null;
                    return `<tr>
                        <td>${D.fmtDate(x.timestamp, set)}</td>
                        <td>${D.fmtTimeStr(x.time, set)}</td>
                        <td>${D.fmtWeight(x.kg, set.weightUnit, true)}</td>
                        <td>${delta != null && Math.abs(delta) > 0.04
                            ? `<span class="${delta < 0 ? 'txt-success' : 'txt-danger'}">${delta < 0 ? '−' : '+'}${D.fmtWeight(Math.abs(delta), set.weightUnit, true)}</span>`
                            : '<span class="dim">—</span>'}</td>
                        <td><div class="tbl-actions">
                            <button data-action="edit-weight" data-id="${escapeHtml(x.id)}" title="Edit">${Icons.edit}</button>
                            <button data-action="delete-weight" data-id="${escapeHtml(x.id)}" title="Delete">${Icons.trash}</button>
                        </div></td>
                    </tr>`;
                }).join('')}
                </tbody>
            </table></div></div>`;
        } else {
            const pens = d.pens.slice().sort((a, b) => {
                const order = p => p.exhaustedDate ? 2 : (p.openedDate ? 0 : 1);
                if (order(a) !== order(b)) return order(a) - order(b);
                if (a.openedDate && b.openedDate) return new Date(b.openedDate) - new Date(a.openedDate);
                return String(a.id).localeCompare(String(b.id));
            });
            body = `<div class="card table-card"><div class="tbl-scroll"><table class="tbl">
                <thead><tr><th>Dose</th><th>Status</th><th>Opened</th><th>Used</th><th>Note</th><th></th></tr></thead>
                <tbody>
                ${pens.length === 0 ? `<tr><td colspan="6"><div class="empty"><div class="em-title">No pens yet</div><div class="em-sub">Add to supply from the dashboard, or import a backup</div></div></td></tr>` : ''}
                ${pens.map(p => {
                    const status = p.exhaustedDate ? 'done' : (p.openedDate ? 'in use' : 'unopened');
                    const cells = Math.min(20, Math.ceil(p.capacity));
                    return `<tr>
                        <td>${p.dose}${d.med ? escapeHtml(d.med.unit) : 'mg'}</td>
                        <td><span class="pill sm ${status === 'in use' ? 'accent' : status === 'done' ? 'warn' : ''}"><span class="pill-dot"></span>${status}</span></td>
                        <td>${p.openedDate ? D.fmtDate(p.openedDate, set) : '<span class="dim">—</span>'}</td>
                        <td><span class="used-cells">${(Math.round(p.used * 10) / 10)}/${p.capacity}
                            <span class="pr-cells">${Array.from({ length: cells }).map((_, i) => `<span class="pr-cell ${i < Math.floor(p.used + 0.001) ? 'used' : ''}"></span>`).join('')}</span>
                        </span></td>
                        <td class="dim-sm">${escapeHtml(p.note || '—')}</td>
                        <td><div class="tbl-actions">
                            <button data-action="delete-pen" data-id="${escapeHtml(p.id)}" title="Delete">${Icons.trash}</button>
                        </div></td>
                    </tr>`;
                }).join('')}
                </tbody>
            </table></div></div>`;
        }

        el.innerHTML = `
            ${medSwitcherHtml(d)}
            <div class="med-switcher tabs-row">
                <button class="med-pill ${tab === 'shots' ? 'active' : ''}" data-action="history-tab" data-tab="shots">${Icons.syringe} Doses (${d.shots.length})</button>
                ${d.s.settings.weightTrackingEnabled !== false ? `<button class="med-pill ${tab === 'weights' ? 'active' : ''}" data-action="history-tab" data-tab="weights">${Icons.scale} Weights (${weights.length})</button>` : ''}
                ${d.med ? `<button class="med-pill ${tab === 'pens' ? 'active' : ''}" data-action="history-tab" data-tab="pens">${Icons.pen} Supply (${d.pens.length})</button>` : ''}
            </div>
            ${body}`;
    }

    // ------------------------------------------------
    // Calendar page
    // ------------------------------------------------
    function renderCalendar(el) {
        const d = derive();
        const set = d.s.settings;
        const timeline = [];
        if (d.nextDose && d.med) {
            timeline.push({ date: d.nextDose.date, upcoming: true, title: `${d.med.name} ${d.nextDose.dose}${d.med.unit}`, sub: `${set.shotLocationTrackingEnabled && d.nextDose.location ? d.nextDose.location + ' · ' : ''}predicted` });
        }
        d.shots.slice(0, 10).forEach(x => {
            timeline.push({ date: new Date(x.timestamp), title: `${d.med ? d.med.name : ''} ${x.dose}${d.med ? d.med.unit : ''}`, sub: `${set.shotLocationTrackingEnabled && x.location ? x.location + ' · ' : ''}${D.fmtTimeStr(x.time, set)}${x.estimated ? ' · est' : ''}` });
        });

        el.innerHTML = `
            ${medSwitcherHtml(d)}
            <div class="cal-page-grid">
                <div class="card" id="bigCalendar">${miniCalendarHtml(d, local.calMonth)}</div>
                <div class="card">
                    <div class="card-head"><div class="card-title">Upcoming & recent</div></div>
                    <div class="timeline">
                        ${timeline.length === 0 ? '<div class="empty"><div class="em-title">Nothing yet</div></div>' : ''}
                        ${timeline.map(t => `
                            <div class="tl-item">
                                <div class="tl-date">
                                    <div class="tl-mon">${D.MONTHS[new Date(t.date).getMonth()]}</div>
                                    <div class="tl-day ${t.upcoming ? 'accent' : ''}">${new Date(t.date).getDate()}</div>
                                </div>
                                <div class="tl-body">
                                    <div class="tl-title">${escapeHtml(t.title)}</div>
                                    <div class="tl-sub">${escapeHtml(t.sub)}</div>
                                </div>
                                ${t.upcoming ? '<span class="pill accent">upcoming</span>' : ''}
                            </div>`).join('')}
                    </div>
                </div>
            </div>`;
    }

    // ------------------------------------------------
    // Meds page
    // ------------------------------------------------
    function renderMeds(el) {
        const Store = window.Store;
        const s = Store.state;
        const set = s.settings;

        const medCard = m => {
            const medShots = Store.medShots(m.id);
            const medPens = Store.medPens(m.id);
            const isInjection = !m.type || m.type === 'injection';
            const supply = D.supplyByDose(medPens, m.id);
            const totalSupply = Object.values(supply).reduce((a, b) => a + b, 0);
            const expanded = local.expandedMedId === m.id;
            const orphans = medShots.filter(x => !x.penId).length;

            return `<div class="card med-card">
                <div class="mc-head">
                    <div class="mc-id">
                        <span class="mc-swatch" style="background:${escapeHtml(m.color || '#5fc8c8')}22;color:${escapeHtml(m.color || '#5fc8c8')}">${Icons.pill}</span>
                        <div>
                            <div class="mc-name">${escapeHtml(m.name)} <span class="p-type">${escapeHtml(m.type || 'injection')}</span></div>
                            <div class="mc-generic">${escapeHtml(m.generic || 'custom')}</div>
                        </div>
                    </div>
                    ${m.id === s.activeMedId ? `<span class="pill accent"><span class="pill-dot"></span>active</span>` : ''}
                </div>
                ${(() => {
                    // live numbers: what's in the body right now + where it's heading
                    const set2 = s.settings;
                    const nd2 = D.predictNextDose(m, medShots, set2);
                    const lvl = D.medLevelAt(medShots, m, Date.now());
                    const ext2 = medShots.length ? D.levelExtremes(medShots, m, nd2 ? new Date(nd2.date).getTime() : null) : null;
                    return `<div class="mc-facts mc-live">
                        <div><div class="k">In system now</div><div class="txt-accent">${lvl.toFixed(lvl >= 100 ? 0 : 2)} ${escapeHtml(m.unit)}</div></div>
                        <div><div class="k">Next dose</div><div>${nd2 ? `${D.fmtTimeStr(nd2.time, set2)} ${D.dayLabel(nd2.date).toLowerCase()} · ${nd2.dose}${escapeHtml(m.unit)}` : '—'}</div></div>
                        <div><div class="k">Est. peak</div><div>${ext2 ? `${ext2.peak.v.toFixed(ext2.peak.v >= 100 ? 0 : 1)} @ ${D.fmtTime(ext2.peak.ts, set2)}` : '—'}</div></div>
                        <div><div class="k">Est. low</div><div>${ext2 ? `${ext2.low.v.toFixed(ext2.low.v >= 100 ? 0 : 1)} @ ${D.fmtTime(ext2.low.ts, set2)}` : '—'}</div></div>
                    </div>`;
                })()}
                <div class="mc-facts">
                    <div><div class="k">Frequency</div><div>${D.fmtFreq(m.frequency)}</div></div>
                    <div><div class="k">Half-life</div><div>${D.fmtDur(m.halfLife)}${m.dose2halfLife ? ' (varies)' : ''}</div></div>
                    <div><div class="k">Doses logged</div><div>${medShots.length}</div></div>
                    <div><div class="k">Supply</div><div>${totalSupply} dose${totalSupply === 1 ? '' : 's'}</div></div>
                </div>
                ${expanded ? `
                    <div class="mc-pens">
                        <div class="mc-pens-head">
                            <div class="k">All pens</div>
                            <div class="btn-cluster">
                                ${orphans > 0 ? `<button class="btn small" data-action="infer-pens" data-id="${escapeHtml(m.id)}" title="Generate pens from dose history">${Icons.refresh} From history</button>` : ''}
                                <button class="btn small" data-action="add-pens-for" data-id="${escapeHtml(m.id)}">${Icons.plus} Add</button>
                            </div>
                        </div>
                        ${medPens.length === 0 ? `<div class="empty pad-sm"><div class="em-sub">No pens yet${orphans ? ` — use <strong>From history</strong> to build pens from your ${orphans} logged dose${orphans === 1 ? '' : 's'}` : ''}</div></div>`
                        : `<div class="pen-list">
                            ${medPens.slice().sort((a, b) => {
                                const order = p => p.exhaustedDate ? 2 : (p.openedDate ? 0 : 1);
                                return order(a) - order(b);
                            }).map(p => `
                                <div class="pen-row">
                                    <span class="pr-dose">${p.dose}${escapeHtml(m.unit)}</span>
                                    <span>
                                        <span class="pr-cells">${Array.from({ length: Math.min(20, Math.ceil(p.capacity)) }).map((_, i) => `<span class="pr-cell ${i < Math.floor(p.used + 0.001) ? 'used' : ''}"></span>`).join('')}</span>
                                        ${p.note ? `<span class="pr-note">${escapeHtml(p.note)}</span>` : ''}
                                    </span>
                                    <span class="pr-status ${p.exhaustedDate ? 'exhausted' : (p.openedDate ? 'open' : '')}">${p.exhaustedDate ? 'done' : (p.openedDate ? 'in use' : 'unopened')}</span>
                                    <span class="pr-date">${p.openedDate ? D.fmtDateShort(p.openedDate) : '—'}</span>
                                    <button class="icon-btn xs" data-action="delete-pen" data-id="${escapeHtml(p.id)}">${Icons.trash}</button>
                                </div>`).join('')}
                        </div>`}
                    </div>` : ''}
                <div class="btn-row bordered">
                    ${m.id !== s.activeMedId ? `<button class="btn small" data-action="select-med-page" data-id="${escapeHtml(m.id)}">Switch to</button>` : ''}
                    <button class="btn small ghost" data-action="toggle-pens" data-id="${escapeHtml(m.id)}">${expanded ? 'Hide' : 'Show'} supply</button>
                    <button class="btn small ghost" data-action="backfill-med" data-id="${escapeHtml(m.id)}" title="Estimate past doses">${Icons.wand} Backfill</button>
                    <button class="btn small ghost" data-action="edit-med" data-id="${escapeHtml(m.id)}">${Icons.edit} Edit</button>
                    <button class="btn small danger push-right" data-action="trash-med" data-id="${escapeHtml(m.id)}">${Icons.trash}</button>
                </div>
            </div>`;
        };

        const trash = s.trashedMeds || [];
        el.innerHTML = `
            <div class="meds-head">
                <div>
                    <div class="card-title">Your medications</div>
                    <div class="meds-count">${s.meds.length} medication${s.meds.length === 1 ? '' : 's'} tracked</div>
                </div>
                <button class="btn primary" data-action="add-med">${Icons.plus} Add medication</button>
            </div>
            <div class="meds-grid">
                ${s.meds.map(medCard).join('')}
                <button class="card add-med-card" data-action="add-med">
                    ${Icons.plus}
                    <div>Add medication</div>
                    <div class="dim-sm">Preset or custom</div>
                </button>
            </div>
            ${trash.length ? `
                <div class="meds-head" style="margin-top:28px">
                    <div><div class="card-title">Trash</div>
                    <div class="dim-sm" style="margin-top:4px">Removed meds keep their history until deleted forever</div></div>
                </div>
                <div class="trash-list">
                    ${trash.map(m => `
                        <div class="trash-row">
                            <span class="mc-swatch sm" style="background:${escapeHtml(m.color || '#5fc8c8')}22;color:${escapeHtml(m.color || '#5fc8c8')}">${Icons.pill}</span>
                            <span class="trash-name">${escapeHtml(m.name)}</span>
                            <span class="dim-sm">${window.Store.medShots(m.id).length} doses kept</span>
                            <button class="btn small" data-action="restore-med" data-id="${escapeHtml(m.id)}">Restore</button>
                            <button class="btn small danger" data-action="delete-med-forever" data-id="${escapeHtml(m.id)}">Delete forever</button>
                        </div>`).join('')}
                </div>` : ''}`;
    }

    window.Views = { local, derive, renderDashboard, renderHistory, renderCalendar, renderMeds };
})();
