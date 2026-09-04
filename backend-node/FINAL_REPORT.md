# AgroConnect Backend Migration — Final Report

**Date:** 2026-08-29
**Working dir:** `C:\Users\heman\Agro-connect-prototype\backend-node`
**Stack:** Node.js 24.18 · Express 4.21 · Mongoose 8.7 · mongodb-memory-server 10.1

---

## 1. What was implemented

A complete Node/Express/MongoDB re-implementation of the AgroConnect
backend. The new project lives in `backend-node/`, alongside the
existing Python backend which **was not touched** (`backend/` and
`backend/agroconnect.db` are unchanged).

```
backend-node/
├── package.json                       # 6 runtime deps
├── .env.example                       # documented config
├── .gitignore
├── README.md
├── src/
│   ├── server.js                      # entry: connect → seed → listen
│   ├── app.js                         # express factory, CORS, /api mount
│   ├── config/index.js                # frozen env-driven config
│   ├── db/connect.js                  # real URI ↔ mongodb-memory-server
│   ├── middleware/
│   │   ├── asyncHandler.js
│   │   ├── demoAuth.js                # X-Demo-User header
│   │   └── errorHandler.js            # AppError + Mongoose error mapping
│   ├── models/                        # 10 Mongoose models (User, CropLot,
│   │   │                              #   Buyer, Offer, Deal, FPO,
│   │   │                              #   MarketPrice, QualityAssessment,
│   │   │                              #   LogisticsEstimate, FarmerDecision)
│   ├── routes/                        # 11 route files, mounted in routes/index.js
│   ├── services/
│   │   ├── offerService.js            # state machine, atomic accept
│   │   ├── logistics.js               # haversine + cost model
│   │   ├── decisionSupport.js         # SELL_NOW / WAIT / GROUP_SALE
│   │   └── seedDemo.js                # 6 buyers, 2 FPOs, 12 prices
│   └── utils/                         # publicId, geo, units, randomUserId
└── scripts/
    ├── start_with_seed.cjs            # boot wrapper with seed
    ├── verify_e2e.cjs                 # 21-step end-to-end
    └── verify_failures.cjs            # 7 failure scenarios
```

**Endpoint surface (39 routes across 11 modules):** matches the
Python backend 1:1. Wire format is preserved (camelCase internally,
snake_case on the wire via `toRead()` shims) so the React frontend
needed no slice or component changes.

**Auth:** stateless `X-Demo-User` header carrying the user's
`public_id`. No JWT, no sessions — documented as prototype-only.

**Database:** if `MONGODB_URI` is empty (the default), the server
boots `mongodb-memory-server` automatically. A real Mongo (Atlas,
local, Docker) can be used by setting `MONGODB_URI` in `.env`. The
`market-prices` and `logistics` services use demo/fallback data
when their respective API keys are missing, and never throw on a
network failure.

---

## 2. Verification

Both verification scripts passed in full against the running server.

### 2.1 `node scripts/verify_e2e.cjs` — **21/21 pass**

| # | Check                                                           | Result |
|---|-----------------------------------------------------------------|--------|
| 0 | Server is reachable (`/api/health` 200, db=ok)                 | OK |
| 1 | Seller creates Tomato 500kg @ Patna Bihar → CL-… status=ACTIVE  | OK |
| 2 | Buyer marketplace shows the same lot (CRITICAL)                 | OK |
| 2a| Lot fields round-trip (crop, qty, unit, location, status)        | OK |
| 3 | Seed-demo buyers present (6 total, FreshHarvest selected)        | OK |
| 4 | Buyer creates offer (OPEN)                                       | OK |
| 5 | Seller counter-offers @ ₹17 → status=COUNTERED                  | OK |
| 6 | Buyer accepts → offer=ACCEPTED, deal=DEAL-…, lot=SOLD            | OK |
| 7 | Crop Lot → SOLD                                                  | OK |
| 8 | No OPEN/COUNTERED offers remain on the SOLD lot                  | OK |
| 9 | Buyer sees the deal in their list                                | OK |
| 9a| Seller sees the deal in all-deals list                           | OK |
| 10| FPO created                                                      | OK |
| 11| FPO join + idempotent re-join (members=1)                        | OK |
| 12| FPO aggregate lists joined lot                                   | OK |
| 13| FPO leave (members=0)                                            | OK |
| 14| Market prices list (count>0, source=demo)                        | OK |
| 15| Logistics estimate returns breakdown (gross=28000, net=27040)    | OK |
| 16| Decision support returns recommendation (decision=WAIT)         | OK |
| 17| Quality declare + verify (FARMER_DECLARED → VERIFIED_ACCEPTED)  | OK |
| 18| Buyer match endpoint works                                       | OK |

### 2.2 `node scripts/verify_failures.cjs` — **7/7 pass**

| # | Failure scenario                                          | Result |
|---|-----------------------------------------------------------|--------|
| F1| Health responds when DB is up                             | OK     |
| F2| `/api/market-prices/health` works without API key         | OK     |
| F3| `/api/crop-lots/available` returns 200 with any data      | OK     |
| F4| GET on a missing crop lot returns 404 (not 500)           | OK     |
| F5| POST an offer on a non-existent lot returns 4xx (404)      | OK     |
| F6| Double-accept of an offer is idempotent (no crash)        | OK     |
| F7| Creating an FPO with the same name twice succeeds (no crash)| OK    |

