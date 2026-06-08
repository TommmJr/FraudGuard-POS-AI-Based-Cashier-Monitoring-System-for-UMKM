const NAMA_CACHE = 'fraudguard-v1';

// Daftar file yang wajib di-cache untuk tampilan offline dasar
const ASET_DI_CACHE = [
    './',
    './index.html',
    './style.css',
    './app.js',
    './db.js',
    './manifest.json'
];

// 1. Fase Install: Menyimpan aset ke cache
self.addEventListener('install', function (event) {
    // Deklarasi variabel terlebih dahulu
    let janjiCache;

    janjiCache = caches.open(NAMA_CACHE).then(function (cache) {
        console.log('Service Worker: Menyimpan aset ke cache...');
        return cache.addAll(ASET_DI_CACHE);
    });

    event.waitUntil(janjiCache);
});

// 2. Fase Activate: Membersihkan cache lama
self.addEventListener('activate', function (event) {
    // Deklarasi variabel terlebih dahulu
    let daftarCacheAktif;
    let janjiPembersihan;

    daftarCacheAktif = [NAMA_CACHE];

    janjiPembersihan = caches.keys().then(function (namaNamaCache) {
        let janjiHapusCache;

        janjiHapusCache = namaNamaCache.map(function (namaCache) {
            let apakahCacheLama;

            apakahCacheLama = daftarCacheAktif.indexOf(namaCache) === -1;

            if (apakahCacheLama) {
                console.log('Service Worker: Menghapus cache lama', namaCache);
                return caches.delete(namaCache);
            }
        });

        return Promise.all(janjiHapusCache);
    });

    event.waitUntil(janjiPembersihan);
});

// 3. Fase Fetch: Melayani permintaan dari cache jika offline
self.addEventListener('fetch', function (event) {
    // Deklarasi variabel terlebih dahulu
    let apakahPermintaanAPI;
    let janjiAmbilData;

    apakahPermintaanAPI = event.request.url.includes('/api/');

    // Jika request mengarah ke API Flask backend, kita biarkan saja (jangan di-cache di sini)
    // karena PWA akan memakai db.js (IndexedDB) untuk menangani data transaksi API
    if (apakahPermintaanAPI) {
        return;
    }

    // Strategi "Cache First" untuk aset statis (HTML, CSS, JS)
    janjiAmbilData = caches.match(event.request).then(function (response) {
        let salinanPermintaan;

        // Jika file ditemukan di cache, langsung kembalikan file tersebut
        if (response) {
            return response;
        }

        // Jika tidak ada di cache, coba ambil dari internet
        salinanPermintaan = event.request.clone();
        return fetch(salinanPermintaan);
    });

    event.respondWith(janjiAmbilData);
});