# AgroConnect — DECISION SUPPORT Phase: Final Report

**Date:** 2026-08-30
**Branch:** node-express-mongodb backend + React frontend (in-place)
**Scope:** PHASE A (market prices) + PHASE B (logistics) + PHASE C
(cold storage, already complete) + PHASE D (net realisation / decision
support) + PHASE E (buyer demand, already complete) + PHASE F
(verification).

This phase made the backend wire shape match what the existing
**MarketPrices.jsx** and **DecisionSupport.jsx** pages already read,
without any frontend redesign.

---

## 1. Files changed (this phase)

### Backend — modified

| File                                                                                  | What changed                                                                                                                                                                       |
|---------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `backend-node/src/models/MarketPrice.js`                                              | Added `minPricePerKg`, `maxPricePerKg`, `priceDate`. `toRead()` exposes the frontend-aligned snake_case keys (`crop_name, market, state, district, location, min_price, modal_price, max_price, price_per_quintal, price_per_kg, unit, price_date, arrival_date, source, is_live`). |
| `backend-node/src/services/marketPrice/dataGovProvider.js`                            | Maps `min_price` / `max_price` (when present) from AGMARKNET; defaults min = max = modal (AGMARKNET's standard dataset only emits modal).                                            |
| `backend-node/src/services/marketPrice/demoProvider.js`                               | Adds `minPricePerKg = maxPricePerKg = pricePerKg` and `priceDate` to each row.                                                                                                      |
| `backend-node/src/routes/marketPrices.js`                                             | New `toWireRow()` shim emits the snake_case keys the page already reads. Envelope gains `unit` and `fetched_at` (ISO). No API key ever appears in the response.                      |
| `backend-node/src/models/FarmerDecision.js`                                           | Added `insufficientData` + `cropLotPublicId`. `toRead()` exposes **both** legacy keys (`decision, rationale, market_comparison, crop_lot_id`) **and** new keys (`recommendation, reason, comparison, crop_lot_public_id, insufficient_data`). |
| `backend-node/src/models/LogisticsEstimate.js`                                        | Added `destinationLabel, vehicleType, modalPricePerKg, isLivePrice`. `toRead()` returns `destination_label, destination_market, vehicle, vehicle_type, modal_price_per_kg, is_live_price, net_realisation`. |
| `backend-node/src/services/logistics.js`                                              | Resolves destination centroid from a new `MANDI_CENTROIDS` table in `utils/geo.js` (Bengaluru APMC, Patna Mandi, Nashik APMC, Lasalgaon, Davangere, Agra Mandi, Azadpur Mandi, Mumbai APMC, Delhi Azadpur, Amritsar Mandi, Karnal Mandi, etc.). Falls back to haversine + state centroid when no match. Accepts `destination_market` alias for `market_name`. |
| `backend-node/src/utils/geo.js`                                                       | New `MANDI_CENTROIDS` table (mandi → lat/lon) and `resolveMarketCentroid(marketName, fallback)` helper. Exact match first, then substring match.                                     |
| `backend-node/src/routes/logistics.js`                                                | Body accepts `market_name` OR `destination_market`; new `destination_label`, `vehicle_type` fields; looks up modal price for the chosen market + lot crop and surfaces it on the response. |
| `backend-node/src/services/decisionSupport.js`                                        | Rewrote `computeDecision()` to build a **per-market comparison**: for each `MarketPrice` row of the lot's crop, compute a logistics estimate for that market. Persists `marketComparison[]` (`{market, state, location, modal_price, distance_km, total_logistics_cost, net_realisation}`). Decision rule (SELL_NOW / WAIT / GROUP_SALE) preserved + strengthened with `insufficient_data` flag. |
| `backend-node/src/routes/decisions.js`                                                | `:lotId` accepts `CL-...` publicId OR Mongo ObjectId. Returns the same toRead() shape. (No wire shape change; just confirms ObjectId vs publicId flexibility.)                       |

### Backend — created (verifier scripts)

| File                                                                | What it does                                                                                |
|---------------------------------------------------------------------|---------------------------------------------------------------------------------------------|
| `backend-node/scripts/verify_decision_support.cjs`                  | 16 checks across market-prices wire shape, filters, logistics, cold storage, decisions, demands, and a defensive API-key-leak assertion. |
| `backend-node/scripts/verify_phase_decision_e2e.cjs`                | 10-check end-to-end user flow: SELLER creates lot → decisions comparison → logistics agreement on distance → cold-storage rec → buyer demands. |

### Frontend — **untouched** (per the user's hard constraint)
All wire-shape mismatches were resolved on the backend, not the
frontend. The pages `MarketPrices.jsx`, `DecisionSupport.jsx`,
`Opportunities.jsx` already use the keys; the backend now returns them.

### Old Python backend — **untouched** (per the user's hard constraint)
`backend/` was not modified.

### Untouched
- `backend-node/src/config/index.js` (only documented knobs in
  `.env.example`).
- `backend-node/src/middleware/*`.
- All other Mongoose schemas except the additive fields noted above.
- All `frontend/src/pages/*` and `frontend/src/redux/slices/*`.

---

## 2. Features completed

### PHASE A — Market Prices
- `GET /api/market-prices` returns the **frontend-aligned envelope**:
  `{source, is_live, count, note, unit, fetched_at, results: [...]}`.
- Each row carries `crop_name, market, state, district, location,
  min_price, modal_price, max_price, price_per_quintal, price_per_kg,
  unit, price_date, arrival_date, source, is_live`.
- Filters: `?crop=`, `?state=`, `?market=` (substring), `?district=`.
- Live AGMARKNET path: when `DATA_GOV_IN_API_KEY` is set, the
  orchestrator calls `api.data.gov.in/resource/<id>` and **never
  throws** — failures fall back to the demo dataset and surface a
  `note` in the envelope.
- Demo dataset: 12 commodity/region rows when no key is set.
- The `is_live` flag is true only when the live fetch returned ≥1
  row.
- **API keys are never returned in any response.** The
  `verify_decision_support.cjs` check #12 asserts this defensively.

### PHASE B — Logistics
- `POST /api/logistics/estimate` body accepts:
  `{crop_lot_id, market_name | destination_market, destination_label?,
  vehicle_type?, agreed_price_per_kg?}`.
- Destination is resolved by a `MANDI_CENTROIDS` table in
  `utils/geo.js` (Bengaluru APMC, Patna Mandi, Nashik APMC, Lasalgaon,
  Davangere, Agra Mandi, Azadpur Mandi, Mumbai APMC, Delhi Azadpur,
  Amritsar Mandi, Karnal Mandi, …). Falls back to haversine + lot's
  state centroid when no mandi match.
- Cost = `quantity_kg × distance_km × rate_per_km_per_kg` + loading +
  unloading + other (configured in `config.logistics`).
- Response carries `distance_km, transport_cost, loading_cost,
  unloading_cost, other_charges, total_logistics_cost, gross_value,
  net_realization, net_realization_per_kg, destination_label,
  destination_market, modal_price_per_kg, is_live_price, vehicle_type`.
- `GET /api/logistics/estimates/:lotId` lists all saved estimates for
  a lot.
- `GET /api/logistics/config` returns the public config snapshot
  (`maps_api_configured`, `routing_api_configured`, rate knobs).
- `LogisticsEstimate` document persists `destinationLabel,
  vehicleType, modalPricePerKg, isLivePrice` so the `Opportunities.jsx`
  page renders without changes.

### PHASE C — Cold Storage (already complete, untouched)
- `POST /api/cold-storage/estimate` returns `sell_now_value,
  store_then_sell_value, storage_cost, breakeven_price_per_kg,
  recommendation, rationale`. Rule-based, not a forecast.

### PHASE D — Net Realization / Decision Support
- `GET /api/decisions/:lotId` (and `POST .../refresh`) return
  `{id, crop_lot_public_id, recommendation, reason, rationale,
  comparison[], insufficient_data, offer_count, best_offer_price,
  created_at, updated_at}`.
- `comparison[]` is per-market: for each `MarketPrice` row of the
  lot's crop, the service runs a logistics estimate (origin → market
  centroid) and composes a row with `{market, state, location,
  modal_price, distance_km, total_logistics_cost, net_realisation}`.
