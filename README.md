# FraudGuard — Deteksi Penyalahgunaan Refund Kasir UMKM (Pola B)

Sistem deteksi penyalahgunaan **refund** kasir untuk UMKM, dibangun dengan
arsitektur berlapis **Pola B**: skor anomali *Isolation Forest* (unsupervised)
dipakai sebagai salah satu fitur untuk model *Random Forest + XGBoost* (supervised) yang
membuat keputusan akhir.

> **Cakupan saat ini: REFUND saja.** VOID & DISCOUNT belum
> dibuat datanya. Jangan mengklaim mendeteksi keduanya sampai datanya ada.


## Alur Singkat
Catat perilaku refund tiap kasir → ajari model mengenali yang wajar →
beri skor risiko → **tandai untuk ditinjau manusia** (bukan memvonis) →
ukur akurasi dengan kunci jawaban (`is_fraud`).

## Arsitektur & Pipeline

### Arsitektur Pola B (Dua Lapis)
1. **Lapis 1 — Isolation Forest (unsupervised):** belajar pola normal tanpa
   label, menghasilkan *skor anomali*.
2. **Lapis 2 — Random Forest + XGBoost (supervised):** belajar dari label `is_fraud`,
   memakai fitur perilaku **+ skor anomali dari Lapis 1** sebagai fitur.
   - Random Forest: model baseline stabil
   - XGBoost: model advanced dengan performa tinggi

### Pipeline
```
Tahap 1: generate_synthetic_data.ipynb
         ├─ Generate 2000+ transaksi normal
         ├─ Inject 3 profil fraud (mencolok → halus)
         └─ Output: database/local_pos.db
                    ↓
Tahap 2: 01_train_isolation_forest.ipynb
         ├─ Train Isolation Forest (unsupervised)
         └─ Output: models/isolation_forest.pkl
                    ↓
Tahap 3: 02_train_supervised.ipynb
         ├─ Train Random Forest + XGBoost (supervised)
         ├─ Konsisten train/test split (stratified 70/30)
         ├─ Feature importance comparison
         └─ Output: models/supervised_rf.pkl, supervised_xgb.pkl, test_split.pkl
                    ↓
Tahap 4: 03_evaluate.ipynb
         ├─ Perbandingan 3 model: IF Baseline vs RF vs XGBoost
         ├─ Metrics: Precision, Recall, F1, PR-AUC
         ├─ Visualisasi PR curve 3 model
         └─ Confusion matrix & analisis
                    ↓
Tahap 5 (Opsional): 04_tune.ipynb
         ├─ Hyperparameter tuning RF & XGBoost (RandomizedSearchCV)
         ├─ Visualisasi Default vs Tuned
         ├─ Overwrite model terbaik → models/supervised_rf.pkl & supervised_xgb.pkl
         └─ Jalankan ulang 03_evaluate.ipynb setelah ini untuk melihat hasil tuning
                    ↓
Tahap 6: api/app.py (Flask)
         ├─ Import scoring_engine.py sebagai modul Python (bukan notebook)
         ├─ REST API endpoint /api/score & /api/summary/<cashier_id>
         └─ scoring_engine.py dipanggil otomatis — tidak perlu dijalankan manual
```

---

## Quick Start

### 1. Instalasi
```bash
pip install -r requirements.txt
```

### 2. Jalankan Pipeline (Jupyter Notebook)
```bash
jupyter notebook
```

Buka & jalankan notebook **IN ORDER (berurutan)**:

 #  File  Deskripsi  Estimasi Waktu 

 1    `ml_pipeline/generate_synthetic_data.ipynb`    Generate data sintetis → `database/local_pos.db`    ~30 detik   
 2    `ml_pipeline/01_train_isolation_forest.ipynb`    Train Lapis 1 (Isolation Forest)    ~1-2 menit   
 3    `ml_pipeline/02_train_supervised.ipynb`    Train Lapis 2 (RF + XGBoost)    ~2-3 menit   
 4    `ml_pipeline/03_evaluate.ipynb`    Evaluasi & perbandingan 3 model    ~1-2 menit   
 5    `ml_pipeline/04_tune.ipynb`    *(Opsional)* Hyperparameter tuning RF & XGBoost    ~5-10 menit   

