"""
FraudGuard — scoring_engine.py

Modul scoring untuk API. Menerima transaksi mentah, hitung fitur perilaku,
lalu prediksi severity fraud menggunakan model hybrid (IF + supervised).

Model hybrid:
  Lapis 1: Isolation Forest → anomaly score (fitur tambahan)
  Lapis 2: 1 model supervised terbaik → prediksi severity (LOW/MEDIUM/HIGH/CRITICAL)

File ini satu-satunya .py di ml_pipeline karena Flask API
perlu meng-import-nya sebagai modul Python.
"""

import os
import sys
import json
import joblib
import pandas as pd
import numpy as np

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Path ke model dan artifacts
IF_MODEL_PATH      = os.path.join(BASE_DIR, "models", "isolation_forest.pkl")
BEST_MODEL_PATH    = os.path.join(BASE_DIR, "models", "best_supervised.pkl")
SCALER_PATH        = os.path.join(BASE_DIR, "models", "scaler.pkl")
FEAT_COL_PATH      = os.path.join(BASE_DIR, "models", "feature_columns.json")
META_PATH          = os.path.join(BASE_DIR, "models", "model_metadata.json")

# Load feature metadata saat import
_feat_meta = {}
if os.path.exists(FEAT_COL_PATH):
    with open(FEAT_COL_PATH) as f:
        _feat_meta = json.load(f)

FEATURE_COLS = _feat_meta.get("feature_columns", [
    "hour_of_day",
    "is_refund",
    "time_gap_seconds",
    "txn_freq_daily",
    "refund_count_daily",
    "refund_ratio_daily",
    "amount_zscore_cashier",
    "amount_rolling_mean_5",
    "amount_deviation_from_mean",
    "is_late_night",
    "txn_freq_zscore_cashier",
])

SEVERITY_LABELS = _feat_meta.get("severity_labels", ["LOW", "MEDIUM", "HIGH", "CRITICAL"])
SEVERITY_MAP = _feat_meta.get("severity_map", {"LOW": 0, "MEDIUM": 1, "HIGH": 2, "CRITICAL": 3})

# Reverse map: code -> label
CODE_TO_LABEL = {v: k for k, v in SEVERITY_MAP.items()}


def engineer_features(df: pd.DataFrame) -> pd.DataFrame:
    """Hitung fitur perilaku per kasir dari data transaksi mentah."""
    df = df.copy()
    df["timestamp"] = pd.to_datetime(df["timestamp"], format="mixed")
    df["date"] = df["timestamp"].dt.date
    df = df.sort_values(["cashier_id", "timestamp"])

    # 1. Jam transaksi
    df["hour_of_day"] = df["timestamp"].dt.hour

    # 2. Penanda refund
    df["is_refund"] = (df["transaction_type"] == "REFUND").astype(int)

    # 3. Jeda antar transaksi per kasir
    df["time_gap_seconds"] = (
        df.groupby("cashier_id")["timestamp"].diff().dt.total_seconds().fillna(0)
    )
    # FIX: Cap time_gap_seconds ke maksimal 1 jam (3600 detik) atau 12 jam (43200)
    # untuk mencegah transaksi pertama di hari baru dianggap anomali ekstrem
    # Kita ubah dari 43200 menjadi 3600 agar model tidak melihat jeda antar-shift sebagai outlier parah.
    df["time_gap_seconds"] = df["time_gap_seconds"].clip(upper=3600)

    # 4. Frekuensi transaksi harian per kasir
    df["txn_freq_daily"] = (
        df.groupby(["cashier_id", "date"])["id"].transform("count")
    )

    # 5. Jumlah refund harian per kasir
    df["refund_count_daily"] = (
        df.groupby(["cashier_id", "date"])["is_refund"].transform("sum")
    )

    # FIX: Train-serve skew. Di production real-time, transaksi pertama hari ini akan punya freq=1.
    # Model yg dilatih di data agregat akan kaget melihat freq=1 dan menganggapnya CRITICAL.
    # Solusi: Paksa nilai frekuensi harian transaksi baru agar menggunakan rata-rata historisnya.
    mean_freq = df.groupby("cashier_id")["txn_freq_daily"].transform("mean")
    df["txn_freq_daily"] = np.where(df["txn_freq_daily"] < 10, mean_freq, df["txn_freq_daily"])

    # 6. Rasio refund harian
    df["refund_ratio_daily"] = df["refund_count_daily"] / df["txn_freq_daily"]

    # 7. Z-score nominal relatif per kasir
    g_mean = df.groupby("cashier_id")["amount"].transform("mean")
    g_std  = df.groupby("cashier_id")["amount"].transform("std").replace(0, 1)
    df["amount_zscore_cashier"] = (df["amount"] - g_mean) / g_std

    # 8. Rolling mean 5 transaksi terakhir per kasir
    df["amount_rolling_mean_5"] = (
        df.groupby("cashier_id")["amount"]
          .transform(lambda x: x.rolling(5, min_periods=1).mean())
    )

    # 9. Deviasi dari rolling mean
    df["amount_deviation_from_mean"] = df["amount"] - df["amount_rolling_mean_5"]

    # 10. Fitur larut malam
    df["is_late_night"] = ((df["hour_of_day"] >= 23) | (df["hour_of_day"] <= 4)).astype(int)

    # 11. Z-score dari frekuensi harian per kasir
    g_freq_mean = df.groupby("cashier_id")["txn_freq_daily"].transform("mean")
    g_freq_std  = df.groupby("cashier_id")["txn_freq_daily"].transform("std").replace(0, 1)
    df["txn_freq_zscore_cashier"] = (df["txn_freq_daily"] - g_freq_mean) / g_freq_std

    return df


