const CACHE = 'alchemist-shop-v3';
const CORE = [
  './',
  './index.html',
  './sandbox.html',
  './public/game.css',
  './public/icons/alchemist.svg',
  './src/game/main.mjs',
  './src/game/contracts.mjs',
  './src/game/world.mjs',
  './src/game/potion.mjs',
  './src/game/brewing.mjs',
  './src/game/cauldron.mjs',
  './src/game/CauldronThermal.mjs',
  './src/reactions/MixtureSolver.mjs',
  './src/game/orders.mjs',
  './src/game/evaluation.mjs',
  './src/game/economy.mjs',
  './src/game/persistence.mjs',
  './src/game/LaboratoryRenderer.mjs',
  './src/game/art.mjs',
  './src/game/audio.mjs',
  './styles.css',
  './public/base.css',
  './public/desktop.css',
  './public/fixes.css',
  './public/manifest.webmanifest',
  './public/icons/icon.svg',
  './src/app/main.mjs',
  './sw.js',
  './public/sw.js'
].map(path => new URL(path, self.registration.scope).href);
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(Promise.all([
    caches.keys().then(keys => Promise.all(keys.filter(key => (key.startsWith('fluid-pocket-') || key.startsWith('alchemist-shop-')) && key !== CACHE).map(key => caches.delete(key)))),
    self.clients.claim()
  ]));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== location.origin || !url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;
  const networkFirst = event.request.mode === 'navigate' || /\.(?:mjs|js|css|html)$/.test(url.pathname);
  if (networkFirst) {
    event.respondWith(fetch(event.request).then(response => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(event.request, copy)).catch(() => {});
      }
      return response;
    }).catch(() => caches.match(event.request)));
    return;
  }
  event.respondWith(caches.match(event.request).then(hit => hit || fetch(event.request).then(response => {
    if (response.ok) {
      const copy = response.clone();
      caches.open(CACHE).then(cache => cache.put(event.request, copy)).catch(() => {});
    }
    return response;
  })));
});


