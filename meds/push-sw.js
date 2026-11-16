// push-sw.js — service worker for Web Push notifications.
//
// The notifications-backend sends { title, body, url, tag, actions?, data?, key? }.
// This shows it, and handles a tap on an action button WITHOUT opening the app.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THE ACTION IS QUEUED RATHER THAN SENT
//
// A service worker cannot read `localStorage`, and that is where the auth token
// lives. So the SW cannot call the sync API as the user, and "log it without
// opening the app" cannot be done the obvious way.
//
// Instead the tap is written to IndexedDB (which a SW *can* use) as an INTENT, and
// the app drains that queue the next time it runs — on load, and immediately if a
// tab is already open, via postMessage.
//
// The user-visible promise still holds, because the dose is recorded with the
// NOTIFICATION's timestamp, not the app-open time. It is logged at the right
// moment; it just reaches the server when the app next runs.
//
// The alternative — caching a scoped token in IndexedDB at subscribe time so the SW
// could POST directly — was rejected for now: it duplicates op-log logic in a second
// place and can conflict with the app's own state. Worth revisiting only if the
// queue proves insufficient in practice.
// ─────────────────────────────────────────────────────────────────────────────

const DB_NAME = 'meds-intents';
// The snooze endpoint takes no login (this worker has none); each notification
// carries its own one-row token instead. See notifications-backend/snooze.js.
const SNOOZE_URL = 'https://notifications-backend.rosiesite.workers.dev/api/push/snooze';
// "This reminder was dealt with": the server stops repeating it.
const ANSWERED_URL = 'https://notifications-backend.rosiesite.workers.dev/api/push/answered';
// How long "Remind again" waits. The page writes it into each reminder
// (data.snoozeMin) from the person's setting, because this worker cannot read
// settings. A reminder scheduled before that existed carries none, and keeps the
// 15 minutes its own button says.
const SNOOZE_LEGACY_MINUTES = 15;
function snoozeMinutes(nd) {
    const n = Number(nd && nd.app && nd.app.snoozeMin);
    return Number.isFinite(n) && n >= 5 && n <= 120 ? Math.round(n) : SNOOZE_LEGACY_MINUTES;
}
const STORE = 'queue';

