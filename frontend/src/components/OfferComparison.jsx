/**
 * OfferComparison.jsx — automatic offer comparison by NET realization.
 *
 * For a given crop lot, this component ranks incoming buyer offers by
 * the metric the farmer actually keeps after the most visible costs
 * (transport to the buyer's closest mandi), not the quoted price.
 *
 * Trust rules:
 *   - We DO NOT invent transport costs. If a lot has no lat/lon or
 *     no mandis have lat/lon, the component falls back to a
 *     "price-only" view and clearly labels it as such.
 *   - The "best offer" badge goes to the highest net realization,
 *     not the highest price — the brief explicitly says NET wins.
 *   - If two offers tie on net realization, the earlier-issued offer
 *     is preferred (predictable tie-break).
 *   - All math is client-side; the server doesn't see or trust this
 *     ranking. The page still uses offer.status for lifecycle.
 */
import { useEffect, useMemo, useState } from 'react'
import api from '../api/axios.js'
import { fmtInr } from '../utils/format.js'
import { Award, AlertTriangle, Truck, ArrowRight } from 'lucide-react'
import { SkeletonList } from './Skeleton.jsx'

const FREIGHT_PER_KM_PER_KG = 0.012
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

function findNearestMandi(lot, mandis) {
  if (!lot || !Number.isFinite(lot.lat) || !Number.isFinite(lot.lon)) return null
  if (!mandis || !mandis.length) return null
  const origin = { lat: lot.lat, lon: lot.lon }
  let best = null
  for (const m of mandis) {
    if (!Number.isFinite(Number(m.lat)) || !Number.isFinite(Number(m.lon))) continue
    const d = haversineKm(origin, { lat: Number(m.lat), lon: Number(m.lon) })
    if (d == null) continue
    if (!best || d < best.distKm) {
      best = { ...m, distKm: d }
    }
  }
  return best
}

export default function OfferComparison({ lot, offers = [] }) {
  const [mandis, setMandis] = useState([])
  const [status, setStatus] = useState('loading')

  useEffect(() => {
    if (!lot) return
    let cancelled = false
    setStatus('loading')
    const params = { crop: lot.crop_name }
    if (lot.state) params.state = lot.state
    api
      .get('/market-prices', { params })
      .then((r) => {
        if (cancelled) return
        setMandis(r.data?.results || [])
        setStatus('succeeded')
      })
      .catch(() => {
        if (cancelled) return
        setMandis([])
        setStatus('failed')
      })
    return () => {
      cancelled = true
    }
  }, [lot])

  const nearest = useMemo(() => findNearestMandi(lot, mandis), [lot, mandis])

  const ranked = useMemo(() => {
    if (!Array.isArray(offers) || !offers.length) return []
    return offers
      .map((o, idx) => {
        const price = Number(o.price) || 0
        const qty = Number(o.quantity) || 0
        const dist = nearest ? nearest.distKm : null
        const transport = dist != null ? +(dist * FREIGHT_PER_KM_PER_KG).toFixed(2) : 0
        const net = +(price - transport).toFixed(2)
        return {
          ...o,
          _idx: idx,
          price,
          qty,
          transport,
          net,
          transportUnknown: dist == null,
        }
      })
      .sort((a, b) => {
        if (b.net !== a.net) return b.net - a.net
        // tie-break: earliest first
        const ta = new Date(a.createdAt || 0).getTime()
        const tb = new Date(b.createdAt || 0).getTime()
        return ta - tb
      })
  }, [offers, nearest])

  if (status === 'loading') {
    return (
      <div className="rounded-card border border-ink-100 bg-white p-4">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-display text-base text-ink-900">
            Offer comparison · ranked by net realization
          </h3>
          <span className="text-xs text-ink-400">Loading market distances…</span>
        </div>
        <SkeletonList count={Math.max(2, Math.min(4, offers.length || 3))} icon={Truck} />
      </div>
    )
  }

  if (!ranked.length) {
    return (
      <div className="rounded-card border border-ink-100 bg-earth-50 p-3 text-sm text-ink-600">
        No offers to compare yet.
      </div>
    )
  }

  const best = ranked[0]

  return (
    <div className="rounded-card border border-ink-100 bg-white p-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-display text-base text-ink-900">
          Offer comparison · ranked by net realization
        </h3>
        {nearest && (
          <span className="text-xs text-ink-500">
            <Truck className="mr-0.5 inline h-3 w-3" />
            Transport to nearest mandi ({nearest.market},{' '}
            {nearest.distKm.toFixed(1)} km): ₹
            {(nearest.distKm * FREIGHT_PER_KM_PER_KG).toFixed(2)}/kg
          </span>
        )}
        {!nearest && (
          <span className="text-xs text-honey-800">
            <AlertTriangle className="mr-0.5 inline h-3 w-3" />
            No nearest mandi available — comparing quoted price only.
          </span>
        )}
      </div>

      <ol className="space-y-2">
        {ranked.map((o, i) => {
          const isBest = i === 0
          return (
            <li
              key={o.public_id || o.id || o._idx}
              className={
                isBest
                  ? 'rounded-card border-2 border-success-300 bg-success-50 p-3'
                  : 'rounded-card border border-ink-100 bg-white p-3'
              }
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span
                    className={
                      isBest
                        ? 'inline-flex h-6 w-6 items-center justify-center rounded-full bg-success-600 text-xs font-bold text-white'
                        : 'inline-flex h-6 w-6 items-center justify-center rounded-full bg-ink-200 text-xs font-semibold text-ink-700'
                    }
                    aria-label={`Rank ${i + 1}`}
                  >
                    {i + 1}
                  </span>
                  <span className="text-sm font-medium text-ink-900">
                    {o.buyer_name || o.buyer?.name || `Buyer #${o._idx + 1}`}
                  </span>
                  {o.status && (
                    <span className="ac-chip ac-chip-ink">{o.status}</span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-3 text-right text-sm">
                  <span className="text-ink-700">
                    {fmtInr(o.price)}/kg × {o.quantity} {lot?.quantity_unit || ''}
                  </span>
                  {isBest && (
                    <span className="ac-chip ac-chip-success">
                      <Award className="mr-1 inline h-3 w-3" />
                      Best net realization
                    </span>
                  )}
                </div>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-ink-600">
                <span>
                  Transport{' '}
                  {o.transportUnknown ? (
                    <em className="text-honey-700">n/a</em>
                  ) : (
                    <strong className="text-ink-800">−₹{o.transport}/kg</strong>
                  )}
                </span>
                <ArrowRight className="h-3 w-3 text-ink-400" />
                <span>
                  Net{' '}
                  <strong
                    className={
                      isBest ? 'text-success-700' : 'text-ink-800'
                    }
                  >
                    {fmtInr(o.net)}/kg
                  </strong>
                </span>
                {o.message && (
                  <span className="ml-auto max-w-xs truncate italic text-ink-500">
                    “{o.message}”
                  </span>
                )}
              </div>
            </li>
          )
        })}
      </ol>
      <p className="mt-2 text-xs text-ink-500">
        Net = quoted price − estimated transport to nearest mandi
        (straight-line distance, ₹{FREIGHT_PER_KM_PER_KG}/kg/km).
        This is a planning view — final terms are set on the offer.
      </p>
    </div>
  )
}
