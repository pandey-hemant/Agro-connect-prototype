/**
 * scripts/verify_agmarknet_pipeline.cjs — Phase 5 unit checks for the
 * AGMARKNET provider + orchestrator.
 *
 * Six checks, all run offline (no network, no server). Pure-function
 * checks run first, then the orchestrator's upsert path against an
 * in-memory MongoDB.
 *
 *   1.  provider._internal.normalizeDate handles DD/MM/YYYY, YYYY-MM-DD,
 *       and rejects bad input.
 *   2.  provider._internal.toNumberOrNull strips commas/whitespace,
 *       returns null for non-numeric / empty.
 *   3.  provider._internal.asNameIdList coerces varied upstream shapes
 *       (state_id / commodity_id / state_name / commodity_name …).
 *   4.  provider._internal.resolveNameId matches case-insensitively
 *       and falls back to substring when no exact match.
 *   5.  orchestrator.rawToDoc maps a typical AGMARKNET row into a
 *       MarketPrice-shaped doc and flags invalid rows.
 *   6.  orchestrator.normalizeAndUpsert is idempotent: a second call
 *       with the same records produces 0 inserts and 0 updates.
 */
'use strict';

let PASS = 0;
let FAIL = 0;
const failures = [];

function step(n, label, ok, detail = '') {
  if (ok) {
    PASS += 1;
    console.log(`[OK]   ${n}. ${label}${detail ? `  — ${detail}` : ''}`);
  } else {
    FAIL += 1;
    failures.push(`${n}. ${label}${detail ? ` — ${detail}` : ''}`);
    console.log(`[FAIL] ${n}. ${label}${detail ? `  — ${detail}` : ''}`);
  }
}

function eq(actual, expected) {
  if (actual === expected) return true;
  try {
    return JSON.stringify(actual) === JSON.stringify(expected);
  } catch (_) {
    return false;
  }
}

// ----- check 1: normalizeDate -----
const provider = require('../src/services/agmarknet/provider');
const { normalizeDate, toNumberOrNull, asNameIdList, resolveNameId,
        pickFirstNonEmpty } = provider._internal;
const { rawToDoc, normalizeAndUpsert } = require('../src/services/agmarknet/orchestrator');

step(
  1,
  'normalizeDate handles DD/MM/YYYY and YYYY-MM-DD',
  normalizeDate('31/01/2025') === '2025-01-31' &&
    normalizeDate('1/1/2025') === '2025-01-01' &&
    normalizeDate('2025-01-31') === '2025-01-31' &&
    normalizeDate('') === '' &&
    normalizeDate(null) === '' &&
    normalizeDate('not a date') === ''
);

// ----- check 2: toNumberOrNull -----
step(
  2,
  'toNumberOrNull strips commas and returns null for empty / non-numeric',
  toNumberOrNull('1,234.5') === 1234.5 &&
    toNumberOrNull(' 42 ') === 42 &&
    toNumberOrNull('') === null &&
    toNumberOrNull(null) === null &&
    toNumberOrNull('abc') === null &&
    toNumberOrNull(0) === 0
);

// ----- check 3: asNameIdList -----
const sampleCatalogue = {
  state_data: [
    { state_id: 1, state_name: 'Maharashtra' },
    { state_id: 2, state_name: 'Karnataka' },
    { id: 3, name: 'Tamil Nadu' },
    { junk: true },
  ],
  commodity_data: [
    { commodity_id: 10, commodity_name: 'Onion' },
    { commodity_id: 20, commodity_name: 'Tomato' },
  ],
};
const stateList = asNameIdList(sampleCatalogue.state_data);
step(
  3,
  'asNameIdList normalises {id, name} and {*_id, *_name} shapes',
  stateList.length === 3 &&
    stateList[0].id === '1' &&
    stateList[0].name === 'Maharashtra' &&
    stateList[2].name === 'Tamil Nadu'
);

