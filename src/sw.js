/* Service worker Рубикона: офлайн-доступ к уже открытым страницам и ассетам.
   Версия и список предзагрузки подставляются при сборке (scripts/build.mjs). */
const VERSION = '__VERSION__';
const PRECACHE = __PRECACHE__;
const STATIC = 'rb-static-' + VERSION;
const PAGES = 'rb-pages-' + VERSION;
const scopeUrl = p => new URL(p, self.registration.scope).href;

self.addEventListener('install', event => {
  event.waitUntil(caches.open(STATIC).then(c => Promise.allSettled(PRECACHE.map(u => c.add(scopeUrl(u))))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('rb-') && !k.endsWith(VERSION)).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // API Supabase, шрифты и аналитика — без кэша
  const scope = new URL(self.registration.scope);
  const rel = url.pathname.slice(scope.pathname.length);

  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok) (await caches.open(PAGES)).put(req, res.clone());
        return res;
      } catch {
        const cached = await caches.match(req, { ignoreSearch: true });
        if (cached) return cached;
        const lang = rel.startsWith('uz/') ? 'uz/' : rel.startsWith('en/') ? 'en/' : '';
        return (await caches.match(scopeUrl(lang + 'offline/index.html'))) || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      }
    })());
    return;
  }

  if (rel.startsWith('assets/')) {
    event.respondWith((async () => {
      const cache = await caches.open(STATIC);
      const cached = await cache.match(req, { ignoreSearch: true });
      const network = fetch(req).then(res => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => cached);
      return cached || network;
    })());
  }
});
