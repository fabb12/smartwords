// Scrivia service worker: makes the app installable and usable offline.
// The GitHub Pages build replaces BUILD with the version and the list of built files.
const BUILD = { version: 'dev', files: [] };
const CACHE = 'scrivia-' + BUILD.version;
const SHELL = new URL('./', self.registration.scope).href;
// Hashed scripts, styles, fonts and images never change under the same URL: cache first.
const STATIC = ['script', 'style', 'font', 'image', 'manifest', 'worker'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE)
    .then(cache => Promise.allSettled([SHELL, ...BUILD.files.map(f => new URL(f, self.registration.scope).href)].map(url => cache.add(url))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('scrivia-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  // Documents, keys and AI requests (/api, providers) always go to the network, never to the cache.
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.includes('/api/')) return;
  if (request.mode === 'navigate') {
    // Pages: fresh when online, the last saved copy of the app when offline.
    event.respondWith(fetch(request).then(response => {
      if (response.ok && !response.redirected && url.href.startsWith(SHELL)) { const copy = response.clone(); caches.open(CACHE).then(cache => cache.put(SHELL, copy)); }
      return response;
    }).catch(() => caches.match(request).then(hit => hit || caches.match(SHELL)).then(hit => hit || Response.error())));
    return;
  }
  if (!STATIC.includes(request.destination)) return;
  event.respondWith(caches.match(request).then(hit => hit || fetch(request).then(response => {
    if (response.ok && response.type === 'basic') { const copy = response.clone(); caches.open(CACHE).then(cache => cache.put(request, copy)); }
    return response;
  })));
});
