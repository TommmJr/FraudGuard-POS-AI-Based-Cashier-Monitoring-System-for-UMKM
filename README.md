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

#### Contoh: Health Check
```bash
curl http://localhost:5000/health
```

#### Contoh: Score Transaksi
```bash
curl -X POST http://localhost:5000/api/score \
  -H "Content-Type: application/json" \
  -d '{
    "transactions": [
      {
        "id": "txn-001",
        "cashier_id": "CSH-001",
        "timestamp": "2026-05-15 10:30:00",
        "transaction_type": "REFUND",
        "amount": 150000
      }
    ],
    "model_type": "rf"
  }'
```

#### Contoh: Dashboard
```bash
# Semua data
curl http://localhost:5000/api/dashboard

# Data 7 hari terakhir
curl http://localhost:5000/api/dashboard?days=7
```

#### Contoh: Daftar Kasir
```bash
curl http://localhost:5000/api/cashiers
```

#### Contoh: Ambil Transaksi (dengan filter)
```bash
# Semua transaksi (halaman 1)
curl http://localhost:5000/api/transactions?page=1&per_page=50

# Filter kasir tertentu
curl http://localhost:5000/api/transactions?cashier_id=CSH-001&type=REFUND
```

#### Contoh: Simpan Transaksi Baru
```bash
curl -X POST http://localhost:5000/api/transactions \
  -H "Content-Type: application/json" \
  -d '{
    "transactions": [
      {
        "cashier_id": "CSH-001",
        "timestamp": "2026-06-03T10:00:00",
        "transaction_type": "SALE",
        "amount": 50000
      }
    ]
  }'
```

#### Contoh: Batch Score
```bash
# Score transaksi yang belum punya skor
curl -X POST http://localhost:5000/api/batch-score \
  -H "Content-Type: application/json" \
  -d '{"model_type": "rf"}'

# Re-score semua transaksi
curl -X POST http://localhost:5000/api/batch-score \
  -H "Content-Type: application/json" \
  -d '{"model_type": "xgboost", "rescore_all": true}'
```

#### Ganti Model
Bisa pilih model saat request via `model_type`:
- `"rf"` — Random Forest (default)
- `"xgboost"` — XGBoost

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
