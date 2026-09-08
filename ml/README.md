# AgroConnect ML — Price Prediction

Python + XGBoost pipeline that consumes AGMARKNET historical prices from
MongoDB and serves a 7-day modal-price projection over HTTP. The Node/Express
backend calls this service from the existing decision-support path; if the
service is unavailable the existing 3-baseline ensemble in `mlPrediction.js`
takes over so the user never sees a regression.

## Layout

```
ml/
├── training/
│   ├── train.py            # Pulls from Mongo, builds features, fits XGBoost
│   ├── features.py         # Pure feature engineering (no I/O)
│   └── evaluate.py         # Reports MAE/RMSE/MAPE on the test split
├── service/
│   ├── app.py              # FastAPI app: GET /health, POST /predict
│   ├── client_features.py  # Same feature builder used at inference time
│   └── model_loader.py     # Loads the per-(crop,state) model artifacts
├── models/                 # Saved artifacts (gitignored)
└── requirements.txt
```

## Setup

```bash
cd ml
python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS/Linux
# source .venv/bin/activate

pip install -r requirements.txt
```

## Train

Reads `MONGODB_URI` from the environment (defaults to
`mongodb://127.0.0.1:27017/agroconnect`). Trains one XGBoost model per
`(crop, state)` series with at least 30 distinct dates.

```bash
python training/train.py --out models
```

Writes one `models/<crop>__<state>.json` (XGBoost native format) plus
`models/metadata.json` with feature names, train/val/test sizes and the
evaluation metrics for every model.

## Serve

```bash
uvicorn service.app:app --host 127.0.0.1 --port 8001
```

Endpoints:
- `GET  /health` → `{ ok, models_loaded, n_models }`
- `POST /predict` → `{ crop, state, market?, days? }` returns
  `{ available, method, projection, ... }` in the same shape the
  `mlPrediction.js` JS baseline already returns.

## Wire into Node/Express

`backend-node/.env` adds:
```
ML_SERVICE_URL=http://127.0.0.1:8001
```

The new `pythonMlClient.js` is invoked from `mlPrediction.js` before
the existing baselines. Any error → the JS ensemble runs as a fallback.

## Tests

```bash
pytest -q
```

Covers the feature engineering, model persistence, and FastAPI health
endpoint.