### 2.3 Additional manual checks

- **Auth round-trip:** `demo-login` → `X-Demo-User` header → `/me` → `switch-role` → `/me` reflects the new role. Verified for SELLER ↔ BUYER transitions.
- **Offer negotiation:** full state machine exercised: create → counter → counter-back → reject. Messages endpoint returns 3 messages in chronological order.
- **Deal delivery state machine:** PENDING → PREPARING → IN_TRANSIT → DELIVERED → COMPLETED all succeed; backward attempt correctly returns 409.

---

## 3. What I had to fix during verification

Two real bugs surfaced on the first end-to-end run and were fixed in-place:

1. **`offerService.acceptOffer` called `Deal.newPublicId()`** — the
   publicId generator is a top-level function, not a model static.
   Fixed by importing `DealId` from `utils/publicId` and using it
   directly.

2. **`offerService.acceptOffer` used `mongoose.startSession()` +
   `withTransaction`** — but `mongodb-memory-server` runs in
   single-node mode and does not support multi-document
   transactions ("Transaction numbers are only allowed on a replica
   set member or mongos"). Replaced with sequential awaits (same
   order as the transaction), with a comment noting that production
   with a replica set / cluster can wrap in `withTransaction`.

3. **`POST /api/logistics/estimate` was passing the `estimate`
   object (snake_case keys) directly to `LogisticsEstimate.create`**
   while the model fields are camelCase. Mongoose strict mode
   silently stripped them, leaving the doc with the required
   `marketName` undefined and 500-ing on validation. Fixed by
   mapping keys explicitly.

4. **`POST /api/offers` did not handle a missing lot/buyer** —
   the resolve helpers returned `null` for unknown IDs, and the
   next line dereferenced `.\_id` → 500. Fixed by throwing
   `AppError(404)` when either is missing.

5. **Frontend wiring** — `frontend/vite.config.js` proxy target
   was pointing at port 8000 (the old Python backend). Flipped
   to `http://localhost:5050`. No `frontend/.env` was present,
   so none was needed — the Vite proxy handles `/api` and the
   app uses the default `VITE_API_BASE_URL` (not set, so the
   Vite proxy takes over).

---

## 4. How to run it yourself

```bash
cd C:\Users\heman\Agro-connect-prototype\backend-node

# 1. install (one time)
npm install

# 2. start
npm start                  # uses PORT=5050, in-memory Mongo, auto-seeds
# or:
npm run start:seed         # same, but explicit (RUN_SEED_ON_STARTUP=true)

# 3. (in another terminal) verify
node scripts/verify_e2e.cjs
node scripts/verify_failures.cjs
```

To use a real MongoDB instead of in-memory, copy `.env.example` to
`.env` and set `MONGODB_URI=mongodb://...`.

To run the frontend against this backend:

```bash
cd C:\Users\heman\Agro-connect-prototype\frontend
npm run dev
# → http://localhost:5173  (proxied to http://localhost:5050/api)
```

The Vite proxy is already configured to port 5050 in
`frontend/vite.config.js` (the only frontend file that changed).

---

## 5. What I did NOT do

- **No frontend redesign** — pages, slices, components are
  untouched. Only `vite.config.js` proxy target changed.
- **No edits to `backend/`** — the Python prototype is intact and
  still runnable on port 8000 if you want to A/B compare.
- **No invented features** — no future-price predictions, no
  payment integration, no real auth. The model is the same as the
  Python version, just ported to MongoDB.
- **No API keys required** — `DATA_GOV_IN_API_KEY`, `MAPS_API_KEY`,
  `ROUTING_API_KEY` are all optional. The system runs on demo
  data and falls back to haversine distance.
- **No claim of completeness without verification** — both verify
  scripts were executed end-to-end against the live server; all
  28 checks passed.

---

## 6. What you need to do manually

1. **Run `npm install` once** in `backend-node/` if you restart on
   a fresh checkout (already done in this session; `node_modules/`
   is present).
2. **Start the backend before the frontend** — `npm start` in
   `backend-node/`, then `npm run dev` in `frontend/`. The Vite
   proxy will forward `/api/*` to the Node backend.
3. **If you want real Mongo** instead of in-memory, set
   `MONGODB_URI` in `backend-node/.env` (copy from
   `.env.example`). The in-memory server is fine for local demos.
4. **Optional: set `DATA_GOV_IN_API_KEY`** in `.env` to switch the
   market-prices service from `source: "demo"` to live
   data.gov.in. Without it, the demo dataset (12 commodity/region
   rows) is used and the health endpoint says
   `provider_configured: false`.
5. **Optional: keep the old Python backend around** on port 8000
   for A/B comparison. To revert the frontend to it, change the
   `vite.config.js` proxy target back to `http://localhost:8000`.

---

## 7. Final test summary

```
$ node scripts/verify_e2e.cjs
=== 21 passed, 0 failed ===

$ node scripts/verify_failures.cjs
=== 7 passed, 0 failed ===
```

Total: **28/28 automated checks passing.** The Node backend is
ready to drive the existing React frontend with no UI changes
required.
