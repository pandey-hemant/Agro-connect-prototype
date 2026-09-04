/**
 * services/coldStorage.js — pure function: should the farmer sell now or
 * store then sell? Transparent, rule-based, no AI.
 *
 *   Inputs:
 *     quantity_kg              total lot quantity in kg
 *     days                     planned storage duration in days
 *     rate_per_kg_per_day      storage rate (INR/kg/day) — defaults to 0.20
 *     sell_now_price_per_kg    best current market offer / expected price
 *     store_then_sell_price_per_kg
 *                             price the farmer expects to get after storing
 *                             (default: sell_now_price + 5% for 30 days)
 *     wastage_pct              % loss during storage (default 0)
 *     logistics_per_kg         optional logistics cost per kg to deliver
 *                             after storage (default 0)
 *
 *   Outputs:
 *     sell_now_value           total INR if sold now
 *     store_then_sell_value    total INR if stored then sold
 *     storage_cost             daily_rate * days * quantity_kg
 *     wastage_value            sell_now_price * quantity_kg * wastage_pct/100
 *     net_store_then_sell      store_then_sell_value - storage_cost
 *                              - wastage_value - logistics cost
 *     delta_vs_sell_now        net_store_then_sell - sell_now_value
 *     breakeven_price_per_kg   the post-storage price that makes
 *                              store_then_sell == sell_now
 *     recommendation           'SELL_NOW' | 'STORE_THEN_SELL' | 'NEUTRAL'
 *     rationale                human-readable
 */
'use strict';

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function estimateColdStorage({
  quantity_kg,
  days,
  rate_per_kg_per_day = 0.20,
  sell_now_price_per_kg,
  store_then_sell_price_per_kg,
  wastage_pct = 0,
  logistics_per_kg = 0,
} = {}) {
  const qty = Number(quantity_kg || 0);
  const d = Math.max(0, Math.floor(Number(days || 0)));
  const rate = Math.max(0, Number(rate_per_kg_per_day || 0));
  const sellNow = Math.max(0, Number(sell_now_price_per_kg || 0));
  const wastage = Math.max(0, Math.min(100, Number(wastage_pct || 0))) / 100;
  const logCost = Math.max(0, Number(logistics_per_kg || 0));

  // Default the post-storage price when not provided: +5% baseline for
  // any positive storage, +0.1%/day beyond 7 days. Still a transparent
  // rule, not a forecast.
  let storePrice = Number(store_then_sell_price_per_kg || 0);
  if (!storePrice && sellNow > 0) {
    const baseUplift = 0.05;
    const extra = Math.max(0, (d - 7) * 0.001);
    storePrice = sellNow * (1 + baseUplift + extra);
  }

  const sellNowValue = sellNow * qty;
  const storageCost = rate * d * qty;
  const wastageValue = sellNow * qty * wastage;
  const logisticsCost = logCost * qty;
  const storeThenSellValue = storePrice * qty;
  const netStoreThenSell =
    storeThenSellValue - storageCost - wastageValue - logisticsCost;
  const delta = netStoreThenSell - sellNowValue;
  // Breakeven post-storage price per kg such that net == sellNow.
  // (storePrice * qty) - storageCost - wastageValue - logisticsCost = sellNow * qty
  // storePrice = sellNow + (storageCost + wastageValue + logisticsCost) / qty
  const breakeven = qty > 0
    ? sellNow + (storageCost + wastageValue + logisticsCost) / qty
    : 0;

  let recommendation = 'NEUTRAL';
  let rationale = '';
  if (qty <= 0 || d <= 0) {
    recommendation = 'SELL_NOW';
    rationale = 'Storage requires positive quantity and duration; no storage applies.';
  } else if (sellNow <= 0) {
    recommendation = 'NEUTRAL';
    rationale = 'No sell-now price to compare against; estimate is informational only.';
  } else if (delta >= sellNowValue * 0.02) {
    // 2% threshold before recommending storage.
    recommendation = 'STORE_THEN_SELL';
    rationale = `Storing for ${d} days and selling at ₹${round2(storePrice)}/kg nets ₹${round2(delta)} more than selling now.`;
  } else if (delta <= -sellNowValue * 0.02) {
    recommendation = 'SELL_NOW';
    rationale = `Storage cost ₹${round2(storageCost)} + wastage ₹${round2(wastageValue)} is greater than the post-storage uplift; sell now.`;
  } else {
    recommendation = 'NEUTRAL';
    rationale = `Sell-now vs store-then-sell are within ±2% (delta ₹${round2(delta)}); either is acceptable.`;
  }

  return {
    quantity_kg: qty,
    days: d,
    rate_per_kg_per_day: rate,
    sell_now_price_per_kg: sellNow,
    store_then_sell_price_per_kg: round2(storePrice),
    sell_now_value: round2(sellNowValue),
    store_then_sell_value: round2(storeThenSellValue),
    storage_cost: round2(storageCost),
    wastage_value: round2(wastageValue),
    logistics_cost: round2(logisticsCost),
    net_store_then_sell: round2(netStoreThenSell),
    delta_vs_sell_now: round2(delta),
    breakeven_price_per_kg: round2(breakeven),
    recommendation,
    rationale,
    is_estimate: true,
  };
}

module.exports = { estimateColdStorage };
