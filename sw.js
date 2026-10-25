// Service worker: cache-first for the app shell, network-first for
// everything else (arXiv responses are cached too, so the last feed
// works offline). Bump VERSION when shell files change.
const VERSION = 'v4';
const SHELL = [
  './', './index.html', './manifest.webmanifest',
  './src/main.js', './src/feed.js', './src/arxiv.js', './src/math.js', './src/app.css',
  './features/likes.js', './features/reader.js', './features/hooks.js', './features/reader.css',
  './design/tokens.css', './design/components.css', './design/overrides.css',
  './design/icons/icon-192.png', './design/icons/apple-touch-icon.png', './design/icons/favicon-32.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  e.respondWith(fetch(req).then((res) => {
    if (res.ok && (res.type === 'basic' || res.type === 'cors')) {
      const copy = res.clone();
      caches.open(VERSION).then((c) => c.put(req, copy));
    }
    return res;
  }).catch(() => caches.match(req).then((hit) => hit || Promise.reject(new Error('offline')))));
});
