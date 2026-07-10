// ================================================
// ui.js — icons, DOM helpers, modal + toast framework
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
        pen: svg('<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M9 6h6"/><path d="M9 10h6"/><circle cx="12" cy="17" r="2"/>'),
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
    const $ = (sel, root) => (root || document).querySelector(sel);
    const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

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

    function openModal(opts) {
        // opts: { title, sub, bodyHtml, footHtml, onMount(modalEl, close), wide, noBackdropClose }
        const back = document.createElement('div');
        back.className = 'modal-back';
        back.innerHTML = `
            <div class="modal${opts.wide ? ' wide' : ''}" role="dialog" aria-modal="true">
                <div class="modal-head">
                    <div>
                        <h2>${escapeHtml(opts.title || '')}</h2>
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
            if (opts.onClose) opts.onClose();
        };
        const entry = { back, close, noBackdropClose: opts.noBackdropClose };
        modalStack.push(entry);

        if (!opts.noBackdropClose) {
            back.addEventListener('click', e => { if (e.target === back) close(); });
        }
        const x = back.querySelector('.modal-x');
        if (x) x.addEventListener('click', close);

        if (opts.onMount) opts.onMount(back.querySelector('.modal'), close);
        return close;
    }

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && modalStack.length) {
            const top = modalStack[modalStack.length - 1];
            if (!top.noBackdropClose) top.close();
        }
    });

    function confirmModal(message, opts) {
        return new Promise(resolve => {
            // settle BEFORE close(): close fires onClose, which must not
            // override a yes answer with its cancel default
            let settled = false;
            const done = v => { if (!settled) { settled = true; resolve(v); } };
            openModal({
                title: (opts && opts.title) || 'Are you sure?',
                bodyHtml: `<p class="confirm-text">${escapeHtml(message)}</p>`,
                footHtml: `
                    <button class="btn ghost" data-act="no">Cancel</button>
                    <button class="btn ${opts && opts.danger ? 'danger-solid' : 'primary'}" data-act="yes">${escapeHtml((opts && opts.yesLabel) || 'Confirm')}</button>`,
                onMount(modal, close) {
                    modal.querySelector('[data-act="no"]').addEventListener('click', () => { done(false); close(); });
                    modal.querySelector('[data-act="yes"]').addEventListener('click', () => { done(true); close(); });
                },
                onClose() { done(false); },
            });
        });
    }

    // ------------------------------------------------
    // Toasts
    // ------------------------------------------------
    let toastWrap = null;
    function toast(msg, type) {
        if (!toastWrap) {
            toastWrap = document.createElement('div');
            toastWrap.className = 'toast-wrap';
            document.body.appendChild(toastWrap);
        }
        const t = document.createElement('div');
        t.className = `toast ${type || ''}`;
        t.innerHTML = `${type === 'error' ? Icons.alert : Icons.check}<span>${escapeHtml(msg)}</span>`;
        toastWrap.appendChild(t);
        setTimeout(() => t.classList.add('show'), 10);
        setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3200);
    }

    window.UI = { Icons, $, $$, escapeHtml, on, openModal, confirmModal, toast };
})();
