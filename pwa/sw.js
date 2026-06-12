const CACHE_NAME = 'fraudguard-v14';
const ASET_DI_CACHE = [
    '/',
    '/index.html',
    '/index.css',
    '/index.js',
    '/shared/common.js',
    '/shared/common.css',
    '/cashier/cashier-dashboard.html',
    '/cashier/cashier.css',
    '/cashier/cashier.js',
    '/owner/owner-dashboard.html',
    '/owner/owner.css',
    '/owner/owner.js',
    '/manifest.json',
    '/icon-192x192.png',
    '/icon-512x512.png',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
    'https://cdn.jsdelivr.net/npm/chart.js'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(ASET_DI_CACHE).catch(err => console.error("Cache addAll failed", err)))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheName !== CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// Implementasi Stale-While-Revalidate untuk request GET
self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET' || event.request.url.includes('/api/')) return;

    event.respondWith(
        caches.open(CACHE_NAME).then(cache => {
            return cache.match(event.request).then(response => {
                const fetchPromise = fetch(event.request).then(networkResponse => {
                    // Update cache di background
                    cache.put(event.request, networkResponse.clone());
                    return networkResponse;
                }).catch(() => {
                    // Ignore background fetch error
                });
                // Return cache langsung kalau ada, sambil network fetch jalan di background
                return response || fetchPromise;
            });
        })
    );
});