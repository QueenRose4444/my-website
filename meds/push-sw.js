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
const SNOOZE_MINUTES = 15;
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
    // sends its two most useful and leaves the rest to the UI.
    const max = (self.Notification && self.Notification.maxActions) || 2;
    const actions = Array.isArray(d.actions) ? d.actions.slice(0, max) : undefined;

    event.waitUntil(self.registration.showNotification(d.title || 'Meds reminder', {
        body: d.body || '',
        tag: d.tag || undefined,
        actions,
        // Everything the click handler needs has to live HERE — the handler gets the
        // notification, not the original push payload.
        data: { url: d.url || './', key: d.key || null, app: d.data || null, snooze: d.snooze || null,
                tag: d.tag || null, actions: actions || null },
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
                        body: JSON.stringify({ id: nd.snooze.id, token: nd.snooze.token, minutes: SNOOZE_MINUTES }),
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
        } else if (!wins.length && action !== 'skip') {
            const label = action === 'taken' ? 'Dose logged' : `Reminder snoozed ${SNOOZE_MINUTES} min`;
            await self.registration.showNotification(label, {
                body: action === 'taken' ? 'It will sync next time you open the app.' : 'It will come back then.',
                tag: (nd.tag || nd.key || 'meds') + '-ack',
                silent: true,
                icon: '/images/favicon-96x96.png',
                badge: '/images/favicon-96x96.png',
            });
        }
    })());
});
