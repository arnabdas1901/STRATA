const CACHE_NAME = 'strata-v2';
const ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/js/main.js',
  '/js/utils.js',
  '/js/modules/workspace.js',
  '/js/modules/explain.js',
  '/js/modules/search.js',
  '/images/strata-logo.png',
  '/research.html',
  '/screener.html',
  '/correlation.html',
  '/risk-lab.html',
  '/regime.html',
  '/etf.html',
  '/data-center.html'
];

// Install Event - Pre-cache critical app shell files
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Pre-caching app shell');
      return cache.addAll(ASSETS).catch((err) => {
        console.warn('[Service Worker] Pre-caching assets failed, app will cache on-the-fly:', err);
      });
    })
  );
  self.skipWaiting();
});

// Activate Event - Clean up any old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[Service Worker] Clearing old cache:', key);
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch Event - Handle requests with caching strategies
self.addEventListener('fetch', (event) => {
  // 1. Exclude non-GET requests and API requests from cache
  if (event.request.method !== 'GET' || event.request.url.includes('/api/')) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      // 2. Stale-While-Revalidate: serve cached file instantly, fetch & update cache in background
      if (cachedResponse) {
        fetch(event.request)
          .then((networkResponse) => {
            if (networkResponse.status === 200) {
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(event.request, networkResponse);
              });
            }
          })
          .catch(() => {
            // Ignore network errors in background
          });
        return cachedResponse;
      }

      // 3. Network fallback for non-cached items
      return fetch(event.request)
        .then((networkResponse) => {
          if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
            return networkResponse;
          }

          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });

          return networkResponse;
        })
        .catch(() => {
          // 4. Offline Fallback: If offline and requesting an HTML page, serve index.html
          if (event.request.headers.get('accept')?.includes('text/html')) {
            return caches.match('/index.html');
          }
        });
    })
  );
});
