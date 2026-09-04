/**
 * services/seedDemo.js — idempotent demo data seeding.
 *
 * Used on startup (if RUN_SEED_ON_STARTUP=true and DB is empty) and
 * also exposed via the /api/buyers/seed-demo, /api/fpos/seed-demo
 * endpoints so the UI can populate a fresh DB on demand.
 *
 * Idempotency: every seeder checks the count first; if rows already
 * exist, it returns { inserted: 0, skipped: N } and never duplicates.
 */
'use strict';

const Buyer = require('../models/Buyer');
const FPO = require('../models/FPO');
const CropLot = require('../models/CropLot');
const MarketPrice = require('../models/MarketPrice');
const User = require('../models/User');
const { BuyerId } = require('../utils/publicId');
const { UserId } = require('../utils/randomUserId');

const DEMO_BUYERS = [
  {
    name: 'FreshHarvest Traders',
    location: 'Patna',
    state: 'Bihar',
    contact: '+91 9876543210',
    requirements: [
      { cropName: 'Tomato', minQuantityKg: 200, maxPricePerKg: 18, preferredStates: ['Bihar'] },
      { cropName: 'Onion', minQuantityKg: 300, maxPricePerKg: 22, preferredStates: ['Bihar', 'Maharashtra'] },
    ],
  },
  {
    name: 'SpiceRoute Mandi',
    location: 'Indore',
    state: 'Madhya Pradesh',
    contact: '+91 9876501234',
    requirements: [
      { cropName: 'Chilli', minQuantityKg: 100, maxPricePerKg: 200, preferredStates: ['Madhya Pradesh', 'Telangana'] },
      { cropName: 'Cotton', minQuantityKg: 500, maxPricePerKg: 60, preferredStates: ['Gujarat', 'Maharashtra'] },
    ],
  },
  {
    name: 'Punjab Agro Co-op',
    location: 'Amritsar',
    state: 'Punjab',
    contact: '+91 9988776655',
    requirements: [
      { cropName: 'Wheat', minQuantityKg: 1000, maxPricePerKg: 30, preferredStates: ['Punjab', 'Haryana'] },
      { cropName: 'Rice', minQuantityKg: 1000, maxPricePerKg: 35, preferredStates: ['Punjab'] },
    ],
  },
  {
    name: 'Karnal Aggregator',
    location: 'Karnal',
    state: 'Haryana',
    contact: '+91 9876512345',
    requirements: [
      { cropName: 'Maize', minQuantityKg: 500, maxPricePerKg: 25, preferredStates: ['Haryana', 'Punjab'] },
      { cropName: 'Soybean', minQuantityKg: 300, maxPricePerKg: 50, preferredStates: ['Madhya Pradesh'] },
    ],
  },
  {
    name: 'Karnataka Co-op',
    location: 'Bengaluru',
    state: 'Karnataka',
    contact: '+91 9123456789',
    requirements: [
      { cropName: 'Tomato', minQuantityKg: 500, maxPricePerKg: 20, preferredStates: ['Karnataka'] },
      { cropName: 'Groundnut', minQuantityKg: 200, maxPricePerKg: 70, preferredStates: ['Karnataka', 'Gujarat'] },
    ],
  },
  {
    name: 'Gujarat Cotton Mills',
    location: 'Ahmedabad',
    state: 'Gujarat',
    contact: '+91 9090909090',
    requirements: [
      { cropName: 'Cotton', minQuantityKg: 1000, maxPricePerKg: 65, preferredStates: ['Gujarat'] },
      { cropName: 'Groundnut', minQuantityKg: 500, maxPricePerKg: 75, preferredStates: ['Gujarat'] },
    ],
  },
];

const DEMO_FPOS = [
  { name: 'Patna Kisan FPO', location: 'Patna', district: 'Patna', state: 'Bihar', contact: '+91 9000000001' },
  { name: 'Nalanda Organic FPO', location: 'Nalanda', district: 'Nalanda', state: 'Bihar', contact: '+91 9000000002' },
];

/**
 * Demo accounts surfaced on the Login page. These are *prototype*
 * accounts, not real auth — passwords are stored in plain text in
 * MongoDB. The login page banner makes that clear.
 *
 * The role determines the default landing page after login:
 *   - SELLER  → /farmer   (FarmerDashboard)
 *   - BUYER   → /buyer    (BuyerDashboard)
 *   - FPO     → /fpos     (FPO list; FPO member view)
 */
const DEMO_USERS = [
  {
    email: 'farmer@agroconnect.demo',
    password: 'farmer123',
    role: 'SELLER',
    displayName: 'Demo Farmer',
  },
  {
    email: 'buyer@agroconnect.demo',
    password: 'buyer123',
    role: 'BUYER',
    displayName: 'Demo Buyer',
  },
  {
    email: 'fpofarmer@agroconnect.demo',
    password: 'farmer123',
    role: 'FPO',
    displayName: 'Demo FPO Farmer',
  },
];

