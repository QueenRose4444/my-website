// ================================================
// ui.js — icons, DOM helpers, modal + toast framework,
//         and the small helpers every modal file shares
// ================================================
(function () {
    'use strict';

    // lucide-style inline SVG icons
    const svg = (inner, sw) =>
        `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw || 1.8}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

    const Icons = {
        plus: svg('<path d="M12 5v14M5 12h14"/>', 2),
        syringe: svg('<path d="M18 2l4 4"/><path d="M21 5L9.5 16.5"/><path d="M14 12l-3-3"/><path d="M9.5 16.5L8 18l-3-3 1.5-1.5"/><path d="M5 21l-2-2"/><path d="M8 18l-3 3"/>'),
        scale: svg('<path d="M4 4h16l-2 16H6L4 4z"/><path d="M9 9c.5 1.5 1.5 2 3 2s2.5-.5 3-2"/>'),
        // a jagged spark: the pain row in the Log sheet and the History tab
        pain: svg('<path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z"/>'),
        cal: svg('<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>'),
        chart: svg('<path d="M3 3v18h18"/><path d="M7 14l4-4 4 4 5-5"/>'),
        pill: svg('<path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z"/><path d="m8.5 8.5 7 7"/>'),
        settings: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09A1.65 1.65 0 0 0 15 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>'),
        close: svg('<path d="M18 6L6 18M6 6l12 12"/>', 2),
        chevR: svg('<path d="M9 18l6-6-6-6"/>', 2),
        chevL: svg('<path d="M15 18l-6-6 6-6"/>', 2),
        arrowUp: svg('<path d="M12 19V5M5 12l7-7 7 7"/>', 2),
        arrowDn: svg('<path d="M12 5v14M19 12l-7 7-7-7"/>', 2),
        alert: svg('<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/>'),
        edit: svg('<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>'),
        trash: svg('<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>'),
        check: svg('<path d="M20 6L9 17l-5-5"/>', 2),
        refresh: svg('<path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/>'),
        sun: svg('<circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>'),
        moon: svg('<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>'),
        user: svg('<circle cx="12" cy="7" r="4"/><path d="M5.5 21a6.5 6.5 0 0 1 13 0"/>'),
        bell: svg('<path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>'),
        container: svg('<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M9 6h6"/><path d="M9 10h6"/><circle cx="12" cy="17" r="2"/>'),
        home: svg('<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>'),
        history: svg('<path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><path d="M12 7v5l4 2"/>'),
        cloud: svg('<path d="M17.5 19a4.5 4.5 0 1 0 0-9h-1.13A7 7 0 1 0 5 14.9"/>'),
        cloudOff: svg('<path d="M17.5 19a4.5 4.5 0 1 0 0-9h-1.13A7 7 0 1 0 5 14.9"/><path d="M3 3l18 18"/>'),
        download: svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>'),
        upload: svg('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/>'),
        wand: svg('<path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8L19 13M15 9h.01M17.8 6.2L19 5M11 13l-7.8 7.8a1.4 1.4 0 0 0 2 2L13 15"/><path d="M12.2 6.2L11 5"/>'),
    };

    // ------------------------------------------------
    // tiny DOM helpers
    // ------------------------------------------------
    /**
     * @param {string} sel
     * @param {ParentNode} [root]
     * @returns {HTMLElement} — or null. Every selector used in this app matches an
     *   HTMLElement; `querySelector` is typed as Element only because a selector
     *   could in principle match an SVG node, and none here does.
     */
    const $ = (sel, root) => /** @type {HTMLElement} */ ((root || document).querySelector(sel));
    /**
     * @param {string} sel
     * @param {ParentNode} [root]
     * @returns {HTMLElement[]}
     */
    const $$ = (sel, root) => /** @type {HTMLElement[]} */ (Array.from((root || document).querySelectorAll(sel)));

    const escapeHtml = s => String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    // event delegation: UI.on(container, 'click', '[data-action]', fn)
    function on(root, evt, sel, fn) {
        root.addEventListener(evt, e => {
            const target = e.target.closest(sel);
            if (target && root.contains(target)) fn(e, target);
        });
    }

    // ------------------------------------------------
    // Modal framework — stacked modals, esc + backdrop close
    // ------------------------------------------------
    const modalStack = [];

    let modalSeq = 0;
    let fieldSeq = 0;

    /**
     * Tie each form label to its control, so a screen reader reads the label and a tap
     * on it focuses the field. One pass here instead of a `for=` on every label in every
     * form: a `.field`'s label belongs to the first input, select or textarea in that
     * field. A label that already wraps its control, or already names one, is left alone.
     */
    function linkLabels(root) {
        root.querySelectorAll('.field > label').forEach(label => {
            const l = /** @type {HTMLLabelElement} */ (label);
            if (l.htmlFor || l.querySelector('input, select, textarea')) return;
            const field = l.parentElement;
            const ctl = field && field.querySelector('input:not([type="hidden"]), select, textarea');
            if (!ctl || ctl.closest('label')) return;
            if (!ctl.id) ctl.id = 'fld-' + (++fieldSeq);
            l.htmlFor = ctl.id;
        });
    }
    const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

    function openModal(opts) {
        // opts: { title, sub, bodyHtml, footHtml, onMount(modalEl, close), wide, noBackdropClose }
        // Focus: the dialog itself takes it (an element marked [autofocus] instead, if
        // any), so a screen reader announces it and Tab starts inside it, without
        // popping the phone keyboard on every sheet. Tab stays inside the top dialog,
        // and focus goes back to wherever it was when the dialog closes.
        const opener = /** @type {HTMLElement|null} */ (document.activeElement);
        const titleId = 'modal-title-' + (++modalSeq);
        const back = document.createElement('div');
        back.className = 'modal-back';
        back.innerHTML = `
            <div class="modal${opts.wide ? ' wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="${titleId}" tabindex="-1">
                <div class="modal-head">
                    <div>
                        <h2 id="${titleId}">${escapeHtml(opts.title || '')}</h2>
                        ${opts.sub ? `<div class="modal-sub">${escapeHtml(opts.sub)}</div>` : ''}
                    </div>
                    ${opts.noClose ? '' : `<button class="icon-btn modal-x" aria-label="Close">${Icons.close}</button>`}
                </div>
                <div class="modal-body">${opts.bodyHtml || ''}</div>
                ${opts.footHtml ? `<div class="modal-foot">${opts.footHtml}</div>` : ''}
            </div>`;
        document.body.appendChild(back);
        document.body.classList.add('modal-open');

        const close = () => {
            const i = modalStack.indexOf(entry);
            if (i >= 0) modalStack.splice(i, 1);
            back.remove();
            if (modalStack.length === 0) document.body.classList.remove('modal-open');
            if (opener && opener.isConnected && typeof opener.focus === 'function') {
                try { opener.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
            }
            if (opts.onClose) opts.onClose();
        };
        const entry = { back, close, noBackdropClose: opts.noBackdropClose };
        modalStack.push(entry);

        if (!opts.noBackdropClose) {
            back.addEventListener('click', e => { if (e.target === back) close(); });
        }
        const x = back.querySelector('.modal-x');
        if (x) x.addEventListener('click', close);

        const dialog = /** @type {HTMLElement} */ (back.querySelector('.modal'));
        if (opts.onMount) opts.onMount(dialog, close);
        linkLabels(dialog);
        const auto = /** @type {HTMLElement|null} */ (dialog.querySelector('[autofocus]'));
        try { (auto || dialog).focus({ preventScroll: true }); } catch (e) { /* ignore */ }
        return close;
    }

    document.addEventListener('keydown', e => {
        if (!modalStack.length) return;
        const top = modalStack[modalStack.length - 1];
        if (e.key === 'Escape') {
            if (!top.noBackdropClose) top.close();
            return;
        }
        if (e.key !== 'Tab') return;
        const dialog = /** @type {HTMLElement} */ (top.back.querySelector('.modal'));
        const items = /** @type {HTMLElement[]} */ ([...dialog.querySelectorAll(FOCUSABLE)]).filter(el => el.offsetParent !== null);
        if (!items.length) { e.preventDefault(); dialog.focus(); return; }
        const first = items[0], last = items[items.length - 1];
        const inside = dialog.contains(document.activeElement);
        if (e.shiftKey && (document.activeElement === first || !inside || document.activeElement === dialog)) {
            e.preventDefault(); last.focus();
        } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
            e.preventDefault(); first.focus();
        }
    });

    /**
     * Ask a yes/no question, optionally with a third, gentler answer.
     *
     * @param {string} message   blank lines become paragraph breaks
     * @param {object} [opts]
     * @param {string} [opts.title]
     * @param {string} [opts.yesLabel]
     * @param {boolean} [opts.danger]   red confirm button
     * @param {string} [opts.altLabel]  adds a THIRD button that resolves `'alt'`.
     *        For "you probably want this safer thing instead" — offered at the moment
     *        the user is about to do the destructive one, which is the only moment
     *        they will read it.
     * @returns {Promise<boolean|'alt'>}
     *
     * ⚠ `'alt'` is truthy. A caller that passes `altLabel` must test it explicitly
     * (`=== 'alt'` / `=== true`) rather than relying on `if (await confirmModal(…))`.
     * Callers that do not pass `altLabel` never see it and are unaffected.
     */
    function confirmModal(message, opts) {
        return new Promise(resolve => {
            // settle BEFORE close(): close fires onClose, which must not
            // override a yes answer with its cancel default
            let settled = false;
            const done = v => { if (!settled) { settled = true; resolve(v); } };
            const alt = opts && opts.altLabel;
            // Escape first, THEN build the paragraphs — the other order would let a
            // message containing markup close the tag it is escaped into.
            const paras = escapeHtml(message).split(/\n{2,}/)
                .map(p => `<p class="confirm-text">${p.replace(/\n/g, '<br>')}</p>`).join('');
            openModal({
                title: (opts && opts.title) || 'Are you sure?',
                bodyHtml: paras,
                footHtml: `
                    <button class="btn ghost" data-act="no">Cancel</button>
                    ${alt ? `<button class="btn" data-act="alt">${escapeHtml(alt)}</button>` : ''}
                    <button class="btn ${opts && opts.danger ? 'danger-solid' : 'primary'}" data-act="yes">${escapeHtml((opts && opts.yesLabel) || 'Confirm')}</button>`,
                onMount(modal, close) {
                    modal.querySelector('[data-act="no"]').addEventListener('click', () => { done(false); close(); });
                    modal.querySelector('[data-act="yes"]').addEventListener('click', () => { done(true); close(); });
                    const altBtn = modal.querySelector('[data-act="alt"]');
                    if (altBtn) altBtn.addEventListener('click', () => { done('alt'); close(); });
                },
                onClose() { done(false); },
            });
        });
    }

    // ------------------------------------------------
    // Toasts
    // ------------------------------------------------
    let toastWrap = null;

    /**
     * A toast, optionally with actions.
     *
     * @param {string} msg
     * @param {string} [type]                    '' | 'error'
     * @param {object} [opts]
     * @param {number} [opts.duration]           ms on screen (default 3200)
     * @param {Array<{label:string, act:Function, primary?:boolean}>} [opts.actions]
     * @param {Function} [opts.onDismiss]        run when it goes without an action
     *        being chosen — timing out, or being clicked away. This is what makes a
     *        toast safe for "Confirm / Revert": IGNORING IT MUST BE THE HARMLESS
     *        ANSWER, so onDismiss is only ever the confirm side.
     */
    function toast(msg, type, opts) {
        opts = opts || {};
        if (!toastWrap) {
            toastWrap = document.createElement('div');
            toastWrap.className = 'toast-wrap';
            document.body.appendChild(toastWrap);
        }
        const actions = Array.isArray(opts.actions) ? opts.actions : [];
        const t = document.createElement('div');
        t.className = `toast ${type || ''}${actions.length ? ' has-actions' : ''}`;
        t.innerHTML = `${type === 'error' ? Icons.alert : Icons.check}<span>${escapeHtml(msg)}</span>`;

        let settled = false;
        const dismiss = (chosen) => {
            if (settled) return;
            settled = true;
            t.classList.remove('show');
            setTimeout(() => t.remove(), 300);
            if (!chosen && opts.onDismiss) { try { opts.onDismiss(); } catch (e) { console.error(e); } }
        };

        if (actions.length) {
            // Buttons need pointer events; the wrapper deliberately has none so a
            // plain toast never blocks the page underneath.
            t.style.pointerEvents = 'auto';
            const row = document.createElement('span');
            row.className = 'toast-acts';
            actions.forEach(a => {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = `toast-act${a.primary ? ' primary' : ''}`;
                b.textContent = a.label;
                b.addEventListener('click', (e) => {
                    e.stopPropagation();
                    dismiss(true);
                    try { a.act(); } catch (err) { console.error(err); }
                });
                row.appendChild(b);
            });
            t.appendChild(row);
            // Clicking the toast itself (not a button) is a dismissal, which is the
            // same as confirming.
            t.addEventListener('click', () => dismiss(false));
        }

        toastWrap.appendChild(t);
        setTimeout(() => t.classList.add('show'), 10);
        setTimeout(() => dismiss(false), opts.duration || 3200);
    }

    // ------------------------------------------------
    // Shared small helpers
    // ------------------------------------------------
    // These live here rather than in any one modal file because all five need them, and a
    // helper copied into five files is a helper that will be fixed in one of them.

    const todayYmd = () => window.MedData.ymd(new Date());
    const nowHm = () => window.MedData.hm(new Date());

    const uid = p => p + '-' + Date.now() + '-' + Math.floor(Math.random() * 9999);

    /**
     * A link target from DATA (a med's source, an imported substance), or '#'.
     * Only http(s): a `javascript:` URL in an imported backup would otherwise run when
     * tapped, and escaping the attribute does not stop that.
     */
    const safeUrl = (u) => (typeof u === 'string' && /^https?:\/\//i.test(u.trim())) ? u.trim() : '#';

    /** "just now" / "12 minutes ago" / "3 hours ago" / "2 days ago" */
    function whenAgo(at) {
        const ms = Date.now() - (Number(at) || 0);
        if (!isFinite(ms) || ms < 0) return 'just now';
        const mins = Math.floor(ms / 60000);
        if (mins < 1) return 'just now';
        if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
        const hours = Math.floor(mins / 60);
        if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
        const days = Math.floor(hours / 24);
        return `${days} day${days === 1 ? '' : 's'} ago`;
    }

    // keep default date/time inputs ticking with the real clock until the user
    // touches them — people open the modal, get distracted, and log later
    function liveClock(modal, dateSel, timeSel) {
        const dateEl = modal.querySelector(dateSel);
        const timeEl = modal.querySelector(timeSel);
        if (!dateEl || !timeEl) return;
        let touched = false;
        [dateEl, timeEl].forEach(el => {
            el.addEventListener('input', () => { touched = true; });
            el.addEventListener('change', () => { touched = true; });
        });
        const iv = setInterval(() => {
            if (!document.contains(timeEl)) { clearInterval(iv); return; }
            if (touched || document.activeElement === timeEl || document.activeElement === dateEl) return;
            timeEl.value = nowHm();
            dateEl.value = todayYmd();
        }, 15000);
    }

    window.UI = { Icons, $, $$, escapeHtml, on, openModal, confirmModal, toast,
        todayYmd, nowHm, uid, whenAgo, liveClock, safeUrl };
})();
