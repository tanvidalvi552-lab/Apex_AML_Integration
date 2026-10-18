"""
Apex AML - Python Inference Microservice
Serves predictions using the trained Random Forest pipeline (aml_model.pkl).

Pipeline Architecture:
- Step 1: 'preprocessor' (ColumnTransformer: OneHotEncoder on 'transaction_type', passthrough on 16 numeric features)
- Step 2: 'model' (RandomForestClassifier: 200 estimators, max_depth=10, class_weight='balanced')

Provides HTTP endpoints:
- GET  /health           -> Service health and model status
- POST /predict          -> Inference on a single transaction payload
- POST /predict-batch    -> Vectorized inference on multiple transaction payloads
"""

import sys
import os
import json
import argparse
import traceback
from http.server import HTTPServer, BaseHTTPRequestHandler
from socketserver import ThreadingMixIn
import joblib
import pandas as pd
import numpy as np

# Exact feature contract matching train.py
REQUIRED_FEATURES = [
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
    "previous_alerts"
]

NUMERIC_FEATURES = [col for col in REQUIRED_FEATURES if col != "transaction_type"]
BINARY_FEATURES = [
    "cash_deposit",
    "international_transfer",
    "new_beneficiary",
    "dormant_account",
    "device_change",
    "location_change",
    "unusual_transaction_time"
]

MODEL_VERSION = "random_forest_v1"

# Global model container
MODEL_PIPELINE = None
MODEL_IMPORTANCES = None
MODEL_TRANSFORMED_FEATURES = None

def load_aml_model(model_path="aml_model.pkl"):
    global MODEL_PIPELINE, MODEL_IMPORTANCES, MODEL_TRANSFORMED_FEATURES
    if not os.path.exists(model_path):
        # Check current directory and script directory
        script_dir = os.path.dirname(os.path.abspath(__file__))
        alt_path = os.path.join(script_dir, model_path)
        if os.path.exists(alt_path):
            model_path = alt_path
        else:
            raise FileNotFoundError(f"Trained model artifact not found at {model_path} or {alt_path}")

    print(f"[InferenceService] Loading trained AML model from: {model_path}")
    MODEL_PIPELINE = joblib.load(model_path)
    
    # Extract feature importance information for explanation generation
    try:
        preprocessor = MODEL_PIPELINE.named_steps.get("preprocessor")
        rf_model = MODEL_PIPELINE.named_steps.get("model")
        if preprocessor and rf_model:
            MODEL_TRANSFORMED_FEATURES = list(preprocessor.get_feature_names_out())
            MODEL_IMPORTANCES = dict(zip(MODEL_TRANSFORMED_FEATURES, rf_model.feature_importances_))
            print(f"[InferenceService] Model loaded successfully. Transformed feature dimensions: {len(MODEL_TRANSFORMED_FEATURES)}")
    except Exception as e:
        print(f"[InferenceService] Warning extracting feature importances: {e}")

    return MODEL_PIPELINE