> **Catatan:** `04_tune.ipynb` bersifat **opsional** — `02_train_supervised.ipynb` sudah
> menghasilkan model yang siap pakai. Setelah tuning, jalankan ulang `03_evaluate.ipynb`.
>
> `scoring_engine.py` **tidak perlu dijalankan manual** — ia adalah modul Python yang
> otomatis di-`import` oleh `api/app.py` saat API dijalankan.

### 3. Gunakan Model di API
```bash
python api/app.py
# API running at http://localhost:5000
```

#### Endpoint yang Tersedia

Endpoint Method Deskripsi 
`/health` GET Status API, database, dan model 
`/api/score` POST Skor fraud untuk batch transaksi 
`/api/summary/<cashier_id>` GET Ringkasan risiko per kasir 
`/api/cashiers` GET Daftar semua kasir + statistik 
`/api/dashboard` GET Statistik keseluruhan (untuk dashboard) 
`/api/transactions` POST Simpan transaksi baru ke DB 
`/api/transactions` GET Ambil transaksi (filter & pagination) 
`/api/model-info` GET Info model ML yang tersedia 
`/api/batch-score` POST Score semua transaksi di DB 

#### Ganti Model
Bisa pilih model saat request via `model_type`:
- `"rf"` — Random Forest (default)
- `"xgboost"` — XGBoost

---

## Progressive Web App (PWA)

FraudGuard menyediakan **Progressive Web App** sebagai antarmuka kasir yang bersifat **offline-first**. Transaksi tetap bisa dicatat meskipun koneksi internet terputus, lalu otomatis disinkronkan dan di-score saat koneksi kembali.

### Fitur PWA
- **Offline-First** — Transaksi disimpan di IndexedDB lokal, lalu disinkronkan ke backend saat online
- **Service Worker** — Caching aset statis (HTML, CSS, JS) untuk akses tanpa internet
- **Installable** — Bisa di-install ke Home Screen (Android/iOS) atau Desktop (Chrome/Edge)
- **Auto-Sync** — Sinkronisasi otomatis setiap 60 detik & saat koneksi kembali online
- **Fraud Scoring Terintegrasi** — Setelah sync, backend otomatis men-score transaksi dan menampilkan tingkat risiko

### Arsitektur PWA
```
Kasir input transaksi
     ↓
[IndexedDB Lokal] ← simpan offline-first
     ↓ (saat online)
[POST /api/transactions] → simpan ke SQLite backend
     ↓
[POST /api/batch-score] → scoring fraud oleh ML model
     ↓
UI diperbarui dengan tingkat risiko
```

### File PWA
| File | Deskripsi |
|---|---|
| `pwa/index.html` | Halaman utama — form input transaksi & tabel riwayat |
| `pwa/style.css` | Stylesheet UI kasir |
| `pwa/app.js` | Logika UI — form handler, dashboard, riwayat transaksi |
| `pwa/db.js` | IndexedDB + sinkronisasi + scoring (offline-first engine) |
| `pwa/sw.js` | Service Worker — caching aset & strategi Cache First |
| `pwa/manifest.json` | Web App Manifest — metadata untuk installasi PWA |
| `pwa/icon-192x192.png` | Ikon PWA 192×192px |
| `pwa/icon-512x512.png` | Ikon PWA 512×512px |

### Menjalankan PWA

**Prasyarat:** Pastikan Flask API sudah berjalan di `http://127.0.0.1:5000` (lihat Quick Start bagian 3).

```bash
# Serve PWA di localhost (Service Worker butuh localhost atau HTTPS)
cd pwa
python -m http.server 8080
# Buka http://localhost:8080 di browser
```

### Mengetes PWA

1. **Buka Chrome DevTools** → Tab **Application**:
   - **Manifest** — Pastikan terdeteksi dan ikon tampil
   - **Service Workers** — Pastikan status "Activated and running"
   - **Cache Storage** — Pastikan cache `fraudguard-v1` berisi aset
