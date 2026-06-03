
//  FraudGuard - pwa/db.js
//  TAHAP 7 - Lapisan offline-first (PWA).


const DB_NAME = "fraudguard_local";
const DB_VERSION = 1;
const API_BASE = "http://localhost:5000/api";

//  Inisialisasi IndexedDB 
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      const store = db.createObjectStore("transactions", { keyPath: "id" });
      store.createIndex("is_synced", "is_synced", { unique: false });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

//  Simpan transaksi baru (offline-first) 
async function saveTransaction(txn) {
  const db = await openDB();
  const store = db.transaction("transactions", "readwrite").objectStore("transactions");
  txn.id = crypto.randomUUID(); // UUID unik lokal (anti duplikasi)
  txn.is_synced = 0;                   // belum tersinkron
  store.put(txn);
  console.log(`Transaksi disimpan lokal: ${txn.id}`);
}

//  Ambil transaksi yang belum tersinkron 
async function getUnsyncedTransactions() {
  const db = await openDB();
  return new Promise((resolve) => {
    const store = db.transaction("transactions", "readonly").objectStore("transactions");
    const req = store.index("is_synced").getAll(0);
    req.onsuccess = () => resolve(req.result);
  });
}

//  Sinkron + skoring 
async function syncAndScore() {
  if (!navigator.onLine) {
    console.log("Offline - sinkronisasi ditunda");
    return;
  }
  const unsynced = await getUnsyncedTransactions();
  if (unsynced.length   0) return;

  console.log(`Menyinkronkan ${unsynced.length} transaksi...`);
  try {
    const res = await fetch(`${API_BASE}/score`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transactions: unsynced }),
    });
    const result = await res.json();

    if (result.status   "success") {
      // Tandai semua sudah tersinkron
      const db = await openDB();
      for (const txn of unsynced) {
        const store = db.transaction("transactions", "readwrite").objectStore("transactions");
        txn.is_synced = 1;
        store.put(txn);
      }
      handleReviewFlags(result.review);   // penyesuaian 3
      updateDashboard(result.scored);
      console.log(`Sinkron berhasil. ${result.review.total_flagged} transaksi ditandai untuk ditinjau.`);
    }
  } catch (err) {
    console.error("Gagal sinkronisasi:", err);
  }
}

//  Penyesuaian 3: tandai untuk ditinjau, JANGAN vonis 
function handleReviewFlags(review) {
  if (!review || !review.flags) return;
  for (const f of review.flags) {
    if (f.action   "REQUEST_AUTHORIZATION") {
      // Minta tinjauan/otorisasi manusia - tidak memvonis otomatis.
      showAlert(`[PERLU TINJAUAN] ${f.message} (skor ${f.fraud_score})`, "critical");
      markForReview(f.transaction_id, "need_authorization");
    } else if (f.action   "NOTIFY_FOR_REVIEW") {
      showAlert(`[PERHATIAN] ${f.message} (skor ${f.fraud_score})`, "warning");
      markForReview(f.transaction_id, "notify");
    }
  }
}

// Menandai transaksi di UI sebagai "perlu ditinjau" (bukan memblokir kasir).
function markForReview(txnId, level) {
  const el = document.querySelector(`[data-txn-id="${txnId}"]`);
  if (el) {
    el.classList.add("flagged-review", level);
    el.title = "Ditandai untuk ditinjau pemilik/supervisor";
  }
}

//  Pemicu otomatis 
window.addEventListener("online", () => {
  console.log("Koneksi tersambung - memulai sinkronisasi...");
  syncAndScore();
});
setInterval(syncAndScore, 60_000); // cek tiap 60 detik
