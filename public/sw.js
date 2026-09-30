/*
 * Collate's service worker: the app keeps working without a connection.
 * Pages come from the network when there is one (so updates arrive) and from
 * the cache when there is not; the build's files, whose names change with
 * their content, come from the cache first; the PDF library and fonts from
 * their CDNs are kept once used. Documents never pass through here: they are
 * read from disk in the page.
 */
// A new name for each release of this file: the old cache is cleared when it takes over.
const CACHE = 'collate-v2';
const scope = new URL(self.registration.scope);
const PAGES = ['', 'compare/', 'compare/new/', 'compare/sample/', 'samples/', 'guides/', 'guides/documents/', 'guides/images/', 'guides/audio/', 'help/'].map((p) => new URL(p, scope).href);
const CDNS = ['https://cdn.jsdelivr.net', 'https://fonts.googleapis.com', 'https://fonts.gstatic.com', 'https://huggingface.co', 'https://cdn-lfs.huggingface.co'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => Promise.all(PAGES.map((p) => c.add(p).catch(() => undefined))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    return (await cache.match(req, { ignoreSearch: true })) ?? (await cache.match(new URL('compare/', scope).href)) ?? Response.error();
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
  return res;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (req.mode === 'navigate' && url.href.startsWith(scope.href)) e.respondWith(networkFirst(req));
  else if (url.origin === scope.origin && url.pathname.startsWith(`${scope.pathname}_next/static/`)) e.respondWith(cacheFirst(req));
  // The speech model and its runtime: large, and never changed in place.
  else if (url.origin === scope.origin && (url.pathname.startsWith(`${scope.pathname}models/`) || url.pathname.startsWith(`${scope.pathname}ort/`))) e.respondWith(cacheFirst(req));
  // The site's API answers afresh each time, and none of it is kept: whether transcription is there
  // (it isn't, offline), and on a test machine the large samples, hundreds of megabytes each.
  else if (url.origin === scope.origin && url.pathname.startsWith(`${scope.pathname}api/`)) return;
  else if (url.origin === scope.origin && url.href.startsWith(scope.href)) e.respondWith(networkFirst(req));
  else if (CDNS.includes(url.origin)) e.respondWith(cacheFirst(req));
  // Anything else (a cloud drive's files and sign-in) goes straight to the network.
});
