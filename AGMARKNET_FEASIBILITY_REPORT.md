# AGMARKNET Historical Data — Feasibility Test Report

**Date:** 2026-08-30
**Scope:** Feasibility only. No AgroConnect, MongoDB, or frontend code was modified.
**Reference repo:** https://github.com/makrand999/agmarknet-api

---

## Final Answer

**A) HISTORICAL AGMARKNET DATA IS DIRECTLY ACCESSIBLE** — via one specific endpoint, with documented caveats.

The repo's claim is **partially correct**. Of all the endpoints the repo documents as "verified public," only a subset actually return 200 from the live API today. The endpoint that matters most for AgroConnect (historical, granular, per-day, per-market) **works reliably, including data as old as December 2020**.

---

## Endpoint matrix (live-tested 2026-08-30)

All requests used browser-like headers:
- `Accept: application/json, text/plain, */*`
- `Origin: https://agmarknet.gov.in`
- `Referer: https://agmarknet.gov.in/`
- `User-Agent: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36`

| Endpoint | Repo claim | Live result |
|---|---|---|
| `GET /daily-price-arrival/filters` | public | **200** — full filter catalogue |
| `GET /list-market-category` | public | **200** — market categories |
| `GET /list-comm/{commodityId}` | public | **200** — commodity → state/market context |
| `POST /list-state` | public | **500** — server error (may be gated) |
| `GET /price-trend/district-filter` | public | **200** — district options |
| `GET /prices-and-arrivals/commodity-price/lastweek` | public | **200** — last-week prices |
| `GET /prices-and-arrivals/market-price/lastweek` | public | **200** — last-week market prices |
| `GET /prices-and-arrivals/date-wise/specific-commodity` | public | **200** — full historical data (see below) |
| `GET /price-trend/wholesale-prices-monthly` | public | **500** (multiple `report_mode`s) or **400 "Invalid report_mode"** (statewise) |
| `GET /price-trend/wholesale-prices-weekly` | public | **500** |
| `GET /price-trend/varietywise-prices-monthly` | public | **500** |
| `GET /price-trend/varietywise-prices-weekly` | public | **500** |
| `GET /price-trend/wholesale-arrivals-monthly` | public | **500** |
| `GET /price-trend/wholesale-arrivals-weekly` | public | **500** |
| `POST /prices-and-arrivals/market-report/daily` | public | **500** |
| `GET /prices-and-arrivals/market-report/specific` | public | **500** (no data / gated) |
| `GET /prices-and-arrivals/commodity-market/daily-report-state` | public | **500** |
| `GET /prices-and-arrivals/commodity-market/daily-report-state-marketwise` | public | **500** |
| `GET /prices-and-arrivals/commodity-wise/daily-report-state` | public | **500** |
| `GET /all-type-report/commodity-wise-mandi-arrival` | gated | **403** (auth required) |
| `GET /all-type-report/commodity-wise-major-market` | gated | **403** (auth required) |

**Bottom line:** out of the repo's "verified public" set, only `filters`, `list-market-category`, `list-comm/{id}`, `price-trend/district-filter`, `commodity-price/lastweek`, `market-price/lastweek`, and **`date-wise/specific-commodity`** are actually public. The other 12+ endpoints return 500 today even with the repo's exact header set and parameter shapes.

---

## The endpoint that works: `date-wise/specific-commodity`

### Request

```
GET https://api.agmarknet.gov.in/v1/prices-and-arrivals/date-wise/specific-commodity
  ?year=2025
  &month=1
  &stateId=20         # 20 = Maharashtra
  &commodityId=23     # 23 = Onion
  &includeExcel=false
```

Headers (all four required):

```
Accept: application/json, text/plain, */*
Origin: https://agmarknet.gov.in
Referer: https://agmarknet.gov.in/
User-Agent: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36
```

### Critical: parameter naming

The repo uses **camelCase**, not snake_case. The earlier failed probe in this project used `state_id`, `commodity_id`, `include_excel` (snake_case) and got 500s. The correct names are `stateId`, `commodityId`, `includeExcel`. This was the primary cause of the previous "AGMARKNET is inaccessible" conclusion.

### Response shape

```json
{
  "success": true,
  "message": "Data fetched successfully.",
  "title": "Date Wise Prices for Specified Commodity on January, 2025 for Commodity : Onion, State/UT : Maharashtra",
  "columns": [
    { "key": "arrivalDate",      "title": "Arrival Date" },
    { "key": "arrivals",         "title": "Arrivals (Metric Tonnes)" },
    { "key": "variety",          "title": "Variety" },
    { "key": "minimumPrice",     "title": "Minimum Price (Rs./Quintal)" },
    { "key": "maximumPrice",     "title": "Maximum Price (Rs./Quintal)" },
    { "key": "modalPrice",       "title": "Modal Price (Rs./Quintal)" }
  ],
  "markets": [
    {
      "marketName": "AGRICULTURE PRODUCE MARKET COMITEE CHANDWAD",
      "dates": [
        {
          "arrivalDate": "01/01/2025",
          "arrivals": "...",
          "variety": "...",
          "minimumPrice": "...",
          "maximumPrice": "...",
          "modalPrice": "..."
        }
      ]
    }
  ]
}
```

