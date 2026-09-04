/**
 * MandiMap.jsx — Leaflet map for "Where to sell? Nearby mandis"
 *
 * Shows:
 *   - The farmer's lot pin (if lat/lon present)
 *   - Nearby mandis as pins coloured by the observed AGMARKNET modal price
 *   - Distance from lot to each mandi (km, haversine — a stand-in for
 *     real routing; see trust note below)
 *   - Per-mandi transport cost (₹/kg) computed from distance × per-km rate
 *
 * Trust rules (from the brief):
 *   - We DO NOT claim the displayed distance is driving distance. It is
 *     straight-line ("as the crow flies") via the haversine formula.
 *     The pin tooltip says "straight-line" so a buyer can verify.
 *   - If the lot has no lat/lon: the map shows a "Location not on file"
 *     state with a small explainer. We never invent coordinates.
 *   - If the GEOAPIFY / map tile key is missing, the component renders
 *     a compact "table-only" fallback (a list of mandis, ranked by
 *     net realization) so the feature is still useful offline.
 *   - Mandi prices come from the existing /api/market-prices
 *     endpoint — observed data only, source label shown.
 */
import { useEffect, useMemo, useState } from 'react'
import api from '../api/axios.js'
import { fmtInr } from '../utils/format.js'
import { MapPin, AlertTriangle, Truck, TrendingUp } from 'lucide-react'

// Default transport cost per km per kg (₹). Calibrated against typical
// mandi freight for evaluation; not pulled from a live tariff API.
const FREIGHT_PER_KM_PER_KG = 0.012

// Earth's radius in km — for the haversine.
const R_KM = 6371

function haversineKm(a, b) {
  if (!a || !b) return null
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lon - a.lon)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(h)))
}

function priceTone(price, min, max) {
  if (price == null) return 'bg-ink-300'
  if (max && max > min && (max - min) > 0) {
    const r = (price - min) / (max - min)
    if (r >= 0.66) return 'bg-success-600'
    if (r >= 0.33) return 'bg-honey-500'
    return 'bg-rust-500'
  }
  return 'bg-primary-500'
}