def get_feature_matrix(df: pd.DataFrame) -> pd.DataFrame:
    """Ambil hanya kolom fitur numerik (tanpa cashier_id, tanpa label)."""
    return df[FEATURE_COLS].fillna(0)


def score_transactions(
    df: pd.DataFrame,
    df_context: pd.DataFrame = None,
) -> pd.DataFrame:
    """
    Beri risk_level (LOW/MEDIUM/HIGH/CRITICAL) untuk tiap transaksi
    menggunakan model hybrid: IF (anomaly score) + supervised (multi-class).

    Args:
        df          : DataFrame transaksi yang ingin di-skor.
                      Kolom wajib: id, cashier_id, timestamp,
                                   transaction_type, amount
        df_context  : DataFrame histori kasir dari DB sebagai konteks.
                      Jika diisi, fitur perilaku dihitung dari gabungan
                      histori + transaksi baru (lebih akurat).
                      Jika None, hitung dari df saja.

    Returns:
        DataFrame df dengan kolom tambahan: fraud_score, risk_level, model_used
    """
    # Load models
    if_model = joblib.load(IF_MODEL_PATH)
    clf      = joblib.load(BEST_MODEL_PATH)
    scaler   = joblib.load(SCALER_PATH) if os.path.exists(SCALER_PATH) else None

    # Load model metadata untuk info nama model
    model_name = "hybrid"
    if os.path.exists(META_PATH):
        with open(META_PATH) as f:
            model_name = json.load(f).get("model_type", "hybrid")

    # Pilih jalur: dengan konteks historis atau tanpa
    if df_context is not None and not df_context.empty:
        # Gabungkan konteks + transaksi baru
        df_new = df.copy()
        df_new["_is_new"] = True

        df_ctx = df_context.copy()
        df_ctx["_is_new"] = False

        df_new["timestamp"] = pd.to_datetime(df_new["timestamp"], format="mixed")
        df_ctx["timestamp"] = pd.to_datetime(df_ctx["timestamp"], format="mixed")

        combined = pd.concat([df_ctx, df_new], ignore_index=True)
        combined = combined.sort_values(["cashier_id", "timestamp"]).reset_index(drop=True)

        # Hitung fitur pada data gabungan
        feat = engineer_features(combined)
        X_base = get_feature_matrix(feat)

        # Scale fitur
        if scaler is not None:
            X_scaled = pd.DataFrame(
                scaler.transform(X_base), columns=FEATURE_COLS, index=X_base.index
            )
        else:
            X_scaled = X_base

        # Hitung IF anomaly score
        X_scaled["if_anomaly_score"] = -if_model.decision_function(X_scaled[FEATURE_COLS])

        # Ambil baris transaksi baru saja
        new_mask = combined["_is_new"].values.astype(bool)
        X_new = X_scaled[new_mask].reset_index(drop=True)
        df_out = combined[new_mask].drop(columns=["_is_new"]).reset_index(drop=True)

    else:
        # Tanpa konteks — hitung fitur dari df saja
        feat = engineer_features(df)
        X_base = get_feature_matrix(feat)

        if scaler is not None:
            X_scaled = pd.DataFrame(
                scaler.transform(X_base), columns=FEATURE_COLS, index=X_base.index
            )
        else:
            X_scaled = X_base

        X_scaled["if_anomaly_score"] = -if_model.decision_function(X_scaled[FEATURE_COLS])
        X_new = X_scaled
        df_out = df.copy()

    # Prediksi severity class
    y_pred = clf.predict(X_new)
    y_proba = clf.predict_proba(X_new)

    # Cari index untuk class LOW (biasanya 0 karena SEVERITY_MAP["LOW"] = 0)
    try:
        low_class_idx = list(clf.classes_).index(0)
        p_low = y_proba[:, low_class_idx]
    except ValueError:
        # Fallback jika tidak ada class 0 di model (sangat jarang terjadi)
        p_low = np.zeros(len(X_new))

    # Fraud score = Probabilitas transaksi BUKAN LOW (berisiko)
    # Skor rendah = aman, skor tinggi = kemungkinan fraud
    fraud_score_arr = (1.0 - p_low) * 100.0

    # Map kode prediksi ke label severity
    df_out["risk_level"]  = [CODE_TO_LABEL.get(int(p), "LOW") for p in y_pred]
    df_out["fraud_score"] = fraud_score_arr.round(2)
    df_out["model_used"]  = model_name

    #  BUSINESS RULES (POST-PROCESSING) 
    # Aturan untuk meredam False Positive pada saat testing / awal shift
    # Kasus: Kasir menginput "setoran" atau transaksi kecil setelah jeda lama (misal beda hari).
    # Model sering menganggap ini CRITICAL karena time_gap sangat besar atau jam kerja (hour_of_day)
    # tidak biasa dibandingkan histori sebelumnya.
    for idx, row in df_out.iterrows():
        if row["risk_level"] in ["HIGH", "CRITICAL"]:
            # Ambil fitur asli untuk transaksi ini
            gap = feat.loc[idx, "time_gap_seconds"] if "time_gap_seconds" in feat.columns else 0
            
            # Aturan 1: Transaksi bernominal kecil (< Rp 50.000) yang terjadi setelah jeda panjang 
            # (awal shift) atau merupakan transaksi pertama (gap == 0 atau >= 3600) -> Kemungkinan besar aman (LOW)
            if row["amount"] <= 50000 and (gap >= 3600 or gap == 0):
                df_out.at[idx, "risk_level"] = "LOW"
                df_out.at[idx, "fraud_score"] = min(df_out.at[idx, "fraud_score"], 35.0)
                df_out.at[idx, "model_used"] = model_name + " + rules"
            
            # Aturan 2: Transaksi bernominal kecil (< Rp 50.000) secara umum sering dianggap Embezzlement 
            # oleh model jika frekuensi belum terbentuk. Turunkan ke MEDIUM agar tidak memblokir kasir.
            elif row["amount"] <= 50000:
                df_out.at[idx, "risk_level"] = "MEDIUM"
                df_out.at[idx, "fraud_score"] = min(df_out.at[idx, "fraud_score"], 65.0)
                df_out.at[idx, "model_used"] = model_name + " + rules"

    return df_out


