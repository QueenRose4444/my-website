// ================================================
// pain-chart.js — pain over time, as an SVG string.
// Every score as a dot, a line through each day's worst, the 0-10 bands behind, and a
// tick wherever a pain medicine was taken, so a dose and the scores after it can be
// read together. Pure: data in, markup out.
// ================================================
(function () {
    'use strict';

    const DAY = 86400000;

    /**
     * @param {Array} entries   pain entries (kind 'pain'), any order
     * @param {Array} doseTimes timestamps of pain-medicine doses
     * @param {{from:number, to:number, width?:number, height?:number}} o
     * @returns {string} an <svg> element, or '' when there is nothing in range
     */
    function painChartSvg(entries, doseTimes, o) {
        const W = o.width || 360, H = o.height || 170;
        const PAD = { l: 28, r: 10, t: 10, b: 22 };
        const iw = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b;
        const from = o.from, to = o.to;
        const inRange = (entries || []).filter(e => e.timestamp >= from && e.timestamp <= to)
            .sort((a, b) => a.timestamp - b.timestamp);
        if (!inRange.length) return '';
        const x = t => PAD.l + (t - from) / (to - from) * iw;
        const y = v => PAD.t + (1 - v / 10) * ih;
        const f = n => Math.round(n * 10) / 10;

        // bands: mild 1-4, moderate 5-6, severe 7-10 (the DVPRS cut points, which also
        // read sensibly on a plain 0-10)
        const bands = [[0, 4, 'mild'], [4, 6, 'moderate'], [6, 10, 'severe']].map(([a, b, k]) =>
            `<rect class="pc-band pc-${k}" x="${PAD.l}" y="${f(y(b))}" width="${iw}" height="${f(y(a) - y(b))}"/>`).join('');
        const grid = [0, 5, 10].map(v =>
            `<line class="pc-grid" x1="${PAD.l}" x2="${PAD.l + iw}" y1="${f(y(v))}" y2="${f(y(v))}"/>
             <text class="pc-axis" x="${PAD.l - 6}" y="${f(y(v)) + 4}" text-anchor="end">${v}</text>`).join('');

        // each day's worst, joined
        const byDay = new Map();
        for (const e of inRange) {
            const d = new Date(e.timestamp); d.setHours(12, 0, 0, 0);
            const k = d.getTime();
            byDay.set(k, Math.max(byDay.get(k) == null ? -1 : byDay.get(k), Number(e.score)));
        }
        const days = [...byDay.entries()].sort((a, b) => a[0] - b[0]);
        const line = days.length > 1
            ? `<polyline class="pc-line" points="${days.map(([t, v]) => `${f(x(t))},${f(y(v))}`).join(' ')}"/>` : '';
        const dots = inRange.map(e => `<circle class="pc-dot" cx="${f(x(e.timestamp))}" cy="${f(y(Number(e.score)))}" r="3"/>`).join('');
        const ticks = (doseTimes || []).filter(t => t >= from && t <= to)
            .map(t => `<line class="pc-dose" x1="${f(x(t))}" x2="${f(x(t))}" y1="${PAD.t + ih}" y2="${PAD.t + ih + 9}"/>`).join('');

        // a few date labels along the bottom
        const span = to - from;
        const step = span <= 8 * DAY ? DAY : span <= 35 * DAY ? 7 * DAY : span <= 100 * DAY ? 14 * DAY : 60 * DAY;
        const labels = [];
        for (let t = to; t >= from; t -= step) {
            const d = new Date(t);
            // the newest label is right-aligned so it is not cut off at the edge
            labels.push(`<text class="pc-axis" x="${f(x(t))}" y="${H - 4}" text-anchor="${t === to ? 'end' : 'middle'}">${d.getDate()}/${d.getMonth() + 1}</text>`);
        }
        return `<svg class="pain-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Pain scores over time, 0 to 10">
            ${bands}${grid}${line}${dots}${ticks}${labels.join('')}</svg>`;
    }

    window.PainChart = { painChartSvg };
})();