// ----- check 4: resolveNameId -----
const mh = resolveNameId(sampleCatalogue, 'state_data', 'Maharashtra');
const tn = resolveNameId(sampleCatalogue, 'state_data', 'maha'); // substring
const missing = resolveNameId(sampleCatalogue, 'state_data', 'Atlantis');
const onion = resolveNameId(sampleCatalogue, 'commodity_data', 'onion'); // case-insensitive
step(
  4,
  'resolveNameId matches exact > substring > case-insensitive',
  mh && mh.id === '1' &&
    tn && tn.id === '1' &&
    missing === null &&
    onion && onion.id === '10'
);

// ----- check 4b: pickFirstNonEmpty -----
// Covers the bug that produced 100% softFlagCount.missing_or_invalid_modal_price
// in the 2x2x3 validation: the upstream may use a field name we did not
// anticipate (e.g. the space-separated "Modal Price" title form).
const pfn = (obj, keys) => pickFirstNonEmpty(obj, keys);
step(
  '4b',
  'pickFirstNonEmpty resolves every expected upstream variant',
  // exact key wins
  pfn({ modalPrice: 1800 }, ['modalPrice']) === 1800 &&
    // snake_case fallback
    pfn({ modal_price: 1800 }, ['modalPrice', 'modal_price']) === 1800 &&
    // space-separated title form
    pfn({ 'Modal Price': 1800 }, ['modalPrice', 'Modal Price']) === 1800 &&
    // UPPER_SNAKE form
    pfn({ MODAL_PRICE: 1800 }, ['modalPrice', 'MODAL_PRICE']) === 1800 &&
    // mixed-case title form
    pfn({ 'modal price': 1800 }, ['modalPrice', 'modal price']) === 1800 &&
    // no match → undefined (not '')
    pfn({ arrivals: 100 }, ['modalPrice', 'modal_price']) === undefined &&
    // empty string is skipped (not returned as the value)
    pfn({ modalPrice: '', modal_price: 1800 }, ['modalPrice', 'modal_price']) === 1800 &&
    // null is skipped
    pfn({ modalPrice: null, modal_price: 1800 }, ['modalPrice', 'modal_price']) === 1800
);

// ----- check 5: rawToDoc -----
const goodRaw = {
  marketName: 'Lasalgaon',
  marketState: 'Maharashtra',
  marketDistrict: 'Nashik',
  variety: 'Red',
  grade: 'FAQ',
  arrivalDate: '31/01/2025',
  arrivals: 1200,
  minPricePerQuintal: 1500,
  modalPricePerQuintal: 1800,
  maxPricePerQuintal: 2100,
  priceUnit: 'Rs./Quintal',
  raw: { x: 1 },
};
const goodDoc = rawToDoc(goodRaw, { stateName: 'Maharashtra', commodityName: 'Onion' });
// After the 2×2×3 validation, an empty `marketName` is no longer a
// hard reject — it falls back to the state name and surfaces a soft
// flag so the quality pipeline can still see it was unusual.
const softMarket = rawToDoc(
  { marketName: '', arrivalDate: '31/01/2025', modalPricePerQuintal: 1000 },
  { stateName: 'Maharashtra', commodityName: 'Onion' }
);
// A missing modal price is persisted as a "no-trading-day" row and
// soft-flagged; the orchestrator never drops it anymore.
const softModal = rawToDoc(
  { marketName: 'X', arrivalDate: '31/01/2025' },
  { stateName: 'Maharashtra', commodityName: 'Onion' }
);
const negativeModal = rawToDoc(
  { marketName: 'X', arrivalDate: '31/01/2025', modalPricePerQuintal: -10 },
  { stateName: 'Maharashtra', commodityName: 'Onion' }
);
step(
  5,
  'rawToDoc maps a clean row and soft-flags recoverable rows',
  !goodDoc.flagged &&
    goodDoc.doc.pricePerQuintal === 1800 &&
    goodDoc.doc.pricePerKg === 18 &&
    goodDoc.doc.source === 'agmarknet' &&
    goodDoc.doc.cropName === 'Onion' &&
    goodDoc.doc.variety === 'Red' &&
    goodDoc.doc.isLive === false &&
    // Empty market → falls back to state, soft-flagged
    !softMarket.flagged &&
    softMarket.doc.market === 'Maharashtra' &&
    softMarket.doc._softFlag === 'missing_market_soft' &&
    softMarket.doc.pricePerQuintal === 1000 &&
    // Missing modal → persisted as null, soft-flagged
    !softModal.flagged &&
    softModal.doc.pricePerQuintal === null &&
    softModal.doc.pricePerKg === null &&
    softModal.doc._softFlag === 'missing_or_invalid_modal_price' &&
    // Negative modal is still hard-rejected (a price < 0 is never valid)
    negativeModal.flagged && negativeModal.reason === 'negative_modal_price'
);

