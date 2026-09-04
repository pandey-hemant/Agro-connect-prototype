/**
 * scripts/run_phase5_verifier_with_fixture.cjs — autonomous Phase 5
 * endpoint verification with disposable test fixture.
 *
 * This wraps the standard Phase 5 endpoint verifier with:
 *   1. Pre-check that the backend is up (waits up to 60s).
 *   2. Seed a disposable test crop lot (Onion + Maharashtra so the
 *      /decisions endpoint exercises the real AGMARKNET + ML path).
 *   3. Run the standard Phase 5 endpoint verifier.
 *   4. Clean up the test lot after the verifier completes.
 *
 * Usage:
 *   node scripts/run_phase5_verifier_with_fixture.cjs
 *
 * Exit codes:
 *   0  — all checks passed
 *   1  — at least one check failed
 *  99  — fatal error (server didn't start, etc.)
 */
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const CropLot = require('../src/models/CropLot');
const FarmerDecision = require('../src/models/FarmerDecision');

const BASE = process.env.BASE_URL || 'http://localhost:5050/api';
const TEST_NOTES_PREFIX = 'PHASE5_VERIFIER_FIXTURE';

function request(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + urlPath);
    const data = body ? Buffer.from(JSON.stringify(body), 'utf-8') : null;
    const opts = {
      method,
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname + url.search,
      headers: {
        Accept: 'application/json',
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}),
      },
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
    if (data) req.write(data);
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForServer(maxMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const r = await request('GET', '/health');
      if (r.status === 200 || r.status === 503) return r;
    } catch (_) {}
    await sleep(1000);
  }
  throw new Error('server did not respond within ' + maxMs + 'ms');
}

async function cleanFixtures() {
  // Find test lots
  const lots = await CropLot.find({ notes: { $regex: `^${TEST_NOTES_PREFIX}` } });
  if (lots.length === 0) return 0;
  const lotIds = lots.map((l) => l._id);
  const publicIds = lots.map((l) => l.publicId);
  // Clean decisions
  await FarmerDecision.deleteMany({ cropLotId: { $in: lotIds } });
  await FarmerDecision.deleteMany({ cropLotPublicId: { $in: publicIds } });
  // Clean lots
  const r = await CropLot.deleteMany({ _id: { $in: lotIds } });
  return r.deletedCount;
}

async function seedFixture() {
  const publicId = `CL-TEST-${Date.now()}`;
  const lot = new CropLot({
    publicId,
    cropName: 'Onion',
    cropVariety: 'Red',
    quantity: 1000,
    quantityUnit: 'kg',
    harvestDate: '2026-08-15',
    location: 'Nashik, Maharashtra',
    lat: 19.9975,
    lon: 73.7898,
    state: 'Maharashtra',
    farmerQualityGrade: 'A',
    expectedPricePerKg: 20,
    minimumAcceptablePrice: 15,
    status: 'ACTIVE',
    sellerUserPublicId: 'USR-TEST-FARMER',
    notes: `${TEST_NOTES_PREFIX}: disposable lot for Phase 5 endpoint verifier`,
  });
  await lot.save();
  return lot;
}

async function main() {
  console.log('[autonomous] Phase 5 endpoint verifier with test fixture');
  console.log('');

  // 1. Wait for server
  await waitForServer();
  console.log('[autonomous] server is up at ' + BASE);
  console.log('');

  // 2. Connect to MongoDB and seed fixture
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/agroconnect';
  await mongoose.connect(uri);
  console.log(`[autonomous] connected to ${uri}`);

  // Clean any pre-existing fixtures first
  const preCleaned = await cleanFixtures();
  if (preCleaned > 0) {
    console.log(`[autonomous] pre-cleaned ${preCleaned} stale fixture(s)`);
  }

  // Seed fresh fixture
  const fixtureLot = await seedFixture();
  console.log(`[autonomous] seeded test crop lot: publicId=${fixtureLot.publicId}`);
  console.log('');

  try {
    // 3. Run the actual Phase 5 endpoint verifier
    const verifierPath = path.join(__dirname, 'verify_phase5_endpoints.cjs');
    delete require.cache[require.resolve(verifierPath)];
    require(verifierPath);
  } catch (err) {
    // The verifier calls process.exit(0/1) on completion; if we
    // get here something went wrong.
    console.error('[autonomous] verifier threw:', err);
  }

  // 4. Clean up fixture
  await sleep(1000); // give verifier time to finish
  const cleaned = await cleanFixtures();
  console.log(`[autonomous] cleaned up ${cleaned} test fixture(s)`);

  await mongoose.disconnect();
}

// Patch process.exit to delay cleanup
const _origExit = process.exit;
process.exit = function (code) {
  // Run cleanup before exiting
  (async () => {
    try {
      if (mongoose.connection.readyState === 1) {
        const r = await CropLot.deleteMany({
          notes: { $regex: `^${TEST_NOTES_PREFIX}` },
        });
        if (r.deletedCount > 0) {
          console.log(`[autonomous] emergency cleanup: removed ${r.deletedCount} fixture(s)`);
        }
        await mongoose.disconnect();
      }
    } catch (_) {}
    _origExit(code);
  })();
};

main().catch((err) => {
  console.error('[autonomous] fatal:', err);
  process.exit(99);
});
