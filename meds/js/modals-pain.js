// ================================================
// modals-pain.js — log a pain, and the DVPRS daily check-in.
// The scales, areas and arithmetic live in pain.js; this is only the form.
// ================================================
(function () {
    'use strict';
    const D = window.MedData;
    const P = window.Pain;
    const { escapeHtml, openModal, toast, todayYmd, nowHm } = window.UI;
    const Store = () => window.Store;

    const chip = (attr, id, label, on) =>
        `<button type="button" class="chip ${on ? 'active' : ''}" data-${attr}="${escapeHtml(id)}">${escapeHtml(label)}</button>`;

    /** 0-10 buttons. DVPRS buttons carry the scale's own words and band; NRS shows the anchors. */
    function scoreButtonsHtml(scale, current) {
        if (scale === 'dvprs') {
            const S = P.SCALES.dvprs;
            return `<div class="pain-levels dvprs" id="pnScore">${S.levels.map((words, n) => {
                const band = P.dvprsBand(n);
                return `<button type="button" class="pain-level ${band ? 'band-' + band : ''} ${current === n ? 'active' : ''}" data-score="${n}">
                    <span class="pl-num">${n}</span><span class="pl-words">${escapeHtml(words)}</span></button>`;
            }).join('')}</div>`;
        }
        const S = P.SCALES.nrs;
        return `<div class="pain-levels nrs" id="pnScore">${Array.from({ length: 11 }, (_, n) =>
            `<button type="button" class="pain-level ${current === n ? 'active' : ''}" data-score="${n}"><span class="pl-num">${n}</span></button>`).join('')}</div>
            <div class="pain-anchors"><span>0 · ${escapeHtml(S.anchors[0])}</span><span>10 · ${escapeHtml(S.anchors[10])}</span></div>`;
    }

    function sourceLine(scale) {
        const src = P.SCALES[scale].source;
        return `<div class="dim-sm pain-src">Scale: <a href="${escapeHtml(src.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(src.label)}</a></div>`;
    }

    /**
     * Log a pain, or edit one, or re-rate one after a dose.
     * @param {object} [initial] an existing pain entry
     * @param {{before:object, dose:object, med:object}} [rerate] the pain logged before a
     *        dose: same areas, same scale, and the result is linked to that dose
     */
    function logPain(initial, rerate) {
        const S = Store();
        const set = S.state.settings;
        const before = rerate && rerate.before;
        const scale = (initial && initial.scale) || (before && before.scale) || set.painScale || 'nrs';
        let score = initial && initial.score != null ? Number(initial.score) : null;
        let areas = (initial && Array.isArray(initial.areas)) ? initial.areas.slice()
            : (before && Array.isArray(before.areas)) ? before.areas.slice() : [];
        let kind = (initial && initial.type) || null;
        let context = (initial && Array.isArray(initial.context)) ? initial.context.slice() : [];
        let coping = (initial && initial.coping) || null;

        const suggestions = () => P.suggestAreas(S.state.pains || [], Date.now(), 8)
            .filter(a => !areas.some(b => P.areaKey(b) === P.areaKey(a)));
        const areasHtml = () => `
            ${areas.map((a, i) => `<button type="button" class="chip active" data-rm-area="${i}" title="Remove">${escapeHtml(P.areaLabel(a))} ×</button>`).join('')}
            ${suggestions().map(a => `<button type="button" class="chip" data-add-area='${escapeHtml(JSON.stringify(a))}'>+ ${escapeHtml(P.areaLabel(a))}</button>`).join('')}
            ${!areas.length && !suggestions().length ? '<span class="dim-sm">Pick where below.</span>' : ''}`;
        const regionOpts = P.REGIONS.map(r => `<option value="${r.id}">${escapeHtml(r.label)}</option>`).join('');

        const d0 = initial ? new Date(initial.timestamp) : new Date();
        // Each detail is built once and placed by the person's choice (Settings > Pain):
        // in the quick part of the form, or folded under "More detail".
        const fieldHtml = {
            kind: `<div class="field"><label>What kind</label>
                <div class="chip-grp" id="pnKind">${P.KINDS.map(k => chip('kind', k.id, k.label, kind === k.id)).join('')}</div></div>`,
            context: `<div class="field"><label>When it hurts <span class="dim-sm">— pick any</span></label>
                <div class="chip-grp" id="pnCtx">${P.CONTEXTS.map(c => chip('ctx', c.id, c.label, context.includes(c.id))).join('')}</div></div>`,
            coping: `<div class="field"><label>Can you carry on?</label>
                <div class="chip-grp" id="pnCope">${P.COPING.map(c => chip('cope', c.id, c.label, coping === c.id)).join('')}</div></div>`,
            note: `<div class="field"><label>Note</label><textarea id="pnNote" rows="2" placeholder="optional">${escapeHtml((initial && initial.note) || '')}</textarea></div>`,
        };
        const quick = (Array.isArray(set.painQuickFields) ? set.painQuickFields : []).filter(k => fieldHtml[k]);
        const moreFields = Object.keys(fieldHtml).filter(k => !quick.includes(k));
        const quickHtml = quick.map(k => fieldHtml[k]).join('');
        openModal({
            title: initial ? 'Edit pain' : before ? 'How is the pain now?' : 'Log pain',
            sub: before ? `Before ${rerate.med.name}: ${before.score}/10` : undefined,
            bodyHtml: `
                <div class="field"><label>Where</label>
                    <div class="chip-grp" id="pnAreas">${areasHtml()}</div>
                    <div class="pain-pick">
                        <select id="pnRegion"><option value="">Add an area…</option>${regionOpts}</select>
                        <select id="pnSub" style="display:none"></select>
                        <select id="pnSide" style="display:none"></select>
                        <button type="button" class="btn" id="pnAdd" style="display:none">Add</button>
                    </div>
                </div>
                <div class="field"><label>How bad</label>
                    ${scale === 'dvprs' ? `<img class="dvprs-card" src="${P.SCALES.dvprs.card}" alt="The Defense and Veterans Pain Rating Scale card: 0 no pain to 10 as bad as it could be, with mild 1-4, moderate 5-6 and severe 7-10 bands">` : ''}
                    ${scoreButtonsHtml(scale, score)}
                    ${sourceLine(scale)}
                </div>
                ${quickHtml}
                <details class="pain-more" ${initial && moreFields.some(k => (k === 'kind' && kind) || (k === 'context' && context.length) || (k === 'coping' && coping) || (k === 'note' && initial.note)) ? 'open' : ''}>
                    <summary>More detail</summary>
                    ${moreFields.map(k => fieldHtml[k]).join('')}
                    <div class="field-row">
                        <div class="field nomb"><label>Date</label><input type="date" id="pnDate" value="${D.ymd(d0)}"></div>
                        <div class="field nomb"><label>Time</label><input type="time" id="pnTime" value="${initial ? initial.time : nowHm()}"></div>
                    </div>
                </details>`,
            footHtml: `
                <button class="btn ghost" data-act="cancel">Cancel</button>
                <button class="btn primary" data-act="save">${initial ? 'Save changes' : 'Save'}</button>`,
            onMount(modal, close) {
                const $ = (sel) => modal.querySelector(sel);
                const region = $('#pnRegion'), sub = $('#pnSub'), side = $('#pnSide'), add = $('#pnAdd');
                const redrawAreas = () => { $('#pnAreas').innerHTML = areasHtml(); };

                region.addEventListener('change', () => {
                    const r = P.REGION_BY_ID[region.value];
                    sub.style.display = r && r.subs ? '' : 'none';
                    side.style.display = r && r.sides.length ? '' : 'none';
                    add.style.display = r ? '' : 'none';
                    sub.innerHTML = r && r.subs ? `<option value="">Anywhere</option>${r.subs.map(x => `<option>${escapeHtml(x)}</option>`).join('')}` : '';
                    side.innerHTML = r && r.sides.length ? r.sides.map(x => `<option>${x}</option>`).join('') : '';
                });
                add.addEventListener('click', () => {
                    const r = P.REGION_BY_ID[region.value];
                    if (!r) return;
                    const a = { region: r.id };
                    if (r.subs && sub.value) a.sub = sub.value;
                    if (r.sides.length && side.value) a.side = side.value;
                    if (!areas.some(b => P.areaKey(b) === P.areaKey(a))) areas.push(a);
                    region.value = ''; region.dispatchEvent(new Event('change'));
                    redrawAreas();
                });
                $('#pnAreas').addEventListener('click', e => {
                    const rm = e.target.closest('[data-rm-area]');
                    if (rm) { areas.splice(Number(rm.dataset.rmArea), 1); redrawAreas(); return; }
                    const ad = e.target.closest('[data-add-area]');
                    if (ad) { try { areas.push(JSON.parse(ad.dataset.addArea)); } catch (err) { /* ignore */ } redrawAreas(); }
                });
                $('#pnScore').addEventListener('click', e => {
                    const b = e.target.closest('[data-score]');
                    if (!b) return;
                    score = Number(b.dataset.score);
                    modal.querySelectorAll('#pnScore [data-score]').forEach(x => x.classList.toggle('active', Number(x.dataset.score) === score));
                });
                const single = (grpSel, attr, set) => $(grpSel).addEventListener('click', e => {
                    const b = e.target.closest(`[data-${attr}]`);
                    if (!b) return;
                    const v = b.dataset[attr];
                    const now = set(v);
                    modal.querySelectorAll(`${grpSel} [data-${attr}]`).forEach(x => x.classList.toggle('active', x.dataset[attr] === now));
                });
                single('#pnKind', 'kind', v => (kind = kind === v ? null : v));
                single('#pnCope', 'cope', v => (coping = coping === v ? null : v));
                $('#pnCtx').addEventListener('click', e => {
                    const b = e.target.closest('[data-ctx]');
                    if (!b) return;
                    const v = b.dataset.ctx;
                    context = context.includes(v) ? context.filter(x => x !== v) : context.concat(v);
                    b.classList.toggle('active', context.includes(v));
                });

                $('[data-act="cancel"]').addEventListener('click', close);
                $('[data-act="save"]').addEventListener('click', () => {
                    if (score == null) { toast('Pick how bad it is (0-10)', 'error'); return; }
                    const date = $('#pnDate').value || todayYmd();
                    const time = $('#pnTime').value || nowHm();
                    const ts = new Date(date + 'T' + time).getTime();
                    if (isNaN(ts)) { toast('Invalid date/time', 'error'); return; }
                    const note = $('#pnNote').value.trim();
                    Store().savePain({
                        id: initial ? initial.id : undefined,
                        kind: 'pain', scale, score, areas, timestamp: ts,
                        // A re-rate stays linked to the dose and the pain before it; an
                        // edit keeps whatever links the entry already had.
                        ...(before ? { followsDose: rerate.dose.id, beforeId: before.id } : {}),
                        ...(initial && initial.followsDose ? { followsDose: initial.followsDose, beforeId: initial.beforeId } : {}),
                        ...(kind ? { type: kind } : {}),
                        ...(context.length ? { context } : {}),
                        ...(coping ? { coping } : {}),
                        ...(note ? { note } : {}),
                    });
                    toast(initial ? 'Pain updated' : 'Pain logged');
                    close();
                });
            },
        });
    }

    /**
     * The DVPRS supplemental questions, once a day. Part of the scale: without them it
     * is not the DVPRS. Worded exactly as on the card.
     * @param {object} [initial] an existing check-in
     */
    function painCheckin(initial) {
        const answers = {};
        P.DVPRS_SUPPLEMENTAL.forEach(q => { answers[q.key] = initial && initial[q.key] != null ? Number(initial[q.key]) : null; });
        openModal({
            title: 'Daily pain check-in',
            sub: 'DoD/VA pain supplemental questions (DVPRS)',
            bodyHtml: P.DVPRS_SUPPLEMENTAL.map((q, i) => `
                <div class="field"><label>${i + 1}. ${escapeHtml(P.DVPRS_SUPPLEMENTAL_LEAD)} ${escapeHtml(q.text)}:</label>
                    <div class="pain-levels nrs" data-q="${q.key}">${Array.from({ length: 11 }, (_, n) =>
                        `<button type="button" class="pain-level ${answers[q.key] === n ? 'active' : ''}" data-score="${n}"><span class="pl-num">${n}</span></button>`).join('')}</div>
                    <div class="pain-anchors"><span>${escapeHtml(q.low)}</span><span>${escapeHtml(q.high)}</span></div>
                </div>`).join('') + sourceLine('dvprs'),
            footHtml: `
                <button class="btn ghost" data-act="cancel">Cancel</button>
                <button class="btn primary" data-act="save">Save</button>`,
            onMount(modal, close) {
                modal.addEventListener('click', e => {
                    const b = e.target.closest('[data-q] [data-score]');
                    if (!b) return;
                    const grp = b.closest('[data-q]');
                    answers[grp.dataset.q] = Number(b.dataset.score);
                    grp.querySelectorAll('[data-score]').forEach(x => x.classList.toggle('active', x === b));
                });
                modal.querySelector('[data-act="cancel"]').addEventListener('click', close);
                modal.querySelector('[data-act="save"]').addEventListener('click', () => {
                    if (Object.values(answers).some(v => v == null)) { toast('Answer all four', 'error'); return; }
                    Store().savePain(Object.assign({ id: initial ? initial.id : undefined, kind: 'checkin', scale: 'dvprs',
                        timestamp: initial ? initial.timestamp : Date.now() }, answers));
                    toast('Check-in saved');
                    close();
                });
            },
        });
    }

    Object.assign(window.Modals = window.Modals || {}, { logPain, painCheckin });
})();
