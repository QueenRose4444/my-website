/**
 * pk.js — one-compartment pharmacokinetics with first-order absorption.
 *
 * Replaces the linear-ramp-plus-decay in data.js for any med that resolves
 * to a substance. Meds that do not resolve keep the old model — see
 * `data.js:doseLevelAt`. Both still exist on purpose: the old one is wrong in a
 * known, bounded way, and deleting it would take every unlinked med's curve with it.
 *
 *     A(t) = (F·D·ka)/(ka − ke) · (e^(−ke·t) − e^(−ka·t))          ke = ln2 / t½
 *
 * WHY AMOUNT AND NOT CONCENTRATION. Plotting mg sidesteps volume of distribution
 * entirely — we do not have V for most drugs and do not need it — and gives a
 * directly interpretable number: "about 14 mg of dexamfetamine on board".
 *
 * ⚠ THE CURVE IS LOWER THAN THE LEGACY ONE, AND THAT IS CORRECT. The legacy model rose
 * linearly to exactly the full dose. A real one-compartment curve never reaches the
 * dose, because elimination starts while absorption is still going. A 50 mg dose
 * peaks near 35-40 mg, not 50. Lower peaks than the legacy model are the model
 * getting less wrong, not a regression.
 *
 * ── Units. Read this before touching anything. ─────────────────────────────
 * Substances (substances.js) are in HOURS. Meds (data.js) are in DAYS. Timestamps
 * are ms. The conversion happens at exactly ONE place — HOURS_PER_DAY, below — and
 * is asserted in the tests, because a factor of 24 still draws a perfectly plausible
 * curve and nothing else would catch it.
 */