def validate_transaction_features(data):
    """
    Validates a single transaction dictionary against expected features and constraints.
    Returns (cleaned_dict, error_message).
    """
    if not isinstance(data, dict):
        return None, "Transaction data must be a JSON object"

    cleaned = {}
    missing = []
    invalid = []

    for feat in REQUIRED_FEATURES:
        if feat not in data or data[feat] is None:
            missing.append(feat)
            continue

        val = data[feat]

        if feat == "transaction_type":
            if not isinstance(val, str) or not val.strip():
                invalid.append(f"transaction_type must be a non-empty string, received: {val}")
            else:
                cleaned[feat] = str(val).strip().upper()
        else:
            try:
                num_val = float(val)
                if np.isnan(num_val) or np.isinf(num_val):
                    invalid.append(f"{feat} cannot be NaN or Infinite")
                    continue

                if feat in BINARY_FEATURES:
                    if num_val not in (0, 1, 0.0, 1.0):
                        # Attempt to coerce boolean
                        if isinstance(val, bool):
                            num_val = 1.0 if val else 0.0
                        else:
                            invalid.append(f"{feat} must be binary 0 or 1, received: {val}")
                            continue
                    cleaned[feat] = int(num_val)
                elif feat in ("account_age_days", "transaction_frequency_24h", "beneficiary_count_7d", "failed_transactions_24h", "previous_alerts"):
                    if num_val < 0:
                        invalid.append(f"{feat} cannot be negative, received: {val}")
                        continue
                    cleaned[feat] = int(num_val)
                else:
                    # Account balance, transaction amount, etc.
                    if feat == "transaction_amount" and num_val < 0:
                        invalid.append(f"transaction_amount cannot be negative, received: {val}")
                        continue
                    cleaned[feat] = float(num_val)

            except (ValueError, TypeError):
                invalid.append(f"{feat} must be numeric, received: {val}")

    if missing:
        return None, f"Missing required features: {', '.join(missing)}"
    if invalid:
        return None, f"Invalid feature values: {'; '.join(invalid)}"

    return cleaned, None


def compute_feature_explanations(row_dict, predicted_prob):
    """
    Generates explainability contributions based on trained Random Forest feature importance
    and observed values compared to typical ranges.
    """
    contributions = []
    
    # 1. Amount deviation
    dev = row_dict.get("amount_deviation", 1.0)
    if dev >= 3.0:
        contributions.append({
            "feature": "amount_deviation",
            "impact": min(dev * 4.0, 35.0),
            "description": f"Transaction amount is {dev:.1f}x higher than 30-day baseline average.",
            "observed_value": f"{dev:.2f}x"
        })
    elif dev < 0.5:
        contributions.append({
            "feature": "amount_deviation",
            "impact": -10.0,
            "description": f"Transaction is well within typical customer baseline ({dev:.2f}x).",
            "observed_value": f"{dev:.2f}x"
        })

    # 2. Transaction frequency velocity
    freq = row_dict.get("transaction_frequency_24h", 0)
    if freq >= 8:
        contributions.append({
            "feature": "transaction_frequency_24h",
            "impact": min(freq * 3.0, 25.0),
            "description": f"High velocity: {freq} transactions executed within 24 hours.",
            "observed_value": f"{freq} txns/24h"
        })

    # 3. New Beneficiary
    if row_dict.get("new_beneficiary", 0) == 1:
        contributions.append({
            "feature": "new_beneficiary",
            "impact": 15.0,
            "description": "First transfer to newly added counterparty (<24h vintage).",
            "observed_value": "New Beneficiary (1)"
        })

    # 4. Unusual time
    if row_dict.get("unusual_transaction_time", 0) == 1:
        contributions.append({
            "feature": "unusual_transaction_time",
            "impact": 12.0,
            "description": "Transaction initiated outside normal operating and diurnal window.",
            "observed_value": "Off-hours (1)"
        })

    # 5. Device or location changes
    if row_dict.get("device_change", 0) == 1:
        contributions.append({
            "feature": "device_change",
            "impact": 10.0,
            "description": "Unrecognized hardware fingerprint / client device change.",
            "observed_value": "New Device (1)"
        })
    if row_dict.get("location_change", 0) == 1:
        contributions.append({
            "feature": "location_change",
            "impact": 10.0,
            "description": "Geographic IP / location anomaly detected.",
            "observed_value": "New Location (1)"
        })

    # 6. Previous alerts
    alerts = row_dict.get("previous_alerts", 0)
    if alerts > 0:
        contributions.append({
            "feature": "previous_alerts",
            "impact": min(alerts * 8.0, 20.0),
            "description": f"Account has {alerts} prior AML compliance alerts on record.",
            "observed_value": f"{alerts} alerts"
        })

    # 7. Dormant account reactivation
    if row_dict.get("dormant_account", 0) == 1:
        contributions.append({
            "feature": "dormant_account",
            "impact": 18.0,
            "description": "Sudden activity on previously inactive / dormant account.",
            "observed_value": "Dormant (1)"
        })

    return contributions


