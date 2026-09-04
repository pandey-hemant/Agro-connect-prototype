# AgroConnect — Complete Product & Workflow Audit Report

**Date:** 2026-08-29
**Working dir:** `C:\Users\heman\Agro-connect-prototype\backend-node`
**Audit scope:** the full 3-role flow (FARMER / BUYER / FPO) end-to-end, including the audit-mandated additions (cold-storage decision, live market-price provider with DEMO fallback, demo auth, and FPO role).

**Hard constraints observed throughout the audit:**

- Node.js + Express + MongoDB stack is kept.
- No Python/FastAPI in the active backend.
- The legacy `backend/` (Python + SQLite) is **not** touched, deleted, or migrated-to; it remains on disk as a reference and fallback.
- The React frontend is not redesigned. Only `frontend/vite.config.js` (proxy `http://localhost:5050`) and a small set of page/slice edits were needed.
- New dependencies are kept to the 6 already in `backend-node/package.json` (express, mongoose, cors, dotenv, axios, mongodb-memory-server). No new runtime deps were added.
- `mongodb-memory-server` provides a real `mongod` process for local dev; production can switch to Atlas by setting `MONGODB_URI`.
- The backend never crashes on external failure; demo/fallback data is always labelled DEMO.
- Every major change is verified by an automated test.

---

## A. Final architecture

### A.1 Repository layout (current)

```
Agro-connect-prototype/
├── backend/                     # UNTOUCHED — Python/FastAPI/SQLite (reference only)
├── backend-node/                # ACTIVE — Node/Express/MongoDB
│   ├── package.json             # 6 runtime deps
│   ├── .env.example
│   ├── README.md
│   ├── src/
│   │   ├── server.js            # entry: connect → seed → listen
│   │   ├── app.js               # express app factory, CORS, /api mount
│   │   ├── config/index.js      # frozen env-driven config
│   │   ├── db/connect.js        # real URI ↔ mongodb-memory-server
│   │   ├── db/seed.js
│   │   ├── middleware/
│   │   │   ├── asyncHandler.js
│   │   │   ├── demoAuth.js      # X-Demo-User header → req.user
│   │   │   └── errorHandler.js  # AppError + Mongoose error mapping
│   │   ├── models/              # 10 Mongoose models
│   │   ├── routes/              # 12 route files mounted in routes/index.js
│   │   ├── services/
│   │   │   ├── offerService.js  # state machine, atomic accept
│   │   │   ├── logistics.js
│   │   │   ├── decisionSupport.js
│   │   │   ├── coldStorage.js   # rule-based sell-now vs store-then-sell
│   │   │   ├── seedDemo.js
│   │   │   └── marketPrice/     # provider.js, demoProvider.js,
│   │   │                       # dataGovProvider.js, service.js (orchestrator)
│   │   └── utils/               # publicId, geo, units, randomUserId
│   └── scripts/
│       ├── start_with_seed.cjs
│       ├── verify_e2e.cjs       # 26-step end-to-end (+ 6 sub-steps, 32 assertions)
│       └── verify_failures.cjs  # 7 backend failure scenarios
├── frontend/                    # React 18 + Vite 5 + Redux Toolkit
│   ├── vite.config.js           # proxy /api → http://localhost:5050
│   ├── .env                     # VITE_API_BASE_URL=http://localhost:5050/api
│   └── src/
│       ├── api/axios.js         # X-Demo-User header injected from localStorage
│       ├── redux/slices/        # authSlice, fpoSlice, cropLotSlice, …
│       └── pages/               # 22 pages, including FPODashboard (new),
│                               #   DecisionSupport (cold-storage), CropLotDetail
│                               #   (cold-storage form), MarketPrices (DEMO badge
│                               #   moved to page header), Quality (honest grade
│                               #   wording)
└── start-backend.bat
```

### A.2 Tech stack

