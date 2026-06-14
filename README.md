# FraudGuard — Deteksi Aktivitas Transaksi Anomali Kasir UMKM

Sistem deteksi kecurangan dan anomali **transaksi (Refund & Sale)** kasir untuk UMKM, dibangun dengan
arsitektur **hybrid dua lapis**: skor anomali *Isolation Forest* (unsupervised)
dipakai sebagai fitur tambahan untuk **satu model supervised terbaik** (Random Forest
atau XGBoost — dipilih otomatis berdasarkan F1-Score).

> **Cakupan saat ini: REFUND dan SALE anomali (Profil D).** VOID & DISCOUNT belum
> dibuat datanya. Jangan mengklaim mendeteksi keduanya sampai datanya ada.


## Alur Singkat
Catat perilaku refund tiap kasir → ajari model mengenali yang wajar →
beri **severity level** (LOW/MEDIUM/HIGH/CRITICAL) → **tandai untuk ditinjau manusia**
(bukan memvonis) → ukur akurasi dengan kunci jawaban (`fraud_severity`).

## Arsitektur & Pipeline

### Arsitektur Hybrid (Dua Lapis)
1. **Lapis 1 — Isolation Forest (unsupervised):** belajar pola normal tanpa
   label, menghasilkan *skor anomali* sebagai fitur tambahan.
2. **Lapis 2 — 1 Model Supervised Terbaik:** belajar dari label `fraud_severity`,
   memakai fitur perilaku **+ skor anomali dari Lapis 1**.
   - Train RF & XGBoost, bandingkan F1-macro, simpan hanya pemenang.

### Label Severity (Multi-class)
| Level | Deskripsi | Profil Fraud |
|-------|-----------|--------------|
| **LOW** | Transaksi normal | — |
| **MEDIUM** | Refund nominal wajar, frekuensi abnormal | Profil C (Halus) |
| **HIGH** | Refund nominal menengah, berulang | Profil B (Sedang) |
| **CRITICAL** | Refund besar beruntun (A) atau SALE anomali larut malam (D) | Profil A & Profil D |

### Pipeline
```
Tahap 1: notebooks/01_generate_synthetic_data.ipynb
         ├─ Generate 2000+ transaksi normal + 222 fraud (3 profil)
         ├─ Label multi-class: LOW / MEDIUM / HIGH / CRITICAL
         └─ Output: data/raw/synthetic_transactions.csv + database/local_pos.db
                    ↓
Tahap 2: notebooks/02_eda_and_preprocessing.ipynb
         ├─ Exploratory Data Analysis (visualisasi, statistik)
         ├─ Data cleaning (duplikat, missing values, validasi)
         └─ Output: data/processed/transactions_cleaned.csv
                    ↓
Tahap 3: notebooks/03_feature_engineering.ipynb
         ├─ Hitung 11 fitur perilaku kasir (termasuk is_late_night & freq z-score)
         ├─ Encode target (severity → ordinal 0-3)
         ├─ Stratified split: train 70% / val 15% / test 15%
         ├─ Scaling dengan RobustScaler
         └─ Output: data/splits/*.csv, models/scaler.pkl, models/feature_columns.json
                    ↓
Tahap 4: notebooks/04_model_training.ipynb
         ├─ Train Isolation Forest (unsupervised) → anomaly score
         ├─ Train Random Forest & XGBoost (supervised, multi-class)
         ├─ Bandingkan F1-macro → pilih 1 pemenang
         └─ Output: models/isolation_forest.pkl, models/best_supervised.pkl,
                    models/model_metadata.json
                    ↓
Tahap 5: notebooks/05_evaluation.ipynb
         ├─ Evaluasi final pada test set
         ├─ Classification report, confusion matrix 4×4
         ├─ Feature importance & visualisasi
         └─ Kesimpulan & rekomendasi
                    ↓
Tahap 6 (Opsional): notebooks/06_hyperparameter_tuning.ipynb
         ├─ RandomizedSearchCV (30 iter × 5-fold)
         ├─ Bandingkan default vs tuned
         ├─ Overwrite model jika tuned lebih baik
         └─ Jalankan ulang 05_evaluation.ipynb setelah ini
                    ↓
API: api/app.py (Flask)
         ├─ Import scoring_engine.py sebagai modul Python
         ├─ REST API endpoints untuk scoring & dashboard
         ├─ Dioptimalkan dengan batch update (executemany) & dynamic context loading
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
cd ml_pipeline
jupyter notebook
```