// ----- check 6: normalizeAndUpsert idempotency (in-memory Mongo) -----
async function check6() {
  const { connectMongo, disconnectMongo } = require('../src/db/connect');
  const MarketPrice = require('../src/models/MarketPrice');
  const conn = await connectMongo({ uri: '' });
  try {
    const ix = await MarketPrice.syncIndexesSafe();
    if (!ix.ok) throw new Error('index sync: ' + ix.error);

    // Build a small batch of two distinct (market, date) records.
    const records = [
      {
        ...goodRaw,
        marketName: 'Lasalgaon',
        arrivalDate: '2025-01-15',
        modalPricePerQuintal: 2000,
        minPricePerQuintal: 1700,
        maxPricePerQuintal: 2300,
      },
      {
        ...goodRaw,
        marketName: 'Pimpalgaon',
        arrivalDate: '2025-01-15',
        modalPricePerQuintal: 1900,
        minPricePerQuintal: 1600,
        maxPricePerQuintal: 2200,
      },
      // A row with no `arrivalDate` — still a hard reject. (An empty
      // market is now a soft flag, not a hard reject.)
      {
        marketName: 'X',
        arrivalDate: '',
        modalPricePerQuintal: 1,
      },
    ];

    const first = await normalizeAndUpsert({
      stateName: 'Maharashtra',
      commodityName: 'Onion',
      records,
    });
    const totalAfterFirst = await MarketPrice.countDocuments({
      source: 'agmarknet',
      cropName: 'Onion',
      state: 'Maharashtra',
    });
    const second = await normalizeAndUpsert({
      stateName: 'Maharashtra',
      commodityName: 'Onion',
      records,
    });
    const totalAfterSecond = await MarketPrice.countDocuments({
      source: 'agmarknet',
      cropName: 'Onion',
      state: 'Maharashtra',
    });

    step(
      6,
      'normalizeAndUpsert: 1st run inserts 2, 2nd run is idempotent; 1 row hard-flagged (missing_arrivalDate)',
      first.inserted === 2 &&
        first.flagged.length === 1 &&
        first.flagged[0].reason === 'missing_arrivalDate' &&
        first.hardFlagReasons &&
        first.hardFlagReasons.missing_arrivalDate === 1 &&
        totalAfterFirst === 2 &&
        second.inserted === 0 &&
        totalAfterSecond === 2  // idempotent: no duplicate rows created
    );
  } finally {
    await disconnectMongo();
  }
}

(async () => {
  try {
    await check6();
  } catch (err) {
    FAIL += 1;
    failures.push(`6. normalizeAndUpsert idempotency — ${err.message}`);
    console.log(`[FAIL] 6. ${err.message}`);
  }
  console.log('');
  console.log(`=== ${PASS} passed, ${FAIL} failed ===`);
  if (FAIL > 0) {
    console.log('FAILURES:');
    failures.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
  process.exit(0);
})();
