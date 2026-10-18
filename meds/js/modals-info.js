// ================================================
// modals-info.js — explainers. Modals that only tell you something, with
//                  nothing to save and nothing to undo.
// ================================================
(function () {
    'use strict';
    const D = window.MedData;
    const { escapeHtml, openModal } = window.UI;
    const Store = () => window.Store;

    // BMI, explained rather than asserted. The number on the weight card is a single figure with a
    // colour, which reads as a verdict; this is where it gets to say what it actually is and is not.
    function bmiInfo() {
        const d = Store().state;
        const set = d.settings;
        let bmi = null;
        const latest = (d.weights || []).slice().sort((a, b) => a.timestamp - b.timestamp).pop();
        if (set.userHeight && latest) {
            const hm = set.userHeight / 100;
            if (hm > 0) bmi = latest.kg / (hm * hm);
        }
        const band = D.bmiBand(bmi);
        // band widths across the 15–40 scale the bar draws
        const w = (lo, hi) => `flex:${(hi - lo) / 25}`;
        openModal({
            // NOTE the key names. openModal takes `bodyHtml` and `footHtml`; there is no
            // `body` and no `actions`. Passing the wrong ones is silent — you get a
            // correctly-titled, completely empty modal, which is what this did.
            title: 'About BMI',
            bodyHtml: `
                ${bmi != null ? `
                <div class="stat-value lg">${bmi.toFixed(1)}<span class="unit">BMI</span></div>
                <div class="stat-delta ${band.tone}">${escapeHtml(band.label)}</div>
                <div class="bmi-scale">
                    <span class="b-under" style="${w(15, 18.5)}"></span>
                    <span class="b-healthy" style="${w(18.5, 25)}"></span>
                    <span class="b-over" style="${w(25, 30)}"></span>
                    <span class="b-obese" style="${w(30, 40)}"></span>
                </div>
                <div class="bmi-marker"><i style="left:${band.pct.toFixed(1)}%"></i></div>
                <div class="bmi-ticks"><span>15</span><span>18.5</span><span>25</span><span>30</span><span>40</span></div>
                <div style="margin-top:14px">
                    ${D.BMI_BANDS.map(b => {
                        const lo = b.key === 'under' ? 'under 18.5' : b.key === 'healthy' ? '18.5 – 24.9'
                            : b.key === 'over' ? '25.0 – 29.9' : '30.0 and over';
                        return `<div class="bmi-band-row ${band.key === b.key ? 'is-current' : ''}">
                            <span>${escapeHtml(b.label)}</span><span class="dim-sm">${lo}</span></div>`;
                    }).join('')}
                </div>` : `<div class="empty pad-sm"><div class="em-sub">Add your height and a weight entry to see your BMI.</div></div>`}
                <div class="note" style="margin-top:16px">
                    <strong>BMI is a rough guide, not a diagnosis.</strong> It is a ratio of weight to
                    height and nothing else — it cannot tell muscle from fat, and it does not account
                    for body composition, build, age, sex, ethnicity or pregnancy. Athletes and very
                    muscular people routinely read as "overweight" while being nothing of the sort.
                    It was designed to describe populations, not individuals. Treat a band as a
                    prompt to ask someone qualified, never as an answer on its own.
                </div>
                <div class="dim-sm" style="margin-top:10px">
                    Bands as published by the
                    <a href="${escapeHtml(D.BMI_SOURCE.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(D.BMI_SOURCE.label)}</a>.
                    They apply to adults.
                </div>`,
            footHtml: `<button class="btn primary" data-act="close">Close</button>`,
            onMount(modal, close) {
                modal.querySelector('[data-act="close"]').addEventListener('click', close);
            },
        });
    }


    // ── Substances ───────────────────────────────────────────────────────────
    // A product's page says "10 mg". This is where the app gets to say
    // what 10 mg of it actually IS — which molecule, how much of that molecule, what
    // the model knows about it, and, crucially, whether any of that is sourced.
    function substanceInfo(substanceId, medId) {
        const S = window.Substances;
        const st = Store().state;
        const sub = S && S.substanceById(substanceId, st.substances);
        if (!sub) return;
        const med = medId ? st.meds.find(m => m.id === medId) : null;

        // The salt conversion, shown against a real dose the user actually takes
        // rather than an abstract 1 mg — the difference only lands when it is 5 mg
        // on the box and 3.67 mg in you.
        let saltHtml = '';
        if (med) {
            const example = (med.doses && med.doses.length ? med.doses : [1])[0];
            const rows = D.doseBaseMg(med, example).filter(r => r.substance.id === sub.id);
            const r = rows[0];
            if (r && r.saltFactor !== 1) {
                saltHtml = `<div class="note" style="margin-top:14px">
                    <strong>This one is a salt.</strong> Your ${escapeHtml(String(example))}${escapeHtml(med.unit)}
                    of ${escapeHtml(med.name)} is ${escapeHtml(String(example))}${escapeHtml(med.unit)} of
                    <em>${escapeHtml(sub.name.toLowerCase())} ${escapeHtml(String(r.salt).replace(/-/g, ' '))}</em>,
                    which is <strong>${r.baseMg.toFixed(2)} mg</strong> of ${escapeHtml(sub.name.toLowerCase())} itself
                    — a factor of ${r.saltFactor}.
                    <br><br>
                    The app keeps showing you the number on the box. It only converts
                    behind the scenes, and only when it has to add this up with something
                    else that delivers the same molecule.
                </div>`;
            } else if (r) {
                saltHtml = `<div class="dim-sm" style="margin-top:14px">
                    ${escapeHtml(med.name)} delivers ${escapeHtml(sub.name.toLowerCase())} directly — no salt conversion.
                </div>`;
            }
        }

        const num = (v, unit) => v == null ? '<span class="dim">—</span>'
            : `<span class="tabular-mono">${v}</span> <span class="dim-sm">${unit}</span>`;

        const edges = (S.conversionsFrom(sub.id) || []);
        const edgeHtml = edges.length ? `
            <div class="k" style="margin-top:16px">Becomes</div>
            ${edges.map(e => {
                const to = S.substanceById(e.to, st.substances);
                return `<div class="bmi-band-row">
                    <span>${escapeHtml(to ? to.name : e.to)}${e.plotByDefault === false
                        ? ' <span class="pill">not charted</span>' : ''}</span>
                    <span class="dim-sm">${escapeHtml(e.mechanism || '')}</span>
                </div>`;
            }).join('')}
            ${edges.some(e => e.plotByDefault === false) ? `<div class="note" style="margin-top:10px">
                One of these is deliberately not charted. ${escapeHtml(
                    (edges.find(e => e.plotByDefault === false) || {}).note || '')}
            </div>` : ''}` : '';

        openModal({
            title: sub.name,
            bodyHtml: `
                ${sub.aka && sub.aka.length
                    // Behind a disclosure rather than inline. A row of brand names
                    // beside a drug name reads like a list of different things, and the
                    // one that matters is the one already on the user's box.
                    ? `<details class="aka-disclosure">
                        <summary>also sold as ${escapeHtml(sub.aka.length)} other name${sub.aka.length === 1 ? '' : 's'}</summary>
                        <div class="dim-sm">${escapeHtml(sub.aka.join(', '))}</div>
                       </details>` : ''}
                ${sub.custom ? `<div class="pill warn sm">yours</div>` : ''}
                <div class="mc-facts" style="margin-top:12px">
                    <div><div class="k">Half-life</div><div>${num(sub.halfLifeH, 'h')}</div></div>
                    <div><div class="k">Peaks after</div><div>${num(sub.tmaxH, 'h')}</div></div>
                    <div><div class="k">Works for</div><div>${num(sub.durationH, 'h')}</div></div>
                    <div><div class="k">Absorbed</div><div>${sub.bioavailability
                        ? Math.round(sub.bioavailability * 100) + '<span class="dim-sm">%</span>'
                        : '<span class="dim">unknown</span>'}</div></div>
                </div>
${(() => {
                    // What the limit is, who says so, what actually
                    // goes wrong past it, and — deliberately — the fact
                    // that it is a DEFAULT the user can change.
                    const L = Store().limitsFor(sub.id);
                    if (!L.maxPer24h && !L.minGapH) return '';
                    const basisWord = {
                        otc: 'the over-the-counter limit',
                        prescription: 'the prescribing label',
                        guideline: 'a clinical guideline',
                        unverified: 'an unverified figure',
                        user: 'your own limit',
                    }[L.basis] || 'a published figure';
                    return `<div class="limit-box">
                        <div class="k">How much, how often</div>
                        <div class="limit-figs">
                            ${L.maxPer24h ? `<span><strong>${D.fmtAmount(L.maxPer24h)} mg</strong> in 24 hours</span>` : ''}
                            ${L.minGapH ? `<span><strong>${L.minGapH} h</strong> between doses</span>` : ''}
                        </div>
                        <div class="dim-sm">From ${escapeHtml(basisWord)}${
                            L.overridden && L.official && L.official.maxPer24h
                                ? ` — the label says ${D.fmtAmount(L.official.maxPer24h)} mg` : ''}.
                            A ceiling on the <em>ingredient</em>, not on any one product.</div>
                        ${L.harm ? `<div class="limit-harm">${escapeHtml(L.harm)}</div>` : ''}
                        ${L.note ? `<div class="dim-sm" style="margin-top:8px">${escapeHtml(L.note)}</div>` : ''}
                        ${L.user && L.user.reason ? `<div class="dim-sm" style="margin-top:8px">
                            Your reason: ${escapeHtml(L.user.reason)}</div>` : ''}
                        ${L.source ? `<div class="dim-sm" style="margin-top:8px">
                            <a href="${escapeHtml(window.UI.safeUrl(L.source.url))}" target="_blank" rel="noopener noreferrer">${escapeHtml(L.source.label)}</a>
                        </div>` : ''}
                        <button class="btn small" data-act="edit-limit" style="margin-top:10px">
                            ${L.user ? 'Change your limit' : 'Set my own limit'}</button>
                    </div>`;
                })()}
                ${saltHtml}
                ${edgeHtml}
                ${sub.note ? `<div class="note" style="margin-top:14px">${escapeHtml(sub.note)}</div>` : ''}
                <div class="${sub.verified ? 'dim-sm' : 'note'}" style="margin-top:14px">
                    ${sub.verified && sub.source
                        ? `Figures from <a href="${escapeHtml(window.UI.safeUrl(sub.source.url))}" target="_blank" rel="noopener noreferrer">${escapeHtml(sub.source.label)}</a>.`
                        : `<strong>These numbers are not sourced.</strong> They were carried over from
                           this app's own preset for the medication, where they have always driven the
                           curve without a citation behind them. Treat the chart as a rough shape, not
                           a measurement.`}
                </div>
                <div class="dim-sm" style="margin-top:10px">
                    Estimates for a typical adult. They take no account of your liver, kidneys, weight,
                    age, or anything else you take. Not medical advice — follow your own label and
                    your prescriber.
                </div>`,
            footHtml: `<button class="btn primary" data-act="close">Close</button>`,
            onMount(modal, close) {
                modal.querySelector('[data-act="close"]').addEventListener('click', close);
                const el = modal.querySelector('[data-act="edit-limit"]');
                if (el) el.addEventListener('click', () => { close(); editLimit(sub.id); });
            },
        });
    }

    /**
     * Let the user set their own ceiling for an ingredient.
     *
     * The reasoning: chronic conditions can legitimately call for higher than
     * standard doses. The shipped figures are typical-adult
     * defaults, mostly off over-the-counter packs, and an app that calls a supervised
     * prescription an overdose is not only wrong — it teaches the user to ignore the
     * warning, which is the worse failure.
     *
     * The official figure never disappears. It sits beside theirs, so the size of the
     * difference is always visible.
     */
    function editLimit(substanceId) {
        const sub = window.Substances.substanceById(substanceId, Store().state.substances);
        if (!sub) return;
        const L = Store().limitsFor(substanceId);
        const off = L.official || {};
        openModal({
            title: `Your limit for ${sub.name.toLowerCase()}`,
            sub: 'Applies to every product containing it, not just one.',
            bodyHtml: `
                <div class="note">
                    The figures below are <strong>typical-adult defaults</strong>${
                        off.basis === 'otc' ? ', taken from an over-the-counter pack' : ''}.
                    If you are on a supervised regimen with different numbers, put those in — the app
                    should be warning you against <em>your</em> limit, not against a stranger's.
                    ${off.maxPer24h ? `The published figure is <strong>${D.fmtAmount(off.maxPer24h)} mg</strong>
                        in 24 hours${off.minGapH ? `, ${off.minGapH} h apart` : ''}.` : ''}
                </div>
                <div class="field-row" style="margin-top:14px">
                    <div class="field nomb"><label>Max in 24 hours (mg)</label>
                        <input type="number" min="0" step="any" id="ulMax"
                            value="${L.user && L.user.maxPer24h ? L.user.maxPer24h : ''}"
                            placeholder="${off.maxPer24h || 'no limit'}"></div>
                    <div class="field nomb"><label>Minimum gap (hours)</label>
                        <input type="number" min="0" step="any" id="ulGap"
                            value="${L.user && L.user.minGapH ? L.user.minGapH : ''}"
                            placeholder="${off.minGapH || 'none'}"></div>
                </div>
                <div class="field"><label>Why — for your own reference later</label>
                    <input id="ulReason" maxlength="300"
                        value="${escapeHtml((L.user && L.user.reason) || '')}"
                        placeholder="e.g. prescribed 2400 mg/day for chronic pain"></div>
                <div class="dim-sm">Leave a box empty to go back to the published figure.
                    Whatever you set, the app still only warns — it never stops you logging a dose
                    you have already taken.</div>`,
            footHtml: `<button class="btn ghost" data-act="cancel">Cancel</button>
                <button class="btn primary" data-act="save">Save limit</button>`,
            onMount(modal, close) {
                modal.querySelector('[data-act="cancel"]').addEventListener('click', close);
                modal.querySelector('[data-act="save"]').addEventListener('click', () => {
                    const num = id => {
                        const v = parseFloat(modal.querySelector(id).value);
                        return isFinite(v) && v > 0 ? v : undefined;
                    };
                    Store().setSubstanceLimit(substanceId, {
                        maxPer24h: num('#ulMax'), minGapH: num('#ulGap'),
                        reason: modal.querySelector('#ulReason').value.trim(),
                    });
                    close();
                    window.UI.toast('Limit saved');
                });
            },
        });
    }


    // ── Reconciling a corrected preset ──────────────
    // The built-in data for a medication has been corrected, and the user's copy says
    // something else. Both numbers are shown and neither moves without an answer:
    // this app's figures drive a chart that looks clinical, and quietly replacing a
    // value someone typed would be worse than being out of date.
    function reconcileMed(medId) {
        const st = Store().state;
        const med = st.meds.find(m => m.id === medId);
        if (!med) return;
        const rows = D.presetDiff(med).ask;
        if (!rows.length) return;

        const rowHtml = r => `<div class="recon-row" data-field="${escapeHtml(r.key)}">
            <div class="recon-label">${escapeHtml(r.label)}</div>
            <div class="recon-sides">
                <button class="recon-side" data-take="0">
                    <span class="k">Yours</span>
                    <span class="v">${escapeHtml(r.fmt(r.mine))}</span>
                </button>
                <button class="recon-side" data-take="1">
                    <span class="k">Updated</span>
                    <span class="v">${escapeHtml(r.fmt(r.theirs))}</span>
                </button>
            </div>
        </div>`;

        openModal({
            title: `${med.name} — built-in data has changed`,
            sub: 'Nothing changes until you pick a side.',
            bodyHtml: `
                <div class="dim-sm">Pick one per row. Anything you leave alone stays as it is,
                    and you will not be asked about it again unless the built-in figure changes
                    to something different.</div>
                <div class="recon-list" style="margin-top:14px">${rows.map(rowHtml).join('')}</div>
                <div class="note" style="margin-top:14px">
                    Taking an updated value also hands that field over to the app, so future
                    corrections to it arrive without asking. Keeping yours keeps it yours.
                </div>`,
            footHtml: `<button class="btn" data-act="close">Done</button>`,
            onMount(modal, close) {
                modal.querySelector('[data-act="close"]').addEventListener('click', close);
                modal.querySelector('.recon-list').addEventListener('click', e => {
                    const btn = e.target.closest('.recon-side');
                    if (!btn) return;
                    const row = btn.closest('.recon-row');
                    const field = row.dataset.field;
                    Store().resolvePresetField(medId, field, btn.dataset.take === '1');
                    row.classList.add('is-done');
                    row.querySelectorAll('.recon-side').forEach(b => {
                        b.classList.toggle('chosen', b === btn);
                        b.disabled = true;
                    });
                    if (!modal.querySelector('.recon-row:not(.is-done)')) {
                        setTimeout(close, 450);
                    }
                });
            },
        });
    }

    // Each file adds to the shared namespace rather than replacing it, so app.js can
    // keep one reference and the load order below stops mattering.
    Object.assign(window.Modals = window.Modals || {}, { bmiInfo, substanceInfo, reconcileMed, editLimit });
})();
