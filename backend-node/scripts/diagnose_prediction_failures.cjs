#!/usr/bin/env node
/**
 * Diagnose prediction-ml endpoint failures.
 * Tests with:
 * 1. Tomato (used by verifier)
 * 2. Onion + Maharashtra (real AGMARKNET data)
 */
'use strict';

const http = require('http');

const BASE = process.env.BASE_URL || 'http://localhost:5050/api';

function request(method, urlPath) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + urlPath);
    const opts = {
      method,
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname + url.search,
      headers: { Accept: 'application/json' },
    };
    const req = http.request(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch (_) { json = { _raw: text }; }
        resolve({ status: res.statusCode, body: json });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  console.log('=== Diagnosing /market-prices/prediction-ml endpoint ===\n');

  // Test 1: Tomato (what the verifier uses)
  console.log('Test 1: Tomato (verifier test case)');
  console.log('--------------------------------------');
  try {
    const r1 = await request('GET', '/market-prices/prediction-ml?crop=Tomato&days=7');
    console.log(`Status: ${r1.status}`);
    console.log(`Available: ${r1.body?.available}`);
    console.log(`Method: ${r1.body?.method}`);
    console.log(`Chosen: ${r1.body?.method || 'null'}`);
    console.log(`Candidates: ${r1.body?.candidates?.length || 0}`);
    console.log(`Distinct dates: ${r1.body?.distinct_dates || 0}`);
    console.log(`Min history required: ${r1.body?.min_history_dates_required || 'N/A'}`);
    console.log(`Source used: ${r1.body?.source_used || 'N/A'}`);
    console.log(`Message: ${r1.body?.message || 'N/A'}`);
    console.log('');
  } catch (err) {
    console.error('Error:', err.message);
  }

  // Test 2: Onion + Maharashtra (real AGMARKNET data)
  console.log('Test 2: Onion + Maharashtra (real AGMARKNET data)');
  console.log('---------------------------------------------------');
  try {
    const r2 = await request('GET', '/market-prices/prediction-ml?crop=Onion&state=Maharashtra&days=7');
    console.log(`Status: ${r2.status}`);
    console.log(`Available: ${r2.body?.available}`);
    console.log(`Method: ${r2.body?.method}`);
    console.log(`Chosen: ${r2.body?.method || 'null'}`);
    console.log(`Candidates: ${r2.body?.candidates?.length || 0}`);
    console.log(`Distinct dates: ${r2.body?.distinct_dates || 0}`);
    console.log(`Min history required: ${r2.body?.min_history_dates_required || 'N/A'}`);
    console.log(`Source used: ${r2.body?.source_used || 'N/A'}`);
    console.log(`Confidence: ${r2.body?.confidence || 'N/A'}`);
    console.log(`Trend: ${r2.body?.trend_direction || 'N/A'}`);
    console.log(`Current price: ${r2.body?.current_price || 'N/A'}`);
    console.log(`Historical min: ${r2.body?.historical_min || 'N/A'}`);
    console.log(`Historical max: ${r2.body?.historical_max || 'N/A'}`);

    if (r2.body?.available && r2.body?.projection?.length > 0) {
      const first = r2.body.projection[0];
      console.log(`\nFirst projection (Day 1):`);
      console.log(`  Date: ${first.date}`);
      console.log(`  Chosen point: ₹${first.chosen_point}/kg`);
      console.log(`  Range: ₹${first.low} - ₹${first.high}/kg`);
    }

    console.log(`Message: ${r2.body?.message || 'N/A'}`);
    console.log('');
  } catch (err) {
    console.error('Error:', err.message);
  }

  // Test 3: Check crop lots endpoint for failure #2
  console.log('Test 3: Crop lots (for decisions endpoint)');
  console.log('------------------------------------------');
  try {
    const r3 = await request('GET', '/crop-lots?limit=1');
    console.log(`Status: ${r3.status}`);

    const lots = r3.body?.results || r3.body;
    if (Array.isArray(lots) && lots.length > 0) {
      console.log(`Found ${lots.length} crop lot(s)`);
      console.log(`First lot ID: ${lots[0].publicId || lots[0]._id}`);
      console.log(`Crop: ${lots[0].cropName}`);
      console.log(`State: ${lots[0].state}`);
    } else {
      console.log('No crop lots found');
    }
    console.log('');
  } catch (err) {
    console.error('Error:', err.message);
  }

  console.log('=== Diagnosis complete ===');
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
