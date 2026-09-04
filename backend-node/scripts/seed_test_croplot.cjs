/**
 * scripts/seed_test_croplot.cjs — Phase 5 verifier test fixture.
 *
 * Creates a disposable test CropLot for verifying the /decisions
 * endpoint. The lot uses Onion + Maharashtra to match the
 * AGMARKNET validation dataset, so computeDecision() finds real
 * market prices and the ML prediction is available.
 *
 * Usage:
 *   node scripts/seed_test_croplot.cjs          # creates test lot
 *   node scripts/seed_test_croplot.cjs --clean  # removes test lots
 *
 * The seed marks created lots with a special notes prefix so they
 * can be identified and cleaned up.
 */
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const CropLot = require('../src/models/CropLot');
const FarmerDecision = require('../src/models/FarmerDecision');

const TEST_NOTES_PREFIX = 'PHASE5_VERIFIER_FIXTURE';

async function cleanTestLots() {
  const result = await CropLot.deleteMany({
    notes: { $regex: `^${TEST_NOTES_PREFIX}` },
  });
  // Also clean up any orphan decision docs
  const orphanDeletions = await FarmerDecision.deleteMany({
    cropLotPublicId: { $exists: false },
  });
  console.log(
    `[clean] removed ${result.deletedCount} test crop lots, ${orphanDeletions.deletedCount} orphan decisions`
  );
  return result.deletedCount;
}

async function seedTestLot() {
  // Use a unique publicId so multiple runs don't collide
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
  console.log(`[seed] created test lot publicId=${publicId} _id=${lot._id}`);
  return lot;
}

async function main() {
  const args = process.argv.slice(2);
  const isClean = args.includes('--clean');

  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/agroconnect';
  await mongoose.connect(uri);
  console.log(`[seed] connected to ${uri}`);

  if (isClean) {
    await cleanTestLots();
  } else {
    await cleanTestLots();
    await seedTestLot();
  }

  await mongoose.disconnect();
  console.log('[seed] done');
}

main().catch((err) => {
  console.error('[seed] error:', err);
  process.exit(1);
});
