/**
 * Substances — the molecules, and what is known about them.
 *
 * A med is a PRODUCT; a product is made of SUBSTANCES; substances own the
 * pharmacology. One dexamfetamine curve exists no matter how many products feed it.
 *
 * This file is CODE, not synced state. It is reference data with citations —
 * identical for every user, corrected for everyone at once by a release, and
 * meaningless to merge. Only user-defined substances live in the data blob.
 *
 * ── Honesty rules, because this drives a medical-looking chart ──────────────
 *
 *   `verified: true`   every number below it was read off a label or a
 *                      peer-reviewed source, and `source` says which.
 *   `verified: false`  the numbers were carried forward from this app's own med
 *                      presets, where they have always driven the curve but have
 *                      never carried a citation. Moving them here does not make
 *                      them worse — it makes the gap VISIBLE. The UI must say so.
 *
 * Never invent a value to fill a field. An absent number hides a curve;
 * a guessed one draws a confident wrong one.
 *
 * ── Units ──────────────────────────────────────────────────────────────────
 * Everything here is in HOURS. The med presets store `halfLife`/`timeToPeak` in
 * DAYS (data.js). pk.js converts at exactly one boundary — see HOURS_PER_DAY
 * there. Getting this wrong is a factor of 24 and it will still draw a plausible
 * curve, so it is asserted in the tests rather than eyeballed.
 */
