const CACHE = 'ravefam-v4';
const PRECACHE = [
  '/',
  '/app.html',
  '/qrcode.min.js',
  '/jsQR.min.js',
  '/manifest.json',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

function isHTMLRequest(req) {
  return req.mode === 'navigate' ||
    (req.headers.get('accept') || '').includes('text/html');
}

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = req.url;
  // Always go to network for Supabase API and external resources
  if (url.includes('supabase.co') || url.includes('fonts.') || url.includes('cdn.')) return;
  if (req.method !== 'GET') return;

  // Network-first for HTML/navigation: the whole app lives in app.html,
  // so this guarantees every new deploy is picked up on reload. We fall
  // back to the cached copy only when the network is unavailable.
  if (isHTMLRequest(req)) {
    e.respondWith(
      fetch(req).then(res => {
        if (res && res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(req, clone));
        }
        return res;
      }).catch(async () =>
        (await caches.match(req)) ||
        (await caches.match('/app.html')) ||
        (await caches.match('/'))
      )
    );
    return;
  }

  // Cache-first for other same-origin static assets (vendor libs, icons).
  e.respondWith(
    caches.match(req).then(cached => cached || fetch(req).then(res => {
      if (res.ok) {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(req, clone));
      }
      return res;
    }))
  );
});
