// Cache-first service worker. The source lives here; scripts/build.mjs writes
// it next to index.html as sw.js, because browsers only accept a same-origin
// http(s) script URL for a service worker: a Blob/data URL is refused by spec.
// We still try the Blob first (as the brief asks) and fall back to the file.
export const SW_SOURCE = `
const CACHE = 'meadow-eye-v0.1.0';
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', './index.html'])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request).then((res) => {
    if (res.ok) caches.open(CACHE).then((c) => c.put(e.request, res.clone()));
    return res;
  }).catch(() => caches.match('./index.html'))));
});
`;

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return 'unavailable';
  try {
    const url = URL.createObjectURL(new Blob([SW_SOURCE], { type: 'text/javascript' }));
    await navigator.serviceWorker.register(url);
    return 'blob';
  } catch {
    try {
      await navigator.serviceWorker.register('./sw.js', { scope: './' });
      return 'file';
    } catch {
      return 'failed';
    }
  }
}
