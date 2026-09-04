/**
 * mandiCoords — built-in, publicly-known mandi locations.
 *
 * Hard rule from the brief:
 *   "If an external API key is required and unavailable: do NOT
 *    invent live coordinates or pretend that live routing is
 *    functioning."
 *
 * So this table is the OPPOSITE of invented live data — every entry
 * here is a well-known, publicly-citable mandi (name, state, city)
 * and a coordinate that approximates the city centre. These are
 * NOT driving directions, NOT real-time GPS, and NOT geocoded
 * against a live API. They are reference centroids so the
 * "where to sell" feature has SOMETHING to draw when no geocoding
 * key is configured. The UI labels every pin "straight-line
 * distance, not driving distance" and every transport cost is
 * labelled "estimated".
 *
 * If the GEOAPIFY_API_KEY is configured, the live service should
 * be used in preference; this file is a deterministic fallback.
 */

const MANDI_COORDS = [
  { market: 'Patna Mandi', state: 'Bihar', city: 'Patna', lat: 25.5941, lon: 85.1376 },
  { market: 'Boring Road Mandi', state: 'Bihar', city: 'Patna', lat: 25.6093, lon: 85.1036 },
  { market: 'Azadpur Mandi', state: 'Delhi', city: 'Delhi', lat: 28.7107, lon: 77.1763 },
  { market: 'Ghazipur Mandi', state: 'Delhi', city: 'Delhi', lat: 28.6219, lon: 77.3201 },
  { market: 'Vashi APMC', state: 'Maharashtra', city: 'Navi Mumbai', lat: 19.0760, lon: 73.0006 },
  { market: 'Lasalgaon APMC', state: 'Maharashtra', city: 'Nashik', lat: 20.1410, lon: 74.2369 },
  { market: 'Nashik APMC', state: 'Maharashtra', city: 'Nashik', lat: 19.9975, lon: 73.7898 },
  { market: 'Pune APMC', state: 'Maharashtra', city: 'Pune', lat: 18.5204, lon: 73.8567 },
  { market: 'Kolar APMC', state: 'Karnataka', city: 'Kolar', lat: 13.1373, lon: 78.1299 },
  { market: 'Bangalore APMC', state: 'Karnataka', city: 'Bangalore', lat: 12.9716, lon: 77.5946 },
  { market: 'Mysore APMC', state: 'Karnataka', city: 'Mysore', lat: 12.2958, lon: 76.6394 },
  { market: 'Davangere APMC', state: 'Karnataka', city: 'Davangere', lat: 14.4644, lon: 75.9218 },
  { market: 'Davangere', state: 'Karnataka', city: 'Davangere', lat: 14.4644, lon: 75.9218 },
  { market: 'Koyambedu Market', state: 'Tamil Nadu', city: 'Chennai', lat: 13.0694, lon: 80.1948 },
  { market: 'Madurai Market', state: 'Tamil Nadu', city: 'Madurai', lat: 9.9252, lon: 78.1198 },
  { market: 'Howrah Market', state: 'West Bengal', city: 'Howrah', lat: 22.5958, lon: 88.2636 },
  { market: 'Sealdah Market', state: 'West Bengal', city: 'Kolkata', lat: 22.5726, lon: 88.3639 },
  { market: 'Indore APMC', state: 'Madhya Pradesh', city: 'Indore', lat: 22.7196, lon: 75.8577 },
  { market: 'Bhopal APMC', state: 'Madhya Pradesh', city: 'Bhopal', lat: 23.2599, lon: 77.4126 },
  { market: 'Jaipur Mandi', state: 'Rajasthan', city: 'Jaipur', lat: 26.9124, lon: 75.7873 },
  { market: 'Jodhpur Mandi', state: 'Rajasthan', city: 'Jodhpur', lat: 26.2389, lon: 73.0243 },
  { market: 'Lucknow Mandi', state: 'Uttar Pradesh', city: 'Lucknow', lat: 26.8467, lon: 80.9462 },
  { market: 'Varanasi Mandi', state: 'Uttar Pradesh', city: 'Varanasi', lat: 25.3176, lon: 82.9739 },
  { market: 'Kanpur Mandi', state: 'Uttar Pradesh', city: 'Kanpur', lat: 26.4499, lon: 80.3319 },
  { market: 'Amritsar Mandi', state: 'Punjab', city: 'Amritsar', lat: 31.6340, lon: 74.8723 },
  { market: 'Ludhiana Mandi', state: 'Punjab', city: 'Ludhiana', lat: 30.9010, lon: 75.8573 },
  { market: 'Karnal Mandi', state: 'Haryana', city: 'Karnal', lat: 29.6857, lon: 76.9905 },
  { market: 'Karnal', state: 'Haryana', city: 'Karnal', lat: 29.6857, lon: 76.9905 },
  { market: 'Guntur', state: 'Andhra Pradesh', city: 'Guntur', lat: 16.3067, lon: 80.4365 },
  { market: 'Guntur APMC', state: 'Andhra Pradesh', city: 'Guntur', lat: 16.3067, lon: 80.4365 },
  { market: 'Ahmedabad APMC', state: 'Gujarat', city: 'Ahmedabad', lat: 23.0225, lon: 72.5714 },
  { market: 'Surat APMC', state: 'Gujarat', city: 'Surat', lat: 21.1702, lon: 72.8311 },
  { market: 'Rajkot APMC', state: 'Gujarat', city: 'Rajkot', lat: 22.3039, lon: 70.8022 },
  { market: 'Kochi Market', state: 'Kerala', city: 'Kochi', lat: 9.9312, lon: 76.2673 },
  { market: 'Trivandrum Market', state: 'Kerala', city: 'Thiruvananthapuram', lat: 8.5241, lon: 76.9366 },
  { market: 'Bhubaneswar Mandi', state: 'Odisha', city: 'Bhubaneswar', lat: 20.2961, lon: 85.8245 },
  { market: 'Cuttack Mandi', state: 'Odisha', city: 'Cuttack', lat: 20.4625, lon: 85.8830 },
  { market: 'Guwahati Mandi', state: 'Assam', city: 'Guwahati', lat: 26.1445, lon: 91.7362 },
  { market: 'Ranchi Mandi', state: 'Jharkhand', city: 'Ranchi', lat: 23.3441, lon: 85.3096 },
  { market: 'Raipur Mandi', state: 'Chhattisgarh', city: 'Raipur', lat: 21.2514, lon: 81.6296 },
]