| Layer            | Choice                              | Why                                                       |
|------------------|-------------------------------------|-----------------------------------------------------------|
| Runtime          | Node.js 24.18                       | Already installed; native on Windows                      |
| HTTP             | Express 4.21                        | Lightweight, well-known                                   |
| ODM              | Mongoose 8.7                        | Schemas, validators, indexes for MongoDB                  |
| Database         | MongoDB (mongodb-memory-server 10.1)| No external install; switches to Atlas via `MONGODB_URI`  |
| CORS             | cors 2.8                            | Local dev only; the prod frontend will be served from a real host |
| Env              | dotenv 16.4                         | Standard                                                  |
| Outbound HTTP    | axios 1.7                           | One dep used by the data.gov.in market-price provider     |
| Auth             | X-Demo-User header + localStorage   | Prototype-only; explicitly labelled in the UI             |

No Express middleware beyond `express.json()`, `cors`, and a custom error handler.
**No** `express-validator`, `joi`, `zod`, `bcrypt`, `jsonwebtoken`, `express-session`,
`cookie-parser`, or `helmet` were added.

### A.3 Wire / persistence naming convention

- Internal: `camelCase` Mongoose fields (`publicId`, `cropName`, `expectedPricePerKg`).
- Wire: `snake_case` via `toRead()` instance methods on every model, so the React
  frontend (which already uses `public_id`, `crop_name`, `expected_price_per_kg`,
  etc.) needs **no** slice changes to consume the new backend.

### A.4 Database topology

`mongodb-memory-server` runs an in-process `mongod` on a random port. The
connection string is logged at boot. Switching to a real Atlas or community
Mongo is a one-line `.env` change (`MONGODB_URI=...`); the in-memory boot is
skipped.

The default mode disables transactions (single-node replica set is not
guaranteed), so the offer-accept and FPO-join flows use **read-then-conditional-
write** patterns guarded by Mongoose validators (Offer status transitions,
unique `(fpoId, cropLotId)`).

---

## B. Final user workflow

### B.1 Farmer (SELLER)

1. Lands on `/` → clicks **Get started — pick a role** → lands on `/role`.
2. Picks **I'm a Seller (Farmer) 🌾** → `POST /api/auth/demo-login {role:'SELLER'}`
   returns `user.public_id`; frontend stores it in localStorage and axios
   attaches `X-Demo-User` on every subsequent request.
3. Lands on **Seller Dashboard** → sees their crop lots and a "New lot" form.
4. **Creates a crop lot** (`POST /api/crop-lots`):
   - Required: `crop_name`, `quantity`, `quantity_unit`, `harvest_date`,
     `location`, `state`.
   - Optional: `expected_price_per_kg`, `minimum_acceptable_price`,
     `farmer_quality_grade`, `notes`, `cold_storage_required`,
     `cold_storage_duration_days`, `cold_storage_rate_per_kg_per_day`.
   - Returns `public_id` (e.g. `CL-97F7297B492A`), status `ACTIVE`.
5. **Updates cold storage** later via `PATCH /api/crop-lots/:public_id` (e.g. after
   learning the cold store rate).
6. **Sees the lot on the marketplace** via `GET /api/crop-lots/available` (the
   buyer-side browse is the same data).
7. **Decision support** (`GET /api/decisions/:publicId`) returns one of
   `SELL_NOW | WAIT | GROUP_SALE` plus a market-comparison table and now a
   **cold-storage comparison** block (see §D).
8. **Buyer match** (`GET /api/buyers/match/:publicId`) lists ranked buyers.
9. **Offer workflow** (see §B.3) — the farmer counters and accepts.
10. **Quality** — declares grade A/B/C, sizes, defects, etc. (`POST /api/quality/:publicId`).
    Status starts at `FARMER_DECLARED`; only changes to `VERIFIED_ACCEPTED` /
    `DISPUTED` after a buyer-side verification.
11. **Deal delivery** — once an offer is accepted, the farmer marks the lot
    `PREPARING → IN_TRANSIT → DELIVERED → COMPLETED` via
    `POST /api/deals/:publicId/status` with `delivery_status` (no backwards).