Buka & jalankan notebook **IN ORDER (berurutan)**:

 #  File  Deskripsi  Estimasi Waktu

 1    `notebooks/01_generate_synthetic_data.ipynb`    Generate data sintetis → CSV + SQLite    ~30 detik
 2    `notebooks/02_eda_and_preprocessing.ipynb`    EDA & Data Cleaning    ~1 menit
 3    `notebooks/03_feature_engineering.ipynb`    Feature Engineering, Split & Scaling    ~1 menit
 4    `notebooks/04_model_training.ipynb`    Train hybrid model (IF + best supervised)    ~2-3 menit
 5    `notebooks/05_evaluation.ipynb`    Evaluasi final pada test set    ~1 menit
 6    `notebooks/06_hyperparameter_tuning.ipynb`    *(Opsional)* Hyperparameter tuning    ~5-10 menit

> **Catatan:** `06_hyperparameter_tuning.ipynb` bersifat **opsional** — `04_model_training.ipynb` sudah
> menghasilkan model yang siap pakai. Setelah tuning, jalankan ulang `05_evaluation.ipynb`.
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

---

## Progressive Web App (PWA)

FraudGuard menyediakan **Progressive Web App** sebagai antarmuka kasir yang bersifat **offline-first**. Transaksi tetap bisa dicatat meskipun koneksi internet terputus, lalu otomatis disinkronkan dan di-score saat koneksi kembali.

### Fitur PWA
- **Offline-First** — Transaksi disimpan di IndexedDB lokal, lalu disinkronkan ke backend saat online
- **Service Worker** — Caching aset statis (HTML, CSS, JS) untuk akses tanpa internet
- **Auto-Sync** — Sinkronisasi otomatis setiap 60 detik & saat koneksi kembali online
- **Fraud Scoring Terintegrasi** — Setelah sync, backend otomatis men-score transaksi dan menampilkan tingkat risiko
- **Ekspor Laporan Audit** — Menyediakan fitur ekspor laporan transaksi ke format CSV dan dokumen PDF analitik secara dinamis (menggunakan `jsPDF`).
- **Auto API URL Detection** — Backend API URL terdeteksi otomatis, kompatibel dengan remote/cloud IDE (seperti GitHub Codespaces/Gitpod) maupun jaringan lokal.

### Arsitektur PWA
```
Kasir input transaksi
     ↓
[IndexedDB Lokal] ← simpan offline-first (kalau terjadi kendala jaringan)
     ↓ (saat online)
[POST /api/transactions] → simpan ke SQLite backend
     ↓
[POST /api/batch-score] → scoring fraud oleh ML model
     ↓
UI diperbarui dengan tingkat risiko
```


### Menjalankan PWA

**Prasyarat:** Pastikan Flask API sudah berjalan di `http://127.0.0.1:5000` (lihat Quick Start bagian 3).

```bash
# Serve PWA di localhost
cd pwa
python -m http.server 8080
# Buka http://localhost:8080 di browser
```

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

### Q: `FileNotFoundError: No such file or directory: 'models/best_supervised.pkl'`
**A:** Jalankan `04_model_training.ipynb` dulu sampai selesai (Cell terakhir).
Model terbaik akan tersimpan otomatis ke `models/best_supervised.pkl`.

