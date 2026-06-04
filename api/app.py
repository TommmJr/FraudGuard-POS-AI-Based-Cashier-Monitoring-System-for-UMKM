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
