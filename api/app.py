"""
 FraudGuard - api/app.py

 TAHAP 6 - JEMBATAN antara PWA dan model.

 Perubahan dari versi sebelumnya:
   - Query memakai PARAMETER (?), bukan f-string → menutup celah SQL injection.
   - Respons memakai "flag_for_review" (penyesuaian 3), bukan blokir otomatis.
   - endpoint: /api/score kini mengambil histori kasir dari DB
     sebelum scoring sehingga fitur perilaku (z-score, rolling mean,
     refund ratio, dll.) dihitung dengan konteks yang benar,
     bukan hanya dari transaksi kecil yang dikirim di request.

 Jalankan: python api/app.py  (model harus sudah dilatih: 01 lalu 02)
"""

import os
import sys
import sqlite3
import pandas as pd
from flask import Flask, request, jsonify

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "ml_pipeline"))
from scoring_engine import score_transactions, flag_for_review

app = Flask(__name__)

# CORS diperlukan agar PWA (browser) bisa memanggil API ini.
# Dibuat opsional supaya app tetap jalan walau flask_cors belum terpasang.
try:
    from flask_cors import CORS
    CORS(app)
except ImportError:
    print("[!] flask_cors belum terpasang - jalan tanpa CORS "
          "(pasang: pip install flask-cors)")


#  Konstanta path 
# Pakai path ABSOLUT relatif ke lokasi file app.py agar tidak
# bergantung pada working directory saat API dijalankan.
_APP_DIR = os.path.dirname(os.path.abspath(__file__))
_DB_PATH = os.path.join(_APP_DIR, "..", "database", "local_pos.db")

# Berapa banyak transaksi historis per kasir yang diambil sebagai konteks.
# 500 cukup untuk menangkap pola harian & weekly tanpa overhead besar.
_HISTORY_LIMIT = 500


def _get_db_path() -> str:
    """Kembalikan path absolut ke database SQLite."""
    return os.path.normpath(_DB_PATH)


def _load_cashier_history(cashier_ids: list, exclude_ids: set = None) -> pd.DataFrame:
    """
    Ambil transaksi historis dari DB untuk satu atau lebih kasir.

    Digunakan sebagai konteks oleh /api/score agar fitur perilaku
    (z-score, refund ratio, rolling mean, dll.) dihitung dengan benar
    terhadap baseline historis kasir, bukan hanya dari batch kecil.

    Args:
        cashier_ids : Daftar cashier_id yang ingin diambil historinya.
        exclude_ids : Set ID transaksi dari batch baru yang tidak perlu
                      dimasukkan ke konteks (anti duplikat).

    Returns:
        DataFrame dengan kolom: id, cashier_id, timestamp,
                                transaction_type, amount
        Kosong jika DB tidak ditemukan atau kasir belum punya histori.
    """
    db_path = _get_db_path()
    if not os.path.exists(db_path):
        # DB belum ada (misalnya saat test lokal tanpa generate data)
        return pd.DataFrame()

    if not cashier_ids:
        return pd.DataFrame()

    placeholders = ",".join("?" * len(cashier_ids))
    query = f"""
        SELECT id, cashier_id, timestamp, transaction_type, amount
        FROM   transactions
        WHERE  cashier_id IN ({placeholders})
        ORDER  BY cashier_id, timestamp DESC
        LIMIT  {_HISTORY_LIMIT * len(cashier_ids)}
    """
    try:
        conn = sqlite3.connect(db_path)
        df   = pd.read_sql_query(
            query, conn,
            params=list(cashier_ids),
            parse_dates=["timestamp"],
        )
        conn.close()
    except Exception:
        return pd.DataFrame()

    # Buang transaksi yang ID-nya sama dengan batch baru (anti duplikat)
    if exclude_ids:
        df = df[~df["id"].isin(exclude_ids)]

    return df


#  Endpoints 

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "service": "FraudGuard ML API (Pola B)"})


@app.route("/api/score", methods=["POST"])
def score_endpoint():
    """
    Terima daftar transaksi → kembalikan skor + daftar tinjauan.

    FIX BUG per-batch:
      Sebelum scoring, ambil histori kasir dari DB dan kirimkan sebagai
      df_context ke score_transactions(). Dengan begitu fitur perilaku
      dihitung dari konteks penuh, bukan hanya dari transaksi di request.
    """
    try:
        data = request.get_json()
        if not data or "transactions" not in data:
            return jsonify({"error": "Field 'transactions' wajib ada"}), 400

        df = pd.DataFrame(data["transactions"])
        df["timestamp"] = pd.to_datetime(df["timestamp"])

        #  FIX: ambil histori kasir dari DB sebagai konteks 
        cashier_ids = df["cashier_id"].unique().tolist()
        batch_ids   = set(df["id"].astype(str).tolist())
        df_context  = _load_cashier_history(cashier_ids, exclude_ids=batch_ids)
        

        # Kirim df_context ke score_transactions — jika kosong (DB tidak ada),
        # fungsi otomatis fallback ke perilaku lama (backwards compatible).
        model_type = data.get("model_type", None)   # opsional dari request
        scored     = score_transactions(df, model_type=model_type, df_context=df_context)
        review     = flag_for_review(scored)

        records = scored[[
            "id", "cashier_id", "timestamp", "transaction_type",
            "amount", "fraud_score", "risk_level",
        ]].to_dict(orient="records")
        for r in records:
            r["timestamp"] = str(r["timestamp"])

        return jsonify({
            "status":  "success",
            "scored":  records,
            "review":  review,     # daftar tinjauan, bukan perintah blokir
            "context_rows_used": len(df_context),  # debug info
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/summary/<cashier_id>", methods=["GET"])
def cashier_summary(cashier_id):
    """Ringkasan risiko per kasir (untuk dashboard)."""
    conn = sqlite3.connect(_get_db_path())
    # PARAMETER (?) → aman dari SQL injection
    df = pd.read_sql_query(
        "SELECT id, cashier_id, timestamp, transaction_type, amount, is_fraud "
        "FROM transactions WHERE cashier_id = ? "
        "ORDER BY timestamp DESC LIMIT 500",
        conn, params=(cashier_id,), parse_dates=["timestamp"],
    )
    conn.close()

    if df.empty:
        return jsonify({"error": "Kasir tidak ditemukan"}), 404

    # /summary sudah ambil banyak data dari DB → konteks sudah cukup,
    # tidak perlu df_context tambahan.
    scored = score_transactions(df)
    return jsonify({
        "cashier_id":         cashier_id,
        "total_transactions": int(len(scored)),
        "avg_fraud_score":    round(float(scored["fraud_score"].mean()), 2),
        "max_fraud_score":    round(float(scored["fraud_score"].max()), 2),
        "critical_count":     int((scored["risk_level"] == "CRITICAL").sum()),
        "high_count":         int((scored["risk_level"] == "HIGH").sum()),
        "recent": scored[["timestamp", "fraud_score", "risk_level"]]
                    .head(10).astype({"timestamp": str}).to_dict(orient="records"),
    })


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
