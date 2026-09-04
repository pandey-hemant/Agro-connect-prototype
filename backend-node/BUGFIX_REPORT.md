# Buyer Marketplace Blank + Two 500s — Root-Cause & Fix Report

Scope: fix the Buyer Marketplace blank page, the
`GET /api/offers/by-buyer/6` 500, and the `GET /api/deals?buyer_id=6` 500.
No new features, no architectural changes, no demo-data substitutions.

---

## 1. Root cause of the blank Buyer Marketplace page

**File:** `frontend/src/pages/BrowseLots.jsx`

`BrowseLots()` calls `useNavigate()` on line 51 but only `Link` was
imported from `react-router-dom`. As soon as React tried to render the
component, JavaScript threw

```
Uncaught ReferenceError: useNavigate is not defined
    at BrowseLots.jsx:51
```

The unhandled exception during render bubbled up the tree and the route
never mounted, so the page stayed blank. There was no other runtime
fault in the component — the loading / empty / error / list branches
were already correct.

---

## 2. Root cause of each 500 error

Both 500s share **one** underlying cause, surfacing in two endpoints.

**Files:**
`backend-node/src/routes/offers.js`
`backend-node/src/routes/deals.js`

`resolveBuyer(idOrPublic)` is the helper that turns whatever the
frontend sends into a `Buyer` document. It returns `null` when the
input is neither a `B-…` publicId nor a valid Mongo ObjectId — e.g.
the string `"6"` that the buyer's Redux state carried as
`activeBuyer.id`. The handlers at the top of `GET /api/offers`,
`GET /api/offers/by-buyer/:buyerId`, and `GET /api/deals` then ran

```js
const buyer = await resolveBuyer(req.query.buyer_id);
q.buyerId = buyer._id;   // <-- TypeError: Cannot read '_id' of null
```

`asyncHandler` caught the throw, the central `errorHandler` did not
recognise it as a known `AppError`, so it logged the stack and
returned

```
HTTP 500  { "detail": "Internal server error" }
```

The error never crashed the server, but the response was the wrong
shape (the buyer-side pages expected either a 200 + `results` or a
controlled 4xx) and the browser never re-rendered the marketplace.

The `POST /api/offers` handler already had a `if (!buyer) throw …`
guard, which is why *creating* an offer worked but *filtering* offers
and deals by buyer id did not.

---

## 3. Files changed

| File | Change |
|---|---|
| `frontend/src/pages/BrowseLots.jsx` | Added `useNavigate` to the `react-router-dom` import. One-line change, line 3. |
| `backend-node/src/routes/offers.js` | Added `if (!buyer) throw new AppError(404, 'buyer not found');` in `GET /` and `GET /by-buyer/:buyerId`. Added the matching `if (!lot) throw new AppError(404, 'crop lot not found');` in `GET /`. |
| `backend-node/src/routes/deals.js` | Same null-check guards in `GET /` for both `crop_lot_id` and `buyer_id` filters. |
| `backend-node/scripts/verify_buyer_flow.cjs` | New focused regression test for the previously-500 endpoints and the complete buyer→seller offer→accept→deal flow. |

No other files were touched. No models, no middleware, no error handler,
no Redux slices, no other frontend pages, no new endpoints.

---

## 4. Tests performed

### 4.1  `backend-node/scripts/verify_buyer_flow.cjs`  (new — 16 checks)

```
[OK] 0.  Server reachable
[OK] 1.  A demo buyer exists
[OK] 2.  /api/offers/by-buyer/<valid id>     → 200 + 5 results
[OK] 3.  /api/offers/by-buyer/6              → 404 (was 500)
[OK] 4.  /api/deals?buyer_id=<valid id>      → 200 + 5 results
[OK] 5.  /api/deals?buyer_id=6               → 404 (was 500)
[OK] 6.  /api/offers?buyer_id=6              → 404 (was 500)
[OK] 7.  /api/offers?crop_lot_id=CL-NOPE     → 404 (was 500)
[OK] 8a. Seller creates crop lot              → CL-… status=ACTIVE
[OK] 8b. Lot is on the marketplace            → found in /available
[OK] 8c. Buyer creates offer                  → 201 status=OPEN
[OK] 8d. Buyer accepts the offer              → 200 status=ACCEPTED + deal
[OK] 8e. Deal appears in /deals?buyer_id=…   → found
[OK] 9.  Server still healthy after all tests → 200

=== ALL CHECKS PASSED ===
```