- Decision rule (preserved): SELL_NOW if the best offer is ≥95% of
  expected; WAIT if no offers OR best offer < 80% of expected;
  GROUP_SALE if ≥2 similar active lots exist; otherwise WAIT.
- `insufficient_data = true` when no market rows, no expected price,
  and no offers exist for the lot.

### PHASE E — Buyer Demand (already correct, untouched)
- `GET /api/buyers/demands-for-lot/:publicId` returns `{results,
  count, crop_lot_id}` with `score + reasons[]` per demand. Match on
  crop / quantity / state / price. No private data leaks.

### PHASE F — Verification
- 2 new verifier scripts: `verify_decision_support.cjs` (16 checks)
  + `verify_phase_decision_e2e.cjs` (10 checks).
- All 15 verifier scripts pass (only the pre-existing
  `verify_fpo_route.cjs` 1/5 failure, which is unrelated to this
  phase — an assertion on App.jsx route string content).
- Frontend `npm run build` succeeds (138 modules, 463 kB JS, no
  diagnostics).

---

## 3. Tests passed

Backend (15 scripts):

| Script                              | Result                |
|-------------------------------------|-----------------------|
| verify_buyer_flow                   | 9/9  (ALL CHECKS PASSED) |
| verify_data_isolation               | 16/16                 |
| verify_decision_support (NEW)       | 16/16                 |
| verify_e2e                          | 33/33                 |
| verify_failures                     | 7/7                   |
| verify_fpo_defensive                | 9/9                   |
| verify_fpo_full_workflow            | 15/15                 |
| verify_fpo_join                     | 19/19                 |
| verify_fpo_route                    | 4/5 (pre-existing, unrelated to this phase) |
| verify_fpo_workflow                 | 21/21                 |
| verify_manual_workflow              | 16/16                 |
| verify_offers_array                 | 12/12                 |
| verify_phase_decision_e2e (NEW)     | 10/10                 |
| verify_phase2                       | 18/18                 |
| verify_role_dashboards              | 21/21                 |
| **TOTAL**                           | **226/227** |

