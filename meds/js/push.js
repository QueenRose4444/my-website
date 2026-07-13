// ================================================
// push.js — Web Push client for the notifications-backend worker.
// Builds the next ~7 days of dose + supply-low reminders from local
// state and replaces the server-side schedule whenever state changes.
// Requires a signed-in account (the worker verifies the same JWT).
// ================================================
(function () {
    'use strict';
    const D = window.MedData;
    const BACKEND = 'https://notifications-backend.rosiesite.workers.dev';
    const APP = 'med-tracker-v2';

    const supported = () =>
        'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

    // pushManager.subscribe wants the VAPID key as bytes (Firefox insists)
    function b64uToU8(s) {
        s = s.replace(/-/g, '+').replace(/_/g, '/');
        while (s.length % 4) s += '=';
        const bin = atob(s);
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
    }

    async function api(path, body) {
        const S = window.Store;
        const res = await S.auth.fetchWithAuth(BACKEND + path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        let data = {};
        try { data = await res.json(); } catch (e) { /* non-json error */ }
        if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
        return data;
    }

    const swReg = () => navigator.serviceWorker.register('push-sw.js');

    async function enable() {
        const S = window.Store;
        if (!supported()) throw new Error('This browser can\'t do push notifications' + (/iPhone|iPad/.test(navigator.userAgent) ? ' — on iOS, add the site to your Home Screen first' : ''));
        if (!S.isLoggedIn()) throw new Error('Sign in first — reminders need your account');
        const perm = await Notification.requestPermission();
        if (perm !== 'granted') throw new Error('Notifications are blocked for this site');
        const reg = await swReg();
        const { key } = await (await fetch(BACKEND + '/api/push/vapid-public-key')).json();
        const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uToU8(key) });
        await api('/api/push/subscribe', { app: APP, subscription: sub.toJSON() });
        S.update(s => { s.settings.pushEnabled = true; });
        await reschedule(true);
    }

    async function disable() {
        const S = window.Store;
        try {
            const reg = await navigator.serviceWorker.getRegistration('push-sw.js');
            const sub = reg && await reg.pushManager.getSubscription();
            if (sub) {
                try { await api('/api/push/unsubscribe', { endpoint: sub.endpoint }); } catch (e) { /* best effort */ }
                await sub.unsubscribe();
            }
        } catch (e) { console.warn('push disable:', e); }
        S.update(s => { s.settings.pushEnabled = false; });
    }

    // ------------------------------------------------
    // Schedule builder — pure(ish): state in, notification rows out.
    // One row per upcoming dose (per SLOT for multi-daily meds, with that
    // slot's dose) plus a daily 10:00 supply-low reminder for any med whose
    // remaining supply covers ≤ settings.supplyAlertDays days of use (or
    // can't even serve the next dose).
    // ------------------------------------------------
    function buildSchedule(state) {
        const now = Date.now();
        const horizon = now + 7 * 86400000;
        const set = state.settings || {};
        const rows = [];

        for (const med of state.meds || []) {
            const shots = (state.shots || []).filter(x => x.medId === med.id)
                .sort((a, b) => b.timestamp - a.timestamp);
            if (!shots.length) continue; // nothing to predict from yet
            const freq = med.frequency || 7;
            const nd = D.predictNextDose(med, shots, set);
            if (!nd) continue;
            const slots = D.getScheduleSlots(med);

            if (freq < 0.95 && slots.length >= 2) {
                // multi-daily: every slot on every day in the window
                const startDay = new Date(); startDay.setHours(0, 0, 0, 0);
                for (let day = 0; day <= 7; day++) {
                    for (const sl of slots) {
                        const ymdStr = D.ymd(D.addDays(startDay, day));
                        const ts = new Date(ymdStr + 'T' + sl.time).getTime();
                        if (isNaN(ts) || ts <= now || ts > horizon) continue;
                        const dose = sl.dose != null ? sl.dose : nd.dose;
                        rows.push({
                            key: `dose:${med.id}:${ymdStr}:${sl.time}`,
                            fireAt: ts,
                            title: `${med.name} due`,
                            body: `${D.fmtDoseCount(med, dose, state.pens)} — ${D.fmtTimeStr(sl.time, set)} dose`,
                            url: './', tag: `dose-${med.id}-${sl.time}`,
                        });
                    }
                }
            } else {
                // interval meds: the predicted dose + the next couple after it
                let ts = new Date(nd.date).getTime();
                for (let i = 0; i < 3 && ts <= horizon; i++) {
                    if (ts > now) {
                        rows.push({
                            key: `dose:${med.id}:${i}`,
                            fireAt: ts,
                            title: `${med.name} due`,
                            body: `${D.fmtDoseCount(med, nd.dose, state.pens)}${set.shotLocationTrackingEnabled && nd.location && (!med.type || med.type === 'injection') ? ' · ' + nd.location : ''}`,
                            url: './', tag: `dose-${med.id}`,
                        });
                    }
                    ts += Math.max(0.25, freq) * 86400000;
                }
            }

            // supply-low: measured in total drug amount so split doses and
            // mixed container strengths count correctly
            const alertDays = set.supplyAlertDays != null ? Number(set.supplyAlertDays) : 1;
            const pens = (state.pens || []).filter(p => p.medId === med.id && !p.exhaustedDate);
            if (alertDays > 0 && pens.length) {
                const remaining = pens.reduce((a, p) => a + Math.max(0, p.capacity - p.used) * (p.dose || 0), 0);
                const dailyUse = (freq < 0.95 && slots.length >= 2)
                    ? slots.reduce((a, sl) => a + (sl.dose != null ? sl.dose : nd.dose || 0), 0)
                    : (nd.dose || 0) / Math.max(freq, 1 / 24);
                const daysLeft = dailyUse > 0 ? remaining / dailyUse : Infinity;
                if (daysLeft <= alertDays || remaining < (nd.dose || 0)) {
                    const at = new Date(); at.setHours(10, 0, 0, 0);
                    if (at.getTime() <= now) at.setDate(at.getDate() + 1);
                    const cn = D.containerName(med);
                    rows.push({
                        key: `supply:${med.id}`,
                        fireAt: at.getTime(),
                        title: `${med.name} — supply low`,
                        body: remaining < (nd.dose || 0)
                            ? `Not enough left for your next dose. Time to pick up a new ${cn}.`
                            : `About ${daysLeft < 1 ? D.fmtDur(daysLeft) : `${Math.round(daysLeft * 10) / 10} day${daysLeft >= 0.95 && daysLeft < 1.05 ? '' : 's'}`} of doses left. Time to pick up a new ${cn}.`,
                        url: './', tag: `supply-${med.id}`,
                    });
                }
            }
        }
        rows.sort((a, b) => a.fireAt - b.fireAt);
        return rows.slice(0, 64);
    }

    async function reschedule(force) {
        const S = window.Store;
        if (!S || (!force && !S.state.settings.pushEnabled)) return;
        if (!S.isLoggedIn()) return;
        try {
            await api('/api/push/schedule', { app: APP, notifications: buildSchedule(S.state) });
        } catch (e) { console.warn('push schedule failed:', e.message); }
    }

    let debounceT = null;
    function rescheduleDebounced() {
        clearTimeout(debounceT);
        debounceT = setTimeout(() => reschedule(), 3000);
    }

    const test = () => api('/api/push/test', { app: APP });

    function init() {
        const S = window.Store;
        if (!S) return;
        S.onChange(what => {
            if (what !== 'sync' && S.state.settings.pushEnabled) rescheduleDebounced();
        });
        // keep the subscription + schedule fresh on every boot
        if (S.state.settings.pushEnabled && supported() && Notification.permission === 'granted') {
            swReg().then(() => rescheduleDebounced()).catch(() => { });
        }
    }
    // app.js registers its DOMContentLoaded first (script order) and runs
    // Store.init synchronously — the timeout puts us safely after it
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 0));

    window.Push = { supported, enable, disable, reschedule, buildSchedule, test, BACKEND };
})();