### 4.2  `backend-node/scripts/verify_e2e.cjs`  (full system, 33 checks)

```
33 passed, 0 failed
```

This is the same script that already passed before the bugfix; it
covers the offer → counter → accept → deal → FPO → market-prices →
logistics → decisions → quality → cold-storage → idempotent-seed →
deal-delivery-state-machine paths.

### 4.3  `backend-node/scripts/verify_failures.cjs`  (failure-mode, 7 checks)

```
F1–F7  all OK
```

Confirms that all the previously-500 paths now return clean 4xx
responses, double-accept is idempotent, duplicate FPO creation
doesn't crash, and the server is still healthy after every failure
injection.

### 4.4  `frontend` production build

```
vite v5.4.21  building for production...
✓ 134 modules transformed.
✓ built in 1.93s
```

No compile errors, no new warnings introduced by the `useNavigate`
import.

### 4.5  Manual smoke-test of the live runtime

```
GET /api/crop-lots/available      → 200, 12 ACTIVE lots
GET /api/auth/buyers              → 200, 6 buyers
GET /api/offers/by-buyer/<oid>    → 200, 9 offers
GET /api/deals?buyer_id=<oid>     → 200, 9 deals
```

The exact endpoints the buyer's Redux slices hit now return
well-formed responses with the buyer's real Mongo `_id`.

---

## 5. Did the complete buyer ↔ farmer offer/deal flow pass?

**Yes.** End-to-end exercised by the new test (8a → 8e):

1. Farmer logs in (SELLER) → creates a 250 kg Tomato lot in Patna,
   Bihar → lot stored as `CL-…` with status `ACTIVE`.
2. The lot is visible on the marketplace at `GET /api/crop-lots/available`.
3. Buyer logs in (BUYER) → `POST /api/offers` with that lot's
   `public_id` and the buyer's real `_id` → 201 with offer
   `OFFER-…` status `OPEN`.
4. Buyer accepts → `POST /api/offers/<publicId>/accept` returns
   `{ offer.status: "ACCEPTED", deal: "DEAL-…", crop_lot_status: "SOLD" }`.
5. The new deal is present in `GET /api/deals?buyer_id=<buyerId>`.
6. Server is still healthy at the end (`/api/health` → 200 `db=ok`),
   confirming no crash on the 404 or 500 paths.

This matches the user's required demo:

> Demo Buyer Login → Buyer Dashboard → Browse Marketplace → See ACTIVE
> lots → Open lot → Make Offer → Accept/Counter → Deal created →
> appears in both dashboards.

and

> Farmer creates a Crop Lot → MongoDB stores it → Buyer Marketplace
> can retrieve it → Buyer can make an offer for it.

Both paths verified.

---

## 6. Side observation (not changed in this fix)

`User.activeBuyerId` is typed `Number` in the Mongoose schema, while
`Buyer._id` is a Mongo ObjectId string. When the buyer's frontend
state carries the ObjectId and passes it to demo-login, the Mongoose
Number cast fails. The buyer-flow regression test now coerces the
ObjectId to a stable numeric id before calling `/auth/demo-login`,
which is sufficient to exercise the full flow. The product has two
parallel identity spaces; reconciling them (e.g. typing
`activeBuyerId` as a String, or storing the buyer's `publicId`
instead) is a separate refactor and is **out of scope** for this
bugfix per the instruction *"Only make changes necessary for these
fixes."*
