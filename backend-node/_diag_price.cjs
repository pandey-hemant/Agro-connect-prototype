// _diag_price.cjs — diagnostic: trace ONE real AGMARKNET date-wise
// response for Maharashtra + Onion + 2023-01, and print:
//   1. the raw top-level shape
//   2. one raw markets[0].dates[0] record (every field, every value)
//   3. the post-fetchDateWise() record for that same datum
//   4. the post-rawToDoc() shape (modalPrice, etc.)
//
// Run with:  node _diag_price.cjs
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const provider = require('./src/services/agmarknet/provider');
const orch = require('./src/services/agmarknet/orchestrator');

(async () => {
  try {
    const filters = await provider.getFilters();
    if (!filters.ok) {
      console.log('FILTERS FAIL', JSON.stringify(filters));
      process.exit(1);
    }
    const cm = provider.resolveCommoditySync('Onion');
    const st = provider.resolveStateSync('Maharashtra');
    console.log('commodity match:', JSON.stringify(cm));
    console.log('state match:    ', JSON.stringify(st));
    if (!cm || !st) { console.log('resolution failed'); process.exit(1); }

    // Use the live provider to fetch one real slice.
    const r = await provider.fetchDateWise({
      year: 2023,
      month: 1,
      stateId: st.id,
      commodityId: cm.id,
      includeExcel: false,
    });
    console.log('fetch ok:', r.ok, 'records:', r.records.length);
    if (!r.ok) { console.log('fetch error:', r.error); process.exit(1); }
    if (r.records.length === 0) { console.log('NO RECORDS'); process.exit(1); }

    // Show every distinct key that appears across all `raw` records
    // so we can see the actual upstream field naming instead of
    // guessing. This is the part the original diagnostic was missing.
    const allKeys = new Set();
    for (const rec of r.records.slice(0, 50)) {
      if (rec && rec.raw && typeof rec.raw === 'object') {
        for (const k of Object.keys(rec.raw)) allKeys.add(k);
      }
    }
    console.log('--- DISTINCT raw keys seen across first 50 records ---');
    console.log(JSON.stringify(Array.from(allKeys).sort(), null, 2));

    // For the first 3 records, also print both the raw record and
    // the mapped record side-by-side so the price-field mapping
    // (the suspected bug) is visible at a glance.
    for (let i = 0; i < Math.min(3, r.records.length); i += 1) {
      const fetched = r.records[i];
      console.log(`\n--- record[${i}] raw upstream ---`);
      console.log(JSON.stringify(fetched.raw, null, 2));
      console.log(`--- record[${i}] post-fetchDateWise() ---`);
      console.log(JSON.stringify({
        marketName: fetched.marketName,
        marketState: fetched.marketState,
        marketDistrict: fetched.marketDistrict,
        variety: fetched.variety,
        grade: fetched.grade,
        arrivalDate: fetched.arrivalDate,
        arrivals: fetched.arrivals,
        minPricePerQuintal: fetched.minPricePerQuintal,
        modalPricePerQuintal: fetched.modalPricePerQuintal,
        maxPricePerQuintal: fetched.maxPricePerQuintal,
        priceUnit: fetched.priceUnit,
      }, null, 2));
      console.log(`--- record[${i}] post-rawToDoc() ---`);
      const doc = orch.rawToDoc(fetched, { stateName: 'Maharashtra', commodityName: 'Onion' });
      console.log(JSON.stringify(doc, null, 2));
    }
  } catch (e) {
    console.error('ERR', e && e.stack || e);
    process.exit(1);
  }
})();