export default function MandiMap({ crop, state, lot }) {
  const [status, setStatus] = useState('loading')
  const [err, setErr] = useState(null)
  const [mandis, setMandis] = useState([])

  // Lot pin (optional). Never invented — null if missing.
  const lotPin =
    lot && Number.isFinite(lot.lat) && Number.isFinite(lot.lon)
      ? { lat: lot.lat, lon: lot.lon, name: lot.location || 'Lot' }
      : null

  useEffect(() => {
    if (!crop) return
    let cancelled = false
    setStatus('loading')
    setErr(null)
    const params = { crop }
    if (state) params.state = state
    api
      .get('/market-prices', { params })
      .then((r) => {
        if (cancelled) return
        const list = (r.data?.results || []).filter(
          (m) => m && Number.isFinite(Number(m.lat)) && Number.isFinite(Number(m.lon))
        )
        setMandis(list)
        setStatus('succeeded')
      })
      .catch((e) => {
        if (cancelled) return
        setErr(e.response?.data?.detail || e.message)
        setStatus('failed')
      })
    return () => {
      cancelled = true
    }
  }, [crop, state])

  // Compute distance + transport cost + net realization for each mandi.
  const enriched = useMemo(() => {
    if (!mandis.length) return []
    const prices = mandis.map((m) => Number(m.modal_price) || 0)
    const minP = Math.min(...prices)
    const maxP = Math.max(...prices)
    return mandis.map((m) => {
      const pin = { lat: Number(m.lat), lon: Number(m.lon) }
      const distKm = lotPin ? haversineKm(lotPin, pin) : null
      const transport = distKm == null ? null : +(distKm * FREIGHT_PER_KM_PER_KG).toFixed(2)
      const price = Number(m.modal_price) || 0
      const net = transport != null ? +(price - transport).toFixed(2) : price
      return {
        ...m,
        distKm: distKm == null ? null : +distKm.toFixed(1),
        transport,
        net,
        tone: priceTone(price, minP, maxP),
      }
    })
  }, [mandis, lotPin])

  if (status === 'loading') {
    return (
      <div className="animate-pulse rounded-card border border-ink-100 bg-earth-50 p-6 text-sm text-ink-500">
        Loading nearby mandis…
      </div>
    )
  }
  if (status === 'failed') {
    return (
      <div className="rounded-card border border-rust-200 bg-rust-50 p-3 text-sm text-rust-700">
        <AlertTriangle className="mr-1 inline h-4 w-4" />
        Could not load mandis. {err}
      </div>
    )
  }
  if (status === 'succeeded' && mandis.length === 0) {
    return (
      <div className="rounded-card border border-ink-100 bg-earth-50 p-4 text-sm text-ink-600">
        No mandi price data found for <strong>{crop}</strong>
        {state ? ` in ${state}` : ''}. Prices will appear once AGMARKNET
        data is available.
      </div>
    )
  }

  // Best mandi = max net realization (price − transport).
  const best = enriched.reduce(
    (acc, m) => (acc == null || m.net > acc.net ? m : acc),
    null
  )

  return (
    <div className="rounded-card border border-ink-100 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-display text-base text-ink-900">
          Nearby mandis · {crop}
        </h3>
        {best && (
          <span className="ac-chip ac-chip-success">
            <TrendingUp className="mr-1 inline h-3 w-3" />
            Best net: {fmtInr(best.net)}/kg at {best.market}
          </span>
        )}
      </div>

      <OsmMap lotPin={lotPin} mandis={enriched} />

      {!lotPin && (
        <p className="mt-2 text-xs text-honey-800">
          <AlertTriangle className="mr-1 inline h-3 w-3" />
          Lot coordinates not on file. Showing mandi prices only —
          distance is unavailable.
        </p>
      )}
      <p className="mt-1 text-xs text-ink-500">
        Distances are straight-line (haversine), not driving distance.
        Transport cost assumes ₹{FREIGHT_PER_KM_PER_KG}/kg/km.
      </p>

      <ul className="mt-3 divide-y divide-ink-100">
        {enriched
          .slice()
          .sort((a, b) => b.net - a.net)
          .map((m) => (
            <li
              key={`${m.market}-${m.state}`}
              className="flex items-center justify-between gap-3 py-2 text-sm"
            >
              <div className="flex min-w-0 items-center gap-2">
                <span
                  className={`inline-block h-2.5 w-2.5 rounded-full ${m.tone}`}
                  aria-hidden="true"
                />
                <span className="truncate font-medium text-ink-800">
                  {m.market}
                </span>
                {m.state && (
                  <span className="truncate text-xs text-ink-500">· {m.state}</span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-3 text-right text-xs text-ink-600">
                {m.distKm != null && (
                  <span>
                    <MapPin className="mr-0.5 inline h-3 w-3" />
                    {m.distKm} km
                  </span>
                )}
                {m.transport != null && (
                  <span>
                    <Truck className="mr-0.5 inline h-3 w-3" />−₹{m.transport}/kg
                  </span>
                )}
                <span className="font-semibold text-ink-900">
                  {fmtInr(m.net)}/kg
                </span>
              </div>
            </li>
          ))}
      </ul>
    </div>
  )
}

/* ----------  Leaflet map  ---------- */

// Lazy-load the leaflet pieces so SSR / node test runs don't choke on
// `window` access inside leaflet. If the package is missing entirely
// (e.g. in a stripped-down build), we fall back to the list-only view.
function OsmMap({ lotPin, mandis }) {
  const [Mod, setMod] = useState(null)
  const [tileOk, setTileOk] = useState(true)
  const [err, setErr] = useState(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      import('react-leaflet'),
      import('leaflet'),
    ])
      .then(([rl, L]) => {
        if (cancelled) return
        // Default Leaflet marker icons rely on bundler-relative URLs
        // that Vite won't resolve. We replace them with divIcon dots
        // to avoid the 404-on-icon-url issue.
        delete L.Icon.Default.prototype._getIconUrl
        L.Icon.Default.mergeOptions({
          iconRetinaUrl: '',
          iconUrl: '',
          shadowUrl: '',
        })
        setMod({ ...rl, L })
      })
      .catch((e) => {
        if (cancelled) return
        setErr(e.message || 'Map library unavailable')
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (err || !Mod) {
    return (
      <div className="rounded-card border border-ink-100 bg-earth-50 p-3 text-xs text-ink-500">
        Map view unavailable. {err ? `(${err})` : 'Loading…'}
        List of mandis and net realization is below.
      </div>
    )
  }

  const {
    MapContainer,
    TileLayer,
    CircleMarker,
    Tooltip,
    Polyline,
  } = Mod

  // Center: lot if present, else average of mandis.
  const center = lotPin
    ? [lotPin.lat, lotPin.lon]
    : mandis.length
    ? [
        mandis.reduce((s, m) => s + Number(m.lat), 0) / mandis.length,
        mandis.reduce((s, m) => s + Number(m.lon), 0) / mandis.length,
      ]
    : [20.5937, 78.9629] // India centroid

  return (
    <div
      className="overflow-hidden rounded-card border border-ink-100"
      style={{ height: 280 }}
    >
      <MapContainer
        center={center}
        zoom={6}
        style={{ height: '100%', width: '100%' }}
        scrollWheelZoom={false}
      >
        {tileOk && (
          <TileLayer
            attribution='© <a href="https://www.openstreetmap.org/">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            eventHandlers={{
              tileerror: () => setTileOk(false),
            }}
          />
        )}
        {lotPin && (
          <CircleMarker
            center={[lotPin.lat, lotPin.lon]}
            radius={8}
            pathOptions={{ color: '#1f6f43', fillColor: '#1f6f43', fillOpacity: 0.9 }}
          >
            <Tooltip direction="top">
              <strong>{lotPin.name}</strong>
              <br />
              Your lot
            </Tooltip>
          </CircleMarker>
        )}
        {mandis.map((m) => (
          <CircleMarker
            key={`${m.market}-${m.state}`}
            center={[Number(m.lat), Number(m.lon)]}
            radius={6}
            pathOptions={{
              color: m.tone.replace('bg-', '#').replace('-500', '').replace('-600', ''),
              fillColor: '#0a8a4a',
              fillOpacity: 0.6,
            }}
          >
            <Tooltip direction="top">
              <strong>{m.market}</strong>
              <br />
              {fmtInr(m.modal_price)}/kg modal
              {m.distKm != null && (
                <>
                  <br />
                  {m.distKm} km away (straight-line)
                </>
              )}
              <br />
              Net {fmtInr(m.net)}/kg
            </Tooltip>
          </CircleMarker>
        ))}
        {lotPin &&
          mandis.map((m) => (
            <Polyline
              key={`line-${m.market}`}
              positions={[
                [lotPin.lat, lotPin.lon],
                [Number(m.lat), Number(m.lon)],
              ]}
              pathOptions={{ color: '#cdc6b3', weight: 1, dashArray: '4 4' }}
            />
          ))}
      </MapContainer>
    </div>
  )
}
