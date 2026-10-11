# Smart Mess Meal Prediction

Flask app that predicts breakfast, lunch, snacks, and dinner counts from the
campus dataset in `day_of_week,is_weekend,is_holiday,is_lon.csv`.

## Run

Install the Python packages `flask`, `pandas`, `scikit-learn`, and `joblib`,
then run:

```bash
python3 app.py
```

The app checks the CSV content hash at startup. If the CSV has changed or model
files are missing, it retrains the four models before serving predictions.
To train them manually, run `python3 train_turnout_model.py`.
Trained model files and their manifest are stored in the `models/` directory.

The model uses every CSV column except `date` and the four meal-count targets
as input features. The total in the results is the sum of meal servings, not a
count of unique students across the day.