(function () {
    'use strict';

    const HOURS_PER_DAY = 24;
    const MS_PER_HOUR = 3600000;

    /** Below this the general Bateman form is 0/0 and must not be evaluated. */
    const KA_KE_EPS = 1e-6;

    /**
     * Elimination rate constant from a terminal half-life.
     * @param {number} halfLifeH hours
     * @returns {number|null} per hour
     */
    function keFromHalfLife(halfLifeH) {
        const t = Number(halfLifeH);
        return (isFinite(t) && t > 0) ? Math.LN2 / t : null;
    }

    /**
     * Solve the absorption rate constant `ka` from a published Tmax.
     *
     * `ka` is essentially never published, but Tmax always is, and
     *
     *     Tmax = ln(ka/ke) / (ka − ke)
     *
     * has no closed form. It IS monotonically decreasing in `ka` for `ka > ke`, so
     * bisection converges — and its supremum as ka → ke is exactly `1/ke`.
     *
     * 🔴 That supremum is the honest failure case. If a substance claims a Tmax at
     * or beyond `1/ke` (i.e. Tmax ≥ t½/ln2 ≈ 1.44 × t½) then NO first-order
     * absorption reproduces it — the two published numbers contradict each other, or
     * the drug is an extended-release formulation this model does not represent.
     * Return null and let the caller hide the curve. Do NOT clamp to something
     * plausible: that is how an ER product ends up drawn as an IR one.
     *
     * @param {number} tmaxH hours
     * @param {number} ke    per hour
     * @returns {number|null} ka, per hour
     */
    function solveKa(tmaxH, ke) {
        const tmax = Number(tmaxH);
        if (!isFinite(tmax) || tmax <= 0 || !isFinite(ke) || ke <= 0) return null;
        if (tmax >= 1 / ke) return null;          // unreachable by any ka > ke

        const tmaxOf = ka => Math.log(ka / ke) / (ka - ke);

        // Bracket: lo just above ke (Tmax near its maximum), hi doubled until the
        // Tmax it produces has fallen below the target.
        let lo = ke * (1 + 1e-9);
        let hi = ke * 2;
        for (let i = 0; tmaxOf(hi) > tmax; i++) {
            if (i > 200) return null;             // cannot bracket — refuse, do not guess
            hi *= 2;
        }
        // ~60 halvings is far past double precision; 100 costs nothing and is done once.
        for (let i = 0; i < 100; i++) {
            const mid = (lo + hi) / 2;
            if (tmaxOf(mid) > tmax) lo = mid; else hi = mid;
        }
        return (lo + hi) / 2;
    }

    /**
     * Amount of one dose still in the body at `tH` hours after taking it.
     *
     * @param {number} amount absorbable amount (F already applied), any mass unit
     * @param {number} ka per hour
     * @param {number} ke per hour
     * @param {number} tH hours since the dose; negative gives 0
     * @returns {number} same unit as `amount`
     */
    function bateman(amount, ka, ke, tH) {
        if (!(amount > 0) || !(ka > 0) || !(ke > 0)) return 0;
        if (!(tH > 0)) return 0;
        if (Math.abs(ka - ke) < KA_KE_EPS) {
            // The general form is 0/0 here. This is its limit as ka → ke, not an
            // approximation — and it is reachable in practice (diclofenac's Tmax and
            // half-life are both ~2 h), so it is not an edge case to skip.
            return amount * ke * tH * Math.exp(-ke * tH);
        }
        return (amount * ka) / (ka - ke) * (Math.exp(-ke * tH) - Math.exp(-ka * tH));
    }

    /**
     * Time of peak for a single dose, in hours. Same formula the solver inverts.
     * @returns {number|null}
     */
    function tmaxOf(ka, ke) {
        if (!(ka > 0) || !(ke > 0)) return null;
        if (Math.abs(ka - ke) < KA_KE_EPS) return 1 / ke;   // limit of ln(ka/ke)/(ka−ke)
        return Math.log(ka / ke) / (ka - ke);
    }

    // `ka` is solved once per (substance, route) and cached. The bisection is cheap
    // but the chart asks for it a few hundred times per render.
    const _kaCache = Object.create(null);

    /**
     * The rate constants for a substance, with an optional route-specific `ka`.
     *
     * @param {object} substance
     * @param {number} [kaOverrideH] a conversion edge's own ka, used for conversion edges. When the
     *        metabolite's appearance is rate-limited by the conversion rather than by
     *        absorption, THAT is the number that shapes the curve, not the parent's.
     * @returns {{ke:number, ka:number, F:number}|null} null when unmodellable
     */
    function paramsFor(substance, kaOverrideH) {
        if (!substance) return null;
        const ke = keFromHalfLife(substance.halfLifeH);
        if (ke == null) return null;

        let ka;
        if (kaOverrideH > 0) {
            ka = kaOverrideH;
        } else {
            const key = substance.id + '|' + substance.halfLifeH + '|' + substance.tmaxH;
            if (!(key in _kaCache)) _kaCache[key] = solveKa(substance.tmaxH, ke);
            ka = _kaCache[key];
        }
        if (!(ka > 0)) return null;

        // Bioavailability is a genuine unknown for most of the table. Absent means the
        // curve is "amount of the dose on board", which is exactly what this app has
        // always plotted — not a silent assumption of perfect absorption dressed up as
        // a measurement. Where F IS known it is applied, and the difference is real.
        const F = (substance.bioavailability > 0 && substance.bioavailability <= 1)
            ? substance.bioavailability : 1;
        return { ke, ka, F };
    }

    /* ───────────────────── extended release ─────────────────────
     *
     * `solveKa` returns null when a published Tmax is unreachable by first-order
     * absorption, which is exactly what an extended-release product looks like.
     * Such a product cannot be modelled as a single bolus, so it needs the release
     * components below.
     *
     * 🔴 RELEASE IS A PROPERTY OF THE PRODUCT, NEVER OF THE SUBSTANCE. Concerta and
     * Ritalin IR are both methylphenidate and have completely different curves. Put
     * this on the substance and one of them is wrong by construction.
     *
     * Two forms, both closed-form and both label-reproducible. Do not approximate one
     * with the other: an ascending zero-order release drawn as a delayed bolus is a
     * different claim about the drug.
     */

    /**
     * Amount on board from a ZERO-ORDER input — a constant rate into the body for
     * `durationH`, then plain elimination. This is what a transdermal patch does by
     * design, and what an osmotic tablet approximates.
     *
     *     t <= T:  A(t) = (k0/ke) · (1 − e^(−ke·t))            k0 = amount / T
     *     t  > T:  A(t) = A(T) · e^(−ke·(t − T))
     *
     * Note the shape: it climbs towards a PLATEAU of k0/ke rather than peaking and
     * falling. That plateau is the point of an ER product and is the whole visible
     * difference from a bolus.
     *
     * @param {number} amount  total released over the whole duration
     * @param {number} ke      per hour
     * @param {number} durationH
     * @param {number} tH      hours since release began
     * @returns {number}
     */
    function zeroOrderRelease(amount, ke, durationH, tH) {
        if (!(amount > 0) || !(ke > 0) || !(durationH > 0) || !(tH > 0)) return 0;
        const k0 = amount / durationH;
        if (tH <= durationH) return (k0 / ke) * (1 - Math.exp(-ke * tH));
        const atEnd = (k0 / ke) * (1 - Math.exp(-ke * durationH));
        return atEnd * Math.exp(-ke * (tH - durationH));
    }

    /**
     * Split one dose into the components a formulation actually delivers.
     *
     * A product with no `release` spec is one component: the whole dose, at t=0,
     * absorbed first-order. That is every immediate-release product.
     *
     * @param {number} amount  the dose, in whatever unit the caller is working in
     * @param {object} [release] the product's `release` spec
     * @returns {Array<{amount:number, delayH:number, zeroOrderH:number}>}
     */
    function releaseComponents(amount, release) {
        if (!(amount > 0)) return [];
        if (!release) return [{ amount, delayH: 0, zeroOrderH: 0 }];

        if (release.type === 'zero-order') {
            const out = [];
            // A patch is labelled as a RATE — "50 mcg/day" — not as a total. Scaling it
            // here rather than at the call site keeps the one place that knows a
            // release spec the only place that has to know this.
            if (release.ratePerDay && release.durationH > 0) amount = amount * (release.durationH / 24);
            const imm = Number(release.immediateFrac) || 0;
            if (imm > 0) out.push({ amount: amount * imm, delayH: 0, zeroOrderH: 0 });
            const rest = 1 - imm;
            if (rest > 0 && release.durationH > 0) {
                out.push({ amount: amount * rest, delayH: Number(release.delayH) || 0,
                           zeroOrderH: Number(release.durationH) });
            }
            return out.length ? out : [{ amount, delayH: 0, zeroOrderH: 0 }];
        }

        if (Array.isArray(release.fractions) && release.fractions.length) {
            const out = release.fractions
                .filter(f => f && f.frac > 0)
                .map(f => ({ amount: amount * f.frac, delayH: Number(f.delayH) || 0, zeroOrderH: 0 }));
            // The fractions must account for the whole dose. A spec that adds to 0.9
            // would quietly lose a tenth of every dose, and the curve would still look
            // entirely plausible — so it is refused rather than normalised.
            const total = out.reduce((a, c) => a + c.amount, 0);
            if (Math.abs(total - amount) > amount * 1e-6) return [{ amount, delayH: 0, zeroOrderH: 0 }];
            return out;
        }

        return [{ amount, delayH: 0, zeroOrderH: 0 }];
    }

    /**
     * One dose's contribution at `tH` hours, through whatever formulation it has.
     * @param {{amount:number, delayH:number, zeroOrderH:number}[]} components
     */
    function componentsLevel(components, ka, ke, tH) {
        let total = 0;
        for (const c of components) {
            const t = tH - c.delayH;
            if (!(t > 0)) continue;
            total += c.zeroOrderH > 0
                ? zeroOrderRelease(c.amount, ke, c.zeroOrderH, t)
                : bateman(c.amount, ka, ke, t);
        }
        return total;
    }

    /**
     * Turn logged doses into per-substance absorption events.
     *
     * This is the graph walk: dose → product → substance → any downstream
     * substances. Two products feeding one molecule land in the same bucket, so the
     * combined curve is just linear superposition and needs no special case anywhere.
     *
     * @param {Med[]} meds
     * @param {Dose[]} doses            already filtered to these meds, or not — it filters
     * @param {object} [opts]
     * @param {object[]} [opts.userSubstances]
     * @param {boolean} [opts.includeUnplotted] include edges marked plotByDefault:false
     * @returns {Map<string, {substance:object, events:Array}>}
     */
    function buildLoad(meds, doses, opts) {
        const o = opts || {};
        const D = window.MedData;
        const S = window.Substances;
        const out = new Map();
        if (!D || !S || !Array.isArray(meds) || !Array.isArray(doses)) return out;

        const medById = new Map(meds.map(m => [m.id, m]));
        const ingByMed = new Map();

        const bucket = (substance) => {
            let row = out.get(substance.id);
            if (!row) { row = { substance, events: [] }; out.set(substance.id, row); }
            return row;
        };

        for (const dose of doses) {
            const med = medById.get(dose && dose.medId);
            if (!med) continue;
            if (!ingByMed.has(med.id)) ingByMed.set(med.id, D.resolveIngredients(med, o.userSubstances));
            const ings = ingByMed.get(med.id);
            if (!ings.length) continue;              // unlinked med — legacy model owns it
            const ts = Number(dose.timestamp);
            if (!isFinite(ts)) continue;

            for (const ing of ings) {
                const baseMg = D.ingredientBaseMg(dose.dose, ing);
                if (!(baseMg > 0)) continue;

                // the substance actually swallowed
                const own = paramsFor(ing.substance);
                // A product can absorb its substance very differently from the
                // substance's usual route (oral semaglutide: ~1%, not 89%).
                const productF = (med.bioavailability > 0 && med.bioavailability <= 1) ? med.bioavailability : null;
                if (own) {
                    bucket(ing.substance).events.push({
                        ts, baseMg, ka: own.ka, ke: own.ke, F: productF != null ? productF : own.F,
                        medId: med.id, via: null,
                        // The formulation rides on the EVENT, because it belongs to
                        // the product the dose came from. Two products feeding one
                        // substance keep their own release profiles in the same sum.
                        release: med.release || null,
                    });
                }

                // …and anything it becomes
                for (const edge of S.conversionsFrom(ing.substanceId)) {
                    if (edge.plotByDefault === false && !o.includeUnplotted) continue;
                    const target = S.substanceById(edge.to, o.userSubstances);
                    if (!target) continue;
                    // The edge's own ka wins when the conversion — not absorption —
                    // is the rate-limiting step, which is the whole reason Vyvanse
                    // is flatter and later-peaking than IR dex at the same base dose.
                    const p = paramsFor(target, edge.kaH);
                    if (!p) continue;
                    const f = Number(edge.massFactor);
                    if (!(f > 0)) continue;
                    bucket(target).events.push({
                        ts, baseMg: baseMg * f, ka: p.ka, ke: p.ke, F: p.F,
                        medId: med.id, via: edge.from + '->' + edge.to,
                        // How long the effect lasts when it arrives THIS way, if the
                        // edge publishes it (see effectThreshold).
                        durationH: edge.durationH > 0 ? edge.durationH : null,
                        // The metabolite of an ER product appears on the ER schedule:
                        // the parent cannot be hydrolysed before it is released.
                        release: med.release || null,
                    });
                }
            }
        }
        return out;
    }

    /**
     * Total amount of one substance on board at `atTs`.
     *
     * Doses superpose linearly — that is a property of the linear one-compartment
     * model, not a simplification bolted on here — so this is a plain sum.
     *
     * @param {{events:Array}} row from buildLoad
     * @param {number} atTs ms since epoch
     * @returns {number} mg of free base
     */
    /** Hours after which an event is under a millionth of itself (see data.js levelHorizonMs). */
    function eventHorizonH(e) {
        if (e._horizonH !== undefined) return e._horizonH;
        const tail = Math.min(e.ka > 0 ? e.ka : e.ke, e.ke);
        const r = e.release || {};
        const releaseH = (Number(r.durationH) || 0)
            + Math.max(0, ...((r.fractions || []).map(f => Number(f.delayH) || 0)), Number(r.delayH) || 0);
        e._horizonH = tail > 0 ? releaseH + 20 * Math.LN2 / tail : Infinity;
        return e._horizonH;
    }

    function levelAt(row, atTs) {
        if (!row || !row.events.length) return 0;
        let total = 0;
        for (const e of row.events) {
            if (e.ts > atTs) continue;
            const tH = (atTs - e.ts) / MS_PER_HOUR;
            if (tH > eventHorizonH(e)) continue;
            const v = componentsLevel(releaseComponents(e.baseMg * e.F, e.release), e.ka, e.ke, tH);
            if (v > 1e-9) total += v;
        }
        return total;
    }

    /**
     * Per-product breakdown at one moment — "14 mg on board, 9 from Vyvanse and 5
     * from the IR tablet". The sum equals levelAt() by construction.
     * @returns {Array<{medId:string, via:string|null, amount:number}>}
     */
    function contributionsAt(row, atTs) {
        const by = new Map();
        if (!row) return [];
        for (const e of row.events) {
            if (e.ts > atTs) continue;
            const v = componentsLevel(releaseComponents(e.baseMg * e.F, e.release), e.ka, e.ke,
                (atTs - e.ts) / MS_PER_HOUR);
            if (!(v > 1e-9)) continue;
            const key = e.medId + '|' + (e.via || '');
            const prev = by.get(key);
            if (prev) prev.amount += v;
            else by.set(key, { medId: e.medId, via: e.via, amount: v });
        }
        return Array.from(by.values()).sort((a, b) => b.amount - a.amount);
    }

    /**
     * Can this substance be modelled at all? Absent numbers hide the curve;
     * they never fall back to a default.
     * @returns {boolean}
     */
    function isModellable(substance) {
        return !!paramsFor(substance);
    }

    /**
     * Every substance in the table that cannot be modelled, and why. Not used by the
     * app — it is what the tests assert against, so a substance added later with
     * a contradictory Tmax fails loudly instead of quietly losing its curve.
     * @returns {Array<{id:string, reason:string}>}
     */
    function unmodellable(list) {
        const subs = list || (window.Substances && window.Substances.SUBSTANCES) || [];
        const bad = [];
        for (const s of subs) {
            const ke = keFromHalfLife(s.halfLifeH);
            if (ke == null) { bad.push({ id: s.id, reason: 'no half-life' }); continue; }
            if (!(s.tmaxH > 0)) { bad.push({ id: s.id, reason: 'no Tmax' }); continue; }
            if (solveKa(s.tmaxH, ke) == null) {
                bad.push({
                    id: s.id,
                    reason: 'Tmax ' + s.tmaxH + 'h is unreachable with a half-life of '
                        + s.halfLifeH + 'h (needs < ' + (1 / ke).toFixed(2)
                        + 'h) — the two numbers contradict, or it is an ER formulation',
                });
            }
        }
        return bad;
    }

    /* ───────────────────── the therapeutic threshold ─────────────────────
     *
     * The in-system window is roughly FOUR TIMES the working window for Vyvanse —
     * about 50 h detectable against 2-14 h of demonstrated effect. A chart that draws
     * only the first tells the user they are medicated when they are not.
     *
     * 🔴 THE THRESHOLD IS CALIBRATED, NOT INVENTED. We find the horizontal line that
     * cuts a single-dose curve at two points `durationH` apart, and store it as a
     * fraction of Cmax. The model then reproduces the label's published duration BY
     * CONSTRUCTION. We are interpolating between two facts off the label — Tmax and
     * duration — not claiming to predict pharmacodynamics, and the distinction is the
     * difference between a defensible estimate and a fabricated one.
     *
     * 🟠 ACUTE TOLERANCE IS NOT APPLIED AS A SECOND ADJUSTMENT, deliberately. For
     * stimulants the same concentration does less on the way down than on the way up
     * (clockwise hysteresis — Brauer 1996, PMID 8834422), so the felt effect fades
     * before the curve does. But the label's duration was MEASURED IN PEOPLE who have
     * that tolerance, so calibrating to it already contains the effect. Multiplying it
     * in again would double-count, and picking the multiplier would mean inventing a
     * number. It is surfaced as a caveat in words instead — see `acuteTolerance` on
     * the substance.
     */

    /**
     * The fraction of a single dose's Cmax at which the effect window is `durationH`
     * wide. Dose-independent, because the model is linear — so this is solved once per
     * substance and then scaled by whatever dose is actually being plotted.
     *
     * @param {number} ka
     * @param {number} ke
     * @param {number} durationH published duration of effect, hours
     * @returns {number|null} 0..1, or null when there is no published duration
     */
    function thresholdFraction(ka, ke, durationH) {
        if (!(durationH > 0) || !(ka > 0) || !(ke > 0)) return null;
        const tm = tmaxOf(ka, ke);
        if (!(tm > 0)) return null;
        const cmax = bateman(1, ka, ke, tm);
        if (!(cmax > 0)) return null;

        // How wide the window is at a given fraction of Cmax. Monotonically DECREASING
        // in c: a higher bar is crossed later on the way up and earlier on the way down.
        const widthAt = (c) => {
            const target = c * cmax;
            let lo = 0, hi = tm;
            for (let i = 0; i < 80; i++) {
                const m = (lo + hi) / 2;
                if (bateman(1, ka, ke, m) < target) lo = m; else hi = m;
            }
            const t1 = (lo + hi) / 2;

            let lo2 = tm, hi2 = tm + 1;
            for (let i = 0; bateman(1, ka, ke, hi2) > target; i++) {
                if (i > 200) return Infinity;
                hi2 *= 2;
            }
            for (let i = 0; i < 80; i++) {
                const m = (lo2 + hi2) / 2;
                if (bateman(1, ka, ke, m) > target) lo2 = m; else hi2 = m;
            }
            return (lo2 + hi2) / 2 - t1;
        };

        let lo = 1e-6, hi = 1 - 1e-6;
        // A duration NARROWER than the curve's width at 99.9999% of Cmax cannot be
        // produced by any threshold. That means the published duration contradicts the
        // published half-life, so refuse rather than draw a window that is not the
        // label's.
        if (widthAt(hi) > durationH) return null;
        if (widthAt(lo) < durationH) return null;
        for (let i = 0; i < 60; i++) {
            const m = (lo + hi) / 2;
            if (widthAt(m) > durationH) lo = m; else hi = m;
        }
        return (lo + hi) / 2;
    }

    const _threshCache = Object.create(null);

    /**
     * The absolute level above which a dose of `absorbedAmount` is estimated to be
     * doing something, in the same unit as the curve.
     *
     * @param {object} substance
     * @param {{ka:number, ke:number}} params  the rate constants actually being plotted
     *        — they differ by route, so the Vyvanse threshold is not the IR one
     * @param {number} absorbedAmount  a TYPICAL single dose, F already applied
     * @param {number} [routeDurationH]  the duration published for THIS route, when it
     *        differs from the substance's own: dexamfetamine from Vyvanse works for far
     *        longer than an IR dexamfetamine tablet, and calibrating it to the tablet's
     *        6 h drew Vyvanse "wearing off" hours early
     * @returns {number|null} null when there is no published duration
     */
    function effectThreshold(substance, params, absorbedAmount, routeDurationH) {
        if (!substance || !params || !(absorbedAmount > 0)) return null;
        const durationH = routeDurationH > 0 ? routeDurationH : substance.durationH;
        if (!(durationH > 0)) return null;
        const key = substance.id + '|' + params.ka + '|' + params.ke + '|' + durationH;
        if (!(key in _threshCache)) {
            _threshCache[key] = thresholdFraction(params.ka, params.ke, durationH);
        }
        const frac = _threshCache[key];
        if (!(frac > 0)) return null;
        const tm = tmaxOf(params.ka, params.ke);
        return frac * bateman(absorbedAmount, params.ka, params.ke, tm);
    }

    /**
     * When the level next falls back through `threshold`, searching forward from
     * `fromTs`. This is the "wears off around 4:10 PM" marker.
     *
     * Takes a level FUNCTION rather than a load row, so one implementation serves both
     * a single product's curve and a combined substance curve.
     *
     * @returns {number|null} ms since epoch, or null if it is already below, or if it
     *          does not cross within `horizonH`
     */
    function nextCrossingBelow(levelFn, threshold, fromTs, horizonH) {
        if (typeof levelFn !== 'function' || !(threshold > 0)) return null;
        if (levelFn(fromTs) <= threshold) return null;
        const horizon = (horizonH > 0 ? horizonH : 72) * MS_PER_HOUR;
        const step = MS_PER_HOUR / 12;          // five minutes
        let prev = fromTs;
        for (let t = fromTs + step; t <= fromTs + horizon; t += step) {
            if (levelFn(t) <= threshold) {
                // bisect the five-minute bracket down to the second
                let lo = prev, hi = t;
                for (let i = 0; i < 20; i++) {
                    const m = (lo + hi) / 2;
                    if (levelFn(m) > threshold) lo = m; else hi = m;
                }
                return Math.round((lo + hi) / 2);
            }
            prev = t;
        }
        return null;
    }

    window.PK = {
        HOURS_PER_DAY, MS_PER_HOUR, KA_KE_EPS,
        keFromHalfLife, solveKa, bateman, tmaxOf, paramsFor,
        buildLoad, levelAt, contributionsAt, isModellable, unmodellable,
        thresholdFraction, effectThreshold, nextCrossingBelow,
        zeroOrderRelease, releaseComponents, componentsLevel,
    };
})();
