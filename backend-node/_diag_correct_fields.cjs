'use strict';
// _diag_correct_fields.cjs — query the CORRECT schema field names
// to see whether data is actually persisted.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const mongoose = require('mongoose');

(async () => {
  try {
    const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/agroconnect';
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
    const coll = mongoose.connection.db.collection('marketprices');

    console.log('=== AGMARKNET DATA VERIFICATION ===\n');

    const total = await coll.countDocuments({ source: 'agmarknet' });
    console.log('Total AGMARKNET records:', total);

    // CORRECT field name from schema:
    const nullPrice = await coll.countDocuments({ source: 'agmarknet', pricePerQuintal: null });
    const setPrice  = await coll.countDocuments({ source: 'agmarknet', pricePerQuintal: { $ne: null } });
    console.log('\npricePerQuintal (CORRECT field):');
    console.log('  null:', nullPrice);
    console.log('  set: ', setPrice);

    const nullPriceKg = await coll.countDocuments({ source: 'agmarknet', pricePerKg: null });
    const setPriceKg  = await coll.countDocuments({ source: 'agmarknet', pricePerKg: { $ne: null } });
    console.log('\npricePerKg:');
    console.log('  null:', nullPriceKg);
    console.log('  set: ', setPriceKg);

    const nullMin = await coll.countDocuments({ source: 'agmarknet', minPricePerKg: null });
    const setMin  = await coll.countDocuments({ source: 'agmarknet', minPricePerKg: { $ne: null } });
    console.log('\nminPricePerKg:');
    console.log('  null:', nullMin);
    console.log('  set: ', setMin);

    const nullMax = await coll.countDocuments({ source: 'agmarknet', maxPricePerKg: null });
    const setMax  = await coll.countDocuments({ source: 'agmarknet', maxPricePerKg: { $ne: null } });
    console.log('\nmaxPricePerKg:');
    console.log('  null:', nullMax);
    console.log('  set: ', setMax);

    const nullArr = await coll.countDocuments({ source: 'agmarknet', arrivals: null });
    const setArr  = await coll.countDocuments({ source: 'agmarknet', arrivals: { $ne: null } });
    console.log('\narrivals:');
    console.log('  null:', nullArr);
    console.log('  set: ', setArr);

    // Sample 5 docs:
    console.log('\n=== SAMPLE DOCUMENTS ===\n');
    const samples = await coll.find({ source: 'agmarknet' }).limit(5).toArray();
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      console.log(`Doc ${i + 1}:`);
      console.log('  crop:', s.cropName, '| state:', s.state, '| market:', s.market);
      console.log('  arrivalDate:', s.arrivalDate, '| variety:', s.variety);
      console.log('  pricePerQuintal:', s.pricePerQuintal);
      console.log('  pricePerKg:', s.pricePerKg);
      console.log('  minPricePerKg:', s.minPricePerKg);
      console.log('  maxPricePerKg:', s.maxPricePerKg);
      console.log('  arrivals:', s.arrivals);
      console.log('  raw.modalPrice:', s.raw && s.raw.modalPrice);
      console.log('  raw.minimumPrice:', s.raw && s.raw.minimumPrice);
      console.log('  raw.maximumPrice:', s.raw && s.raw.maximumPrice);
      console.log('  raw.arrivals:', s.raw && s.raw.arrivals);
      console.log('');
    }

    console.log('=== CONCLUSION ===');
    if (setPrice === total && setPriceKg === total) {
      console.log('✓ All records have pricePerQuintal and pricePerKg set correctly.');
    } else {
      console.log('✗ Some records are missing pricePerQuintal or pricePerKg.');
    }

    if (setMin > 0 && setMax > 0) {
      console.log(`✓ Min/max prices are set on ${setMin}/${setMax} records.`);
    } else {
      console.log('✗ Min/max prices are all null — BUG CONFIRMED.');
    }

    if (setArr > 0) {
      console.log(`✓ Arrivals are set on ${setArr} records.`);
    } else {
      console.log('✗ Arrivals are all null — BUG CONFIRMED.');
    }

  } catch (e) {
    console.error('ERROR:', e.message);
    console.error(e.stack);
  } finally {
    await mongoose.disconnect();
  }
})();
