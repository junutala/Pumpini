// Minimal service worker: network passthrough. Exists to satisfy Android
// Chrome's PWA installability heuristics — it does not cache or alter
// any request (the app is online-only by design).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  e.respondWith(fetch(e.request));
});
