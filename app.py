import hashlib
import json
import subprocess
import sys
from pathlib import Path

import joblib
import pandas as pd
from flask import Flask, jsonify, render_template, request

app = Flask(__name__)

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


def load_models():
    if not DATASET_PATH.exists():
        raise FileNotFoundError(f"Training CSV not found: {DATASET_PATH.name}")

    current_hash = hashlib.sha256(DATASET_PATH.read_bytes()).hexdigest()
    manifest = {}
    if MANIFEST_PATH.exists():
        manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))

    models_are_current = (
        manifest.get("sha256") == current_hash
        and all(path.exists() for path in MODEL_FILES.values())
    )
    if not models_are_current:
        training_script = BASE_DIR / "train_turnout_model.py"
        subprocess.run([sys.executable, str(training_script)], cwd=BASE_DIR, check=True)
        manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))

    if manifest.get("sha256") != current_hash:
        raise RuntimeError("Model training did not use the current CSV contents.")

    return (
        {name: joblib.load(path) for name, path in MODEL_FILES.items()},
        manifest,
    )


MODELS, MODEL_MANIFEST = load_models()
FEATURE_COLUMNS = MODEL_MANIFEST["features"]
CATEGORICAL_FEATURES = set(MODEL_MANIFEST["categorical_features"])
WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
MEAL_TARGETS = ["breakfast_count", "lunch_count", "snacks_count", "dinner_count"]


def clean_payload(payload):
    cleaned = {}
    day_of_week = str(payload.get("day_of_week", "Monday")).strip().title()
    for key in FEATURE_COLUMNS:
        value = payload.get(key, 0)
        if key in CATEGORICAL_FEATURES:
            cleaned[key] = day_of_week if key == "day_of_week" else str(value)
        else:
            try:
                cleaned[key] = int(value)
            except (TypeError, ValueError):
                cleaned[key] = 0

    if "is_weekend" in cleaned:
        cleaned["is_weekend"] = int(day_of_week in {"Saturday", "Sunday"})

    if "has_classes" in cleaned:
        non_class_day = any(
            cleaned.get(flag, 0)
            for flag in ("is_weekend", "is_holiday", "is_long_weekend", "is_semester_break")
        )
        cleaned["has_classes"] = int(not non_class_day)

    return cleaned


def build_feature_frame(payload):
    cleaned = clean_payload(payload)
    frame = pd.DataFrame([cleaned], columns=FEATURE_COLUMNS)
    return frame


@app.route("/")
@app.route("/prediction")
def prediction_page():
    return render_template("prediction.html")


@app.route("/dashboard")
def dashboard_page():
    return render_template("index.html")


@app.route("/analytics")
def analytics():
    df = pd.read_csv(DATASET_PATH)
    has_dates = "date" in df.columns
    if "is_semester_break" in df.columns:
        semester_break = pd.to_numeric(
            df["is_semester_break"], errors="coerce"
        ).fillna(0).astype(bool)
        excluded_break_rows = int(semester_break.sum())
        df = df[~semester_break].copy()
    else:
        excluded_break_rows = 0

    if has_dates:
        df["_date"] = pd.to_datetime(df["date"], errors="coerce")
        df = df[df["_date"].notna()].sort_values("_date")
        if not df.empty:
            df = df.tail(60).copy()
            first_date = df["_date"].min().normalize()
            last_date = df["_date"].max().normalize()
            period_label = f"{first_date:%b %d} - {last_date:%b %d, %Y}"
        else:
            period_label = "No eligible records"
    else:
        df = df.tail(60).copy()
        period_label = f"Latest {len(df)} non-break records"

    averages = {
        day: {**{meal: None for meal in MEAL_TARGETS}, "average_total": None}
        for day in WEEKDAYS
    }
    if not df.empty and "day_of_week" in df.columns:
        for meal in MEAL_TARGETS:
            df[meal] = pd.to_numeric(df[meal], errors="coerce")
        df["_total_turnout"] = df[MEAL_TARGETS].sum(axis=1, min_count=len(MEAL_TARGETS))
        grouped = df.groupby("day_of_week")[MEAL_TARGETS].mean()
        total_by_day = df.groupby("day_of_week")["_total_turnout"].mean()
        for day in WEEKDAYS:
            if day in grouped.index:
                averages[day] = {
                    meal: round(float(grouped.at[day, meal]), 1)
                    if pd.notna(grouped.at[day, meal]) else None
                    for meal in MEAL_TARGETS
                }
                averages[day]["average_total"] = (
                    round(float(total_by_day[day]), 1)
                    if pd.notna(total_by_day[day]) else None
                )

    return jsonify({
        "averages": averages,
        "record_count": int(len(df)),
        "excluded_break_rows": excluded_break_rows,
        "date_based": has_dates,
        "period_label": period_label,
    })


@app.route("/predict", methods=["POST"])
def predict():
    payload = request.get_json(silent=True) or request.form.to_dict()
    features = build_feature_frame(payload)

    predictions = {}
    for meal_name, model in MODELS.items():
        prediction = float(model.predict(features)[0])
        predictions[meal_name] = max(0, min(int(round(prediction)), 2000))

    total_servings = sum(predictions.values())

    return jsonify({
        "predictions": predictions,
        "total_servings": total_servings,
    })


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
