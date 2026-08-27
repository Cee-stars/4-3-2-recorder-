/* オフラインでも練習できるように、アプリ本体だけキャッシュする。録音データは触らない。 */
const CACHE = '432recorder-v3';
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
  'src/transfer.js',
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
  event.respondWith(networkFirst(request));
});

/**
 * まずネットワークを見て、取れたらキャッシュを更新する。
 * キャッシュ優先だと更新後の 1 回目がいつも古い版になり、
 * 直したはずのものが直っていないように見えるため。
 * オフラインのときだけキャッシュを返す。
 */
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (request.mode === 'navigate') {
      const shell = await caches.match('index.html');
      if (shell) return shell;
    }
    throw err;
  }
}
