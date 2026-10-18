import os
import joblib
import pandas as pd
from dotenv import load_dotenv
from supabase import create_client
# ==========================================
# 1. CONNECT TO SUPABASE
# ==========================================
load_dotenv()
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
if not SUPABASE_URL or not SUPABASE_KEY:
    raise ValueError("Missing Supabase credentials in .env")
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
# ==========================================
# 2. LOAD TRAINED MODEL
# ==========================================
model = joblib.load("aml_model.pkl")
MODEL_VERSION = "random_forest_v1"
FEATURES = [
    "account_age_days",
    "account_balance",
    "transaction_amount",
    "transaction_type",
    "transaction_frequency_24h",
    "average_transaction_amount",
    "amount_deviation",
    "cash_deposit",
    "international_transfer",
    "new_beneficiary",
    "beneficiary_count_7d",
    "failed_transactions_24h",
    "dormant_account",
    "device_change",
    "location_change",
    "unusual_transaction_time",
    "previous_alerts",
]
# ==========================================
# 3. FETCH ALL TRANSACTIONS IN BATCHES
# ==========================================
print("\nConnecting to Apex AML database...")

all_rows = []
page_size = 500
start = 0

while True:
    response = (
        supabase.table("aml_transactions")
        .select("transaction_id," + ",".join(FEATURES))
        .order("transaction_id")
        .range(start, start + page_size - 1)
        .execute()
    )

    batch = response.data
    all_rows.extend(batch)

    print(f"Fetched {len(all_rows)} transactions...")

    if len(batch) < page_size:
        break

    start += page_size

if not all_rows:
    print("No transactions found.")
    raise SystemExit(0)

df = pd.DataFrame(all_rows)
print(f"Total transactions fetched: {len(df)}")
# ==========================================
# 4. VALIDATE INPUT DATA
# ==========================================
missing_columns = [
    feature for feature in FEATURES
    if feature not in df.columns
]
if missing_columns:
    raise ValueError(f"Missing features: {missing_columns}")
incomplete = df[FEATURES].isnull().any(axis=1)
if incomplete.any():
    print(f"Skipping {incomplete.sum()} incomplete transactions.")
    df = df.loc[~incomplete].copy()
if df.empty:
    print("No complete transactions available.")
    raise SystemExit(0)
# ==========================================
# 5. PREDICT TRANSACTION RISK
# ==========================================
X = df[FEATURES]
df["risk_probability"] = model.predict_proba(X)[:, 1]
df["predicted_suspicious"] = model.predict(X).astype(bool)
df["risk_score"] = (
    df["risk_probability"] * 100
).round().astype(int)
# Demonstration thresholds only.
df["risk_tier"] = "LOW"
df.loc[df["risk_score"] >= 40, "risk_tier"] = "MEDIUM"
df.loc[df["risk_score"] >= 70, "risk_tier"] = "HIGH"
print("\n========== AML PREDICTIONS ==========")
print(
    df[
        [
            "transaction_id",
            "transaction_amount",
            "risk_probability",
            "risk_score",
            "risk_tier",
            "predicted_suspicious",
        ]
    ].head(10).to_string(index=False)
)
# ==========================================
# 6. SAVE PREDICTIONS TO SUPABASE
# ==========================================
records = []
for _, row in df.iterrows():
    records.append({
        "transaction_id": str(row["transaction_id"]),
        "model_version": MODEL_VERSION,
        "risk_probability": round(
            float(row["risk_probability"]), 6
        ),
        "risk_score": int(row["risk_score"]),
        "risk_tier": str(row["risk_tier"]),
        "predicted_suspicious": bool(
            row["predicted_suspicious"]
        ),
    })
print("\nSaving predictions to Supabase...")
for start in range(0, len(records), 100):
    batch = records[start:start + 100]
    (
        supabase.table("ml_predictions")
        .upsert(
            batch,
            on_conflict="transaction_id,model_version"
        )
        .execute()
    )
print(f"Successfully saved {len(records)} predictions!")
print("\nApex AML prediction run completed.")