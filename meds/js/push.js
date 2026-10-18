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
    /**
     * Supply rows for a PRN med.
     *
     * The scheduled path measures supply in DAYS LEFT, which needs a rate of use. An
     * as-needed med has none, so the only honest alert is the one that needs no rate:
     * there is not enough left for a single typical dose. Anything else — "about 3 days
     * left" for something you might take once a month, or not at all — would be a guess
     * presented as a fact.
     *
     * @returns {Array<object>} zero or one scheduled notification
     */
    function prnSupplyRows(med, state, set, now) {
        const alertDays = set.supplyAlertDays != null ? Number(set.supplyAlertDays) : 1;
        if (alertDays <= 0) return []; // supply alerts switched off entirely
        const containers = (state.pens || []).filter(p => p.medId === med.id && !p.exhaustedDate);
        if (!containers.length) return [];

        const remaining = containers.reduce((a, p) => a + Math.max(0, p.capacity - p.used) * (p.dose || 0), 0);
        // What one dose costs: what they usually take, else the smallest they ever take.
        const doseLog = (state.shots || []).filter(x => x.medId === med.id);
        const typical = med.preferredNextDose != null ? med.preferredNextDose
            : (doseLog.length ? doseLog[doseLog.length - 1].dose
                : (med.doses && med.doses.length ? Math.min.apply(null, med.doses) : 0));
        if (!(typical > 0) || remaining >= typical) return [];

        const at = new Date(); at.setHours(10, 0, 0, 0);
        if (at.getTime() <= now) at.setDate(at.getDate() + 1);
        const cn = D.containerName(med);
        return [{
            key: `supply:${med.id}`,
            fireAt: at.getTime(),
            title: `${med.name} — none left`,
            body: `Not enough for a dose when you next need it. Time to pick up a new ${cn}.`,
            url: './', tag: `supply-${med.id}`,
        }];
    }

    /**
     * The action buttons on a dose reminder, and the data the SW hands back.
     *
     * Two buttons only. Chrome renders 2 and `Notification.maxActions` is the real
     * limit; anything past it is dropped SILENTLY, so a third would simply never
     * appear and nobody would know why. Taken and Snooze are the two that save an
     * app-open — "took it at the usual time" and "skip" are both better handled in the
     * app, where the user can see what they are changing.
     *
     * `slotTs` is what makes the deferred write honest: the dose is recorded at the
     * moment it was DUE, not whenever the app next runs.
     */
    function doseActions(med, dose, slotTs) {
        return {
            actions: [
                { action: 'taken', title: 'Taken' },
                { action: 'snooze', title: 'Remind in 15m' },
            ],
            data: { medId: med.id, dose, slotTs },
        };
    }

    /* ── draining the intent queue ─────────────────────────────────────────────
     * The service worker cannot reach the sync API (no localStorage, so no token),
     * so a tapped action is written to IndexedDB as an intent and applied here — on
     * boot, and immediately on postMessage if a tab is already open.
     * See the long comment at the top of push-sw.js for why it works this way. */
    /* ── snoozed reminders ─────────────────────────────────────────────────────
     * The server re-sends a snoozed notification by itself, but the schedule this
     * page uploads REPLACES the whole set and would delete that copy. So a snooze is
     * remembered here, on this device only, and re-emitted by buildSchedule until it
     * fires or the dose is logged (which is also what cancels it). */
    const SNOOZE_KEY = 'meds-snoozes-v1';
    function readSnoozes() {
        try { return JSON.parse(localStorage.getItem(SNOOZE_KEY) || '[]') || []; } catch { return []; }
    }
    function writeSnoozes(list) {
        try { localStorage.setItem(SNOOZE_KEY, JSON.stringify(list)); } catch { /* storage full or blocked */ }
    }
    /** Was the dose this reminder is about logged since it was due? */
    function snoozeDone(sn, state) {
        const app = sn.data || {};
        return (state.shots || []).some(x => (sn.key && x.notifKey === sn.key)
            || (app.medId && x.medId === app.medId && app.slotTs && x.timestamp >= app.slotTs - 3600000));
    }
    function snoozeRows(state, now) {
        return readSnoozes()
            .filter(sn => sn.fireAt > now && !snoozeDone(sn, state))
            .map(sn => ({ key: sn.key, fireAt: sn.fireAt, title: sn.title, body: sn.body,
                url: sn.url || './', tag: sn.tag, actions: sn.actions, data: sn.data }));
    }

    const INTENT_DB = 'meds-intents';
    const INTENT_STORE = 'queue';

    function openIntentDb() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(INTENT_DB, 1);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(INTENT_STORE)) {
                    db.createObjectStore(INTENT_STORE, { keyPath: 'id' });
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    async function drainIntents() {
        if (!window.indexedDB || !window.Store) return 0;
        let db;
        try { db = await openIntentDb(); } catch { return 0; }

        const all = await new Promise(resolve => {
            try {
                const tx = db.transaction(INTENT_STORE, 'readonly');
                const req = tx.objectStore(INTENT_STORE).getAll();
                req.onsuccess = () => resolve(req.result || []);
                req.onerror = () => resolve([]);
            } catch { resolve([]); }
        });
        if (!all.length) { db.close(); return 0; }

        let applied = 0;
        let snoozes = 0;
        const done = [];
        for (const it of all) {
            if (it.action === 'taken' && it.app && it.app.medId) {
                const ok = window.Store.logDoseFromNotification({
                    medId: it.app.medId,
                    dose: it.app.dose,
                    at: it.at,
                    notifKey: it.key,
                });
                if (ok) applied++;
                // Delete either way. A rejected intent (already logged, med deleted) is
                // not going to succeed on a later attempt, and leaving it would retry
                // forever — the de-duplication lives in the Store, not in the queue.
                done.push(it.id);
            } else if (it.action === 'snooze' && it.snoozeUntil > Date.now() && it.notif) {
                const keep = readSnoozes().filter(sn => sn.key !== it.key && sn.fireAt > Date.now());
                keep.push({ key: it.key, fireAt: it.snoozeUntil, data: it.app || null,
                    title: it.notif.title, body: it.notif.body, tag: it.notif.tag,
                    actions: it.notif.actions, url: it.notif.url });
                writeSnoozes(keep);
                snoozes++;
                done.push(it.id);
            } else {
                // Anything unrecognised, or a snooze that has already fired.
                done.push(it.id);
            }
        }

        await new Promise(resolve => {
            try {
                const tx = db.transaction(INTENT_STORE, 'readwrite');
                const store = tx.objectStore(INTENT_STORE);
                done.forEach(id => store.delete(id));
                tx.oncomplete = () => resolve();
                tx.onerror = () => resolve();
            } catch { resolve(); }
        });
        db.close();

        if (snoozes && window.Store.state.settings.pushEnabled) rescheduleDebounced();
        if (applied) {
            if (window.UI && window.UI.toast) {
                window.UI.toast(`${applied} dose${applied === 1 ? '' : 's'} logged from a reminder`);
            }
            if (window.Store.flushToServer) window.Store.flushToServer();
            if (window.App && window.App.render) window.App.render();
        }
        return applied;
    }

    function buildSchedule(state) {
        const now = Date.now();
        const horizon = now + 7 * 86400000;
        const set = state.settings || {};
        const rows = [];

        // Medications switched off: no dose or supply reminders at all.
        for (const med of set.medsTrackingEnabled === false ? [] : (state.meds || [])) {
            // A stopped med has no next dose and no supply to run low, so it gets no
            // reminders. Worth being explicit: this schedule is pushed to the server and
            // fires for up to 7 days, so without this you keep being told to take
            // something you deliberately stopped — for a week after stopping it.
            if (med.stoppedAt) continue;
            // PRN: no interval, so no dose reminder and no "days of supply left" —
            // both need a rate of use that an as-needed med does not have. A reminder
            // to take something you take only when you need it is noise, and guessing
            // a rate to compute days-left would be a made-up number shown as fact.
            // Running out still matters; that is the "not enough for a dose" check
            // below, which needs no rate. The min-gap protection is separate.
            if (D.isPRN(med)) {
                rows.push(...prnSupplyRows(med, state, set, now));
                // The ONE reminder a PRN med can honestly send: not "take this",
                // which it cannot know, but "you asked to be told when you could".
                if (med.remindAt > now && med.remindAt < horizon) {
                    rows.push({
                        key: `allowed:${med.id}:${med.remindAt}`,
                        fireAt: med.remindAt,
                        title: `${med.name} — you can take another`,
                        body: 'You asked to be reminded when the gap was up.',
                        url: './', tag: `allowed-${med.id}`,
                    });
                }
                continue;
            }
            const doseLog = (state.shots || []).filter(x => x.medId === med.id)
                .sort((a, b) => b.timestamp - a.timestamp);
            if (!doseLog.length) continue; // nothing to predict from yet
            const freq = D.freqOf(med);
            const nd = D.predictNextDose(med, doseLog, set);
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
                            // "your before bed dose" beats "your 22:30 dose" on a lock
                            // screen — it is the phrasing the user set it up with.
                            body: `${D.fmtDoseCount(med, dose, state.pens)} — ${D.anchorLabel(sl.anchor)
                                ? `your ${D.anchorLabel(sl.anchor)} dose` : `${D.fmtTimeStr(sl.time, set)} dose`}`,
                            url: './', tag: `dose-${med.id}-${sl.time}`,
                            ...doseActions(med, dose, ts),
                        });
                    }
                }
            } else {
                // interval meds: the predicted dose + the next couple after it
                let ts = new Date(nd.date).getTime();
                for (let i = 0; i < 3 && ts <= horizon; i++) {
                    if (ts > now) {
                        rows.push({
                            // Keyed by the DAY it is due, not its place in this list: a key
                            // like "the next one" is the same every week, and a Taken from
                            // last week would make this week's look like a duplicate.
                            key: `dose:${med.id}:${D.ymd(new Date(ts))}`,
                            fireAt: ts,
                            title: `${med.name} due`,
                            body: `${D.fmtDoseCount(med, nd.dose, state.pens)}${set.shotLocationTrackingEnabled && nd.location && (!med.type || med.type === 'injection') ? ' · ' + nd.location : ''}`,
                            url: './', tag: `dose-${med.id}`,
                            // Taken / Remind in 15m, as on a multi-daily reminder.
                            ...doseActions(med, nd.dose, ts),
                        });
                    }
                    ts += Math.max(0.25, freq) * 86400000;
                }
            }

            // supply-low: measured in total drug amount so split doses and
            // mixed container strengths count correctly
            const alertDays = set.supplyAlertDays != null ? Number(set.supplyAlertDays) : 1;
            const containers = (state.pens || []).filter(p => p.medId === med.id && !p.exhaustedDate);
            if (alertDays > 0 && containers.length) {
                const remaining = containers.reduce((a, p) => a + Math.max(0, p.capacity - p.used) * (p.dose || 0), 0);
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
        // Snoozed reminders are re-sent from here so this upload does not delete them.
        // Their keys are past slots, which the loop above never produces again.
        rows.push(...snoozeRows(state, now));
        // "How is the pain now?" at the moment a pain medicine should be working, for
        // each dose that followed a logged pain. Logging the re-rate removes it.
        if (set.painTrackingEnabled && window.Pain) {
            window.Pain.followUps(state, now, D.medPeakHours, window.Pain.dismissedFollowUps())
                .filter(f => !f.due && f.dueAt < horizon)
                .forEach(f => rows.push({
                    key: `followup:${f.dose.id}`, fireAt: f.dueAt,
                    title: 'How is the pain now?',
                    body: `${f.med.name} should be working by now. Tap to re-rate it.`,
                    url: './', tag: `followup-${f.dose.id}`,
                }));
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

        // Anything tapped on a notification since this app was last open.
        // Unconditional: the queue may hold intents from a session where push was
        // later disabled, and those doses were still really taken.
        drainIntents().catch(() => { });
        if (navigator.serviceWorker) {
            navigator.serviceWorker.addEventListener('message', e => {
                if (e.data && e.data.type === 'meds-intent') drainIntents().catch(() => { });
            });
        }
        // Coming back to a backgrounded tab is the other moment a tap could have
        // happened without this page ever reloading.
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) drainIntents().catch(() => { });
        });
    }
    // app.js registers its DOMContentLoaded first (script order) and runs
    // Store.init synchronously — the timeout puts us safely after it
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 0));

    window.Push = { supported, enable, disable, reschedule, buildSchedule, test, drainIntents, BACKEND };
})();
