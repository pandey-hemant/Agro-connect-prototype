/**
 * PriceTrendChart.jsx — observed AGMARKNET price history.
 *
 * Renders a Recharts line chart of `price_per_kg` over time. Reads
 * from /api/market-prices/history/series (daily points).
 *
 * Trust rules:
 *   - This chart shows OBSERVED data only. ML/prediction lines are
 *     NOT rendered here; they live in a separate panel labelled
 *     "Forward projection · Not a forecast".
 *   - When fewer than 2 points are available, the chart degrades
 *     to a single value or a clear empty state.
 *   - Direction arrow (↑ up / ↓ down / → flat) is computed from
 *     the first vs. last point in the visible window.
 *   - `source` and `is_live` flags from the row are surfaced in
 *     the chart footer so the user can verify provenance.
 */
import { useEffect, useState } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts'
import api from '../api/axios.js'
import { fmtInr } from '../utils/format.js'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import useCountUp from '../hooks/useCountUp.js'
import { SkeletonLine } from './Skeleton.jsx'

function direction(points) {
  if (!points || points.length < 2) return 'flat'
  const first = Number(points[0].price_per_kg || 0)
  const last = Number(points[points.length - 1].price_per_kg || 0)
  if (!Number.isFinite(first) || !Number.isFinite(last) || first === 0) {
    return 'flat'
  }
  const delta = (last - first) / first
  if (delta > 0.02) return 'up'
  if (delta < -0.02) return 'down'
  return 'flat'
}

const DIR_META = {
  up: { Icon: TrendingUp, label: 'Trending up', tone: 'text-success-700' },
  down: { Icon: TrendingDown, label: 'Trending down', tone: 'text-rust-700' },
  flat: { Icon: Minus, label: 'Flat', tone: 'text-ink-600' },
}

function fmtDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-IN', {
    month: 'short',
    day: 'numeric',
  })
}

function CustomTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null
  const p = payload[0] && payload[0].payload
  if (!p) return null
  return (
    <div className="rounded-card border border-ink-200 bg-white p-2 text-xs shadow">
      <p className="font-medium text-ink-900">{fmtDate(p.date)}</p>
      <p className="text-ink-700">
        {p.market ? `${p.market} · ` : ''}
        {fmtInr(p.price_per_kg)}/kg
      </p>
      {p.source && (
        <p className="text-ink-500">Source · {p.source}</p>
      )}
    </div>
  )
}