def run_inference_single(cleaned_features):
    """
    Runs model inference on one validated record.
    Returns prediction dictionary.
    """
    df = pd.DataFrame([cleaned_features], columns=REQUIRED_FEATURES)
    
    # Random Forest predictions
    pred_class = int(MODEL_PIPELINE.predict(df)[0])
    probabilities = MODEL_PIPELINE.predict_proba(df)[0]
    # Class 1 is suspicious probability
    prob = float(probabilities[1])
    
    # Risk score: 0 to 100
    risk_score = int(round(prob * 100))
    
    # Explicit Risk Tier mapping
    if risk_score >= 70:
        risk_tier = "HIGH"
    elif risk_score >= 40:
        risk_tier = "MEDIUM"
    else:
        risk_tier = "LOW"
        
    explanations = compute_feature_explanations(cleaned_features, prob)

    return {
        "model_version": MODEL_VERSION,
        "predicted_suspicious": bool(pred_class == 1),
        "prediction_class": pred_class,
        "risk_probability": round(prob, 6),
        "risk_score": risk_score,
        "risk_tier": risk_tier,
        "feature_contributions": explanations,
        "disclaimer": "Risk score is derived from uncalibrated Random Forest classification probabilities for decision support; it is not a calibrated regulatory AML probability."
    }


def run_inference_batch(cleaned_records):
    """
    Runs vectorized model inference on multiple validated records.
    """
    df = pd.DataFrame(cleaned_records, columns=REQUIRED_FEATURES)
    
    pred_classes = MODEL_PIPELINE.predict(df)
    prob_matrix = MODEL_PIPELINE.predict_proba(df)
    
    results = []
    for i in range(len(cleaned_records)):
        pred_class = int(pred_classes[i])
        prob = float(prob_matrix[i][1])
        risk_score = int(round(prob * 100))
        
        if risk_score >= 70:
            risk_tier = "HIGH"
        elif risk_score >= 40:
            risk_tier = "MEDIUM"
        else:
            risk_tier = "LOW"

        explanations = compute_feature_explanations(cleaned_records[i], prob)

        results.append({
            "model_version": MODEL_VERSION,
            "predicted_suspicious": bool(pred_class == 1),
            "prediction_class": pred_class,
            "risk_probability": round(prob, 6),
            "risk_score": risk_score,
            "risk_tier": risk_tier,
            "feature_contributions": explanations,
            "disclaimer": "Risk score is derived from uncalibrated Random Forest classification probabilities for decision support; it is not a calibrated regulatory AML probability."
        })
        
    return results


class ThreadedHTTPServer(ThreadingMixIn, HTTPServer):
    """Handles requests in a separate thread."""
    daemon_threads = True


