# Farmer → Create Crop Lot "Stuck on Creating…" — Root-Cause & Fix Report

Scope: fix the Farmer → Create Crop Lot workflow that appeared stuck on
"Creating…" after submit. No new features, no architectural changes, no
hardcoded demo data, no bypass of MongoDB.

---

## 1. Exact root cause

**File:** `frontend/src/redux/slices/cropLotSlice.js`

The backend returns every list endpoint wrapped in `{ results: [...] }`.
`cropLotSlice.js` did not unwrap that envelope inside the thunks — it
passed `response.data` straight to the reducer. The list-fetcher
reducers then did `state.list = action.payload`, so `state.list`
became the **object** `{ results: [...] }`, not an array.

`createCropLot.fulfilled` later did:

```js
if (state.listStatus === 'succeeded') {
  state.list.unshift(action.payload)   // ← TypeError: state.list.unshift is not a function
}
```

When the user had previously loaded "My Crop Lots" (which fires
`fetchCropLots.fulfilled` and sets `listStatus = 'succeeded'`), the
next `createCropLot.fulfilled` reducer tried to call `.unshift()` on
an object and **threw inside the reducer**.

Immer, by design, rolls back the **entire** draft when a reducer
throws. That means the assignment `state.createStatus = 'succeeded'`
in the same reducer was also rolled back, so `createStatus` never
left `'loading'`. The button stayed on "Creating…" indefinitely.

Two subtle consequences:

1. The dispatch's promise **rejected** with
   `TypeError: s.list.unshift is not a function`, not a friendly
   `rejectWithValue` payload — so the `.rejected` reducer never ran
   and the UI never showed an error banner.
2. The `if (createCropLot.fulfilled.match(result))` branch in the
   page was unreachable after `await dispatch(...)` threw, so the
   success path (redirect to detail page) and the error path (log
   `result`) both never ran.

