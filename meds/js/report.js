// ================================================
// report.js — a plain spreadsheet of doses, pain and weight for a date range, to
// take to a doctor. Pure: state in, CSV text out.
// ================================================
(function () {
    'use strict';

    /**
     * One cell. Quoted when it needs to be, and a leading = + - @ is defused with an
     * apostrophe: a spreadsheet would otherwise run "=…" from a free-text note as a
     * formula.
     */
    function cell(v) {
        if (v === null || v === undefined) return '';
        let s = String(v);
        if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
        return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }

    const HEADER = ['Type', 'Date', 'Time', 'What', 'Amount', 'Unit', 'Pain (0-10)', 'Scale', 'Where', 'Detail', 'Note'];

    /**
     * @param {object} state
     * @param {{from:number, to:number, doses?:boolean, pain?:boolean, weights?:boolean, weightUnit?:string}} o
     * @returns {{csv:string, counts:{doses:number, pain:number, weights:number}}}
     */
    function buildCsv(state, o) {
        const D = window.MedData, P = window.Pain;
        const inRange = x => x && x.timestamp >= o.from && x.timestamp <= o.to;
        const meds = new Map((state.meds || []).concat(state.trashedMeds || []).map(m => [m.id, m]));
        const rows = [];
        const counts = { doses: 0, pain: 0, weights: 0 };
        const when = ts => { const d = new Date(ts); return [D.ymd(d), D.hm(d)]; };

        if (o.doses !== false) {
            for (const x of (state.shots || []).filter(inRange)) {
                const m = meds.get(x.medId);
                rows.push({ ts: x.timestamp, cells: ['Dose', ...when(x.timestamp), m ? m.name : x.medId, x.dose, m ? m.unit : '', '', '',
                    x.location || '', x.estimated ? 'estimated' : '', x.note || ''] });
                counts.doses++;
            }
        }
        if (o.pain !== false && P) {
            const label = (list, id) => { const k = list.find(z => z.id === id); return k ? k.label : id; };
            for (const p of (state.pains || []).filter(inRange)) {
                if (p.kind === 'checkin') {
                    rows.push({ ts: p.timestamp, cells: ['Pain check-in', ...when(p.timestamp), 'Daily check-in (DVPRS)', '', '', '', 'dvprs', '',
                        P.DVPRS_SUPPLEMENTAL.map(q => q.key + ' ' + p[q.key]).join('; '), ''] });
                } else {
                    rows.push({ ts: p.timestamp, cells: ['Pain', ...when(p.timestamp), 'Pain', '', '', p.score, p.scale,
                        (p.areas || []).map(P.areaLabel).join('; '),
                        [p.type ? label(P.KINDS, p.type) : '', (p.context || []).map(c => label(P.CONTEXTS, c)).join(', '),
                         p.coping ? label(P.COPING, p.coping) : '', p.followsDose ? 'after a dose (re-rated)' : ''].filter(Boolean).join('; '),
                        p.note || ''] });
                }
                counts.pain++;
            }
        }
        if (o.weights !== false) {
            const unit = o.weightUnit || 'kg';
            for (const w of (state.weights || []).filter(inRange)) {
                const v = D.weightValue ? D.weightValue(w.kg, unit) : w.kg;
                rows.push({ ts: w.timestamp, cells: ['Weight', ...when(w.timestamp), 'Weight', Math.round(v * 10) / 10, unit === 'st-lbs' ? 'st' : unit, '', '', '', '', ''] });
                counts.weights++;
            }
        }
        rows.sort((a, b) => a.ts - b.ts);
        const lines = [HEADER].concat(rows.map(r => r.cells)).map(r => r.map(cell).join(','));
        // a BOM so Excel reads it as UTF-8 (en dashes, "Ozempic®", names with accents)
        return { csv: '﻿' + lines.join('\r\n') + '\r\n', counts };
    }

    window.Report = { buildCsv, cell };
})();