2. **Tes Offline** — Centang "Offline" di tab Network, lalu reload halaman
3. **Install PWA** — Klik ikon install (⊕) di address bar Chrome, atau menu ⋮ → "Install FraudGuard Point of Sale"
4. **Tes Input Transaksi** — Isi form & klik "Simpan Transaksi", data masuk ke IndexedDB
5. **Tes Sinkronisasi** — Pastikan API berjalan, transaksi akan otomatis tersinkron & di-score

---

## Struktur Project

```
FraudGuard/
├─ ml_pipeline/
│  ├─ models/                                  # Output model (auto-generated)
│  │  ├─ isolation_forest.pkl                 # Lapis 1 — output dari 01_train_isolation_forest
│  │  ├─ supervised_rf.pkl                    # Lapis 2 RF — output dari 02 atau 04_tune
│  │  ├─ supervised_xgb.pkl                   # Lapis 2 XGBoost — output dari 02 atau 04_tune
│  │  └─ test_split.pkl                       # Test split konsisten untuk evaluasi
│  │
│  ├─ generate_synthetic_data.ipynb           # [Tahap 1] Generate data sintetis
│  ├─ 01_train_isolation_forest.ipynb         # [Tahap 2] Train Isolation Forest
│  ├─ 02_train_supervised.ipynb               # [Tahap 3] Train RF + XGBoost (default params)
│  ├─ 03_evaluate.ipynb                       # [Tahap 4] Evaluasi & perbandingan 3 model
│  ├─ 04_tune.ipynb                           # [Tahap 5 - Opsional] Hyperparameter tuning
│  ├─ scoring_engine.ipynb                    # [Tahap 6] Demo scoring & review
│  │
│  ├─ feature_engineering.py                  # Modul Python — fitur perilaku kasir
│  ├─ pola_b_features.py                      # Modul Python — build matriks fitur Pola B
│  └─ scoring_engine.py                       # Modul Python — engine scoring untuk API
│
├─ database/
│  └─ local_pos.db                            # SQLite database (generated oleh Tahap 1)
│
├─ api/
│  └─ app.py                                  # Flask REST API
│
├─ pwa/                                        # [Tahap 7] Progressive Web App (offline-first)
│  ├─ index.html                              # Halaman utama kasir
│  ├─ style.css                               # Stylesheet UI
│  ├─ app.js                                  # Logika UI & interaksi API
│  ├─ db.js                                   # IndexedDB & sinkronisasi offline-first
│  ├─ sw.js                                   # Service Worker (cache & offline)
│  ├─ manifest.json                           # Web App Manifest
│  ├─ icon-192x192.png                        # Ikon PWA 192px
│  └─ icon-512x512.png                        # Ikon PWA 512px
│
├─ requirements.txt
└─ README.md
```

---

## Model Selection & Scoring

### Dua Jalur Training
- **`02_train_supervised.ipynb`** — Training cepat dengan parameter default (direkomendasikan untuk mulai)
- **`04_tune.ipynb`** — Hyperparameter tuning dengan `RandomizedSearchCV` (50 iter × 5-fold),
  otomatis overwrite model terbaik ke `models/`

### Pilih Model di Runtime (`scoring_engine.py`)
```python
from scoring_engine import score_transactions, flag_for_review

# Default: Random Forest
scored = score_transactions(df)

# Atau XGBoost
scored = score_transactions(df, model_type="xgboost")

# Dapatkan transaksi untuk ditinjau
review = flag_for_review(scored)
print(f"Flagged: {review['total_flagged']}")
for flag in review['flags']:
    print(f"  {flag['transaction_id']}: {flag['message']}")
```

---

## Tips Penggunaan Notebook

### Saat Error
1. Restart kernel: `Kernel → Restart`
2. Run ulang dari Cell 1

### Untuk Clear Output
- `Kernel → Restart & Clear Output`

### Edit & Run Cell
- **Edit**: Double-click cell
- **Run**: Ctrl+Enter
- **Run & Next**: Shift+Enter