The single failure (`verify_fpo_route` 4/5) was already failing
before this phase — it asserts on the `/fpos` (plural) vs `/fpo`
(singular) route string in `App.jsx` and was confirmed as a
pre-existing, out-of-scope issue.

Frontend:
- `npm run build` — succeeds, 138 modules, 463 kB JS, no diagnostics.

---

## 4. Remaining limitations

1. **AGMARKNET min/max**: the public AGMARKNET dataset on
   data.gov.in only emits `modal_price` (not min/max). The wire
   contract exposes `min_price` / `max_price` so future feeds (or
   other markets) can flow through unchanged. Today, min = max = modal
   by default.
2. **Routing**: the optional `ROUTING_URL` defaults to the public OSRM
   demo server. Free, but rate-limited. For production, swap in a
   paid routing provider (set `ROUTING_URL` + `ROUTING_API_KEY` in
   `.env`).
3. **Distance / cost numbers are still estimates** — haversine + per-kg
   cost logic, same as the Python version. No real-time fuel / vehicle
   tracking.
4. **WAIT decision is a current-data stability statement** — no
   future-price forecasting. ML price prediction was explicitly
   deferred to a later phase per the user's instruction.
5. **Cold-storage recommendation is rule-based** — not a forecast.
   `store_then_sell_price_per_kg` defaults to sell_now + 5% baseline
   when the user does not provide it, with a +0.1%/day uplift beyond
   7 days.
6. **Demand matching is rule-based** — exact crop name (case
   insensitive), location/state substring, price range. No semantic
   similarity / NLP.
