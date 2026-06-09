import os
import sys
import joblib
import pandas as pd

# Pastikan path ml_pipeline ada di sys.path
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

from pola_b_features import build_pola_b_matrix

IF_MODEL_PATH       = os.path.join(BASE_DIR, "models", "isolation_forest.pkl")
SUPERVISED_RF_PATH  = os.path.join(BASE_DIR, "models", "supervised_rf.pkl")
SUPERVISED_XGB_PATH = os.path.join(BASE_DIR, "models", "supervised_xgb.pkl")

# Default model: Random Forest (bisa diubah ke "xgboost")
DEFAULT_MODEL_TYPE = "rf"

# Ambang risiko berdasarkan PELUANG fraud (0..100), bukan peringkat relatif.
RISK_LEVELS = {
    "CRITICAL": (75, 100),
    "HIGH":     (50, 74),
    "MEDIUM":   (25, 49),
    "LOW":      (0,  24),
}


def get_risk_label(score: float) -> str:
    """Ubah fraud_score menjadi risk level label."""
    for label, (lo, hi) in RISK_LEVELS.items():
        if lo <= score <= hi:
            return label
    return "LOW"


def score_transactions(
    df: pd.DataFrame,
    model_type: str = None,
    df_context: pd.DataFrame = None,
) -> pd.DataFrame:
    """
    Beri fraud_score (0..100) + risk_level untuk tiap transaksi.

    Args:
        df          : DataFrame transaksi yang ingin di-skor.
                      Kolom wajib: id, cashier_id, timestamp,
                                   transaction_type, amount
        model_type  : "rf" (Random Forest, default) atau "xgboost"
        df_context  : DataFrame histori kasir dari DB sebagai konteks.
                      Jika diisi, fitur perilaku (z-score, rolling mean,
                      refund ratio, dll.) dihitung dari gabungan histori
                      + transaksi baru sehingga hasilnya jauh lebih akurat.
                      Jika None → perilaku lama (backwards compatible untuk
                      notebook yang tidak memerlukan konteks DB).

    Returns:
        DataFrame df dengan kolom tambahan: fraud_score, risk_level, model_used
    """
    if model_type is None:
        model_type = DEFAULT_MODEL_TYPE

    if model_type not in ["rf", "xgboost"]:
        raise ValueError(
            f"model_type harus 'rf' atau 'xgboost', bukan '{model_type}'"
        )

    #  Muat model (sekali per panggilan) 
    if_model = joblib.load(IF_MODEL_PATH)
    clf      = joblib.load(
        SUPERVISED_XGB_PATH if model_type == "xgboost" else SUPERVISED_RF_PATH
    )

    #  Pilih jalur: dengan konteks historis atau tanpa 
    if df_context is not None and not df_context.empty:

        # JALUR KONTEKS (dipakai oleh API /score):
        df_new = df.copy()
        df_new["_is_new"] = True

        df_ctx = df_context.copy()
        df_ctx["_is_new"] = False

        # Pastikan kolom timestamp bertipe datetime di kedua sisi
        df_new["timestamp"] = pd.to_datetime(df_new["timestamp"])
        df_ctx["timestamp"] = pd.to_datetime(df_ctx["timestamp"])

        # Gabungkan konteks + baru, urutkan per kasir dan waktu
        combined = pd.concat([df_ctx, df_new], ignore_index=True)
        combined = combined.sort_values(["cashier_id", "timestamp"]).reset_index(drop=True)

        # Hitung fitur pada data gabungan
        X_full = build_pola_b_matrix(combined, if_model=if_model)

        # Ambil baris yang merupakan transaksi baru
        new_mask   = combined["_is_new"].values.astype(bool)
        X_new      = X_full[new_mask].reset_index(drop=True)
        df_out     = combined[new_mask].drop(columns=["_is_new"]).reset_index(drop=True)

    else:
        # JALUR TANPA KONTEKS (perilaku lama  dipakai notebook):
        X_new  = build_pola_b_matrix(df, if_model=if_model)
        df_out = df.copy()

    #  Prediksi & format output 
    proba = clf.predict_proba(X_new)[:, 1]          # peluang fraud 0..1
    df_out["fraud_score"] = (proba * 100).round(2)
    df_out["risk_level"]  = [get_risk_label(s) for s in df_out["fraud_score"]]
    df_out["model_used"]  = model_type
    return df_out


def flag_for_review(df_scored: pd.DataFrame) -> dict:
    """
    PENYESUAIAN 3: hasilkan DAFTAR TINJAUAN, bukan blokir otomatis.

      CRITICAL → minta otorisasi pemilik/supervisor sebelum lanjut
      HIGH     → kirim notifikasi untuk ditinjau
      (sistem tidak memvonis; ia menandai untuk diperiksa manusia)

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
                "Refund berisiko tinggi. Perlu tinjauan & otorisasi "
                "pemilik/supervisor sebelum diproses."
            )
        else:
            action  = "NOTIFY_FOR_REVIEW"
            message = "Refund perlu ditinjau pemilik/supervisor."

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
