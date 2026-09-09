const CACHE = 'ravefam-v9';
// jsQR is no longer precached — the app fetches it on demand, and only on
// browsers without BarcodeDetector, so precaching it cost every install ~250KB
// for a decoder most never use. The cache-first handler below still stores it
// the first time someone actually opens the scanner.
const PRECACHE = [
  '/',
  '/app.html',
  '/qrcode.min.js',
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

const PASSTHROUGH_HOSTS = [
  'supabase.co',
  'nominatim.openstreetmap.org',
  'open-meteo.com',
];

// Always go to network for the Supabase API and external resources — includes
// Nominatim (rave location autocomplete + geocoding) and Open-Meteo (rave
// weather chips), whose responses shouldn't be served from the SW cache.
// Matched on the parsed hostname: testing the whole URL for 'cdn.' also matched
// same-origin URLs that merely mentioned it in a path or query string, quietly
// taking them out of the cache.
function isPassthrough(url) {
  let host;
  try { host = new URL(url).hostname; } catch (e) { return false; }
  if (host.startsWith('fonts.') || host.startsWith('cdn.')) return true;
  return PASSTHROUGH_HOSTS.some(h => host === h || host.endsWith('.' + h));
}

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = req.url;
  if (isPassthrough(url)) return;
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

self.addEventListener('push', e => {
  const data = e.data ? e.data.json() : {};
  e.waitUntil(self.registration.showNotification(data.title || 'RaveFAM', {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { crewId: data.crewId, roomId: data.roomId, messageId: data.messageId }
  }));
});

// Same project/anon key app.html uses (SUPA_URL/SUPA_KEY there) -- public by
// design, just enough to call the rate-limited log_push_click RPC.
const SUPA_URL = 'https://tvpgopciioqbqmjjjigh.supabase.co';
const SUPA_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR2cGdvcGNpaW9xYnFtampqaWdoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3NTY2OTUsImV4cCI6MjA5NjMzMjY5NX0.DAgcx2UsGV1gUCQzHdGmv1Pu0rXlJdQxhn-bf1wGsiI';

function logPushClick(messageId, crewId) {
  return fetch(`${SUPA_URL}/rest/v1/rpc/log_push_click`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': SUPA_ANON_KEY, 'Authorization': `Bearer ${SUPA_ANON_KEY}` },
    body: JSON.stringify({ p_message_id: messageId || null, p_crew_id: crewId || null })
  }).catch(() => {});
}

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const { messageId, crewId, roomId } = e.notification.data || {};

  // Carry the notification's target through to the app. A cold start gets it as
  // query params; an already-open window gets it by postMessage, because
  // focusing a client doesn't navigate it — which is why tapping a push used to
  // drop you wherever you happened to be.
  const params = new URLSearchParams();
  if (crewId)    params.set('crew', crewId);
  if (roomId)    params.set('room', roomId);
  if (messageId) params.set('msg', messageId);
  const qs = params.toString();
  const url = qs ? `/app.html?${qs}` : '/app.html';

  e.waitUntil(Promise.all([
    logPushClick(messageId, crewId),
    clients.matchAll({ type: 'window' }).then(list => {
      for (const c of list) {
        if ('focus' in c) {
          if (crewId) c.postMessage({ type: 'rf-huddle-deeplink', crewId, roomId, messageId });
          return c.focus();
        }
      }
      return clients.openWindow(url);
    })
  ]));
});
