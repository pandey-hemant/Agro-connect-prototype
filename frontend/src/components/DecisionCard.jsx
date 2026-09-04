/**
 * components/DecisionCard.jsx — the single source of truth for
 * "what should I do with this crop lot?".
 *
 * The previous app had decision support buried behind its own route
 * with a small table. That was technically complete but not
 * trustworthy. This card moves the same information into a
 * face-up component that:
 *
 *   - leads with the recommendation in plain language
 *   - shows the predicted net realization next to the expected
 *     price, so the farmer sees both the reference and the
 *     computation
 *   - exposes the rationale (the same text the backend returns)
 *     and the offer count / best offer line for traceability
 *   - labels the ML trend as a *projection*, not a forecast, and
 *     always pairs it with the data points used
 *   - never makes a SELL_NOW → WAIT flip based on the projection
 *     alone (the offer rule is authoritative on the server)
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useDispatch, useSelector } from 'react-redux'
import {
  fetchDecision,
  refreshDecision,
  clearDecision,
} from '../redux/slices/decisionSlice.js'
import { fmtInr, fmtInr2, fmtPerKg, fmtNumber, fmtDistanceLabel, NOT_AVAILABLE } from '../utils/format.js'

// ---- Visual tokens for the three recommendations. The palette
//      is taken from the design system; we only choose which side
//      of it the card leans into. -------------------------------
const REC = {
  SELL_NOW: {
    label: 'Sell now',
    tagline: 'A good offer is on the table. Take it.',
    tone: 'positive',
    pill: 'ac-chip-success',
    glyph: '↗',
  },
  WAIT: {
    label: 'Wait',
    tagline: 'No offer matches your expected price yet.',
    tone: 'warn',
    pill: 'ac-chip-honey',
    glyph: '◷',
  },
  GROUP_SALE: {
    label: 'Group sale',
    tagline: 'Pool with nearby farmers to negotiate better.',
    tone: 'primary',
    pill: 'ac-chip-primary',
    glyph: '⤬',
  },
}

const TREND = {
  up:   { label: 'Projected to rise', tone: 'text-success-600', chip: 'bg-success-100 text-success-600' },
  down: { label: 'Projected to fall', tone: 'text-rust-600',    chip: 'bg-rust-100 text-rust-600' },
  flat: { label: 'Projected flat',    tone: 'text-ink-500',     chip: 'bg-ink-100 text-ink-600' },
  unknown: { label: 'No projection',  tone: 'text-ink-500',     chip: 'bg-ink-100 text-ink-600' },
}

function StatusPill({ tone, children }) {
  const cls = {
    positive: 'ac-chip-success',
    warn:     'ac-chip-honey',
    primary:  'ac-chip-primary',
    negative: 'ac-chip-rust',
  }[tone] || 'ac-chip-earth'
  return <span className={`ac-chip ${cls}`}>{children}</span>
}

function MarketRow({ row, isBestNet }) {
  const km = fmtDistanceLabel(row)
  return (
    <tr className={isBestNet ? 'bg-success-50/60' : 'hover:bg-earth-50'}>
      <td className="px-3 py-2.5 text-sm">
        <div className="font-medium text-ink-900">{row.market}</div>
        <div className="text-xs text-ink-500">{row.location || row.state}</div>
      </td>
      <td className="px-3 py-2.5 text-right text-sm tabular-nums text-ink-700">
        {fmtInr2(row.modal_price)}/kg
      </td>
      <td className="px-3 py-2.5 text-right text-sm tabular-nums text-ink-700">
        {km.text}
        {km.hint && (
          <div className="text-[10px] uppercase tracking-wide text-ink-400">
            {row.is_routed ? 'Routed' : 'Est.'}
          </div>
        )}
      </td>
      <td className="px-3 py-2.5 text-right text-sm tabular-nums text-ink-700">
        {fmtInr(row.total_logistics_cost)}
      </td>
      <td className={`px-3 py-2.5 text-right text-sm font-semibold tabular-nums ${isBestNet ? 'text-success-600' : 'text-ink-900'}`}>
        {fmtInr(row.net_realisation)}
        {isBestNet && (
          <div className="text-[10px] uppercase tracking-wide text-success-500">
            Best net
          </div>
        )}
      </td>
    </tr>
  )
}

export default function DecisionCard({ cropLotId, compact = false }) {
  const dispatch = useDispatch()
  const { current, status, error } = useSelector((s) => s.decisions)
  const [refreshed, setRefreshed] = useState(false)

  useEffect(() => {
    if (!cropLotId) return
    dispatch(fetchDecision(cropLotId))
    return () => { dispatch(clearDecision()) }
  }, [dispatch, cropLotId])

  // The server is the source of truth for the recommendation; the
  // client only formats it. Any "available" gate is purely cosmetic.
  if (!cropLotId) return null

  if (status === 'loading' && !current) {
    return (
      <div className="ac-card p-5">
        <div className="ac-skeleton h-3 w-24" />
        <div className="ac-skeleton mt-3 h-7 w-2/3" />
        <div className="ac-skeleton mt-4 h-4 w-full" />
        <div className="ac-skeleton mt-2 h-4 w-5/6" />
      </div>
    )
  }

  if (status === 'failed' && !current) {
    return (
      <div className="ac-card border-rust-200 bg-rust-50 p-5">
        <p className="text-sm font-semibold text-rust-600">We couldn't load the decision</p>
        <p className="mt-1 text-sm text-rust-500">{error || 'Network error'}</p>
        <button
          onClick={() => dispatch(fetchDecision(cropLotId))}
          className="ac-btn-secondary mt-3"
        >
          Try again
        </button>
      </div>
    )
  }

  if (!current) return null

  const rec = REC[current.decision] || REC.WAIT
  const trend = TREND[current.prediction_trend || 'unknown']
  const trendAvailable = current.prediction_available
  const comparison = (current.market_comparison || []).slice().sort(
    (a, b) => (b.net_realisation ?? -Infinity) - (a.net_realisation ?? -Infinity),
  )
  const best = comparison[0]

  const onRefresh = async () => {
    setRefreshed(false)
    await dispatch(refreshDecision(cropLotId))
    setRefreshed(true)
  }

  return (
    <section
      aria-label="Decision support"
      className="ac-card overflow-hidden"
    >
      {/* HEADER — the recommendation, large and unmistakable. */}
      <div className="bg-gradient-to-br from-primary-50 via-white to-earth-50 px-5 py-6 sm:px-6 sm:py-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="ac-section-label">Decision support</p>
            <div className="mt-2 flex items-center gap-3">
              <span className={`flex h-11 w-11 items-center justify-center rounded-full text-2xl ${rec.pill.replace('ac-chip', 'bg-white')}`}>
                {rec.glyph}
              </span>
              <div>
                <h2 className="font-display text-3xl font-medium leading-none text-ink-900">
                  {rec.label}
                </h2>
                <p className="mt-1.5 text-sm text-ink-500">{rec.tagline}</p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <StatusPill tone={rec.tone}>{rec.label}</StatusPill>
              {current.offer_count > 0 && (
                <StatusPill tone="primary">
                  {current.offer_count} offer{current.offer_count === 1 ? '' : 's'}
                </StatusPill>
              )}
              {current.best_offer_price != null && (
                <StatusPill tone="primary">
                  Best ₹{fmtInr2(current.best_offer_price)}/kg
                </StatusPill>
              )}
              {current.insufficient_data && (
                <StatusPill tone="warn">Limited data</StatusPill>
              )}
            </div>
          </div>
          <button
            onClick={onRefresh}
            className="ac-btn-ghost"
            disabled={status === 'loading'}
            title="Recompute from latest market data"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <path d="M4 12a8 8 0 0 1 14-5.3" /><path d="M20 4v4h-4" />
              <path d="M20 12a8 8 0 0 1-14 5.3" /><path d="M4 20v-4h4" />
            </svg>
            {status === 'loading' ? 'Updating…' : 'Refresh'}
          </button>
        </div>

        {current.rationale && (
          <p className="mt-4 text-sm text-ink-600">{current.rationale}</p>
        )}
      </div>

      {/* PROJECTION — the ML annotation. Always labelled. */}
      {trendAvailable && (
        <div className="border-t border-earth-200 px-5 py-4 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="ac-section-label">7-day projection</p>
              <p className="mt-1 text-sm">
                <span className={`font-semibold ${trend.tone}`}>{trend.label}</span>
                <span className="ml-2 text-ink-500">
                  · {current.prediction_method || 'trend-based'} · for reference only
                </span>
              </p>
            </div>
            <span className={`ac-chip ${trend.chip}`}>
              Not a forecast
            </span>
          </div>
        </div>
      )}

      {/* BREAK-EVEN — explicit number for the WAIT panel. Lets the
          farmer see exactly what future price would have to clear
          for waiting to beat the current offer. Surfaces the
          assumptions (storage days, wastage, daily uplift) so the
          number is traceable, not a black box. */}
      {current.decision === 'WAIT' &&
        current.breakeven_future_price_per_kg != null && (
          <div className="border-t border-earth-200 bg-honey-50/50 px-5 py-4 sm:px-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <p className="ac-section-label">Break-even future price</p>
                <p className="mt-1 font-display text-2xl text-ink-900">
                  ₹
                  {fmtInr2(current.breakeven_future_price_per_kg)}
                  <span className="ml-1 text-sm text-ink-500">/kg</span>
                </p>
                <p className="mt-1 text-xs text-ink-600">
                  That's the price the market would have to clear{' '}
                  <em>after</em> accounting for storage cost, wastage,
                  and the time-value of your inventory — before waiting
                  beats the current offer.
                </p>
              </div>
              <span className="ac-chip ac-chip-honey">Estimate</span>
            </div>
            {current.breakeven_assumptions && (
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-ink-600 sm:grid-cols-4">
                {current.breakeven_assumptions.storage_days != null && (
                  <div>
                    <dt className="text-ink-400">Storage</dt>
                    <dd className="font-medium text-ink-800">
                      {current.breakeven_assumptions.storage_days} days
                    </dd>
                  </div>
                )}
                {current.breakeven_assumptions.wastage_pct != null && (
                  <div>
                    <dt className="text-ink-400">Wastage</dt>
                    <dd className="font-medium text-ink-800">
                      {Number(current.breakeven_assumptions.wastage_pct).toFixed(1)}%
                    </dd>
                  </div>
                )}
                {current.breakeven_assumptions.daily_uplift_pct != null && (
                  <div>
                    <dt className="text-ink-400">Daily uplift</dt>
                    <dd className="font-medium text-ink-800">
                      {Number(current.breakeven_assumptions.daily_uplift_pct).toFixed(2)}%
                    </dd>
                  </div>
                )}
                {current.breakeven_assumptions.best_offer_price_per_kg != null && (
                  <div>
                    <dt className="text-ink-400">Best offer</dt>
                    <dd className="font-medium text-ink-800">
                      ₹
                      {fmtInr2(
                        current.breakeven_assumptions.best_offer_price_per_kg
                      )}
                      /kg
                    </dd>
                  </div>
                )}
              </dl>
            )}
          </div>
        )}

      {/* MARKET COMPARISON — the table that says "where will I earn
          the most, after logistics?" The best row is highlighted,
          the distance column tells you whether it's a routed or
          estimated distance, and a single line at the top names the
          recommended market. */}
      {!compact && comparison.length > 0 && (
        <div className="border-t border-earth-200">
          <div className="flex items-end justify-between px-5 py-4 sm:px-6">
            <div>
              <p className="ac-section-label">Where you'd actually earn the most</p>
              {best && (
                <p className="mt-1 text-sm text-ink-700">
                  <span className="font-semibold">{best.market}</span>{' '}
                  <span className="text-ink-500">({best.location || best.state})</span>{' '}
                  would net you{' '}
                  <span className="font-semibold text-success-600">
                    ₹{fmtInr(best.net_realisation)}
                  </span>
                  .
                </p>
              )}
            </div>
            <Link
              to={`/market-prices/${encodeURIComponent(current.crop_name || '')}`}
              className="ac-btn-ghost"
            >
              See all prices →
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-earth-100 text-sm">
              <thead className="bg-earth-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-ink-400">Market</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-ink-400">Modal</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-ink-400">Distance</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-ink-400">Logistics</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-ink-400">Net</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-earth-100">
                {comparison.slice(0, 6).map((row, i) => (
                  <MarketRow key={`${row.market}-${i}`} row={row} isBestNet={i === 0} />
                ))}
              </tbody>
            </table>
          </div>
          {comparison.length > 6 && (
            <p className="px-5 py-2 text-xs text-ink-500 sm:px-6">
              Showing top 6 of {comparison.length} markets.
            </p>
          )}
        </div>
      )}
    </section>
  )
}
