"""
 FraudGuard - api/app.py

 API Backend — Jembatan antara PWA dan ML Pipeline.

 Endpoint yang tersedia:
   GET  /health                  → Status API & model
   POST /api/score               → Skor fraud untuk batch transaksi
   GET  /api/summary/<cashier_id>→ Ringkasan risiko per kasir
   GET  /api/cashiers            → Daftar semua kasir + statistik
   GET  /api/dashboard           → Statistik keseluruhan (dashboard)
   POST /api/transactions        → Simpan transaksi baru ke DB
   GET  /api/transactions        → Ambil transaksi (filter & pagination)
   GET  /api/model-info          → Info model ML yang tersedia
   POST /api/batch-score         → Score semua transaksi di DB

 Fitur:
   - Query memakai PARAMETER (?), bukan f-string → aman dari SQL injection.
   - Respons memakai "flag_for_review", bukan blokir otomatis.
   - /api/score mengambil histori kasir dari DB sebelum scoring
     sehingga fitur perilaku dihitung dengan konteks yang benar.
   - Input validation & proper error handling.

 Jalankan: python api/app.py  (model harus sudah dilatih: 01 lalu 02)
"""

import os
import sys
import sqlite3
import logging
from datetime import datetime

import pandas as pd
from flask import Flask, request, jsonify

#  Setup logging 
logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] %(levelname)s - %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("fraudguard")

#  Import ML pipeline 
_APP_DIR = os.path.dirname(os.path.abspath(__file__))
_ML_DIR = os.path.join(_APP_DIR, "..", "ml_pipeline")
sys.path.insert(0, _ML_DIR)

from scoring_engine import score_transactions, flag_for_review, RISK_LEVELS
from feature_engineering import FEATURE_COLS

app = Flask(__name__)

# CORS diperlukan agar PWA (browser) bisa memanggil API ini.
# Dibuat opsional supaya app tetap jalan walau flask_cors belum terpasang.
try:
    from flask_cors import CORS
    CORS(app)
except ImportError:
    logger.warning(
        "flask_cors belum terpasang - jalan tanpa CORS "
        "(pasang: pip install flask-cors)"
    )


#  Konstanta & Helpers

# Path ke database
_DB_PATH = os.path.join(_APP_DIR, "..", "ml_pipeline", "database", "local_pos.db")

# Berapa banyak transaksi historis per kasir yang diambil sebagai konteks.
_HISTORY_LIMIT = 500

# Default pagination
_DEFAULT_PAGE_SIZE = 50
_MAX_PAGE_SIZE = 500


def _get_db_path() -> str:
    """Kembalikan path absolut ke database SQLite."""
    return os.path.normpath(_DB_PATH)


def _get_db_connection() -> sqlite3.Connection:
    """Buat koneksi database dengan row_factory untuk dict-like access."""
    db_path = _get_db_path()
    if not os.path.exists(db_path):
        raise FileNotFoundError(
            f"Database tidak ditemukan di: {db_path}. "
            "Jalankan generate_synthetic_data.ipynb terlebih dahulu."
        )
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn


def _ensure_db():
    """
    Pastikan database dan tabel transactions ada.
    Jika belum ada, buat database kosong dengan skema yang benar.
    """
    db_path = _get_db_path()
    db_dir = os.path.dirname(db_path)
    os.makedirs(db_dir, exist_ok=True)

    conn = sqlite3.connect(db_path)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS transactions (
            id              TEXT PRIMARY KEY,
            cashier_id      TEXT NOT NULL,
            timestamp       TEXT NOT NULL,
            transaction_type TEXT NOT NULL,
            amount          REAL NOT NULL,
            is_fraud        INTEGER DEFAULT 0,
            is_synced       INTEGER DEFAULT 0,
            fraud_score     REAL,
            risk_level      TEXT,
            created_at      TEXT DEFAULT (datetime('now'))
        )
    """)
    conn.commit()
    conn.close()
    logger.info(f"Database siap di: {db_path}")


def _check_models_available() -> dict:
    """Cek ketersediaan file model ML."""
    models_dir = os.path.join(_ML_DIR, "models")
    return {
        "isolation_forest": os.path.exists(os.path.join(models_dir, "isolation_forest.pkl")),
        "supervised_rf": os.path.exists(os.path.join(models_dir, "supervised_rf.pkl")),
        "supervised_xgb": os.path.exists(os.path.join(models_dir, "supervised_xgb.pkl")),
    }


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
        df = pd.read_sql_query(
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


def _validate_transaction(txn: dict) -> list:
    """Validasi field transaksi. Return list of error messages."""
    errors = []
    required = ["cashier_id", "timestamp", "transaction_type", "amount"]
    for field in required:
        if field not in txn or txn[field] is None:
            errors.append(f"Field '{field}' wajib ada")

    if "transaction_type" in txn:
        valid_types = ["SALE", "REFUND", "VOID", "DISCOUNT"]
        if txn["transaction_type"] not in valid_types:
            errors.append(
                f"transaction_type harus salah satu dari: {valid_types}"
            )

    if "amount" in txn:
        try:
            amount = float(txn["amount"])
            if amount < 0:
                errors.append("amount tidak boleh negatif")
        except (TypeError, ValueError):
            errors.append("amount harus berupa angka")

    return errors

#  Endpoints



#  Health Check 

@app.route("/health", methods=["GET"])
def health():
    """Status API, database, dan model."""
    models = _check_models_available()
    db_exists = os.path.exists(_get_db_path())

    all_models_ready = all(models.values())
    status = "ok" if (db_exists and all_models_ready) else "degraded"

    return jsonify({
        "status": status,
        "service": "FraudGuard ML API",
        "database": "connected" if db_exists else "not_found",
        "models": models,
        "features": FEATURE_COLS,
        "risk_levels": RISK_LEVELS,
        "timestamp": datetime.now().isoformat(),
    })


#  Score Transactions 

@app.route("/api/score", methods=["POST"])
def score_endpoint():
    """
    Terima daftar transaksi → kembalikan skor + daftar tinjauan.

    Body JSON:
    {
        "transactions": [
            {"id": "...", "cashier_id": "...", "timestamp": "...",
             "transaction_type": "SALE|REFUND", "amount": 50000}
        ],
        "model_type": "rf" | "xgboost"   (opsional, default: "rf")
    }
    """
    try:
        data = request.get_json()
        if not data or "transactions" not in data:
            return jsonify({"error": "Field 'transactions' wajib ada"}), 400

        transactions = data["transactions"]
        if not isinstance(transactions, list) or len(transactions) == 0:
            return jsonify({"error": "'transactions' harus berupa array non-kosong"}), 400

        # Validasi setiap transaksi
        for i, txn in enumerate(transactions):
            errors = _validate_transaction(txn)
            if errors:
                return jsonify({
                    "error": f"Transaksi ke-{i} tidak valid",
                    "details": errors,
                }), 400

        df = pd.DataFrame(transactions)
        df["timestamp"] = pd.to_datetime(df["timestamp"])

        # Pastikan kolom 'id' ada
        if "id" not in df.columns:
            import uuid
            df["id"] = [str(uuid.uuid4()) for _ in range(len(df))]

        # Ambil histori kasir dari DB sebagai konteks
        cashier_ids = df["cashier_id"].unique().tolist()
        batch_ids = set(df["id"].astype(str).tolist())
        df_context = _load_cashier_history(cashier_ids, exclude_ids=batch_ids)

        # Scoring
        model_type = data.get("model_type", None)
        scored = score_transactions(df, model_type=model_type, df_context=df_context)
        review = flag_for_review(scored)

        # Format output
        output_cols = [
            "id", "cashier_id", "timestamp", "transaction_type",
            "amount", "fraud_score", "risk_level", "model_used",
        ]
        # Hanya ambil kolom yang ada
        available_cols = [c for c in output_cols if c in scored.columns]
        records = scored[available_cols].to_dict(orient="records")
        for r in records:
            r["timestamp"] = str(r["timestamp"])

        logger.info(
            f"Scored {len(records)} transaksi, "
            f"{review['total_flagged']} ditandai untuk review"
        )

        return jsonify({
            "status": "success",
            "scored": records,
            "review": review,
            "context_rows_used": len(df_context),
        })
    except FileNotFoundError as e:
        return jsonify({"error": str(e)}), 503
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        logger.error(f"Error di /api/score: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500


#  Cashier Summary 

@app.route("/api/summary/<cashier_id>", methods=["GET"])
def cashier_summary(cashier_id):
    """Ringkasan risiko per kasir (untuk dashboard)."""
    try:
        conn = _get_db_connection()
        df = pd.read_sql_query(
            "SELECT id, cashier_id, timestamp, transaction_type, amount, is_fraud "
            "FROM transactions WHERE cashier_id = ? "
            "ORDER BY timestamp DESC LIMIT 500",
            conn, params=(cashier_id,), parse_dates=["timestamp"],
        )
        conn.close()

        if df.empty:
            return jsonify({"error": "Kasir tidak ditemukan"}), 404

        scored = score_transactions(df)

        # Hitung statistik tambahan
        total_amount = float(df["amount"].sum())
        refund_count = int((df["transaction_type"] == "REFUND").sum())
        refund_ratio = round(refund_count / len(df) * 100, 2) if len(df) > 0 else 0

        return jsonify({
            "cashier_id": cashier_id,
            "total_transactions": int(len(scored)),
            "total_amount": round(total_amount, 2),
            "avg_fraud_score": round(float(scored["fraud_score"].mean()), 2),
            "max_fraud_score": round(float(scored["fraud_score"].max()), 2),
            "min_fraud_score": round(float(scored["fraud_score"].min()), 2),
            "critical_count": int((scored["risk_level"] == "CRITICAL").sum()),
            "high_count": int((scored["risk_level"] == "HIGH").sum()),
            "medium_count": int((scored["risk_level"] == "MEDIUM").sum()),
            "low_count": int((scored["risk_level"] == "LOW").sum()),
            "refund_count": refund_count,
            "refund_ratio_pct": refund_ratio,
            "recent": scored[["id", "timestamp", "transaction_type", "amount",
                              "fraud_score", "risk_level"]]
                .head(10).astype({"timestamp": str}).to_dict(orient="records"),
        })
    except FileNotFoundError as e:
        return jsonify({"error": str(e)}), 503
    except Exception as e:
        logger.error(f"Error di /api/summary: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500


#  Daftar Kasir 

@app.route("/api/cashiers", methods=["GET"])
def list_cashiers():
    """
    Daftar semua kasir beserta statistik ringkas.

    Response:
    {
        "cashiers": [
            {
                "cashier_id": "C001",
                "total_transactions": 150,
                "total_amount": 5000000,
                "refund_count": 10,
                "refund_ratio_pct": 6.67,
                "fraud_count": 5,
                "last_transaction": "2026-06-03 10:00:00"
            }
        ]
    }
    """
    try:
        conn = _get_db_connection()
        df = pd.read_sql_query("""
            SELECT
                cashier_id,
                COUNT(*)                                        AS total_transactions,
                ROUND(SUM(amount), 2)                           AS total_amount,
                SUM(CASE WHEN transaction_type = 'REFUND'
                         THEN 1 ELSE 0 END)                    AS refund_count,
                SUM(CASE WHEN is_fraud = 1
                         THEN 1 ELSE 0 END)                    AS fraud_count,
                MAX(timestamp)                                  AS last_transaction
            FROM transactions
            GROUP BY cashier_id
            ORDER BY cashier_id
        """, conn)
        conn.close()

        # Hitung refund ratio
        df["refund_ratio_pct"] = (
            (df["refund_count"] / df["total_transactions"] * 100).round(2)
        )

        return jsonify({
            "status": "success",
            "total_cashiers": len(df),
            "cashiers": df.to_dict(orient="records"),
        })
    except FileNotFoundError as e:
        return jsonify({"error": str(e)}), 503
    except Exception as e:
        logger.error(f"Error di /api/cashiers: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500


#  Dashboard Stats 

@app.route("/api/dashboard", methods=["GET"])
def dashboard_stats():
    """
    Statistik keseluruhan untuk dashboard PWA.

    Query params (opsional):
        ?days=7   → hanya data 7 hari terakhir (default: semua)
    """
    try:
        conn = _get_db_connection()

        days = request.args.get("days", None, type=int)
        where_clause = ""
        params = []
        if days:
            where_clause = "WHERE timestamp >= datetime('now', ?)"
            params = [f"-{days} days"]

        # Statistik umum
        stats = pd.read_sql_query(f"""
            SELECT
                COUNT(*)                                        AS total_transactions,
                COUNT(DISTINCT cashier_id)                      AS total_cashiers,
                ROUND(SUM(amount), 2)                           AS total_amount,
                ROUND(AVG(amount), 2)                           AS avg_amount,
                SUM(CASE WHEN transaction_type = 'REFUND'
                         THEN 1 ELSE 0 END)                    AS total_refunds,
                SUM(CASE WHEN is_fraud = 1
                         THEN 1 ELSE 0 END)                    AS total_fraud_labeled
            FROM transactions
            {where_clause}
        """, conn, params=params)

        # Transaksi per hari (untuk chart)
        daily = pd.read_sql_query(f"""
            SELECT
                DATE(timestamp)                                 AS date,
                COUNT(*)                                        AS count,
                ROUND(SUM(amount), 2)                           AS amount,
                SUM(CASE WHEN transaction_type = 'REFUND'
                         THEN 1 ELSE 0 END)                    AS refunds,
                SUM(CASE WHEN is_fraud = 1
                         THEN 1 ELSE 0 END)                    AS frauds
            FROM transactions
            {where_clause}
            GROUP BY DATE(timestamp)
            ORDER BY date DESC
            LIMIT 30
        """, conn, params=params)

        # Top kasir berdasarkan refund ratio
        top_refund = pd.read_sql_query(f"""
            SELECT
                cashier_id,
                COUNT(*)                                        AS total_txn,
                SUM(CASE WHEN transaction_type = 'REFUND'
                         THEN 1 ELSE 0 END)                    AS refund_count,
                ROUND(
                    SUM(CASE WHEN transaction_type = 'REFUND'
                             THEN 1.0 ELSE 0 END) / COUNT(*) * 100,
                    2
                )                                               AS refund_ratio_pct
            FROM transactions
            {where_clause}
            GROUP BY cashier_id
            HAVING total_txn >= 5
            ORDER BY refund_ratio_pct DESC
            LIMIT 10
        """, conn, params=params)

        conn.close()

        row = stats.iloc[0]
        total_txn = int(row["total_transactions"])
        refund_ratio = round(
            float(row["total_refunds"]) / total_txn * 100, 2
        ) if total_txn > 0 else 0

        return jsonify({
            "status": "success",
            "period": f"last_{days}_days" if days else "all_time",
            "summary": {
                "total_transactions": total_txn,
                "total_cashiers": int(row["total_cashiers"]),
                "total_amount": float(row["total_amount"] or 0),
                "avg_amount": float(row["avg_amount"] or 0),
                "total_refunds": int(row["total_refunds"]),
                "total_fraud_labeled": int(row["total_fraud_labeled"]),
                "refund_ratio_pct": refund_ratio,
            },
            "daily_trend": daily.to_dict(orient="records"),
            "top_refund_cashiers": top_refund.to_dict(orient="records"),
        })
    except FileNotFoundError as e:
        return jsonify({"error": str(e)}), 503
    except Exception as e:
        logger.error(f"Error di /api/dashboard: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500


#  Simpan Transaksi Baru 

@app.route("/api/transactions", methods=["POST"])
def save_transactions():
    """
    Simpan satu atau lebih transaksi baru ke DB.
    Digunakan oleh PWA untuk sinkronisasi offline → online.

    Body JSON:
    {
        "transactions": [
            {
                "id": "uuid-...",
                "cashier_id": "C001",
                "timestamp": "2026-06-03T10:00:00",
                "transaction_type": "SALE",
                "amount": 50000
            }
        ]
    }
    """
    try:
        data = request.get_json()
        if not data or "transactions" not in data:
            return jsonify({"error": "Field 'transactions' wajib ada"}), 400

        transactions = data["transactions"]
        if not isinstance(transactions, list) or len(transactions) == 0:
            return jsonify({"error": "'transactions' harus berupa array non-kosong"}), 400

        # Validasi
        for i, txn in enumerate(transactions):
            errors = _validate_transaction(txn)
            if errors:
                return jsonify({
                    "error": f"Transaksi ke-{i} tidak valid",
                    "details": errors,
                }), 400

        _ensure_db()
        conn = sqlite3.connect(_get_db_path())
        cursor = conn.cursor()

        saved = 0
        skipped = 0
        for txn in transactions:
            import uuid as uuid_mod
            txn_id = txn.get("id", str(uuid_mod.uuid4()))
            try:
                cursor.execute("""
                    INSERT OR IGNORE INTO transactions
                        (id, cashier_id, timestamp, transaction_type, amount, is_synced)
                    VALUES (?, ?, ?, ?, ?, 1)
                """, (
                    txn_id,
                    txn["cashier_id"],
                    txn["timestamp"],
                    txn["transaction_type"],
                    float(txn["amount"]),
                ))
                if cursor.rowcount > 0:
                    saved += 1
                else:
                    skipped += 1
            except sqlite3.IntegrityError:
                skipped += 1

        conn.commit()
        conn.close()

        logger.info(f"Saved {saved} transaksi, skipped {skipped} duplikat")

        return jsonify({
            "status": "success",
            "saved": saved,
            "skipped_duplicates": skipped,
            "total_received": len(transactions),
        })
    except Exception as e:
        logger.error(f"Error di POST /api/transactions: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500


#  Ambil Transaksi (dengan filter & pagination) 

@app.route("/api/transactions", methods=["GET"])
def get_transactions():
    """
    Ambil transaksi dengan filter dan pagination.

    Query params:
        ?cashier_id=C001        → filter kasir tertentu
        ?type=REFUND            → filter tipe transaksi
        ?start_date=2026-06-01  → filter dari tanggal
        ?end_date=2026-06-03    → filter sampai tanggal
        ?page=1                 → halaman (default: 1)
        ?per_page=50            → jumlah per halaman (default: 50, max: 500)
        ?sort=desc              → urutan waktu: asc/desc (default: desc)
    """
    try:
        conn = _get_db_connection()

        # Parse query params
        cashier_id = request.args.get("cashier_id")
        txn_type = request.args.get("type")
        start_date = request.args.get("start_date")
        end_date = request.args.get("end_date")
        page = request.args.get("page", 1, type=int)
        per_page = min(
            request.args.get("per_page", _DEFAULT_PAGE_SIZE, type=int),
            _MAX_PAGE_SIZE,
        )
        sort_order = request.args.get("sort", "desc").upper()
        if sort_order not in ("ASC", "DESC"):
            sort_order = "DESC"

        # Build query
        conditions = []
        params = []

        if cashier_id:
            conditions.append("cashier_id = ?")
            params.append(cashier_id)
        if txn_type:
            conditions.append("transaction_type = ?")
            params.append(txn_type)
        if start_date:
            conditions.append("timestamp >= ?")
            params.append(start_date)
        if end_date:
            conditions.append("timestamp <= ?")
            params.append(end_date + " 23:59:59")

        where_clause = ""
        if conditions:
            where_clause = "WHERE " + " AND ".join(conditions)

        # Count total
        count_query = f"SELECT COUNT(*) as total FROM transactions {where_clause}"
        total = pd.read_sql_query(count_query, conn, params=params).iloc[0]["total"]

        # Fetch data
        offset = (page - 1) * per_page
        data_query = f"""
            SELECT id, cashier_id, timestamp, transaction_type, amount,
                   is_fraud, fraud_score, risk_level
            FROM transactions
            {where_clause}
            ORDER BY timestamp {sort_order}
            LIMIT ? OFFSET ?
        """
        df = pd.read_sql_query(data_query, conn, params=params + [per_page, offset])
        conn.close()

        return jsonify({
            "status": "success",
            "transactions": df.to_dict(orient="records"),
            "pagination": {
                "page": page,
                "per_page": per_page,
                "total": int(total),
                "total_pages": max(1, -(-int(total) // per_page)),  # ceil division
            },
        })
    except FileNotFoundError as e:
        return jsonify({"error": str(e)}), 503
    except Exception as e:
        logger.error(f"Error di GET /api/transactions: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500


#  Model Info 

@app.route("/api/model-info", methods=["GET"])
def model_info():
    """Info model ML yang tersedia."""
    models = _check_models_available()
    models_dir = os.path.join(_ML_DIR, "models")

    model_details = {}
    for name, exists in models.items():
        detail = {"available": exists}
        if exists:
            path = os.path.join(models_dir, f"{name}.pkl")
            stat = os.stat(path)
            detail["file_size_mb"] = round(stat.st_size / (1024 * 1024), 2)
            detail["last_modified"] = datetime.fromtimestamp(
                stat.st_mtime
            ).isoformat()
        model_details[name] = detail

    return jsonify({
        "status": "success",
        "default_model": "rf",
        "available_model_types": ["rf", "xgboost"],
        "models": model_details,
        "feature_columns": FEATURE_COLS,
        "risk_levels": RISK_LEVELS,
        "pipeline_stages": [
            "1. generate_synthetic_data.ipynb → Buat data sintetis",
            "2. 01_train_isolation_forest.ipynb → Train Isolation Forest",
            "3. 02_train_supervised.ipynb → Train RF & XGBoost",
            "4. 03_evaluate.ipynb → Evaluasi model",
            "5. 04_tune.ipynb → Hyperparameter tuning",
        ],
    })


#  Batch Score (score semua di DB) 

@app.route("/api/batch-score", methods=["POST"])
def batch_score():
    """
    Score semua transaksi di DB (atau yang belum punya skor).

    Body JSON (opsional):
    {
        "model_type": "rf" | "xgboost",
        "rescore_all": false,
        "cashier_id": "C001"       (opsional, filter kasir tertentu)
    }
    """
    try:
        data = request.get_json() or {}
        model_type = data.get("model_type", None)
        rescore_all = data.get("rescore_all", False)
        cashier_filter = data.get("cashier_id", None)

        conn = _get_db_connection()

        # Build query
        conditions = []
        params = []
        if not rescore_all:
            conditions.append("fraud_score IS NULL")
        if cashier_filter:
            conditions.append("cashier_id = ?")
            params.append(cashier_filter)

        where_clause = ""
        if conditions:
            where_clause = "WHERE " + " AND ".join(conditions)

        df = pd.read_sql_query(
            f"SELECT id, cashier_id, timestamp, transaction_type, amount "
            f"FROM transactions {where_clause} "
            f"ORDER BY cashier_id, timestamp",
            conn, params=params, parse_dates=["timestamp"],
        )
        conn.close()

        if df.empty:
            return jsonify({
                "status": "success",
                "message": "Tidak ada transaksi yang perlu di-score",
                "scored_count": 0,
            })

        # Score
        scored = score_transactions(df, model_type=model_type)
        review = flag_for_review(scored)

        # Update DB dengan skor
        conn = sqlite3.connect(_get_db_path())
        cursor = conn.cursor()
        for _, row in scored.iterrows():
            cursor.execute(
                "UPDATE transactions SET fraud_score = ?, risk_level = ? WHERE id = ?",
                (float(row["fraud_score"]), row["risk_level"], row["id"]),
            )
        conn.commit()
        conn.close()

        logger.info(
            f"Batch scored {len(scored)} transaksi, "
            f"{review['total_flagged']} ditandai"
        )

        return jsonify({
            "status": "success",
            "scored_count": len(scored),
            "review": review,
            "risk_distribution": {
                "CRITICAL": int((scored["risk_level"] == "CRITICAL").sum()),
                "HIGH": int((scored["risk_level"] == "HIGH").sum()),
                "MEDIUM": int((scored["risk_level"] == "MEDIUM").sum()),
                "LOW": int((scored["risk_level"] == "LOW").sum()),
            },
        })
    except FileNotFoundError as e:
        return jsonify({"error": str(e)}), 503
    except Exception as e:
        logger.error(f"Error di /api/batch-score: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500


# 
#  Main
# 

if __name__ == "__main__":
    logger.info("=" * 50)
    logger.info("FraudGuard ML API Starting...")
    logger.info(f"Database: {_get_db_path()}")
    logger.info(f"Models: {_check_models_available()}")
    logger.info("=" * 50)

    _ensure_db()
    app.run(host="0.0.0.0", port=5000, debug=True)
