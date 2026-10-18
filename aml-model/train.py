import joblib
import pandas as pd

from sklearn.model_selection import train_test_split
from sklearn.compose import ColumnTransformer
from sklearn.preprocessing import OneHotEncoder
from sklearn.pipeline import Pipeline
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import (
    classification_report,
    confusion_matrix,
    roc_auc_score
)

# --------------------------------
# 1. Load dataset
# --------------------------------

df = pd.read_csv("data/aml_dataset.csv")

print("Dataset shape:", df.shape)

# --------------------------------
# 2. Define target
# --------------------------------

y = df["suspicious"]

# --------------------------------
# 3. Define features
# --------------------------------

features = [
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

X = df[features]

# --------------------------------
# 4. Identify categorical columns
# --------------------------------

categorical_features = [
    "transaction_type"
]

numeric_features = [
    column for column in features
    if column not in categorical_features
]

# --------------------------------
# 5. Preprocessing
# --------------------------------

preprocessor = ColumnTransformer(
    transformers=[
        (
            "categorical",
            OneHotEncoder(handle_unknown="ignore"),
            categorical_features
        ),
        (
            "numeric",
            "passthrough",
            numeric_features
        )
    ]
)

# --------------------------------
# 6. Model
# --------------------------------

model = RandomForestClassifier(
    n_estimators=200,
    random_state=42,
    class_weight="balanced",
    max_depth=10
)

pipeline = Pipeline(
    steps=[
        ("preprocessor", preprocessor),
        ("model", model)
    ]
)

# --------------------------------
# 7. Train/test split
# --------------------------------

X_train, X_test, y_train, y_test = train_test_split(
    X,
    y,
    test_size=0.20,
    random_state=42,
    stratify=y
)

print("\nTraining records:", len(X_train))
print("Testing records:", len(X_test))

print("\nTraining suspicious:", y_train.sum())
print("Testing suspicious:", y_test.sum())

# --------------------------------
# 8. Train
# --------------------------------

print("\nTraining AML model...")

pipeline.fit(X_train, y_train)

print("Training complete!")

# --------------------------------
# 9. Predictions
# --------------------------------

predictions = pipeline.predict(X_test)

probabilities = pipeline.predict_proba(X_test)[:, 1]

# --------------------------------
# 10. Evaluation
# --------------------------------

print("\n========== CLASSIFICATION REPORT ==========")

print(
    classification_report(
        y_test,
        predictions,
        target_names=["Normal", "Suspicious"],
        zero_division=0
    )
)

print("\n========== CONFUSION MATRIX ==========")

print(confusion_matrix(y_test, predictions))

print("\n========== ROC-AUC ==========")

print(
    roc_auc_score(
        y_test,
        probabilities
    )
)
# ==========================================
# FEATURE IMPORTANCE
# ==========================================

import matplotlib.pyplot as plt

# Get transformed feature names
feature_names = pipeline.named_steps["preprocessor"].get_feature_names_out()

# Get importance from Random Forest
importances = pipeline.named_steps["model"].feature_importances_

# Create a dataframe
importance_df = pd.DataFrame({
    "feature": feature_names,
    "importance": importances
})

# Sort from highest to lowest
importance_df = importance_df.sort_values(
    by="importance",
    ascending=False
)

print("\n========== FEATURE IMPORTANCE ==========")
print(importance_df.to_string(index=False))

# Plot top 15 features
top_features = importance_df.head(15)

plt.figure(figsize=(10, 6))
plt.barh(
    top_features["feature"][::-1],
    top_features["importance"][::-1]
)

plt.xlabel("Importance")
plt.ylabel("Feature")
plt.title("AML Random Forest Feature Importance")
plt.tight_layout()

plt.savefig("feature_importance.png")

print("\nFeature importance chart saved as feature_importance.png")
# ==========================================
# SAVE TRAINED AML MODEL
# ==========================================

joblib.dump(pipeline, "aml_model.pkl")

print("\nAML model saved successfully as aml_model.pkl")