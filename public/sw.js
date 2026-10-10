// 簡單的 service worker：介面檔案先用快取，rain.json、weather.json 一律先抓網路（離線時才用舊資料）。
const CACHE = 'rainapp-v3';
const SHELL = ['./', 'index.html', 'app.js', 'style.css', 'manifest.json', 'icon-192.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.endsWith('.json') && !url.pathname.endsWith('manifest.json')) {
    e.respondWith(fetch(e.request).then((r) => { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(url.pathname, cp)); return r; })
      .catch(() => caches.match(url.pathname)));
    return;
  }
  e.respondWith(fetch(e.request).then((r) => { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, cp)); return r; })
    .catch(() => caches.match(e.request)));
});