---

## Troubleshooting

### Q: `FileNotFoundError: No such file or directory: 'models/supervised_rf.pkl'`
**A:** Jalankan `02_train_supervised.ipynb` dulu sampai selesai (Cell terakhir).
Model RF dan test split akan tersimpan otomatis ke `models/`.

### Q: `ModuleNotFoundError: No module named 'feature_engineering'`
**A:**
- Pastikan file `feature_engineering.py` ada di folder `ml_pipeline/`
- Restart kernel notebook
- Cell 1 setiap notebook sudah otomatis menambahkan `ml_pipeline/` ke `sys.path`

### Q: "Model XGBoost tidak ada / ✗ XGB Model"
**A:** XGBoost bersifat opsional. Ada dua penyebab:
1. XGBoost belum terpasang → `pip install xgboost`
2. `02_train_supervised.ipynb` dijalankan tanpa XGBoost terpasang → install lalu jalankan ulang

### Q: `No such table: transactions`
**A:** Jalankan `generate_synthetic_data.ipynb` dulu untuk membuat database.

### Q: Hasil evaluasi berbeda setiap run
**A:** Seharusnya SAMA karena `random_state=42` di semua tempat. Jika berbeda:
- Kernel di-restart di tengah jalan?
- Data di database berubah?

### Q: PWA tidak bisa di-install / Service Worker gagal
**A:** Service Worker hanya berjalan di `localhost` atau `HTTPS`. Pastikan:
- Serve file dari `pwa/` menggunakan `python -m http.server 8080`
- Buka via `http://localhost:8080`, **bukan** `file://`
- Gunakan Chrome/Edge (support PWA terbaik)

### Q: PWA menampilkan "Memuat data..." terus
**A:** Ini berarti Flask API belum jalan. Pastikan:
1. Jalankan `python api/app.py` terlebih dahulu
2. API berjalan di `http://127.0.0.1:5000`
3. Cek browser console untuk error CORS atau koneksi

---

## Fitur Keamanan

- **`cashier_id` TIDAK dipakai sebagai fitur** → Cegah hafalan "kasir X = fraud"
- **Nominal dihitung RELATIF per kasir (z-score)** → Cegah "nominal besar = fraud"
- **`is_fraud` HANYA target (y), TIDAK fitur (X)** → Jaminan kunci jawaban terpisah
- **`stratify=y` saat split** → Proporsi fraud terjaga di train & test
- **Test split tersimpan** → Evaluasi konsisten & reproducible

---

## Tiga Penyesuaian yang Diterapkan
- **#1 Cakupan:** fokus refund; klaim = "deteksi penyalahgunaan refund".
- **#2 Evaluasi:** label `is_fraud` disimpan; fraud beragam (mencolok → halus) &
  tersebar ke beberapa kasir (anti hafalan jalan pintas).
- **#3 Tindakan:** sistem **menandai untuk ditinjau / minta otorisasi**, bukan
  memblokir otomatis. Sistem menunjuk, **manusia memutuskan**.

---

## Batasan Jujur

1. **Data sintetis, kondisi terkontrol.**
   Precision/recall hanya berlaku untuk fraud buatan ini, **BUKAN bukti kinerja
   di dunia nyata**. Validasi nyata butuh kasus fraud terkonfirmasi dari pemilik UMKM.

2. **Skoring per-batch kini konsisten.**
   *(Update: Bug teknis sebelumnya telah diperbaiki).* Saat API men-skor transaksi baru, sistem akan otomatis menarik 500 riwayat transaksi terakhir kasir dari database lokal sebagai *konteks*. Fitur perilaku (seperti z-score nominal) dihitung berdasarkan histori lengkap ini, bukan sekadar batch sesaat.

3. **"Anomali ≠ fraud".**
   Output adalah *kecurigaan untuk ditinjau*, bukan vonis.

4. **Monitoring & Retraining Diperlukan**
   - Model perlu monitoring performa di production
   - Retraining berkala dengan data baru
   - Feedback loop: fraud terlewat → retrain

---
