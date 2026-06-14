# FraudGuard — Deteksi Aktivitas Transaksi Anomali Kasir UMKM

Sistem deteksi kecurangan dan anomali **transaksi (Refund & Sale)** kasir untuk UMKM, dibangun dengan
arsitektur **hybrid dua lapis**: skor anomali *Isolation Forest* (unsupervised)
dipakai sebagai fitur tambahan untuk **satu model supervised terbaik** (Random Forest
atau XGBoost lalu dipilih otomatis berdasarkan F1-Score).

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
| **CRITICAL** | Refund besar beruntun (A) atau kombinasi anomali SALE (D) | Profil A & Profil D |

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
         ├─ Hitung 11 fitur perilaku kasir (seperti time_gap_seconds, is_refund, & amount_zscore_cashier)
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

Ikuti langkah-langkah di bawah ini secara berurutan untuk menyiapkan lingkungan, menjalankan pipeline kecerdasan buatan, mengaktifkan API backend, dan menjalankan PWA secara lokal.

### Langkah 1: Persiapan Lingkungan & Instalasi
Sangat disarankan untuk menggunakan Python Virtual Environment (`venv`) agar dependensi tidak bentrok dengan pustaka sistem global Anda.

```bash
# 1. Buat Virtual Environment
python -m venv .venv

# 2. Aktifkan Virtual Environment
# Windows (PowerShell):
.venv\Scripts\Activate.ps1
# Windows (CMD):
.venv\Scripts\activate.bat
# Linux / macOS:
source .venv/bin/activate

# 3. Instal semua dependensi pustaka
pip install -r requirements.txt
```

---

### Langkah 2: Jalankan ML Pipeline (Jupyter Notebook)
Sebelum menjalankan backend API, Anda **wajib** melatih model dan membuat database awal dengan menjalankan notebook-notebook di dalam folder `ml_pipeline/` secara **berurutan**.

```bash
cd ml_pipeline
jupyter notebook
```

Buka browser dan jalankan file notebook berikut secara berurutan:

1. **`01_generate_synthetic_data.ipynb`**  
   *Membangun data sintetis transaksi normal & anomali kasir (2000+ data normal & 222 fraud). Menghasilkan berkas `synthetic_transactions.csv` di `data/raw/` dan berkas database SQLite `local_pos.db` di `database/`.*
2. **`02_eda_and_preprocessing.ipynb`**  
   *Melakukan pembersihan data, membuang duplikat, menangani missing values, dan visualisasi sebaran kelas target.*
3. **`03_feature_engineering.ipynb`**  
   *Menghitung 11 fitur perilaku (seperti nominal z-score, jeda waktu transaksi, is_refund). Menghasilkan data split (train/val/test), standardisasi `scaler.pkl`, dan `feature_columns.json`.*
4. **`04_model_training.ipynb`**  
   *Melatih model hybrid dua lapis: Lapis 1 (unsupervised Isolation Forest) dan Lapis 2 (supervised multi-class terbaik dari Random Forest vs XGBoost). Menyimpan berkas model `isolation_forest.pkl`, `best_supervised.pkl`, dan metadata model.*
5. **`05_evaluation.ipynb`**  
   *Melakukan evaluasi performa model terpilih pada test set yang belum pernah dilihat model.*
6. **`06_hyperparameter_tuning.ipynb`** *(Opsional)*  
   *Optimasi hyperparameter (RandomizedSearchCV) untuk menyetel model terbaik secara otomatis.*

---

### Langkah 3: Jalankan API Backend (Flask Server)
Kembali ke direktori utama proyek, lalu jalankan Flask backend. Flask API berfungsi sebagai jembatan antara aplikasi kasir (PWA) dengan mesin ML.

```bash
# Jalankan dari direktori utama proyek
python api/app.py
```
*API akan aktif di alamat `http://localhost:5000`.*

**Fitur Cerdas API Backend:**
*   **Auto-Migration**: Saat pertama kali berjalan, server akan memeriksa skema database. Jika database sudah ada dari notebook tetapi kolom `fraud_score` dan `risk_level` belum ada, API akan secara otomatis melakukan migrasi skema (menambahkan kolom baru) tanpa merusak data lama.
*   **Background Auto-Scoring Thread**: API mengaktifkan thread latar belakang yang secara berkala memindai transaksi unscored (belum memiliki skor) di database SQLite untuk langsung di-skor secara retrospektif menggunakan model ML hybrid.

#### Ringkasan Endpoint Utama:
*   `GET /health` : Memeriksa status kesehatan API, koneksi database, dan kesiapan berkas model ML.
*   `POST /api/transactions` : Menyimpan data transaksi baru ke database (digunakan PWA saat sinkronisasi).
*   `GET /api/dashboard` : Mengambil data agregat analitik kecurangan untuk ditampilkan pada panel Owner.
*   `GET /api/cashiers` : Menampilkan daftar kasir beserta ringkasan tingkat risiko dan rasio refund harian.

---

### Langkah 4: Jalankan dan Serve PWA (Frontend)
Jalankan server HTTP lokal kecil di folder `pwa/` untuk mengakses aplikasi web POS offline-first.

```bash
# Serve halaman PWA
cd pwa
python -m http.server 8080
```
*Buka browser Anda dan akses halaman landing di `http://localhost:8080`.*

#### Akun Kredensial Uji Coba (Login):
*   **Pemilik Toko (Owner)**:  
    *   Username: `owner` | Password: `owner123` *(Panel bertema merah gelap untuk monitoring)*
*   **Kasir Toko (Dummy POS)**:
    *   Kasir 1 (CSH-001): `kasir1` | Password: `kasir001`
    *   Kasir 2 (CSH-002): `kasir2` | Password: `kasir002`
    *   Kasir 3 (CSH-003): `kasir3` | Password: `kasir003`
    *   Kasir 4 (CSH-004): `kasir4` | Password: `kasir004`
    *   Kasir 5 (CSH-005): `kasir5` | Password: `kasir005`

---

### Langkah 5: Alur Pengujian Fitur Offline-First (Demo)
1. **Login sebagai Kasir**: Masuk menggunakan akun `kasir1`.
2. **Putuskan Jaringan**: Hentikan server API backend (Ctrl+C di terminal Flask) atau ubah jaringan browser Anda menjadi *Offline* via DevTools.
3. **Simpan Transaksi**: Buat transaksi baru di tab kasir. Anda akan melihat notifikasi bahwa transaksi **berhasil disimpan secara offline** di database lokal browser (`IndexedDB`).
4. **Login sebagai Owner**: Di browser terpisah, login sebagai `owner`. Anda tidak akan melihat transaksi baru tersebut karena server mati/offline.
5. **Kembali Online**: Jalankan kembali server API backend (`python api/app.py`).
6. **Autosync**: Dalam 30-60 detik, halaman kasir secara otomatis menyinkronkan transaksi IndexedDB lokal ke server. Anda juga dapat menekan tombol **Sync** manual di menu kasir.
7. **AI Scoring**: Backend secara otomatis men-score transaksi yang baru masuk di latar belakang. Saat Owner memuat ulang dashboard, transaksi tersebut akan tampil beserta indikator tingkat risiko (`LOW`, `MEDIUM`, `HIGH`, atau `CRITICAL`) yang diwarnai sesuai tingkat keparahannya.

---

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
