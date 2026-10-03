// Guarda a tela e a lista para abrir sem internet. A lista é buscada de novo
// quando há rede (pode mudar até a véspera); as fotos ficam guardadas conforme
// aparecem.
const CACHE = "santinho-v2";
const BASE = ["./", "index.html", "dados/candidatos.json", "manifest.webmanifest", "icone.svg"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(BASE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  const foto = url.pathname.includes("/fotos/");
  if (foto) {
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(resp => {
      if (resp.ok) { const cp = resp.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); }
      return resp;
    })));
    return;
  }
  // rede primeiro, cache se estiver sem internet
  e.respondWith(fetch(e.request).then(resp => {
    if (resp.ok) { const cp = resp.clone(); caches.open(CACHE).then(c => c.put(e.request, cp)); }
    return resp;
  }).catch(() => caches.match(e.request, {ignoreSearch: true}).then(r => r || caches.match("index.html"))));
});