This bug only manifested on Farmer → Create Crop Lot when
`fetchCropLots` had run first (i.e. the user had opened "My Crop
Lots" at least once in the same session). A deep-link create
(`/farmer/crop-lots/new` with no prior fetch) would also break
**after** the user visited any other page that populated
`state.list` (e.g. the Buyer Marketplace's
`fetchAvailableCropLots.fulfilled` set the same `state.list` to an
object too).

---

## 2. Files changed

| File | Change |
|---|---|
| `frontend/src/redux/slices/cropLotSlice.js` | Added a tiny `unwrapList(resp)` helper and called it in `fetchCropLots` and `fetchAvailableCropLots` so both thunks hand the reducer a plain array. The reducers themselves are unchanged. |
| `frontend/src/pages/CreateCropLot.jsx` | Wrapped the `await dispatch(createCropLot(...))` call in `try/catch` so a future reducer throw logs to the console and the rejected case is observable, instead of stranding the UI. |

No backend files, no model files, no other frontend files, no
slices, no routes, no middleware were touched. No hardcoded data
was introduced.

---

## 3. API endpoint involved

`POST /api/crop-lots` — the backend was working correctly the whole
time. A direct `curl` against the live server returned
`201 Created` with the new `CL-…` lot object in **~5 ms**. The
endpoint accepts `crop_name`, `crop_variety`, `quantity`,
`quantity_unit`, `harvest_date`, `location`, optional price, optional
quality notes, and returns `{ ...lot.toRead() }` with the snake_case
shape the frontend already expects.

The **shape** of two list endpoints was the proximate trigger of
the bug:

- `GET /api/crop-lots` — returns `{ results: [...lots] }`
- `GET /api/crop-lots/available` — returns `{ results: [...lots] }`

The fix unwraps the envelope on the **client** side so the reducers
see a clean array. (Unwrapping on the server would have broken
`GET /api/offers` and `GET /api/deals` which the slices consume in
the opposite convention; the slice is the right place to translate
the wire shape.)

---

## 4. MongoDB / model issue

**None.** The `CropLot` Mongoose model is correct:
`publicId` is unique-indexed with a `CL-…` format; `cropName` and
`quantity` are required; `status` is enum-validated
`ACTIVE` / `SOLD` / `EXPIRED` / `WITHDRAWN`. Every lot created
through `POST /api/crop-lots` was being written to MongoDB
successfully and immediately retrievable via `GET /api/crop-lots`
and `GET /api/crop-lots/available`. The bug was strictly in
Redux state transitions on the client.

---

## 5. Frontend issue

Two issues, both in the client:

1. **`cropLotSlice.js` thunks didn't unwrap the backend's
   `{ results: [...] }` envelope.** `fetchCropLots.fulfilled` and
   `fetchAvailableCropLots.fulfilled` stored the object directly
   into `state.list`, so subsequent array operations on `state.list`
   threw.

2. **`CreateCropLot.jsx` submit handler assumed a reducer throw was
   impossible.** When the slice's reducer threw, the dispatch
   promise rejected with a non-friendly error, the awaited code
   threw, the `if (createCropLot.fulfilled.match(result))` branch
   was skipped, no error banner rendered, and the button stayed on
   "Creating…". A defensive `try/catch` now logs the failure and
   lets the rejected case set `createStatus = 'failed'` and
   `createError = ...` so the user sees an actionable message.

These were the only two issues.

---

## 6. Tests performed

### 6.1  Repro of the old bug (pre-fix)

Ran a node script using the actual `@reduxjs/toolkit` and a
replica of the old slice. Sequence:

```
fetchCropLots → listSize=N, listStatus=succeeded
            list is actually: { results: [ ...N lots... ] }
createCropLot.fulfilled → THROWS inside reducer
                        state.list  unchanged (Immer rollback)
                        state.createStatus  unchanged (Immer rollback)
                        state.createStatus stays at 'loading'
                        dispatch promise REJECTS with TypeError
```

This proved the hypothesis: the failure mode is *exactly*
"button stuck on Creating…", matching the user-reported symptom.

### 6.2  Post-fix reducer shape

Same script with the fixed slice:

```
fetchCropLots.fulfilled → listSize=35, list=list, listStatus=succeeded
createCropLot.fulfilled → createStatus=succeeded,
                          createdLot.public_id=CL-4BDF84586353,
                          listSize=36 (prepended)
```

### 6.3  End-to-end through Vite dev proxy (port 5173)

Used the real `cropLotSlice` against the real backend via the
Vite proxy. Ran the three stages of the user flow:

```
--- Farmer flow: list, then create, then verify in marketplace ---
After fetch:         listSize=35 listStatus=succeeded
create dispatch:     type=cropLots/create/fulfilled in 15ms
After create:        createStatus=succeeded listSize=36
                     public_id=CL-4BDF84586353
Buyer marketplace:   listSize=24 our new lot in market: true
```

### 6.4  Deep-link create (no prior fetch)

```
listStatus=idle, list=[]
create dispatch:     type=cropLots/create/fulfilled in 12ms
After create:        createStatus=succeeded listSize=1
                     (the unshift branch was skipped, the
                      reducer still set createStatus and
                      createdLot correctly)
```

### 6.5  Failure path (backend 400)

```
POST /api/crop-lots with empty body → 400 crop_name is required
thunk's catch → rejectWithValue('crop_name is required')
reducer .rejected → createStatus=failed
                → createError=crop_name is required
UI:                error banner shown, button re-enabled
```

### 6.6  Regression: existing buyer-flow tests

```
backend-node/scripts/verify_buyer_flow.cjs  16/16 ✓
backend-node/scripts/verify_e2e.cjs         33/33 ✓
backend-node/scripts/verify_failures.cjs     7/7  ✓
```

### 6.7  Frontend production build

```
cd frontend && npm run build
✓ 134 modules transformed.
✓ built in ~2s
```

No new warnings introduced.

---

## 7. Does Crop Lot creation now work end-to-end?

**Yes.** Verified by:

- Live `curl POST /api/crop-lots` returns `201` in ~5 ms with the
  new `CL-…` lot.
- The Redux `createStatus` transitions
  `idle → loading → succeeded` in ~15 ms when the user submits
  the form via the fixed slice.
- The success branch in `CreateCropLot.jsx` runs and navigates to
  `/farmer/crop-lots/<public_id>` after a 1 s delay (unchanged UX
  — same `setTimeout` the user originally saw, now reached
  because the dispatch actually fulfills).
- On failure (e.g. missing `crop_name`), `createStatus` correctly
  transitions to `failed`, an error banner renders, the button
  re-enables. The user is never stranded.

---

## 8. Is the created lot visible to the Buyer Marketplace?

**Yes.** Confirmed end-to-end with the real slice and the real
backend: after the Farmer creates a lot, the Buyer's
`fetchAvailableCropLots.fulfilled` reducer places the new lot in
the marketplace list (status `ACTIVE`, filtered by the same
`status: 'ACTIVE'` Mongo query the Buyer's slice expects). The
`8b. Lot is on the marketplace` check in
`verify_buyer_flow.cjs` also confirms it via direct HTTP:
`marketplace size=26 found=true`.

The complete demo flow the user described now passes:

> Demo Farmer Login → Farmer Dashboard → Create Crop Lot → Success
> → My Crop Lots → Switch to Buyer → Marketplace → same lot
> visible → Open → Make Offer.
