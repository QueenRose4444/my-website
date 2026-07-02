// ================================================
// data.js — med presets, helpers, pen/supply logic,
// pharmacokinetic math, history inference, backfill estimator
// ================================================
(function () {
    'use strict';

    // ------------------------------------------------
    // Medication presets
    // halfLife / timeToPeak in DAYS. frequency in days.
    // titration: standard step-up schedule used by the
    // onboarding backfill estimator.
    // splitDose: pen can be dialed to take partial doses
    // (clicks). 60 clicks = 1 full dose at pen strength.
    // ------------------------------------------------
    const MED_PRESETS = [
        {
            presetId: 'mounjaro', name: 'Mounjaro', generic: 'Tirzepatide', type: 'injection',
            doses: [2.5, 5, 7.5, 10, 12.5, 15], frequency: 7, halfLife: 5, timeToPeak: 2,
            penCapacity: 4, pensPerPackage: 1, unit: 'mg', color: '#5fc8c8',
            splitDose: true, clicksPerDose: 60,
            titration: [{ dose: 2.5, weeks: 4 }, { dose: 5, weeks: 4 }, { dose: 7.5, weeks: 4 }, { dose: 10, weeks: 4 }, { dose: 12.5, weeks: 4 }, { dose: 15, weeks: 4 }],
            missedDose: {
                takeWithinDays: 4, minGapDays: 3,
                note: 'Take a missed dose within 4 days (96 h). More than 4 days late: skip it and take the next dose on your usual day. Never take 2 doses within 3 days of each other.',
                sourceLabel: 'Lilly — How to use Mounjaro',
                sourceUrl: 'https://mounjaro.lilly.com/how-to-use-mounjaro#:~:text=If%20you%20miss%20a%20dose%20of%20Mounjaro,3%20days%20of%20each%20other.',
            },
        },
        {
            presetId: 'zepbound', name: 'Zepbound', generic: 'Tirzepatide', type: 'injection',
            doses: [2.5, 5, 7.5, 10, 12.5, 15], frequency: 7, halfLife: 5, timeToPeak: 2,
            penCapacity: 4, pensPerPackage: 1, unit: 'mg', color: '#ed6b5e',
            splitDose: true, clicksPerDose: 60,
            titration: [{ dose: 2.5, weeks: 4 }, { dose: 5, weeks: 4 }, { dose: 7.5, weeks: 4 }, { dose: 10, weeks: 4 }, { dose: 12.5, weeks: 4 }, { dose: 15, weeks: 4 }],
            missedDose: {
                takeWithinDays: 4, minGapDays: 3,
                note: 'Take a missed dose within 4 days (96 h). More than 4 days late: skip it and take the next dose on your usual day. Never take 2 doses within 3 days of each other.',
                sourceLabel: 'Drugs.com — Zepbound dosage (FDA label)',
                sourceUrl: 'https://www.drugs.com/dosage/zepbound.html#:~:text=missed%20dose',
            },
        },
        {
            presetId: 'ozempic', name: 'Ozempic', generic: 'Semaglutide', type: 'injection',
            doses: [0.25, 0.5, 1, 2], frequency: 7, halfLife: 7, timeToPeak: 2,
            penCapacity: 4, pensPerPackage: 1, unit: 'mg', color: '#6fcf97',
            titration: [{ dose: 0.25, weeks: 4 }, { dose: 0.5, weeks: 4 }, { dose: 1, weeks: 4 }, { dose: 2, weeks: 4 }],
            missedDose: {
                takeWithinDays: 5, minGapDays: 2,
                note: 'Take a missed dose within 5 days. More than 5 days late: skip it and take the next dose on your usual day. Never take 2 doses within 48 hours of each other.',
                sourceLabel: 'Ozempic.com — dosing',
                sourceUrl: 'https://www.ozempic.com/how-to-take/ozempic-dosing.html#:~:text=miss%20a%20dose',
            },
        },
        {
            presetId: 'wegovy', name: 'Wegovy', generic: 'Semaglutide', type: 'injection',
            doses: [0.25, 0.5, 1, 1.7, 2.4], frequency: 7, halfLife: 7, timeToPeak: 2,
            penCapacity: 4, pensPerPackage: 1, unit: 'mg', color: '#a78bfa',
            titration: [{ dose: 0.25, weeks: 4 }, { dose: 0.5, weeks: 4 }, { dose: 1, weeks: 4 }, { dose: 1.7, weeks: 4 }, { dose: 2.4, weeks: 4 }],
            missedDose: {
                takeWithinDays: 5, minGapDays: 2,
                note: 'If your next scheduled dose is more than 2 days (48 h) away, take the missed dose as soon as possible. If it’s less than 2 days away, skip it and resume on your usual day. If you miss 2+ doses in a row, ask your prescriber about re-starting the dose escalation.',
                sourceLabel: 'Wegovy.com — pen guide & dosing',
                sourceUrl: 'https://www.wegovy.com/obesity/starting-wegovy/starting-wegovy-pen.html#:~:text=missed',
            },
        },
        {
            presetId: 'saxenda', name: 'Saxenda', generic: 'Liraglutide', type: 'injection',
            doses: [0.6, 1.2, 1.8, 2.4, 3.0], frequency: 1, halfLife: 0.55, timeToPeak: 0.45,
            penCapacity: 17, pensPerPackage: 5, unit: 'mg', color: '#f0b955',
            titration: [{ dose: 0.6, weeks: 1 }, { dose: 1.2, weeks: 1 }, { dose: 1.8, weeks: 1 }, { dose: 2.4, weeks: 1 }, { dose: 3.0, weeks: 1 }],
            missedDose: {
                takeWithinDays: 0, minGapDays: 0.75,
                note: 'Missed a daily dose: skip it and take the next dose at the usual time — don’t take extra to catch up. If more than 3 days have passed since your last dose, talk to your prescriber: official guidance is to re-start at 0.6 mg and titrate up again.',
                sourceLabel: 'Drugs.com — Saxenda dosage (FDA label)',
                sourceUrl: 'https://www.drugs.com/dosage/saxenda.html#:~:text=missed',
            },
        },
        {
            presetId: 'rybelsus', name: 'Rybelsus', generic: 'Semaglutide', type: 'pill',
            doses: [3, 7, 14], frequency: 1, halfLife: 7, timeToPeak: 1,
            penCapacity: 30, pensPerPackage: 1, unit: 'mg', color: '#fbbf24',
            titration: [{ dose: 3, weeks: 4 }, { dose: 7, weeks: 4 }, { dose: 14, weeks: 4 }],
            missedDose: {
                takeWithinDays: 0, minGapDays: 0.75,
                note: 'Missed your morning tablet: skip it and go back to your regular schedule the next day. Don’t take it later in the day, and never take 2 doses at once.',
                sourceLabel: 'Rybelsus.com — FAQs',
                sourceUrl: 'https://www.rybelsus.com/faqs.html#:~:text=miss%20a%20dose',
            },
        },
        {
            presetId: 'metformin', name: 'Metformin', generic: 'Metformin', type: 'pill',
            doses: [500, 750, 850, 1000], frequency: 0.5, halfLife: 0.27, timeToPeak: 0.12,
            penCapacity: 56, pensPerPackage: 1, unit: 'mg', color: '#7dd3fc',
            titration: [{ dose: 500, weeks: 2 }, { dose: 1000, weeks: 2 }],
            missedDose: {
                takeWithinDays: 0, minGapDays: 0.3,
                note: 'Missed a dose: take it as soon as you remember, unless it’s nearly time for the next one — then skip it. Never take 2 doses at once to catch up.',
                sourceLabel: 'NHS — How and when to take metformin',
                sourceUrl: 'https://www.nhs.uk/medicines/metformin/how-and-when-to-take-metformin/#:~:text=forget%20to%20take',
            },
        },
        {
            presetId: 'trulicity', name: 'Trulicity', generic: 'Dulaglutide', type: 'injection',
            doses: [0.75, 1.5, 3, 4.5], frequency: 7, halfLife: 4.7, timeToPeak: 2,
            penCapacity: 1, pensPerPackage: 4, unit: 'mg', color: '#f48fb1',
            titration: [{ dose: 0.75, weeks: 4 }, { dose: 1.5, weeks: 4 }, { dose: 3, weeks: 4 }, { dose: 4.5, weeks: 4 }],
            missedDose: {
                takeWithinDays: 4, minGapDays: 3,
                note: 'Take a missed dose as soon as possible if there are at least 3 days (72 h) until your next scheduled dose. If less than 3 days remain, skip it and take the next dose on your usual day.',
                sourceLabel: 'Drugs.com — Trulicity dosage (FDA label)',
                sourceUrl: 'https://www.drugs.com/dosage/trulicity.html#:~:text=missed',
            },
        },
    ];

    // Mounjaro / Zepbound KwikPen click reference (60 clicks = full pen-strength dose)
    // clicks needed for dose D from a pen of strength S = 60 * D / S
    function clicksForDose(doseMg, penStrengthMg, clicksPerDose) {
        if (!penStrengthMg || penStrengthMg <= 0) return null;
        const clicks = (clicksPerDose || 60) * doseMg / penStrengthMg;
        return Math.round(clicks * 100) / 100;
    }

    const DEFAULT_LOCATIONS = ['Left Arm', 'Right Arm', 'Right Belly', 'Left Belly', 'Left Thigh', 'Right Thigh'];

    // ------------------------------------------------
    // Date / formatting helpers
    // ------------------------------------------------
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    const ymd = d => {
        const dt = new Date(d);
        return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    };
    const hm = d => {
        const dt = new Date(d);
        return `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
    };
    const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
    const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);

    // settings-aware formatting (settings passed in by the store)
    function fmtDate(d, settings) {
        const dt = new Date(d);
        if (isNaN(dt)) return 'N/A';
        const dd = String(dt.getDate()).padStart(2, '0');
        const mm = String(dt.getMonth() + 1).padStart(2, '0');
        const yy = dt.getFullYear();
        switch (settings && settings.dateFormat) {
            case 'mm/dd/yyyy': return `${mm}/${dd}/${yy}`;
            case 'yyyy/mm/dd': return `${yy}/${mm}/${dd}`;
            default: return `${dd}/${mm}/${yy}`;
        }
    }
    function fmtDateShort(d) {
        const dt = new Date(d);
        if (isNaN(dt)) return '—';
        return `${dt.getDate()} ${MONTHS[dt.getMonth()]}`;
    }
    function fmtTime(d, settings) {
        const dt = new Date(d);
        if (isNaN(dt)) return 'N/A';
        const is24 = settings && settings.timeFormat === '24hr';
        if (is24) return `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
        let h = dt.getHours();
        const ap = h >= 12 ? 'PM' : 'AM';
        h = h % 12 || 12;
        return `${h}:${String(dt.getMinutes()).padStart(2, '0')} ${ap}`;
    }
    function fmtTimeStr(timeStr, settings) {
        // "09:40" → formatted per settings
        const [h, m] = String(timeStr || '09:00').split(':').map(Number);
        const dt = new Date();
        dt.setHours(h || 0, m || 0, 0, 0);
        return fmtTime(dt, settings);
    }
    function dayLabel(d) {
        const today = new Date(); today.setHours(0, 0, 0, 0);
        const dt = new Date(d); dt.setHours(0, 0, 0, 0);
        const diff = daysBetween(today, dt);
        if (diff === 0) return 'Today';
        if (diff === 1) return 'Tomorrow';
        if (diff === -1) return 'Yesterday';
        if (diff > 1 && diff < 7) return `In ${diff} days`;
        if (diff < -1 && diff > -7) return `${-diff} days ago`;
        return `${DAYS[dt.getDay()]}, ${fmtDateShort(dt)}`;
    }

    // ------------------------------------------------
    // Weight unit helpers (kg / lbs / st-lbs)
    // ------------------------------------------------
    const LBS_PER_KG = 2.20462;
    const LBS_PER_STONE = 14;
    const kgToLbs = kg => kg * LBS_PER_KG;
    const lbsToKg = lbs => lbs / LBS_PER_KG;
    const kgToStLbs = kg => {
        const total = kg * LBS_PER_KG;
        return { st: Math.floor(total / LBS_PER_STONE), lbs: total % LBS_PER_STONE };
    };
    const stLbsToKg = (st, lbs) => ((parseFloat(st) || 0) * LBS_PER_STONE + (parseFloat(lbs) || 0)) / LBS_PER_KG;

    function fmtWeight(kg, unit, showUnit) {
        if (kg == null || isNaN(kg)) return '—';
        if (unit === 'lbs') return kgToLbs(kg).toFixed(1) + (showUnit ? ' lbs' : '');
        if (unit === 'st-lbs') {
            const { st, lbs } = kgToStLbs(kg);
            return `${st} st ${lbs.toFixed(1)}${showUnit ? ' lbs' : ''}`;
        }
        return kg.toFixed(1) + (showUnit ? ' kg' : '');
    }
    // short unit label for axis / inline use
    const unitLabel = unit => unit === 'lbs' ? 'lbs' : unit === 'st-lbs' ? 'st' : 'kg';
    // numeric chart value in chosen unit (st-lbs charts as decimal stone)
    function weightValue(kg, unit) {
        if (unit === 'lbs') return kgToLbs(kg);
        if (unit === 'st-lbs') return kg * LBS_PER_KG / LBS_PER_STONE;
        return kg;
    }

    // height
    const cmToFtIn = cm => {
        const totalIn = cm * 0.393701;
        return { ft: Math.floor(totalIn / 12), inch: totalIn % 12 };
    };
    const ftInToCm = (ft, inch) => ((parseFloat(ft) || 0) * 12 + (parseFloat(inch) || 0)) / 0.393701;

    // ------------------------------------------------
    // Pharmacokinetics
    // level contribution of one shot at time t:
    //   ramp linearly to full dose over timeToPeak days,
    //   then exponential decay with the (per-dose) half-life
    // ------------------------------------------------
    function shotLevelAt(shot, med, atTs) {
        const days = (atTs - shot.timestamp) / 86400000;
        if (days < 0) return 0;
        const hl = (med.dose2halfLife && med.dose2halfLife[shot.dose]) || med.halfLife || 5;
        const ttp = med.timeToPeak || 0;
        if (ttp > 0 && days <= ttp) return shot.dose * (days / ttp);
        return shot.dose * Math.pow(0.5, (days - ttp) / hl);
    }

    function medLevelAt(shots, med, atTs) {
        let total = 0;
        for (const s of shots) {
            if (s.timestamp > atTs) continue;
            const v = shotLevelAt(s, med, atTs);
            if (v > 0.0001) total += v;
        }
        return total;
    }

    // ------------------------------------------------
    // Pens / supply
    // pen: { id, medId, dose (pen strength), capacity (doses at
    //        pen strength), used (float doses consumed), openedDate,
    //        exhaustedDate, note }
    // For split-dose meds `used` accumulates fractional doses
    // (a 2.5mg shot from a 5mg pen consumes 0.5).
    // ------------------------------------------------
    function doseConsumption(shotDose, pen) {
        if (!pen.dose || pen.dose <= 0) return 1;
        return shotDose / pen.dose;
    }

    function recomputePenState(pens, shots) {
        return pens.map(pen => {
            const penShots = shots.filter(s => s.penId === pen.id).sort((a, b) => a.timestamp - b.timestamp);
            let used = 0;
            for (const s of penShots) used += doseConsumption(s.dose, pen);
            used = Math.round(used * 1000) / 1000;
            const openedDate = pen.openedDate || (penShots[0] ? penShots[0].date : null);
            const full = used >= pen.capacity - 0.001;
            const exhaustedDate = full
                ? (penShots.length ? penShots[penShots.length - 1].date : pen.exhaustedDate)
                : (pen.manuallyExhausted ? pen.exhaustedDate : null);
            return Object.assign({}, pen, { used, openedDate, exhaustedDate });
        });
    }

    // remaining full doses (at pen strength) per dose value
    function supplyByDose(pens, medId) {
        const supply = {};
        pens.filter(p => p.medId === medId).forEach(p => {
            if (p.exhaustedDate) return;
            const left = Math.floor((p.capacity - p.used) + 0.001);
            if (left > 0) supply[p.dose] = (supply[p.dose] || 0) + left;
        });
        return supply;
    }

    // best pen for a new shot at `dose`:
    //  1. opened, not exhausted, matching strength with enough left
    //  2. unopened matching strength
    //  3. (split-dose meds) opened pen of another strength with enough left
    //  4. (split-dose meds) unopened pen of another strength
    function suggestPenForShot(pens, med, dose) {
        const eligible = pens.filter(p => p.medId === med.id && !p.exhaustedDate);
        const enough = p => (p.capacity - p.used) >= doseConsumption(dose, p) - 0.001;
        const opened = eligible.filter(p => p.openedDate).sort((a, b) => new Date(a.openedDate) - new Date(b.openedDate));
        const unopened = eligible.filter(p => !p.openedDate);

        let pen = opened.find(p => p.dose === dose && enough(p));
        if (pen) return { pen, isNewOpen: false, split: false };
        pen = unopened.find(p => p.dose === dose);
        if (pen) return { pen, isNewOpen: true, split: false };
        if (med.splitDose) {
            pen = opened.find(p => enough(p));
            if (pen) return { pen, isNewOpen: false, split: pen.dose !== dose };
            pen = unopened.find(p => enough(Object.assign({}, p, { used: 0 })));
            if (pen) return { pen, isNewOpen: true, split: pen.dose !== dose };
        }
        return { pen: null, isNewOpen: false, split: false };
    }

    // ------------------------------------------------
    // Infer pens from shot history (for imports / users
    // who never tracked pens). Walks chronologically, fills
    // capacity-sized pens per dose.
    // ------------------------------------------------
    function inferPensFromShots(shots, med) {
        if (!med) return { pens: [], assignment: {} };
        const cap = med.penCapacity || 4;
        const sorted = shots.slice().sort((a, b) => a.timestamp - b.timestamp);
        const stacks = {}; // dose -> pens
        const assignment = {};
        let seq = 0;
        for (const s of sorted) {
            if (!stacks[s.dose]) stacks[s.dose] = [];
            const stack = stacks[s.dose];
            let cur = stack[stack.length - 1];
            if (!cur || cur.used >= cur.capacity - 0.001) {
                cur = {
                    id: `pen-inf-${med.id}-${s.dose}-${seq++}-${Date.now().toString(36)}`,
                    medId: med.id, dose: s.dose, capacity: cap, used: 0,
                    openedDate: s.date, exhaustedDate: null, note: 'inferred from history',
                };
                stack.push(cur);
            }
            cur.used += 1;
            if (cur.used >= cur.capacity - 0.001) cur.exhaustedDate = s.date;
            assignment[s.id] = cur.id;
        }
        const pens = [];
        Object.keys(stacks).forEach(d => stacks[d].forEach(p => pens.push(p)));
        return { pens, assignment };
    }

    // ------------------------------------------------
    // Onboarding backfill estimator
    // Generates estimated past shots so charts/levels start correct.
    //
    // opts: {
    //   med,                 medication object
    //   currentDose,         dose the user is on now
    //   frequencyDays,       days between doses
    //   startDate,           optional 'yyyy-mm-dd' the user started the med
    //   lastDoseDate,        optional date of their most recent dose (default: today)
    //   timeOfDay,           'HH:MM' typical dose time
    //   steps,               optional explicit [{dose, count}] (count = number of doses
    //                        taken at that step) — overrides titration estimation
    //   locations,           optional rotation list for injection sites
    // }
    // Returns array of shot objects flagged estimated:true,
    // ordered oldest → newest, ending on lastDoseDate at currentDose.
    // ------------------------------------------------
    function estimateBackfillShots(opts) {
        const med = opts.med;
        const freq = Math.max(0.02, opts.frequencyDays || med.frequency || 7);
        const time = opts.timeOfDay || '09:00';
        const locations = opts.locations || null;
        const lastDose = opts.lastDoseDate ? new Date(opts.lastDoseDate + 'T' + time) : (() => {
            const d = new Date(); const [h, m] = time.split(':').map(Number);
            d.setHours(h || 9, m || 0, 0, 0); return d;
        })();

        // Build the step plan: [{dose, count}] oldest step first.
        let plan = [];
        if (opts.steps && opts.steps.length) {
            plan = opts.steps.filter(s => s.count > 0 && s.dose > 0);
        } else {
            // Use the med's titration schedule up to the current dose.
            const tit = (med.titration || []).filter(t => t.dose <= opts.currentDose);
            if (tit.length === 0 || tit[tit.length - 1].dose !== opts.currentDose) {
                tit.push({ dose: opts.currentDose, weeks: 4 });
            }
            plan = tit.map(t => ({ dose: t.dose, count: Math.max(1, Math.round((t.weeks * 7) / freq)) }));

            if (opts.startDate) {
                // compress/extend so the plan fits between startDate and lastDose
                const totalAvail = Math.max(1, Math.round(daysBetween(opts.startDate, lastDose) / freq) + 1);
                const planTotal = plan.reduce((a, s) => a + s.count, 0);
                if (totalAvail < planTotal) {
                    // scale every step down proportionally (min 1 each), trim from the
                    // earliest steps if still over
                    const scale = totalAvail / planTotal;
                    plan = plan.map(s => ({ dose: s.dose, count: Math.max(1, Math.round(s.count * scale)) }));
                    let over = plan.reduce((a, s) => a + s.count, 0) - totalAvail;
                    for (let i = 0; i < plan.length - 1 && over > 0; i++) {
                        const cut = Math.min(over, plan[i].count - 1);
                        plan[i].count -= cut; over -= cut;
                    }
                } else if (totalAvail > planTotal) {
                    // user has been on the current dose longer than standard — extend last step
                    plan[plan.length - 1].count += totalAvail - planTotal;
                }
            }
        }

        // Walk backward from lastDose so the series always ends "now".
        const totalCount = plan.reduce((a, s) => a + s.count, 0);
        const shots = [];
        let idx = totalCount - 1; // 0 = oldest
        for (let p = plan.length - 1; p >= 0; p--) {
            for (let c = 0; c < plan[p].count; c++) {
                const ts = lastDose.getTime() - (totalCount - 1 - idx) * freq * 86400000;
                const dt = new Date(ts);
                shots.push({
                    id: `shot-est-${ts}-${idx}`,
                    medId: med.id,
                    dose: plan[p].dose,
                    date: ymd(dt),
                    time: hm(dt),
                    timestamp: ts,
                    location: locations ? locations[idx % locations.length] : null,
                    penId: null,
                    estimated: true,
                });
                idx--;
            }
        }
        shots.sort((a, b) => a.timestamp - b.timestamp);
        return shots;
    }

    // ------------------------------------------------
    // Schedule detection + next-dose prediction
    // ------------------------------------------------
    const DAY_INDEX = { Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 };
    const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    // Estimate the user's usual day-of-week (weekly meds) and time of day
    // from their recent logs. Estimated doses are skipped — only real logs count.
    function detectSchedule(medShots, med) {
        const recent = medShots.filter(s => !s.estimated).slice(0, 10);
        if (!recent.length) return { day: null, time: null };
        const mins = recent
            .map(s => { const [h, m] = String(s.time || '09:00').split(':').map(Number); return (h || 0) * 60 + (m || 0); })
            .sort((a, b) => a - b);
        const median = mins[Math.floor(mins.length / 2)];
        const time = `${String(Math.floor(median / 60)).padStart(2, '0')}:${String(median % 60).padStart(2, '0')}`;
        let day = null;
        if ((med.frequency || 7) >= 5) {
            const counts = {};
            recent.forEach(s => { const d = new Date(s.timestamp).getDay(); counts[d] = (counts[d] || 0) + 1; });
            const best = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
            // only trust it when it's a real pattern, not a coin flip
            if (best != null && counts[best] >= Math.max(2, Math.ceil(recent.length * 0.4))) day = Number(best);
        }
        return { day, time };
    }

    // next dose prediction for a med.
    // User-set schedule (med.scheduleDay / med.scheduleTime) wins; otherwise the
    // detected pattern; otherwise simply lastDose + frequency. Weekly meds snap
    // to the usual weekday (respecting the med's minimum gap between doses), so
    // a late Friday dose still predicts "next Tuesday", not "next Friday".
    function predictNextDose(med, medShots, settings) {
        const last = medShots[0]; // newest first
        if (!last || !med) return null;
        const freq = med.frequency || 7;
        const detected = detectSchedule(medShots, med);

        let targetDay = null;
        if (med.scheduleDay && med.scheduleDay !== 'auto' && DAY_INDEX[med.scheduleDay] != null) targetDay = DAY_INDEX[med.scheduleDay];
        else if (detected.day != null) targetDay = detected.day;

        let time = (med.scheduleTime && med.scheduleTime !== 'auto') ? med.scheduleTime : (detected.time || last.time || '09:00');

        const lastDt = new Date(last.date + 'T' + (last.time || '09:00'));
        let nextDate;
        if (targetDay != null && freq >= 5 && freq <= 9) {
            // first occurrence of the usual weekday that keeps the minimum gap
            const minGap = Math.max(1, (med.missedDose && med.missedDose.minGapDays) || 3);
            nextDate = new Date(lastDt);
            nextDate.setDate(nextDate.getDate() + Math.ceil(minGap));
            while (nextDate.getDay() !== targetDay) nextDate.setDate(nextDate.getDate() + 1);
        } else if (freq >= 0.75 && freq <= 1.25) {
            nextDate = addDays(lastDt, Math.round(freq) || 1);
        } else {
            nextDate = new Date(lastDt.getTime() + freq * 86400000);
            time = hm(nextDate); // sub-daily meds: clock time follows the interval
        }
        const [th, tm] = time.split(':').map(Number);
        nextDate.setHours(th || 9, tm || 0, 0, 0);

        const locs = (settings && settings.shotLocations && settings.shotLocations.length) ? settings.shotLocations : DEFAULT_LOCATIONS;
        const i = locs.indexOf(last.location);
        const nextLoc = locs[(i + 1) % locs.length];
        return {
            date: nextDate,
            time,
            dose: (med.preferredNextDose != null ? med.preferredNextDose : last.dose),
            location: nextLoc,
            usualDay: targetDay != null ? DAY_NAMES[targetDay] : null,
            scheduleSource: (med.scheduleDay && med.scheduleDay !== 'auto') || (med.scheduleTime && med.scheduleTime !== 'auto') ? 'user' : (detected.day != null || detected.time ? 'auto' : null),
        };
    }

    // How late is the user, and what does official guidance suggest?
    // Returns null when not meaningfully overdue. For daily/weekly meds the
    // whole due DAY counts as on time — overdue starts the next day; the
    // take-vs-skip decision still uses the precise hours-based window.
    function lateDoseStatus(med, nextDose) {
        if (!med || !nextDose) return null;
        const due = new Date(nextDose.date);
        const now = Date.now();
        const freq = med.frequency || 7;
        if (freq >= 0.75) {
            const dayEnd = new Date(due);
            dayEnd.setHours(23, 59, 59, 999);
            if (now <= dayEnd.getTime()) return null;
        } else if ((now - due.getTime()) / 86400000 < 0.25) {
            return null;
        }
        const daysLate = (now - due.getTime()) / 86400000;
        const info = med.missedDose || null;
        let action;
        if (info) {
            action = (info.takeWithinDays > 0 && daysLate <= info.takeWithinDays) ? 'take' : 'skip';
        } else {
            action = daysLate <= freq / 2 ? 'take' : 'skip';
        }
        return { daysLate, action, info };
    }

    // "nice" chart axis step (1 / 2 / 2.5 / 5 × 10^n) for a given max value.
    // divs sets how many gridlines to aim for (density) — works for
    // 0.25 mg pens and 1000 mg pills alike
    function niceStep(maxVal, divs) {
        if (!(maxVal > 0)) return 1;
        const rough = maxVal / (divs || 5);
        const mag = Math.pow(10, Math.floor(Math.log10(rough)));
        for (const m of [1, 2, 2.5, 5, 10]) {
            if (rough <= m * mag) return m * mag;
        }
        return 10 * mag;
    }

    window.MedData = {
        MED_PRESETS, DEFAULT_LOCATIONS, MONTHS, DAYS,
        ymd, hm, addDays, daysBetween,
        fmtDate, fmtDateShort, fmtTime, fmtTimeStr, dayLabel,
        kgToLbs, lbsToKg, kgToStLbs, stLbsToKg, fmtWeight, unitLabel, weightValue,
        cmToFtIn, ftInToCm,
        clicksForDose, doseConsumption,
        shotLevelAt, medLevelAt,
        recomputePenState, supplyByDose, suggestPenForShot,
        inferPensFromShots, estimateBackfillShots, predictNextDose,
        detectSchedule, lateDoseStatus, niceStep, DAY_NAMES,
    };
})();
