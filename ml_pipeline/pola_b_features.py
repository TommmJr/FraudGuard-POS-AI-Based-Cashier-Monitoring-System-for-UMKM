import os
import joblib
import numpy as np
import pandas as pd

from feature_engineering import engineer_features, get_feature_matrix

BASE_DIR     = os.path.dirname(os.path.abspath(__file__))
IF_MODEL_PATH = os.path.join(BASE_DIR, "models", "isolation_forest.pkl")


def build_pola_b_matrix(df_raw: pd.DataFrame, if_model=None) -> pd.DataFrame:
    """
    Dari transaksi mentah → matriks fitur Pola B.

    Langkah:
      1. Hitung fitur dasar perilaku (feature_engineering)
      2. Hitung skor anomali Isolation Forest
      3. Tambahkan skor itu sebagai kolom fitur 'if_anomaly_score'

    Catatan decision_function:
      - Makin NEGATIF = makin anomali (model standar)
      - Kita balik tandanya agar 'if_anomaly_score' makin TINGGI = makin anomali
      - Lebih intuitif sebagai fitur
    
    Args:
        df_raw (pd.DataFrame): Transaksi mentah (id, cashier_id, timestamp, etc)
        if_model: Model IF yang sudah dilatih. Jika None, load dari IF_MODEL_PATH
    
    Returns:
        pd.DataFrame: Matriks fitur Pola B (10 kolom: 9 dasar + 1 IF score)
    """
    if if_model is None:
        if_model = joblib.load(IF_MODEL_PATH)

    # Step 1: Engineer fitur dasar
    feat = engineer_features(df_raw)
    X_base = get_feature_matrix(feat)  # 9 fitur dasar

    # Step 2: Hitung skor anomali IF
    raw_if = if_model.decision_function(X_base)  # makin negatif = makin aneh
    
    # Step 3: Tambahkan ke fitur matrix
    X = X_base.copy()
    X["if_anomaly_score"] = -raw_if  # balik tanda: makin tinggi = makin aneh
    
    return X
