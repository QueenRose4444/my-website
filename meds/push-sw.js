// push-sw.js — service worker for Web Push notifications.
// The notifications-backend worker sends { title, body, url, tag } payloads;
// this just shows them and opens the app on tap.
self.addEventListener('push', event => {
    let d = {};
    try { d = event.data ? event.data.json() : {}; } catch (e) { d = { title: 'Meds reminder' }; }
    event.waitUntil(self.registration.showNotification(d.title || 'Meds reminder', {
        body: d.body || '',
        tag: d.tag || undefined,
        data: { url: d.url || './' },
        icon: '/images/favicon-96x96.png',
        badge: '/images/favicon-96x96.png',
    }));
});

self.addEventListener('notificationclick', event => {
    event.notification.close();
    const url = (event.notification.data && event.notification.data.url) || './';
    event.waitUntil((async () => {
        const wins = await clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const w of wins) {
            if (w.url.includes('/meds/') && 'focus' in w) return w.focus();
        }
        return clients.openWindow(url);
    })());
});