(function () {
    'use strict';

    /**
     * Salt → free-base mass fractions.
     *
     * 🔴 The CLINICAL equivalence ratio and the MASS conversion
     * ratio are different numbers, and conflating them is a common published error.
     * The 2.5:1–3:1 Vyvanse-to-dex rule of thumb is a clinical ratio. These are not.
     *
     * Only salts that are label-reproducible or derivable from molecular weights are
     * listed. Anything else is 1 (the substance is dispensed as the free acid/base),
     * which is the honest default rather than a guess.
     */
    const SALTS = {
        // (C9H13N)2 · H2SO4, MW 368.49; base 2 x 135.21 = 270.42 -> 0.7338.
        // AU dexamfetamine tablets ARE the sulfate (ARTG 19684), so a "5 mg tablet"
        // is 3.67 mg of base. This is the single most load-bearing number in the model.
        'dexamfetamine.sulfate': 0.7338,
        // C15H25N3O · (CH4O3S)2, MW 455.60; base 263.39 -> 0.5781. Cross-checked
        // against DailyMed's own equivalence table (10 -> 5.8, 30 -> 17.3, 70 -> 40.5).
        'lisdexamfetamine.dimesylate': 0.5781,
        // C18H21NO3 (299.37) + H3PO4 (97.99) + 1/2 H2O (9.01) = 406.37 -> 0.7367.
        // Panadeine Forte's label says "codeine phosphate hemihydrate 30 mg".
        'codeine.phosphate-hemihydrate': 0.7367,
        // Label fact, not arithmetic: "naproxen sodium 220 mg (equivalent to 200 mg
        // of naproxen)".
        'naproxen.sodium': 0.9091,
        // C16H25NO2 (263.38) + HCl (36.46) = 299.84 -> 0.8784.
        'tramadol.hydrochloride': 0.8784,
        // C18H21NO4 (315.37) + HCl (36.46) = 351.83 -> 0.8964.
        'oxycodone.hydrochloride': 0.8964,
        // Hormone esters, all from molecular formulas with standard atomic weights.
        // The ester is what is on the box ("estradiol valerate 2 mg"), and the
        // difference is large: a 250 mg enanthate ampoule is 180 mg of testosterone.
        // Estradiol C18H24O2 = 272.39.
        'estradiol.valerate': 0.7640,     // C23H32O3 = 356.51
        'estradiol.enanthate': 0.7083,    // C25H36O3 = 384.56
        'estradiol.cypionate': 0.6869,    // C26H36O3 = 396.57
        // Testosterone C19H28O2 = 288.43.
        'testosterone.enanthate': 0.7200,   // C26H40O3 = 400.60
        'testosterone.cypionate': 0.6990,   // C27H40O3 = 412.61
        'testosterone.undecanoate': 0.6315, // C30H48O3 = 456.71
        'testosterone.propionate': 0.8373,  // C22H32O3 = 344.49
    };

    const DAY_H = 24;     // carrying a preset's days-based value across

    /**
     * @typedef {Object} Substance
     * @property {string}   id
     * @property {string}   name
     * @property {string[]} [aka]        other names, incl. US/UK spellings
     * @property {string[]} [classes]    shared-mechanism groups (for the ingredient ledger)
     * @property {number}   [halfLifeH]  terminal elimination t-half, hours
     * @property {number}   [tmaxH]      time to peak, hours. Absent -> no Bateman fit
     * @property {number}   [durationH]  published duration of effect, hours. Absent ->
     *                                   no therapeutic window can be calibrated
     * @property {number}   [bioavailability] oral F, 0..1. Absent -> the curve is
     *                                   "amount of the dose still on board", which is
     *                                   what the app has always plotted
     * @property {string}   [defaultSalt] key into SALTS, without the id prefix.
     *                                   The AVAILABLE forms are derived from SALTS by
     *                                   `saltFormsFor()` — they are deliberately not
     *                                   duplicated onto the record, so a factor has
     *                                   exactly one home
     * @property {boolean}  [acuteTolerance] effect fades faster than concentration
     * @property {Limits}   [limits]     what the label says about how much and how
     *                                   often — see the Limits typedef. Absent means
     *                                   no published ceiling exists (oxycodone is
     *                                   titrated to the individual); it does NOT mean
     *                                   unlimited
     * @property {boolean}  verified
     * @property {{label:string,url:string}} [source]
     * @property {string}   [note]
     */

    /**
     * What a label says about how much, how often, and why it stops there.
     *
     * 🔴 SEPARATE FROM THE SUBSTANCE'S OWN `source` ON PURPOSE. "What is the half-life
     * of paracetamol" and "how much of it may an adult have in a day" are different
     * questions with different answers from different documents, and a citation that
     * covers one does not cover the other. A codeine ceiling of 240 mg placed under a
     * citation about CYP2D6 metabolism, for example, would be unsupported, because
     * that source says nothing at all about daily maxima.
     *
     * 🟠 AND THESE ARE DEFAULTS, NOT THIS PERSON'S LIMITS. They are typical-adult
     * figures, mostly off over-the-counter packs. Somebody on a supervised regimen can
     * be legitimately prescribed more — 2400 mg of ibuprofen against an OTC label that
     * says 1200 is an ordinary prescription — so `basis` records which kind of figure
     * it is, and the user can replace it.
     *
     * @typedef {Object} Limits
     * @property {number} [maxPer24h]  mg of the substance AS DISPENSED per 24 h,
     *                                 or of the base when `mass` is 'base'
     * @property {'base'} [mass]       the limit is written in mg of the drug itself, so
     *                                 salt and base products add up (naproxen)
     * @property {number} [minGapH]    hours between doses. Independent of the daily
     *                                 max: both can be violated on their own
     * @property {'otc'|'prescription'|'guideline'|'unverified'} basis
     *                                 which kind of figure this is, so the app can say
     *                                 "the over-the-counter limit" rather than implying
     *                                 a universal one
     * @property {{label:string,url:string}} [source] the document the LIMIT comes from
     * @property {string} [harm]       what actually goes wrong past it, in a sentence.
     *                                 "You are over the limit" is a number; this is the
     *                                 part that can change a decision
     * @property {string} [note]       anything else the figure needs said about it
     */

    /** @type {Substance[]} */
    const SUBSTANCES = [
        // ── stimulants ──────────────────────────────────────────────────────
        {
            id: 'dexamfetamine', name: 'Dexamfetamine',
            aka: ['Dextroamphetamine', 'd-amphetamine'],
            classes: ['stimulant'],
            halfLifeH: 10.5, tmaxH: 2.5, durationH: 6, defaultSalt: 'sulfate',
            acuteTolerance: true, verified: true,
            source: { label: 'DailyMed — Vyvanse (adult t-half 10-11.3 h)', url: 'https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=704e4378-ca83-445c-8b45-3cfa51c1ecad' },
            note: 'Acute tolerance produces a clockwise hysteresis loop — the same concentration does less on the way down than on the way up (Brauer 1996, PMID 8834422). The effect window therefore closes earlier than a symmetric threshold crossing suggests.',
        },
        {
            id: 'lisdexamfetamine', name: 'Lisdexamfetamine',
            aka: ['Vyvanse', 'Elvanse'],
            classes: ['stimulant', 'prodrug'],
            halfLifeH: 1, tmaxH: 1, defaultSalt: 'dimesylate',
            verified: true,
            source: { label: 'FDA Vyvanse label (t-half < 1 h, non-quantifiable by 8 h)', url: 'https://www.accessdata.fda.gov/drugsatfda_docs/label/2007/021977lbl.pdf' },
            note: 'Inactive by itself. Everything you feel is the dexamfetamine it becomes — see the conversion edge below.',
        },
        {
            id: 'methylphenidate', name: 'Methylphenidate',
            aka: ['Ritalin', 'Concerta'], classes: ['stimulant'],
            halfLifeH: 2.5, tmaxH: 2, verified: true,
            source: { label: 'Ritalin Australian Product Information (half-life 2-3 h, peak about 2 h)', url: 'https://medsinfo.com.au/api/documents/Ritalin_PI?format=pdf' },
            acuteTolerance: true,
            note: 'Immediate-release figures. Concerta’s extended release belongs to the product and is modelled there, as a steady release peaking at about 6.8 h (AU PI).',
        },
        {
            id: 'amfetamine-mixed-salts', name: 'Mixed amfetamine salts',
            aka: ['Adderall'], classes: ['stimulant'],
            halfLifeH: 0.42 * DAY_H, tmaxH: 0.125 * DAY_H, verified: true,
            source: { label: 'FDA Adderall label (peak ~3 h; d-amfetamine half-life 9.8-11 h)', url: 'https://www.accessdata.fda.gov/drugsatfda_docs/label/2022/011522s045lbl.pdf' },
            acuteTolerance: true,
            note: 'Deliberately NOT linked to the dexamfetamine curve. It is a 1:1:1:1 mixture of four salts and the dex:levo base split is a widely repeated figure this project has not verified against a label. A wrong conversion here would silently mis-state a combined stimulant total, so it stays separate until sourced.',
        },
        {
            id: 'atomoxetine', name: 'Atomoxetine', aka: ['Strattera'],
            halfLifeH: 5.2, tmaxH: 1.5, verified: true,
            source: { label: 'Strattera Australian Product Information (peak 1-2 h; half-life 5.2 h)', url: 'https://medsinfo.com.au/api/documents/Strattera_PI?format=pdf' },
            note: 'Half-life 5.2 h in most people, about 21 h in CYP2D6 poor metabolisers; a high-fat meal delays the peak to about 4 h.',
        },
        {
            id: 'guanfacine', name: 'Guanfacine', aka: ['Intuniv'],
            halfLifeH: 18, tmaxH: 5, verified: true,
            source: { label: 'Intuniv Australian Product Information (peak ~5 h, half-life ~18 h)', url: 'https://medsinfo.com.au/api/documents/Intuniv_PI?format=pdf' },
        },

        // ── GLP-1 / diabetes ────────────────────────────────────────────────
        {
            id: 'tirzepatide', name: 'Tirzepatide', aka: ['Mounjaro', 'Zepbound'],
            halfLifeH: 5 * DAY_H, tmaxH: 2 * DAY_H, bioavailability: 0.8, verified: true,
            source: { label: 'Mounjaro Australian Product Information', url: 'https://medsinfo.com.au/api/documents/Mounjaro_PI?format=pdf' },
            note: 'The PI gives the time to peak only as a range, 8 to 72 hours; 48 h sits inside it and is not a published median.',
        },
        {
            id: 'semaglutide', name: 'Semaglutide', aka: ['Ozempic', 'Wegovy', 'Rybelsus'],
            halfLifeH: 7 * DAY_H, tmaxH: 2 * DAY_H, bioavailability: 0.89, verified: true,
            source: { label: 'Ozempic Australian Product Information (peak 1-3 days, half-life ~1 week, 89%)', url: 'https://medsinfo.com.au/api/documents/Ozempic_PI?format=pdf' },
            note: 'Injected. Oral Rybelsus peaks about an hour after the tablet and only ~1% is absorbed; the Rybelsus product carries those figures itself.',
        },
        {
            id: 'liraglutide', name: 'Liraglutide', aka: ['Saxenda', 'Victoza'],
            halfLifeH: 13, tmaxH: 11, verified: true,
            source: { label: 'Saxenda Australian Product Information (peak ~11 h, half-life ~13 h)', url: 'https://medsinfo.com.au/api/documents/Saxenda_PI?format=pdf' },
        },
        {
            id: 'dulaglutide', name: 'Dulaglutide', aka: ['Trulicity'],
            halfLifeH: 4.7 * DAY_H, tmaxH: 48, bioavailability: 0.47, verified: true,
            source: { label: 'Trulicity Australian Product Information (peak 48 h, half-life 4.7 days, ~47%)', url: 'https://medsinfo.com.au/api/documents/Trulicity_PI?format=pdf' },
        },
        {
            id: 'metformin', name: 'Metformin',
            halfLifeH: 6.2, tmaxH: 2.75, bioavailability: 0.55, verified: true,
            source: { label: 'DailyMed — metformin tablets, section 12.3', url: 'https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=7078da8f-f8a7-411f-aa79-8a9710d0cdb5' },
            note: 'Immediate-release tablets. Plasma half-life ~6.2 h; peak 2.6-3.3 h across the label’s single-dose studies (2.75 h used); 50-60% absorbed (0.55 used). The Australian PI gives none of these figures.',
        },

        // ── HRT ─────────────────────────────────────────────────────────────
        {
            id: 'estradiol', name: 'Estradiol', aka: ['Oestradiol'], classes: ['hrt-feminising'],
            halfLifeH: 15, tmaxH: 5, verified: true,
            source: { label: 'Estrofem Australian Product Information (peak 4-6 h, half-life 14-16 h)', url: 'https://medsinfo.com.au/api/documents/Estrofem_1_mg_and_2_mg_PI?format=pdf' },
            note: 'Oral estradiol tablets. Estradiol valerate (Progynova) is not confirmed against its own PI. Patches, gel and injections have different kinetics and are modelled per product.',
        },
        {
            id: 'spironolactone', name: 'Spironolactone', classes: ['hrt-feminising'],
            halfLifeH: 16.5, tmaxH: 4.3, verified: true,
            source: { label: 'FDA Aldactone label (canrenone: peak 4.3 h, half-life 16.5 h)', url: 'https://www.accessdata.fda.gov/drugsatfda_docs/label/2014/012151s072lbl.pdf' },
            note: 'The curve follows canrenone, the long-acting active metabolite; spironolactone itself lasts about 1.4 h. The Australian Aldactone PI gives canrenone a peak at 2-4 h and a half-life of 13-24 h.',
        },
        {
            id: 'cyproterone', name: 'Cyproterone acetate', aka: ['Androcur'], classes: ['hrt-feminising'],
            halfLifeH: 43.9, tmaxH: 3, verified: true,
            source: { label: 'Androcur 50 mg UK SmPC (peak ~3 h, half-life 43.9 h)', url: 'https://www.medicines.org.uk/emc/product/15996/smpc/print' },
            note: 'From the UK product information: the Australian Androcur PI could not be read.',
        },
        {
            id: 'bicalutamide', name: 'Bicalutamide', classes: ['hrt-feminising'],
            halfLifeH: 168, tmaxH: 31, verified: true,
            source: { label: 'Cosudex Australian Product Information (half-life about 1 week)', url: 'https://medsinfo.com.au/api/documents/Cosudex_PI?format=pdf' },
            note: 'Peak (31 h) from the FDA Casodex label; the Australian PI gives none. It accumulates about 10-fold with daily dosing.',
        },
        {
            id: 'progesterone', name: 'Progesterone (micronised)', aka: ['Utrogestan', 'Prometrium'], classes: ['hrt-feminising'],
            halfLifeH: 16.8, tmaxH: 2.2, verified: true,
            source: { label: 'Utrogestan Australian Product Information (peak 2.2 h, half-life 16.8 h)', url: 'https://tga.gov.au/sites/default/files/auspar-progesterone-170601-pi-02.pdf' },
        },
        { id: 'testosterone', name: 'Testosterone', classes: ['hrt-masculinising'], halfLifeH: 4.5 * DAY_H, tmaxH: 1.5 * DAY_H, verified: false, note: 'Not confirmed from an official label. Esters differ enormously: undecanoate (Reandron) peaks at 7-14 days with a half-life of about 53 days after one dose and about 90 days at steady state (NZ data sheet); enanthate figures could not be confirmed. Esters (enanthate, cypionate, undecanoate) differ enormously and are modelled per-product.' },

        // ── analgesics ─────────────
        {
            id: 'paracetamol', name: 'Paracetamol', aka: ['Acetaminophen', 'Tylenol', 'Panadol'],
            classes: ['analgesic'],
            halfLifeH: 2.5, tmaxH: 1, durationH: 5, bioavailability: 0.8, verified: true,
            limits: {
                maxPer24h: 4000, minGapH: 4, basis: 'otc',
                source: { label: 'TGA — recommended paracetamol doses', url: 'https://www.tga.gov.au/news/news-articles/recommended-paracetamol-doses' },
                harm: 'Past this, the liver runs out of the glutathione it uses to mop up a toxic by-product, and the damage is delayed and silent — you can feel completely fine for a day or two while it happens. That is what makes it the most common serious overdose there is.',
                note: 'A ceiling on the INGREDIENT, not on any one product. Panadeine Forte at its own labelled maximum of 8 tablets is exactly 4000 mg, with zero headroom for anything else containing paracetamol.',
            },
            source: { label: 'TGA — recommended paracetamol doses', url: 'https://www.tga.gov.au/news/news-articles/recommended-paracetamol-doses' },
            note: '4000 mg/24 h is a ceiling on the INGREDIENT, not on any one product. Panadeine Forte at its own labelled maximum of 8 tablets is exactly 4000 mg with zero headroom — one Panadol on top is supratherapeutic, and the harm is delayed and silent.',
        },
        {
            id: 'ibuprofen', name: 'Ibuprofen', aka: ['Nurofen', 'Brufen'],
            classes: ['analgesic', 'nsaid'],
            halfLifeH: 1.9, tmaxH: 1.5, durationH: 5, bioavailability: 0.95, verified: true,
            limits: {
                maxPer24h: 1200, minGapH: 4, basis: 'otc',
                source: { label: 'Nurofen 200 mg pack directions (max 6 tablets in 24 h)', url: 'https://www.nurofen.com.au/products/adult/nurofen-pain-inflammation-relief-tablets-200mg/' },
                harm: 'Anti-inflammatories thin the stomach lining and squeeze the kidneys, so bleeding and kidney risk climb with the dose. That is why the higher figure is supervised rather than simply allowed.',
                note: '1200 mg is the over-the-counter ceiling, for up to 3 days. On prescription the usual dose is 1200-1600 mg a day, and up to 2400 mg can be prescribed for a flare of arthritis (Brufen PI). If that is what you are on, raise the limit rather than learning to dismiss the warning.',
            },
            source: { label: 'Brufen AU Product Information', url: 'https://www.medsinfo.com.au/api/documents/Brufen_PI?format=pdf' },
            note: '1200 mg is the OTC ceiling; 1200-1600 mg is the usual prescription dose and 2400 mg a short-term prescription maximum. The app uses the OTC figure.',
        },
        {
            id: 'naproxen', name: 'Naproxen', classes: ['analgesic', 'nsaid'],
            halfLifeH: 14, tmaxH: 3, durationH: 10, bioavailability: 0.95, verified: true,
            // No default salt: Australian Naprosyn tablets ARE naproxen (base), and the
            // sodium products (Naprogesic, Anaprox) say "naproxen sodium" on the box,
            // so their presets name the salt. Defaulting to sodium undercounted every
            // base tablet by 9%.
            limits: {
                maxPer24h: 1250, mass: 'base', minGapH: 6, basis: 'prescription',
                source: { label: 'Naprosyn Australian Product Information', url: 'https://medsinfo.com.au/api/documents/Naprosyn_PI?format=pdf' },
                harm: 'The same stomach, kidney and cardiovascular risks as any anti-inflammatory — and naproxen lingers far longer than ibuprofen, so a dose today is still working on you tomorrow.',
                note: 'Counted in naproxen itself: 1250 mg of naproxen is the same as the 1375 mg of naproxen sodium the sodium products allow. For ongoing treatment the PI’s dose is 375-1000 mg a day.',
            },
            source: { label: 'Naprosyn Australian Product Information', url: 'https://medsinfo.com.au/api/documents/Naprosyn_PI?format=pdf' },
            note: 'Sold as naproxen (Naprosyn 250/500 mg) and as naproxen sodium (Naprogesic 275 mg, Anaprox 550 mg). The daily limit is counted in naproxen, so the two add up correctly.',
        },
        {
            id: 'aspirin', name: 'Aspirin', aka: ['Acetylsalicylic acid', 'Disprin'],
            classes: ['analgesic', 'nsaid'],
            halfLifeH: 4, tmaxH: 1, durationH: 5, bioavailability: 0.45, verified: true,
            limits: {
                maxPer24h: 3600, minGapH: 4, basis: 'unverified',
                source: { label: 'Aspro Clear 300 mg pack directions (retailer copy of the label)', url: 'https://www.chemistwarehouse.com.au/buy/708/aspro-clear-pain-relief-24-soluble-tablets' },
                harm: 'Bleeding and stomach irritation, with ringing in the ears as an early sign of too much. Not for anyone under 16, because of Reye syndrome.',
                note: 'Aspro Clear: no more than 12 x 300 mg tablets in 24 hours. Disprin: at most 3 tablets a dose and 4 doses in 24 hours, which is the same 3600 mg. Under 16s use far less. No Australian PI exists for OTC aspirin, and the only copy of the pack text found is a retailer’s, so it stays marked unverified.',
            },
            source: { label: 'Aspro Clear 300 mg pack directions (retailer copy of the label)', url: 'https://www.chemistwarehouse.com.au/buy/708/aspro-clear-pain-relief-24-soluble-tablets' },
            note: 'Both AU packs work out at 3600 mg a day for adults. Elimination is dose-dependent (3 h to 6 h), so a single half-life understates a large dose.',
        },
        {
            id: 'codeine', name: 'Codeine', classes: ['analgesic', 'opioid'],
            halfLifeH: 3, tmaxH: 1, durationH: 4, bioavailability: 0.55, defaultSalt: 'phosphate-hemihydrate', verified: true,
            // The 240 mg is 8 tablets x 30 mg from the Panadeine Forte label — a PRODUCT
            // maximum, which is where every AU codeine ceiling actually comes from. It
            // belongs under its own citation, not one about CYP2D6 metabolism, which says
            // nothing whatever about daily maxima.
            limits: {
                maxPer24h: 240, minGapH: 4, basis: 'prescription',
                source: { label: 'Panadeine Forte label — ARTG 73507 (8 tablets / 24 h)', url: 'https://www.tga.gov.au/resources/artg/73507' },
                harm: 'Codeine only relieves pain once your body turns it into morphine, and how much you make varies enormously between people. Too much means shallow breathing and heavy sedation — and in ultra-rapid metabolisers that has happened at ordinary doses.',
                note: 'In practice the paracetamol or ibuprofen it is combined with reaches its own ceiling first.',
            },
            source: { label: 'DailyMed — codeine sulfate tablets (peak ~60 min, half-life ~3 h)', url: 'https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid=010905f9-3bcb-4b50-9fe8-a3ad0010f14c' },
            note: 'All AU codeine products have been prescription-only (S4) since 1 Feb 2018 — any advice implying otherwise is eight years out of date. Analgesia comes from the morphine it becomes, and CYP2D6 phenotype changes that by orders of magnitude, so no morphine curve is drawn (see the conversion edge).',
        },
        {
            id: 'morphine', name: 'Morphine', classes: ['analgesic', 'opioid'],
            halfLifeH: 2.5, tmaxH: 1, verified: true,
            source: { label: 'MS Contin Australian Product Information (half-life 2-3 h)', url: 'https://www.ebs.tga.gov.au/ebs/picmi/picmirepository.nsf/pdf?OpenAgent&id=CP-2010-PI-06782-3' },
            note: 'Present so the codeine conversion edge has a target. NOT plotted by default — see `variability: extreme` on that edge.',
        },
        {
            id: 'tramadol', name: 'Tramadol', classes: ['analgesic', 'opioid'],
            halfLifeH: 5.5, tmaxH: 2, durationH: 6, bioavailability: 0.7, defaultSalt: 'hydrochloride', verified: true,
            limits: {
                maxPer24h: 400, minGapH: 4, basis: 'prescription',
                source: { label: 'FDA Ultram label', url: 'https://www.accessdata.fda.gov/drugsatfda_docs/label/2004/20281slr030,21123slr001_Ultram_lbl.pdf' },
                harm: 'Seizure risk rises with the dose, and further alongside antidepressants. It also raises serotonin, which is why it interacts with a long list of other medicines.',
                note: '300 mg over the age of 75. The app carries the general adult figure.',
            },
            source: { label: 'FDA Ultram label', url: 'https://www.accessdata.fda.gov/drugsatfda_docs/label/2004/20281slr030,21123slr001_Ultram_lbl.pdf' },
            note: '300 mg/24 h over age 75. The app carries the general adult figure.',
        },
        {
            id: 'oxycodone', name: 'Oxycodone', classes: ['analgesic', 'opioid'],
            halfLifeH: 3, tmaxH: 1.4, durationH: 5, bioavailability: 0.6,
            defaultSalt: 'hydrochloride', verified: true,
            // 🔴 NO maxPer24h, and the absence is the point. Oxycodone is titrated to the
            // individual, so no single daily figure exists to publish — and inventing
            // one would be worse than having none.
            limits: {
                minGapH: 6, basis: 'prescription',
                source: { label: 'Endone Australian Product Information (5 mg every six hours)', url: 'https://medsinfo.com.au/api/documents/Endone_PI?format=pdf' },
                harm: 'Breathing slows before anything else does, and tolerance to the pain relief builds faster than tolerance to that.',
                note: 'No fixed daily maximum exists — it is titrated per person. S8 in Australia.',
            },
            source: { label: 'Endone Australian Product Information (half-life 2-4 h, relief lasts 3-6 h)', url: 'https://medsinfo.com.au/api/documents/Endone_PI?format=pdf' },
            note: 'No fixed daily ceiling — oxycodone is titrated to the individual, so the app must not invent one. S8 in Australia.',
        },
        {
            id: 'celecoxib', name: 'Celecoxib', classes: ['analgesic', 'nsaid'],
            halfLifeH: 11, tmaxH: 3, durationH: 12, verified: true,
            limits: {
                maxPer24h: 400, minGapH: 12, basis: 'prescription',
                source: { label: 'FDA Celebrex label', url: 'https://www.accessdata.fda.gov/drugsatfda_docs/label/2018/020998s050lbl.pdf' },
                harm: 'Easier on the stomach than other anti-inflammatories, not on the heart — cardiovascular risk rises with both dose and duration.',
                note: 'Still an NSAID: it counts alongside ibuprofen and naproxen, not instead of them.',
            },
            source: { label: 'FDA Celebrex label', url: 'https://www.accessdata.fda.gov/drugsatfda_docs/label/2018/020998s050lbl.pdf' },
        },
        {
            id: 'diclofenac', name: 'Diclofenac', classes: ['analgesic', 'nsaid'],
            halfLifeH: 2, tmaxH: 2, durationH: 6, verified: true,
            limits: {
                maxPer24h: 150, minGapH: 8, basis: 'prescription',
                source: { label: 'Voltaren Australian Product Information (75-150 mg a day in 2 or 3 doses)', url: 'https://medsinfo.com.au/api/documents/Voltaren_PI?format=pdf' },
                harm: 'The highest cardiovascular risk of the common anti-inflammatories, with the same stomach and kidney risks as the rest.',
                note: 'Up to 200 mg a day can be prescribed for period pain or migraine, and the over-the-counter Voltaren Rapid 25 pack allows 8 tablets (200 mg). Raise the limit if that is what you were told.',
            },
            source: { label: 'Voltaren Australian Product Information', url: 'https://medsinfo.com.au/api/documents/Voltaren_PI?format=pdf' },
        },
    ];

    /**
     * Conversion edges: substance -> substance, directed.
     *
     * A first-class edge rather than a property of a product, so that two products
     * feeding one molecule merge for free — the engine walks
     * dose -> product -> substance -> downstream, and linear superposition does the
     * rest.
     *
     * @typedef {Object} Conversion
     * @property {string} from
     * @property {string} to
     * @property {number} massFactor  mg of `to` per mg of `from` (both as free base)
     * @property {number} [kaH]       absorption/appearance rate of `to`, if the
     *                                conversion — not absorption — is rate-limiting
     * @property {number} [durationH] published duration of effect of `to` when it
     *                                arrives by this route, if it differs from `to`'s own
     * @property {{label:string,url:string}} [durationSource] where `durationH` comes from
     * @property {'low'|'moderate'|'high'|'extreme'} variability
     * @property {boolean} [plotByDefault]  false means: model it, do not draw it
     * @property {string} mechanism
     * @property {{label:string,url:string}} [source]
     * @property {string} [note]
     */

    /** @type {Conversion[]} */
    const CONVERSIONS = [
        {
            from: 'lisdexamfetamine', to: 'dexamfetamine',
            // 135.21 / 263.39 = 0.5134, from LDX BASE (not the dimesylate salt).
            // Salt is handled separately so the two factors never get multiplied twice.
            massFactor: 0.5134,
            // Hydrolysis in the cytosol of red blood cells is RATE-LIMITING — slower
            // than gut absorption — so it, not absorption, sets the shape of the
            // dexamfetamine curve. That is the whole reason Vyvanse is flatter and
            // later-peaking than IR dex at the same base dose.
            kaH: 0.68,
            // Dexamfetamine arriving this way works far longer than an IR tablet's 6 h:
            // the AU PI reports effects "ongoing at 13 hours after dosing in children
            // and at 14 hours in adults". The lower figure is used, because drawing
            // someone as still medicated when they are not is the worse error.
            durationH: 13,
            durationSource: { label: 'Vyvanse Australian Product Information (effects ongoing at 13 h children / 14 h adults)', url: 'https://medsinfo.com.au/api/documents/Vyvanse_PI?format=pdf' },
            variability: 'low', plotByDefault: true,
            mechanism: 'RBC aminopeptidase hydrolysis, rate-limiting',
            source: { label: 'Pennick 2010 / Pennick 2016 (PMC4937656)', url: 'https://www.ncbi.nlm.nih.gov/pmc/articles/PMC4937656/' },
            note: '⚠ Several commercial sources describe this as "pseudo-zero-order". That appears in no label and no peer-reviewed source, and is deliberately NOT encoded here.',
        },
        {
            from: 'codeine', to: 'morphine',
            massFactor: 0.10,        // midpoint of 5-15% in extensive metabolisers
            variability: 'extreme', plotByDefault: false,
            mechanism: 'CYP2D6 O-demethylation',
            source: { label: 'NCBI Bookshelf NBK100662', url: 'https://www.ncbi.nlm.nih.gov/books/NBK100662/' },
            note: '⛔ Never drawn by default. A 3x conversion spread multiplied by a 45x phenotype spread means ANY single number misleads: poor metabolisers get almost no analgesia, ultra-rapid metabolisers reach metabolite levels up to 45x higher and have died at therapeutic doses. If this curve is ever offered it must be opt-in, user-adjustable, and carry that sentence.',
        },
    ];

    /**
     * Which substances a product is made of, keyed by `presetId`.
     *
     *   baseMg = doseAmount x mgPerDoseUnit x saltFactor
     *
     * `mgPerDoseUnit: 1` means the med's own dose numbers are already mg of the
     * substance-as-dispensed — which is every existing preset, because they all
     * have `unit: 'mg'` and one ingredient. The estradiol patch is in mcg, hence
     * 0.001. A tablet product (Panadeine Forte) would be
     * `[{paracetamol, 500}, {codeine, 30}]` with `unit: 'tablet'`.
     *
     * A preset absent from this map keeps the old single-exponential model. That is
     * a deliberate degradation, not a gap to be filled with guesses.
     */
    const PRESET_INGREDIENTS = {
        'vyvanse': [{ substanceId: 'lisdexamfetamine', mgPerDoseUnit: 1, salt: 'dimesylate' }],
        'dexamfetamine-ir': [{ substanceId: 'dexamfetamine', mgPerDoseUnit: 1, salt: 'sulfate' }],
        'ritalin-ir': [{ substanceId: 'methylphenidate', mgPerDoseUnit: 1 }],
        'concerta': [{ substanceId: 'methylphenidate', mgPerDoseUnit: 1 }],
        'adderall-ir': [{ substanceId: 'amfetamine-mixed-salts', mgPerDoseUnit: 1 }],
        'adderall-xr': [{ substanceId: 'amfetamine-mixed-salts', mgPerDoseUnit: 1 }],
        'atomoxetine': [{ substanceId: 'atomoxetine', mgPerDoseUnit: 1 }],
        'guanfacine-xr': [{ substanceId: 'guanfacine', mgPerDoseUnit: 1 }],

        'mounjaro': [{ substanceId: 'tirzepatide', mgPerDoseUnit: 1 }],
        'zepbound': [{ substanceId: 'tirzepatide', mgPerDoseUnit: 1 }],
        'ozempic': [{ substanceId: 'semaglutide', mgPerDoseUnit: 1 }],
        'wegovy': [{ substanceId: 'semaglutide', mgPerDoseUnit: 1 }],
        'rybelsus': [{ substanceId: 'semaglutide', mgPerDoseUnit: 1 }],
        'saxenda': [{ substanceId: 'liraglutide', mgPerDoseUnit: 1 }],
        'trulicity': [{ substanceId: 'dulaglutide', mgPerDoseUnit: 1 }],
        'metformin': [{ substanceId: 'metformin', mgPerDoseUnit: 1 }],

        'estradiol-tab': [{ substanceId: 'estradiol', mgPerDoseUnit: 1 }],
        'estradiol-gel': [{ substanceId: 'estradiol', mgPerDoseUnit: 1 }],
        'estradiol-inj': [{ substanceId: 'estradiol', mgPerDoseUnit: 1 }],
        // the only preset whose unit is mcg — 1 mcg = 0.001 mg
        'estradiol-patch': [{ substanceId: 'estradiol', mgPerDoseUnit: 0.001 }],
        'spironolactone': [{ substanceId: 'spironolactone', mgPerDoseUnit: 1 }],
        'cyproterone': [{ substanceId: 'cyproterone', mgPerDoseUnit: 1 }],
        'bicalutamide': [{ substanceId: 'bicalutamide', mgPerDoseUnit: 1 }],
        'progesterone': [{ substanceId: 'progesterone', mgPerDoseUnit: 1 }],
        'testosterone-inj': [{ substanceId: 'testosterone', mgPerDoseUnit: 1 }],
        'testosterone-gel': [{ substanceId: 'testosterone', mgPerDoseUnit: 1 }],
    };

    const BY_ID = SUBSTANCES.reduce((a, s) => { a[s.id] = s; return a; }, Object.create(null));

    /**
     * A substance by id. User-defined substances are passed in by the caller
     * because this file cannot see the data blob — reference data stays separate
     * from user data.
     * @param {string} id
     * @param {Substance[]} [userSubstances]
     * @returns {Substance|null}
     */
    function substanceById(id, userSubstances) {
        if (!id) return null;
        // 🔴 DEFAULTING TO THE STORE IS LOAD-BEARING, not a convenience. This id is
        // resolved from charts.js, views.js, pk.js and data.js, and every one of those
        // paths would have to thread the user's table through by hand. The first
        // version did exactly that and a user substance silently drew no curve at all:
        // the med was linked, the ingredient resolved to nothing, and the app fell back
        // to the legacy model with no error anywhere. Pass the list explicitly only to
        // resolve against something OTHER than the live state (an import preview).
        const own = (userSubstances && userSubstances.length) ? userSubstances
            : ((window.Store && window.Store.state && window.Store.state.substances) || null);
        if (own && own.length) {
            // A user substance never silently shadows a curated one: curated wins,
            // and the substance editor refuses to create a colliding id in the first place.
            if (!BY_ID[id]) {
                const mine = own.find(x => x && x.id === id);
                if (mine) return mine;
            }
        }
        return BY_ID[id] || null;
    }

    /**
     * Is this id one of the curated records?
     *
     * Used to refuse a user substance that would shadow one. The curated table is
     * cited and identical for everybody; a local override would make two people's
     * charts disagree about the same drug with nothing on screen to explain why.
     * @returns {boolean}
     */
    function isCurated(id) {
        return !!(id && BY_ID[id]);
    }

    /**
     * The salt forms known for one substance, as `{name: baseFraction}`.
     *
     * Derived from SALTS rather than stored per substance, so there is one place a
     * salt factor lives and no chance of the two disagreeing. Empty for the many
     * substances dispensed as the free acid or base.
     * @returns {Object<string, number>}
     */
    function saltFormsFor(id) {
        /** @type {Object<string, number>} */
        const out = {};
        if (!id) return out;
        const prefix = id + '.';
        Object.keys(SALTS).forEach(k => {
            if (k.indexOf(prefix) === 0) out[k.slice(prefix.length)] = SALTS[k];
        });
        return out;
    }

    /**
     * The limits in force for a substance — the user's if they have set one, the
     * label's otherwise, and always BOTH so the difference is never hidden.
     *
     * 🟠 The shipped figures are typical-adult defaults, mostly off over-the-counter
     * packs. Somebody on a supervised regimen for a chronic condition can legitimately
     * be prescribed more, and an app that calls that an overdose is not only wrong, it
     * teaches them to ignore the warning — which is the worse failure.
     *
     * @param {string} id
     * @param {Object<string, {maxPer24h?:number, minGapH?:number, reason?:string}>} [userLimits]
     * @returns {{maxPer24h:number|null, minGapH:number|null, mass:string|null, basis:string,
     *           official:object|null, user:object|null, overridden:boolean,
     *           source:object|null, harm:string, note:string}}
     */
    function limitsFor(id, userLimits) {
        const sub = BY_ID[id];
        const official = (sub && sub.limits) || null;
        const mine = (userLimits && userLimits[id]) || null;
        const pick = (k) => {
            if (mine && typeof mine[k] === 'number' && mine[k] > 0) return mine[k];
            return (official && typeof official[k] === 'number') ? official[k] : null;
        };
        const maxPer24h = pick('maxPer24h');
        const minGapH = pick('minGapH');
        return {
            maxPer24h, minGapH,
            // The substance decides the mass a limit is counted in, and a user's own
            // figure for it is read the same way.
            mass: (official && official.mass) || null,
            basis: mine ? 'user' : ((official && official.basis) || 'unverified'),
            official, user: mine,
            overridden: !!(mine && ((mine.maxPer24h > 0 && official && mine.maxPer24h !== official.maxPer24h)
                || (mine.minGapH > 0 && official && mine.minGapH !== official.minGapH))),
            source: (official && official.source) || null,
            harm: (official && official.harm) || '',
            note: (official && official.note) || '',
        };
    }

    /** Every conversion edge leaving a substance. @returns {Conversion[]} */
    function conversionsFrom(id) {
        return CONVERSIONS.filter(c => c.from === id);
    }

    /**
     * Free-base mass fraction for a salt of a substance.
     * Unknown salt -> 1, never a guess: an unrecognised salt name means we do not
     * know what is in the tablet, and pretending otherwise is how a combined curve
     * ends up quietly 27% wrong.
     * @returns {number}
     */
    function saltFactor(substanceId, salt) {
        if (!salt) return 1;
        const f = SALTS[substanceId + '.' + salt];
        return typeof f === 'number' ? f : 1;
    }

    /** Ingredients for a preset id, or null. @returns {Array|null} */
    function ingredientsForPreset(presetId) {
        const list = PRESET_INGREDIENTS[presetId];
        return list ? list.map(x => Object.assign({}, x)) : null;
    }

    window.Substances = {
        SUBSTANCES, CONVERSIONS, SALTS, PRESET_INGREDIENTS,
        substanceById, conversionsFrom, saltFactor, ingredientsForPreset, isCurated, saltFormsFor,
        limitsFor,
    };
})();
