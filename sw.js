/* オフラインでも練習できるように、アプリ本体だけキャッシュする。録音データは触らない。 */
const CACHE = '432recorder-v1';
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'assets/styles.css',
  'assets/icon.svg',
  'src/app.js',
  'src/audio.js',
  'src/config.js',
  'src/session.js',
  'src/speech.js',
  'src/storage.js',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return;

  // キャッシュを即返しつつ裏で更新する（更新は次回の起動から反映）。
  event.respondWith(
    caches.match(request).then(cached => {
      const network = fetch(request)
        .then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then(cache => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
