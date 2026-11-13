// Sovellus toimii ilman verkkoa: tiedostot tallennetaan välimuistiin asennettaessa.
// Nosta versiota, kun tiedostot muuttuvat.
const CACHE = 'tuntilista-v5';
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'parser.js', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// Välimuisti ensin (aukeaa heti myös ilman verkkoa tai huonolla yhteydellä), päivitys taustalla.
// Uusi versio näkyy seuraavalla avauskerralla.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(caches.open(CACHE).then(async (c) => {
    const cached = await c.match(e.request, { ignoreSearch: true });
    const net = fetch(e.request).then((res) => { if (res.ok) c.put(e.request, res.clone()); return res; });
    if (cached) { e.waitUntil(net.catch(() => {})); return cached; }
    return net;
  }));
});
