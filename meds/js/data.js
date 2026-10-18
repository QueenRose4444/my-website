// ================================================
// data.js — med presets, helpers, container/supply logic,
// pharmacokinetic math, history inference, backfill estimator
// ================================================
(function () {
    'use strict';

    // ------------------------------------------------
    // Medication presets
    // halfLife / timeToPeak in DAYS. frequency in days.
    // titration: standard step-up schedule used by the
    // onboarding backfill estimator.
    // splitDose: container can be dialed to take partial doses
    // (clicks). 60 clicks = 1 full dose at container strength.
    // ------------------------------------------------
    // SINGLE source of truth for the project repo — every link in the app
    // (settings footer, site top bar via [data-repo-link]) reads this.
    const REPO_URL = 'https://github.com/QueenRose4444/my-website';

    const MED_PRESETS = [
        {
            presetId: 'mounjaro', name: 'Mounjaro', generic: 'Tirzepatide', type: 'injection',
            doses: [2.5, 5, 7.5, 10, 12.5, 15], frequency: 7, halfLife: 5, timeToPeak: 2,
            penCapacity: 4, pensPerPackage: 1, unit: 'mg', color: '#5fc8c8',
            splitDose: true, clicksPerDose: 60,
            titration: [{ dose: 2.5, weeks: 4 }, { dose: 5, weeks: 4 }, { dose: 7.5, weeks: 4 }, { dose: 10, weeks: 4 }, { dose: 12.5, weeks: 4 }, { dose: 15, weeks: 4 }],
            missedDose: {
                takeWithinDays: 4, minGapDays: 3,
                note: 'Take a missed dose as soon as possible. If there are fewer than 3 days until your next scheduled dose, skip it and take the next one on your usual day.',
                sourceLabel: 'Mounjaro Australian Product Information',
                sourceUrl: 'https://medsinfo.com.au/api/documents/Mounjaro_PI?format=pdf',
            },
        },
        {
            presetId: 'zepbound', name: 'Zepbound (US)', aka: ['Zepbound'], generic: 'Tirzepatide — the US brand; Australia uses Mounjaro', type: 'injection',
            doses: [2.5, 5, 7.5, 10, 12.5, 15], frequency: 7, halfLife: 5, timeToPeak: 2,
            penCapacity: 4, pensPerPackage: 1, unit: 'mg', color: '#ed6b5e',
            splitDose: true, clicksPerDose: 60,
            titration: [{ dose: 2.5, weeks: 4 }, { dose: 5, weeks: 4 }, { dose: 7.5, weeks: 4 }, { dose: 10, weeks: 4 }, { dose: 12.5, weeks: 4 }, { dose: 15, weeks: 4 }],
            missedDose: {
                takeWithinDays: 4, minGapDays: 3,
                note: 'Take a missed dose within 4 days (96 h). More than 4 days late: skip it and take the next dose on your usual day. Never take 2 doses within 3 days of each other.',
                sourceLabel: 'Lilly — Zepbound prescribing information',
                sourceUrl: 'https://uspl.lilly.com/zepbound/zepbound.html#pi',
            },
        },
        {
            presetId: 'ozempic', name: 'Ozempic', generic: 'Semaglutide', type: 'injection',
            doses: [0.25, 0.5, 1, 2], frequency: 7, halfLife: 7, timeToPeak: 2,
            penCapacity: 4, pensPerPackage: 1, unit: 'mg', color: '#6fcf97',
            titration: [{ dose: 0.25, weeks: 4 }, { dose: 0.5, weeks: 4 }, { dose: 1, weeks: 4 }, { dose: 2, weeks: 4 }],
            missedDose: {
                takeWithinDays: 5, minGapDays: 2,
                note: 'Take a missed dose as soon as possible, within 5 days of when it was due. More than 5 days late: skip it and take the next dose on your usual day.',
                sourceLabel: 'Ozempic Australian Product Information',
                sourceUrl: 'https://medsinfo.com.au/api/documents/Ozempic_PI?format=pdf',
            },
        },
        {
            presetId: 'wegovy', name: 'Wegovy', generic: 'Semaglutide', type: 'injection',
            doses: [0.25, 0.5, 1, 1.7, 2.4, 7.2], frequency: 7, halfLife: 7, timeToPeak: 2,
            penCapacity: 4, pensPerPackage: 1, unit: 'mg', color: '#a78bfa',
            titration: [{ dose: 0.25, weeks: 4 }, { dose: 0.5, weeks: 4 }, { dose: 1, weeks: 4 }, { dose: 1.7, weeks: 4 }, { dose: 2.4, weeks: 4 }],
            missedDose: {
                takeWithinDays: 5, minGapDays: 2,
                note: 'Take a missed dose as soon as possible, within 5 days of when it was due. More than 5 days late: skip it and take the next dose on your usual day. If you miss more doses than that, ask your prescriber about restarting at a lower dose.',
                sourceLabel: 'Wegovy Australian Product Information',
                sourceUrl: 'https://medsinfo.com.au/api/documents/Wegovy_PI?format=pdf',
            },
        },
        {
            presetId: 'saxenda', name: 'Saxenda', generic: 'Liraglutide', type: 'injection',
            doses: [0.6, 1.2, 1.8, 2.4, 3.0], frequency: 1, halfLife: 0.55, timeToPeak: 0.45,
            // each container holds 18mg total — 6 doses at the 3.0mg maintenance dose
            // (30 at 0.6mg; edit capacity to match your dose level)
            penCapacity: 6, pensPerPackage: 5, unit: 'mg', color: '#f0b955',
            titration: [{ dose: 0.6, weeks: 1 }, { dose: 1.2, weeks: 1 }, { dose: 1.8, weeks: 1 }, { dose: 2.4, weeks: 1 }, { dose: 3.0, weeks: 1 }],
            missedDose: {
                takeWithinDays: 0.5, minGapDays: 0.5,
                note: 'Missed a dose by less than 12 hours: take it as soon as possible. If there are less than 12 hours to your next dose, skip it and carry on with the next one. Never take extra to make up for it.',
                sourceLabel: 'Saxenda Australian Product Information',
                sourceUrl: 'https://medsinfo.com.au/api/documents/Saxenda_PI?format=pdf',
            },
        },
        {
            presetId: 'rybelsus', name: 'Rybelsus', generic: 'Semaglutide', type: 'pill',
            doses: [3, 7, 14], frequency: 1, halfLife: 7, timeToPeak: 0.04,
            // Oral semaglutide is the same molecule as Ozempic's, absorbed far worse:
            // about 1% reaches the blood, against 89% from an injection. It is a
            // PRODUCT property, so a combined semaglutide curve does not draw a 14 mg
            // tablet as if it were a 14 mg injection.
            bioavailability: 0.01,
            penCapacity: 30, pensPerPackage: 1, unit: 'mg', color: '#fbbf24',
            titration: [{ dose: 3, weeks: 4 }, { dose: 7, weeks: 4 }, { dose: 14, weeks: 4 }],
            missedDose: {
                takeWithinDays: 0, minGapDays: 0.75,
                note: 'Missed your morning tablet: skip it and take the next one the following day. Don’t take it later in the day, and never take 2 doses at once.',
                sourceLabel: 'Rybelsus Australian Product Information (TGA)',
                sourceUrl: 'https://tga.gov.au/sites/default/files/2022-11/auspar-rybelsus-20221027-pi.pdf',
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
                sourceUrl: 'https://www.nhs.uk/medicines/metformin/',
            },
        },
        {
            presetId: 'trulicity', name: 'Trulicity', generic: 'Dulaglutide', type: 'injection',
            // Australia registers one strength, 1.5 mg a week (AU PI, PBS 11364D);
            // 0.75, 3 and 4.5 mg are US strengths.
            doses: [1.5], frequency: 7, halfLife: 4.7, timeToPeak: 2,
            penCapacity: 1, pensPerPackage: 4, unit: 'mg', color: '#f48fb1',
            missedDose: {
                takeWithinDays: 4, minGapDays: 3,
                note: 'Take a missed dose as soon as possible if there are at least 3 days (72 h) until your next scheduled dose. If less than 3 days remain, skip it and take the next dose on your usual day.',
                sourceLabel: 'Trulicity Australian Product Information',
                sourceUrl: 'https://medsinfo.com.au/api/documents/Trulicity_PI?format=pdf',
            },
        },

        // ---------------- ADHD ----------------
        {
            // The brand goes in `aka`, not in the name. "Vyvanse / Elvanse" as a
            // name reads like a product that does not exist, and it is not a pattern
            // for multi-brand presets to copy. Search and the preset-to-med match
            // both read `aka`, so a med already named "Vyvanse / Elvanse" keeps its link.
            presetId: 'vyvanse', name: 'Vyvanse', aka: ['Elvanse', 'Vyvanse / Elvanse'], generic: 'Lisdexamfetamine', type: 'pill', category: 'ADHD',
            // AU strengths are 20-70 mg (AU PI, ARTG); there is no 10 mg here.
            doses: [20, 30, 40, 50, 60, 70], frequency: 1, halfLife: 0.46, timeToPeak: 0.16,
            penCapacity: 30, pensPerPackage: 1, unit: 'mg', color: '#c084fc',
            titration: [{ dose: 30, weeks: 1 }, { dose: 50, weeks: 2 }, { dose: 70, weeks: 4 }],
            missedDose: {
                takeWithinDays: 0, minGapDays: 0.6,
                note: 'Skip a missed dose and take the next one at the usual time — taking it later in the day can wreck your sleep, and never double up.',
                sourceLabel: 'Drugs.com — Vyvanse',
                sourceUrl: 'https://www.drugs.com/vyvanse.html#:~:text=miss%20a%20dose',
            },
        },
        {
            // Not registered in Australia (no ARTG entry); kept for people elsewhere.
            presetId: 'adderall-xr', name: 'Adderall XR (US)', aka: ['Adderall XR'], generic: 'Mixed amfetamine salts ER — not sold in Australia', type: 'pill', category: 'ADHD',
            // Half immediate-release beads, half delayed — the label describes it as
            // mimicking two doses given four hours apart.
            release: { fractions: [{ frac: 0.5, delayH: 0 }, { frac: 0.5, delayH: 4 }] },
            doses: [5, 10, 15, 20, 25, 30], frequency: 1, halfLife: 0.42, timeToPeak: 0.29,
            penCapacity: 30, pensPerPackage: 1, unit: 'mg', color: '#fb923c',
            titration: [{ dose: 10, weeks: 1 }, { dose: 20, weeks: 2 }, { dose: 30, weeks: 4 }],
            missedDose: {
                takeWithinDays: 0, minGapDays: 0.6,
                note: 'Skip a missed dose and take the next one at the usual time — avoid taking it late in the day (sleep), and never double up.',
                sourceLabel: 'Drugs.com — Adderall',
                sourceUrl: 'https://www.drugs.com/adderall.html#:~:text=miss%20a%20dose',
            },
        },
        {
            presetId: 'ritalin-ir', name: 'Ritalin (IR)', generic: 'Methylphenidate', type: 'pill', category: 'ADHD',
            doses: [5, 10, 20], frequency: 0.5, halfLife: 2.5 / 24, timeToPeak: 2 / 24,
            penCapacity: 30, pensPerPackage: 1, unit: 'mg', color: '#f87171',
            titration: [{ dose: 5, weeks: 1 }, { dose: 10, weeks: 2 }, { dose: 20, weeks: 4 }],
            missedDose: {
                takeWithinDays: 0, minGapDays: 0.15,
                note: 'Skip the missed dose and take your next dose at the usual time. Do not take 2 doses to make up for a forgotten dose.',
                sourceLabel: 'NHS — methylphenidate for adults',
                sourceUrl: 'https://www.nhs.uk/medicines/methylphenidate-adults/how-and-when-to-take-methylphenidate-for-adults/#:~:text=If%20you%20forget',
            },
        },
        {
            presetId: 'concerta', name: 'Concerta', aka: ['Concerta XL'], generic: 'Methylphenidate ER', type: 'pill', category: 'ADHD',
            // The OROS tablet is an immediate-release overcoat over an osmotic
            // core that pushes the rest out across the following hours. 22/78 is the
            // split described on the label, and it is why Concerta's observed Tmax of
            // ~7 h cannot be produced by first-order absorption of a single bolus —
            // so it is modelled from its release components rather than drawn as an
            // immediate-release product.
            //
            // The AU PI: the overcoat gives "an initial maximum at about 1 to 2 hours",
            // then the core's drug "is gradually released over the next few hours" with
            // the peak "at about 6 to 8 hours" (6.8 h measured, 18 mg). So the 78% is a
            // steady release, not a lump at 6 h. Its length, 6.8 h, is fitted so the
            // composite peak lands on that measured 6.8 h. The 22/78 split itself is
            // from the US label; the AU PI does not state it.
            release: { type: 'zero-order', immediateFrac: 0.22, durationH: 6.8 },
            doses: [18, 27, 36, 54], frequency: 1, halfLife: 0.15, timeToPeak: 0.29,
            penCapacity: 30, pensPerPackage: 1, unit: 'mg', color: '#f59e0b',
            titration: [{ dose: 18, weeks: 1 }, { dose: 36, weeks: 2 }, { dose: 54, weeks: 4 }],
            missedDose: {
                takeWithinDays: 0, minGapDays: 0.6,
                note: 'Skip the missed dose and take your next dose at the usual time — taking it late in the day can affect sleep. Do not take 2 doses to make up for a forgotten one.',
                sourceLabel: 'NHS — methylphenidate for adults',
                sourceUrl: 'https://www.nhs.uk/medicines/methylphenidate-adults/how-and-when-to-take-methylphenidate-for-adults/#:~:text=If%20you%20forget',
            },
        },
        {
            presetId: 'atomoxetine', name: 'Strattera', generic: 'Atomoxetine', type: 'pill', category: 'ADHD',
            doses: [10, 18, 25, 40, 60, 80, 100], frequency: 1, halfLife: 5.2 / 24, timeToPeak: 1.5 / 24,
            penCapacity: 28, pensPerPackage: 1, unit: 'mg', color: '#38bdf8',
            titration: [{ dose: 40, weeks: 1 }, { dose: 80, weeks: 4 }],
            missedDose: {
                takeWithinDays: 0.4, minGapDays: 0.4,
                note: 'Take it as soon as you remember that day; if it’s nearly the next day, skip it. Never take a double dose.',
                sourceLabel: 'Drugs.com — atomoxetine',
                sourceUrl: 'https://www.drugs.com/atomoxetine.html#:~:text=miss%20a%20dose',
            },
        },
        {
            presetId: 'dexamfetamine-ir', name: 'Dexamfetamine (IR)', generic: 'Dexamfetamine sulfate 5 mg tablets', type: 'pill', category: 'ADHD',
            doses: [2.5, 5, 10, 15, 20], frequency: 0.5, halfLife: 0.42, timeToPeak: 0.125,
            penCapacity: 28, pensPerPackage: 1, unit: 'mg', color: '#fdba74',
            titration: [{ dose: 5, weeks: 1 }, { dose: 10, weeks: 2 }, { dose: 20, weeks: 4 }],
            missedDose: {
                takeWithinDays: 0, minGapDays: 0.15,
                note: 'Skip the missed dose and take the next at its usual time — taking it late in the day can affect sleep. Never double up.',
            },
        },
        {
            presetId: 'adderall-ir', name: 'Adderall (IR, US)', aka: ['Adderall (IR)'], generic: 'Mixed amfetamine salts — not sold in Australia', type: 'pill', category: 'ADHD',
            doses: [5, 10, 15, 20, 30], frequency: 0.5, halfLife: 0.42, timeToPeak: 0.125,
            penCapacity: 30, pensPerPackage: 1, unit: 'mg', color: '#fca5a5',
            titration: [{ dose: 5, weeks: 1 }, { dose: 10, weeks: 2 }, { dose: 20, weeks: 4 }],
            missedDose: {
                takeWithinDays: 0, minGapDays: 0.15,
                note: 'Skip the missed dose and take the next at its usual time — taking it late in the day can affect sleep. Never double up.',
                sourceLabel: 'Drugs.com — Adderall',
                sourceUrl: 'https://www.drugs.com/adderall.html#:~:text=miss%20a%20dose',
            },
        },
        {
            presetId: 'guanfacine-xr', name: 'Intuniv', aka: ['Intuniv XR'], generic: 'Guanfacine ER', type: 'pill', category: 'ADHD',
            doses: [1, 2, 3, 4], frequency: 1, halfLife: 18 / 24, timeToPeak: 5 / 24,
            penCapacity: 28, pensPerPackage: 1, unit: 'mg', color: '#34d399',
            titration: [{ dose: 1, weeks: 1 }, { dose: 2, weeks: 1 }, { dose: 3, weeks: 1 }, { dose: 4, weeks: 4 }],
            missedDose: {
                takeWithinDays: 0, minGapDays: 0.6,
                note: 'Skip the missed dose and resume your usual schedule. If you miss 2 or more doses in a row, talk to your prescriber — re-titration may be needed.',
            },
        },

        // ---------------- HRT — feminising ----------------
        {
            presetId: 'estradiol-tab', name: 'Estradiol tablets', generic: 'Estradiol / valerate (Estrofem, Progynova)', type: 'pill', category: 'HRT — feminising',
            doses: [1, 2, 3, 4, 6, 8], frequency: 1, halfLife: 15 / 24, timeToPeak: 5 / 24,
            penCapacity: 28, pensPerPackage: 1, unit: 'mg', color: '#f472b6',
            titration: [{ dose: 2, weeks: 12 }, { dose: 4, weeks: 12 }, { dose: 6, weeks: 12 }],
            missedDose: {
                takeWithinDays: 0, minGapDays: 0.5,
                note: 'Skip the missed dose and take or use your next dose at the usual time — never take 2 doses at once.',
                sourceLabel: 'NHS — oestrogen tablets, patches, gel & spray',
                sourceUrl: 'https://www.nhs.uk/medicines/hormone-replacement-therapy-hrt/oestrogen-tablets-patches-gel-and-spray/how-and-when-to-take-or-use-oestrogen-tablets-patches-gel-and-spray/#:~:text=If%20you%20forget',
            },
        },
        {
            // A patch is zero-order by design: it delivers a stated amount per day for
            // the whole wear time. Drawn as a bolus it shows a peak that does not
            // exist, on a product whose entire point is not having one. Twice-weekly wear is ~84 h.
            release: { type: 'zero-order', immediateFrac: 0, durationH: 84, ratePerDay: true },
            presetId: 'estradiol-patch', name: 'Estradiol patches', generic: 'Estradiol TD (Estradot, Evorel)', type: 'patch', category: 'HRT — feminising',
            doses: [25, 37.5, 50, 75, 100, 150, 200], frequency: 3.5, halfLife: 1.2, timeToPeak: 1,
            penCapacity: 8, pensPerPackage: 1, unit: 'mcg', color: '#e879f9',
            titration: [{ dose: 50, weeks: 12 }, { dose: 100, weeks: 12 }, { dose: 150, weeks: 12 }],
            missedDose: {
                takeWithinDays: 1.5, minGapDays: 1,
                note: 'Forgot to change your patch: change it as soon as you remember and apply the next one at the usual time. If it’s almost time for the next patch, skip the missed one and change on the usual day.',
                sourceLabel: 'NHS — oestrogen tablets, patches, gel & spray',
                sourceUrl: 'https://www.nhs.uk/medicines/hormone-replacement-therapy-hrt/oestrogen-tablets-patches-gel-and-spray/how-and-when-to-take-or-use-oestrogen-tablets-patches-gel-and-spray/#:~:text=forget%20to%20change',
            },
        },
        {
            presetId: 'estradiol-gel', name: 'Estradiol gel', generic: 'Estradiol (Oestrogel, Sandrena)', type: 'gel', category: 'HRT — feminising',
            doses: [0.5, 0.75, 1, 1.5, 2, 3], frequency: 1, halfLife: 0.6, timeToPeak: 0.2,
            penCapacity: 64, pensPerPackage: 1, unit: 'mg', color: '#fb7185',
            titration: [{ dose: 1.5, weeks: 12 }, { dose: 3, weeks: 12 }],
            missedDose: {
                takeWithinDays: 0, minGapDays: 0.5,
                note: 'Skip the missed dose and use your next dose at the usual time — never use 2 doses at once.',
                sourceLabel: 'NHS — oestrogen tablets, patches, gel & spray',
                sourceUrl: 'https://www.nhs.uk/medicines/hormone-replacement-therapy-hrt/oestrogen-tablets-patches-gel-and-spray/how-and-when-to-take-or-use-oestrogen-tablets-patches-gel-and-spray/#:~:text=If%20you%20forget',
            },
        },
        {
            presetId: 'estradiol-inj', name: 'Estradiol injection', generic: 'Estradiol valerate / enanthate', type: 'injection', category: 'HRT — feminising',
            doses: [3, 4, 5, 6, 8, 10], frequency: 7, halfLife: 3.5, timeToPeak: 2,
            penCapacity: 10, pensPerPackage: 1, unit: 'mg', color: '#d946ef',
            titration: [{ dose: 4, weeks: 12 }, { dose: 5, weeks: 12 }],
            missedDose: {
                takeWithinDays: 3, minGapDays: 3,
                note: 'A few days late is commonly taken when remembered, then continue as normal — injectable oestrogen schedules vary a lot, follow your prescriber’s plan.',
            },
        },
        {
            presetId: 'spironolactone', name: 'Spironolactone', generic: 'Spironolactone', type: 'pill', category: 'HRT — feminising',
            doses: [25, 50, 100, 150, 200], frequency: 1, halfLife: 16.5 / 24, timeToPeak: 4.3 / 24,
            penCapacity: 28, pensPerPackage: 1, unit: 'mg', color: '#4ade80',
            titration: [{ dose: 50, weeks: 4 }, { dose: 100, weeks: 8 }, { dose: 200, weeks: 12 }],
            missedDose: {
                takeWithinDays: 0.4, minGapDays: 0.4,
                note: 'Take it when you remember that day (avoid late evening — it makes you pee); if it’s nearly time for the next dose, skip it. Never double up.',
            },
        },
        {
            presetId: 'cyproterone', name: 'Cyproterone', generic: 'Cyproterone acetate (Androcur)', type: 'pill', category: 'HRT — feminising',
            doses: [6.25, 12.5, 25, 50], frequency: 1, halfLife: 43.9 / 24, timeToPeak: 3 / 24,
            penCapacity: 56, pensPerPackage: 1, unit: 'mg', color: '#22d3ee',
            missedDose: {
                takeWithinDays: 0.4, minGapDays: 0.4,
                note: 'Skip the missed dose and take the next at the usual time — its long half-life means one miss matters little. Never double up.',
            },
        },
        {
            presetId: 'bicalutamide', name: 'Bicalutamide', generic: 'Bicalutamide', type: 'pill', category: 'HRT — feminising',
            doses: [25, 50], frequency: 1, halfLife: 7, timeToPeak: 31 / 24,
            penCapacity: 28, pensPerPackage: 1, unit: 'mg', color: '#a3e635',
            missedDose: {
                takeWithinDays: 0, minGapDays: 0.5,
                note: 'Skip the missed dose and take the next at the usual time — its ~6-day half-life keeps levels steady. Never double up.',
            },
        },
        {
            presetId: 'progesterone', name: 'Progesterone', generic: 'Micronised (Utrogestan, Prometrium)', type: 'pill', category: 'HRT — feminising',
            doses: [100, 200, 300], frequency: 1, halfLife: 16.8 / 24, timeToPeak: 2.2 / 24,
            penCapacity: 30, pensPerPackage: 1, unit: 'mg', color: '#facc15',
            missedDose: {
                takeWithinDays: 0, minGapDays: 0.5,
                note: 'Skip the missed dose and take the next at your usual bedtime — never double up (it’s sedating).',
            },
        },

        // ---------------- HRT — masculinising ----------------
        {
            presetId: 'testosterone-inj', name: 'Testosterone injection', generic: 'Enanthate / cypionate', type: 'injection', category: 'HRT — masculinising',
            doses: [50, 75, 100, 125, 150, 200, 250], frequency: 7, halfLife: 4.5, timeToPeak: 1.5,
            penCapacity: 10, pensPerPackage: 1, unit: 'mg', color: '#60a5fa',
            titration: [{ dose: 50, weeks: 12 }, { dose: 100, weeks: 12 }],
            missedDose: {
                takeWithinDays: 3, minGapDays: 3,
                note: 'A few days late is usually taken when remembered, then continue your normal schedule — plans vary (weekly vs fortnightly, Sustanon…), follow your prescriber.',
            },
        },
        {
            presetId: 'testosterone-gel', name: 'Testosterone gel', generic: 'Testogel / Tostran', type: 'gel', category: 'HRT — masculinising',
            doses: [20.25, 40.5, 50, 81], frequency: 1, halfLife: 0.5, timeToPeak: 0.15,
            penCapacity: 30, pensPerPackage: 1, unit: 'mg', color: '#818cf8',
            missedDose: {
                takeWithinDays: 0.5, minGapDays: 0.5,
                note: 'Apply it when you remember; if the next application is due within about a day, skip the missed one — never apply double.',
            },
        },

        // ── Pain ──────────────────────────────────────────────────────
        //
        // All PRN by design: `frequency: null` (D.isPRN), never a sentinel. A pain
        // med you take "when needed" must never go overdue, and `minGapDays` is what
        // answers "may I have another yet" instead.
        //
        // 🔴 EVERY ONE OF THESE IS A COMBINATION-PRODUCT RISK. The ceiling is on the
        // INGREDIENT, not the product: Panadeine Forte at its own labelled maximum is
        // EXACTLY 4000 mg of paracetamol with zero headroom, so one Panadol on top is
        // supratherapeutic. That is what the ingredient ledger exists for, and
        // why `unit: 'tablet'` with per-tablet ingredient strengths matters here — a
        // product counted in tablets cannot be summed any other way.
        //
        // 🔴 AU SCHEDULING: every codeine combination has been PRESCRIPTION-ONLY (S4)
        // since 1 February 2018. Any copy implying these are over-the-counter is eight
        // years out of date.
        {
            presetId: 'paracetamol', name: 'Paracetamol', generic: 'Panadol, Dymadon, Panamax',
            type: 'pill', category: 'Pain', unit: 'tablet',
            doses: [1, 2], frequency: null, halfLife: 2.5 / 24, timeToPeak: 1 / 24,
            penCapacity: 20, pensPerPackage: 1, color: '#9ca3af',
            ingredients: [{ substanceId: 'paracetamol', mgPerDoseUnit: 500 }],
            missedDose: {
                takeWithinDays: 0, minGapDays: 4 / 24,
                note: 'At least 4 hours between doses, and no more than 4000 mg (8 x 500 mg tablets) in any 24 hours — counting every product that contains paracetamol, not just this one.',
                sourceLabel: 'TGA — recommended paracetamol doses',
                sourceUrl: 'https://www.tga.gov.au/news/news-articles/recommended-paracetamol-doses',
            },
        },
        {
            presetId: 'ibuprofen', name: 'Ibuprofen', generic: 'Nurofen, Brufen, Advil',
            type: 'pill', category: 'Pain', unit: 'tablet',
            doses: [1, 2], frequency: null, halfLife: 1.9 / 24, timeToPeak: 1.5 / 24,
            penCapacity: 24, pensPerPackage: 1, color: '#f59e0b',
            ingredients: [{ substanceId: 'ibuprofen', mgPerDoseUnit: 200 }],
            missedDose: {
                takeWithinDays: 0, minGapDays: 4 / 24,
                note: 'At least 4 hours apart, up to 1200 mg (6 x 200 mg) in 24 hours without a prescription. Taking it with another anti-inflammatory does not add painkilling and does add risk.',
                sourceLabel: 'Brufen AU Product Information',
                sourceUrl: 'https://www.medsinfo.com.au/api/documents/Brufen_PI?format=pdf',
            },
        },
        {
            presetId: 'naproxen', name: 'Naproxen', generic: 'Naprosyn 250 mg (naproxen)',
            type: 'pill', category: 'Pain', unit: 'tablet',
            doses: [1, 2], frequency: null, halfLife: 14 / 24, timeToPeak: 3 / 24,
            penCapacity: 20, pensPerPackage: 1, color: '#60a5fa',
            ingredients: [{ substanceId: 'naproxen', mgPerDoseUnit: 250 }],
            missedDose: {
                takeWithinDays: 0, minGapDays: 6 / 24,
                note: 'Longer-acting than ibuprofen: 250 mg every 6 to 8 hours as needed, and no more than 1250 mg in a day.',
                sourceLabel: 'Naprosyn Australian Product Information',
                sourceUrl: 'https://medsinfo.com.au/api/documents/Naprosyn_PI?format=pdf',
            },
        },
        {
            presetId: 'naprogesic', name: 'Naprogesic', generic: 'Naproxen sodium 275 mg (over the counter)',
            type: 'pill', category: 'Pain', unit: 'tablet',
            doses: [1, 2], frequency: null, halfLife: 14 / 24, timeToPeak: 3 / 24,
            penCapacity: 12, pensPerPackage: 1, color: '#3b82f6',
            // 275 mg of the sodium salt is 250 mg of naproxen; the ledger adds the two
            // kinds of product up in naproxen itself.
            ingredients: [{ substanceId: 'naproxen', mgPerDoseUnit: 275, salt: 'sodium' }],
            missedDose: {
                takeWithinDays: 0, minGapDays: 6 / 24,
                note: '275 mg every 6 to 8 hours as needed, and no more than 1375 mg of naproxen sodium (5 tablets) in a day.',
                sourceLabel: 'Anaprox (naproxen sodium) Australian Product Information',
                sourceUrl: 'https://medsinfo.com.au/api/documents/Anaprox_PI?format=pdf',
            },
        },
        {
            presetId: 'aspirin', name: 'Aspirin', generic: 'Disprin, Aspro',
            type: 'pill', category: 'Pain', unit: 'tablet',
            doses: [1, 2, 3], frequency: null, halfLife: 4 / 24, timeToPeak: 1 / 24,
            penCapacity: 24, pensPerPackage: 1, color: '#a3a3a3',
            ingredients: [{ substanceId: 'aspirin', mgPerDoseUnit: 300 }],
            missedDose: {
                takeWithinDays: 0, minGapDays: 4 / 24,
                note: 'At least 4 hours apart, and no more than 12 x 300 mg tablets in 24 hours. Not for under-16s.',
                sourceLabel: 'Aspro Clear 300 mg pack directions (retailer copy of the label)',
                sourceUrl: 'https://www.chemistwarehouse.com.au/buy/708/aspro-clear-pain-relief-24-soluble-tablets',
            },
        },
        {
            presetId: 'panadeine-forte', name: 'Panadeine Forte',
            generic: 'Paracetamol 500 mg + codeine 30 mg',
            type: 'pill', category: 'Pain', unit: 'tablet',
            doses: [1, 2], frequency: null, halfLife: 2.75 / 24, timeToPeak: 1 / 24,
            penCapacity: 20, pensPerPackage: 1, color: '#ef4444',
            // The reason the whole ingredient model exists. Two substances, one tablet,
            // and the paracetamol half shares a ceiling with every other product that
            // contains it.
            ingredients: [
                { substanceId: 'paracetamol', mgPerDoseUnit: 500 },
                { substanceId: 'codeine', mgPerDoseUnit: 30, salt: 'phosphate-hemihydrate' },
            ],
            missedDose: {
                takeWithinDays: 0, minGapDays: 4 / 24,
                note: 'Prescription-only (S4) in Australia since 2018. Eight tablets in 24 hours is its own labelled maximum — and that is EXACTLY 4000 mg of paracetamol, so there is no room for any other paracetamol product on top of it.',
                sourceLabel: 'ARTG 73507',
                sourceUrl: 'https://www.tga.gov.au/resources/artg/73507',
            },
        },
        {
            presetId: 'panadeine', name: 'Panadeine',
            generic: 'Paracetamol 500 mg + codeine 8 mg',
            type: 'pill', category: 'Pain', unit: 'tablet',
            doses: [1, 2], frequency: null, halfLife: 2.75 / 24, timeToPeak: 1 / 24,
            penCapacity: 20, pensPerPackage: 1, color: '#fb7185',
            ingredients: [
                { substanceId: 'paracetamol', mgPerDoseUnit: 500 },
                { substanceId: 'codeine', mgPerDoseUnit: 8, salt: 'phosphate-hemihydrate' },
            ],
            missedDose: {
                takeWithinDays: 0, minGapDays: 4 / 24,
                note: 'Prescription-only (S4) in Australia since 2018. Eight tablets in 24 hours is also exactly 4000 mg of paracetamol — the same zero headroom as the Forte.',
                sourceLabel: 'TGA — codeine re-scheduling',
                sourceUrl: 'https://www.tga.gov.au/final-decision-re-scheduling-codeine-frequently-asked-questions',
            },
        },
        {
            presetId: 'nurofen-plus', name: 'Nurofen Plus',
            generic: 'Ibuprofen 200 mg + codeine 12.8 mg',
            type: 'pill', category: 'Pain', unit: 'tablet',
            doses: [1, 2], frequency: null, halfLife: 2.75 / 24, timeToPeak: 1 / 24,
            penCapacity: 24, pensPerPackage: 1, color: '#fbbf24',
            ingredients: [
                { substanceId: 'ibuprofen', mgPerDoseUnit: 200 },
                { substanceId: 'codeine', mgPerDoseUnit: 12.8, salt: 'phosphate-hemihydrate' },
            ],
            missedDose: {
                takeWithinDays: 0, minGapDays: 4 / 24,
                note: 'Prescription-only (S4) in Australia since 2018. Six tablets in 24 hours, which is 1200 mg of ibuprofen — the ordinary daily maximum for ibuprofen on its own.',
                sourceLabel: 'TGA — codeine re-scheduling',
                sourceUrl: 'https://www.tga.gov.au/final-decision-re-scheduling-codeine-frequently-asked-questions',
            },
        },
        {
            presetId: 'tramadol', name: 'Tramadol', generic: 'Tramal, Ultram',
            type: 'pill', category: 'Pain', unit: 'tablet',
            doses: [1, 2], frequency: null, halfLife: 5.5 / 24, timeToPeak: 2 / 24,
            penCapacity: 20, pensPerPackage: 1, color: '#c084fc',
            ingredients: [{ substanceId: 'tramadol', mgPerDoseUnit: 50, salt: 'hydrochloride' }],
            missedDose: {
                takeWithinDays: 0, minGapDays: 4 / 24,
                note: 'Prescription-only (S4). Up to 400 mg in 24 hours, or 300 mg over the age of 75.',
                sourceLabel: 'FDA Ultram label',
                sourceUrl: 'https://www.accessdata.fda.gov/drugsatfda_docs/label/2004/20281slr030,21123slr001_Ultram_lbl.pdf',
            },
        },
        {
            presetId: 'celecoxib', name: 'Celecoxib', generic: 'Celebrex',
            type: 'pill', category: 'Pain', unit: 'tablet',
            doses: [1, 2], frequency: null, halfLife: 11 / 24, timeToPeak: 3 / 24,
            penCapacity: 30, pensPerPackage: 1, color: '#34d399',
            ingredients: [{ substanceId: 'celecoxib', mgPerDoseUnit: 100 }],
            missedDose: {
                takeWithinDays: 0, minGapDays: 12 / 24,
                note: 'Prescription-only. Up to 400 mg in 24 hours. It is still an anti-inflammatory, so it counts alongside ibuprofen and naproxen rather than instead of them.',
                sourceLabel: 'FDA Celebrex label',
                sourceUrl: 'https://www.accessdata.fda.gov/drugsatfda_docs/label/2018/020998s050lbl.pdf',
            },
        },
    ];

    // categories for the preset picker (new presets carry their own)
    const PRESET_CATEGORY_MAP = {
        mounjaro: 'GLP-1 & weight', zepbound: 'GLP-1 & weight', ozempic: 'GLP-1 & weight',
        wegovy: 'GLP-1 & weight', saxenda: 'GLP-1 & weight',
        rybelsus: 'Diabetes', metformin: 'Diabetes', trulicity: 'Diabetes',
    };
    // 🔴 A preset whose `category` is not in this list renders NOWHERE — the picker
    // groups by CATEGORY_ORDER and simply skips anything else, with no error. Adding
    // a preset and forgetting this line is a silent failure, so do both in one change.
    const CATEGORY_ORDER = ['GLP-1 & weight', 'Diabetes', 'ADHD', 'Pain', 'HRT — feminising', 'HRT — masculinising', 'Other'];
    MED_PRESETS.forEach(p => { if (!p.category) p.category = PRESET_CATEGORY_MAP[p.presetId] || 'Other'; });

    // Mounjaro / Zepbound KwikPen click reference (60 clicks = full container-strength dose)
    // clicks needed for dose D from a container of strength S = 60 * D / S
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
    const daysBetween = (a, b) => Math.round((+new Date(b) - +new Date(a)) / 86400000);

    // settings-aware formatting (settings passed in by the store)
    function fmtDate(d, settings) {
        const dt = new Date(d);
        if (isNaN(dt.getTime())) return 'N/A';
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
        if (isNaN(dt.getTime())) return '—';
        return `${dt.getDate()} ${MONTHS[dt.getMonth()]}`;
    }
    function fmtTime(d, settings) {
        const dt = new Date(d);
        if (isNaN(dt.getTime())) return 'N/A';
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

    /**
     * @param {number} kg  ALWAYS kilograms — lbs and st-lbs exist only for display
     * @param {string} unit  'kg' | 'lbs' | 'st-lbs'
     * @param {boolean} [showUnit]
     * @returns {string} The sign is applied once, to the whole thing, so a negative
     *   st-lbs weight reads "-1 st 3 lbs" and not "-1 st -3 lbs".
     */
    function fmtWeight(kg, unit, showUnit) {
        if (kg == null || isNaN(kg)) return '—';
        // Callers pass signed deltas here (an average weekly change can be negative). Format the
        // magnitude and put the sign back on the front, or st-lbs renders "-1 st -2.6 lbs" —
        // Math.floor and % both carry the sign into each part separately.
        const sign = kg < 0 ? '-' : '';
        const abs = Math.abs(kg);
        if (unit === 'lbs') return sign + kgToLbs(abs).toFixed(1) + (showUnit ? ' lbs' : '');
        if (unit === 'st-lbs') {
            const { st, lbs } = kgToStLbs(abs);
            // a small delta is under a stone, and "0 st 2.6 lbs" reads worse than "2.6 lbs"
            if (st === 0) return `${sign}${lbs.toFixed(1)}${showUnit ? ' lbs' : ''}`;
            return `${sign}${st} st ${lbs.toFixed(1)}${showUnit ? ' lbs' : ''}`;
        }
        return sign + abs.toFixed(1) + (showUnit ? ' kg' : '');
    }
    // short unit label for axis / inline use
    const unitLabel = unit => unit === 'lbs' ? 'lbs' : unit === 'st-lbs' ? 'st' : 'kg';
    // numeric chart value in chosen unit (st-lbs charts as decimal stone)
    function weightValue(kg, unit) {
        if (unit === 'lbs') return kgToLbs(kg);
        if (unit === 'st-lbs') return kg * LBS_PER_KG / LBS_PER_STONE;
        return kg;
    }

    // BMI bands for ADULTS, per the WHO classification. Deliberately not applied to under-18s,
    // athletes, pregnancy or differing body composition — which is exactly why the UI that shows
    // this must also show the caveat and the source link rather than presenting it as a verdict.
    // `tone` maps to the existing .pos / .warn / .neg delta colours.
    const BMI_BANDS = [
        { max: 18.5, key: 'under', label: 'Underweight', tone: 'warn' },
        { max: 25, key: 'healthy', label: 'Healthy range', tone: 'pos' },
        { max: 30, key: 'over', label: 'Overweight', tone: 'warn' },
        { max: Infinity, key: 'obese', label: 'Obese', tone: 'neg' },
    ];
    const BMI_SOURCE = {
        label: 'WHO — Body mass index',
        url: 'https://www.who.int/data/gho/data/themes/topics/topic-details/GHO/body-mass-index',
    };
    /**
     * @param {number} bmi
     * @returns {{key:string, label:string, tone:string, pct:number, bmi:number}}
     *   `pct` is the position on the 15-40 scale the explainer modal draws, clamped
     *   to it; `bmi` is the input echoed back so a caller can render both from one
     *   result.
     */
    function bmiBand(bmi) {
        if (bmi == null || isNaN(bmi)) return null;
        const band = BMI_BANDS.find(b => bmi < b.max) || BMI_BANDS[BMI_BANDS.length - 1];
        // position within the full 15-40 scale, for drawing a marker on a range bar
        const pct = Math.min(100, Math.max(0, ((bmi - 15) / 25) * 100));
        return { ...band, bmi, pct };
    }

    // height
    const cmToFtIn = cm => {
        const totalIn = cm * 0.393701;
        return { ft: Math.floor(totalIn / 12), inch: totalIn % 12 };
    };
    const ftInToCm = (ft, inch) => ((parseFloat(ft) || 0) * 12 + (parseFloat(inch) || 0)) / 0.393701;

    // ------------------------------------------------
    // Pharmacokinetics
    // level contribution of one entry at time t:
    //   ramp linearly to full dose over timeToPeak days,
    //   then exponential decay with the (per-dose) half-life
    // ------------------------------------------------
    // Whether we know enough about this med to model it at all. A med with no half-life must not
    // silently fall back to a default, which would draw a confident curve out of nothing — the worst
    // kind of wrong in a health app, because an invented number that looks measured is worse than a blank.
    /**
     * Do we know enough to draw a level curve for this med at all?
     * @param {Med} med
     * @returns {boolean} false for a med with no half-life. Callers MUST branch on
     *   this rather than defaulting — an invented half-life draws a confident curve
     *   for a med nobody has data for.
     */
    // ------------------------------------------------
    // Substances
    // A med is a PRODUCT; a product is made of SUBSTANCES; substances own the
    // pharmacology. Resolution lives here rather than in substances.js so that
    // file stays pure reference data with no knowledge of a med record.
    // ------------------------------------------------

    /**
     * @typedef {Object} ResolvedIngredient
     * @property {string} substanceId
     * @property {object} substance     the curated (or user-defined) record
     * @property {number} mgPerDoseUnit mg of the substance AS DISPENSED per unit of dose
     * @property {string} [salt]
     * @property {number} saltFactor    free-base mass fraction; 1 when there is no salt
     */

    /**
     * A product's ingredients, resolved against the substance tables.
     *
     * Returns `[]` — never a guess — when the med has no `ingredients` or none of
     * them name a substance we hold. Callers use that to fall back to the legacy
     * single-exponential model rather than drawing nothing.
     *
     * @param {Med} med
     * @param {object[]} [userSubstances] user-defined substances, from state
     * @returns {ResolvedIngredient[]}
     */
    function resolveIngredients(med, userSubstances) {
        const S = window.Substances;
        if (!S || !med || !Array.isArray(med.ingredients)) return [];
        const out = [];
        for (const ing of med.ingredients) {
            if (!ing || !ing.substanceId) continue;
            const substance = S.substanceById(ing.substanceId, userSubstances);
            if (!substance) continue;          // an unknown id is dropped, not defaulted
            const mgPerDoseUnit = Number(ing.mgPerDoseUnit);
            if (!isFinite(mgPerDoseUnit) || mgPerDoseUnit <= 0) continue;
            const salt = ing.salt || substance.defaultSalt || null;
            out.push({
                substanceId: ing.substanceId,
                substance,
                mgPerDoseUnit,
                salt,
                saltFactor: S.saltFactor(ing.substanceId, salt),
            });
        }
        return out;
    }

    /**
     * How many mg of FREE BASE a dose delivers for one ingredient.
     *
     * 🔴 Everything internal is mg-of-base; the UI keeps showing
     * label mg, because a user holding a 5 mg dexamfetamine tablet needs to see
     * "5 mg". That tablet is the SULFATE and delivers 3.67 mg of base, so summing
     * label mg across a Vyvanse dose and an IR dose is wrong by about 27%.
     *
     * @param {number} amount  the dose as the user recorded it, in the med's own unit
     * @param {ResolvedIngredient} ing
     * @returns {number} mg of free base
     */
    function ingredientBaseMg(amount, ing) {
        const a = Number(amount);
        if (!isFinite(a) || a <= 0 || !ing) return 0;
        return a * ing.mgPerDoseUnit * ing.saltFactor;
    }

    /**
     * Fields a corrected preset can disagree with a stored med about.
     *
     * Deliberately NOT every field. Name, colour, category and schedule are the user's
     * presentation of their own life, and a curated update has nothing to say about
     * them. These are the ones where the app claims a fact.
     */
    const RECONCILABLE = [
        { key: 'halfLife', label: 'Half-life', fmt: v => fmtDur(v) },
        { key: 'timeToPeak', label: 'Time to peak', fmt: v => fmtDur(v) },
        { key: 'unit', label: 'Unit', fmt: v => String(v) },
        {
            key: 'ingredients', label: 'What it contains',
            fmt: v => (v || []).map(i => i.substanceId + (i.salt ? ' (' + i.salt + ')' : '')).join(', ') || 'nothing',
        },
    ];
    // 🔴 DELIBERATELY ABSENT, and adding any of them back is a regression:
    //   doses           which strengths the user HAS. Almost nobody keeps all seven
    //                   Vyvanse strengths, so this fired a "built-in data has changed"
    //                   prompt on most real meds, about nothing being wrong.
    //   frequency       plenty of people are on a schedule their label does not
    //                   describe, and the app has no business calling that a mismatch.
    //   penCapacity,
    //   pensPerPackage  facts about the pack someone bought, not about the drug.
    //   name, colour,
    //   category        the user's presentation of their own life.
    // The test is not "could the preset disagree?" but "is this a fact the APP claims,
    // such that being wrong about it is OUR error to correct?".

    const sameValue = (a, b) => JSON.stringify(a == null ? null : a) === JSON.stringify(b == null ? null : b);

    /**
     * Where a med and its preset now disagree, and who owns each side.
     *
     * This is how preset corrections reach someone who already added that med:
     * `upgradeMedFromPreset` only ever fills in what is MISSING. It cannot simply
     * start overwriting instead — half this app's fields are things people
     * deliberately changed.
     *
     * So provenance decides:
     *   `curated` — the value came from a preset and the user never touched it, so a
     *               correction is applied silently. There is nothing to ask about.
     *   `user`    — including everything unmarked, which includes every med added before provenance was recorded.
     *               Shown side by side and never changed without an answer.
     *
     * A declined difference is remembered against the VALUE that was declined, so the
     * question is asked once — and asked again only if the curated figure changes
     * again, which is new information rather than the same nag.
     *
     * @param {Med} med
     * @returns {{auto:Array, ask:Array}} `auto` may be applied without asking
     */
    function presetDiff(med) {
        const out = { auto: [], ask: [] };
        if (!med || !med.presetId) return out;
        const preset = MED_PRESETS.find(p => p.presetId === med.presetId);
        if (!preset) return out;
        const prov = med._prov || {};
        const declined = med._declined || {};

        for (const spec of RECONCILABLE) {
            let theirs = preset[spec.key];
            if (spec.key === 'ingredients' && theirs == null && window.Substances) {
                // `preset.ingredients` is checked first by the line above — the pain
                // products carry their own, because the presetId map cannot express a
                // two-substance tablet.
                theirs = window.Substances.ingredientsForPreset(preset.presetId);
            }
            if (theirs == null) continue;                 // the preset has no opinion
            const mine = med[spec.key];
            if (sameValue(mine, theirs)) continue;
            const row = { key: spec.key, label: spec.label, fmt: spec.fmt, mine, theirs };
            if (prov[spec.key] === 'curated' || prov[spec.key] === 'pbs') out.auto.push(row);
            else if (!sameValue(declined[spec.key], theirs)) out.ask.push(row);
        }
        return out;
    }

    /**
     * What one dose of this product actually delivers, per substance.
     *
     * 🔴 The whole point of this function is that these two numbers are DIFFERENT and
     * both are true. `labelMg` is what is printed on the box and what the user counted
     * out; `baseMg` is how much of the molecule that is. An AU 5 mg dexamfetamine
     * tablet is the sulfate: 5 mg on the label, 3.67 mg of base in the body.
     *
     * Everything internal that COMBINES across products must use `baseMg` — otherwise
     * adding a Vyvanse dose to an IR dose is wrong by about 27%. Everything the user
     * READS stays in label mg, except where the difference is explained on screen.
     *
     * @param {Med} med
     * @param {number} amount the dose as recorded, in the med's own unit
     * @param {object[]} [userSubstances]
     * @returns {Array<{substance:object, salt:string|null, saltFactor:number,
     *                  labelMg:number, baseMg:number}>}
     */
    function doseBaseMg(med, amount, userSubstances) {
        return resolveIngredients(med, userSubstances).map(ing => ({
            substance: ing.substance,
            salt: ing.salt,
            saltFactor: ing.saltFactor,
            labelMg: Number(amount) * ing.mgPerDoseUnit,
            baseMg: ingredientBaseMg(amount, ing),
        }));
    }

    // ------------------------------------------------
    // Rolling ingredient ceilings
    // ------------------------------------------------

    /**
     * 🔴 THE LEDGER SUMS LABEL MG, NOT BASE MG, and the difference matters.
     *
     * `maxPer24h` is a figure off a label — "4000 mg of paracetamol", "240 mg of
     * codeine" — and a label counts the substance AS DISPENSED. Summing free base
     * here would compare 177 mg of codeine base against a 240 mg ceiling written for
     * the phosphate, and quietly allow a third more than it should.
     *
     * Base mass is for COMBINING one molecule across products on a chart.
     * Label mass is for comparing against a labelled ceiling. They are different
     * questions and this is the one place both are in scope at once.
     */

    const WINDOW_H = 24;

    /**
     * Every ingredient taken in the last `windowH` hours, summed across products.
     *
     * Off `timestamp`, never the local `date` string: `date` is a calendar day, so
     * 4 g at 11 pm and 4 g at 1 am would pass unwarned — and that is the ordinary
     * way a paracetamol overdose actually happens.
     *
     * @param {Med[]} meds
     * @param {Dose[]} doseLog
     * @param {number} [atTs]
     * @param {number} [windowH]
     * @param {object} [userLimits] the user's own ceilings; defaults to the live state
     * @returns {Map<string, {substance:object, mg:number, ceiling:number|null,
     *          limits:object, pct:number|null,
     *          entries:Array<{ts:number, medId:string, mg:number}>}>}
     */
    function ingredientLedger(meds, doseLog, atTs, windowH, userLimits) {
        const now = atTs || Date.now();
        const w = (windowH || WINDOW_H) * 3600000;
        // Default to the live state's overrides. Threading them by hand through every
        // caller risks a feature that silently does nothing because one of several
        // paths forgot a parameter.
        if (userLimits === undefined) {
            userLimits = (window.Store && window.Store.state && window.Store.state.substanceLimits) || null;
        }
        const out = new Map();
        if (!Array.isArray(meds) || !Array.isArray(doseLog)) return out;
        const medById = new Map(meds.map(m => [m.id, m]));

        for (const entry of doseLog) {
            if (!entry || !(entry.timestamp > now - w) || entry.timestamp > now) continue;
            const med = medById.get(entry.medId);
            if (!med) continue;
            for (const row of doseBaseMg(med, entry.dose)) {
                if (!(row.labelMg > 0)) continue;
                let acc = out.get(row.substance.id);
                if (!acc) {
                    const lim = window.Substances.limitsFor(row.substance.id, userLimits);
                    acc = { substance: row.substance, mg: 0,
                            ceiling: lim.maxPer24h || null, limits: lim, pct: null, entries: [] };
                    out.set(row.substance.id, acc);
                }
                // Most limits are written in label mg (what the box counts); a limit
                // marked `mass: 'base'` is written in mg of the drug itself, so a salt
                // and a base product can be added up against one figure (naproxen).
                const mg = acc.limits && acc.limits.mass === 'base' ? row.baseMg : row.labelMg;
                acc.mg += mg;
                acc.entries.push({ ts: entry.timestamp, medId: med.id, mg });
            }
        }
        out.forEach(acc => { acc.pct = acc.ceiling ? acc.mg / acc.ceiling : null; });
        return out;
    }

    /**
     * The earliest moment a further `addMg` would fit under `ceiling`.
     *
     * A rolling window only ever drops at the instants old doses age out of it, so
     * the answer is exact rather than searched: check `from`, then each
     * `entry.ts + window` in order, and take the first that fits.
     *
     * @returns {number|null} ms since epoch, or null if it already fits (or never can)
     */
    function nextSafeTime(entries, ceiling, addMg, fromTs, windowH) {
        if (!(ceiling > 0) || !(addMg > 0)) return null;
        const w = (windowH || WINDOW_H) * 3600000;
        const list = (entries || []).slice().sort((a, b) => a.ts - b.ts);
        const totalAt = t => list.reduce((a, e) => (e.ts > t - w && e.ts <= t) ? a + e.mg : a, 0);
        if (totalAt(fromTs) + addMg <= ceiling) return null;      // already fine

        for (const e of list) {
            const t = e.ts + w + 1000;       // a second past the moment it drops out
            if (t <= fromTs) continue;
            if (totalAt(t) + addMg <= ceiling) return t;
        }
        // A single dose bigger than the whole ceiling never fits, however long you
        // wait. Say nothing rather than naming a time that is not true.
        return null;
    }

    /**
     * Would this dose take an ingredient past its labelled 24-hour ceiling?
     *
     * This NEVER blocks. It reports, the caller shows it before saving, and the
     * dose logs either way — a tracker that refuses to record something a person has
     * already swallowed stops being a record, and they then have every reason to stop
     * telling it the truth.
     *
     * @param {Med[]} meds
     * @param {Dose[]} doseLog
     * @param {Med} med
     * @param {number} amount
     * @param {number} [atTs]
     * @param {object} [userLimits]
     * @returns {Array<{substance:object, limits:object, already:number, adding:number,
     *          total:number, ceiling:number, pct:number,
     *          level:'ok'|'near'|'over', safeAt:number|null}>}
     */
    function ceilingCheck(meds, doseLog, med, amount, atTs, userLimits) {
        const now = atTs || Date.now();
        const ledger = ingredientLedger(meds, doseLog, now, undefined, userLimits);
        const out = [];
        for (const row of doseBaseMg(med, amount)) {
            const lim = window.Substances.limitsFor(row.substance.id,
                userLimits === undefined
                    ? ((window.Store && window.Store.state && window.Store.state.substanceLimits) || null)
                    : userLimits);
            const ceiling = lim.maxPer24h;
            if (!(ceiling > 0) || !(row.labelMg > 0)) continue;
            const adding = lim.mass === 'base' ? row.baseMg : row.labelMg;
            const acc = ledger.get(row.substance.id);
            const already = acc ? acc.mg : 0;
            const total = already + adding;
            const pct = total / ceiling;
            const level = /** @type {'ok'|'near'|'over'} */ (
                pct > 1.0001 ? 'over' : pct >= 0.75 ? 'near' : 'ok');
            out.push({
                substance: row.substance, limits: lim,
                already, adding, total, ceiling, pct, level,
                safeAt: level === 'over'
                    ? nextSafeTime(acc ? acc.entries : [], ceiling, adding, now) : null,
            });
        }
        return out.sort((a, b) => b.pct - a.pct);
    }

    /**
     * Anti-inflammatories taken together, which the per-ingredient ceilings cannot
     * see: ibuprofen, naproxen, aspirin, diclofenac and celecoxib share the same
     * GI, renal and cardiovascular mechanism, so two of them at once is a real
     * interaction even when each is comfortably under its own cap.
     * @returns {string[]} the names, when there is more than one
     */
    function concurrentNsaids(meds, doseLog, atTs, extraMed, extraAmount) {
        const ledger = ingredientLedger(meds, doseLog, atTs);
        const names = new Set();
        ledger.forEach(acc => {
            if ((acc.substance.classes || []).indexOf('nsaid') !== -1) names.add(acc.substance.name);
        });
        if (extraMed) {
            for (const row of doseBaseMg(extraMed, extraAmount)) {
                if ((row.substance.classes || []).indexOf('nsaid') !== -1) names.add(row.substance.name);
            }
        }
        return names.size > 1 ? Array.from(names) : [];
    }

    /**
     * The earliest moment another dose would be inside every limit.
     *
     * PRN meds deliberately have no next-dose PREDICTION, because "you are overdue
     * for something you take when you need it" is nonsense.
     * This is the opposite question and it is a real one: **not "when should I", but
     * "when may I".**
     *
     * Two independent constraints, and the later one wins:
     *   the minimum gap  — `missedDose.minGapDays` since the last dose of THIS med;
     *   the 24h ceiling  — when enough of the ingredient will have aged out.
     * They can be violated independently, which is why both are checked rather than
     * one standing in for the other.
     *
     * @param {Med} med
     * @param {Dose[]} doseLog     this med's doses
     * @param {Med[]} allMeds      every med — the ceiling is cross-product
     * @param {Dose[]} allDoses
     * @param {number} [amount]    the dose being considered; defaults to the usual one
     * @param {number} [atTs]
     * @returns {{at:number, reason:'gap'|'ceiling', substance?:object}|null}
     *          null when another dose is fine right now
     */
    function nextAllowedDose(med, doseLog, allMeds, allDoses, amount, atTs) {
        const now = atTs || Date.now();
        if (!med) return null;
        const size = amount > 0 ? amount
            : (med.doses && med.doses.length ? Math.min.apply(null, med.doses) : 1);

        /** @type {{at:number, reason:'gap'|'ceiling', substance?:object}|null} */
        let best = null;
        const keep = (cand) => { if (cand && (!best || cand.at > best.at)) best = cand; };

        const gapDays = med.missedDose && med.missedDose.minGapDays;
        if (gapDays > 0) {
            const last = (doseLog || []).filter(x => x && x.timestamp <= now)
                .sort((a, b) => b.timestamp - a.timestamp)[0];
            if (last) {
                const at = last.timestamp + gapDays * 86400000;
                if (at > now) keep({ at, reason: 'gap' });
            }
        }

        for (const row of ceilingCheck(allMeds || [], allDoses || [], med, size, now)) {
            if (row.level === 'over' && row.safeAt) {
                keep({ at: row.safeAt, reason: 'ceiling', substance: row.substance });
            }
        }
        return best;
    }

    /**
     * Does this med have anything to say about when the next dose may be?
     * Absent guidance is absent, not zero — a med with no published minimum gap and
     * no ingredient ceiling simply has no answer, and inventing one would be the invented-default
     * mistake in a new place.
     * @returns {boolean}
     */
    function hasDoseTiming(med) {
        if (!med) return false;
        if (med.missedDose && med.missedDose.minGapDays > 0) return true;
        return resolveIngredients(med).some(i => {
            const l = window.Substances.limitsFor(i.substance.id,
                (window.Store && window.Store.state && window.Store.state.substanceLimits) || null);
            return l.maxPer24h > 0;
        });
    }

    /**
     * Does this med resolve to at least one substance we can model?
     * Distinct from `hasPharmacokinetics`, which asks the older question
     * "does this med carry a half-life of its own".
     * @returns {boolean}
     */
    function hasSubstances(med, userSubstances) {
        return resolveIngredients(med, userSubstances).length > 0;
    }

    /**
     * Every substance a set of meds touches, de-duplicated, with the products that
     * feed each one. This is what lets two products that feed one
     * molecule share a single curve: they arrive here as one entry with two contributors.
     * @param {Med[]} meds
     * @param {object[]} [userSubstances]
     * @returns {Array<{substance:object, from:Array<{med:Med, ing:ResolvedIngredient}>}>}
     */
    function substancesAcross(meds, userSubstances) {
        const by = new Map();
        (meds || []).forEach(med => {
            resolveIngredients(med, userSubstances).forEach(ing => {
                let row = by.get(ing.substanceId);
                if (!row) { row = { substance: ing.substance, from: [] }; by.set(ing.substanceId, row); }
                row.from.push({ med, ing });
            });
        });
        return Array.from(by.values());
    }

    /**
     * Bateman parameters for ONE med, expressed in that med's own unit.
     *
     * Two deliberate choices here, both easy to get wrong later:
     *
     * 1. **The med's own numbers win; the substance supplies the MODEL.** If the med
     *    carries a half-life or a time-to-peak, those are used — so a user who edited
     *    theirs still drives their own curve, and every preset-derived med keeps the
     *    exact numbers it had. Only the SHAPE changes: a real absorption curve instead
     *    of a straight line to the full dose.
     * 2. **Only single-ingredient products.** A two-ingredient tablet has no single
     *    amount to plot — "how much Panadeine Forte is in me" is not a question with a
     *    unit. Those are charted per substance instead.
     *
     * Returns null — never a fallback — when the two published numbers contradict each
     * other. Concerta is the real example: 3.6 h half-life with a 7 h time-to-peak is
     * unreachable by first-order absorption because it is an EXTENDED-RELEASE product,
     * and this model does not represent formulation. It keeps the legacy ramp, which is
     * wrong in a known and bounded way rather than confidently wrong.
     *
     * @param {Med} med
     * @param {object[]} [userSubstances]
     * @returns {{ka:number, ke:number, F:number, substance:object}|null}
     */
    const _medPkCache = new Map();
    function medPkParams(med, userSubstances) {
        const PK = window.PK;
        if (!PK || !med) return null;
        // A per-dose half-life table cannot be expressed as one ka/ke pair, and it is
        // always something the user set up deliberately, so it wins outright.
        if (med.dose2halfLife && Object.keys(med.dose2halfLife).length) return null;

        const ings = resolveIngredients(med, userSubstances);
        if (ings.length !== 1) return null;
        const sub = ings[0].substance;

        const hlH = (typeof med.halfLife === 'number' && med.halfLife > 0)
            ? med.halfLife * PK.HOURS_PER_DAY : sub.halfLifeH;

        // 🔴 With a release spec, `med.timeToPeak` is the FORMULATION's observed
        // peak — Concerta's ~7 h — and not how fast the molecule itself is absorbed.
        // Each released fraction absorbs like an ordinary dose of the substance, and
        // the composite peak emerges from adding them up. Feeding the formulation's
        // Tmax to the absorption solver would make Concerta unsolvable.
        const tmaxH = med.release ? sub.tmaxH
            : ((typeof med.timeToPeak === 'number' && med.timeToPeak > 0)
                ? med.timeToPeak * PK.HOURS_PER_DAY : sub.tmaxH);

        const key = [med.id, sub.id, hlH, tmaxH, JSON.stringify(med.release || 0), med.bioavailability || 0].join('|');
        if (_medPkCache.has(key)) return _medPkCache.get(key);

        let out = null;
        const ke = PK.keFromHalfLife(hlH);
        const ka = ke == null ? null : PK.solveKa(tmaxH, ke);
        // A purely zero-order product never calls `bateman`, so it does not need an
        // absorption rate at all — a patch with no immediate fraction is modellable
        // even when nothing could be solved for `ka`.
        const pureZeroOrder = !!(med.release && med.release.type === 'zero-order'
            && !(med.release.immediateFrac > 0));
        if (ke != null && (ka > 0 || pureZeroOrder)) {
            // The PRODUCT's figure wins: oral and injected semaglutide are one molecule
            // with a ~90x difference in how much of it arrives.
            const F = (med.bioavailability > 0 && med.bioavailability <= 1) ? med.bioavailability
                : (sub.bioavailability > 0 && sub.bioavailability <= 1) ? sub.bioavailability : 1;
            out = { ka: ka > 0 ? ka : null, ke, F, substance: sub, release: med.release || null };
        }
        _medPkCache.set(key, out);
        return out;
    }

    function hasPharmacokinetics(med) {
        if (!med) return false;
        if (med.dose2halfLife && Object.keys(med.dose2halfLife).length) return true;
        if (typeof med.halfLife === 'number' && isFinite(med.halfLife) && med.halfLife > 0) return true;
        // A med with no half-life of its own is still modellable if it is linked
        // to a substance that has one. This is how a product added without any
        // pharmacology gains a curve the moment it is linked.
        return !!medPkParams(med);
    }

    /**
     * The level above which this product is estimated to still be working,
     * in the product's own unit.
     *
     * Scaled to a TYPICAL dose — the most recent one logged, falling back to the
     * largest the med lists. It has to be a real dose rather than an abstract unit,
     * because the threshold is a fraction of a single dose's peak and a 5 mg tablet
     * and a 20 mg tablet do not share a working level.
     *
     * Returns null when the substance publishes no duration of effect, which is most
     * of the table. No duration, no shading — a made-up therapeutic window on a
     * medication chart is the invented-default mistake with higher stakes.
     *
     * @param {Med} med
     * @param {Dose[]} doseLog this med's doses
     * @returns {number|null}
     */
    function medEffectThreshold(med, doseLog) {
        const PK = window.PK;
        const pk = medPkParams(med);
        if (!PK || !pk || !pk.substance) return null;
        const recent = (doseLog || []).filter(x => x && x.dose > 0)
            .sort((a, b) => b.timestamp - a.timestamp)[0];
        const typical = recent ? recent.dose
            : (med.doses && med.doses.length ? Math.max.apply(null, med.doses) : null);
        if (!(typical > 0)) return null;
        return PK.effectThreshold(pk.substance, pk, typical * pk.F);
    }

    /**
     * When after a dose this med peaks, in DAYS.
     *
     * The chart samples extra points here so the peak stays sharp instead of being
     * sampled past (`charts.js`). Under the Bateman model the peak is a solved
     * quantity, not `timeToPeak` — those agree for a preset-derived med but not for
     * one that inherited its numbers from a substance.
     * @param {Med} med
     * @returns {number} days; 0 when there is nothing to sharpen
     */
    function peakOffsetDays(med) {
        const pk = medPkParams(med);
        if (pk && window.PK) {
            // An extended-release product has no single analytic Tmax — it is the sum
            // of several components with different delays. Scan it instead, coarsely:
            // this only places an extra chart sample, so a few minutes of error costs
            // nothing and a wrong analytic answer would put the sample in the gap
            // between the two humps.
            if (pk.release) {
                const comps = window.PK.releaseComponents(1, pk.release);
                let best = 0, bestH = 0;
                for (let h = 0; h <= 36; h += 0.05) {
                    const v = window.PK.componentsLevel(comps, pk.ka, pk.ke, h);
                    if (v > best) { best = v; bestH = h; }
                }
                return bestH / window.PK.HOURS_PER_DAY;
            }
            const tm = window.PK.tmaxOf(pk.ka, pk.ke);
            return tm > 0 ? tm / window.PK.HOURS_PER_DAY : 0;
        }
        return (med && med.timeToPeak) || 0;
    }

    /**
     * How much of one dose is still in the system at a given moment.
     * @param {Dose} entry
     * @param {Med} med
     * @param {number} atTs  ms since epoch
     * @returns {number|null} null when the med has no known half-life.
     */
    function doseLevelAt(entry, med, atTs, pkKnown) {
        const days = (atTs - entry.timestamp) / 86400000;
        if (days < 0) return 0;

        // The real model, where the med resolves to one substance, runs
        // through the formulation's release components, which for an
        // immediate-release product is one component holding the whole dose.
        // (A caller summing many doses passes the med's parameters in, once.)
        const pk = pkKnown === undefined ? medPkParams(med) : pkKnown;
        if (pk) {
            const tH = (atTs - entry.timestamp) / window.PK.MS_PER_HOUR;
            return window.PK.componentsLevel(
                window.PK.releaseComponents(entry.dose * pk.F, pk.release), pk.ka, pk.ke, tH);
        }

        // Legacy: a straight line up to the full dose, then exponential decay. Kept
        // because it is the only thing an unlinked med has, and because it is wrong
        // in a known, bounded way — it overstates the peak and ignores the fact that
        // elimination begins during absorption. Do not delete it to "clean up".
        const hl = (med.dose2halfLife && med.dose2halfLife[entry.dose]) || med.halfLife;
        if (!(hl > 0)) return 0;                 // unknown PK — contribute nothing, never guess
        const ttp = med.timeToPeak || 0;
        if (ttp > 0 && days <= ttp) return entry.dose * (days / ttp);
        return entry.dose * Math.pow(0.5, (days - ttp) / hl);
    }

    /**
     * Total level from every dose of one med at a given moment.
     * @param {Dose[]} doseLog  this med's doses only — it does NOT filter by medId
     * @param {Med} med
     * @param {number} atTs  ms since epoch
     * @returns {number|null} null when the med has no known half-life.
     */
    /**
     * How far back a dose can still matter: 20 half-lives of the slowest step (or of
     * absorption, when that is the slower one), after any slow release has finished.
     * By then a dose is under a millionth of itself, so skipping older ones changes
     * nothing on screen, and a two-year history stops being summed in full at every
     * point of every chart.
     */
    function levelHorizonMs(med, pk) {
        const LN2 = Math.LN2;
        if (pk) {
            const tail = Math.min(pk.ka > 0 ? pk.ka : pk.ke, pk.ke);
            if (!(tail > 0)) return Infinity;
            const r = pk.release || {};
            const releaseH = (Number(r.durationH) || 0)
                + Math.max(0, ...((r.fractions || []).map(f => Number(f.delayH) || 0)), Number(r.delayH) || 0);
            return (releaseH + 20 * LN2 / tail) * 3600000;
        }
        const hls = [Number(med.halfLife) || 0].concat(Object.values(med.dose2halfLife || {}).map(Number));
        const hl = Math.max.apply(null, hls);
        if (!(hl > 0)) return Infinity;
        return ((Number(med.timeToPeak) || 0) + 20 * hl) * 86400000;
    }

    function medLevelAt(doseLog, med, atTs) {
        if (!hasPharmacokinetics(med)) return null;   // null = "we don't know", distinct from 0
        const pk = medPkParams(med);
        const horizon = levelHorizonMs(med, pk);
        let total = 0;
        for (const s of doseLog) {
            if (s.timestamp > atTs || atTs - s.timestamp > horizon) continue;
            const v = doseLevelAt(s, med, atTs, pk);
            if (v > 0.0001) total += v;
        }
        return total;
    }

    // ------------------------------------------------
    // Pens / supply
    // container: { id, medId, dose (container strength), capacity (doses at
    //        container strength), used (float doses consumed), openedDate,
    //        exhaustedDate, note }
    // For split-dose meds `used` accumulates fractional doses
    // (a 2.5mg entry from a 5mg container consumes 0.5).
    // ------------------------------------------------
    /**
     * How many units a dose of `shotDose` takes out of `container`.
     * @param {number} shotDose  the amount taken, in the med's unit
     * @param {Container} container    `container.dose` is the container's STRENGTH, not an amount
     *                           taken — 2 units of a 5 mg container make a 10 mg dose
     * @returns {number} units consumed
     */
    function doseConsumption(shotDose, container) {
        if (!container.dose || container.dose <= 0) return 1;
        return shotDose / container.dose;
    }

    /**
     * Rebuild every container's used/opened/exhausted state from the doses that cite
     * it. Derived, never authored: the doses are the record and this follows them.
     * @param {Container[]} containers
     * @param {Dose[]} doseLog
     * @returns {Container[]}
     */
    function recomputeContainerState(containers, doseLog) {
        return containers.map(container => {
            const penShots = doseLog.filter(s => s.penId === container.id).sort((a, b) => a.timestamp - b.timestamp);
            let used = 0;
            for (const s of penShots) used += doseConsumption(s.dose, container);
            // usedOffset = manual correction from the edit-supply modal, on top
            // of whatever the assigned doses consumed
            used = Math.round((used + (container.usedOffset || 0)) * 1000) / 1000;
            used = Math.max(0, Math.min(used, container.capacity));
            const openedDate = container.openedDate || (penShots[0] ? penShots[0].date : null);
            const full = used >= container.capacity - 0.001;
            const exhaustedDate = full
                ? (penShots.length ? penShots[penShots.length - 1].date : container.exhaustedDate)
                : (container.manuallyExhausted ? container.exhaustedDate : null);
            return Object.assign({}, container, { used, openedDate, exhaustedDate });
        });
    }

    // remaining full doses (at container strength) per dose value
    function supplyByDose(containers, medId) {
        const supply = {};
        containers.filter(p => p.medId === medId).forEach(p => {
            if (p.exhaustedDate) return;
            const left = Math.floor((p.capacity - p.used) + 0.001);
            if (left > 0) supply[p.dose] = (supply[p.dose] || 0) + left;
        });
        return supply;
    }

    // best container/pack for a new dose at `dose`:
    //  1. opened, not exhausted, matching strength with enough left
    //  2. unopened matching strength
    //  3. (split-dose containers & all non-injection types) another strength with
    //     enough left — pills etc. just take 2×5mg tablets for a 10mg dose
    /**
     * Which container a new dose should come out of.
     * @param {Container[]} containers
     * @param {Med} med
     * @param {number} dose  the amount being taken, NOT a container strength
     * @returns {{container: Container|null, isNewOpen: boolean, split: boolean}}
     *   `split` means the dose is being drawn from a container of a different
     *   strength, which only non-injections and explicit splitDose meds allow.
     */
    function suggestContainerForDose(containers, med, dose) {
        const eligible = containers.filter(p => p.medId === med.id && !p.exhaustedDate);
        const enough = p => (p.capacity - p.used) >= doseConsumption(dose, p) - 0.001;
        const opened = eligible.filter(p => p.openedDate).sort((a, b) => +new Date(a.openedDate) - +new Date(b.openedDate));
        const unopened = eligible.filter(p => !p.openedDate);

        let container = opened.find(p => p.dose === dose && enough(p));
        if (container) return { container, isNewOpen: false, split: false };
        container = unopened.find(p => p.dose === dose);
        if (container) return { container, isNewOpen: true, split: false };
        const flexible = med.splitDose || (med.type && med.type !== 'injection');
        if (flexible) {
            container = opened.find(p => enough(p));
            if (container) return { container, isNewOpen: false, split: container.dose !== dose };
            container = unopened.find(p => enough(Object.assign({}, p, { used: 0 })));
            if (container) return { container, isNewOpen: true, split: container.dose !== dose };
        }
        return { container: null, isNewOpen: false, split: false };
    }

    // ------------------------------------------------
    // Infer containers from entry history (for imports / users
    // who never tracked containers). Walks chronologically, fills
    // capacity-sized containers per dose.
    // ------------------------------------------------
    /**
     * Reconstruct the containers a run of doses must have come from, for a history
     * that predates supply tracking.
     * @param {Dose[]} doseLog  doses with no penId, for one med
     * @param {Med} med
     * @returns {{containers: Container[], assignment: Object<string,string>}}
     *   `assignment` maps dose id -> container id.
     */
    function inferContainersFromDoses(doseLog, med) {
        if (!med || !doseLog.length) return { containers: [], assignment: {} };
        const cap = med.penCapacity || 4;
        const sorted = doseLog.slice().sort((a, b) => a.timestamp - b.timestamp);
        // Pills/patches/gels come in ONE strength per pack — a 10mg dose is
        // 2×5mg tablets from the same pack, not a separate 10mg pack. So all
        // doses draw from packs at the smallest logged strength. Injections
        // keep per-strength containers (you buy the strength you inject).
        const flexible = med.type && med.type !== 'injection';
        const baseDose = flexible ? Math.min(...sorted.map(s => s.dose)) : null;
        const stacks = {}; // container strength -> containers
        /** @type {Object<string,string>} dose id -> container id */
        const assignment = {};
        let seq = 0;
        for (const s of sorted) {
            const strength = flexible ? baseDose : s.dose;
            const need = strength > 0 ? s.dose / strength : 1; // tablets consumed
            if (!stacks[strength]) stacks[strength] = [];
            const stack = stacks[strength];
            let cur = stack[stack.length - 1];
            if (!cur || cur.used > cur.capacity - need + 0.001) {
                cur = {
                    id: `container-inf-${med.id}-${strength}-${seq++}-${Date.now().toString(36)}`,
                    medId: med.id, dose: strength, capacity: cap, used: 0,
                    openedDate: s.date, exhaustedDate: null, note: 'inferred from history',
                };
                stack.push(cur);
            }
            cur.used = Math.round((cur.used + need) * 1000) / 1000;
            if (cur.used >= cur.capacity - 0.001) cur.exhaustedDate = s.date;
            assignment[s.id] = cur.id;
        }
        /** @type {Container[]} */
        const containers = [];
        Object.keys(stacks).forEach(d => stacks[d].forEach(p => containers.push(p)));
        return { containers, assignment };
    }

    // ------------------------------------------------
    // Onboarding backfill estimator
    // Generates estimated past doseLog so charts/levels start correct.
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
    // Returns array of entry objects flagged estimated:true,
    // ordered oldest → newest, ending on lastDoseDate at currentDose.
    // ------------------------------------------------
    function estimateBackfillDoses(opts) {
        const med = opts.med;
        const freq = Math.max(0.02, opts.frequencyDays || med.frequency || 7);
        const time = opts.timeOfDay || '09:00';
        const locations = opts.locations || null;

        // --- Daily-plan mode: fixed slots with their own doses, every day ---
        // e.g. 17:00 → 5mg, 20:00 → 5mg, 23:00 → 10mg (2×5mg)
        if (opts.dailySlots && opts.dailySlots.length) {
            const slots = opts.dailySlots
                .filter(sl => /^\d{1,2}:\d{2}$/.test(String(sl.time)) && sl.dose > 0)
                .sort((a, b) => a.time.localeCompare(b.time));
            if (!slots.length) return [];
            const startD = new Date((opts.startDate || ymd(addDays(new Date(), -28))) + 'T00:00');
            const endD = new Date((opts.lastDoseDate || ymd(new Date())) + 'T23:59:59');
            const now = Date.now();
            const doseLog = [];
            let i = 0;
            for (let d = new Date(startD); d <= endD; d.setDate(d.getDate() + 1)) {
                for (const sl of slots) {
                    const ts = new Date(ymd(d) + 'T' + sl.time).getTime();
                    if (isNaN(ts) || ts > now) continue; // never invent future doses
                    doseLog.push({
                        id: `entry-est-${ts}-${i++}`,
                        medId: med.id,
                        dose: sl.dose,
                        date: ymd(new Date(ts)), time: sl.time, timestamp: ts,
                        location: locations ? locations[i % locations.length] : null,
                        penId: null,
                        estimated: true,
                    });
                }
            }
            doseLog.sort((a, b) => a.timestamp - b.timestamp);
            return doseLog;
        }

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
        // Never generate before the user's stated start date — compressed
        // titration plans can otherwise overflow past it.
        const startTs = opts.startDate ? new Date(opts.startDate + 'T00:00').getTime() : -Infinity;
        const totalCount = plan.reduce((a, s) => a + s.count, 0);
        const doseLog = [];
        let idx = totalCount - 1; // 0 = oldest
        for (let p = plan.length - 1; p >= 0; p--) {
            for (let c = 0; c < plan[p].count; c++) {
                const ts = lastDose.getTime() - (totalCount - 1 - idx) * freq * 86400000;
                if (ts < startTs) { idx--; continue; }
                const dt = new Date(ts);
                doseLog.push({
                    id: `entry-est-${ts}-${idx}`,
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
        doseLog.sort((a, b) => a.timestamp - b.timestamp);
        return doseLog;
    }

    // ------------------------------------------------
    // Schedule detection + next-dose prediction
    // ------------------------------------------------
    const DAY_INDEX = { Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6 };
    const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    // Estimate the user's usual day-of-week (weekly meds) and time of day
    // from their recent logs. Estimated doses are skipped — only real logs count.
    const minsToHm = mins => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(Math.round(mins) % 60).padStart(2, '0')}`;

    /**
     * Infer the schedule actually being followed, which may not be the one configured.
     * @param {Dose[]} medDoses
     * @param {Med} med
     */
    function detectSchedule(medDoses, med) {
        const recent = medDoses.filter(s => !s.estimated).slice(0, 14);
        if (!recent.length) return { day: null, time: null, times: null };
        const mins = recent
            .map(s => { const [h, m] = String(s.time || '09:00').split(':').map(Number); return (h || 0) * 60 + (m || 0); })
            .sort((a, b) => a - b);
        const median = mins[Math.floor(mins.length / 2)];
        const time = minsToHm(median);
        let day = null;
        const freq = med.frequency || 7;
        if (freq >= 5) {
            const counts = {};
            recent.forEach(s => { const d = new Date(s.timestamp).getDay(); counts[d] = (counts[d] || 0) + 1; });
            const best = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
            // only trust it when it's a real pattern, not a coin flip
            if (best != null && counts[best] >= Math.max(2, Math.ceil(recent.length * 0.4))) day = Number(best);
        }
        // multi-daily meds (e.g. 2-3× a day stimulants): find the usual time
        // SLOTS by splitting the sorted times-of-day into k groups
        let times = null;
        if (freq < 0.9 && mins.length >= 4) {
            const k = Math.min(4, Math.max(2, Math.round(1 / freq)));
            const per = Math.floor(mins.length / k);
            if (per >= 2) {
                times = [];
                for (let i = 0; i < k; i++) {
                    const group = mins.slice(i * per, i === k - 1 ? mins.length : (i + 1) * per);
                    times.push(minsToHm(group[Math.floor(group.length / 2)]));
                }
                // groups must actually be distinct times of day (≥ 2 h apart)
                const asMins = times.map(t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; });
                for (let i = 1; i < asMins.length; i++) {
                    if (asMins[i] - asMins[i - 1] < 120) { times = null; break; }
                }
            }
        }
        return { day, time, times };
    }

    // next dose prediction for a med.
    // User-set schedule (med.scheduleDay / med.scheduleTime) wins; otherwise the
    // detected pattern; otherwise simply lastDose + frequency. Weekly meds snap
    // to the usual weekday (respecting the med's minimum gap between doses), so
    // a late Friday dose still predicts "next Tuesday", not "next Friday".
    /**
     * When the next dose is due.
     * @param {Med} med         `med.frequency` is in DAYS — 1 is daily, 7 is weekly
     * @param {Dose[]} medDoses this med's doses only
     * @param {Settings} settings
     */
    function predictNextDose(med, medDoses, settings) {
        const last = medDoses[0]; // newest first
        if (!last || !med) return null;
        // PRN has no interval, so there is no next dose to predict — returning null is
        // the honest answer and every caller already handles it, because it is also what
        // a med with no history returns. Inventing a date here is what made an
        // as-needed med go "overdue".
        // Protecting a PRN med is a MINIMUM-GAP problem, not a schedule one.
        if (isPRN(med)) return null;
        const freq = freqOf(med);
        const detected = detectSchedule(medDoses, med);

        let targetDay = null;
        if (med.scheduleDay === 'daily') targetDay = null; // explicit "every day": never anchor to a weekday
        else if (med.scheduleDay && med.scheduleDay !== 'auto' && DAY_INDEX[med.scheduleDay] != null) targetDay = DAY_INDEX[med.scheduleDay];
        else if (detected.day != null) targetDay = detected.day;

        let time = (med.scheduleTime && med.scheduleTime !== 'auto') ? med.scheduleTime : (detected.time || last.time || '09:00');

        // multi-daily slot schedule: user-set slots (with optional per-slot
        // doses, e.g. 23:00 → 10mg) win, detected pattern otherwise
        const userSlots = getScheduleSlots(med);
        const slotList = userSlots.length >= 2 ? userSlots
            : (freq < 0.9 && detected.times && detected.times.length >= 2
                ? detected.times.map(t => ({ time: t, dose: null })) : null);

        const lastDt = new Date(last.date + 'T' + (last.time || '09:00'));
        let nextDate;
        let usualTimes = null;
        let usualSlots = null;   // same list, but carrying anchors
        let slotDose = null;
        let slotAnchor = null;
        let minGapMs = 0; // weekly branch re-checks the gap after the clock time lands
        if (freq < 0.95 && slotList) {
            // next time-slot after the last dose (e.g. 08:00 / 13:00 / 18:00).
            // A dose up to 90 min EARLY still counts as its slot taken — a
            // 07:30 dose against an 08:00 slot must predict the NEXT slot,
            // not 08:00 again half an hour later.
            const slots = slotList
                .map(sl => { const [h, m] = sl.time.split(':').map(Number); return { mins: (h || 0) * 60 + (m || 0), dose: sl.dose, anchor: sl.anchor || null }; })
                .sort((a, b) => a.mins - b.mins);
            const lastMins = lastDt.getHours() * 60 + lastDt.getMinutes();
            const near = slots.findIndex(sl => Math.abs(sl.mins - lastMins) <= 90);
            let slot = near >= 0 ? slots[near + 1] : slots.find(sl => sl.mins > lastMins + 15);
            nextDate = new Date(lastDt);
            if (!slot) { slot = slots[0]; nextDate.setDate(nextDate.getDate() + 1); }
            nextDate.setHours(Math.floor(slot.mins / 60), slot.mins % 60, 0, 0);
            time = minsToHm(slot.mins);
            slotDose = slot.dose;
            slotAnchor = slot.anchor;
            usualTimes = slots.map(sl => minsToHm(sl.mins));
            usualSlots = slots.map(sl => ({ time: minsToHm(sl.mins), anchor: sl.anchor }));
        } else if (targetDay != null && freq >= 5) {
            // first occurrence of the usual weekday that keeps the minimum gap;
            // beyond-weekly meds (e.g. fortnightly) aim near the full interval
            const minGap = Math.max(1, (med.missedDose && med.missedDose.minGapDays) || 3);
            const baseDays = freq <= 9 ? Math.ceil(minGap) : Math.max(Math.ceil(minGap), Math.round(freq) - 6);
            nextDate = new Date(lastDt);
            nextDate.setDate(nextDate.getDate() + baseDays);
            while (nextDate.getDay() !== targetDay) nextDate.setDate(nextDate.getDate() + 1);
            minGapMs = minGap * 86400000;
        } else if (freq >= 0.75 && freq <= 1.25) {
            nextDate = addDays(lastDt, Math.round(freq) || 1);
        } else {
            nextDate = new Date(lastDt.getTime() + freq * 86400000);
            if (freq < 0.95) time = hm(nextDate); // sub-daily: clock follows the interval
        }
        if (!usualTimes) {
            const [th, tm] = time.split(':').map(Number);
            // Hour 0 is midnight, not "missing": `th || 9` moved every dose due between
            // 00:00 and 00:59 to nine in the morning.
            nextDate.setHours(Number.isFinite(th) ? th : 9, Number.isFinite(tm) ? tm : 0, 0, 0);
            // landing on an earlier clock time can undercut the minimum gap by
            // a few hours (Sat 10:30 dose → Tue 09:00 = 70.5h < 72h) — skip
            // to the following usual weekday instead
            if (minGapMs && nextDate.getTime() - lastDt.getTime() < minGapMs) nextDate.setDate(nextDate.getDate() + 7);
        }

        const locs = (settings && settings.shotLocations && settings.shotLocations.length) ? settings.shotLocations : DEFAULT_LOCATIONS;
        const i = locs.indexOf(last.location);
        const nextLoc = locs[(i + 1) % locs.length];
        return {
            date: nextDate,
            time,
            // slot schedules own their doses (the 23:00 slot IS 10mg — a
            // "change next dose" override must not trample every slot);
            // otherwise an explicit user override wins over the last dose
            dose: slotDose != null ? slotDose
                : (med.preferredNextDose != null ? med.preferredNextDose : last.dose),
            location: nextLoc,
            // the usual-weekday chip only means something for weekly-ish meds
            usualDay: targetDay != null && freq >= 5 ? DAY_NAMES[targetDay] : null,
            usualTimes,
            // `anchor` names THIS dose ("before bed"); `usualSlots` is usualTimes
            // with the anchors attached. usualTimes is kept as-is so nothing that already
            // reads it has to change — the anchored list is additive.
            anchor: slotAnchor,
            usualSlots,
            scheduleSource: (med.scheduleDay && med.scheduleDay !== 'auto') || (med.scheduleTime && med.scheduleTime !== 'auto') || userSlots.length >= 2
                ? 'user'
                : (detected.day != null || detected.times || detected.time ? 'auto' : null),
        };
    }

    // slot doses store the TOTAL taken (23:00 → 10mg meaning 2×5mg tablets).
    // The tablet strength the user actually STOCKS is the ground truth for
    // the breakdown — presets list many strengths (2.5/5/10…), so "smallest
    // dose" would wrongly split a 5mg tablet into 2× 2.5mg.
    /**
     * How a dose is made up from what is in supply — "2 x 5 mg".
     * @param {Med} med
     * @param {number} dose  amount taken
     * @param {Container[]} containers
     */
    function doseBreakdown(med, dose, containers) {
        const plain = { count: 1, per: dose };
        if (!med || dose == null || !(med.type && med.type !== 'injection')) return plain;
        // what the user TYPED into a schedule slot is the strongest signal —
        // "2 × 5mg" must never come back as "1 × 10mg"
        const slot = getScheduleSlots(med).find(sl => sl.dose === dose && sl.count >= 2 && sl.per > 0);
        if (slot) return { count: slot.count, per: slot.per };
        const owned = [...new Set((containers || []).filter(p => p.medId === med.id && !p.exhaustedDate).map(p => p.dose))];
        let base = owned.length === 1 ? owned[0] : 0;
        if (!base) {
            // no supply signal: a dose that exists as a strength IS one tablet
            if ((med.doses || []).indexOf(dose) >= 0) return plain;
            const divisors = (med.doses || []).filter(x => x > 0 && dose / x >= 1.99 && Math.abs(dose / x - Math.round(dose / x)) < 0.01);
            base = divisors.length ? Math.max.apply(null, divisors) : 0;
        }
        if (base > 0 && dose > base) {
            const n = dose / base;
            if (Math.round(n) >= 2 && Math.abs(n - Math.round(n)) < 0.01) return { count: Math.round(n), per: base };
        }
        return plain;
    }
    function fmtDoseCount(med, dose, containers) {
        if (!med || dose == null || dose === '') return '';
        const unit = med.unit || 'mg';
        const b = doseBreakdown(med, dose, containers);
        // "2 tablets", not "2tablet" — products measured in countable things need
        // the space and the plural, and this is the string on the dashboard.
        const f = x => fmtDoseUnit(x, unit);
        return b.count >= 2 ? `${f(dose)} (${b.count}× ${f(b.per)})` : f(dose);
    }

    // what the med comes in — drives supply-tracking wording for every type
    const CONTAINER_NAMES = { injection: 'container', pill: 'pack', patch: 'box', gel: 'bottle', liquid: 'bottle', cream: 'tube' };
    /**
     * What one container is called for this med — "container", "box", "bottle".
     * @param {Med} med
     * @returns {string}
     */
    function containerName(med) {
        return CONTAINER_NAMES[(med && med.type) || 'injection'] || 'pack';
    }
    /**
     * @param {Med} med
     * @param {number} n  count, for the plural
     * @returns {string}
     */
    function containerPlural(med, n) {
        const cn = containerName(med);
        if (n === 1) return cn;
        return cn === 'box' ? 'boxes' : cn + 's';
    }

    // estimated peak and low of the level between now and the next dose
    /**
     * The peak and trough the chart should scale to.
     * @param {Dose[]} doseLog
     * @param {Med} med
     * @param {number} [nextDoseTs]
     * @returns {{peak:{ts:number,v:number}, low:{ts:number,v:number}}|null}
     *   null when the med has no known half-life, so the caller hides the curve
     *   instead of drawing a flat line. Each carries its TIME as well as its value —
     *   the chart labels when the peak falls, not just how high it is.
     */
    function levelExtremes(doseLog, med, nextDoseTs) {
        if (!hasPharmacokinetics(med)) return null;   // no half-life, no peak or trough to report
        const now = Date.now();
        const horizon = Math.max(now + 3600000, nextDoseTs || (now + (med.frequency || 1) * 86400000));
        let peak = { ts: now, v: -1 }, low = { ts: now, v: Infinity };
        const steps = 96;
        for (let i = 0; i <= steps; i++) {
            const ts = now + (horizon - now) * (i / steps);
            const v = medLevelAt(doseLog, med, ts);
            if (v > peak.v) peak = { ts, v };
            if (v < low.v) low = { ts, v };
        }
        if (!isFinite(low.v)) low = { ts: now, v: 0 };
        return { peak, low };
    }

    // normalized schedule slots — entries may be 'HH:MM' strings (older data)
    // or { time, dose } objects with an optional per-slot dose
    /**
     * The times of day this med is taken.
     * @param {Med} med  each entry of `med.doses` is the TOTAL at that slot, not a
     *   per-tablet amount
     * @returns {Array<{time:string, dose:number, count?:number, per?:number}>}
     *   `count`/`per` are present only when the user entered the dose as a count
     *   times a strength, and exist so the editor can show it back that way.
     */
    /* ───────────────────────────── schedule anchors ─────────────────────────────
     *
     * "Before bed" instead of "22:30".
     *
     * An anchor is a LABEL on a slot that still stores a real clock time. That is the
     * whole design decision: `{ time: '22:30', anchor: 'bed' }`. The five `HH:MM`
     * validators scattered across data.js / modals-log.js / modals-med.js keep
     * validating `time` and need no changes at all, reminders still fire at a real
     * moment, and the user reads "before bed".
     *
     * A purely symbolic anchor with no time would need a per-user waking and sleeping
     * schedule before it could fire a notification or place a point on a chart — a much
     * larger feature than an anchor is meant to be.
     *
     * Unknown anchor values are dropped rather than shown raw, so a bad sync or a
     * hand-edited export degrades to a plain time instead of rendering a stray key.
     */
    const SCHEDULE_ANCHORS = [
        { id: 'waking', label: 'on waking', hint: '07:00' },
        { id: 'breakfast', label: 'with breakfast', hint: '08:00' },
        { id: 'lunch', label: 'with lunch', hint: '12:30' },
        { id: 'dinner', label: 'with dinner', hint: '18:30' },
        { id: 'bed', label: 'before bed', hint: '22:30' },
    ];
    const ANCHOR_BY_ID = SCHEDULE_ANCHORS.reduce((a, x) => { a[x.id] = x; return a; }, {});

    /** Human label for an anchor id, or '' if unset/unknown. */
    function anchorLabel(anchor) {
        const a = ANCHOR_BY_ID[String(anchor || '')];
        return a ? a.label : '';
    }

    /**
     * How a slot should read to the user: "before bed (22:30)", or just the time.
     * @param {{time:string, anchor?:string}} slot
     */
    function slotLabel(slot, settings) {
        if (!slot) return '';
        const t = fmtTimeStr(slot.time, settings);
        const a = anchorLabel(slot.anchor);
        return a ? `${a} (${t})` : t;
    }

    function getScheduleSlots(med) {
        if (!med || !Array.isArray(med.scheduleTimes)) return [];
        return med.scheduleTimes.map(e => {
            if (typeof e === 'string') return /^\d{1,2}:\d{2}$/.test(e) ? { time: e, dose: null } : null;
            if (e && /^\d{1,2}:\d{2}$/.test(String(e.time))) {
                // count/per remember HOW the user entered the dose (2 × 5mg),
                // so the editor round-trips exactly what they typed
                const slot = { time: e.time, dose: e.dose > 0 ? e.dose : null };
                if (e.count >= 1 && e.per > 0) { slot.count = e.count; slot.per = e.per; }
                // This function REBUILDS the slot object rather than passing it through,
                // so anything not copied here is silently lost everywhere downstream —
                // which is exactly how an anchor would vanish from four of the five
                // paths while appearing to work in the editor.
                if (ANCHOR_BY_ID[String(e.anchor || '')]) slot.anchor = e.anchor;
                return slot;
            }
            return null;
        }).filter(Boolean);
    }

    /**
     * Scheduled slots in the recent past with no dose logged against them.
     *
     * **De-duplicates by (day, slot), not by day.** That distinction is the entire
     * feature. The bulk backfill estimator de-duplicates by DAY
     * (`modals-log.js`, `existingDays`), which is correct for a once-daily med and
     * silently wrong for a multi-slot one: log your 09:00 and the missed 20:00 becomes
     * invisible, because the day already "has a dose". Fixing the estimator is a
     * different feature with a different right answer and is deliberately left alone.
     *
     * Matching is nearest-slot-wins rather than "within a window of this slot". With
     * slots at 08:00 and 09:00 a single 08:30 dose must satisfy exactly ONE of them —
     * a per-slot window would let it cover both and hide a genuinely missed dose.
     * Each dose is consumed by at most one slot.
     *
     * @param {Med} med
     * @param {Dose[]} medDoses   this med's doses (any order)
     * @param {{days?:number, toleranceMin?:number, now?:number}} [opts]
     *   `days` how far back to look (default 7). `toleranceMin` how close a dose must
     *   be to count as that slot (default 90, capped at half the gap to the neighbouring
     *   slot so adjacent slots cannot both claim one dose).
     * @returns {Array<{date:string, time:string, anchor:string|null, dose:number|null, ts:number}>}
     *   oldest first. Empty for PRN, stopped, slotless or dose-less meds.
     */
    function missedSlots(med, medDoses, opts) {
        opts = opts || {};
        const now = opts.now != null ? opts.now : Date.now();
        const days = opts.days != null ? opts.days : 7;
        const baseTol = (opts.toleranceMin != null ? opts.toleranceMin : 90) * 60000;

        // PRN has no schedule to miss; a stopped med is not being taken; a med with no
        // history has nothing to be late against (its first dose defines the start).
        if (!med || isPRN(med) || med.stoppedAt) return [];
        const slots = getScheduleSlots(med);
        if (!slots.length) return [];
        const doseLog = (medDoses || []).slice().sort((a, b) => a.timestamp - b.timestamp);
        if (!doseLog.length) return [];

        const sorted = slots
            .map(sl => { const [h, m] = sl.time.split(':').map(Number); return { ...sl, mins: (h || 0) * 60 + (m || 0) }; })
            .sort((a, b) => a.mins - b.mins);

        // Half the distance to the nearest neighbouring slot, so two close slots cannot
        // both be satisfied by the same dose. Wraps across midnight for the end pair.
        const tolFor = i => {
            if (sorted.length === 1) return baseTol;
            const prev = sorted[(i - 1 + sorted.length) % sorted.length];
            const next = sorted[(i + 1) % sorted.length];
            const gapPrev = ((sorted[i].mins - prev.mins) + 1440) % 1440;
            const gapNext = ((next.mins - sorted[i].mins) + 1440) % 1440;
            return Math.min(baseTol, (Math.min(gapPrev, gapNext) / 2) * 60000);
        };

        const firstDose = doseLog[0].timestamp;
        const startOfToday = new Date(now); startOfToday.setHours(0, 0, 0, 0);
        const used = new Set();
        const out = [];

        for (let d = days; d >= 0; d--) {
            const day = addDays(startOfToday, -d);
            const ymdStr = ymd(day);
            for (let i = 0; i < sorted.length; i++) {
                const sl = sorted[i];
                const slotTs = new Date(day).setHours(Math.floor(sl.mins / 60), sl.mins % 60, 0, 0);
                // Not yet due, and not before they started taking it.
                if (slotTs > now || slotTs < firstDose) continue;

                const tol = tolFor(i);
                // nearest unconsumed dose to THIS slot, within its tolerance
                let best = null, bestGap = Infinity;
                for (const s of doseLog) {
                    if (used.has(s.id)) continue;
                    const gap = Math.abs(s.timestamp - slotTs);
                    if (gap <= tol && gap < bestGap) { best = s; bestGap = gap; }
                }
                if (best) { used.add(best.id); continue; }
                out.push({ date: ymdStr, time: sl.time, anchor: sl.anchor || null, dose: sl.dose, ts: slotTs });
            }
        }
        return out;
    }

    // How late is the user, and what does official guidance suggest?
    // Returns null when not meaningfully overdue. For daily/weekly meds the
    // whole due DAY counts as on time — overdue starts the next day; the
    // take-vs-skip decision still uses the precise hours-based window.
    /**
     * Is a dose late, and how late.
     * @param {Med} med
     * @param {{date: Date|string}} nextDose  a predictNextDose() result — it is the
     *   whole object, not a timestamp
     * @returns {{daysLate:number, action:string, info:Object|null}|null} `action` is
     *   'take' or 'skip'.
     *   null when not meaningfully overdue. Handles LATE only — a dose taken too
     *   EARLY is not its problem; that is the minimum-gap warning's job.
     */
    function lateDoseStatus(med, nextDose) {
        if (!med || !nextDose) return null;
        // Belt and braces: predictNextDose already returns null for PRN, so a caller
        // should never get here with one. If some future path hands us a prediction for
        // an as-needed med anyway, refuse to call it late rather than trusting it.
        if (isPRN(med)) return null;
        const due = new Date(nextDose.date);
        const now = Date.now();
        const freq = freqOf(med);
        if (freq >= 0.75) {
            const dayEnd = new Date(due);
            dayEnd.setHours(23, 59, 59, 999);
            if (now <= dayEnd.getTime()) return null;
        } else if ((now - due.getTime()) / 86400000 < Math.min(0.25, freq * 0.25)) {
            // sub-daily meds: grace scales with the dosing interval
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

    // human-friendly duration (value stored in days) — "3 h", "18 h", "5d", "3.5d"
    /**
     * An amount, with precision that matches its magnitude rather than a fixed
     * number of decimals.
     *
     * A fixed `.toFixed(3)` would make an estimated level read
     * "51.529 mg" — microgram resolution on a number derived from a half-life which,
     * for most of the substance table, carries no citation at all. That is an
     * estimate dressed as a measurement, on an app that shows health data.
     *
     * Three significant figures, trailing zeros trimmed: 1250, 51.5, 3.67, 0.042.
     * @param {number} v
     * @returns {string}
     */
    function fmtAmount(v) {
        const n = Number(v);
        if (v == null || !isFinite(n)) return '—';
        const a = Math.abs(n);
        if (a === 0) return '0';
        if (a >= 1000) return String(Math.round(n));
        const dp = a >= 100 ? 0 : a >= 10 ? 1 : a >= 1 ? 2 : a >= 0.1 ? 3 : a >= 0.01 ? 4 : 5;
        const out = n.toFixed(dp);
        return dp ? out.replace(/\.?0+$/, '') : out;
    }

    /**
     * An amount with its unit, spaced and pluralised the way a person would say it.
     *
     * "5mg" is how everyone writes a symbol unit and looks right. "1tablet" does not,
     * and neither does "2tablet" — products measured in whole countable things need
     * more than a plain `${dose}${unit}` concatenation.
     *
     * @param {number} amount
     * @param {string} unit
     * @returns {string}
     */
    // Three cases, because English has three. `5mg` is written tight; `100 IU` and
    // `10 units` take a space but never change shape; `2 tablets` is a countable word
    // and pluralises.
    const TIGHT_UNITS = ['mg', 'mcg', 'g', 'kg', 'ml', 'l'];
    const SPACED_INVARIANT = ['IU', 'units', 'unit'];
    /**
     * Is this unit a countable THING (a tablet, a patch) rather than a mass?
     * The two need different sentences: "500 mg per tablet" is right for one and
     * meaningless for the other, where the amount IS the mass.
     * @returns {boolean}
     */
    function isCountableUnit(unit) {
        const u = String(unit || '');
        return !!u && TIGHT_UNITS.indexOf(u) === -1 && SPACED_INVARIANT.indexOf(u) === -1;
    }

    function fmtDoseUnit(amount, unit) {
        const u = String(unit || '');
        const n = fmtAmount(amount);
        if (!u) return n;
        if (TIGHT_UNITS.indexOf(u) !== -1) return n + u;
        if (SPACED_INVARIANT.indexOf(u) !== -1) return n + ' ' + u;
        const plural = Number(amount) === 1 || /s$/.test(u) ? u : u + 's';
        return n + ' ' + plural;
    }

    function fmtDur(days) {
        if (days == null || isNaN(days)) return '—';
        if (days > 0 && days < 1 / 24) return `${Math.round(days * 1440)} min`;
        if (days < 0.99) {
            const h = days * 24;
            return `${h < 10 ? Math.round(h * 10) / 10 : Math.round(h)} h`;
        }
        return `${Math.round(days * 10) / 10}d`;
    }

    // human-friendly frequency (days between doses)
    /**
     * Is this a PRN ("as needed") med?
     *
     * PRN is represented as `frequency: null` — the ABSENCE of an interval, which is
     * exactly what "take it when you need it" means. Deliberately not a sentinel like
     * 0 or 999: both are real numbers that arithmetic will happily use, and a med
     * silently "due every 999 days" is harder to notice than one with no interval.
     *
     * ⚠ `med.frequency || 7` is the pattern this has to displace. It turns null into
     * weekly, so a PRN med would go overdue every seven days — the precise bug that
     * the PRN handling exists to avoid. Call sites that need a number for a scheduled med should read
     * `freqOf(med)` and check `isPRN(med)` first.
     */
    function isPRN(med) {
        return !!med && (med.frequency === null || med.frequency === undefined);
    }

    /** Dosing interval in days for a SCHEDULED med. NaN for PRN, so arithmetic that
     *  forgot to check `isPRN` produces obvious nonsense rather than a quiet weekly. */
    function freqOf(med) {
        if (isPRN(med)) return NaN;
        const f = Number(med && med.frequency);
        return f > 0 ? f : 7;
    }

    function fmtFreq(days) {
        // null/undefined is PRN, and means something different from "unknown". Checked
        // before the NaN guard below, which would otherwise swallow it into '—'.
        if (days === null || days === undefined) return 'when needed';
        if (isNaN(days) || days <= 0) return '—';
        if (days >= 6.5 && days <= 7.5) return 'weekly';
        if (days >= 13 && days <= 15) return 'fortnightly';
        if (days >= 3.2 && days <= 3.8) return 'twice weekly';
        if (days >= 0.9 && days <= 1.1) return 'daily';
        if (days >= 0.45 && days <= 0.55) return '2× a day';
        if (days >= 0.3 && days <= 0.37) return '3× a day';
        if (days < 0.9) return `every ${Math.round(days * 24)} h`;
        return `every ${Math.round(days * 10) / 10}d`;
    }

    // "nice" chart axis step (1 / 2 / 2.5 / 5 × 10^n) for a given max value.
    // divs sets how many gridlines to aim for (density) — works for
    // 0.25 mg containers and 1000 mg pills alike
    function niceStep(maxVal, divs) {
        if (!(maxVal > 0)) return 1;
        const rough = maxVal / (divs || 5);
        const mag = Math.pow(10, Math.floor(Math.log10(rough)));
        for (const m of [1, 2, 2.5, 5, 10]) {
            if (rough <= m * mag) return m * mag;
        }
        return 10 * mag;
    }

    /**
     * The order meds are offered in wherever one is picked (the Log sheet first).
     * Worked out on the device from the dose history; nothing leaves it.
     *
     *   smart   due or overdue now (soonest first), then what is usually taken at
     *           this time of day, then the most taken
     *   most    most doses in the last 90 days
     *   time    usually taken around this time of day (within 90 minutes)
     *   az      by name
     *   custom  the user's own order, anything not in it after, by smart
     *
     * @param {Med[]} meds
     * @param {Dose[]} doseLog  every dose (any order)
     * @param {object} settings
     * @param {number} [now]
     * @returns {Med[]} a new array
     */
    function orderMedsForPicker(meds, doseLog, settings, now) {
        const t = now || Date.now();
        const mode = (settings && settings.medPickerOrder) || 'smart';
        const list = (meds || []).slice();
        const byMed = new Map(list.map(m => [m.id, []]));
        (doseLog || []).forEach(x => { if (x && byMed.has(x.medId)) byMed.get(x.medId).push(x); });
        byMed.forEach(arr => arr.sort((a, b) => b.timestamp - a.timestamp));

        const since = t - 90 * 86400000;
        const count = (m) => byMed.get(m.id).filter(x => x.timestamp >= since).length;
        const nowMin = new Date(t).getHours() * 60 + new Date(t).getMinutes();
        // Share of recent doses taken within 90 minutes of this time of day (circular,
        // so 23:30 is near 00:30).
        const atThisTime = (m) => {
            const recent = byMed.get(m.id).filter(x => x.timestamp >= since);
            if (!recent.length) return 0;
            const near = recent.filter(x => {
                const d = new Date(x.timestamp);
                const diff = Math.abs(d.getHours() * 60 + d.getMinutes() - nowMin);
                return Math.min(diff, 1440 - diff) <= 90;
            }).length;
            return near / recent.length;
        };
        // Due now = predicted within the next hour, or already late.
        const dueAt = (m) => {
            const nd = predictNextDose(m, byMed.get(m.id), settings || {});
            if (!nd) return null;
            const ts = new Date(nd.date).getTime();
            return ts <= t + 3600000 ? ts : null;
        };
        const name = (m) => String(m.name || '').toLowerCase();
        const smartKey = new Map(list.map(m => [m.id, { due: dueAt(m), time: atThisTime(m), n: count(m) }]));
        const smart = (a, b) => {
            const A = smartKey.get(a.id), B = smartKey.get(b.id);
            if ((A.due != null) !== (B.due != null)) return A.due != null ? -1 : 1;
            if (A.due != null && A.due !== B.due) return A.due - B.due;
            if (Math.abs(A.time - B.time) > 0.05) return B.time - A.time;
            if (A.n !== B.n) return B.n - A.n;
            return name(a).localeCompare(name(b));
        };
        if (mode === 'az') return list.sort((a, b) => name(a).localeCompare(name(b)));
        if (mode === 'most') return list.sort((a, b) => (count(b) - count(a)) || smart(a, b));
        if (mode === 'time') return list.sort((a, b) => (atThisTime(b) - atThisTime(a)) || smart(a, b));
        if (mode === 'custom') {
            const order = (settings && settings.medCustomOrder) || [];
            const pos = (m) => { const i = order.indexOf(m.id); return i < 0 ? Infinity : i; };
            return list.sort((a, b) => (pos(a) - pos(b)) || smart(a, b));
        }
        return list.sort(smart);
    }

    /**
     * Hours from taking a dose to when it should be working best: the modelled peak
     * when there is a curve (formulation included), else the med's time to peak, else
     * an hour. Used to time the "how is the pain now?" re-rate.
     */
    function medPeakHours(med) {
        const PK = window.PK;
        const pk = PK ? medPkParams(med) : null;
        if (pk && PK.releaseComponents && PK.componentsLevel && (pk.ka > 0 || pk.release)) {
            const comps = PK.releaseComponents(1, pk.release);
            let best = 0, bestH = null;
            for (let h = 0.1; h <= 24; h += 0.1) {
                const v = PK.componentsLevel(comps, pk.ka, pk.ke, h);
                if (v > best) { best = v; bestH = h; }
            }
            if (bestH != null) return Math.round(bestH * 10) / 10;
        }
        if (typeof med.timeToPeak === 'number' && med.timeToPeak > 0) return med.timeToPeak * 24;
        return 1;
    }

    window.MedData = {
        REPO_URL,
        MED_PRESETS, DEFAULT_LOCATIONS, MONTHS, DAYS,
        ymd, hm, addDays, daysBetween,
        fmtDate, fmtDateShort, fmtTime, fmtTimeStr, dayLabel,
        kgToLbs, lbsToKg, kgToStLbs, stLbsToKg, fmtWeight, unitLabel, weightValue,
        cmToFtIn, ftInToCm,
        bmiBand, BMI_BANDS, BMI_SOURCE,
        clicksForDose, doseConsumption,
        doseLevelAt, medLevelAt, hasPharmacokinetics,
        resolveIngredients, ingredientBaseMg, hasSubstances, substancesAcross, medPkParams, peakOffsetDays, doseBaseMg, medEffectThreshold,
        ingredientLedger, nextSafeTime, ceilingCheck, concurrentNsaids,
        nextAllowedDose, hasDoseTiming,
        recomputeContainerState, supplyByDose, suggestContainerForDose,
        isPRN, freqOf, orderMedsForPicker, medPeakHours,
        inferContainersFromDoses, estimateBackfillDoses, predictNextDose,
        detectSchedule, lateDoseStatus, niceStep, DAY_NAMES,
        SCHEDULE_ANCHORS, anchorLabel, slotLabel, missedSlots,
        fmtDur, fmtFreq, fmtAmount, fmtDoseUnit, isCountableUnit, CATEGORY_ORDER, getScheduleSlots,
        RECONCILABLE, presetDiff,
        containerName, containerPlural, levelExtremes, fmtDoseCount, doseBreakdown,
    };
})();
