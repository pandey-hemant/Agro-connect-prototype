# AgroConnect — Node/Express/MongoDB backend

This is the **new** Node implementation of the AgroConnect backend,
replacing the FastAPI + SQLite prototype in `../backend/`.

It exposes the **same `/api/*` contract** the existing React frontend
already talks to, so the frontend does not need to change. Only
`frontend/vite.config.js` and `frontend/.env` have to be pointed at
port `5050` instead of `8000`.

## Quick start

```bash
cd backend-node
npm install
npm start
# → http://localhost:5050/api/health
```

`MONGODB_URI` is **optional** — leave it blank to boot
`mongodb-memory-server` automatically. To use a real Mongo
(local or Atlas), set `MONGODB_URI` in `.env`.

## Endpoints

See `../backend/app/api/` for the full schema reference. The Node
version mirrors it 1:1.

| Module        | Prefix                       |
|---------------|------------------------------|
| Health        | `/api/health`                |
| Auth (demo)   | `/api/auth/...`              |
| Crop Lots     | `/api/crop-lots/...`         |
| Market Prices | `/api/market-prices/...`     |
| Logistics     | `/api/logistics/...`         |
| Decisions     | `/api/decisions/...`         |
| Buyers        | `/api/buyers/...`            |
| Offers        | `/api/offers/...`            |
| FPOs          | `/api/fpos/...`              |
| Quality       | `/api/quality/...`           |
| Deals         | `/api/deals/...`             |

## Verification

```bash
node scripts/verify_e2e.cjs       # 21-step end-to-end (all 9 modules)
node scripts/verify_failures.cjs  # 7 backend failure scenarios (F1-F7)
```

Latest run (2026-08-29): **21/21 e2e pass · 7/7 failure pass** against
mongodb-memory-server on port 5050.

## Why a parallel backend?

The user explicitly required that the working Python backend stay
available until the Node version is fully verified. Both backends
implement the same API surface; switching is just a port flip in the
frontend.