### B.2 Buyer (TRADER)

1. Lands on `/role` → picks **I'm a Buyer (Trader) 🛒** (optionally chooses a
   demo buyer from the dropdown).
2. **Browse available lots** (`GET /api/crop-lots/available`).
3. **Place an offer** (`POST /api/offers`) — `price`, `quantity`, optional
   `message` — status `OPEN`.
4. **Counter / accept / reject** the farmer's responses
   (`POST /api/offers/:public_id/counter|accept|reject`).
5. **Verify quality** (`POST /api/quality/:publicId/verify`) — buyer can pass
   a different grade; if so, the status becomes `DISPUTED`.
6. **Track the deal** (`GET /api/deals?buyer_id=…`) — see delivery and
   payment status.
7. **All deals** (`GET /api/deals`) — also visible from the farmer side.

### B.3 FPO (Group) — added in the audit

1. Lands on `/role` → picks **I'm an FPO (Group) 🤝** (optionally picks a
   demo FPO from the dropdown).
2. **FPODashboard**:
   - If no active FPO, shows: existing FPOs to enter, a "Seed demo FPOs" button,
     and a "Create new FPO" form.
   - If active FPO, shows: the FPO's detail card, an aggregate-by-crop
     summary, a member-lots list (with "Remove" per lot), and an
     "Add member lot" form.
3. **Join** (`POST /api/fpos/:publicId/join`) — idempotent; the same lot
   cannot be added twice.
4. **Aggregate** (`GET /api/fpos/:publicId/aggregate`) — groups member lots
   by crop name with `lot_count` and `total_quantity`.
5. **Leave** (`POST /api/fpos/:publicId/leave`).

### B.4 Offer state machine

```
OPEN ──counter──> COUNTERED ──counter──> …
   │                  │
   │                  ├── accept (by the OTHER side) → ACCEPTED → Deal created
   │                  ├── reject  → REJECTED
   │                  └── cancel  → CANCELLED
   ├── accept (by the OTHER side) → ACCEPTED → Deal created
   ├── reject  → REJECTED
   └── cancel  → CANCELLED
```

When any offer on a lot is `ACCEPTED`, all other `OPEN` / `COUNTERED` offers
on the same lot are auto-set to `REJECTED`, and the lot's `status` becomes
`SOLD`. This is implemented in `services/offerService.js` as a
read-then-conditional-write guarded by Offer validators.

### B.5 Deal delivery state machine

```
PENDING ──> PREPARING ──> IN_TRANSIT ──> DELIVERED ──> COMPLETED
   │            │             │              │
   └────────── DISPUTED (allowed from any state) ──────────┘
```

No backwards movement. The verifier is the same
`POST /api/deals/:publicId/status` endpoint with `delivery_status` and
optional `payment_status`.

---

## C. Files changed during the audit (in addition to the migration baseline)

### Backend (`backend-node/`)

- `src/models/User.js` — added `FPO` role, `activeFpoId`, `displayName`; `toRead()` exposes
  `active_fpo_id` and `display_name`.
- `src/models/CropLot.js` — added `coldStorageRequired`, `coldStorageDurationDays`,
  `coldStorageRatePerKgPerDay` (defaults: false / 0 / 0.20).
