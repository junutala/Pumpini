// Minimal, online-only service worker. Two jobs:
//   1) network passthrough — never serve a cached response (the app is online by
//      design); every request goes to the network.
//   2) kill-switch — on activate, delete any Cache Storage left behind by an
//      older service-worker version, so a stale build can't survive on a device.
// Exists primarily to satisfy Android Chrome's PWA installability heuristics.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  const keys = await caches.keys();
  await Promise.all(keys.map((k) => caches.delete(k)));
  await self.clients.claim();
})()));
self.addEventListener('fetch', (e) => { e.respondWith(fetch(e.request)); });
