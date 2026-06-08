// TAHAP 7 - Lapisan offline-first (PWA).

const DB_NAME = "fraudguard_local";
const DB_VERSION = 1;
const API_BASE = "http://127.0.0.1:5000/api";

// Inisialisasi IndexedDB 
function openDB() {
    let req;
    let janjiBukaDB;

    janjiBukaDB = new Promise((resolve, reject) => {
        req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
            let db;
            let store;

            db = e.target.result;
            store = db.createObjectStore("transactions", { keyPath: "id" });
            store.createIndex("is_synced", "is_synced", { unique: false });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });

    return janjiBukaDB;
}

// Simpan transaksi baru (offline-first) 
async function saveTransaction(txn) {
    let db;
    let store;

    db = await openDB();
    store = db.transaction("transactions", "readwrite").objectStore("transactions");

    txn.id = crypto.randomUUID(); // UUID unik lokal (anti duplikasi)
    txn.is_synced = 0;            // belum tersinkron
    store.put(txn);

    console.log(`Transaksi disimpan lokal: ${txn.id}`);
}

// Ambil transaksi yang belum tersinkron 
async function getUnsyncedTransactions() {
    let db;
    let janjiAmbil;

    db = await openDB();
    janjiAmbil = new Promise((resolve) => {
        let store;
        let req;

        store = db.transaction("transactions", "readonly").objectStore("transactions");
        req = store.index("is_synced").getAll(0);
        req.onsuccess = () => resolve(req.result);
    });

    return janjiAmbil;
}

// Sinkronisasi (Simpan ke DB) + Skoring
async function syncAndScore() {
    // Deklarasi variabel terlebih dahulu
    let unsynced;
    let responsSimpan;
    let responsScore;
    let resultScore;
    let db;
    let i;
    let txn;
    let store;

    if (!navigator.onLine) {
        console.log("Offline - sinkronisasi ditunda");
        return;
    }

    unsynced = await getUnsyncedTransactions();

    if (unsynced.length === 0) return;

    console.log(`Menyimpan ${unsynced.length} transaksi ke server...`);

    try {
        // TAHAP 1: Simpan transaksi ke database backend (SQLite)
        responsSimpan = await fetch(`${API_BASE}/transactions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ transactions: unsynced }),
        });

        if (responsSimpan.ok) {
            console.log("Berhasil disimpan. Memulai proses scoring...");

            // TAHAP 2: Perintahkan backend untuk menilai (score) data di database
            responsScore = await fetch(`${API_BASE}/batch-score`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({})
            });

            resultScore = await responsScore.json();

            if (resultScore.status === "success") {
                db = await openDB();

                // TAHAP 3: Tandai data lokal sebagai "sudah tersinkron"
                for (i = 0; i < unsynced.length; i++) {
                    txn = unsynced[i];
                    store = db.transaction("transactions", "readwrite").objectStore("transactions");
                    txn.is_synced = 1;
                    store.put(txn);
                }

                // TAHAP 4: Perbarui antarmuka web
                handleReviewFlags(resultScore.review);
                updateDashboard(resultScore);

                console.log(`Selesai! ${resultScore.scored_count} transaksi dinilai.`);
            }
        }
    } catch (err) {
        console.error("Gagal sinkronisasi:", err);
    }
}

// Penyesuaian 3: tandai untuk ditinjau, JANGAN vonis otomatis
function handleReviewFlags(review) {
    let i;
    let f;

    if (!review || !review.flags) return;

    for (i = 0; i < review.flags.length; i++) {
        f = review.flags[i];

        // Perbaikan operator ===
        if (f.action === "REQUEST_AUTHORIZATION") {
            showAlert(`[PERLU TINJAUAN] ${f.message} (skor ${f.fraud_score})`, "critical");
            markForReview(f.transaction_id, "need_authorization");
        } else if (f.action === "NOTIFY_FOR_REVIEW") {
            showAlert(`[PERHATIAN] ${f.message} (skor ${f.fraud_score})`, "warning");
            markForReview(f.transaction_id, "notify");
        }
    }
}

// Menandai transaksi di UI sebagai "perlu ditinjau" (bukan memblokir kasir).
function markForReview(txnId, level) {
    let el;

    el = document.querySelector(`[data-txn-id="${txnId}"]`);
    if (el) {
        el.classList.add("flagged-review", level);
        el.title = "Ditandai untuk ditinjau pemilik/supervisor";
    }
}

// Pemicu otomatis 
window.addEventListener("online", () => {
    console.log("Koneksi tersambung - memulai sinkronisasi...");
    syncAndScore();
});

setInterval(syncAndScore, 60000); // cek tiap 60 detik (mengubah 60_000 untuk kompatibilitas browser lama)