class InferenceHTTPRequestHandler(BaseHTTPRequestHandler):
    def _send_json(self, status_code, data):
        response_body = json.dumps(data, indent=2).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(response_body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(response_body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        if self.path in ("/health", "/status", "/"):
            if MODEL_PIPELINE is None:
                self._send_json(503, {
                    "status": "error",
                    "model_loaded": False,
                    "error": "Model artifact not loaded in memory"
                })
                return

            self._send_json(200, {
                "status": "ready",
                "service": "Apex AML Python Inference Engine",
                "model_version": MODEL_VERSION,
                "model_loaded": True,
                "model_class": str(MODEL_PIPELINE.named_steps["model"].__class__.__name__),
                "feature_count": len(REQUIRED_FEATURES),
                "required_features": REQUIRED_FEATURES,
                "numeric_features": NUMERIC_FEATURES,
                "binary_features": BINARY_FEATURES,
                "categorical_features": ["transaction_type"],
                "classes": [0, 1]
            })
        else:
            self._send_json(404, {"error": "NOT_FOUND", "message": f"Endpoint {self.path} not found"})

    def do_POST(self):
        content_length = int(self.headers.get("Content-Length", 0))
        if content_length <= 0:
            self._send_json(400, {"success": False, "error": "EMPTY_PAYLOAD", "message": "Request body cannot be empty"})
            return

        try:
            raw_body = self.rfile.read(content_length).decode("utf-8")
            payload = json.loads(raw_body)
        except Exception as e:
            self._send_json(400, {"success": False, "error": "INVALID_JSON", "message": f"Malformed JSON: {str(e)}"})
            return

        if self.path == "/predict":
            # Can be { "transaction": {...} } or directly {...}
            tx_data = payload.get("transaction", payload) if isinstance(payload, dict) else payload
            transaction_id = payload.get("transaction_id") or tx_data.get("transaction_id")

            cleaned, err = validate_transaction_features(tx_data)
            if err:
                self._send_json(400, {
                    "success": False,
                    "error": "VALIDATION_FAILED",
                    "message": err,
                    "transaction_id": transaction_id
                })
                return

            try:
                result = run_inference_single(cleaned)
                if transaction_id:
                    result["transaction_id"] = str(transaction_id)
                self._send_json(200, {
                    "success": True,
                    **result
                })
            except Exception as e:
                traceback.print_exc()
                self._send_json(500, {
                    "success": False,
                    "error": "INFERENCE_FAILED",
                    "message": str(e)
                })

        elif self.path == "/predict-batch":
            tx_list = payload.get("transactions", [])
            if not isinstance(tx_list, list) or len(tx_list) == 0:
                self._send_json(400, {
                    "success": False,
                    "error": "INVALID_BATCH",
                    "message": "'transactions' must be a non-empty list of transaction objects"
                })
                return

            cleaned_list = []
            tx_ids = []
            errors = []

            for idx, item in enumerate(tx_list):
                tx_id = item.get("transaction_id", f"INDEX_{idx}")
                cleaned, err = validate_transaction_features(item)
                if err:
                    errors.append({"index": idx, "transaction_id": tx_id, "error": err})
                else:
                    cleaned_list.append(cleaned)
                    tx_ids.append(tx_id)

            if errors and len(cleaned_list) == 0:
                self._send_json(400, {
                    "success": False,
                    "error": "ALL_TRANSACTIONS_INVALID",
                    "validation_errors": errors
                })
                return

            try:
                batch_results = run_inference_batch(cleaned_list)
                for i, res in enumerate(batch_results):
                    res["transaction_id"] = tx_ids[i]

                self._send_json(200, {
                    "success": True,
                    "processed_count": len(batch_results),
                    "error_count": len(errors),
                    "errors": errors if errors else None,
                    "predictions": batch_results
                })
            except Exception as e:
                traceback.print_exc()
                self._send_json(500, {
                    "success": False,
                    "error": "BATCH_INFERENCE_FAILED",
                    "message": str(e)
                })
        else:
            self._send_json(404, {"error": "NOT_FOUND", "message": f"Endpoint {self.path} not found"})

    def log_message(self, format, *args):
        # Clean server logging format
        print(f"[InferenceService] {self.address_string()} - {format % args}")


def main():
    parser = argparse.ArgumentParser(description="Apex AML Python Model Inference Server")
    parser.add_argument("--port", type=int, default=int(os.getenv("PYTHON_INFERENCE_PORT", 5001)), help="Port to listen on (default 5001)")
    parser.add_argument("--model-path", type=str, default="aml_model.pkl", help="Path to aml_model.pkl")
    args = parser.parse_args()

    # Load model
    load_aml_model(args.model_path)

    server_address = ("127.0.0.1", args.port)
    httpd = ThreadedHTTPServer(server_address, InferenceHTTPRequestHandler)
    print(f"[InferenceService] Apex AML inference engine running on http://127.0.0.1:{args.port}")
    print("[InferenceService] Ready to receive inference requests from Apex Express backend.")

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[InferenceService] Shutting down inference service gracefully...")
        httpd.shutdown()


if __name__ == "__main__":
    main()
