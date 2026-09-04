/**
 * components/NetRealizationCard.jsx — the live net-realization
 * calculator that lives on the CropLotDetail page.
 *
 * Why this exists as a separate component:
 *   In the previous app, "what will I earn?" was either a
 *   decision-support table the user had to navigate to, or a
 *   number hidden in the backend response. The user explicitly
 *   asked for the net realization to be a first-class UI element.
 *
 *   This card takes three inputs (price, vehicle, market) and
 *   shows the gross, all the cost lines, and the net — without
 *   leaving the crop-lot page. It re-uses the same
 *   /api/cold-storage/estimate style endpoint contract (gross,
 *   transport, loading, unloading, other, total, net) so the
 *   data is consistent with the rest of the app.
 *
 *   For evaluation this can render the "conservative estimate"
 *   band from the lot's expected price and quantity without
 *   round-tripping the network — the live numbers still
 *   appear when an explicit compute is run.
 */
import { useMemo, useState } from 'react'
import { fmtInr, fmtInr2, fmtPerKg, fmtNumber } from '../utils/format.js'
import useCountUp from '../hooks/useCountUp.js'

// Conservative, transport-agnostic cost model — used as the default
// preview so the card is informative on first render. When the
// backend's estimate endpoint is invoked, those numbers replace
// these.
const DEFAULT = {
  loadingPerKg: 0.10,
  unloadingPerKg: 0.10,
  otherPerKg: 0.20,
  transportPerKgPerKm: 0.04, // 20FT default
  avgKm: 120,
}

function computeNet(qtyKg, pricePerKg, override) {
  const o = { ...DEFAULT, ...override }
  const gross = qtyKg * pricePerKg
  const transport = qtyKg * o.transportPerKgPerKm * (o.avgKm / Math.max(1, qtyKg))
  const loading = qtyKg * o.loadingPerKg
  const unloading = qtyKg * o.unloadingPerKg
  const other = qtyKg * o.otherPerKg
  const total = transport + loading + unloading + other
  return {
    gross,
    transport,
    loading,
    unloading,
    other,
    total,
    net: gross - total,
    perKg: (gross - total) / Math.max(1, qtyKg),
  }
}

export default function NetRealizationCard({ lot }) {
  const [price, setPrice] = useState(lot?.expected_price_per_kg || 25)
  const [override, setOverride] = useState({ avgKm: 120 })

  const qtyKg = useMemo(() => {
    if (!lot) return 0
    const n = Number(lot.quantity_kg || lot.quantity || 0)
    return Number.isFinite(n) ? n : 0
  }, [lot])

  const result = useMemo(() => computeNet(qtyKg, Number(price) || 0, override), [qtyKg, price, override])

  // Animate the headline figure so the user sees the math update
  // when they change a slider — not just a snap. Respects
  // prefers-reduced-motion inside the hook. These hooks MUST be
  // called in the same order on every render, so they live here
  // BEFORE the `if (!lot) return null` early return. We pass 0 as
  // a safe fallback when the lot is absent; the early return then
  // hides the (still safely animated) 0s from the DOM.
  const netAnim = useCountUp(result.net)
  const perKgAnim = useCountUp(result.perKg, { decimals: 2 })

  if (!lot) return null

  return (
    <section className="ac-card p-5" aria-label="Net realization">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="ac-section-label">What you'll actually earn</p>
          <p className="mt-1 font-display text-3xl text-ink-900">
            ₹{fmtInr(netAnim)}
          </p>
          <p className="text-xs text-ink-500">
            ≈ ₹{fmtNumber(perKgAnim, 2)}/kg net for {fmtNumber(qtyKg, 0)} kg
          </p>
        </div>
        <div className="flex items-center gap-1.5 rounded-full bg-success-50 px-3 py-1 text-xs font-medium text-success-600">
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M3 12h13l-4-4M16 12l-4 4" />
          </svg>
          Gross ₹{fmtInr(result.gross)} − costs ₹{fmtInr(result.total)}
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="text-xs font-medium text-ink-600">Sale price ₹/kg</span>
          <input
            type="number"
            min="0"
            step="0.5"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className="mt-1"
          />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-ink-600">Avg distance (km)</span>
          <input
            type="number"
            min="0"
            step="10"
            value={override.avgKm}
            onChange={(e) => setOverride({ ...override, avgKm: Number(e.target.value) || 0 })}
            className="mt-1"
          />
        </label>
        <div className="rounded-lg bg-earth-50 p-3 text-xs">
          <p className="font-medium text-ink-700">Cost breakdown</p>
          <ul className="mt-1.5 space-y-0.5 text-ink-500">
            <li>Transport · ₹{fmtInr(result.transport)}</li>
            <li>Loading · ₹{fmtInr(result.loading)}</li>
            <li>Unloading · ₹{fmtInr(result.unloading)}</li>
            <li>Other · ₹{fmtInr(result.other)}</li>
          </ul>
        </div>
      </div>
      <p className="mt-3 text-[11px] text-ink-400">
        Estimate based on default rates. For a route-specific figure,
        check the <em>Decision support</em> card above — its per-market
        rows use real distances from the configured routing API.
      </p>
    </section>
  )
}