const DEMO_MARKET_PRICES = [
  // INR/quintal (1 quintal = 100kg). demo provider.
  { cropName: 'Tomato', market: 'Patna Mandi', state: 'Bihar', district: 'Patna', pricePerQuintal: 1700, pricePerKg: 17, source: 'demo' },
  { cropName: 'Tomato', market: 'Bengaluru APMC', state: 'Karnataka', district: 'Bengaluru', pricePerQuintal: 1500, pricePerKg: 15, source: 'demo' },
  { cropName: 'Onion', market: 'Nashik APMC', state: 'Maharashtra', district: 'Nashik', pricePerQuintal: 2200, pricePerKg: 22, source: 'demo' },
  { cropName: 'Onion', market: 'Lasalgaon', state: 'Maharashtra', district: 'Nashik', pricePerQuintal: 2400, pricePerKg: 24, source: 'demo' },
  { cropName: 'Potato', market: 'Agra Mandi', state: 'Uttar Pradesh', district: 'Agra', pricePerQuintal: 1200, pricePerKg: 12, source: 'demo' },
  { cropName: 'Wheat', market: 'Amritsar Mandi', state: 'Punjab', district: 'Amritsar', pricePerQuintal: 2800, pricePerKg: 28, source: 'demo' },
  { cropName: 'Rice', market: 'Karnal Mandi', state: 'Haryana', district: 'Karnal', pricePerQuintal: 3500, pricePerKg: 35, source: 'demo' },
  { cropName: 'Maize', market: 'Davangere', state: 'Karnataka', district: 'Davangere', pricePerQuintal: 2300, pricePerKg: 23, source: 'demo' },
  { cropName: 'Soybean', market: 'Indore Mandi', state: 'Madhya Pradesh', district: 'Indore', pricePerQuintal: 4800, pricePerKg: 48, source: 'demo' },
  { cropName: 'Cotton', market: 'Rajkot', state: 'Gujarat', district: 'Rajkot', pricePerQuintal: 6500, pricePerKg: 65, source: 'demo' },
  { cropName: 'Groundnut', market: 'Junagadh', state: 'Gujarat', district: 'Junagadh', pricePerQuintal: 7200, pricePerKg: 72, source: 'demo' },
  { cropName: 'Chilli', market: 'Guntur', state: 'Andhra Pradesh', district: 'Guntur', pricePerQuintal: 18000, pricePerKg: 180, source: 'demo' },
];

async function seedDemoBuyers() {
  const existing = await Buyer.countDocuments({});
  if (existing > 0) {
    return { inserted: 0, skipped: existing, total: existing };
  }
  const created = [];
  for (const d of DEMO_BUYERS) {
    const b = await Buyer.create({
      publicId: BuyerId(),
      name: d.name,
      location: d.location,
      state: d.state,
      contact: d.contact,
      isDemo: true,
      requirements: d.requirements,
    });
    created.push(b.toRead());
  }
  return { inserted: created.length, skipped: 0, total: created.length, results: created };
}

async function seedDemoFPOs() {
  const existing = await FPO.countDocuments({});
  if (existing > 0) {
    return { inserted: 0, skipped: existing, total: existing };
  }
  const created = [];
  for (const d of DEMO_FPOS) {
    const f = await FPO.create({
      publicId: require('../utils/publicId').FPOId(),
      name: d.name,
      location: d.location,
      district: d.district,
      state: d.state,
      contact: d.contact,
      isDemo: true,
    });
    created.push(f.toRead());
  }
  return { inserted: created.length, skipped: 0, total: created.length, results: created };
}

async function seedDemoMarketPrices() {
  const existing = await MarketPrice.countDocuments({ source: 'demo' });
  if (existing > 0) {
    return { inserted: 0, skipped: existing, total: existing };
  }
  const created = await MarketPrice.insertMany(
    DEMO_MARKET_PRICES.map((d) => ({
      cropName: d.cropName,
      market: d.market,
      state: d.state,
      district: d.district,
      pricePerQuintal: d.pricePerQuintal,
      pricePerKg: d.pricePerKg,
      // Phase 3 — every demo row gets a priceDate so the
      // history/prediction aggregators have something to chew on.
      priceDate: '2026-08-29',
      arrivalDate: '2026-08-29',
      unit: 'INR/quintal',
      price_unit: 'INR/quintal',
      variety: '',
      grade: '',
      arrivals: null,
      source: 'demo',
      isLive: false,
    }))
  );
  return { inserted: created.length, skipped: 0, total: created.length };
}

async function seedDemoUsers() {
  // Idempotent on email: if a user with the demo email already exists,
  // we don't insert a duplicate. We DO upsert the role/displayName so
  // re-seeding after a model change is safe, and migrate the plain
  // `password` field to a proper `passwordHash` for new installs.
  const created = [];
  const updated = [];
  for (const d of DEMO_USERS) {
    const existing = await User.findOne({ email: d.email });
    if (existing) {
      let dirty = false;
      if (existing.role !== d.role) { existing.role = d.role; dirty = true; }
      if (existing.displayName !== d.displayName) {
        existing.displayName = d.displayName; dirty = true;
      }
      if (!existing.isDemo) { existing.isDemo = true; dirty = true; }
      // If the existing user has no bcrypt hash yet (e.g. upgraded
      // from a pre-bcrypt install), set one from the demo password.
      if (!existing.passwordHash && !existing.password) {
        await existing.setPassword(d.password);
        dirty = true;
      }
      if (dirty) { await existing.save(); updated.push(existing.toRead()); }
      continue;
    }
    const u = new User({
      publicId: UserId(),
      role: d.role,
      displayName: d.displayName,
      email: d.email,
      isDemo: true,
    });
    await u.setPassword(d.password);
    await u.save();
    created.push(u.toRead());
  }
  const total = await User.countDocuments({});
  return { inserted: created.length, updated: updated.length, total };
}

async function seedAllIfEmpty() {
  const buyerRes = await seedDemoBuyers();
  const fpoRes = await seedDemoFPOs();
  const priceRes = await seedDemoMarketPrices();
  const userRes = await seedDemoUsers();
  return { buyers: buyerRes, fpos: fpoRes, market_prices: priceRes, users: userRes };
}

module.exports = {
  seedDemoBuyers,
  seedDemoFPOs,
  seedDemoMarketPrices,
  seedDemoUsers,
  seedAllIfEmpty,
  DEMO_BUYERS,
  DEMO_FPOS,
  DEMO_MARKET_PRICES,
  DEMO_USERS,
};
