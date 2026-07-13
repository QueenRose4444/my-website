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
                note: 'Take a missed dose within 5 days. More than 5 days late: skip it and take the next dose on your usual day. Never take 2 doses within 48 hours of each other.',
                sourceLabel: 'Ozempic.com — dosing',
                sourceUrl: 'https://www.ozempic.com/how-to-take/ozempic-dosing.html#:~:text=miss%20a%20dose',
            },
        },
        {
            presetId: 'wegovy', name: 'Wegovy', generic: 'Semaglutide', type: 'injection',
            doses: [0.25, 0.5, 1, 1.7, 2.4, 7.2], frequency: 7, halfLife: 7, timeToPeak: 2,
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
            // each pen holds 18mg total — 6 doses at the 3.0mg maintenance dose
            // (30 at 0.6mg; edit capacity to match your dose level)
            penCapacity: 6, pensPerPackage: 5, unit: 'mg', color: '#f0b955',
            titration: [{ dose: 0.6, weeks: 1 }, { dose: 1.2, weeks: 1 }, { dose: 1.8, weeks: 1 }, { dose: 2.4, weeks: 1 }, { dose: 3.0, weeks: 1 }],
            missedDose: {
                takeWithinDays: 0, minGapDays: 0.75,
                note: 'Missed a daily dose: skip it and take the next dose at the usual time — don’t take extra to catch up. If more than 3 days have passed since your last dose, talk to your prescriber: official guidance is to re-start at 0.6 mg and titrate up again.',
                sourceLabel: 'DailyMed — Saxenda label (FDA)',
                sourceUrl: 'https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=3946d389-0926-4f77-a708-0acb8153b143',
            },
        },
        {
            presetId: 'rybelsus', name: 'Rybelsus', generic: 'Semaglutide', type: 'pill',
            doses: [3, 7, 14], frequency: 1, halfLife: 7, timeToPeak: 0.04,
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
                sourceLabel: 'Lilly — Trulicity prescribing information',
                sourceUrl: 'https://uspl.lilly.com/trulicity/trulicity.html#pi',
            },
        },

        // ---------------- ADHD ----------------
        {
            presetId: 'vyvanse', name: 'Vyvanse / Elvanse', generic: 'Lisdexamfetamine', type: 'pill', category: 'ADHD',
            doses: [10, 20, 30, 40, 50, 60, 70], frequency: 1, halfLife: 0.46, timeToPeak: 0.16,
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
            presetId: 'adderall-xr', name: 'Adderall XR', generic: 'Mixed amfetamine salts ER', type: 'pill', category: 'ADHD',
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
            doses: [5, 10, 20], frequency: 0.5, halfLife: 0.13, timeToPeak: 0.09,
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
            presetId: 'concerta', name: 'Concerta XL', generic: 'Methylphenidate ER', type: 'pill', category: 'ADHD',
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
            doses: [10, 18, 25, 40, 60, 80, 100], frequency: 1, halfLife: 0.21, timeToPeak: 0.08,
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
            presetId: 'dexamfetamine-ir', name: 'Dexamfetamine (IR)', generic: 'Dexamfetamine / Dexedrine, Amfexa', type: 'pill', category: 'ADHD',
            doses: [2.5, 5, 10, 15, 20], frequency: 0.5, halfLife: 0.42, timeToPeak: 0.125,
            penCapacity: 28, pensPerPackage: 1, unit: 'mg', color: '#fdba74',
            titration: [{ dose: 5, weeks: 1 }, { dose: 10, weeks: 2 }, { dose: 20, weeks: 4 }],
            missedDose: {
                takeWithinDays: 0, minGapDays: 0.15,
                note: 'Skip the missed dose and take the next at its usual time — taking it late in the day can affect sleep. Never double up.',
            },
        },
        {
            presetId: 'adderall-ir', name: 'Adderall (IR)', generic: 'Mixed amfetamine salts', type: 'pill', category: 'ADHD',
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
            presetId: 'guanfacine-xr', name: 'Intuniv XR', generic: 'Guanfacine ER', type: 'pill', category: 'ADHD',
            doses: [1, 2, 3, 4], frequency: 1, halfLife: 0.71, timeToPeak: 0.21,
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
            doses: [1, 2, 3, 4, 6, 8], frequency: 1, halfLife: 0.6, timeToPeak: 0.25,
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
            doses: [25, 50, 100, 150, 200], frequency: 1, halfLife: 0.65, timeToPeak: 0.2,
            penCapacity: 28, pensPerPackage: 1, unit: 'mg', color: '#4ade80',
            titration: [{ dose: 50, weeks: 4 }, { dose: 100, weeks: 8 }, { dose: 200, weeks: 12 }],
            missedDose: {
                takeWithinDays: 0.4, minGapDays: 0.4,
                note: 'Take it when you remember that day (avoid late evening — it makes you pee); if it’s nearly time for the next dose, skip it. Never double up.',
            },
        },
        {
            presetId: 'cyproterone', name: 'Cyproterone', generic: 'Cyproterone acetate (Androcur)', type: 'pill', category: 'HRT — feminising',
            doses: [6.25, 12.5, 25, 50], frequency: 1, halfLife: 1.7, timeToPeak: 0.15,
            penCapacity: 56, pensPerPackage: 1, unit: 'mg', color: '#22d3ee',
            missedDose: {
                takeWithinDays: 0.4, minGapDays: 0.4,
                note: 'Skip the missed dose and take the next at the usual time — its long half-life means one miss matters little. Never double up.',
            },
        },
        {
            presetId: 'bicalutamide', name: 'Bicalutamide', generic: 'Bicalutamide', type: 'pill', category: 'HRT — feminising',
            doses: [25, 50], frequency: 1, halfLife: 6, timeToPeak: 1.3,
            penCapacity: 28, pensPerPackage: 1, unit: 'mg', color: '#a3e635',
            missedDose: {
                takeWithinDays: 0, minGapDays: 0.5,
                note: 'Skip the missed dose and take the next at the usual time — its ~6-day half-life keeps levels steady. Never double up.',
            },
        },
        {
            presetId: 'progesterone', name: 'Progesterone', generic: 'Micronised (Utrogestan, Prometrium)', type: 'pill', category: 'HRT — feminising',
            doses: [100, 200, 300], frequency: 1, halfLife: 0.7, timeToPeak: 0.12,
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
    ];

    // categories for the preset picker (new presets carry their own)
    const PRESET_CATEGORY_MAP = {
        mounjaro: 'GLP-1 & weight', zepbound: 'GLP-1 & weight', ozempic: 'GLP-1 & weight',
        wegovy: 'GLP-1 & weight', saxenda: 'GLP-1 & weight',
        rybelsus: 'Diabetes', metformin: 'Diabetes', trulicity: 'Diabetes',
    };
    const CATEGORY_ORDER = ['GLP-1 & weight', 'Diabetes', 'ADHD', 'HRT — feminising', 'HRT — masculinising', 'Other'];
    MED_PRESETS.forEach(p => { if (!p.category) p.category = PRESET_CATEGORY_MAP[p.presetId] || 'Other'; });

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
            // usedOffset = manual correction from the edit-supply modal, on top
            // of whatever the assigned doses consumed
            used = Math.round((used + (pen.usedOffset || 0)) * 1000) / 1000;
            used = Math.max(0, Math.min(used, pen.capacity));
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

    // best pen/pack for a new dose at `dose`:
    //  1. opened, not exhausted, matching strength with enough left
    //  2. unopened matching strength
    //  3. (split-dose pens & all non-injection types) another strength with
    //     enough left — pills etc. just take 2×5mg tablets for a 10mg dose
    function suggestPenForShot(pens, med, dose) {
        const eligible = pens.filter(p => p.medId === med.id && !p.exhaustedDate);
        const enough = p => (p.capacity - p.used) >= doseConsumption(dose, p) - 0.001;
        const opened = eligible.filter(p => p.openedDate).sort((a, b) => new Date(a.openedDate) - new Date(b.openedDate));
        const unopened = eligible.filter(p => !p.openedDate);

        let pen = opened.find(p => p.dose === dose && enough(p));
        if (pen) return { pen, isNewOpen: false, split: false };
        pen = unopened.find(p => p.dose === dose);
        if (pen) return { pen, isNewOpen: true, split: false };
        const flexible = med.splitDose || (med.type && med.type !== 'injection');
        if (flexible) {
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
        if (!med || !shots.length) return { pens: [], assignment: {} };
        const cap = med.penCapacity || 4;
        const sorted = shots.slice().sort((a, b) => a.timestamp - b.timestamp);
        // Pills/patches/gels come in ONE strength per pack — a 10mg dose is
        // 2×5mg tablets from the same pack, not a separate 10mg pack. So all
        // doses draw from packs at the smallest logged strength. Injections
        // keep per-strength pens (you buy the strength you inject).
        const flexible = med.type && med.type !== 'injection';
        const baseDose = flexible ? Math.min(...sorted.map(s => s.dose)) : null;
        const stacks = {}; // container strength -> containers
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
                    id: `pen-inf-${med.id}-${strength}-${seq++}-${Date.now().toString(36)}`,
                    medId: med.id, dose: strength, capacity: cap, used: 0,
                    openedDate: s.date, exhaustedDate: null, note: 'inferred from history',
                };
                stack.push(cur);
            }
            cur.used = Math.round((cur.used + need) * 1000) / 1000;
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
            const shots = [];
            let i = 0;
            for (let d = new Date(startD); d <= endD; d.setDate(d.getDate() + 1)) {
                for (const sl of slots) {
                    const ts = new Date(ymd(d) + 'T' + sl.time).getTime();
                    if (isNaN(ts) || ts > now) continue; // never invent future doses
                    shots.push({
                        id: `shot-est-${ts}-${i++}`,
                        medId: med.id,
                        dose: sl.dose,
                        date: ymd(new Date(ts)), time: sl.time, timestamp: ts,
                        location: locations ? locations[i % locations.length] : null,
                        penId: null,
                        estimated: true,
                    });
                }
            }
            shots.sort((a, b) => a.timestamp - b.timestamp);
            return shots;
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
        const shots = [];
        let idx = totalCount - 1; // 0 = oldest
        for (let p = plan.length - 1; p >= 0; p--) {
            for (let c = 0; c < plan[p].count; c++) {
                const ts = lastDose.getTime() - (totalCount - 1 - idx) * freq * 86400000;
                if (ts < startTs) { idx--; continue; }
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
    const minsToHm = mins => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(Math.round(mins) % 60).padStart(2, '0')}`;

    function detectSchedule(medShots, med) {
        const recent = medShots.filter(s => !s.estimated).slice(0, 14);
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
    function predictNextDose(med, medShots, settings) {
        const last = medShots[0]; // newest first
        if (!last || !med) return null;
        const freq = med.frequency || 7;
        const detected = detectSchedule(medShots, med);

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
        let slotDose = null;
        let minGapMs = 0; // weekly branch re-checks the gap after the clock time lands
        if (freq < 0.95 && slotList) {
            // next time-slot after the last dose (e.g. 08:00 / 13:00 / 18:00).
            // A dose up to 90 min EARLY still counts as its slot taken — a
            // 07:30 dose against an 08:00 slot must predict the NEXT slot,
            // not 08:00 again half an hour later.
            const slots = slotList
                .map(sl => { const [h, m] = sl.time.split(':').map(Number); return { mins: (h || 0) * 60 + (m || 0), dose: sl.dose }; })
                .sort((a, b) => a.mins - b.mins);
            const lastMins = lastDt.getHours() * 60 + lastDt.getMinutes();
            const near = slots.findIndex(sl => Math.abs(sl.mins - lastMins) <= 90);
            let slot = near >= 0 ? slots[near + 1] : slots.find(sl => sl.mins > lastMins + 15);
            nextDate = new Date(lastDt);
            if (!slot) { slot = slots[0]; nextDate.setDate(nextDate.getDate() + 1); }
            nextDate.setHours(Math.floor(slot.mins / 60), slot.mins % 60, 0, 0);
            time = minsToHm(slot.mins);
            slotDose = slot.dose;
            usualTimes = slots.map(sl => minsToHm(sl.mins));
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
            nextDate.setHours(th || 9, tm || 0, 0, 0);
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
            scheduleSource: (med.scheduleDay && med.scheduleDay !== 'auto') || (med.scheduleTime && med.scheduleTime !== 'auto') || userSlots.length >= 2
                ? 'user'
                : (detected.day != null || detected.times || detected.time ? 'auto' : null),
        };
    }

    // slot doses store the TOTAL taken (23:00 → 10mg meaning 2×5mg tablets).
    // The tablet strength the user actually STOCKS is the ground truth for
    // the breakdown — presets list many strengths (2.5/5/10…), so "smallest
    // dose" would wrongly split a 5mg tablet into 2× 2.5mg.
    function doseBreakdown(med, dose, pens) {
        const plain = { count: 1, per: dose };
        if (!med || dose == null || !(med.type && med.type !== 'injection')) return plain;
        // what the user TYPED into a schedule slot is the strongest signal —
        // "2 × 5mg" must never come back as "1 × 10mg"
        const slot = getScheduleSlots(med).find(sl => sl.dose === dose && sl.count >= 2 && sl.per > 0);
        if (slot) return { count: slot.count, per: slot.per };
        const owned = [...new Set((pens || []).filter(p => p.medId === med.id && !p.exhaustedDate).map(p => p.dose))];
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
    function fmtDoseCount(med, dose, pens) {
        if (!med || dose == null || dose === '') return '';
        const unit = med.unit || 'mg';
        const b = doseBreakdown(med, dose, pens);
        return b.count >= 2 ? `${dose}${unit} (${b.count}× ${b.per}${unit})` : `${dose}${unit}`;
    }

    // what the med comes in — drives supply-tracking wording for every type
    const CONTAINER_NAMES = { injection: 'pen', pill: 'pack', patch: 'box', gel: 'bottle', liquid: 'bottle', cream: 'tube' };
    function containerName(med) {
        return CONTAINER_NAMES[(med && med.type) || 'injection'] || 'pack';
    }
    function containerPlural(med, n) {
        const cn = containerName(med);
        if (n === 1) return cn;
        return cn === 'box' ? 'boxes' : cn + 's';
    }

    // estimated peak and low of the level between now and the next dose
    function levelExtremes(shots, med, nextDoseTs) {
        const now = Date.now();
        const horizon = Math.max(now + 3600000, nextDoseTs || (now + (med.frequency || 1) * 86400000));
        let peak = { ts: now, v: -1 }, low = { ts: now, v: Infinity };
        const steps = 96;
        for (let i = 0; i <= steps; i++) {
            const ts = now + (horizon - now) * (i / steps);
            const v = medLevelAt(shots, med, ts);
            if (v > peak.v) peak = { ts, v };
            if (v < low.v) low = { ts, v };
        }
        if (!isFinite(low.v)) low = { ts: now, v: 0 };
        return { peak, low };
    }

    // normalized schedule slots — entries may be 'HH:MM' strings (older data)
    // or { time, dose } objects with an optional per-slot dose
    function getScheduleSlots(med) {
        if (!med || !Array.isArray(med.scheduleTimes)) return [];
        return med.scheduleTimes.map(e => {
            if (typeof e === 'string') return /^\d{1,2}:\d{2}$/.test(e) ? { time: e, dose: null } : null;
            if (e && /^\d{1,2}:\d{2}$/.test(String(e.time))) {
                // count/per remember HOW the user entered the dose (2 × 5mg),
                // so the editor round-trips exactly what they typed
                const slot = { time: e.time, dose: e.dose > 0 ? e.dose : null };
                if (e.count >= 1 && e.per > 0) { slot.count = e.count; slot.per = e.per; }
                return slot;
            }
            return null;
        }).filter(Boolean);
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
    function fmtFreq(days) {
        if (days == null || isNaN(days) || days <= 0) return '—';
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
        REPO_URL,
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
        fmtDur, fmtFreq, CATEGORY_ORDER, getScheduleSlots,
        containerName, containerPlural, levelExtremes, fmtDoseCount, doseBreakdown,
    };
})();
