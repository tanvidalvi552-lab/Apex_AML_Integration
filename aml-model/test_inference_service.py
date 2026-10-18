"""
Test Suite for Apex AML Python Inference Service
Tests:
1. Model loading & pipeline verification
2. Valid transaction prediction (features in exact order)
3. Prediction probability and risk score calculation
4. Risk tier mapping (LOW, MEDIUM, HIGH)
5. Missing feature detection and validation error
6. Invalid data type / range rejection
7. Vectorized batch inference
"""

import sys
import os

# Import directly from inference_service
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from inference_service import (
    load_aml_model,
    validate_transaction_features,
    run_inference_single,
    run_inference_batch,
    REQUIRED_FEATURES
)

def run_tests():
    print("=== TEST 1: Loading AML model artifact ===")
    model = load_aml_model("aml_model.pkl")
    assert model is not None, "Model failed to load"
    assert "preprocessor" in model.named_steps, "Missing preprocessor step"
    assert "model" in model.named_steps, "Missing model step"
    print("✓ Model pipeline loaded successfully.")

    print("\n=== TEST 2: Valid transaction prediction (Suspicious sample) ===")
    suspicious_sample = {
        "account_age_days": 120,
        "account_balance": 50000.0,
        "transaction_amount": 250000.0,
        "transaction_type": "INTERNATIONAL_TRANSFER",
        "transaction_frequency_24h": 12,
        "average_transaction_amount": 15000.0,
        "amount_deviation": 16.67,
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
    cleaned, err = validate_transaction_features(suspicious_sample)
    assert err is None, f"Validation failed: {err}"
    assert cleaned is not None
    res = run_inference_single(cleaned)
    print(f"Prediction result: suspicious={res['predicted_suspicious']}, prob={res['risk_probability']}, score={res['risk_score']}, tier={res['risk_tier']}")
    assert res["model_version"] == "random_forest_v1"
    assert res["predicted_suspicious"] is True
    assert res["risk_score"] >= 70
    assert res["risk_tier"] == "HIGH"
    print("✓ Suspicious transaction correctly identified by trained Random Forest.")

    print("\n=== TEST 3: Routine / Low-Risk transaction prediction ===")
    routine_sample = {
        "account_age_days": 850,
        "account_balance": 120000.0,
        "transaction_amount": 2500.0,
        "transaction_type": "UPI",
        "transaction_frequency_24h": 1,
        "average_transaction_amount": 3000.0,
        "amount_deviation": 0.83,
        "cash_deposit": 0,
        "international_transfer": 0,
        "new_beneficiary": 0,
        "beneficiary_count_7d": 1,
        "failed_transactions_24h": 0,
        "dormant_account": 0,
        "device_change": 0,
        "location_change": 0,
        "unusual_transaction_time": 0,
        "previous_alerts": 0
    }
    cleaned, err = validate_transaction_features(routine_sample)
    assert err is None
    res_routine = run_inference_single(cleaned)
    print(f"Routine result: suspicious={res_routine['predicted_suspicious']}, prob={res_routine['risk_probability']}, score={res_routine['risk_score']}, tier={res_routine['risk_tier']}")
    assert res_routine["predicted_suspicious"] is False
    assert res_routine["risk_score"] < 40
    assert res_routine["risk_tier"] == "LOW"
    print("✓ Routine transaction correctly classified as LOW risk.")

    print("\n=== TEST 4: Missing feature validation error ===")
    incomplete_sample = {
        "account_age_days": 100,
        "transaction_amount": 5000.0
        # Missing other 15 features
    }
    cleaned, err = validate_transaction_features(incomplete_sample)
    assert err is not None, "Expected validation error for missing features"
    print(f"Detected error as expected: {err}")
    print("✓ Missing features safely intercepted.")

    print("\n=== TEST 5: Invalid feature data type rejection ===")
    invalid_sample = routine_sample.copy()
    invalid_sample["transaction_amount"] = -500.0 # Negative amount
    cleaned, err = validate_transaction_features(invalid_sample)
    assert err is not None, "Expected validation error for negative amount"
    print(f"Detected error as expected: {err}")
    print("✓ Negative amounts safely rejected.")

    print("\n=== TEST 6: Vectorized Batch Inference ===")
    batch = [suspicious_sample, routine_sample]
    cleaned_batch = [validate_transaction_features(x)[0] for x in batch]
    batch_results = run_inference_batch(cleaned_batch)
    assert len(batch_results) == 2
    assert batch_results[0]["predicted_suspicious"] is True
    assert batch_results[1]["predicted_suspicious"] is False
    print(f"Batch results verified: count={len(batch_results)}")
    print("✓ Batch inference succeeded.")

    print("\n>>> ALL 6 UNIT TESTS PASSED SUCCESSFULLY! <<<")

if __name__ == "__main__":
    run_tests()
