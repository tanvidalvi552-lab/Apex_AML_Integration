import joblib
import pandas as pd

# Load the previously trained AML model
model = joblib.load("aml_model.pkl")

# Example transaction to analyze
transaction = {
    "account_age_days": 120,
    "account_balance": 50000,
    "transaction_amount": 250000,
    "transaction_type": "INTERNATIONAL_TRANSFER",
    "transaction_frequency_24h": 12,
    "average_transaction_amount": 15000,
    "amount_deviation": 15.67,
    "cash_deposit": 0,
    "international_transfer": 1,
    "new_beneficiary": 1,
    "beneficiary_count_7d": 8,
    "failed_transactions_24h": 2,
    "dormant_account": 0,
    "device_change": 1,
    "location_change": 1,
    "unusual_transaction_time": 1,
    "previous_alerts": 2
}

# Convert transaction into a DataFrame
df = pd.DataFrame([transaction])

# Predict the class
prediction = model.predict(df)[0]

# Get probability of suspicious activity
probability = model.predict_proba(df)[0][1]

# Convert probability to a score from 0 to 100
risk_score = round(probability * 100)

# Display results
print("\n========== APEX AML TRANSACTION ANALYSIS ==========")

print(f"Suspicious prediction: {'YES' if prediction == 1 else 'NO'}")
print(f"Suspicious probability: {probability:.2%}")
print(f"Risk score: {risk_score}/100")

if risk_score >= 70:
    risk_tier = "HIGH"
elif risk_score >= 40:
    risk_tier = "MEDIUM"
else:
    risk_tier = "LOW"

print(f"Risk tier: {risk_tier}")