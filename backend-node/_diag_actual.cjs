'use strict';
// _diag_actual.cjs — read what's actually persisted for the
// agmarknet source. Tells us whether the failure is a real
// "the wrong value was written" bug, or a "the wrong field name
// is being queried" bug.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const mongoose = require('mongoose');

(async () => {
  try {
    const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/agroconnect';
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
    const coll = mongoose.connection.db.collection('marketprices');

    const total = await coll.countDocuments({ source: 'agmarknet' });
    console.log('total agmarknet docs:', total);

    // Field the user keeps querying:
    const nullByName = await coll.countDocuments({ source: 'agmarknet', modalPricePerQuintal: null });
    const neByName   = await coll.countDocuments({ source: 'agmarknet', modalPricePerQuintal: { $ne: null } });
    console.log('modalPricePerQuintal: null   =', nullByName);
    console.log('modalPricePerQuintal: $ne null =', neByName);

    // The actual schema field:
    const nullBySchema = await coll.countDocuments({ source: 'agmarknet', pricePerQuintal: null });
    const neBySchema   = await coll.countDocuments({ source: 'agmarknet', pricePerQuintal: { $ne: null } });
    console.log('pricePerQuintal: null   =', nullBySchema);
    console.log('pricePerQuintal: $ne null =', neBySchema);

    const minkgNull = await coll.countDocuments({ source: 'agmarknet', minPricePerKg: null });
    const minkgSet  = await coll.countDocuments({ source: 'agmarknet', minPricePerKg: { $ne: null } });
    const maxkgNull = await coll.countDocuments({ source: 'agmarknet', maxPricePerKg: null });
    const maxkgSet  = await coll.countDocuments({ source: 'agmarknet', maxPricePerKg: { $ne: null } });
    console.log('minPricePerKg: null =', minkgNull, '  set =', minkgSet);
    console.log('maxPricePerKg: null =', maxkgNull, '  set =', maxkgSet);

    const arrivalsNull = await coll.countDocuments({ source: 'agmarknet', arrivals: null });
    const arrivalsSet  = await coll.countDocuments({ source: 'agmarknet', arrivals: { $ne: null } });
    console.log('arrivals: null =', arrivalsNull, '  set =', arrivalsSet);

    const totalArrNull = await coll.countDocuments({ source: 'agmarknet', totalArrivals: null });
    const totalArrSet  = await coll.countDocuments({ source: 'agmarknet', totalArrivals: { $ne: null } });
    console.log('totalArrivals: null =', totalArrNull, '  set =', totalArrSet);

    // A sample doc — show every persisted field + raw.modalPrice (the
    // value 1300 the user saw in raw).
    const sample = await coll.findOne({ source: 'agmarknet' });
    if (sample) {
      console.log('\n--- sample doc ---');
      console.log('  cropName=', sample.cropName);
      console.log('  state=', sample.state, ' market=', sample.market);
      console.log('  arrivalDate=', sample.arrivalDate, ' variety=', JSON.stringify(sample.variety));
      console.log('  pricePerQuintal=', sample.pricePerQuintal);
      console.log('  pricePerKg=', sample.pricePerKg);
      console.log('  minPricePerKg=', sample.minPricePerKg);
      console.log('  maxPricePerKg=', sample.maxPricePerKg);
      console.log('  arrivals=', sample.arrivals);
      console.log('  totalArrivals=', sample.totalArrivals);
      console.log('  modalPricePerQuintal (top-level)=', sample.modalPricePerQuintal);
      console.log('  raw keys=', sample.raw && Object.keys(sample.raw));
      console.log('  raw.modalPrice=', sample.raw && sample.raw.modalPrice);
      console.log('  rawOuter.total_arrivals=', sample.rawOuter && sample.rawOuter.total_arrivals);
      console.log('  rawOuter keys=', sample.rawOuter && Object.keys(sample.rawOuter));
    }
  } catch (e) {
    console.error('ERR', e && e.stack || e);
  } finally {
    await mongoose.disconnect();
  }
})();