function openDb() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE)) {
                // keyPath 'id' is the notification key + action, so the SAME button
                // tapped twice overwrites rather than queuing two doses. A double tap
                // on a phone notification is easy and must not double-log.
                db.createObjectStore(STORE, { keyPath: 'id' });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function queueIntent(intent) {
    const db = await openDb();
    await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(intent);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
    db.close();
}

self.addEventListener('push', event => {
    let d = {};
    try { d = event.data ? event.data.json() : {}; } catch (e) { d = { title: 'Meds reminder' }; }

    // `actions` is capped by the browser — Chrome renders 2, and the real limit is
    // Notification.maxActions. Anything beyond it is dropped silently, so the app
    // sends them in the person's chosen order and the first ones are what shows.
    const max = (self.Notification && self.Notification.maxActions) || 2;
    const actions = Array.isArray(d.actions) ? d.actions.slice(0, max) : undefined;

    event.waitUntil(self.registration.showNotification(d.title || 'Meds reminder', {
        body: d.body || '',
        tag: d.tag || undefined,
        // A repeat of an unanswered reminder has the same tag as the one still on
        // screen and replaces it. Without this the replacement is silent, which is
        // the opposite of what a repeat is for. (Only allowed together with a tag.)
        renotify: !!d.tag,
        actions,
        // Everything the click handler needs has to live HERE — the handler gets the
        // notification, not the original push payload.
        data: { url: d.url || './', key: d.key || null, app: d.data || null, snooze: d.snooze || null,
                answer: d.answer || null, tag: d.tag || null, actions: actions || null },
        icon: '/images/favicon-96x96.png',
        badge: '/images/favicon-96x96.png',
    }));
});

// Tapping a notification may only ever open a page on this site. The URL arrives inside
// the push, so it is checked here as well as on the server that sent it.
function sameSiteUrl(url) {
    try {
        const u = new URL(url || './', self.registration.scope);
        return u.origin === self.location.origin ? u.href : './';
    } catch (e) {
        return './';
    }
}

self.addEventListener('notificationclick', event => {
    const nd = event.notification.data || {};
    const action = event.action;
    event.notification.close();

    // The button-count test from Settings: it exists to be looked at, so a tap on it
    // or on any of its buttons logs nothing, snoozes nothing and opens nothing.
    if (nd.test) return;

    // Tapping the notification body (no action) keeps the old behaviour: open/focus.
    if (!action) {
        event.waitUntil((async () => {
            const wins = await clients.matchAll({ type: 'window', includeUncontrolled: true });
            for (const w of wins) {
                if (w.url.includes('/meds/') && 'focus' in w) return w.focus();
            }
            return clients.openWindow(sameSiteUrl(nd.url));
        })());
        return;
    }

    event.waitUntil((async () => {
        let snoozed = false;
        const minutes = snoozeMinutes(nd);
        if (action === 'snooze') {
            // The server re-sends this notification later; a timer here would die with
            // the worker. The app is also told, so the schedule it next uploads (which
            // replaces the whole set) keeps the snoozed one instead of deleting it.
            let fireAt = null;
            if (nd.snooze && nd.snooze.id && nd.snooze.token) {
                try {
                    const res = await fetch(SNOOZE_URL, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ id: nd.snooze.id, token: nd.snooze.token, minutes }),
                    });
                    if (res.ok) fireAt = (await res.json()).fireAt || null;
                } catch (e) { /* offline: reported below */ }
            }
            snoozed = !!fireAt;
            if (snoozed) {
                await queueIntent({
                    id: (nd.key || 'unknown') + '|snooze',
                    action: 'snooze',
                    key: nd.key || null,
                    app: nd.app || null,
                    at: Date.now(),
                    snoozeUntil: fireAt,
                    notif: { title: event.notification.title, body: event.notification.body,
                             tag: nd.tag, actions: nd.actions, url: nd.url },
                });
            }
        } else {
            await queueIntent({
                id: (nd.key || 'unknown') + '|' + action,
                action,                       // 'taken' | 'skip'
                key: nd.key || null,
                app: nd.app || null,          // { medId, dose, slotTs } for the meds app
                // The moment the DOSE was due, not the moment the app happens to open.
                // This is what keeps the promise honest while the write is deferred.
                at: (nd.app && nd.app.slotTs) || Date.now(),
                tappedAt: Date.now(),
            });
            // Taken or Skip is an answer: tell the server, so it stops repeating this
            // reminder. After the dose is safely queued, never before: the network
            // can be slow. Best effort. If it does not arrive (offline), a repeat may
            // still come, and the app cancels the rest when it next opens; a second
            // Taken on that repeat is not a second dose (same key).
            const cap = nd.answer || nd.snooze;
            if ((action === 'taken' || action === 'skip') && cap && cap.id && cap.token) {
                try {
                    await fetch(ANSWERED_URL, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ id: cap.id, token: cap.token }),
                    });
                } catch (e) { /* offline: see above */ }
            }
        }

        // Tell any open tab immediately so it drains without waiting for a reload.
        const wins = await clients.matchAll({ type: 'window', includeUncontrolled: true });
        wins.forEach(w => w.postMessage({ type: 'meds-intent' }));

        // Confirm silently. Without this the button appears to do nothing at all,
        // which is worse than an extra notification — the user taps again.
        // A failed snooze is always said, open tab or not: silence would read as "done".
        if (action === 'snooze' && !snoozed) {
            await self.registration.showNotification(event.notification.title || 'Meds reminder', {
                body: 'Could not snooze (offline?). Open the app to log it or set a reminder.',
                tag: (nd.tag || nd.key || 'meds') + '-ack',
                icon: '/images/favicon-96x96.png',
                badge: '/images/favicon-96x96.png',
            });
        } else if (!wins.length && (action === 'taken' || action === 'skip' || action === 'snooze')) {
            const label = action === 'taken' ? 'Dose logged'
                : action === 'skip' ? 'Dose skipped' : `Reminder snoozed ${minutes} min`;
            await self.registration.showNotification(label, {
                body: action === 'snooze' ? 'It will come back then.' : 'It will sync next time you open the app.',
                tag: (nd.tag || nd.key || 'meds') + '-ack',
                silent: true,
                icon: '/images/favicon-96x96.png',
                badge: '/images/favicon-96x96.png',
            });
        }
    })());
});
