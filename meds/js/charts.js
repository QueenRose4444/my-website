// ================================================
// charts.js — SVG charts (med level decay + weight trend)
// Vanilla port of the design prototype charts, with
// pointer events so tooltips work on touch screens.
// ================================================
(function () {
    'use strict';
    const D = window.MedData;
    // SVG <text> carries user-authored strings (a med name, a formatted clock);
    // ui.js owns the escaping so there is exactly one implementation of it.
    const escapeHtml = s => window.UI.escapeHtml(s);
    // A med's name, unit and colour are the user's own text — and an imported backup can
    // carry anything at all — so none of them reaches markup unescaped. A colour goes
    // into SVG attributes and inline styles, where escaping is not enough, so only a
    // hex colour is used as given; anything else becomes the accent.
    const safeColor = c => (typeof c === 'string' && /^#[0-9a-f]{3,8}$/i.test(c)) ? c : 'var(--accent)';

    function clearChart(wrap) {
        if (wrap._ro) { wrap._ro.disconnect(); wrap._ro = null; }
        if (wrap._offTap) { document.removeEventListener('pointerdown', wrap._offTap, true); wrap._offTap = null; }
        wrap.innerHTML = '';
    }

    // touch tooltips stay pinned after the finger lifts — tapping anywhere
    // outside the chart dismisses them. Self-cleans once the chart is gone.
    function bindOffTapHide(wrap, hide) {
        if (wrap._offTap) document.removeEventListener('pointerdown', wrap._offTap, true);
        wrap._offTap = e => {
            if (!document.contains(wrap)) { document.removeEventListener('pointerdown', wrap._offTap, true); wrap._offTap = null; return; }
            if (!wrap.contains(e.target)) hide();
        };
        document.addEventListener('pointerdown', wrap._offTap, true);
    }

    function watchResize(wrap, render) {
        if (wrap._ro) wrap._ro.disconnect();
        let lastW = wrap.clientWidth;
        wrap._ro = new ResizeObserver(() => {
            if (Math.abs(wrap.clientWidth - lastW) > 4) {
                lastW = wrap.clientWidth;
                render();
            }
        });
        wrap._ro.observe(wrap);
    }

    function emptyState(wrap, title, sub) {
        wrap.innerHTML = `<div class="empty"><div class="em-title">${escapeHtml(title)}</div>${sub ? `<div class="em-sub">${escapeHtml(sub)}</div>` : ''}</div>`;
    }

    function tooltipEl(wrap) {
        const t = document.createElement('div');
        t.className = 'chart-tooltip';
        t.style.display = 'none';
        wrap.appendChild(t);
        return t;
    }

    // ------------------------------------------------
    // Estimated medication level (past range + 14d projection)
    // ------------------------------------------------
    const MED_RANGE_DAYS = { w: 7, '14': 14, m: 30, '3m': 90, '6m': 180, y: 365 };
    // default days projected past "now", scaled to the chosen range
    const AUTO_PROJ = { w: 2, '14': 4, m: 7, '3m': 21, '6m': 45, y: 90, all: 30 };

    /**
     * One plottable line, whatever it came from.
     *
     * A MED series is `{med, doseLog}` and is normalised here. A GENERIC series already
     * carries `level(ts)` and is passed straight through — that is how one
     * substance fed by two different products is drawn, without this file ever learning what a
     * substance is.
     */
    function normSeries(sr) {
        if (!sr) return null;
        if (typeof sr.level === 'function') {
            return Object.assign({ doses: [], critTimes: [], modelled: true, unit: '' }, sr);
        }
        const med = sr.med, doseLog = sr.doseLog || [];
        if (!med || !doseLog.length) return null;
        // The peak is a SOLVED quantity under the Bateman model, not the med's stored
        // timeToPeak — they agree for a preset-derived med and do not for one that
        // inherited its numbers from a substance.
        const ttpMs = D.peakOffsetDays(med) * 86400000;
        const critTimes = [];
        for (const s of doseLog) {
            if (ttpMs > 0) critTimes.push(s.timestamp, s.timestamp + ttpMs);
            else critTimes.push(s.timestamp - 1000, s.timestamp);
        }
        return {
            key: med.id, name: med.name, unit: med.unit, baseColor: med.color,
            modelled: D.hasPharmacokinetics(med),
            doses: doseLog, critTimes,
            level: ts => D.medLevelAt(doseLog, med, ts),
            // The threshold fields are attached by the caller, which knows about substances.
            // They are copied across explicitly because this builds a NEW object —
            // the same trap getScheduleSlots had, where an anchor set on the
            // input silently vanished downstream while still looking right upstream.
            threshold: sr.threshold, crossingTs: sr.crossingTs, thresholdNote: sr.thresholdNote,
            med,
        };
    }

    // opts: { series: [{ med, doseLog } | { name, unit, level(ts), doses, critTimes }],
    //         range, projection, graphStep, settings }
    // (or legacy single { med, doseLog }). One line per med; round axis steps.
    function medLevel(wrap, opts) {
        const render = () => {
            clearChart(wrap);
            const settings = opts.settings;
            // A series is either a MED (the common case, normalised below) or something
            // that already knows how to answer "how much at time t" — which is how a
            // substance fed by several products is plotted. Everything past this point
            // deals only in the normalised shape, so the chart has no idea which it is.
            const candidates = (opts.series || (opts.med ? [{ med: opts.med, doseLog: opts.doseLog || [] }] : []))
                .map(normSeries).filter(sr => sr && sr.doses.length);
            // A med with no half-life cannot be modelled, so it is left off the chart entirely
            // rather than drawn from a guessed constant. Say how many, so the gap is explained.
            const series = candidates.filter(sr => sr.modelled);
            const unmodelled = candidates.filter(sr => !sr.modelled);
            if (!series.length) {
                if (unmodelled.length) {
                    emptyState(wrap, 'No half-life recorded',
                        unmodelled.length === 1
                            ? `Add a half-life for ${unmodelled[0].name} to estimate its level`
                            : 'These meds have no half-life recorded, so their levels cannot be estimated');
                } else {
                    emptyState(wrap, 'No doses yet', 'Log a dose to see your estimated level');
                }
                watchResize(wrap, render);
                return;
            }
            const allShots = series.reduce((a, sr) => a.concat(sr.doses), []);

            // range key ('w','14','m','3m','6m','y','all') or a number of days
            let range = opts.range || 'm';
            const rangeKey = typeof range === 'string' ? range : null;
            if (typeof range === 'string') {
                if (range === 'all') {
                    const oldest = Math.min.apply(null, allShots.map(s => s.timestamp));
                    range = Math.max(14, Math.ceil((Date.now() - oldest) / 86400000) + 3);
                } else {
                    range = MED_RANGE_DAYS[range] || 30;
                }
            }
            let proj = opts.projection;
            if (proj == null || proj === 'auto') {
                proj = rangeKey && AUTO_PROJ[rangeKey] != null ? AUTO_PROJ[rangeKey] : Math.max(2, Math.round(range * 0.2));
            }
            proj = Math.max(0, Number(proj) || 0);

            const w = Math.max(280, wrap.clientWidth || 600);
            const h = wrap.clientHeight || 240;
            const PAD = { t: 22, r: 14, b: 26, l: 46 };
            const innerW = w - PAD.l - PAD.r, innerH = h - PAD.t - PAD.b;

            const now = Date.now();
            const startTs = now - range * 86400000;
            const endTs = now + proj * 86400000;
            const totalMs = Math.max(1, endTs - startTs);
            const sampleCount = Math.min(500, Math.max(200, Math.floor(w / 2.5)));
            const tickFont = w < 520 ? 12 : 10;

            // sample each med separately; exact points at every dose time and its
            // absorption peak keep the spikes sharp instead of sampling past them
            series.forEach(sr => {
                const samples = [];
                for (let i = 0; i <= sampleCount; i++) {
                    const ts = startTs + (i / sampleCount) * totalMs;
                    samples.push({ ts, level: sr.level(ts) });
                }
                // Extra exact samples where the curve turns, so a peak that falls
                // between two evenly-spaced samples is not simply stepped over.
                for (const ts of sr.critTimes) {
                    if (ts >= startTs && ts <= endTs) samples.push({ ts, level: sr.level(ts) });
                }
                samples.sort((a, b) => a.ts - b.ts);
                sr.samples = samples;
                sr.color = series.length === 1 ? 'var(--accent)' : safeColor(sr.baseColor);
            });

            // y axis: round steps (1/2/2.5/5×10ⁿ). Density chips pick how many
            // gridlines; an exact per-med step (single-med view) wins over both.
            const dataMax = Math.max(0.5, ...series.map(sr => Math.max(...sr.samples.map(s => s.level))));
            const dataMin = Math.min(...series.map(sr => Math.min(...sr.samples.map(s => s.level))));
            // "Fit" mode floats the axis floor just under the lowest visible
            // level, with the same breathing room below as above the peaks
            const fitMin = !!opts.fitMin && dataMin > 0.001 && dataMax - dataMin > 0.001;
            const span = fitMin ? dataMax - dataMin : dataMax;
            const densityDivs = { fine: 9, auto: 5, coarse: 3 };
            let step = (series.length === 1 && opts.graphStep > 0)
                ? opts.graphStep
                : D.niceStep(span, densityDivs[opts.density] || 5);
            while (span / step > 24) step *= 2; // cap runaway gridline counts
            // top of the chart hugs the data (+5%) so peaks stay tall;
            // gridlines still land on round step multiples below it
            const yBottom = fitMin ? Math.max(0, dataMin - span * 0.05) : 0;
            const yTop = fitMin ? dataMax + span * 0.05 : Math.max(step, dataMax * 1.05);
            const x = ts => PAD.l + ((ts - startTs) / totalMs) * innerW;
            const y = v => PAD.t + (1 - (v - yBottom) / (yTop - yBottom)) * innerH;
            const fmtTick = v => {
                if (step >= 1) return String(Math.round(v * 100) / 100);
                return v.toFixed(step >= 0.25 ? 1 : 2);
            };

            let gridHtml = '';
            for (let v = Math.ceil(yBottom / step - 0.001) * step; v <= yTop + step * 0.01; v += step) {
                gridHtml += `<line x1="${PAD.l}" x2="${w - PAD.r}" y1="${y(v)}" y2="${y(v)}" stroke="var(--border)" stroke-dasharray="2 3"/>
                    <text x="${PAD.l - 8}" y="${y(v) + 3}" text-anchor="end" font-size="${tickFont}" fill="var(--text-3)" font-family="var(--font-mono)">${fmtTick(v)}</text>`;
            }
            let xTickHtml = '';
            const xTickCount = w < 480 ? 3 : 5;
            for (let i = 0; i <= xTickCount; i++) {
                const ts = startTs + (i / xTickCount) * totalMs;
                xTickHtml += `<text x="${x(ts)}" y="${h - 8}" text-anchor="middle" font-size="${tickFont}" fill="var(--text-3)" font-family="var(--font-mono)">${D.fmtDateShort(ts)}</text>`;
            }

            let seriesHtml = '', defsHtml = '', markerHtml = '';
            // `threshold` is the level below which the curve is estimated to be
            // detectable but no longer doing anything. Only a single scoped series can
            // carry one — two meds in different units share no horizontal line.
            const threshold = (series.length === 1 && series[0].threshold > 0
                && series[0].threshold < yTop) ? series[0].threshold : null;
            series.forEach((sr, si) => {
                const pathD = sr.samples.map((s, i) => `${i === 0 ? 'M' : 'L'} ${x(s.ts).toFixed(1)} ${y(s.level).toFixed(2)}`).join(' ');
                if (series.length === 1) {
                    const areaD = `${pathD} L ${x(endTs).toFixed(1)} ${(PAD.t + innerH).toFixed(1)} L ${x(startTs).toFixed(1)} ${(PAD.t + innerH).toFixed(1)} Z`;
                    if (threshold == null) {
                        defsHtml += `<linearGradient id="ml-grad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stop-color="${sr.color}" stop-opacity="0.32"/>
                            <stop offset="100%" stop-color="${sr.color}" stop-opacity="0"/>
                        </linearGradient>`;
                        seriesHtml += `<path d="${areaD}" fill="url(#ml-grad)"/>`;
                    } else {
                        // One area path, drawn twice through two clips: solid above the
                        // line (estimated to be working), hatched below it (estimated
                        // detectable, not necessarily effective). Never hue alone —
                        // the fill PATTERN is the distinction, so it survives both
                        // colour-blindness and a greyscale print.
                        const yT = y(threshold);
                        defsHtml += `<linearGradient id="ml-grad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stop-color="${sr.color}" stop-opacity="0.34"/>
                                <stop offset="100%" stop-color="${sr.color}" stop-opacity="0.18"/>
                            </linearGradient>
                            <pattern id="ml-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                                <line x1="0" y1="0" x2="0" y2="6" stroke="${sr.color}" stroke-width="1.4" stroke-opacity="0.45"/>
                            </pattern>
                            <clipPath id="ml-clip-hi"><rect x="${PAD.l}" y="${PAD.t}" width="${innerW}" height="${Math.max(0, yT - PAD.t)}"/></clipPath>
                            <clipPath id="ml-clip-lo"><rect x="${PAD.l}" y="${yT}" width="${innerW}" height="${Math.max(0, PAD.t + innerH - yT)}"/></clipPath>`;
                        seriesHtml += `<path d="${areaD}" fill="url(#ml-hatch)" clip-path="url(#ml-clip-lo)"/>
                            <path d="${areaD}" fill="url(#ml-grad)" clip-path="url(#ml-clip-hi)"/>
                            <line x1="${PAD.l}" x2="${w - PAD.r}" y1="${yT}" y2="${yT}"
                                stroke="${sr.color}" stroke-width="1" stroke-dasharray="5 4" opacity="0.85"/>`;
                    }
                }
                seriesHtml += `<path d="${pathD}" fill="none" stroke="${sr.color}" stroke-width="2" stroke-linejoin="round"/>`;
                if (opts.showDots !== false) {
                    sr.doses.filter(s => s.timestamp >= startTs && s.timestamp <= now).forEach(s => {
                        const lvl = sr.level(s.timestamp);
                        markerHtml += `<line x1="${x(s.timestamp)}" x2="${x(s.timestamp)}" y1="${PAD.t + innerH}" y2="${y(lvl)}" stroke="${sr.color}" stroke-width="1" stroke-dasharray="1 2" opacity="0.5"/>
                            <circle cx="${x(s.timestamp)}" cy="${PAD.t + innerH - 2}" r="3" fill="${s.estimated ? 'var(--surface)' : sr.color}" stroke="${sr.color}" stroke-width="1.5"/>`;
                    });
                }
            });

            // "…wears off around 4:10 PM". The one number on this chart a person can
            // act on, so it is drawn at the crossing rather than left to be read off.
            if (threshold != null && series[0].crossingTs
                && series[0].crossingTs >= startTs && series[0].crossingTs <= endTs) {
                const cx = x(series[0].crossingTs), cy = y(threshold);
                const label = D.fmtTime(series[0].crossingTs, settings);
                const anchorEnd = cx > w - PAD.r - 70;
                markerHtml += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="3.5"
                        fill="var(--bg)" stroke="${series[0].color}" stroke-width="2"/>
                    <text x="${(anchorEnd ? cx - 8 : cx + 8).toFixed(1)}" y="${(cy - 8).toFixed(1)}"
                        text-anchor="${anchorEnd ? 'end' : 'start'}" font-size="${tickFont}"
                        fill="var(--text-2)" font-family="var(--font-mono)">${escapeHtml(label)}</text>`;
            }

            // legend only when comparing meds
            const legendHtml = series.length > 1
                ? `<div class="ml-legend">${series.map(sr => `<span><span class="ml-dot" style="background:${sr.color}"></span>${escapeHtml(sr.name)}</span>`).join('')}</div>`
                : threshold != null
                // In words, not by swatch alone. "Shaded" and "hatched" mean nothing
                // to someone who cannot tell the two fills apart at a glance, and the
                // difference between them is the whole claim the chart is making.
                ? `<div class="ml-legend ml-legend-band">
                        <span><span class="ml-swatch solid"></span>estimated to be working</span>
                        <span><span class="ml-swatch hatch"></span>estimated detectable, not necessarily effective</span>
                        ${series[0].thresholdNote ? `<span class="dim-sm">${escapeHtml(series[0].thresholdNote)}</span>` : ''}
                    </div>`
                : '';

            wrap.innerHTML = `
                <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
                    <defs>${defsHtml}</defs>
                    ${gridHtml}${xTickHtml}
                    <line x1="${x(now)}" x2="${x(now)}" y1="${PAD.t}" y2="${PAD.t + innerH}" stroke="var(--text-3)" stroke-dasharray="3 4" stroke-width="1"/>
                    <text x="${x(now)}" y="${PAD.t - 8}" text-anchor="middle" font-size="${tickFont}" fill="var(--text-3)" font-family="var(--font-mono)">now</text>
                    ${seriesHtml}
                    ${markerHtml}
                    <g class="hover-g" style="display:none">
                        <line class="hv-line" y1="${PAD.t}" y2="${PAD.t + innerH}" stroke="var(--border-strong)" stroke-dasharray="2 2"/>
                        ${series.map((sr, si) => `<circle class="hv-dot" data-si="${si}" r="4" fill="var(--bg)" stroke="${sr.color}" stroke-width="2"/>`).join('')}
                    </g>
                </svg>${legendHtml}`;

            const tip = tooltipEl(wrap);
            const hoverG = wrap.querySelector('.hover-g');
            const hvLine = wrap.querySelector('.hv-line');
            const hvDots = wrap.querySelectorAll('.hv-dot');
            const showAt = (clientX) => {
                const rect = wrap.getBoundingClientRect();
                const px = (clientX - rect.left) * (w / rect.width);
                const ts = startTs + Math.min(1, Math.max(0, (px - PAD.l) / innerW)) * totalMs;
                hoverG.style.display = '';
                hvLine.setAttribute('x1', x(ts)); hvLine.setAttribute('x2', x(ts));
                let topLevel = 0;
                const rows = series.map((sr, si) => {
                    // nearest sample in this series
                    let best = 0, bd = Infinity;
                    sr.samples.forEach((s, i) => { const dx = Math.abs(s.ts - ts); if (dx < bd) { bd = dx; best = i; } });
                    const s = sr.samples[best];
                    hvDots[si].setAttribute('cx', x(s.ts)); hvDots[si].setAttribute('cy', y(s.level));
                    if (s.level > topLevel) topLevel = s.level;
                    // Three decimals would read as a measurement. These are estimates
                    // from a model, and several of the half-lives behind them carry no
                    // citation at all.
                    const amt = D.fmtAmount(s.level) + ' ' + escapeHtml(sr.unit);
                    const extra = sr.breakdown ? sr.breakdown(s.ts) : '';
                    return series.length === 1
                        ? `<div class="t-val">${amt}</div>${extra}`
                        : `<div class="t-val"><span class="ml-dot" style="background:${sr.color}"></span>${escapeHtml(sr.name)}: ${amt}</div>`;
                });
                tip.style.display = '';
                tip.innerHTML = `<div class="t-label">${D.fmtDate(ts, settings)} · ${D.fmtTime(ts, settings)}</div>${rows.join('')}`;
                tip.style.left = (x(ts) / w * 100) + '%';
                tip.style.top = (y(topLevel) / h * 100) + '%';
            };
            // touch: tap shows the tooltip and it STAYS until the next tap;
            // tapping outside the chart closes it. Mouse keeps hover behaviour.
            const hideTip = () => { hoverG.style.display = 'none'; tip.style.display = 'none'; };
            wrap.addEventListener('pointermove', e => { if (e.pointerType !== 'touch') showAt(e.clientX); });
            wrap.addEventListener('pointerdown', e => showAt(e.clientX));
            wrap.addEventListener('pointerleave', e => {
                if (e.pointerType === 'touch') return;
                hideTip();
            });
            bindOffTapHide(wrap, hideTip);
            watchResize(wrap, render);
        };
        render();
    }

    // ------------------------------------------------
    // Weight trend
    // ------------------------------------------------
    const RANGE_DAYS = { w: 7, '14': 14, m: 30, '3m': 90, '6m': 180, y: 365, all: Infinity };

    function weight(wrap, opts) {
        const render = () => {
            clearChart(wrap);
            const { weights, unit, goalKg, settings } = opts;
            const range = opts.range || 'm';
            const now = Date.now();
            const days = RANGE_DAYS[range] != null ? RANGE_DAYS[range] : 30;
            const cutoff = days === Infinity ? 0 : now - days * 86400000;

            const sorted = (weights || []).slice().sort((a, b) => a.timestamp - b.timestamp);
            let data = sorted.filter(x => x.timestamp >= cutoff);
            // anchor the line at the range start using the last point before the window
            const before = sorted.filter(x => x.timestamp < cutoff);
            if (before.length && data.length) {
                const prev = before[before.length - 1];
                const next = data[0];
                const frac = (cutoff - prev.timestamp) / Math.max(1, next.timestamp - prev.timestamp);
                data = [{ timestamp: cutoff, kg: prev.kg + (next.kg - prev.kg) * frac, estimated: true }].concat(data);
            }

            if (data.length < 2) {
                emptyState(wrap, 'Not enough data', 'Log at least two weights for this range');
                watchResize(wrap, render);
                return;
            }

            const w = Math.max(280, wrap.clientWidth || 600);
            const h = wrap.clientHeight || 260;
            const PAD = { t: 16, r: 14, b: 26, l: 46 };
            const innerW = w - PAD.l - PAD.r, innerH = h - PAD.t - PAD.b;

            const tickFont = w < 520 ? 12 : 10;
            const val = kg => D.weightValue(kg, unit);
            const xs = data.map(d => d.timestamp);
            const ys = data.map(d => val(d.kg));
            const xMin = Math.min(...xs), xMax = Math.max(...xs);
            let yMin = Math.min(...ys), yMax = Math.max(...ys);
            const goalVal = goalKg != null ? val(goalKg) : null;
            const yPad = Math.max((yMax - yMin) * 0.18, 0.4);
            const yLo = yMin - yPad, yHi = yMax + yPad;

            const x = t => PAD.l + ((t - xMin) / Math.max(1, xMax - xMin)) * innerW;
            const y = v => PAD.t + (1 - (v - yLo) / Math.max(0.001, yHi - yLo)) * innerH;

            // smooth path
            let pathD = `M ${x(data[0].timestamp).toFixed(1)} ${y(val(data[0].kg)).toFixed(1)}`;
            for (let i = 1; i < data.length; i++) {
                const px = x(data[i - 1].timestamp), py = y(val(data[i - 1].kg));
                const cx = x(data[i].timestamp), cy = y(val(data[i].kg));
                const mx = (px + cx) / 2;
                pathD += ` Q ${px.toFixed(1)} ${py.toFixed(1)} ${mx.toFixed(1)} ${((py + cy) / 2).toFixed(1)} T ${cx.toFixed(1)} ${cy.toFixed(1)}`;
            }
            const areaD = `${pathD} L ${x(data[data.length - 1].timestamp).toFixed(1)} ${PAD.t + innerH} L ${x(data[0].timestamp).toFixed(1)} ${PAD.t + innerH} Z`;

            const ticks = 4;
            let gridHtml = '';
            for (let i = 0; i <= ticks; i++) {
                const v = yLo + (i / ticks) * (yHi - yLo);
                gridHtml += `<line x1="${PAD.l}" x2="${w - PAD.r}" y1="${y(v)}" y2="${y(v)}" stroke="var(--border)" stroke-dasharray="2 3"/>
                    <text x="${PAD.l - 8}" y="${y(v) + 3}" text-anchor="end" font-size="${tickFont}" fill="var(--text-3)" font-family="var(--font-mono)">${v.toFixed(1)}</text>`;
            }
            const xTickCount = Math.min(w < 480 ? 3 : 5, data.length);
            let xTickHtml = '';
            for (let i = 0; i < xTickCount; i++) {
                const d = data[Math.round(i * (data.length - 1) / Math.max(1, xTickCount - 1))];
                xTickHtml += `<text x="${x(d.timestamp)}" y="${h - 8}" text-anchor="middle" font-size="${tickFont}" fill="var(--text-3)" font-family="var(--font-mono)">${D.fmtDateShort(d.timestamp)}</text>`;
            }

            let goalHtml = '';
            if (goalVal != null && goalVal >= yLo && goalVal <= yHi) {
                goalHtml = `<line x1="${PAD.l}" x2="${w - PAD.r}" y1="${y(goalVal)}" y2="${y(goalVal)}" stroke="var(--success)" stroke-dasharray="3 4" stroke-width="1"/>
                    <text x="${w - PAD.r}" y="${y(goalVal) - 4}" text-anchor="end" font-size="${tickFont}" fill="var(--success)" font-family="var(--font-mono)">GOAL ${goalVal.toFixed(1)}</text>`;
            }

            const dotHtml = data.map((d, i) =>
                `<circle data-i="${i}" cx="${x(d.timestamp)}" cy="${y(val(d.kg))}" r="3" fill="var(--bg)" stroke="var(--accent)" stroke-width="2"${d.estimated ? ' stroke-dasharray="2 2"' : ''}/>`).join('');

            wrap.innerHTML = `
                <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
                    <defs><linearGradient id="wt-grad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.25"/>
                        <stop offset="100%" stop-color="var(--accent)" stop-opacity="0"/>
                    </linearGradient></defs>
                    ${gridHtml}${xTickHtml}${goalHtml}
                    <path d="${areaD}" fill="url(#wt-grad)"/>
                    <path d="${pathD}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    ${dotHtml}
                    <line class="hv-line" y1="${PAD.t}" y2="${PAD.t + innerH}" stroke="var(--border-strong)" stroke-dasharray="2 2" style="display:none"/>
                </svg>`;

            const tip = tooltipEl(wrap);
            const hvLine = wrap.querySelector('.hv-line');
            const showAt = clientX => {
                const rect = wrap.getBoundingClientRect();
                const px = (clientX - rect.left) * (w / rect.width);
                let best = 0, bd = Infinity;
                data.forEach((d, i) => { const dx = Math.abs(px - x(d.timestamp)); if (dx < bd) { bd = dx; best = i; } });
                const d = data[best];
                hvLine.style.display = '';
                hvLine.setAttribute('x1', x(d.timestamp)); hvLine.setAttribute('x2', x(d.timestamp));
                tip.style.display = '';
                const deltaTxt = best > 0 ? (() => {
                    const diff = d.kg - data[best - 1].kg;
                    if (Math.abs(diff) < 0.05) return '';
                    return `<div class="t-label">${diff > 0 ? '+' : '−'}${D.fmtWeight(Math.abs(diff), unit, true)} vs prev</div>`;
                })() : '';
                tip.innerHTML = `<div class="t-label">${D.fmtDate(d.timestamp, settings)} · ${D.fmtTime(d.timestamp, settings)}${d.estimated ? ' · est' : ''}</div><div class="t-val">${D.fmtWeight(d.kg, unit, true)}</div>${deltaTxt}`;
                tip.style.left = (x(d.timestamp) / w * 100) + '%';
                tip.style.top = (y(val(d.kg)) / h * 100) + '%';
            };
            const hideTip = () => { hvLine.style.display = 'none'; tip.style.display = 'none'; };
            wrap.addEventListener('pointermove', e => { if (e.pointerType !== 'touch') showAt(e.clientX); });
            wrap.addEventListener('pointerdown', e => showAt(e.clientX));
            wrap.addEventListener('pointerleave', e => {
                if (e.pointerType === 'touch') return;
                hideTip();
            });
            bindOffTapHide(wrap, hideTip);
            watchResize(wrap, render);
        };
        render();
    }

    window.Charts = { medLevel, weight, AUTO_PROJ };
})();
