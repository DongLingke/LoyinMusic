// 落音 LoyinMusic — Service Worker (offline shell + audio cache)
const CACHE_NAME = 'loyin-v1';
const SHELL = [
  '/',
  '/static/css/style.css',
  '/static/js/app.js',
  '/static/js/sandbox/host.js',
  '/static/js/sandbox/frame.html',
  '/static/js/sandbox/lx-runtime.js',
  '/static/js/vendor/crypto-js.min.js',
  '/static/js/vendor/pako.min.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(names =>
      Promise.all(names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // API calls: network-only (no caching)
  if (url.pathname.startsWith('/api/')) return;
  // Wallpaper images: cache-first
  if (url.pathname.startsWith('/static/wallpapers/')) {
    e.respondWith(
      caches.match(e.request).then(r => r || fetch(e.request).then(resp => {
        const clone = resp.clone();
        caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        return resp;
      }))
    );
    return;
  }
  // Shell resources: cache-first, fallback to network
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});