/**
 * Look up coords for a (market, state) pair, or by city name.
 * Returns null if not found. The first match wins.
 *
 * We are deliberately tolerant on names: "Bengaluru APMC" matches
 * "Bangalore APMC", "Koyambedu Market" matches "Chennai", etc. The
 * match is two-tier:
 *   1. Exact market name + state.
 *   2. City/landmark substring against a small alias table.
 * Anything we can't resolve confidently is left null — the UI says
 * "not enough location data" rather than guessing.
 */
const CITY_ALIAS = {
  bengaluru: 'Bangalore',
  bangalore: 'Bangalore',
  bombay: 'Mumbai',
  mumbai: 'Mumbai',
  calcutta: 'Kolkata',
  kolkata: 'Kolkata',
  trivandrum: 'Thiruvananthapuram',
  thiruvananthapuram: 'Thiruvananthapuram',
  bombay: 'Mumbai',
  new_delhi: 'Delhi',
  delhi: 'Delhi',
}

function lookup({ market, state, city }) {
  const norm = (s) => (s || '').toString().trim().toLowerCase()
  const m = norm(market).replace(/\s+/g, ' ').replace(/[^\w ]/g, '')
  const s = norm(state)
  const rawCity = norm(city)
  // Aliases are mixed-case ("Bangalore"); normalise so the comparison
  // against norm(row.city) in tier 2 actually matches.
  const c = norm(CITY_ALIAS[rawCity] || rawCity)

  // 1) Exact market + state
  const exact = MANDI_COORDS.find(
    (row) =>
      norm(row.market).replace(/[^\w ]/g, '') === m &&
      (!s || norm(row.state) === s)
  )
  if (exact) return exact

  // 2) Market contains city (handles "Bengaluru APMC" → Bangalore)
  if (c) {
    const cityHit = MANDI_COORDS.find(
      (row) =>
        norm(row.city) === c && (!s || norm(row.state) === s)
    )
    if (cityHit) return cityHit
  }

  // 3) Market contains known landmark substring
  if (m) {
    const landmark = MANDI_COORDS.find((row) =>
      norm(row.market).includes(m) || m.includes(norm(row.market))
    )
    if (landmark) return landmark
  }
  return null
}

/**
 * Annotate a list of price rows with lat/lon if a mandi centroid is
 * known. Rows that don't have a known centroid get null lat/lon (so
 * the map will simply not draw them, and the UI will say "not
 * enough location data for X mandis").
 */
function annotate(rows) {
  if (!Array.isArray(rows)) return rows
  return rows.map((r) => {
    const latN = Number(r.lat)
    const lonN = Number(r.lon)
    if (
      Number.isFinite(latN) &&
      Number.isFinite(lonN) &&
      latN !== 0 &&
      lonN !== 0
    ) {
      return r // already has coords
    }
    const hit = lookup({
      market: r.market,
      state: r.state,
      city: r.city || r.district,
    })
    if (hit) {
      return Object.assign({}, r, {
        lat: hit.lat,
        lon: hit.lon,
        _coord_source: 'mandi_centroid',
      })
    }
    return r
  })
}

module.exports = { MANDI_COORDS, lookup, annotate }
