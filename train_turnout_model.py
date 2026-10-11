import hashlib
import json
from pathlib import Path

import joblib
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestRegressor
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

BASE_DIR = Path(__file__).resolve().parent
DATASET_PATH = BASE_DIR / "day_of_week,is_weekend,is_holiday,is_lon.csv"
MODEL_DIR = BASE_DIR / "models"
MANIFEST_PATH = MODEL_DIR / "model_manifest.json"
MODEL_FILES = {
    "breakfast_count": MODEL_DIR / "breakfast_model.pkl",
    "lunch_count": MODEL_DIR / "lunch_model.pkl",
    "snacks_count": MODEL_DIR / "snacks_model.pkl",
    "dinner_count": MODEL_DIR / "dinner_model.pkl",
}
TARGETS = ["breakfast_count", "lunch_count", "snacks_count", "dinner_count"]


def build_model_pipeline(feature_cols):
    categorical_features = ["day_of_week"] if "day_of_week" in feature_cols else []
    numeric_features = [c for c in feature_cols if c not in categorical_features]
    preprocessor = ColumnTransformer(
        transformers=[
            ("num", StandardScaler(), numeric_features),
            ("cat", OneHotEncoder(handle_unknown="ignore"), categorical_features),
        ]
    )
    return Pipeline(
        steps=[
            ("preprocessor", preprocessor),
            (
                "model",
                RandomForestRegressor(
                    n_estimators=500,
                    random_state=42,
                    max_depth=12,
                    min_samples_leaf=2,
                ),
            ),
        ]
    )


def main():
    if not DATASET_PATH.exists():
        raise FileNotFoundError(f"Training CSV not found: {DATASET_PATH.name}")
    MODEL_DIR.mkdir(parents=True, exist_ok=True)

    df = pd.read_csv(DATASET_PATH)
    missing_targets = [target for target in TARGETS if target not in df.columns]
    if missing_targets:
        raise ValueError(f"Training CSV is missing target columns: {missing_targets}")

    feature_cols = [col for col in df.columns if col.lower() != "date" and col not in TARGETS]
    if not feature_cols:
        raise ValueError("No feature columns were found in the training CSV.")

    categorical_features = [
        col for col in feature_cols
        if col == "day_of_week" or pd.api.types.is_object_dtype(df[col])
    ]
    data_hash = hashlib.sha256(DATASET_PATH.read_bytes()).hexdigest()
    metrics = {}

    for target in TARGETS:
        X = df[feature_cols].copy()
        y = df[target].astype(float)
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=0.2, random_state=42
        )
        model = build_model_pipeline(feature_cols)
        model.fit(X_train, y_train)
        joblib.dump(model, MODEL_FILES[target])
        predictions = model.predict(X_test)
        metrics[target] = {
            "mae": round(float((y_test - predictions).abs().mean()), 2),
            "test_rows": int(len(y_test)),
        }
        print(f"Trained {target} model -> {MODEL_FILES[target].name}")

    manifest = {
        "dataset": DATASET_PATH.name,
        "sha256": data_hash,
        "features": feature_cols,
        "categorical_features": categorical_features,
        "metrics": metrics,
    }
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"Saved training manifest -> {MANIFEST_PATH.name}")


if __name__ == "__main__":
    main()