7. **API key handling** — the key is read from `process.env` only on
   the backend, passed as a query param to `api.data.gov.in` over
   HTTPS, and **never returned in any response**. The
   `verify_decision_support.cjs` check #12 enforces this defensively.
8. **`verify_fpo_route.cjs` 1/5** — pre-existing failure, unrelated
   to this phase. Frontend route string is `/fpos` (plural) per
   `fpo-canonical-route` memory.

---

## 5. API keys / data you need to provide manually

The system is fully usable **with zero API keys** — the demo dataset
is always available as a fallback. To enable **live AGMARKNET data
for production**, set the following in `backend-node/.env`:

```ini
# data.gov.in AGMARKNET integration
DATA_GOV_IN_API_KEY=<your-key-from-data.gov.in>
DATA_GOV_IN_RESOURCE_ID=9ef84268-d588-465a-a308-a864a43d0070

# Optional — only if you want live routing instead of the
# public OSRM demo server. Both keys default to "" and the
# system falls back to haversine + state-centroid approximation.
ROUTING_URL=https://router.project-osrm.org
ROUTING_API_KEY=

# Optional — Google Maps key (the geo.js helpers do not require
# this; it is surfaced in /api/logistics/config for client UX).
MAPS_API_KEY=
```

The key is read from `process.env` only on the backend, passed to
`api.data.gov.in` over HTTPS, and never echoed in any response.
`verify_decision_support.cjs` check #12 asserts this defensively.

---

## 6. How to run

### Backend

```bash
cd backend-node
node src/server.js
# Listens on http://localhost:5050
# In-memory MongoDB is seeded automatically on boot.
```

### Frontend

```bash
cd frontend
npm install          # first time only
npm run dev          # Vite dev server on http://localhost:5173
# OR
npm run build && npm run preview   # production preview
```

### Verifier suite

```bash
cd backend-node
# All 15 scripts in sequence (each is independent; some need the
# frontend dev server on 5173):
node scripts/verify_buyer_flow.cjs
node scripts/verify_data_isolation.cjs
node scripts/verify_decision_support.cjs
node scripts/verify_e2e.cjs
node scripts/verify_failures.cjs
node scripts/verify_fpo_defensive.cjs
node scripts/verify_fpo_full_workflow.cjs
node scripts/verify_fpo_join.cjs
node scripts/verify_fpo_route.cjs
node scripts/verify_fpo_workflow.cjs
node scripts/verify_manual_workflow.cjs
node scripts/verify_offers_array.cjs
node scripts/verify_phase_decision_e2e.cjs
node scripts/verify_phase2.cjs
node scripts/verify_role_dashboards.cjs
```

Expected: **226 of 227 checks pass** (the 1 failure is the
pre-existing `verify_fpo_route.cjs` 4/5 issue).

### Demo users (auto-seeded)

| Role     | Email                        | Password    |
|----------|------------------------------|-------------|
| SELLER   | farmer@agroconnect.demo      | farmer123   |
| FPO      | fpo@agroconnect.demo         | fpo123      |
| ADMIN    | admin@agroconnect.demo       | admin123    |
| (buyers) | 6 seed buyer companies       | —           |

---

## 7. What was NOT done (per the user's instruction)

- **No ML price prediction** — explicitly deferred to a later phase.
- **No frontend redesign** — all wire-shape mismatches were resolved
  on the backend. The existing pages and slices were left untouched.
- **No new Python packages; no edits to `backend/`** — the old
  Python backend is fully preserved.
- **No invented AI** — the recommendation is a transparent rule
  (SELL_NOW / WAIT / GROUP_SALE); the cold-storage recommendation is
  a transparent rule (SELL_NOW / STORE_THEN_SELL / NEUTRAL).
- **No replacement of working functionality with mocks** — every
  live provider has a clearly-labelled demo fallback (the demo is
  the fallback, not a replacement).
- **No deletion of the old `backend/`** — it remains in place.
- **No new external integrations** beyond data.gov.in/AGMARKNET and
  the optional OSRM public router.