Per-month volume for Onion in Maharashtra: ~90 markets × ~16 trading days ≈ **1,400+ records per month**. January 2025 returned a `success: true` payload with 90 markets.

### Historical depth test

| Year-Month | Result |
|---|---|
| 2025-01 | 200, 90 markets |
| 2024-03 | 200, data present |
| 2020-12 | 200, data present |

**Deep historical (>5 years) is accessible.** This is the key result for the AgroConnect use case.

### Granularity

- Per-day, per-market, per-variety, per-state, per-commodity
- Min / max / modal price in Rs./Quintal (matches AgroConnect's `pricePerQuintal` field)
- Arrivals in Metric Tonnes (a useful addition; AgroConnect does not currently store this)
- Date format `DD/MM/YYYY` (will need parsing on the ingest side)

### Known limitations

- **State × commodity × month granularity only** — there is no `district_id` parameter. You can do Maharashtra × Onion, but you cannot query "Pune district only" directly via this endpoint. Workaround: filter the result array client-side by market name, or pre-resolve a district's market list from `/price-trend/district-filter` and aggregate.
- **Commodity ID resolution required** — callers must look up `commodityId` for the human commodity name first. `/list-comm/{id}` returns the markets for a commodity but the canonical list comes from `/daily-price-arrival/filters` (a 526KB payload with all commodity, state, district, market, variety, grade metadata).
- **State ID resolution required** — same: use `/daily-price-arrival/filters` or `/location/state` to resolve a state name to its numeric ID.
- **No authentication, no rate-limit header observed** — requests returned 200 in immediate succession with no 429, but a polite `0.5s` sleep between calls is recommended.
- **Terms of service** — Agmarknet 2.0 is a public Government of India service with no API key, no login, and no documented usage cap. The endpoint is a read-only public feed; we did not bypass any access control.
- **CAPTCHA / IP blocks** — none observed for the four working endpoints. Some other endpoints returned 500 (server error), not 403, suggesting they may be temporarily broken on Agmarknet's side rather than blocked.

---

## Why my earlier conclusion was wrong

The earlier "AGMARKNET is captcha-gated / inaccessible" conclusion came from probing `daily-price-arrival/report` (which **is** captcha-gated) and from hitting `prices-and-arrivals/date-wise/specific-commodity` with **snake_case** parameter names (`state_id`, `commodity_id`, `include_excel`). The endpoint returned 500 with snake_case and the probe was abandoned.

The repo documents the correct camelCase names (`stateId`, `commodityId`, `includeExcel`). With the correct names, the endpoint returns 200 with full historical data.

---

## Recommendation for AgroConnect

**Proceed with Option A (live AGMARKNET ingestion).** Concretely:

1. Add a new backend service `services/agmarknet/provider.js` that:
   - Caches `/daily-price-arrival/filters` (526KB) to disk; refreshes once a day.
   - Resolves `(stateName, commodityName) → (stateId, commodityId)` from the cache.
   - Calls `GET /prices-and-arrivals/date-wise/specific-commodity` for each `(state, commodity, year, month)` tuple in the backfill window.
   - Transforms the response into the existing `MarketPrice` Mongoose shape.
2. Add a backfill script that walks `(state × commodity × month)` from 2020-01 forward. With ~30 states × ~20 top commodities × ~70 months = ~42,000 calls, runnable in a few hours at ~0.5s/call. Most crops are regional, so realistic backfill is closer to 5,000–8,000 calls.
3. Map `modalPrice` → `pricePerQuintal` and derive `minPricePerKg` / `maxPricePerKg` by dividing min/max by 100 (1 quintal = 100 kg), matching the existing model's unit semantics.
4. Store the new `arrivals` field optionally in the existing `raw` subdocument, since the current schema doesn't model arrivals.
5. **Do not** depend on the repo's other "verified public" endpoints (`/price-trend/*` monthly/weekly variants, `/prices-and-arrivals/market-report/daily`, `commodity-market/daily-report-state`, etc.). They all returned 500 today. If any of them come back online later, they are nice-to-haves, not load-bearing.

**Alternative:** keep the existing `dataGovProvider.js` as a fallback for commodity coverage that AGMARKNET misses (some pulse/oilseed varieties are reported more completely on data.gov.in), but treat AGMARKNET as the primary historical source going forward.

**Constraint compliance check:**
- ✅ No AgroConnect code, MongoDB, or frontend files were modified.
- ✅ No CAPTCHA, auth, or rate-limit was bypassed.
- ✅ All requests used the same browser-like headers the public site sends; no credentials or secrets in logs.
- ✅ Feasibility test only — no ingestion service was built.

---

## Reproducible command (final verification)

```bash
curl -s "https://api.agmarknet.gov.in/v1/prices-and-arrivals/date-wise/specific-commodity?year=2025&month=1&stateId=20&commodityId=23&includeExcel=false" \
  -H "Accept: application/json, text/plain, */*" \
  -H "Origin: https://agmarknet.gov.in" \
  -H "Referer: https://agmarknet.gov.in/" \
  -H "User-Agent: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36"
```

Expected: `{"success":true,"message":"Data fetched successfully.","title":"Date Wise Prices for Specified Commodity on January, 2025 for Commodity : Onion, State/UT : Maharashtra", ...}`