### Q: `ModuleNotFoundError: No module named 'scoring_engine'`
**A:**
- Pastikan file `scoring_engine.py` ada di folder `ml_pipeline/`
- Restart kernel notebook
- Cek `sys.path` di Cell 1

### Q: `No such table: transactions`
**A:** Jalankan `01_generate_synthetic_data.ipynb` dulu untuk membuat database.

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

## Batasan Jujur

1. **Data sintetis, kondisi terkontrol.**
   Precision/recall hanya berlaku untuk fraud buatan ini, **BUKAN bukti kinerja
   di dunia nyata**. Validasi nyata butuh kasus fraud terkonfirmasi dari pemilik UMKM.

2. **Model hybrid 1 supervised.**
   Hanya 1 model supervised yang dipakai (dipilih otomatis antara RF vs XGBoost) dan digabungkan ke dalam model unsupervised (Isolation Forest).
   Tidak ada ensemble dari beberapa model.

3. **"Anomali ≠ fraud".**
   Output adalah *kecurigaan untuk ditinjau*, bukan vonis.

4. **Monitoring & Retraining Diperlukan**
   - Model perlu monitoring performa di production
   - Retraining berkala dengan data baru
   - Feedback loop: fraud terlewat → retrain

5. **Keterbatasan Deteksi Fisik (No-Ring Fraud)**
   - AI beroperasi pada jejak digital (*Digital Footprint*). Jika kasir melakukan pencurian fisik murni tanpa menyentuh layar POS (menerima uang namun tidak mencetak struk), sistem AI buta terhadap kejadian tersebut.
   - **Solusi SOP Saat Ini**: Wajib dipadukan dengan kebijakan operasional "Belanja Gratis Jika Tidak Menerima Struk" untuk memaksa kasir menginput data, serta *Stock Opname* berkala untuk mendeteksi selisih persediaan.
   - **Future Work**: Potensi integrasi dengan IoT (sensor *Cash Drawer*) dan *Computer Vision* (CCTV AI) yang dapat memvalidasi apakah laci uang terbuka secara sinkron dengan log transaksi dari mesin POS.

6. **Manipulasi Jam Perangkat & Jeda Waktu Offline (Offline Time Manipulation)**
   - Ketika kasir offline, PWA mencatat `timestamp` menggunakan jam sistem lokal perangkat (`new Date()`). Kasir yang berniat curang dapat memanipulasi jam lokal sistem (di Windows/Android) atau sengaja menjeda waktu input agar seolah-olah tidak terjadi transaksi cepat beruntun.
   - **Mitigasi/Solusi**: Membandingkan `timestamp` (klaim perangkat kasir) dengan `created_at` (waktu server saat sinkronisasi aktual). Adanya tumpukan transaksi dengan `created_at` yang sama persis namun `timestamp` terjeda lama akan terdeteksi sebagai anomali *Time Skew*.
   - **Solusi SOP**: Penguncian pengaturan waktu perangkat kasir menggunakan MDM (*Mobile Device Management*) agar kasir tidak dapat mengubah jam lokal perangkat secara manual.

7. **Manipulasi Transaksi Fiktif Offline (Offline Transaction Insertion)**
   - Saat dalam keadaan offline, PWA tidak dapat mencocokkan ketersediaan stok atau status pembayaran secara *real-time* ke server pusat, sehingga kasir secara teoritis dapat menginput penjualan/refund fiktif ke database lokal browser.
   - **Mitigasi/Solusi**: Deteksi anomali pasca-sinkronisasi (*delayed AI scoring*). Begitu online kembali dan data dikirim ke server, model AI akan menganalisis lonjakan nominal (`amount_zscore_cashier`) dan rasio refund (`refund_ratio_daily`) secara retrospektif.
   - **Solusi SOP**: Penonaktifan input nominal manual (kasir wajib memindai barcode produk asli yang harganya sudah dikunci di database PWA lokal) dan audit berkala dengan *Stock Opname*.

---