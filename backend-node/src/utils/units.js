/**
 * utils/units.js — convert common Indian agricultural units to kg.
 *
 * Quintal is the most common wholesale unit in India. The data.gov.in
 * AGMARKNET feed returns prices in ₹/quintal.
 */
'use strict';

const UNIT_TO_KG = {
  kg: 1,
  quintal: 100,
  ton: 1000,
  tonne: 1000,
  t: 1000,
};

function toKg(value, unit) {
  if (value === null || value === undefined) return null;
  const u = String(unit || 'kg').toLowerCase();
  const factor = UNIT_TO_KG[u];
  if (!factor) return null;
  return Number(value) * factor;
}

module.exports = { UNIT_TO_KG, toKg };
