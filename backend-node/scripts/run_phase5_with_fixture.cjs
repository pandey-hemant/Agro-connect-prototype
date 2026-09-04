/**
 * scripts/run_phase5_with_fixture.cjs — autonomous Phase 5 endpoint
 * verification that handles its own test fixture lifecycle.
 *
 * Flow:
 *   1. Wait for backend server (up to 60s).
 *   2. Connect to MongoDB, clean any stale fixtures.
 *   3. Seed a disposable test crop lot (Onion + Maharashtra).
 *   4. Spawn the standard Phase 5 endpoint verifier as a child process.
 *   5. Clean up the fixture regardless of verifier outcome.
 *   6. Exit with the verifier's exit code.
 *
 * This keeps the original verify_phase5_endpoints.cjs untouched while
 * providing a one-command "run the whole verification" experience.
 *
 * Usage:
 *   node scripts/run_phase5_with_fixture.cjs
 */
'use strict';

const path = require('path');
const { spawn } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const CropLot = require('../src/models/CropLot');
const FarmerDecision = require('../src/models/FarmerDecision');

const TEST_NOTES_PREFIX = 'PHASE5_VERIFIER_FIXTURE';

function request(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = require('http').request(
      {
        method: 'GET',
        hostname: u.hostname,
        port: u.port || 80,
        path: u.pathname,
        headers: { Accept: 'application/json' },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(res.statusCode));
      }
    );
    req.on('error', reject);
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForServer(maxMs = 60000) {
  const base = process.env.BASE_URL || 'http://localhost:5050/api';
  const healthUrl = base.replace(/\/api$/, '/api/health');
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const s = await request(healthUrl);
      if (s === 200 || s === 503) return;
    } catch (_) {}
    await sleep(1000);
  }
  throw new Error('server did not respond within ' + maxMs + 'ms');
}

async function cleanFixtures() {
  const lots = await CropLot.find({ notes: { $regex: `^${TEST_NOTES_PREFIX}` } });
  if (lots.length === 0) return 0;
  const lotIds = lots.map((l) => l._id);
  const publicIds = lots.map((l) => l.publicId);
  await FarmerDecision.deleteMany({ cropLotId: { $in: lotIds } });
  await FarmerDecision.deleteMany({ cropLotPublicId: { $in: publicIds } });
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

function runVerifier() {
  return new Promise((resolve) => {
    const verifierPath = path.join(__dirname, 'verify_phase5_endpoints.cjs');
    const child = spawn(process.execPath, [verifierPath], {
      stdio: 'inherit',
      env: process.env,
    });
    child.on('exit', (code) => resolve(code || 0));
  });
}

async function main() {
  console.log('[autonomous] Phase 5 endpoint verifier with disposable fixture');
  console.log('');

  // 1. Wait for server
  await waitForServer();
  console.log('[autonomous] server is up');
  console.log('');

  // 2. Connect to MongoDB
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/agroconnect';
  await mongoose.connect(uri);
  console.log(`[autonomous] connected to ${uri}`);

  // 3. Pre-clean
  const preCleaned = await cleanFixtures();
  if (preCleaned > 0) {
    console.log(`[autonomous] pre-cleaned ${preCleaned} stale fixture(s)`);
  }

  // 4. Seed
  const fixture = await seedFixture();
  console.log(`[autonomous] seeded test crop lot: publicId=${fixture.publicId}`);
  console.log('');

  let verifierCode = 1;
  try {
    // 5. Run verifier
    verifierCode = await runVerifier();
  } finally {
    // 6. Clean up
    const cleaned = await cleanFixtures();
    console.log('');
    console.log(`[autonomous] cleaned up ${cleaned} test fixture(s)`);
    await mongoose.disconnect();
  }

  process.exit(verifierCode);
}

main().catch((err) => {
  console.error('[autonomous] fatal:', err);
  process.exit(99);
});