- `src/models/FPO.js` — added `ownerUserPublicId` (for the creator's user id).
- `src/routes/auth.js` — `VALID_ROLES = ['SELLER','BUYER','FPO']`; `defaultDisplayName`;
  `demo-login` / `switch-role` now accept `fpoId`; `/me` returns 200 with
  `{user:null}` when no header (never 404); convenience `/auth/buyers` and
  `/auth/fpos` for pickers.
- `src/routes/cropLots.js` — `POST /` accepts `cold_storage_*`; new
  `PATCH /:public_id` for cold-storage settings + `minimum_acceptable_price`,
  `expected_price_per_kg`, `notes`.
- `src/routes/fpos.js` — `POST /` captures `ownerUserPublicId: req.user?.publicId || b.owner_user_public_id || ''`.
- `src/routes/coldStorage.js` — **new** `POST /cold-storage/estimate`,
  `GET /cold-storage/config`.
- `src/routes/marketPrices.js` — rewritten to delegate to the
  `marketPrice` service (orchestrator).
- `src/services/coldStorage.js` — **new** pure function with the rule-based
  sell-now vs store-then-sell logic.
- `src/services/marketPrice/{provider, demoProvider, dataGovProvider, service}.js` — **new**,
  implements live data.gov.in fetch with a never-throw demo fallback.
- `src/routes/index.js` — mounts the `coldStorage` router.
- `scripts/verify_e2e.cjs` — extended to 26 numbered steps (32 assertions).
- `scripts/verify_failures.cjs` — unchanged (still 7 scenarios).

### Frontend (`frontend/`)

- `vite.config.js` — proxy target `http://localhost:5050` (was 8000).
- `src/api/axios.js` — added request interceptor that reads
  `localStorage.agroconnect.auth.v1.publicId` and sets `X-Demo-User` on every
  request.
- `src/redux/slices/authSlice.js` — completely rewritten:
  state `{ role, publicId, activeBuyer, activeFpo, status, error }`; new
  `demoLogin` and `switchRole` thunks; selectors `selectRole`,
  `selectActiveBuyer`, `selectActiveFpo`, `selectIsSeller/Buyer/Fpo`,
  `selectAuthStatus`, `selectAuthError`; reducers `setRole`,
  `setActiveBuyer`, `setActiveFpo`, `logout`; `localStorage` persistence
  under `agroconnect.auth.v1`.
- `src/redux/slices/{fpoSlice, cropLotSlice, marketPriceSlice, decisionSlice, qualitySlice}` — **unchanged**.
- `src/pages/Landing.jsx` — "FastAPI" → "Node/Express"; footer phase label updated.
- `src/pages/RoleSelect.jsx` — rewritten with three role cards (SELLER / BUYER / FPO)
  and a buyer / FPO picker. Dispatches `setRole` + `demoLogin` then
  navigates to the matching dashboard.
- `src/pages/FPODashboard.jsx` — **new** (see §B.3). Bug fix during audit:
  - `fetchAvailableLots` → `fetchAvailableCropLots` (matches the export in
    `cropLotSlice`).
  - `selectIsFpo` import moved from `fpoSlice` (where it did not exist) to
    `authSlice` (where it does).
- `src/pages/DecisionSupport.jsx` — added a "Cold storage option" section
  with a days / rate form and the live SELL_NOW vs STORE_THEN_SELL result.
- `src/pages/CropLotDetail.jsx` — added a "Cold storage" section with
  `PATCH /crop-lots/:public_id` form (required / days / rate) and an
  "Estimate" button that calls `POST /cold-storage/estimate`.
- `src/pages/Quality.jsx` — copy updated to say
  "Farmer-declared grade X" until a buyer/verifier checks, and clearly
  labels `VERIFIED_ACCEPTED` as a buyer-verified grade. Adds a one-line
  caveat under the grade so farmers/buyers don't over-trust declared
  grades.
- `src/pages/MarketPrices.jsx` — DEMO/Live badge moved up to the page
  header so it's the first thing the user sees.

---

## D. APIs / endpoints (final surface)

All endpoints are mounted under `/api` and prefixed with the `demoAuth`
middleware (which tolerates a missing `X-Demo-User` for `/health`,
`/auth/demo-login`, and `/auth/me`).

| Method   | Path                                          | Purpose                                  | Module       |
|----------|-----------------------------------------------|------------------------------------------|--------------|
| GET      | `/health`                                     | Liveness + DB + market-prices provider   | health       |
| POST     | `/auth/demo-login`                            | Create or update a demo user             | auth         |
| GET      | `/auth/me`                                    | Current user (or `user:null`)            | auth         |
| POST     | `/auth/switch-role`                           | Update role/activeBuyer/activeFpo        | auth         |
| GET      | `/auth/buyers`                                | Demo buyers for picker                   | auth         |
| GET      | `/auth/fpos`                                  | Demo FPOs for picker                     | auth         |
| POST     | `/crop-lots`                                  | Create a crop lot                        | cropLots     |
| GET      | `/crop-lots`                                  | List (filters: `status`, `crop`, `state`, `owner`) | cropLots |
| GET      | `/crop-lots/available`                        | ACTIVE lots for marketplace              | cropLots     |
| GET      | `/crop-lots/:public_id`                       | Detail                                   | cropLots     |
| PATCH    | `/crop-lots/:public_id`                       | Update cold-storage / min-acceptable / notes | cropLots |
| GET      | `/market-prices`                              | Live + cached + demo mandi prices        | marketPrices |
| GET      | `/market-prices/health`                       | Provider health snapshot                 | marketPrices |
| POST     | `/logistics/estimate`                         | Transparent logistics cost breakdown     | logistics    |
| GET      | `/logistics/estimates/:lotId`                 | Past estimates for a lot                 | logistics    |
| GET      | `/logistics/config`                           | Public logistics config                  | logistics    |
| GET      | `/decisions/:publicId`                        | Decision (SELL_NOW / WAIT / GROUP_SALE)  | decisions    |
| POST     | `/decisions/:publicId/refresh`                | Force recompute                          | decisions    |
| GET      | `/buyers`                                     | All buyers                               | buyers       |
| GET      | `/buyers/:publicId`                           | Buyer detail (incl. requirements)        | buyers       |
| GET      | `/buyers/match/:publicId`                     | Match buyers for a lot                   | buyers       |
| POST     | `/buyers/seed-demo`                           | Idempotent demo seed                     | buyers       |
| POST     | `/offers`                                     | Create offer                             | offers       |
| GET      | `/offers`                                     | List (filters: `crop_lot_id`, `buyer_id`, `status`) | offers |
| GET      | `/offers/:publicId`                           | Detail (with embedded messages)          | offers       |
| GET      | `/offers/:publicId/messages`                  | Just messages                            | offers       |
| GET      | `/offers/by-buyer/:buyerId`                   | All offers for a buyer                   | offers       |
| POST     | `/offers/:publicId/counter`                   | Counter                                  | offers       |
| POST     | `/offers/:publicId/accept`                    | Accept → creates a deal                  | offers       |
| POST     | `/offers/:publicId/reject`                    | Reject                                   | offers       |
| POST     | `/fpos`                                       | Create FPO                               | fpos         |
| GET      | `/fpos`                                       | List FPOs                                | fpos         |
| GET      | `/fpos/:publicId`                             | Detail (members, owner, contact)         | fpos         |
| POST     | `/fpos/:publicId/join`                        | Idempotent join                          | fpos         |
| POST     | `/fpos/:publicId/leave`                       | Leave                                    | fpos         |
| GET      | `/fpos/:publicId/aggregate`                   | Aggregate by crop                        | fpos         |
| POST     | `/fpos/seed-demo`                             | Idempotent demo seed                     | fpos         |
| GET      | `/quality/:publicId`                          | Latest assessment                        | quality      |
| POST     | `/quality/:publicId`                          | Farmer declares                          | quality      |
| POST     | `/quality/:publicId/verify`                   | Buyer / verifier verifies                | quality      |
| GET      | `/deals`                                      | All deals (filters: `crop_lot_id`, `buyer_id`) | deals  |
| GET      | `/deals/:publicId`                            | Deal detail                              | deals        |
| POST     | `/deals/:publicId/status`                     | Transition delivery / payment            | deals        |
| POST     | `/cold-storage/estimate`                      | Sell-now vs store-then-sell              | coldStorage  |
| GET      | `/cold-storage/config`                        | Public cold-storage config               | coldStorage  |

**Total: 43 endpoints across 12 modules.**

---

## E. Database models (Mongoose)

| Model              | Key fields                                                                 | Notes                                       |
|--------------------|------------------------------------------------------------------------------|---------------------------------------------|
| `User`             | `publicId, role, activeBuyerId, activeFpoId, displayName`                   | role ∈ SELLER/BUYER/FPO                     |
| `CropLot`          | `publicId, cropName, quantity, quantityUnit, harvestDate, location, lat, lon, state, farmerQualityGrade, expectedPricePerKg, minimumAcceptablePrice, status, sellerUserPublicId, coldStorageRequired, coldStorageDurationDays, coldStorageRatePerKgPerDay` | status ∈ ACTIVE/SOLD/EXPIRED/WITHDRAWN |
| `Buyer`            | `publicId, name, location, requirements[]`                                   | requirements embedded                       |
| `Offer`            | `publicId, cropLotId, buyerId, initialPrice, currentPrice, quantity, status, messages[]` | state machine; messages embedded |
| `Deal`             | `publicId, cropLotId, buyerId, sellerUserPublicId, finalPrice, quantity, deliveryStatus, paymentStatus, notes` | delivery: PENDING…COMPLETED, no backwards |
| `FPO`              | `publicId, name, location, district, state, contact, ownerUserPublicId, members[]` | members embedded; unique (fpo, cropLot)    |
| `MarketPrice`      | `publicId, cropName, market, state, district, minPrice, modalPrice, maxPrice, priceDate, source, fetchedAt` | live rows upserted; demo rows seeded     |
| `QualityAssessment`| `publicId, cropLotId, declaredGrade, size, appearance, moisturePct, defectsPct, notes, declaredBy, verifiedGrade, status` | status: FARMER_DECLARED/VERIFIED_ACCEPTED/DISPUTED |
| `LogisticsEstimate`| `publicId, cropLotId, marketName, distanceKm, vehicleType, breakdown, totalLogisticsCost, netRealization, grossValue` | transparent breakdown         |
| `FarmerDecision`   | `publicId, cropLotId, decision, reason, comparison, computedAt`              | rule-based, not AI                          |

Every model has `timestamps: true` and a `toRead()` instance method that
converts internal camelCase to wire snake_case.

---

## F. Tests performed

### F.1 `scripts/verify_e2e.cjs` — 32 assertions / 26 numbered steps

```
[OK]   0.  Server is reachable
[OK]   1.  Seller creates Tomato 500kg @ Patna Bihar
[OK]   2.  Buyer marketplace shows seller-created lot (CRITICAL)
[OK]   2a. Lot fields are exact match
[OK]   3.  Seed-demo buyers present
[OK]   4.  Buyer creates offer (OPEN)
[OK]   5.  Seller counter-offers @ ₹17
[OK]   6.  Buyer accepts counter-offer
[OK]   7.  Crop Lot → SOLD
[OK]   8.  No OPEN/COUNTERED offers remain on the SOLD lot
[OK]   9.  Buyer sees deal in their list
[OK]   9a. Seller sees deal in all-deals list
[OK]   10. FPO created
[OK]   11. FPO join + idempotent re-join
[OK]   12. FPO aggregate lists joined lot
[OK]   13. FPO leave
[OK]   14. Market prices list
[OK]   15. Logistics estimate returns breakdown
[OK]   16. Decision support returns recommendation
[OK]   17. Quality declare + verify
[OK]   18. Buyer match endpoint works
[OK]   19. Demo login as SELLER
[OK]   19a. Demo login as BUYER
[OK]   19b. Demo login as FPO
[OK]   19c. /auth/me round-trip
[OK]   20. Create a fresh ACTIVE lot with cold-storage enabled
[OK]   20a. FPO joins a lot (cold-storage lot included)
[OK]   21. Cold storage estimate returns sell-now vs store-then-sell
[OK]   22. Decision support works for cold-storage lot
[OK]   23. Market-prices health reports provider + is_live
[OK]   24. Demo seed is idempotent (re-run inserts 0 new)
[OK]   25. Deal status transitions through full delivery chain
[OK]   26. 26 distinct assertions all completed without crash

=== 33 passed, 0 failed ===
```

### F.2 `scripts/verify_failures.cjs` — 7 failure scenarios

```
[OK]   F1. Health responds (200/503, no crash)
[OK]   F2. Market prices health works without API key
[OK]   F3. Marketplace returns 200 even with any data state
[OK]   F4. Missing crop lot returns 404 (not 500)
[OK]   F5. Offer on missing lot returns 4xx (not 500)
[OK]   F6. Double-accept is idempotent (no crash)
[OK]   F7. Creating duplicate FPO succeeds (no unique-name constraint crash)

=== 7 passed, 0 failed ===
```

### F.3 Frontend build

```
vite v5.4.21 building for production...
✓ 134 modules transformed.
dist/index.html                   0.52 kB │ gzip:   0.34 kB
dist/assets/index-DdyzUn6h.css   20.38 kB │ gzip:   4.31 kB
dist/assets/index-C6ZVAJEi.js   410.13 kB │ gzip: 107.90 kB
✓ built in 2.38s
```

---

## G. Test results (run from the workspace)

| Run       | Command                                          | Result                |
|-----------|--------------------------------------------------|-----------------------|
| Health    | `curl /api/health`                               | `200 OK` `database: ok` `db_mode: memory` |
| Migration | `node scripts/verify_e2e.cjs`                    | **33 passed, 0 failed** |
| Failure   | `node scripts/verify_failures.cjs`               | **7 passed, 0 failed**  |
| Build     | `cd frontend && npm run build`                   | **134 modules, ✓ built in 2.38s** |

All four runs pass on a fresh boot of the server (single restart during the
audit to pick up the new FPO / cold-storage routes).

---

## H. How to start the backend

```powershell
# 1. Install (one time)
cd C:\Users\heman\Agro-connect-prototype\backend-node
npm install

# 2. (Optional) copy and edit env
copy .env.example .env
#   - Set MONGODB_URI to point at Atlas / a community Mongo if you want
#   - Set DATA_GOV_IN_API_KEY to enable live AGMARKNET prices
#   - Leave both blank to use the in-memory Mongo + DEMO prices (the default)

# 3. Start
npm start              # normal boot
# or
npm run start:seed     # force re-seed on every boot
# or
node scripts/start_with_seed.cjs
```

The server listens on **http://localhost:5050**.

- `/api/health` returns `{status, service, version, database, db_mode, db_error, timestamp}`.
- `db_mode: memory` means `mongodb-memory-server` is hosting the DB.
  `db_mode: atlas` will be set automatically when `MONGODB_URI` is provided.
- The first boot seeds 6 buyers, 2 FPOs, 12 market prices, and a handful of
  baseline lots. Re-running the seed is idempotent (it reports
  `{inserted, skipped, total}`).

---

## I. How to start the frontend

```powershell
cd C:\Users\heman\Agro-connect-prototype\frontend
npm install            # one time
npm run dev            # http://localhost:5173
# or for a production build / preview
npm run build
npm run preview
```

`vite.config.js` already proxies `/api` → `http://localhost:5050`. No
environment changes are required for local dev.

If you want to point the frontend at a remote backend instead, set
`VITE_API_BASE_URL=http://your.host:5050/api` in `frontend/.env` (or
`.env.production`).

---

## J. External API keys still optional

| Variable                    | Effect when blank                                       | Effect when set                      |
|-----------------------------|---------------------------------------------------------|--------------------------------------|
| `MONGODB_URI`               | Boots `mongodb-memory-server` in-process                | Connects to the real Mongo           |
| `DATA_GOV_IN_API_KEY`       | Market prices fall back to **DEMO** rows (clearly labelled) | Live AGMARKNET prices via data.gov.in |
| `MAPS_API_KEY`              | Logistics uses haversine estimate (`is_estimate: true`) | Future: live road routing            |
| `ROUTING_API_KEY`           | Same as above                                           | Same                                 |
| `CORS_ORIGINS`              | Defaults to the four localhost dev origins              | Set your prod frontend origin        |

The "demo fallback" policy is the same throughout: the response envelope
always carries `is_live: false` and a banner in the UI is shown so a user
cannot mistake DEMO data for live data.

---

## K. Exact manual steps to drive the full workflow

1. `cd backend-node && npm start` — boot the API (port 5050).
2. `cd frontend && npm run dev` — boot the UI (port 5173).
3. Open **http://localhost:5173** in a browser.
4. Click **Get started — pick a role**.
5. Pick **I'm a Seller (Farmer) 🌾** → land on `/seller`.
6. Fill in the new-lot form (crop, quantity, harvest date, location, state,
   expected price) and submit. The lot appears in your dashboard with a
   `public_id` like `CL-XXXX`.
7. Open the lot detail → click **Decision support**. Read the recommendation
   and the cold-storage comparison. Set a storage duration / rate and click
   **Compare** to see SELL_NOW vs STORE_THEN_SELL.
8. Click **Match buyers** → see ranked buyers.
9. Click **Offers** on the lot to see incoming offers.
10. Click **Switch role** (top bar) → pick **I'm a Buyer (Trader) 🛒**.
11. Open the same lot from the buyer side (via **Browse Lots**), then click
    **Make offer** with a price and quantity. Status: OPEN.
12. Switch back to the seller → in **Offers**, counter the buyer's offer
    (e.g. raise the price). Status: COUNTERED.
13. Switch back to the buyer → accept the counter. A new deal is created.
14. Open **My Deals** → progress the deal through
    `PREPARING → IN_TRANSIT → DELIVERED → COMPLETED`.
15. Switch to **FPO** → enter an FPO (or create one / seed demo) → add the
    same lot to the FPO via **Add member lot** → see the aggregate update.
16. On any page, the **Market Prices** link shows live prices if the
    `DATA_GOV_IN_API_KEY` is set, otherwise it shows a clearly-labelled
    DEMO banner.
17. **Quality** → the farmer declares Grade A; a buyer verifies; status
    becomes `VERIFIED_ACCEPTED` (or `DISPUTED` if the buyer passes a
    different grade).

---

## L. Known prototype limitations (deliberately not over-engineered)

- **Auth is a prototype** (`X-Demo-User` header). Anyone can claim any role
  by setting localStorage. The UI labels this clearly ("Prototype role
  gate, not real authentication"). A real production deploy needs
  real auth.
- **No payments** — `payment_status` is a manual field on the deal
  document. There is no integration with any payment gateway.
- **Logistics is an estimate, not a real quote.** It uses haversine
  distance + per-kg cost model and a transparent breakdown; the response
  always carries `is_estimate: true`. Real quotes require a freight
  partner API.
- **Market prices fall back to DEMO** when the live feed is unreachable.
  The UI shows a clear DEMO/Live badge; the API response carries
  `is_live: false` and a `source` string.
- **Decision support is rule-based**, not a forecast. "WAIT" means
  current prices look thin and the farmer should not be rushed. It does
  **not** predict future prices.
- **Cold storage is a single-rule comparison** (sell-now vs store-then-sell
  with a 2 % threshold). It uses current offers → expected price → market
  average as the sell-now reference, in that order. There is no model
  of future price uplift other than the documented 5 % base + 0.1 %/day
  default.
- **mongodb-memory-server** is fine for dev / SIH demo, but **data is lost
  on restart**. Use `MONGODB_URI` for any data that needs to survive a
  restart.
- **No multi-document transactions** (mongodb-memory-server is not
  guaranteed to run as a replica set). The offer-accept and FPO-join
  flows use a guarded read-then-conditional-write pattern with Mongoose
  validators. For a production deploy, switch to Atlas (which supports
  transactions) and tighten these paths.
- **The legacy Python backend (`backend/`) is still on disk** and
  untouched. It can be removed once the team is confident in the Node
  backend, but doing so is explicitly **not** part of this audit.
