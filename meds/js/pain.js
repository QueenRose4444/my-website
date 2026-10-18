// ================================================
// pain.js — pain tracking: body areas, the two scales, and the arithmetic.
// Pure: no DOM, no Store. The modal (modals-pain.js) and the Store use these.
// ================================================
(function () {
    'use strict';

    /*
     * Body areas, in our own plain words (no published body map is used, so nothing
     * here needs a licence). An area is region → optional sub-area → side:
     *   { region: 'back', sub: 'lower', side: 'both' }
     * Paired limbs take left/right/both; midline regions also take "centre".
     */
    const LIMB = ['left', 'right', 'both'];
    const MIDLINE = ['centre', 'left', 'right', 'both'];
    const REGIONS = [
        { id: 'head', label: 'Head', subs: ['forehead', 'temples', 'back of head', 'face', 'jaw'], sides: MIDLINE },
        { id: 'neck', label: 'Neck', subs: ['front', 'back'], sides: MIDLINE },
        { id: 'shoulder', label: 'Shoulder', sides: LIMB },
        { id: 'arm', label: 'Arm', subs: ['upper arm', 'elbow', 'forearm'], sides: LIMB },
        { id: 'hand', label: 'Wrist / hand', subs: ['wrist', 'hand', 'fingers'], sides: LIMB },
        { id: 'chest', label: 'Chest', sides: MIDLINE },
        { id: 'back', label: 'Back', subs: ['upper', 'middle', 'lower'], sides: MIDLINE },
        { id: 'abdomen', label: 'Stomach / abdomen', subs: ['upper', 'lower'], sides: MIDLINE },
        { id: 'pelvis', label: 'Pelvis / groin', sides: MIDLINE },
        { id: 'hip', label: 'Hip', sides: LIMB },
        { id: 'buttock', label: 'Buttock', sides: LIMB },
        { id: 'leg', label: 'Leg', subs: ['thigh', 'knee', 'shin', 'calf'], sides: LIMB },
        { id: 'foot', label: 'Ankle / foot', subs: ['ankle', 'heel', 'foot', 'toes'], sides: LIMB },
        { id: 'widespread', label: 'All over / widespread', sides: [] },
    ];
    const REGION_BY_ID = Object.fromEntries(REGIONS.map(r => [r.id, r]));

    /** A stable key for an area, so the same place logged twice is recognised. */
    function areaKey(a) {
        return [a && a.region, (a && a.sub) || '', (a && a.side) || ''].join('|');
    }

    /*
     * How a sub-area reads with its region:
     *   'prefix'  Lower back, Upper abdomen   (the sub qualifies the region)
     *   'name'    Left knee, Right wrist      (the sub IS the place)
     *   'detail'  Head (temples)              (the sub narrows it down)
     */
    const SUB_STYLE = { back: 'prefix', abdomen: 'prefix', neck: 'detail', arm: 'name', hand: 'name', leg: 'name', foot: 'name', head: 'detail' };
    const cap = (t) => t ? t[0].toUpperCase() + t.slice(1) : t;

    /** "Lower back, both sides", "Left knee", "Head (temples)". */
    function areaLabel(a) {
        if (!a) return '';
        const r = REGION_BY_ID[a.region];
        const name = r ? r.label : String(a.region || 'Somewhere');
        const style = SUB_STYLE[a.region];
        let place = name;
        if (a.sub && style === 'name') place = a.sub;
        else if (a.sub && style === 'prefix') place = `${a.sub} ${name.toLowerCase()}`;
        else if (a.sub) place = `${name} (${a.sub})`;
        const limb = r && r.sides === LIMB;
        if (a.side === 'left' || a.side === 'right') {
            return limb ? `${cap(a.side)} ${place.toLowerCase()}` : `${cap(place)}, ${a.side} side`;
        }
        if (a.side === 'both') return `${cap(place)}, both sides`;
        return cap(place);
    }

    /*
     * The scales.
     *
     * NRS-11: 0-10 with the two common anchors (Hawker et al., Arthritis Care & Research
     * 2011, "Measures of Adult Pain", doi:10.1002/acr.20543).
     *
     * DVPRS: the Defense and Veterans Pain Rating Scale, free to use "as is, without
     * alteration" (dvcipm.usuhs.edu/dvprs). The level wording below is copied exactly from
     * the card (v2.0), as are the bands; the card itself is shown, unaltered, as an image
     * (img/dvprs-card.png, rendered from the official PDF). Its four supplemental
     * questions are part of the scale and are offered as a daily check-in.
     */
    const SCALES = {
        nrs: {
            id: 'nrs', name: '0-10 scale',
            anchors: { 0: 'No pain', 10: 'Pain as bad as you can imagine' },
            source: { label: 'Hawker et al. 2011, Measures of Adult Pain', url: 'https://doi.org/10.1002/acr.20543' },
        },
        dvprs: {
            id: 'dvprs', name: 'Defense and Veterans Pain Rating Scale (DVPRS)',
            levels: [
                'No pain',
                'Hardly notice pain',
                'Notice pain, does not interfere with activities',
                'Sometimes distracts me',
                'Distracts me, can do usual activities',
                'Interrupts some activities',
                'Hard to ignore, avoid usual activities',
                'Focus of attention, prevents doing daily activities',
                'Awful, hard to do anything',
                'Can’t bear the pain, unable to do anything',
                'As bad as it could be, nothing else matters',
            ],
            card: 'img/dvprs-card.png',
            source: { label: 'DVCIPM — Defense and Veterans Pain Rating Scale (v2.0)', url: 'https://dvcipm.usuhs.edu/dvprs' },
        },
    };

    /** The DVPRS band a score falls in: null for 0, then Mild 1-4, Moderate 5-6, Severe 7-10. */
    function dvprsBand(score) {
        if (!(score >= 1)) return null;
        return score <= 4 ? 'mild' : score <= 6 ? 'moderate' : 'severe';
    }

    /* The DVPRS supplemental questions, worded as on the card. All 0-10, past 24 hours. */
    const DVPRS_SUPPLEMENTAL = [
        { key: 'activity', text: 'how, during the past 24 hours, pain has interfered with your usual ACTIVITY', low: 'Does not interfere', high: 'Completely interferes' },
        { key: 'sleep', text: 'how, during the past 24 hours, pain has interfered with your SLEEP', low: 'Does not interfere', high: 'Completely interferes' },
        { key: 'mood', text: 'how, during the past 24 hours, pain has affected your MOOD', low: 'Does not affect', high: 'Completely affects' },
        { key: 'stress', text: 'how, during the past 24 hours, pain has contributed to your STRESS', low: 'Does not contribute', high: 'Contributes a great deal' },
    ];
    const DVPRS_SUPPLEMENTAL_LEAD = 'Circle the one number that describes';

    const KINDS = [
        { id: 'acute', label: 'New / short-term' },
        { id: 'chronic', label: 'Ongoing (chronic)' },
        { id: 'flare', label: 'Flare-up' },
        { id: 'general', label: 'Just pain' },
    ];
    const CONTEXTS = [
        { id: 'resting', label: 'Resting' },
        { id: 'sitting', label: 'Sitting' },
        { id: 'standing', label: 'Standing' },
        { id: 'lying', label: 'Lying down' },
        { id: 'before-activity', label: 'Before activity' },
        { id: 'during-activity', label: 'During activity' },
        { id: 'after-activity', label: 'After activity' },
        { id: 'waking', label: 'On waking' },
        { id: 'night', label: 'At night' },
    ];
    const COPING = [
        { id: 'push-through', label: 'Can push through it' },
        { id: 'slows-me', label: 'Slows me down' },
        { id: 'stops-me', label: 'Stops me' },
    ];

    /**
     * The areas this person logs most, best first: frequency weighted by recency, so a
     * knee that hurt every day last year does not outrank the back that hurts this week.
     * Worked out here, on the device; nothing is sent anywhere to learn it.
     *
     * @param {Array} pains  pain entries
     * @param {number} [now]
     * @param {number} [limit]
     * @returns {Array<{region:string, sub?:string, side?:string}>}
     */
    function suggestAreas(pains, now, limit) {
        const t = now || Date.now();
        const HALF_LIFE_DAYS = 21;
        const score = new Map();
        const sample = new Map();
        for (const p of pains || []) {
            if (!p || p.kind === 'checkin' || !Array.isArray(p.areas)) continue;
            const age = Math.max(0, (t - (p.timestamp || 0)) / 86400000);
            const w = Math.pow(0.5, age / HALF_LIFE_DAYS);
            for (const a of p.areas) {
                if (!a || !a.region) continue;
                const k = areaKey(a);
                score.set(k, (score.get(k) || 0) + w);
                if (!sample.has(k)) sample.set(k, { region: a.region, ...(a.sub ? { sub: a.sub } : {}), ...(a.side ? { side: a.side } : {}) });
            }
        }
        return [...score.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit || 6).map(([k]) => sample.get(k));
    }

    /**
     * Is a change in pain meaningful? On a 0-10 scale about 2 points, or 30%, is the
     * change people themselves call "much better" (Farrar et al., Pain 2001;
     * doi:10.1016/S0304-3959(01)00349-9). Smaller changes are shown as numbers only.
     *
     * @returns {'better'|'worse'|'same'|null}
     */
    function painChange(before, after) {
        if (!(before >= 0) || !(after >= 0)) return null;
        const diff = before - after;
        const pct = before > 0 ? diff / before : 0;
        if (diff >= 2 || (before > 0 && pct >= 0.3 && diff >= 1)) return 'better';
        if (-diff >= 2 || (before > 0 && -pct >= 0.3 && -diff >= 1)) return 'worse';
        return 'same';
    }

    /** Was today's DVPRS check-in already done? */
    function checkinDoneOn(pains, ymd) {
        return (pains || []).some(p => p && p.kind === 'checkin' && p.date === ymd);
    }

    /* ── "did it help?" ─────────────────────────────────────────────────────────
     * A pain logged shortly before a dose of a pain medicine, and the same areas
     * re-rated once that medicine should be working (its peak), make a pair. Enough
     * pairs say whether that medicine helps that pain, for this person. */
    const BEFORE_WINDOW_MS = 3 * 3600000;    // a pain this long before the dose counts
    const AFTER_GRACE_MS = 15 * 60000;       // …or logged just after taking it
    const STALE_MS = 8 * 3600000;            // a re-rate this overdue is no longer asked for
    const MIN_PAIRS = 5;                     // fewer than this and no verdict is shown

    /** Is this a medicine taken for pain? Its category, or an analgesic ingredient. */
    function isPainMed(med) {
        if (!med) return false;
        if (med.category === 'Pain') return true;
        const D = window.MedData;
        if (!D || !D.resolveIngredients) return false;
        return D.resolveIngredients(med).some(i => i.substance && (i.substance.classes || []).includes('analgesic'));
    }

    /**
     * Doses waiting for a re-rate, soonest first.
     * @param {object} state
     * @param {number} now
     * @param {(med:object)=>number} peakH  hours from a dose to when it should be working
     * @param {string[]} [dismissed]  dose ids the person said not to ask about
     * @returns {Array<{dose:object, med:object, before:object, dueAt:number, due:boolean}>}
     */
    function followUps(state, now, peakH, dismissed) {
        const t = now || Date.now();
        const pains = (state.pains || []).filter(p => p && p.kind === 'pain');
        const answered = new Set(pains.map(p => p.followsDose).filter(Boolean));
        const skip = new Set(dismissed || []);
        const meds = new Map((state.meds || []).map(m => [m.id, m]));
        const out = [];
        for (const dose of state.shots || []) {
            if (!dose || answered.has(dose.id) || skip.has(dose.id)) continue;
            if (!(t - dose.timestamp < 12 * 3600000)) continue;
            const med = meds.get(dose.medId);
            if (!isPainMed(med)) continue;
            const before = pains.filter(p => p.timestamp >= dose.timestamp - BEFORE_WINDOW_MS
                && p.timestamp <= dose.timestamp + AFTER_GRACE_MS && !p.followsDose)
                .sort((a, b) => b.timestamp - a.timestamp)[0];
            if (!before) continue;
            const h = Number(peakH(med));
            const dueAt = dose.timestamp + (h > 0 ? h : 1) * 3600000;
            if (t - dueAt > STALE_MS) continue;
            out.push({ dose, med, before, dueAt, due: t >= dueAt });
        }
        return out.sort((a, b) => a.dueAt - b.dueAt);
    }

    /**
     * Per area, how this medicine has gone: the average before and after, and a verdict
     * once there are MIN_PAIRS pairs on the same scale.
     * @returns {Array<{area:object, n:number, before:number, after:number, change:('better'|'worse'|'same'|null)}>}
     */
    function helpSummary(state, medId) {
        const pains = (state.pains || []).filter(p => p && p.kind === 'pain');
        const byId = new Map(pains.map(p => [p.id, p]));
        const doses = new Map((state.shots || []).map(x => [x.id, x]));
        const acc = new Map();
        for (const after of pains) {
            if (!after.followsDose || !after.beforeId) continue;
            const dose = doses.get(after.followsDose);
            const before = byId.get(after.beforeId);
            if (!dose || dose.medId !== medId || !before || before.scale !== after.scale) continue;
            for (const a of after.areas || []) {
                const k = areaKey(a);
                if (!(before.areas || []).some(b => areaKey(b) === k)) continue;
                const r = acc.get(k) || { area: a, n: 0, b: 0, a: 0 };
                r.n++; r.b += Number(before.score); r.a += Number(after.score);
                acc.set(k, r);
            }
        }
        return [...acc.values()].map(r => {
            const before = Math.round(r.b / r.n * 10) / 10, after = Math.round(r.a / r.n * 10) / 10;
            return { area: r.area, n: r.n, before, after, change: r.n >= MIN_PAIRS ? painChange(before, after) : null };
        }).sort((x, y) => y.n - x.n);
    }

    /* Doses the person said not to ask about. This device only: it is a nudge, not data. */
    const DISMISSED_KEY = 'meds-pain-followup-dismissed';
    function dismissedFollowUps() {
        try { return JSON.parse(localStorage.getItem(DISMISSED_KEY) || '[]') || []; } catch (e) { return []; }
    }
    function dismissFollowUp(doseId) {
        try {
            const list = dismissedFollowUps().filter(Boolean).slice(-200);
            if (!list.includes(doseId)) list.push(doseId);
            localStorage.setItem(DISMISSED_KEY, JSON.stringify(list));
        } catch (e) { /* storage blocked: it will simply be asked again */ }
    }

    window.Pain = {
        REGIONS, REGION_BY_ID, SCALES, DVPRS_SUPPLEMENTAL, DVPRS_SUPPLEMENTAL_LEAD,
        KINDS, CONTEXTS, COPING,
        areaKey, areaLabel, dvprsBand, suggestAreas, painChange, checkinDoneOn,
        isPainMed, followUps, helpSummary, MIN_PAIRS, dismissedFollowUps, dismissFollowUp,
    };
})();
