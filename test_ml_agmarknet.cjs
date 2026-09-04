#!/usr/bin/env node
'use strict';

const mongoose = require('mongoose');
require('dotenv').config();

async function testPredictions() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/agroconnect');
    console.log('Connected to MongoDB\n');

    const MarketPrice = require('./src/models/MarketPrice');
    const { predictPriceML } = require('./src/services/marketPrice/mlPrediction');

    // Test cases: Onion+Maharashtra, Onion+Karnataka, Potato+Maharashtra
    const testCases = [
      { crop: 'Onion', state: 'Maharashtra' },
      { crop: 'Onion', state: 'Karnataka' },
      { crop: 'Potato', state: 'Maharashtra' },
    ];

    for (const test of testCases) {
      console.log(`\n=== Testing ${test.crop} + ${test.state} ===`);

      // First check data availability
      const count = await MarketPrice.countDocuments({
        source: 'agmarknet',
        cropName: new RegExp(`^${test.crop}$`, 'i'),
        state: new RegExp(`^${test.state}$`, 'i')
      });
      const distinctDates = await MarketPrice.aggregate([
        {
          $match: {
            source: 'agmarknet',
            cropName: new RegExp(`^${test.crop}$`, 'i'),
            state: new RegExp(`^${test.state}$`, 'i')
          }
        },
        { $group: { _id: '$arrivalDate' } },
        { $count: 'distinctDates' }
      ]);

      console.log(`Records: ${count}`);
      console.log(`Distinct dates: ${distinctDates[0]?.distinctDates || 0}`);

      // Run ML prediction
      const result = await predictPriceML({
        crop: test.crop,
        state: test.state,
        days: 7,
        minHistoryDates: 10,
        holdoutDays: 14
      });

      console.log(`Available: ${result.available}`);
      console.log(`Source used: ${result.source_used}`);
      console.log(`Confidence: ${result.confidence}`);
      console.log(`Trend direction: ${result.trend_direction}`);

      if (result.available) {
        console.log(`Current price: ₹${result.current_price}/kg`);
        console.log(`Historical range: ₹${result.historical_min} - ₹${result.historical_max}/kg`);
        console.log(`Method: ${result.method}`);
        console.log(`Distinct dates: ${result.distinct_dates}`);

        if (result.projection && result.projection.length > 0) {
          const firstProj = result.projection[0];
          console.log(`7-day forecast start: ₹${firstProj.chosen_point}/kg (range: ₹${firstProj.low} - ₹${firstProj.high})`);
        }
      } else {
        console.log(`Message: ${result.message}`);
      }
    }

    await mongoose.disconnect();
    console.log('\n=== Test complete ===');

  } catch (error) {
    console.error('Test error:', error);
    process.exit(1);
  }
}

testPredictions();