export default function PriceTrendChart({
  crop,
  state,
  market,
  from,
  to,
  height = 220,
}) {
  const [points, setPoints] = useState([])
  const [status, setStatus] = useState('loading')
  const [err, setErr] = useState(null)
  const [source, setSource] = useState(null)
  const [isLive, setIsLive] = useState(false)

  useEffect(() => {
    if (!crop) return
    let cancelled = false
    setStatus('loading')
    setErr(null)
    const params = { crop }
    if (state) params.state = state
    if (market) params.market = market
    if (from) params.from = from
    if (to) params.to = to
    api
      .get('/market-prices/history/series', { params })
      .then((r) => {
        if (cancelled) return
        const list = (r.data?.points || []).filter(
          (p) => p && p.date && Number.isFinite(Number(p.price_per_kg))
        )
        setPoints(list)
        // pick provenance from the last point (most recent)
        if (list.length) {
          setSource(list[list.length - 1].source || null)
          setIsLive(list[list.length - 1].source === 'agmarknet' || list[list.length - 1].source === 'data_gov_in')
        }
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
  }, [crop, state, market, from, to])

  if (!crop) return null

  // Pre-compute safe numeric fallbacks for the animated values. The
  // hooks themselves MUST be called in the same order on every render,
  // so they live at the top of the function body, before any early
  // return. When data is missing we pass 0 (a finite, animation-safe
  // number) and simply don't render the animated headline.
  const dir = direction(points)
  const firstRaw = points[0]?.price_per_kg
  const lastRaw = points[points.length - 1]?.price_per_kg
  const firstP = Number(firstRaw)
  const lastP = Number(lastRaw)
  const change = firstP > 0 ? ((lastP - firstP) / firstP) * 100 : 0
  // Animate the % change so the headline doesn't snap.
  const changeAnim = useCountUp(change, { decimals: 1, duration: 500 })
  const lastPAnim = useCountUp(lastP, { decimals: 2, duration: 500 })

  if (status === 'loading') {
    return (
      <div
        className="rounded-card border border-ink-100 bg-white p-3"
        style={{ minHeight: height }}
        aria-label="Loading price history"
      >
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <SkeletonLine width="40%" height="h-4" />
          <SkeletonLine width="30%" height="h-3" />
        </div>
        <div className="space-y-2">
          <SkeletonLine width="100%" height="h-2" />
          <SkeletonLine width="85%" height="h-2" />
          <SkeletonLine width="60%" height="h-2" />
          <SkeletonLine width="75%" height="h-2" />
        </div>
      </div>
    )
  }
  if (status === 'failed') {
    return (
      <p className="rounded-card border border-rust-200 bg-rust-50 p-3 text-sm text-rust-700">
        Could not load price trend. {err}
      </p>
    )
  }
  if (status === 'succeeded' && points.length === 0) {
    return (
      <div className="rounded-card border border-ink-100 bg-earth-50 p-4 text-sm text-ink-600">
        No history points found for{' '}
        <strong className="text-ink-800">{crop}</strong>
        {state ? ` in ${state}` : ''}. Add more market-price records to see a trend.
      </div>
    )
  }

  // Hooks MUST be called in the same order on every render, so they
  // live at the top of the function (above the early returns above).
  // The dir/Icon/label/tone/first/last aliases below are pure
  // derivations — no hooks involved — and are safe to compute here.
  const { Icon, label, tone } = DIR_META[dir]
  const first = points[0]
  const last = points[points.length - 1]

  // Single-point case: render a card with the only known value
  if (points.length === 1) {
    return (
      <div className="rounded-card border border-ink-100 bg-earth-50 p-4">
        <p className="text-xs text-ink-500">
          Only 1 observed price point on record.
        </p>
        <p className="mt-1 font-display text-2xl text-ink-900">
          {fmtInr(first.price_per_kg)}/kg
        </p>
        <p className="text-xs text-ink-500">{fmtDate(first.date)}</p>
      </div>
    )
  }

  return (
    <div className="rounded-card border border-ink-100 bg-white p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon className={`h-4 w-4 ${tone}`} aria-hidden="true" />
          <span className={`text-sm font-semibold ${tone}`}>{label}</span>
          <span className="text-xs text-ink-500">
            {changeAnim > 0 ? '+' : ''}
            {changeAnim.toFixed(1)}% over {points.length} point
            {points.length === 1 ? '' : 's'}
          </span>
        </div>
        <div className="text-xs text-ink-500">
          {fmtInr(firstP)}/kg → {fmtInr(lastPAnim)}/kg
        </div>
      </div>
      <div style={{ width: '100%', height }}>
        <ResponsiveContainer>
          <LineChart
            data={points}
            margin={{ top: 10, right: 8, left: 0, bottom: 0 }}
          >
            <CartesianGrid stroke="#e5e0d3" strokeDasharray="3 3" />
            <XAxis
              dataKey="date"
              tickFormatter={fmtDate}
              tick={{ fontSize: 11, fill: '#6a6259' }}
              stroke="#cdc6b3"
            />
            <YAxis
              tick={{ fontSize: 11, fill: '#6a6259' }}
              stroke="#cdc6b3"
              domain={['auto', 'auto']}
              tickFormatter={(v) => `₹${v}`}
              width={56}
            />
            <Tooltip content={<CustomTooltip />} />
            <ReferenceLine
              y={firstP}
              stroke="#cdc6b3"
              strokeDasharray="4 4"
              label={{
                value: fmtInr(firstP),
                fontSize: 10,
                fill: '#6a6259',
                position: 'right',
              }}
            />
            <Line
              type="monotone"
              dataKey="price_per_kg"
              stroke="#1f6f43"
              strokeWidth={2}
              dot={{ r: 2, fill: '#1f6f43' }}
              activeDot={{ r: 4 }}
              isAnimationActive={true}
              animationDuration={500}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-1 text-xs text-ink-500">
        Observed prices only{isLive ? ' · Live AGMARKNET' : ' · Sample data'}. Source: {source || 'unknown'}.
        Forward projection is shown on the page below — never here.
      </p>
    </div>
  )
}
