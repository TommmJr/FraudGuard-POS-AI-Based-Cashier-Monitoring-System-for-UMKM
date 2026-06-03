import os
import sqlite3
import pandas as pd
import numpy as np

# BASE_DIR pointing to the ml_pipeline directory
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SQLITE_PATH = os.path.join(BASE_DIR, "database", "local_pos.db")

USE_CLOUD = False
MYSQL_URL = "mysql+mysqlconnector://user:pass@host/fraudguard"

FEATURE_COLS = [
    "hour_of_day",
    "is_refund",
    "time_gap_seconds",
    "txn_freq_daily",
    "refund_count_daily",
    "refund_ratio_daily",
    "amount_zscore_cashier",
    "amount_rolling_mean_5",
    "amount_deviation_from_mean",
]


def load_data() -> pd.DataFrame:
    """Muat transaksi dari SQLite lokal (atau MySQL cloud bila diaktifkan)."""
    query = """
        SELECT id, cashier_id, timestamp, transaction_type, amount, is_fraud
        FROM   transactions
        ORDER  BY cashier_id, timestamp
    """
    if USE_CLOUD:
        from sqlalchemy import create_engine
        engine = create_engine(MYSQL_URL)
        df = pd.read_sql(query, engine, parse_dates=["timestamp"])
    else:
        conn = sqlite3.connect(SQLITE_PATH)
        df = pd.read_sql_query(query, conn, parse_dates=["timestamp"])
        conn.close()
    return df


def engineer_features(df: pd.DataFrame) -> pd.DataFrame:
    """Hitung ciri perilaku per kasir. Mengembalikan df + kolom fitur."""
    df = df.copy()
    df["date"] = df["timestamp"].dt.date
    df = df.sort_values(["cashier_id", "timestamp"])

    # 1. Jam transaksi (mendeteksi aktivitas di luar jam wajar)
    df["hour_of_day"] = df["timestamp"].dt.hour

    # 2. Penanda refund
    df["is_refund"] = (df["transaction_type"] == "REFUND").astype(int)

    # 3. Jeda antar transaksi per kasir (mendeteksi aksi beruntun cepat)
    df["time_gap_seconds"] = (
        df.groupby("cashier_id")["timestamp"].diff().dt.total_seconds().fillna(0)
    )

    # 4. Jumlah transaksi harian per kasir
    df["txn_freq_daily"] = (
        df.groupby(["cashier_id", "date"])["id"].transform("count")
    )

    # 5. Jumlah refund harian per kasir (sinyal kunci untuk fraud HALUS)
    df["refund_count_daily"] = (
        df.groupby(["cashier_id", "date"])["is_refund"].transform("sum")
    )

    # 6. Rasio refund harian per kasir
    df["refund_ratio_daily"] = df["refund_count_daily"] / df["txn_freq_daily"]

    # 7. Z-score nominal RELATIF terhadap kebiasaan kasir itu sendiri
    g_mean = df.groupby("cashier_id")["amount"].transform("mean")
    g_std  = df.groupby("cashier_id")["amount"].transform("std").replace(0, 1)
    df["amount_zscore_cashier"] = (df["amount"] - g_mean) / g_std

    # 8. Rata-rata bergerak 5 transaksi terakhir per kasir
    df["amount_rolling_mean_5"] = (
        df.groupby("cashier_id")["amount"]
          .transform(lambda x: x.rolling(5, min_periods=1).mean())
    )

    # 9. Deviasi dari rolling mean
    df["amount_deviation_from_mean"] = df["amount"] - df["amount_rolling_mean_5"]

    return df


def get_feature_matrix(df: pd.DataFrame) -> pd.DataFrame:
    """Ambil HANYA kolom fitur numerik (tanpa cashier_id, tanpa is_fraud)."""
    return df[FEATURE_COLS].fillna(0)
