/**
 * utils/format.js — safe number / INR / km / kg formatters.
 *
 * The previous version of these call sites inlined `(value || 0).toFixed(2)`,
 * which surfaces as "NaN" the moment the API returns a missing field as
 * `null` or `undefined` and `(null).toFixed(2)` throws. These helpers
 * always render either a clean formatted number or a "Not available"
 * placeholder, never "NaN", "undefined", or "null".
 *
 * Every formatter returns a string. None of them throw.
 */

const NOT_AVAILABLE = 'Not available'

function isFiniteNumber(v) {
  if (v === null || v === undefined || v === '') return false
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n)
}

/**
 * Format a generic number with the given number of decimal places.
 * Falls back to "Not available" for null / undefined / NaN / non-finite
 * inputs. Negative values are kept (we explicitly want negative
 * logistics costs to be visible on the UI).
 */
export function fmtNumber(value, decimals = 0) {
  if (!isFiniteNumber(value)) return NOT_AVAILABLE
  const n = Number(value)
  return n.toFixed(decimals)
}

/**
 * Indian-locale INR formatter. Uses en-IN grouping (lakh/crore) so
 * 1,00,000 is shown as 1,00,000 and not 100,000. Returns "Not
 * available" for missing/NaN inputs.
 */
export function fmtInr(value) {
  if (!isFiniteNumber(value)) return NOT_AVAILABLE
  const n = Number(value)
  // Intl.NumberFormat is supported in every modern browser. Fall back
  // to a plain toLocaleString if it isn't.
  try {
    return n.toLocaleString('en-IN', {
      maximumFractionDigits: 0,
    })
  } catch {
    return String(Math.round(n))
  }
}

/**
 * INR with paise (2 decimal places). Same NaN handling.
 */
export function fmtInr2(value) {
  if (!isFiniteNumber(value)) return NOT_AVAILABLE
  const n = Number(value)
  try {
    return n.toLocaleString('en-IN', {
      maximumFractionDigits: 2,
      minimumFractionDigits: 2,
    })
  } catch {
    return n.toFixed(2)
  }
}

/**
 * "X km" formatter. Same NaN handling.
 */
export function fmtKm(value) {
  if (!isFiniteNumber(value)) return NOT_AVAILABLE
  const n = Number(value)
  if (n < 0) return NOT_AVAILABLE
  return `${n.toFixed(0)} km`
}

/**
 * "X kg" formatter. Same NaN handling.
 */
export function fmtKg(value) {
  if (!isFiniteNumber(value)) return NOT_AVAILABLE
  const n = Number(value)
  if (n < 0) return NOT_AVAILABLE
  return `${n.toFixed(0)} kg`
}

/**
 * "₹X.XX/kg" formatter. Same NaN handling.
 */
export function fmtPerKg(value) {
  if (!isFiniteNumber(value)) return NOT_AVAILABLE
  const n = Number(value)
  return `₹${n.toFixed(2)}/kg`
}

/**
 * Render a comparison row's distance label, attaching provenance
 * tags so the user knows whether they're looking at a routed
 * distance or an estimated one.
 *
 *   row = { distance_km, is_routed, origin_kind, destination_kind }
 *
 * Returns { text, hint } so the calling page can render a tooltip
 * or a sub-label.
 */
export function fmtDistanceLabel(row) {
  const km = row && row.distance_km
  if (!isFiniteNumber(km)) {
    return { text: NOT_AVAILABLE, hint: '' }
  }
  const n = Number(km)
  const text = `${n.toFixed(0)} km`
  if (row.is_routed) {
    return { text, hint: 'Routed distance' }
  }
  if (row.origin_kind === 'state') {
    return {
      text: `${text} (est.)`,
      hint: 'Estimated from state-centroid; actual road distance may differ.',
    }
  }
  if (row.origin_kind === 'district') {
    return {
      text: `${text} (est.)`,
      hint: 'Estimated from district-centroid.',
    }
  }
  if (row.origin_kind === 'latlon') {
    return { text, hint: 'Estimated (straight-line from your pin).' }
  }
  return { text, hint: 'Estimated.' }
}

export { NOT_AVAILABLE }
