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

    // Each file adds to the shared namespace rather than replacing it, so app.js can
    // keep one reference and the load order below stops mattering.
    Object.assign(window.Modals = window.Modals || {}, { bmiInfo });
})();