def flag_for_review(df_scored: pd.DataFrame) -> dict:
    """
    Hasilkan daftar tinjauan, bukan blokir otomatis.

      CRITICAL -> minta otorisasi pemilik/supervisor
      HIGH     -> kirim notifikasi untuk ditinjau

    Sistem tidak memvonis — ia menandai untuk diperiksa manusia.

    Args:
        df_scored: Output dari score_transactions()

    Returns:
        dict dengan keys: total_flagged, need_authorization, notify_only, flags
    """
    flags = []
    for _, row in df_scored[
        df_scored["risk_level"].isin(["CRITICAL", "HIGH"])
    ].iterrows():
        if row["risk_level"] == "CRITICAL":
            action  = "REQUEST_AUTHORIZATION"
            message = (
                "Transaksi berisiko tinggi. Perlu tinjauan & otorisasi "
                "pemilik/supervisor sebelum diproses."
            )
        else:
            action  = "NOTIFY_FOR_REVIEW"
            message = "Transaksi perlu ditinjau pemilik/supervisor."

        flags.append({
            "transaction_id": row["id"],
            "cashier_id":     row["cashier_id"],
            "fraud_score":    row["fraud_score"],
            "risk_level":     row["risk_level"],
            "action":         action,
            "message":        message,
        })

    return {
        "total_flagged":       len(flags),
        "need_authorization":  sum(1 for f in flags if f["action"] == "REQUEST_AUTHORIZATION"),
        "notify_only":         sum(1 for f in flags if f["action"] == "NOTIFY_FOR_REVIEW"),
        "flags":               flags,
    }
