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
        historyAllMeds: true,  // history defaults to every med
        historyPage: 0,
        calMonth: null,   // {y, m}
        expandedMedId: null,
        pickingNextDose: false,
        bannerDismissed: false,
        penGroups: {},    // supply group collapse: 'medId:dose'|'medId:spent' -> open?
        painRange: 30,    // days shown on the pain chart
        painArea: null,   // Pain.areaKey of the area the chart is filtered to, or null for all
    };

    // ------------------------------------------------
    // derived data for the active med
    // ------------------------------------------------
    function derive() {
        const Store = window.Store;
        const s = Store.state;
        const med = Store.activeMed();
        const doseLog = med ? Store.medDoses(med.id) : [];
        const containers = med ? Store.medContainers(med.id) : [];
        const isInjection = med ? (!med.type || med.type === 'injection') : false;
        const supplyMap = med ? D.supplyByDose(containers, med.id) : {};
        const totalSupply = Object.values(supplyMap).reduce((a, b) => a + b, 0);
        const lastEntry = doseLog[0] || null;
        // A stopped med gets no prediction anywhere on the dashboard either: no next
        // dose, and therefore no overdue banner, no countdown and no "take it now"
        // advice. Everything downstream already handles a null prediction, because
        // that is also what a med with no history looks like.
        const nextDose = (med && !med.stoppedAt) ? D.predictNextDose(med, doseLog, s.settings) : null;
        const targetDose = med ? (med.preferredNextDose != null ? med.preferredNextDose : (lastEntry ? lastEntry.dose : null)) : null;

        const inProgressCandidates = containers.filter(p => p.openedDate && p.used < p.capacity - 0.001 && !p.exhaustedDate);
        const inProgressPen = targetDose != null
            ? (inProgressCandidates.find(p => p.dose === targetDose) || inProgressCandidates[0])
            : inProgressCandidates[0];

        // weight stats
        const weights = Store.sortedWeights();
        const latest = weights[weights.length - 1] || null;
        const startKg = s.settings.startKg != null ? s.settings.startKg : (weights[0] ? weights[0].kg : null);
        const goalKg = s.settings.goalKg;
        // Which way the user is trying to move. A goal ABOVE the start weight is a gain goal, and
        // every "is this good?" decision below reads this instead of assuming down is good.
        // 0 = no goal, or start === goal (maintaining) — then a change is neither good nor bad.
        const goalDir = (goalKg != null && startKg != null && startKg !== goalKg)
            ? (goalKg > startKg ? 1 : -1) : 0;
        // Signed the natural way round: positive means gained.
        const totalChange = latest && startKg != null ? latest.kg - startKg : 0;
        // Distance still to cover, never negative — overshooting is not "-2 kg to go".
        const toGo = latest && goalKg != null ? Math.abs(latest.kg - goalKg) : null;
        const goalReached = !!(goalDir !== 0 && latest && goalKg != null
            && (goalDir > 0 ? latest.kg >= goalKg : latest.kg <= goalKg));
        // Already direction-agnostic: with a gain goal both differences are negative and the
        // ratio still comes out right. Left exactly as it was.
        const progress = (startKg != null && goalKg != null && latest && startKg !== goalKg)
            ? Math.min(100, Math.max(0, ((startKg - latest.kg) / (startKg - goalKg)) * 100)) : 0;

        // +1 moved toward the goal · -1 away from it · 0 flat, or no goal to judge against.
        const changeDir = (delta) => {
            if (!(Math.abs(delta) > 0.04) || goalDir === 0) return 0;
            return Math.sign(delta) === goalDir ? 1 : -1;
        };

        let changeThisWeek = 0;
        if (weights.length > 1 && latest) {
            const target = latest.timestamp - 7 * 86400000;
            const prev = weights.slice(0, -1).reduce((best, cur) =>
                Math.abs(cur.timestamp - target) < Math.abs(best.timestamp - target) ? cur : best);
            changeThisWeek = latest.kg - prev.kg;
        }
        let avgWeekly = 0;
        if (weights.length > 1 && latest) {
            const first = weights[0];
            const wks = Math.max(1, (latest.timestamp - first.timestamp) / (7 * 86400000));
            avgWeekly = (latest.kg - first.kg) / wks;
        }
        let bmi = null, bmiBand = null;
        if (s.settings.showBmi && s.settings.userHeight && latest) {
            const hm = s.settings.userHeight / 100;
            if (hm > 0) { bmi = latest.kg / (hm * hm); bmiBand = D.bmiBand(bmi); }
        }

        return {
            s, med, doseLog, containers, isInjection, supplyMap, totalSupply, lastEntry, nextDose, targetDose,
            inProgressPen, weights, latest, startKg, goalKg, totalChange, toGo, progress, changeThisWeek, avgWeekly,
            bmi, bmiBand, goalDir, goalReached, changeDir,
        };
    }

    // ------------------------------------------------
    // shared chrome: med switcher + low-supply banner
    // ------------------------------------------------
    function medSwitcherHtml(d, allowAll) {
        // Meds being taken, plus the selected one even if it is stopped — otherwise
        // choosing a stopped med from the meds page would leave the switcher with nothing
        // highlighted and no way back to it.
        const meds = d.s.meds.filter(m => !m.stoppedAt || m.id === d.s.activeMedId);
        const allMode = allowAll && meds.length > 1 && d.s.settings.dashAll !== false;
        return `<div class="med-switcher">
            ${allowAll && meds.length > 1 ? `
                <button class="med-pill ${allMode ? 'active' : ''}" data-action="dash-all">All meds</button>` : ''}
            ${meds.map(m => `
                <button class="med-pill ${!allMode && m.id === d.s.activeMedId ? 'active' : ''}${m.stoppedAt ? ' is-stopped' : ''}" data-action="select-med" data-id="${escapeHtml(m.id)}"${m.stoppedAt ? ` title="Stopped ${escapeHtml(D.fmtDate(m.stoppedAt, d.s.settings))}"` : ''}>
                    <span class="pill-swatch" style="background:${escapeHtml(m.color || '#5fc8c8')}"></span>${escapeHtml(m.name)}${m.stoppedAt ? ' <span class="pill-tag">stopped</span>' : ''}
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
        // "right now" — stopped meds have no next dose, so they are not part of this.
        // Their history and decay tail live on the chart below instead.
        const liveMeds = Store.activeMeds();
        const rows = liveMeds.map(m => {
            const doseLog = Store.medDoses(m.id);
            const containers = Store.medContainers(m.id);
            const nd = D.predictNextDose(m, doseLog, set);
            const late = nd ? D.lateDoseStatus(m, nd) : null;
            const level = D.medLevelAt(doseLog, m, Date.now());
            const ext = doseLog.length ? D.levelExtremes(doseLog, m, nd ? new Date(nd.date).getTime() : null) : null;
            const supply = D.supplyByDose(containers, m.id);
            const totalSupply = Object.values(supply).reduce((a, b) => a + b, 0);
            // PRN gets "when needed" rather than "no doses yet" — the med is working as
            // intended, so the empty-state wording would read like something is missing.
            const nextTxt = D.isPRN(m) ? '<span class="dim">when needed</span>'
                : !nd ? '<span class="dim">no doses yet</span>'
                : late ? `<span class="txt-danger">overdue — was ${escapeHtml(D.slotLabel(nd, set))} ${D.dayLabel(nd.date).toLowerCase()}</span>`
                : `${escapeHtml(D.slotLabel(nd, set))} <span class="dim-sm">${D.dayLabel(nd.date).toLowerCase()}</span> · ${escapeHtml(D.fmtDoseCount(m, nd.dose, containers))}`;
            return `<div class="ov-row">
                <div class="ov-med"><span class="ml-dot" style="background:${escapeHtml(m.color || '#5fc8c8')}"></span>${escapeHtml(m.name)}</div>
                <div class="ov-cell"><span class="k">In system</span><span class="v tabular-mono">${level == null ? '<span class="dim">no half-life</span>' : level.toFixed(level >= 100 ? 0 : 2) + ' ' + escapeHtml(m.unit)}</span></div>
                <div class="ov-cell"><span class="k">Next dose</span><span class="v">${nextTxt}</span></div>
                <div class="ov-cell"><span class="k">Peak / low</span><span class="v">${ext
                    ? `${ext.peak.v.toFixed(ext.peak.v >= 100 ? 0 : 1)} @ ${D.fmtTime(ext.peak.ts, set)} · ${ext.low.v.toFixed(ext.low.v >= 100 ? 0 : 1)} @ ${D.fmtTime(ext.low.ts, set)}`
                    : '<span class="dim">—</span>'}</span></div>
                <div class="ov-cell"><span class="k">Supply</span><span class="v ${totalSupply === 0 ? 'txt-danger' : ''}">${totalSupply} dose${totalSupply === 1 ? '' : 's'}</span></div>
                <button class="btn small primary" data-action="log-entry-for" data-id="${escapeHtml(m.id)}">${Icons.plus} Log</button>
            </div>`;
        }).join('');
        return `<div class="card overview-card">
            <div class="card-head"><div class="card-title">All medications — right now</div>
                <span class="pill">${liveMeds.length} meds</span></div>
            <div class="ov-rows">${rows}</div>
        </div>`;
    }

    function bannerHtml(d) {
        if (local.bannerDismissed || !d.med || d.targetDose == null) return '';
        // count how many of the NEXT dose the supply can actually serve —
        // flexible meds (pills, split-dose containers) can pull from other strengths
        const flexible = d.med.splitDose || (d.med.type && d.med.type !== 'injection');
        const activeContainers = d.containers.filter(p => !p.exhaustedDate);
        const left = activeContainers
            .filter(p => flexible || p.dose === d.targetDose)
            .reduce((a, p) => a + Math.max(0, Math.floor((p.capacity - p.used) / D.doseConsumption(d.targetDose, p) + 1e-6)), 0);
        // threshold scales with how fast the med burns supply: one dose left
        // is a week of runway for Mounjaro but ~6 hours for a 3×/day med
        const slots = D.getScheduleSlots(d.med);
        // PRN burns supply at no rate at all, so "days left" cannot be computed and
        // must not be guessed — "about 2 days left" for something taken once a month
        // would be a fabrication shown as a fact. Count doses instead, and only warn
        // when there is nothing left to take.
        const isPrn = D.isPRN(d.med);
        const freq = isPrn ? NaN : D.freqOf(d.med);
        const dailyUse = isPrn ? 0
            : (freq < 0.95 && slots.length >= 2)
                ? slots.reduce((a, sl) => a + (sl.dose != null ? sl.dose : d.targetDose || 0), 0)
                : (d.targetDose || 0) / Math.max(freq, 1 / 24);
        const remainingAmt = activeContainers.reduce((a, p) => a + Math.max(0, p.capacity - p.used) * (p.dose || 0), 0);
        const daysLeft = dailyUse > 0 ? remainingAmt / dailyUse : Infinity;
        if (isPrn ? left > 0 : (left > 1 && daysLeft > 3)) return '';
        const danger = left === 0;
        const cn = D.containerName(d.med);
        const runway = daysLeft === Infinity ? '' : daysLeft < 1 ? `about ${D.fmtDur(daysLeft)}` : `about ${Math.round(daysLeft * 10) / 10} days`;
        return `<div class="banner ${danger ? 'danger' : ''}">
            <div class="b-icon">${danger ? Icons.alert : Icons.container}</div>
            <div class="b-text">
                <strong>${danger
                    ? (flexible ? `Nothing left in supply for your next dose (${escapeHtml(D.fmtDoseCount(d.med, d.targetDose, activeContainers))})` : `No ${d.targetDose}${escapeHtml(d.med.unit)} ${D.containerPlural(d.med, 2)} in supply`)
                    : `Supply running low — ${runway} of doses left`}</strong>
                <div class="b-sub">${danger ? `Tell us when you’ve picked up a new ${cn} so tracking stays right` : 'Order a refill soon to avoid running out'}</div>
            </div>
            <button class="btn primary small" data-action="add-containers">Got a new ${cn === 'container' ? 'pack' : cn}</button>
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
        const currentLevel = D.medLevelAt(d.doseLog, d.med, Date.now());
        const nd = d.nextDose;
        const locOn = set.shotLocationTrackingEnabled && d.isInjection;

        const dosePicker = local.pickingNextDose ? `
            <div class="chip-grp" style="margin-top:6px;gap:4px">
                ${d.med.doses.map(x => `<button class="chip sm ${nd && nd.dose === x ? 'active' : ''}" data-action="set-next-dose" data-dose="${x}">${x}${escapeHtml(d.med.unit)}</button>`).join('')}
            </div>` : (nd ? `
            <div class="v">${escapeHtml(D.fmtDoseCount(d.med, nd.dose, d.containers))} · ${D.fmtDateShort(nd.date)}</div>
            ${locOn && nd.location ? `<div class="vsub">${escapeHtml(nd.location)}</div>` : ''}` : `<div class="v dim">—</div>`);

        const estCount = d.doseLog.filter(x => x.estimated).length;
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
                    // prefer the anchored list so "before bed" survives into the
                    // "usually …" line; falls back to plain times for detected schedules,
                    // which have no anchors because the user never named them
                    : ((nd.usualSlots && nd.usualSlots.length) || (nd.usualTimes && nd.usualTimes.length)
                        ? ` · usually ${(nd.usualSlots || nd.usualTimes.map(t => ({ time: t })))
                            .map(sl => D.slotLabel(sl, set)).join(' / ')}${nd.scheduleSource === 'auto' ? ' (detected)' : ''}`
                        : '');
                let lateHtml = '';
                if (late) {
                    const days = late.daysLate < 1.5 ? `${Math.round(late.daysLate * 24)} h` : `${Math.round(late.daysLate)} days`;
                    const info = late.info;
                    const advice = late.action === 'take'
                        ? `Official guidance: it's OK to take it now${info && info.takeWithinDays ? ` (within ${D.fmtDur(info.takeWithinDays)})` : ''}, then continue your usual schedule.`
                        : (info ? info.note : 'This late, it\'s usually best to skip to your next scheduled dose.');
                    lateHtml = `<div class="container-hint warn late-hint">
                        <div><strong>${days} overdue.</strong> ${escapeHtml(advice)}
                        ${info && info.sourceUrl ? ` <a class="src-link" href="${escapeHtml(window.UI.safeUrl(info.sourceUrl))}" target="_blank" rel="noopener">Source: ${escapeHtml(info.sourceLabel || 'official guidance')} ↗</a>` : ''}
                        <span class="disclaimer">We're not doctors — check the source or ask your pharmacist.</span></div>
                    </div>`;
                }
                // multi-daily meds: the TIME is the headline, the day is secondary
                const multiDaily = (d.med.frequency || 7) < 0.95;
                // With an anchor the NAME is the headline — "Before bed" is what the user
                // recognises, and the clock time follows underneath. Without one the
                // existing behaviour is unchanged.
                const anch = D.anchorLabel(nd.anchor);
                const bigAnchor = anch ? anch.charAt(0).toUpperCase() + anch.slice(1) : '';
                const big = late ? 'Overdue'
                    : (bigAnchor || (multiDaily ? D.fmtTimeStr(nd.time, set) : D.dayLabel(nd.date)));
                const small = late ? ''
                    : (bigAnchor ? `${D.fmtTimeStr(nd.time, set)} · ${D.dayLabel(nd.date)}`
                        : (multiDaily ? D.dayLabel(nd.date) : D.fmtTimeStr(nd.time, set)));
                return `
                <div class="when-line">
                    <span class="when-day ${late ? 'overdue' : ''}">${big}</span>
                    ${small ? `<span class="when-time">${small}</span>` : ''}
                </div>
                <div class="when-sub">${late ? 'was due ' : ''}${D.fmtDate(nd.date, set)}${multiDaily && !late ? '' : ' · ' + D.fmtTimeStr(nd.time, set)} · ${escapeHtml(D.fmtDoseCount(d.med, nd.dose, d.containers))}${locOn && nd.location ? ' · ' + escapeHtml(nd.location) : ''}${usual}</div>
                ${lateHtml}`;
            })() : `
                <div class="when-line"><span class="when-day dim">—</span></div>
                <div class="when-sub">Log your first ${d.isInjection ? 'entry' : 'dose'} to see predictions</div>`}
            <div class="dose-meta">
                <div class="meta-cell">
                    <div class="k">Last ${d.isInjection ? 'entry' : 'dose'}</div>
                    ${d.lastEntry ? `
                        <div class="v">${escapeHtml(D.fmtDoseCount(d.med, d.lastEntry.dose, d.containers))} · ${D.fmtDateShort(d.lastEntry.date)}</div>
                        ${locOn && d.lastEntry.location ? `<div class="vsub">${escapeHtml(d.lastEntry.location)}</div>` : ''}`
                        : '<div class="v dim">—</div>'}
                </div>
                <div class="meta-cell">
                    <div class="k">Est. med level</div>
                    <div class="v tabular-mono">${currentLevel == null ? '<span class="dim">—</span>' : D.fmtAmount(currentLevel) + ' <span class="dim-sm">' + escapeHtml(d.med.unit) + '</span>'}</div>
                    <div class="vsub">half-life ${D.fmtDur(d.med.halfLife)}${d.med.dose2halfLife ? ' · per-dose' : ''}</div>
                </div>
                <div class="meta-cell">
                    <div class="k k-flex"><span>Next ${d.isInjection ? 'entry' : 'dose'}</span>
                        ${nd && !(nd.usualTimes && nd.usualTimes.length) ? `<button class="link" data-action="toggle-next-dose-pick">${local.pickingNextDose ? 'cancel' : 'change'}</button>` : ''}
                    </div>
                    ${dosePicker}
                </div>
                ${(() => {
                    // est. peak / low between now and the next dose — same numbers
                    // as the meds page, so the dashboard tells the whole story
                    const ext = d.doseLog.length ? D.levelExtremes(d.doseLog, d.med, nd ? new Date(nd.date).getTime() : null) : null;
                    if (!ext) return '';
                    const fmtV = v => v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2);
                    const ttp = d.med.timeToPeak;
                    return `
                <div class="meta-cell">
                    <div class="k">Est. peak</div>
                    <div class="v tabular-mono">${fmtV(ext.peak.v)} <span class="dim-sm">${escapeHtml(d.med.unit)}</span></div>
                    <div class="vsub">@ ${D.fmtTime(ext.peak.ts, set)}${ttp ? ` · peaks ${D.fmtDur(ttp)} after a dose` : ''}</div>
                </div>
                <div class="meta-cell">
                    <div class="k">Est. low</div>
                    <div class="v tabular-mono">${fmtV(ext.low.v)} <span class="dim-sm">${escapeHtml(d.med.unit)}</span></div>
                    <div class="vsub">@ ${D.fmtTime(ext.low.ts, set)}</div>
                </div>`;
                })()}
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
            ${d.latest && d.startKg != null && Math.abs(d.totalChange) > 0.04 ? (() => {
                const dir = d.changeDir(d.totalChange);
                const gained = d.totalChange > 0;
                // colour by whether it moved TOWARD the goal, not by which way it moved;
                // with no goal set there is nothing to be good or bad about, so stay neutral
                const tone = dir > 0 ? 'pos' : dir < 0 ? 'neg' : 'neutral';
                return `<div class="stat-delta ${tone}" style="margin-top:8px">
                    ${gained ? Icons.arrowUp : Icons.arrowDn} ${D.fmtWeight(Math.abs(d.totalChange), unit, true)} ${gained ? 'gained' : 'lost'}${
                    d.goalReached ? ' <span class="dim-sm">· goal reached</span>'
                        : d.toGo != null && d.toGo > 0.04 ? ` <span class="dim-sm">· ${D.fmtWeight(d.toGo, unit, true)} to go</span>` : ''}
                </div>`;
            })() : ''}
            ${d.bmi != null ? `<div class="stat-delta ${d.bmiBand ? d.bmiBand.tone : 'neutral'}" style="margin-top:4px">
                BMI ${d.bmi.toFixed(1)}${d.bmiBand ? ` <span class="dim-sm">· ${escapeHtml(d.bmiBand.label)}</span>` : ''}
                <button class="link bmi-info" data-action="bmi-info" title="What BMI does and does not tell you">?</button>
            </div>` : ''}
            ${d.goalKg != null && d.startKg != null ? `
                <div class="progress-track"><div class="progress-fill" style="width:${d.progress}%"></div></div>
                <div class="progress-ends"><span>${D.fmtWeight(d.startKg, unit, true)}</span><span>goal ${D.fmtWeight(d.goalKg, unit, true)}</span></div>` : ''}
        </div>`;
    }

    function supplyCardHtml(d) {
        if (!d.med) return '';
        // works for every type: containers, pill packs, patch boxes, gel bottles…
        const cn = D.containerName(d.med);
        const sortedDoses = Object.keys(d.supplyMap).map(Number).sort((a, b) => a - b);
        const pillCls = d.totalSupply === 0 ? 'danger' : d.totalSupply <= 2 ? 'warn' : 'success';
        const doseWord = d.med.type === 'pill' ? 'tablet' : 'dose';

        // flexible meds (pills etc.) serve any dose from any strength, so the
        // "in progress" pack doesn't need to match the next dose exactly
        const flexibleFoot = d.med.splitDose || (d.med.type && d.med.type !== 'injection');
        const targetInProgress = d.containers.find(p => (flexibleFoot || p.dose === d.targetDose) && p.openedDate && p.used < p.capacity - 0.001 && !p.exhaustedDate);
        const targetUnopened = d.containers.find(p => (flexibleFoot || p.dose === d.targetDose) && !p.openedDate && !p.exhaustedDate);
        const footPen = targetInProgress || targetUnopened;
        let footHtml = '';
        if (footPen) {
            const isOpen = !!targetInProgress;
            const firstDoseDate = footPen.openedDate || (d.nextDose ? d.nextDose.date : new Date());
            // empties when the drug amount runs out at the SCHEDULED burn rate —
            // a 3-slot/day plan empties a pack far faster than 1-per-interval
            const isPrn = D.isPRN(d.med);
            const freq = isPrn ? NaN : D.freqOf(d.med);
            const slots = D.getScheduleSlots(d.med);
            const dailyUse = isPrn ? 0
                : (freq < 0.95 && slots.length >= 2)
                    ? slots.reduce((a, sl) => a + (sl.dose != null ? sl.dose : d.targetDose || 0), 0)
                    : (d.targetDose || 0) / Math.max(freq, 1 / 24);
            const remainingAmt = Math.max(0, footPen.capacity - footPen.used) * (footPen.dose || 0);
            const estDays = dailyUse > 0 ? remainingAmt / dailyUse
                : Math.max(0, Math.ceil(footPen.capacity - footPen.used) - 1) * freq;
            const est = new Date(new Date(firstDoseDate).getTime() + estDays * 86400000);
            // An empties-on date is a prediction, and predicting one for an as-needed med
            // means inventing how often it gets taken. Show what is actually left instead.
            const rightCell = isPrn
                ? `<div class="k">Doses left</div><div class="v">${Math.max(0, Math.floor((footPen.capacity - footPen.used) + 1e-6))}</div>`
                : `<div class="k">${cn.charAt(0).toUpperCase() + cn.slice(1)} empties</div><div class="v">${D.fmtDateShort(est)}</div>`;
            footHtml = `<div class="container-foot">
                <div><div class="k">${isOpen ? 'In progress' : 'Will open'}</div>
                    <div class="v">${footPen.dose}${escapeHtml(d.med.unit)} · ${(Math.round((footPen.capacity - footPen.used) * 10) / 10)}/${footPen.capacity} left</div></div>
                <div style="text-align:right">${rightCell}</div>
            </div>`;
        }

        return `<div class="card container-card">
            <div class="card-head">
                <div class="card-title">Supply</div>
                <span class="pill ${pillCls}"><span class="pill-dot"></span>${d.totalSupply} ${doseWord}${d.totalSupply === 1 ? '' : 's'} left</span>
            </div>
            ${sortedDoses.length ? `<div class="supply-grid">
                ${sortedDoses.map(x => {
                    const isNext = d.targetDose === x;
                    const isInUse = d.inProgressPen && d.inProgressPen.dose === x;
                    const containerCount = d.containers.filter(p => p.dose === x && !p.exhaustedDate && (p.capacity - p.used) > 0.001).length;
                    const sub = [`${containerCount} ${D.containerPlural(d.med, containerCount)}`, isNext ? 'next dose' : (isInUse ? 'in use' : null)].filter(Boolean).join(' · ');
                    return `<div class="supply-cell ${isNext ? 'active' : ''}">
                        <div class="sc-dose">${x}${escapeHtml(d.med.unit)}</div>
                        <div class="sc-num">${d.supplyMap[x]}</div>
                        <div class="sc-sub">${sub}</div>
                    </div>`;
                }).join('')}
            </div>` : `<div class="empty pad-sm"><div class="em-title">Nothing in supply</div><div class="em-sub">Add a ${cn === 'container' ? 'package' : cn} to start tracking</div></div>`}
            ${footHtml}
            <div class="btn-row">
                <button class="btn grow" data-action="add-containers">${Icons.plus} Add to supply</button>
            </div>
        </div>`;
    }

    function statsGridHtml(d) {
        const unit = d.s.settings.weightUnit;
        const f = kg => kg == null ? '—' : D.fmtWeight(kg, unit);
        const tone = delta => { const dir = d.changeDir(delta); return dir > 0 ? 'pos' : dir < 0 ? 'neg' : 'neutral'; };
        const cards = [
            { label: 'Start', value: f(d.startKg) },
            { label: 'Current', value: d.latest ? f(d.latest.kg) : '—' },
            { label: 'Goal', value: f(d.goalKg) },
            { label: 'To go', value: d.goalReached ? 'reached' : d.toGo != null ? f(d.toGo) : '—', hint: d.goalKg != null ? `${d.progress.toFixed(0)}% of goal` : null },
            // `totalChange` is signed with positive = gained, so the label follows the movement and
            // the colour follows whether that movement was toward the goal.
            { label: d.totalChange > 0 ? 'Total gained' : 'Total lost', value: f(Math.abs(d.totalChange)), moved: d.totalChange, delta: tone(d.totalChange), deltaText: Math.abs(d.totalChange) > 0.04 ? (d.totalChange > 0 ? 'up' : 'down') : '' },
            { label: 'This week', value: f(Math.abs(d.changeThisWeek)), moved: d.changeThisWeek, delta: tone(d.changeThisWeek), deltaText: Math.abs(d.changeThisWeek) > 0.04 ? (d.changeThisWeek > 0 ? 'up' : 'down') : 'flat' },
            { label: 'Avg weekly', value: f(d.avgWeekly), hint: 'rolling' },
            ...(d.s.settings.medsTrackingEnabled !== false
                ? [{ label: 'Doses logged', value: String(d.doseLog.length), unitTxt: d.med ? d.med.name.toLowerCase() : '' }] : []),
        ];
        return `<div class="stats-grid">
            ${cards.map(c => `<div class="card stat">
                <div class="stat-label">${c.label}</div>
                <div class="stat-value">${c.value}${c.unitTxt ? `<span class="unit">${escapeHtml(c.unitTxt)}</span>` : ''}</div>
                ${c.delta && c.deltaText ? `<div class="stat-delta ${c.delta}">${
                    // the arrow shows which way the weight actually moved; the colour class
                    // separately shows whether that was toward the goal
                    c.moved == null || Math.abs(c.moved) <= 0.04 ? '' : c.moved > 0 ? Icons.arrowUp : Icons.arrowDn
                }${c.deltaText}</div>` : ''}
                ${c.hint ? `<div class="stat-delta neutral">${c.hint}</div>` : ''}
            </div>`).join('')}
        </div>`;
    }

    function calendarCardHtml(d) {
        // the Calendar page has no bottom-nav slot on mobile — this button is
        // the mobile route to the full calendar + upcoming/recent timeline
        return `<div class="card calendar-card" id="dashCalendar">${miniCalendarHtml(d, local.calMonth)}
            <button class="btn small ghost cal-full-btn" data-action="goto-calendar">Full calendar & timeline ${Icons.chevR}</button></div>`;
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
        d.doseLog.forEach(x => { doseMap[x.date] = x; });
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

    /**
     * A chart series for ONE substance, summed across every product feeding it.
     *
     * The unit is mg of FREE BASE, which is deliberately not any product's label unit:
     * a Vyvanse dose and a dexamfetamine tablet cannot be added in label mg without
     * being wrong by about 27%. The header says "mg of dexamfetamine" for
     * exactly that reason.
     *
     * @returns {object} a generic series — see `normSeries` in charts.js
     */
    const SUB_COLOURS = ['#5fc8c8', '#c084fc', '#f0b955', '#6fcf97', '#f48fb1', '#7dd3fc'];

    function substanceSeries(chip, state, settings, index) {
        const PK = window.PK;
        const row = chip.row;
        const sub = row.substance;
        const medById = new Map(state.meds.map(m => [m.id, m]));
        const contributingIds = new Set(row.events.map(e => e.medId));
        const doses = state.shots.filter(x => contributingIds.has(x.medId));
        // One critical sample per absorption event, at that event's own peak. The
        // routes have different ka (0.68 via Vyvanse, 1.22 for the IR tablet), so a
        // single shared offset would step straight over one of the two peaks.
        const critTimes = row.events.map(e => {
            const tm = PK.tmaxOf(e.ka, e.ke);
            return tm > 0 ? e.ts + tm * PK.MS_PER_HOUR : e.ts;
        });
        return {
            key: 'sub:' + sub.id,
            name: sub.name,
            unit: 'mg',
            // Several substances on one chart need to be told apart, and the first
            // contributing product's colour is the one the user already associates
            // with it. A palette entry is the fallback, never a random hue.
            baseColor: (() => {
                const first = medById.get((row.events[0] || {}).medId);
                return (first && first.color) || SUB_COLOURS[(index || 0) % SUB_COLOURS.length];
            })(),
            modelled: true,
            doses, critTimes,
            level: ts => PK.levelAt(row, ts),
            // Where it came from, at the moment being hovered. This is the answer to
            // "why is my dexamfetamine higher than my Vyvanse dose explains".
            breakdown: (ts) => {
                const parts = PK.contributionsAt(row, ts);
                if (parts.length < 2) return '';
                return parts.map(pt => {
                    const med = medById.get(pt.medId);
                    return `<div class="t-sub"><span>${escapeHtml(med ? med.name : pt.medId)}</span>` +
                        `<span class="tabular-mono">${D.fmtAmount(pt.amount)} mg</span></div>`;
                }).join('');
            },
        };
    }

    /**
     * Give a single-series chart its therapeutic threshold, if one can be calibrated
     * Mutates the series in place; a no-op when the substance publishes no
     * duration of effect, which is most of them.
     *
     * The distinction matters more than it sounds: the in-system window is about FOUR
     * TIMES the working window for Vyvanse — 50 hours detectable against 2 to 14 hours
     * of demonstrated effect. A chart showing only the first tells someone they are
     * medicated when they are not.
     */
    function attachThreshold(sr, subScope) {
        const PK = window.PK;
        if (!PK || !sr) return;
        let threshold = null, substance = null;

        if (subScope) {
            substance = subScope.row.substance;
            // Two routes can feed one substance with different absorption rates, so
            // there is no single "the" threshold. Calibrate against the route that
            // delivers the MOST base mass — the one whose shape the curve mostly is —
            // rather than averaging two answers into one that describes neither.
            const dominant = subScope.row.events.slice()
                .sort((a, b) => b.baseMg - a.baseMg)[0];
            if (dominant) {
                threshold = PK.effectThreshold(
                    substance, { ka: dominant.ka, ke: dominant.ke }, dominant.baseMg * dominant.F,
                    dominant.durationH);
            }
        } else if (sr.med) {
            const pk = window.MedData.medPkParams(sr.med);
            substance = pk && pk.substance;
            threshold = window.MedData.medEffectThreshold(sr.med, sr.doseLog);
        }
        if (!(threshold > 0) || !substance) return;

        sr.threshold = threshold;
        const levelFn = sr.level || (ts => window.MedData.medLevelAt(sr.doseLog, sr.med, ts));
        sr.crossingTs = PK.nextCrossingBelow(levelFn, threshold, Date.now(), 72);
        sr.thresholdNote = substance.acuteTolerance
            // Not folded into the threshold as a multiplier: the published duration was
            // measured in people who already have this tolerance, so calibrating to it
            // contains the effect once. Saying it twice would be double-counting, and
            // choosing by how much would mean inventing a number.
            ? 'the felt effect often fades before the level does'
            : '';
    }

    /** "How is the pain now?" for each pain-med dose that should be working by now. */
    function painFollowUpHtml(s) {
        const P = window.Pain;
        if (!P || !s.settings.painTrackingEnabled) return '';
        const due = P.followUps(s, Date.now(), D.medPeakHours, P.dismissedFollowUps()).filter(f => f.due);
        if (!due.length) return '';
        return `<div class="card pain-followup">
            <div class="card-head"><div class="card-title">How is the pain now?</div></div>
            ${due.map(f => `<div class="pf-row">
                <div class="pf-text"><strong>${escapeHtml(f.med.name)}</strong> ${escapeHtml(window.UI.whenAgo(f.dose.timestamp))}
                    <div class="dim-sm">Before: ${escapeHtml(String(f.before.score))}/10${f.before.areas && f.before.areas.length
                        ? ' · ' + escapeHtml(f.before.areas.map(P.areaLabel).join(', ')) : ''}</div></div>
                <button class="btn primary" data-action="pain-followup" data-id="${escapeHtml(f.dose.id)}">Re-rate</button>
                <button class="btn ghost" data-action="pain-followup-skip" data-id="${escapeHtml(f.dose.id)}">Skip</button>
            </div>`).join('')}
        </div>`;
    }

    /** Pain over time: scores, each day's worst, and when pain medicine was taken. */
    function painTrendHtml(s) {
        const P = window.Pain, PC = window.PainChart;
        if (!P || !PC || !s.settings.painTrackingEnabled) return '';
        const pains = (s.pains || []).filter(p => p && p.kind === 'pain');
        if (!pains.length) return '';
        const to = Date.now(), from = to - local.painRange * 86400000;
        const top = P.suggestAreas(pains, to, 5);
        if (local.painArea && !top.some(a => P.areaKey(a) === local.painArea)) local.painArea = null;
        const shown = local.painArea ? pains.filter(p => (p.areas || []).some(a => P.areaKey(a) === local.painArea)) : pains;
        const painMeds = new Set((s.meds || []).concat(s.trashedMeds || []).filter(P.isPainMed).map(m => m.id));
        const doseTimes = (s.shots || []).filter(x => painMeds.has(x.medId)).map(x => x.timestamp);
        const svg = PC.painChartSvg(shown, doseTimes, { from, to });
        return `<div class="card pain-trend">
            <div class="card-head wrap"><div class="card-title">Pain over time</div>
                <div class="range-tabs">${[[7, '7d'], [30, '30d'], [90, '90d'], [365, '1Y']].map(([k, l]) =>
                    `<button class="${local.painRange === k ? 'active' : ''}" data-action="pain-range" data-range="${k}">${l}</button>`).join('')}</div>
            </div>
            ${top.length > 1 ? `<div class="chip-grp chart-scope">
                <button class="chip sm ${!local.painArea ? 'active' : ''}" data-action="pain-area" data-id="">All areas</button>
                ${top.map(a => `<button class="chip sm ${local.painArea === P.areaKey(a) ? 'active' : ''}" data-action="pain-area" data-id="${escapeHtml(P.areaKey(a))}">${escapeHtml(P.areaLabel(a))}</button>`).join('')}
            </div>` : ''}
            ${svg || '<div class="empty"><div class="em-title">No pain logged in this range</div></div>'}
            ${svg && doseTimes.length ? '<div class="dim-sm">Ticks along the bottom: when a pain medicine was taken.</div>' : ''}
        </div>`;
    }

    /** On a pain med's card: per area, how it has gone, and a verdict only with enough pairs. */
    function painHelpHtml(s, m) {
        const P = window.Pain;
        if (!P || !s.settings.painTrackingEnabled || !P.isPainMed(m)) return '';
        const rows = P.helpSummary(s, m.id);
        if (!rows.length) return `<div class="mc-help dim-sm">Log a pain before taking it and you will be asked how it is
            once ${escapeHtml(m.name)} should be working. After ${P.MIN_PAIRS} of those, this says whether it helps.</div>`;
        return `<div class="mc-help"><div class="k">Did it help?</div>${rows.map(r => {
            const verdict = r.change === 'better' ? '<span class="txt-success">usually helps</span>'
                : r.change === 'worse' ? '<span class="txt-danger">usually worse after</span>'
                : r.change === 'same' ? '<span class="dim">no real change</span>'
                : `<span class="dim">${r.n} of ${P.MIN_PAIRS} needed</span>`;
            return `<div class="mh-row"><span>${escapeHtml(P.areaLabel(r.area))}</span>
                <span>${r.before} → ${r.after}</span><span>${verdict}</span></div>`;
        }).join('')}<div class="dim-sm">Averages of your before and after scores. About 2 points or 30% is a change people notice (Farrar et al. 2001).</div></div>`;
    }

    function renderDashboard(el) {
        const d = derive();
        const set = d.s.settings;
        const showWeight = set.weightTrackingEnabled !== false;
        const showMeds = set.medsTrackingEnabled !== false;
        const showPain = !!set.painTrackingEnabled;

        const medRange = set.medRange || 'm';
        const projDays = (set.medProjection == null || set.medProjection === 'auto')
            ? (window.Charts.AUTO_PROJ[medRange] != null ? window.Charts.AUTO_PROJ[medRange] : 7)
            : Math.max(0, Number(set.medProjection) || 0);

        // which meds the level chart shows: all-in-one (default), a category
        // group ('cat:ADHD' — e.g. total stimulant picture), or a single med
        const multiMed = d.s.meds.length > 1;
        // Defined here so both chip rows below build the identical thing — the two
        // copies drifted apart the last time this had a second render path.
        const subChipHtml = c => `<button class="chip sm sub-scope${
            (set.medSubstances || []).includes(c.id) ? ' active' : ''}${c.optIn ? ' opt-in' : ''}"
            data-action="med-scope" data-id="sub:${escapeHtml(c.id)}" title="${escapeHtml(
                c.optIn ? 'Off by default. ' + ((c.row.substance.note || '').slice(0, 160))
                : c.isPrecursor && !c.viaConv
                    ? 'What you actually swallowed, before your body converts it'
                : c.medCount >= 2
                    ? c.medCount + ' of your meds deliver this — one curve, because your body cannot tell them apart'
                    : 'What this product actually becomes in you')}">${
            escapeHtml(c.row.substance.name)}${c.medCount >= 2 ? ` <span class="dim-sm">x${c.medCount}</span>` : ''}${
            c.optIn ? ' <span class="dim-sm">?</span>' : ''}</button>`;
        const medCat = m => m.category || 'Other';
        // categories the user has 2+ meds in get their own group chip
        const groupCats = D.CATEGORY_ORDER.filter(cat => d.s.meds.filter(m => medCat(m) === cat).length >= 2);
        // A substance scope answers a question no per-product view can: how much
        // dexamfetamine is in me, when two different products both deliver it and the
        // body cannot tell them apart. Two separate curves let someone read "Vyvanse
        // fine, dex fine" while the sum is above either.
        //
        // A chip appears only where the substance view says something the med view does
        // not: the substance is fed by MORE THAN ONE product, or it arrives by
        // CONVERSION (Vyvanse is lisdexamfetamine on the box and dexamfetamine in you).
        // A plain one-product-one-molecule med gets no chip — it would be the same line
        // twice.
        // TWO loads: what is drawn by default, and everything that could
        // be. The difference is the conversion edges marked `plotByDefault: false` —
        // codeine's morphine curve is the case, and it stays off until asked for
        // because a 3x conversion spread times a 45x phenotype spread means any single
        // number misleads. Asking for it is allowed; being given it silently is not.
        const subLoad = window.PK ? window.PK.buildLoad(d.s.meds, d.s.shots) : new Map();
        const subLoadAll = window.PK
            ? window.PK.buildLoad(d.s.meds, d.s.shots, { includeUnplotted: true }) : new Map();
        // Which substances are somebody ELSE's source — the prodrug half of a pair.
        // The requirement is to show both the release rate and the prodrug itself.
        // Lisdexamfetamine is one med, one molecule, no conversion INTO it, so none
        // of the other rules would offer it a chip.
        const precursors = new Set();
        subLoadAll.forEach(row => row.events.forEach(e => {
            if (e.via) precursors.add(String(e.via).split('->')[0]);
        }));

        const subChips = [];
        subLoadAll.forEach((row, id) => {
            if (!row.events.length) return;
            const medCount = new Set(row.events.map(e => e.medId)).size;
            const viaConv = row.events.some(e => e.via);
            const optIn = !subLoad.has(id);      // only reachable by an unplotted edge
            const isPrecursor = precursors.has(id);
            if (medCount >= 2 || viaConv || optIn || isPrecursor) {
                subChips.push({ id, row, medCount, viaConv, optIn, isPrecursor });
            }
        });
        const subById = new Map(subChips.map(c => [c.id, c]));

        // A non-empty selection puts the chart in substance mode. One rule, no mode
        // switch, nothing to get stuck in.
        const chosenSubs = (set.medSubstances || []).filter(x => subById.has(x));
        const subSeriesChips = chosenSubs.map(x => subById.get(x));

        const rawScope = set.medLevelScope;
        const scope = (multiMed && rawScope && rawScope !== 'all'
                && (rawScope.startsWith('cat:') ? groupCats.includes(rawScope.slice(4)) : d.s.meds.some(m => m.id === rawScope))
                ? rawScope : 'all');
        const subScope = subSeriesChips.length === 1 ? subSeriesChips[0] : null;
        const scopedMeds = subSeriesChips.length ? []
            : scope === 'all' ? d.s.meds
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
                    ${subChips.map(subChipHtml).join('')}
                </div>` : subChips.length ? `<div class="chip-grp chart-scope">
                    <button class="chip sm ${!chosenSubs.length ? 'active' : ''}" data-action="med-scope" data-id="all">By product</button>
                    ${subChips.map(subChipHtml).join('')}
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
                        <button class="chip sm ${set.medYFit ? 'active' : ''}" data-action="med-yfit" title="Start the axis just below your lowest level instead of at 0 — same breathing room below the dips as above the peaks">Fit</button>
                        <button class="chip sm ${set.medShowDots !== false ? 'active' : ''}" data-action="med-dots" title="Dots along the bottom mark each logged dose">Dots</button>
                        ${scopedSingle ? `<input class="ystep-input ${hasCustomStep ? 'active' : ''}" type="number" min="0" step="0.1" inputmode="decimal"
                            placeholder="step ${escapeHtml(scopedSingle.unit)}" value="${hasCustomStep ? scopedSingle.graphStep : ''}"
                            data-ystep data-id="${escapeHtml(scopedSingle.id)}" title="Exact spacing, e.g. 2 → 0/2/4/6 ${escapeHtml(scopedSingle.unit)}">` : ''}
                    </div>
                </div>
            </div>`;

        const medLevelSection = showMeds && set.showMedLevel && d.med ? `
            <div class="card">
                <div class="card-head wrap">
                    <div>
                        <div class="card-title">Estimated medication level</div>
                        <div class="chart-sub">${(() => {
                            // A substance scope is one line in mg of free base, which is a
                            // different unit from anything on a product's box. Say so, every time.
                            if (subSeriesChips.length > 1) {
                                return `<span class="dim-sm">${subSeriesChips.length} substances shown</span>
                                    ${subSeriesChips.some(c => c.optIn)
                                        ? '<span class="pill warn sm">includes an estimate that is off by default</span>' : ''}
                                    ${projDays > 0 ? `<span class="pill" title="Change in Settings → Dashboard layout">+${projDays}d ahead</span>` : ''}`;
                            }
                            if (subScope) {
                                const lvl = window.PK.levelAt(subScope.row, Date.now());
                                const sub = subScope.row.substance;
                                return `<span class="tabular-mono big-num">${D.fmtAmount(lvl)}</span>
                                    <span class="dim-sm">mg of ${escapeHtml(sub.name.toLowerCase())} now</span>
                                    ${subScope.medCount >= 2
                                        ? `<span class="pill accent">${subScope.medCount} meds combined</span>`
                                        : subScope.viaConv ? '<span class="pill">converted</span>' : ''}
                                    ${sub.verified ? '' : '<span class="pill warn sm">unsourced</span>'}
                                    ${projDays > 0 ? `<span class="pill" title="Change in Settings → Dashboard layout">+${projDays}d ahead</span>` : ''}`;
                            }
                            // The headline has to describe what the LINES show — that is `scopedMeds`,
                            // set by this chart's own scope chips — not the dashboard's active med.
                            // Reading d.med here put Vyvanse's number, unit and half-life above a
                            // Concerta curve whenever the two selections disagreed.
                            const modelled = scopedMeds.filter(m => D.hasPharmacokinetics(m));
                            if (!modelled.length) {
                                return `<span class="dim-sm">No half-life recorded${
                                    scopedSingle ? ' for ' + escapeHtml(scopedSingle.name) : ''} — level can't be estimated</span>`;
                            }
                            // one med in scope: its own number, unit and half-life
                            if (modelled.length === 1) {
                                const m = modelled[0];
                                const lvl = D.medLevelAt(window.Store.medDoses(m.id), m, Date.now());
                                return `<span class="tabular-mono big-num">${D.fmtAmount(lvl)}</span>
                                    <span class="dim-sm">${escapeHtml(m.unit)} now${multiMed ? ' (' + escapeHtml(m.name) + ')' : ''}</span>
                                    <span class="pill">half-life ${D.fmtDur(m.halfLife)}${m.dose2halfLife ? ' · per-dose' : ''}</span>
                                    ${projDays > 0 ? `<span class="pill" title="Change in Settings → Dashboard layout">+${projDays}d ahead</span>` : ''}`;
                            }
                            // several in scope: units may differ, so summing them would be meaningless
                            const hidden = scopedMeds.length - modelled.length;
                            return `<span class="dim-sm">${modelled.length} meds shown${
                                hidden > 0 ? ` · ${hidden} without a half-life hidden` : ''}</span>
                                ${projDays > 0 ? `<span class="pill" title="Change in Settings → Dashboard layout">+${projDays}d ahead</span>` : ''}`;
                        })()}</div>
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
                                ${Math.abs(d.changeThisWeek) > 0.05 && d.changeDir(d.changeThisWeek) > 0 ? `<span class="pill success">${d.changeThisWeek > 0 ? Icons.arrowUp : Icons.arrowDn} ${D.fmtWeight(Math.abs(d.changeThisWeek), set.weightUnit, true)} this week</span>` : ''}
                            </div>
                        </div>
                        <div class="range-tabs">
                            ${[['w', '7d'], ['14', '14d'], ['m', '1M'], ['3m', '3M'], ['6m', '6M'], ['y', '1Y'], ['all', 'All']].map(([k, l]) =>
                                `<button class="${set.weightRange === k ? 'active' : ''}" data-action="weight-range" data-range="${k}">${l}</button>`).join('')}
                        </div>
                    </div>
                    <div class="chart-wrap tall" id="weightChart"></div>
                </div>
                ${showMeds && set.showCalendar ? calendarCardHtml(d) : ''}
            </div>` : (showMeds && set.showCalendar ? `<div class="main-grid">${calendarCardHtml(d)}</div>` : '');

        const sections = set.chartOrder === 'weight-first'
            ? [weightSection, medLevelSection] : [medLevelSection, weightSection];

        // all-meds overview replaces the single-med hero when selected. Counts the meds
        // actually being taken: with one live med and three stopped ones, an overview
        // table of one row is worse than the single-med hero.
        const allMode = showMeds && window.Store.activeMeds().length > 1 && set.dashAll !== false;
        const heroHtml = !showMeds
            ? (showWeight ? `<div class="hero-grid no-meds">${weightCardHtml(d)}</div>` : '')
            : allMode
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
            ${showMeds ? medSwitcherHtml(d, true) : ''}
            ${allMode || !showMeds ? '' : bannerHtml(d)}
            ${!showMeds && !showWeight && !showPain ? `<div class="card empty"><div class="em-title">Nothing is being tracked</div>
                <div class="dim-sm">Turn on medications, weight or pain in Settings.</div></div>` : ''}
            ${heroHtml}
            <div class="quick-row ${showWeight && showMeds ? '' : 'single'}">
                ${allMode || !showMeds ? '' : `
                <button class="quick-btn" data-action="log-entry" ${!d.med ? 'disabled' : ''}>
                    <span class="qicon">${Icons.syringe}</span>
                    <span class="qtext">
                        <span class="qlabel">Log ${d.isInjection || !d.med ? 'entry' : 'dose'}</span>
                        <span class="qsub">${d.med ? escapeHtml(d.med.name) + ' · ' + (d.lastEntry ? 'last: ' + D.dayLabel(d.lastEntry.date).toLowerCase() : 'no doses yet') : 'add a medication first'}</span>
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
                ${showPain && !showMeds ? `
                <button class="quick-btn" data-action="log-pain">
                    <span class="qicon">${Icons.pain}</span>
                    <span class="qtext"><span class="qlabel">Log pain</span>
                        <span class="qsub">${(d.s.pains || []).length ? (d.s.pains || []).length + ' logged' : 'nothing logged yet'}</span></span>
                    <span class="qarrow">${Icons.chevR}</span>
                </button>` : ''}
            </div>
            ${painFollowUpHtml(d.s)}
            <div class="sections">${sections.filter(Boolean).join('')}</div>
            ${painTrendHtml(d.s)}
            ${showWeight && set.showStats ? statsGridHtml(d) : ''}`;

        const ml = el.querySelector('#medLevelChart');
        if (ml) {
            const Store = window.Store;
            // Several substances at once — lisdexamfetamine falling while
            // dexamfetamine rises — each one its own line.
            const series = subSeriesChips.length
                ? (() => {
                    const built = subSeriesChips.map((c, i) => substanceSeries(c, d.s, set, i));
                    // A prodrug and its metabolite come from the SAME product, so the
                    // "use the contributing med's colour" rule hands them both the same
                    // hue — two lines the user cannot tell apart, which is the one thing
                    // this whole feature exists to avoid. Collisions fall back to the
                    // palette, in order, skipping anything already taken.
                    const used = new Set();
                    built.forEach((sr, i) => {
                        if (!used.has(sr.baseColor)) { used.add(sr.baseColor); return; }
                        sr.baseColor = SUB_COLOURS.find(c => !used.has(c))
                            || SUB_COLOURS[i % SUB_COLOURS.length];
                        used.add(sr.baseColor);
                    });
                    return built;
                })()
                : scopedMeds.map(m => ({ med: m, doseLog: Store.medDoses(m.id) }));
            const single = !subSeriesChips.length && series.length === 1 ? series[0].med : null;
            // The working/detectable split. Only ever on ONE series: two meds in
            // different units cannot share a horizontal line, and drawing one anyway
            // would be a claim about whichever med happened to be first.
            if (series.length === 1) attachThreshold(series[0], subScope);
            window.Charts.medLevel(ml, {
                series, range: medRange, projection: projDays,
                graphStep: single && single.graphStep > 0 ? single.graphStep : null,
                density: set.medYDensity || 'auto',
                fitMin: !!set.medYFit,
                showDots: set.medShowDots !== false,
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
        const showMeds = set.medsTrackingEnabled !== false;
        if (!showMeds && (local.historyTab === 'shots' || local.historyTab === 'pens')) {
            local.historyTab = set.weightTrackingEnabled !== false ? 'weights' : 'pains';
        }
        const tab = local.historyTab;
        // history defaults to EVERY med; picking a med pill filters to it
        const multiMed = d.s.meds.length > 1;
        const allMeds = multiMed && local.historyAllMeds !== false;
        const medById = {};
        d.s.meds.concat(d.s.trashedMeds || []).forEach(m => { medById[m.id] = m; });
        const shotMed = x => medById[x.medId] || d.med;

        const doseLog = allMeds ? d.s.shots.slice().sort((a, b) => b.timestamp - a.timestamp) : d.doseLog;
        const allPens = (allMeds ? d.s.pens.slice() : d.containers.slice()).sort((a, b) => {
            const order = p => p.exhaustedDate ? 2 : (p.openedDate ? 0 : 1);
            if (order(a) !== order(b)) return order(a) - order(b);
            if (a.openedDate && b.openedDate) return +new Date(b.openedDate) - +new Date(a.openedDate);
            return String(a.id).localeCompare(String(b.id));
        });
        const weights = d.weights.slice().sort((a, b) => b.timestamp - a.timestamp);
        const hasEstimated = doseLog.some(x => x.estimated);

        // pagination — page size lives in Settings; page resets on tab/med switch
        const pageSize = Math.max(5, Number(set.historyPageSize) || 20);
        const paginate = arr => {
            const pages = Math.max(1, Math.ceil(arr.length / pageSize));
            const p = Math.min(Math.max(0, local.historyPage || 0), pages - 1);
            local.historyPage = p;
            return { rows: arr.slice(p * pageSize, (p + 1) * pageSize), pages, p, total: arr.length, start: p * pageSize };
        };
        const pagerHtml = pg => pg.pages > 1 ? `
            <div class="pager">
                <button class="btn small ghost" data-action="history-page" data-dir="-1" ${pg.p === 0 ? 'disabled' : ''}>${Icons.chevL} Prev</button>
                <span class="pager-info">${pg.start + 1}–${Math.min(pg.total, pg.start + pageSize)} of ${pg.total}</span>
                <button class="btn small ghost" data-action="history-page" data-dir="1" ${pg.p >= pg.pages - 1 ? 'disabled' : ''}>Next ${Icons.chevR}</button>
            </div>` : '';
        const medCell = x => {
            const m = medById[x.medId];
            return `<td class="med-cell"><span class="ml-dot" style="background:${escapeHtml((m && m.color) || '#5fc8c8')}"></span>${escapeHtml(m ? m.name : '—')}</td>`;
        };

        let body = '';
        if (tab === 'shots') {
            const pg = paginate(doseLog);
            body = `<div class="card table-card">
                ${hasEstimated ? `<div class="table-note">
                    <span>${Icons.wand} Doses marked <span class="pill sm">est</span> were estimated during onboarding.</span>
                    <button class="btn small" data-action="clear-estimated">Remove estimated</button>
                </div>` : ''}
                <div class="tbl-scroll"><table class="tbl">
                    <thead><tr><th>Date</th><th>Time</th>${allMeds ? '<th>Med</th>' : ''}<th>Dose</th>${set.shotLocationTrackingEnabled ? '<th>Location</th>' : ''}<th></th></tr></thead>
                    <tbody>
                    ${pg.total === 0 ? `<tr><td colspan="6"><div class="empty"><div class="em-title">No doses yet</div></div></td></tr>` : ''}
                    ${pg.rows.map(x => `<tr>
                        <td>${D.fmtDate(x.timestamp, set)}</td>
                        <td>${D.fmtTimeStr(x.time, set)}</td>
                        ${allMeds ? medCell(x) : ''}
                        <td>${shotMed(x) ? escapeHtml(D.fmtDoseCount(shotMed(x), x.dose, d.s.pens)) : escapeHtml(String(x.dose)) + 'mg'}${x.estimated ? ' <span class="pill sm">est</span>' : ''}${x.note
                            ? `<div class="dim-sm dose-note">${escapeHtml(x.note)}</div>` : ''}</td>
                        ${set.shotLocationTrackingEnabled ? `<td>${escapeHtml(x.location || '—')}</td>` : ''}
                        <td><div class="tbl-actions">
                            <button data-action="edit-entry" data-id="${escapeHtml(x.id)}" title="Edit">${Icons.edit}</button>
                            <button data-action="delete-entry" data-id="${escapeHtml(x.id)}" title="Delete">${Icons.trash}</button>
                        </div></td>
                    </tr>`).join('')}
                    </tbody>
                </table></div>
                ${pagerHtml(pg)}
            </div>`;
        } else if (tab === 'pains' && window.Pain) {
            const P = window.Pain;
            const pains = (d.s.pains || []).slice().sort((a, b) => b.timestamp - a.timestamp);
            const pg = paginate(pains);
            const label = (o, id) => { const x = o.find(k => k.id === id); return x ? x.label : id; };
            body = `<div class="card table-card"><div class="tbl-scroll"><table class="tbl">
                <thead><tr><th>Date</th><th>Time</th><th>Where</th><th>Pain</th><th>Detail</th><th></th></tr></thead>
                <tbody>
                ${pg.total === 0 ? `<tr><td colspan="6"><div class="empty"><div class="em-title">No pain logged yet</div></div></td></tr>` : ''}
                ${pg.rows.map(x => {
                    const checkin = x.kind === 'checkin';
                    const where = checkin ? '<span class="dim">Daily check-in</span>'
                        : (x.areas && x.areas.length ? escapeHtml(x.areas.map(P.areaLabel).join(', ')) : '<span class="dim">—</span>');
                    const band = !checkin && x.scale === 'dvprs' ? P.dvprsBand(x.score) : null;
                    const score = checkin
                        ? escapeHtml(P.DVPRS_SUPPLEMENTAL.map(q => q.key + ' ' + x[q.key]).join(' · '))
                        : `<span class="pain-score ${band ? 'band-' + band : ''}">${escapeHtml(String(x.score))}/10</span>${x.scale === 'dvprs'
                            ? ' <span class="dim-sm">' + escapeHtml(P.SCALES.dvprs.levels[x.score] || '') + '</span>' : ''}`;
                    const detail = checkin ? '' : [x.type ? label(P.KINDS, x.type) : '', (x.context || []).map(c => label(P.CONTEXTS, c)).join(', '),
                        x.coping ? label(P.COPING, x.coping) : '', x.note || ''].filter(Boolean).map(escapeHtml).join(' · ');
                    return `<tr>
                        <td>${D.fmtDate(x.timestamp, set)}</td>
                        <td>${D.fmtTimeStr(x.time, set)}</td>
                        <td>${where}</td>
                        <td>${score}</td>
                        <td>${detail || '<span class="dim">—</span>'}</td>
                        <td><div class="tbl-actions">
                            <button data-action="edit-pain" data-id="${escapeHtml(x.id)}" title="Edit">${Icons.edit}</button>
                            <button data-action="delete-pain" data-id="${escapeHtml(x.id)}" title="Delete">${Icons.trash}</button>
                        </div></td>
                    </tr>`;
                }).join('')}
                </tbody>
            </table></div>${pagerHtml(pg)}</div>`;
        } else if (tab === 'weights') {
            const pg = paginate(weights);
            body = `<div class="card table-card"><div class="tbl-scroll"><table class="tbl">
                <thead><tr><th>Date</th><th>Time</th><th>Weight</th><th>Δ prev</th><th></th></tr></thead>
                <tbody>
                ${pg.total === 0 ? `<tr><td colspan="5"><div class="empty"><div class="em-title">No weights yet</div></div></td></tr>` : ''}
                ${pg.rows.map((x, i) => {
                    const next = weights[pg.start + i + 1];
                    const delta = next ? x.kg - next.kg : null;
                    return `<tr>
                        <td>${D.fmtDate(x.timestamp, set)}</td>
                        <td>${D.fmtTimeStr(x.time, set)}</td>
                        <td>${D.fmtWeight(x.kg, set.weightUnit, true)}</td>
                        <td>${delta != null && Math.abs(delta) > 0.04
                            ? `<span class="${(() => { const dir = d.changeDir(delta); return dir > 0 ? 'txt-success' : dir < 0 ? 'txt-danger' : 'dim'; })()}">${delta < 0 ? '−' : '+'}${D.fmtWeight(Math.abs(delta), set.weightUnit, true)}</span>`
                            : '<span class="dim">—</span>'}</td>
                        <td><div class="tbl-actions">
                            <button data-action="edit-weight" data-id="${escapeHtml(x.id)}" title="Edit">${Icons.edit}</button>
                            <button data-action="delete-weight" data-id="${escapeHtml(x.id)}" title="Delete">${Icons.trash}</button>
                        </div></td>
                    </tr>`;
                }).join('')}
                </tbody>
            </table></div>${pagerHtml(pg)}</div>`;
        } else {
            const pg = paginate(allPens);
            body = `<div class="card table-card"><div class="tbl-scroll"><table class="tbl">
                <thead><tr>${allMeds ? '<th>Med</th>' : ''}<th>Dose</th><th>Status</th><th>Opened</th><th>Used</th><th>Note</th><th></th></tr></thead>
                <tbody>
                ${pg.total === 0 ? `<tr><td colspan="7"><div class="empty"><div class="em-title">No ${!allMeds && d.med ? D.containerPlural(d.med, 2) : 'supply'} yet</div><div class="em-sub">Add to supply from the dashboard, or import a backup</div></div></td></tr>` : ''}
                ${pg.rows.map(p => {
                    const pm = medById[p.medId] || d.med;
                    const status = p.exhaustedDate ? 'done' : (p.openedDate ? 'in use' : 'unopened');
                    const cells = Math.min(20, Math.ceil(p.capacity));
                    return `<tr>
                        ${allMeds ? medCell(p) : ''}
                        <td>${p.dose}${pm ? escapeHtml(pm.unit) : 'mg'}</td>
                        <td><span class="pill sm ${status === 'in use' ? 'accent' : status === 'done' ? 'warn' : ''}"><span class="pill-dot"></span>${status}</span></td>
                        <td>${p.openedDate ? D.fmtDate(p.openedDate, set) : (p.acquiredDate ? `<span class="dim-sm">got ${D.fmtDateShort(p.acquiredDate)}</span>` : '<span class="dim">—</span>')}</td>
                        <td><span class="used-cells">${(Math.round(p.used * 10) / 10)}/${p.capacity}
                            <span class="pr-cells">${Array.from({ length: cells }).map((_, i) => `<span class="pr-cell ${i < Math.floor(p.used + 0.001) ? 'used' : ''}"></span>`).join('')}</span>
                        </span></td>
                        <td class="dim-sm">${escapeHtml(p.note || '—')}</td>
                        <td><div class="tbl-actions">
                            <button data-action="edit-container" data-id="${escapeHtml(p.id)}" title="Edit">${Icons.edit}</button>
                            <button data-action="delete-container" data-id="${escapeHtml(p.id)}" title="Delete">${Icons.trash}</button>
                        </div></td>
                    </tr>`;
                }).join('')}
                </tbody>
            </table></div>${pagerHtml(pg)}</div>`;
        }

        const switcher = `<div class="med-switcher">
            ${multiMed ? `<button class="med-pill ${allMeds ? 'active' : ''}" data-action="history-all">All meds</button>` : ''}
            ${d.s.meds.map(m => `
                <button class="med-pill ${!allMeds && m.id === d.s.activeMedId ? 'active' : ''}" data-action="select-med" data-id="${escapeHtml(m.id)}">
                    <span class="pill-swatch" style="background:${escapeHtml(m.color || '#5fc8c8')}"></span>${escapeHtml(m.name)}
                </button>`).join('')}
        </div>`;

        el.innerHTML = `
            ${showMeds ? switcher : ''}
            <div class="med-switcher tabs-row">
                ${showMeds ? `<button class="med-pill ${tab === 'shots' ? 'active' : ''}" data-action="history-tab" data-tab="shots">${Icons.syringe} Doses (${doseLog.length})</button>` : ''}
                ${d.s.settings.weightTrackingEnabled !== false ? `<button class="med-pill ${tab === 'weights' ? 'active' : ''}" data-action="history-tab" data-tab="weights">${Icons.scale} Weights (${weights.length})</button>` : ''}
                ${d.s.settings.painTrackingEnabled ? `<button class="med-pill ${tab === 'pains' ? 'active' : ''}" data-action="history-tab" data-tab="pains">${Icons.pain} Pain (${(d.s.pains || []).length})</button>` : ''}
                ${showMeds && (allMeds || d.med) ? `<button class="med-pill ${tab === 'pens' ? 'active' : ''}" data-action="history-tab" data-tab="pens">${Icons.container} Supply (${allPens.length})</button>` : ''}
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
            timeline.push({ date: d.nextDose.date, upcoming: true, title: `${d.med.name} ${D.fmtDoseCount(d.med, d.nextDose.dose, d.containers)}`, sub: `${set.shotLocationTrackingEnabled && d.nextDose.location ? d.nextDose.location + ' · ' : ''}predicted` });
        }
        d.doseLog.slice(0, 10).forEach(x => {
            timeline.push({ date: new Date(x.timestamp), title: `${d.med ? d.med.name + ' ' + D.fmtDoseCount(d.med, x.dose, d.containers) : x.dose}`, sub: `${set.shotLocationTrackingEnabled && x.location ? x.location + ' · ' : ''}${D.fmtTimeStr(x.time, set)}${x.estimated ? ' · est' : ''}` });
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
            const medDoses = Store.medDoses(m.id);
            const medContainers = Store.medContainers(m.id);
            const isInjection = !m.type || m.type === 'injection';
            const supply = D.supplyByDose(medContainers, m.id);
            const totalSupply = Object.values(supply).reduce((a, b) => a + b, 0);
            const expanded = local.expandedMedId === m.id;
            const orphans = medDoses.filter(x => !x.penId).length;

            return `<div class="card med-card${m.stoppedAt ? ' is-stopped' : ''}">
                <div class="mc-head">
                    <div class="mc-id">
                        <span class="mc-swatch" style="background:${escapeHtml(m.color || '#5fc8c8')}22;color:${escapeHtml(m.color || '#5fc8c8')}">${Icons.pill}</span>
                        <div>
                            <div class="mc-name">${escapeHtml(m.name)} <span class="p-type">${escapeHtml(m.type || 'injection')}</span></div>
                            <div class="mc-generic">${escapeHtml(m.generic || 'custom')}</div>
                        </div>
                    </div>
                    ${m.stoppedAt ? `<span class="pill stopped">stopped ${escapeHtml(D.fmtDate(m.stoppedAt, s.settings))}</span>`
                        : m.id === s.activeMedId ? `<span class="pill accent"><span class="pill-dot"></span>active</span>` : ''}
                </div>
                ${(() => {
                    // live numbers: what's in the body right now + where it's heading
                    const set2 = s.settings;
                    const lvl = D.medLevelAt(medDoses, m, Date.now());
                    const lvlHtml = lvl == null
                        ? '<span class="dim">no half-life</span>'
                        : lvl.toFixed(lvl >= 100 ? 0 : 2) + ' ' + escapeHtml(m.unit);

                    // A stopped med has no next dose and no future peak — predicting one
                    // would be inventing a dose the user has decided not to take. What is
                    // still true, and is the reason the med is kept at all, is how much is
                    // in the system and when the last dose was.
                    if (m.stoppedAt) {
                        const last = medDoses[0];
                        return `<div class="mc-facts mc-live">
                            <div><div class="k">In system now</div><div class="txt-accent">${lvlHtml}</div></div>
                            <div><div class="k">Last dose</div><div>${last ? `${D.fmtDate(last.timestamp, set2)} · ${escapeHtml(D.fmtDoseCount(m, last.dose, medContainers))}` : '—'}</div></div>
                            <div><div class="k">Stopped</div><div>${escapeHtml(D.fmtDate(m.stoppedAt, set2))}</div></div>
                            <div><div class="k">Next dose</div><div class="dim">not taking</div></div>
                        </div>`;
                    }

                    // PRN: same shape, but "next dose" is a question the med cannot answer.
                    // Showing when it was last taken is the useful fact instead — it is what
                    // you actually want to know before taking another.
                    if (D.isPRN(m)) {
                        const last = medDoses[0];
                        // How often it is actually being reached for. That is the question
                        // an as-needed med raises and a scheduled one does not — "am I
                        // using this more than I think?" — and it is the number the
                        // minimum-gap warning builds on.
                        //
                        // Counted off `timestamp`, never the local `date` string: `date`
                        // shifts across timezones and would miscount a rolling window.
                        const since = n => medDoses.filter(x => x.timestamp >= Date.now() - n * 86400000).length;
                        const d7 = since(7), d30 = since(30);
                        // A PRN med still has no "next dose" — that stays.
                        // What it CAN answer is the opposite question, the one you
                        // actually ask standing at the cupboard: not when should I, but
                        // when MAY I. Absent guidance stays absent rather than becoming
                        // an invented "any time now".
                        const allowed = D.nextAllowedDose(m, medDoses, s.meds.concat(s.trashedMeds || []), s.shots);
                        const timing = D.hasDoseTiming(m);
                        const whenHtml = !timing
                            ? '<span class="dim">no published limit</span>'
                            : allowed
                                ? `<span class="txt-warn">${D.fmtTime(allowed.at, set2)}${
                                    D.fmtDateShort(allowed.at) !== D.fmtDateShort(Date.now())
                                        ? ' ' + D.fmtDateShort(allowed.at) : ''}</span>
                                   <div class="dim-sm">${allowed.reason === 'gap'
                                        ? 'minimum gap' : 'daily ' + escapeHtml(
                                            (allowed.substance || {}).name || '').toLowerCase() + ' limit'}</div>`
                                : '<span class="txt-success">now</span>';
                        return `<div class="mc-facts mc-live">
                            <div><div class="k">In system now</div><div class="txt-accent">${lvlHtml}</div></div>
                            <div><div class="k">Can take another</div><div>${whenHtml}</div></div>
                            <div><div class="k">Last taken</div><div>${last ? `${window.UI.whenAgo(last.timestamp)} · ${escapeHtml(D.fmtDoseCount(m, last.dose, medContainers))}` : '<span class="dim">never</span>'}</div></div>
                            <div><div class="k">Last 7 days</div><div>${d7 === 0 ? '<span class="dim">none</span>' : `${d7} dose${d7 === 1 ? '' : 's'}`}</div></div>
                            <div><div class="k">Last 30 days</div><div>${d30 === 0 ? '<span class="dim">none</span>' : `${d30} dose${d30 === 1 ? '' : 's'}`}</div></div>
                        </div>
                        ${allowed ? `<button class="prn-remind${m.remindAt > Date.now() ? ' is-set' : ''}"
                            data-action="remind-allowed" data-id="${escapeHtml(m.id)}">
                            ${m.remindAt > Date.now()
                                ? `${Icons.check} Reminder set for ${D.fmtTime(m.remindAt, set2)} — tap to cancel`
                                : `Remind me at ${D.fmtTime(allowed.at, set2)}`}
                        </button>` : ''}`;
                    }

                    const nd2 = D.predictNextDose(m, medDoses, set2);
                    const ext2 = medDoses.length ? D.levelExtremes(medDoses, m, nd2 ? new Date(nd2.date).getTime() : null) : null;
                    return `<div class="mc-facts mc-live">
                        <div><div class="k">In system now</div><div class="txt-accent">${lvlHtml}</div></div>
                        <div><div class="k">Next dose</div><div>${nd2 ? `${D.fmtTimeStr(nd2.time, set2)} ${D.dayLabel(nd2.date).toLowerCase()} · ${escapeHtml(D.fmtDoseCount(m, nd2.dose, medContainers))}` : '—'}</div></div>
                        <div><div class="k">Est. peak</div><div>${ext2 ? `${ext2.peak.v.toFixed(ext2.peak.v >= 100 ? 0 : 1)} @ ${D.fmtTime(ext2.peak.ts, set2)}` : '—'}</div></div>
                        <div><div class="k">Est. low</div><div>${ext2 ? `${ext2.low.v.toFixed(ext2.low.v >= 100 ? 0 : 1)} @ ${D.fmtTime(ext2.low.ts, set2)}` : '—'}</div></div>
                    </div>`;
                })()}
                ${painHelpHtml(s, m)}
                <div class="mc-facts">
                    <div><div class="k">Frequency</div><div>${D.fmtFreq(m.frequency)}</div></div>
                    <div><div class="k">Half-life</div><div>${D.fmtDur(m.halfLife)}${m.dose2halfLife ? ' (varies)' : ''}</div></div>
                    <div><div class="k">Doses logged</div><div>${medDoses.length}</div></div>
                    <div><div class="k">Supply</div><div>${totalSupply} dose${totalSupply === 1 ? '' : 's'}</div></div>
                </div>
                ${(() => {
                    // A preset correction has never reached anyone who
                    // already added that med. Now it does — but only as an offer, and
                    // only for fields the USER owns. Anything the app owns was already
                    // corrected silently on load, with nothing to show here.
                    const ask = D.presetDiff(m).ask;
                    if (!ask.length) return '';
                    return `<button class="recon-prompt" data-action="reconcile-med" data-id="${escapeHtml(m.id)}">
                        <span class="rp-dot"></span>
                        <span>Built-in data for ${escapeHtml(m.name)} has changed
                            <span class="dim-sm">— ${ask.length} value${ask.length === 1 ? '' : 's'}
                            differ${ask.length === 1 ? 's' : ''} from yours</span></span>
                        <span class="dim-sm">review</span>
                    </button>`;
                })()}
                ${(() => {
                    // The only place base mass is shown, and it is shown WITH the
                    // label amount beside it, because the two are different numbers and
                    // both are true: 5 mg on the box is 3.67 mg of dexamfetamine in you.
                    // Everywhere else in the app stays in label units.
                    const example = (m.doses && m.doses.length ? m.doses : [null])[0];
                    const rows = example == null ? [] : D.doseBaseMg(m, example);
                    if (!rows.length) return '';
                    return `<div class="mc-substances">
                        <div class="k">Delivers</div>
                        ${rows.map(r => `<button class="sub-chip" data-action="substance-info"
                            data-sub="${escapeHtml(r.substance.id)}" data-id="${escapeHtml(m.id)}"
                            title="What this is, and where the numbers come from">
                            <span class="sub-name">${escapeHtml(r.substance.name)}</span>
                            <span class="dim-sm">${(() => {
                                // Two different sentences, because these are two
                                // different kinds of product. For a COUNTABLE unit the
                                // useful fact is the strength per tablet — the old
                                // wording produced "22.1 mg base per 30tablet", which
                                // is mg of the substance wearing the product's unit and
                                // means nothing. For a MASS unit the amount already IS
                                // the mass, so "per 1 mg" would be circular.
                                const perUnit = D.fmtAmount(r.labelMg / example) + ' mg';
                                const base = D.fmtAmount(r.baseMg / example) + ' mg base';
                                if (D.isCountableUnit(m.unit)) {
                                    return escapeHtml(perUnit + ' per ' + D.fmtDoseUnit(1, m.unit)
                                        + (r.saltFactor === 1 ? '' : ' · ' + base));
                                }
                                return escapeHtml(r.saltFactor === 1
                                    ? D.fmtDoseUnit(r.labelMg, m.unit)
                                    : D.fmtAmount(r.baseMg) + ' mg base per '
                                      + D.fmtDoseUnit(r.labelMg, m.unit));
                            })()}</span>
                            ${r.substance.verified ? '' : '<span class="pill warn sm">unsourced</span>'}
                        </button>`).join('')}
                    </div>`;
                })()}
                ${expanded ? (() => {
                    // supply list: grouped by strength (each group collapsible),
                    // spent containers tucked into their own collapsed group, and
                    // the whole list scrolls inside the card instead of the page
                    const cnPl = D.containerPlural(m, 2);
                    const rowHtml = p => `
                        <div class="container-row">
                            <span class="pr-dose">${p.dose}${escapeHtml(m.unit)}</span>
                            <span>
                                <span class="pr-used-txt">${Math.round(p.used * 10) / 10}/${p.capacity}</span>
                                <span class="pr-cells">${Array.from({ length: Math.min(20, Math.ceil(p.capacity)) }).map((_, i) => `<span class="pr-cell ${i < Math.floor(p.used + 0.001) ? 'used' : ''}"></span>`).join('')}</span>
                                ${p.note ? `<span class="pr-note">${escapeHtml(p.note)}</span>` : ''}
                            </span>
                            <span class="pr-status ${p.exhaustedDate ? 'exhausted' : (p.openedDate ? 'open' : '')}">${p.exhaustedDate ? 'done' : (p.openedDate ? 'in use' : 'unopened')}</span>
                            <span class="pr-date">${p.openedDate ? D.fmtDateShort(p.openedDate) : (p.acquiredDate ? 'got ' + D.fmtDateShort(p.acquiredDate) : '—')}</span>
                            <span class="pr-actions">
                                <button class="icon-btn xs" data-action="edit-container" data-id="${escapeHtml(p.id)}" title="Edit">${Icons.edit}</button>
                                <button class="icon-btn xs" data-action="delete-container" data-id="${escapeHtml(p.id)}" title="Delete">${Icons.trash}</button>
                            </span>
                        </div>`;
                    const active = medContainers.filter(p => !p.exhaustedDate)
                        .sort((a, b) => (a.dose - b.dose) || ((a.openedDate ? 0 : 1) - (b.openedDate ? 0 : 1)));
                    const spent = medContainers.filter(p => p.exhaustedDate)
                        .sort((a, b) => +new Date(b.exhaustedDate) - +new Date(a.exhaustedDate));
                    const groupHtml = (key, label, sub, list, defaultOpen) => {
                        const open = local.penGroups[key] != null ? local.penGroups[key] : defaultOpen;
                        return `<div class="container-group">
                            <button class="container-group-head" data-action="toggle-container-group" data-key="${escapeHtml(key)}" data-open="${defaultOpen}">
                                <span class="pg-chev ${open ? 'open' : ''}">${Icons.chevR}</span>
                                <span class="pg-label">${label}</span>
                                <span class="pg-sub">${sub}</span>
                            </button>
                            ${open ? list.map(rowHtml).join('') : ''}
                        </div>`;
                    };
                    const doseGroups = [...new Set(active.map(p => p.dose))].sort((a, b) => a - b).map(dose => {
                        const list = active.filter(p => p.dose === dose);
                        const left = Math.round(list.reduce((a, p) => a + Math.max(0, p.capacity - p.used), 0) * 10) / 10;
                        return groupHtml(`${m.id}:${dose}`, `${dose}${escapeHtml(m.unit)}`,
                            `${list.length} ${D.containerPlural(m, list.length)} · ${left} dose${left === 1 ? '' : 's'} left`, list, true);
                    }).join('');
                    const spentHtml = spent.length
                        ? groupHtml(`${m.id}:spent`, 'Spent', `${spent.length} ${D.containerPlural(m, spent.length)} used up`, spent, false)
                        : '';
                    return `
                    <div class="mc-containers">
                        <div class="mc-containers-head">
                            <div class="k">Supply — ${escapeHtml(cnPl)}</div>
                            <div class="btn-cluster">
                                ${orphans > 0 ? `<button class="btn small" data-action="infer-containers" data-id="${escapeHtml(m.id)}" title="Rebuild supply from dose history">${Icons.refresh} From history</button>` : ''}
                                ${medContainers.length ? `<button class="btn small ghost danger-text" data-action="clear-containers" data-id="${escapeHtml(m.id)}" title="Made a mess? Wipe this med's supply records and start over — doses stay logged">Clear supply</button>` : ''}
                                <button class="btn small" data-action="add-containers-for" data-id="${escapeHtml(m.id)}">${Icons.plus} Add</button>
                            </div>
                        </div>
                        ${medContainers.length === 0 ? `<div class="empty pad-sm"><div class="em-sub">No ${escapeHtml(cnPl)} yet${orphans ? ` — use <strong>From history</strong> to build ${escapeHtml(cnPl)} from your ${orphans} logged dose${orphans === 1 ? '' : 's'}` : ''}</div></div>`
                        : `<div class="container-list">${doseGroups}${spentHtml}</div>`}
                    </div>`;
                })() : ''}
                <div class="btn-row bordered">
                    ${m.id !== s.activeMedId ? `<button class="btn small" data-action="select-med-page" data-id="${escapeHtml(m.id)}">Switch to</button>` : ''}
                    <button class="btn small ghost" data-action="toggle-containers" data-id="${escapeHtml(m.id)}">${expanded ? 'Hide' : 'Show'} supply</button>
                    <button class="btn small ghost" data-action="backfill-med" data-id="${escapeHtml(m.id)}" title="Estimate past doses">${Icons.wand} Backfill</button>
                    ${(() => {
                        // Only offered when there is actually something to catch up on —
                        // a permanently-present button for a list that is usually empty
                        // is noise, and the count is the useful part anyway.
                        const n = D.missedSlots(m, medDoses, { days: 7 }).length;
                        return n ? `<button class="btn small" data-action="catch-up" data-id="${escapeHtml(m.id)}" title="Scheduled doses with nothing logged against them">Catch up · ${n}</button>` : '';
                    })()}
                    ${window.MED_ENVIRONMENT === 'wip' ? `<button class="btn small ghost" data-action="dev-clear-med" data-id="${escapeHtml(m.id)}" title="WIP-only test helper — wipes this med's doses + supply">🧪 Clear data</button>` : ''}
                    <button class="btn small ghost" data-action="edit-med" data-id="${escapeHtml(m.id)}">${Icons.edit} Edit</button>
                    ${m.stoppedAt
                        ? `<button class="btn small" data-action="resume-med" data-id="${escapeHtml(m.id)}" title="Start taking this again">${Icons.refresh} Start again</button>`
                        : `<button class="btn small ghost" data-action="stop-med" data-id="${escapeHtml(m.id)}" title="Stop taking this, but keep its history and chart">Stop taking</button>`}
                    <button class="btn small danger push-right" data-action="trash-med" data-id="${escapeHtml(m.id)}">${Icons.trash}</button>
                </div>
            </div>`;
        };

        const trash = s.trashedMeds || [];
        // Three states, deliberately distinct: taking it, stopped but keeping the history,
        // and trashed. Stopped meds render as full cards like any other — you still want
        // their chart, their supply and their dose history — just under their own heading.
        const live = window.Store.activeMeds();
        const stopped = window.Store.stoppedMeds();
        el.innerHTML = `
            <div class="meds-head">
                <div>
                    <div class="card-title">Your medications</div>
                    <div class="meds-count">${live.length} medication${live.length === 1 ? '' : 's'} tracked${stopped.length ? ` · ${stopped.length} stopped` : ''}</div>
                </div>
                <button class="btn primary" data-action="add-med">${Icons.plus} Add medication</button>
            </div>
            <div class="meds-grid">
                ${live.map(medCard).join('')}
                <button class="card add-med-card" data-action="add-med">
                    ${Icons.plus}
                    <div>Add medication</div>
                    <div class="dim-sm">Preset or custom</div>
                </button>
            </div>
            ${stopped.length ? `
                <div class="meds-head" style="margin-top:28px">
                    <div><div class="card-title">No longer taking</div>
                    <div class="dim-sm" style="margin-top:4px">Still charted, including the tail as they clear your system — just no reminders or next dose</div></div>
                </div>
                <div class="meds-grid">
                    ${stopped.map(medCard).join('')}
                </div>` : ''}
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
                            <span class="dim-sm">${window.Store.medDoses(m.id).length} doses kept</span>
                            <button class="btn small" data-action="restore-med" data-id="${escapeHtml(m.id)}">Restore</button>
                            <button class="btn small danger" data-action="delete-med-forever" data-id="${escapeHtml(m.id)}">Delete forever</button>
                        </div>`).join('')}
                </div>` : ''}`;
    }

    window.Views = { local, derive, renderDashboard, renderHistory, renderCalendar, renderMeds };
})();
