/**
 * MarketPrices.jsx — mandi price viewer.
 *
 * Shows AGMARKNET (via data.gov.in) modal/min/max prices for a crop,
 * with a historical aggregation panel (always labelled "NOT a
 * forecast") and a forward-projection panel. Same data as before;
 * the chrome is the redesigned application shell.
 *
 * Trust signals are surfaced explicitly:
 *   - "Live · AGMARKNET" vs "Demo data" badges
 *   - Source citation under every table
 *   - Trend badge (up/down/flat) on the history roll-up
 *   - "Insufficient data" with a reason, never silent
 */
import { useEffect, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import {
  fetchMarketPrices,
  fetchMarketPriceHistory,
  fetchMarketPricePrediction,
  resetFilters,
  setFilter,
} from '../redux/slices/marketPriceSlice.js'
import { fmtInr, fmtNumber } from '../utils/format.js'
import PageHeader from '../components/PageHeader.jsx'
import EmptyState from '../components/EmptyState.jsx'
import PriceTrendChart from '../components/PriceTrendChart.jsx'
import MandiMap from '../components/MandiMap.jsx'
import usePageMeta from '../hooks/usePageMeta.js'

const inr = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
})

function formatDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-IN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function formatTimestamp(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('en-IN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function LiveBadge({ isLive, source }) {
  if (isLive) {
    return (
      <span className="ac-chip ac-chip-success">
        <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-success-500" />
        Live · {source || 'AGMARKNET'}
      </span>
    )
  }
  return (
    <span className="ac-chip ac-chip-honey">
      <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-honey-500" />
      Sample data · {source || 'built-in'}
    </span>
  )
}

function TrendBadge({ trend }) {
  const styles = {
    up: 'bg-success-100 text-success-700',
    down: 'bg-rust-100 text-rust-800',
    flat: 'bg-ink-100 text-ink-700',
  }
  const label =
    trend === 'up' ? '↑ up' : trend === 'down' ? '↓ down' : '→ flat'
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
        styles[trend] || styles.flat
      }`}
    >
      {label}
    </span>
  )
}

function formatPct(v) {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return '—'
  const n = Number(v)
  const sign = n > 0 ? '+' : ''
  return `${sign}${n.toFixed(1)}%`
}

const INPUT =
  'w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500'

function MarketPrices({ initialCrop = '' }) {
  const dispatch = useDispatch()
  usePageMeta({
    title: 'Market prices',
    description: 'Live AGMARKNET modal/min/max prices for crops, with historical context. NOT a forecast.',
  })
  const {
    list,
    listStatus,
    listError,
    history,
    historyStatus,
    prediction,
    predictionStatus,
  } = useSelector((state) => state.marketPrices)

  const [draft, setDraft] = useState({
    crop: initialCrop,
    location: '',
    market: '',
    state: '',
  })
  const [granularity, setGranularity] = useState('weekly')

  useEffect(() => {
    setDraft((d) => ({ ...d, crop: d.crop || initialCrop }))
  }, [initialCrop])

  const runSearch = (override) => {
    const next = { ...draft, ...(override || {}) }
    const cleaned = {
      crop: next.crop.trim(),
      location: next.location.trim(),
      market: next.market.trim(),
      state: next.state.trim(),
    }
    Object.entries(cleaned).forEach(([key, value]) =>
      dispatch(setFilter({ key, value })),
    )
    dispatch(fetchMarketPrices(cleaned))
    dispatch(
      fetchMarketPriceHistory({ ...cleaned, granularity })
    )
    dispatch(
      fetchMarketPricePrediction({
        crop: cleaned.crop,
        state: cleaned.state,
        market: cleaned.market,
      })
    )
  }

  useEffect(() => {
    if (initialCrop) {
      runSearch({ crop: initialCrop })
    } else {
      runSearch()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleClear = () => {
    setDraft({ crop: '', location: '', market: '', state: '' })
    dispatch(resetFilters())
    dispatch(fetchMarketPrices({}))
    dispatch(fetchMarketPriceHistory({ granularity }))
    dispatch(fetchMarketPricePrediction({}))
  }

  return (
    <>
      <PageHeader
        eyebrow="Market intelligence"
        title="Market prices"
        description="Daily mandi prices from AGMARKNET, via data.gov.in. If the live feed is unavailable, built-in DEMO prices keep the rest of the workflow usable."
        actions={
          list && (
            <LiveBadge isLive={list.is_live} source={list.source} />
          )
        }
      />

      {/* Filter form */}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          runSearch()
        }}
        className="ac-card mb-6 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        <div>
          <label className="mb-1 block text-xs font-medium text-ink-700">
            Crop / commodity
          </label>
          <input
            type="text"
            value={draft.crop}
            onChange={(e) => setDraft({ ...draft, crop: e.target.value })}
            placeholder="e.g. tomato"
            className={INPUT}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-ink-700">
            State
          </label>
          <input
            type="text"
            value={draft.state}
            onChange={(e) => setDraft({ ...draft, state: e.target.value })}
            placeholder="e.g. Punjab"
            className={INPUT}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-ink-700">
            Market / mandi
          </label>
          <input
            type="text"
            value={draft.market}
            onChange={(e) => setDraft({ ...draft, market: e.target.value })}
            placeholder="e.g. Azadpur"
            className={INPUT}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-ink-700">
            District / location
          </label>
          <input
            type="text"
            value={draft.location}
            onChange={(e) => setDraft({ ...draft, location: e.target.value })}
            placeholder="e.g. Nashik"
            className={INPUT}
          />
        </div>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-4">
          <button type="submit" className="ac-btn-primary">
            Search
          </button>
          <button type="button" onClick={handleClear} className="ac-btn-ghost">
            Clear
          </button>
          {list && (
            <span className="text-xs text-ink-500">
              {list.count} record{list.count === 1 ? '' : 's'} · fetched{' '}
              {formatTimestamp(list.fetched_at)}
            </span>
          )}
        </div>
      </form>

      {list && list.is_live === false && (
        <div className="mb-4 rounded-card border border-honey-200 bg-honey-50 p-4 text-sm text-honey-900">
          <p className="font-medium">Sample data — live provider unavailable</p>
          <p className="mt-1 text-honey-800">
            Showing built-in reference prices so the rest of the workflow is
            usable. Set{' '}
            <code className="rounded bg-honey-100 px-1">
              DATA_GOV_IN_API_KEY
            </code>{' '}
            in the backend to enable live data.
          </p>
        </div>
      )}

      {listStatus === 'loading' && (
        <div className="ac-card p-8 text-center text-sm text-ink-500">
          Loading market prices…
        </div>
      )}

      {listStatus === 'failed' && (
        <EmptyState
          kind="error"
          title="Could not load market prices"
          description={listError || 'Please retry.'}
          action={
            <button onClick={() => runSearch()} className="ac-btn-secondary">
              Retry
            </button>
          }
        />
      )}

      {listStatus === 'succeeded' && list && list.results.length === 0 && (
        <EmptyState
          kind="info"
          title="No matching prices"
          description="Try clearing some filters or searching for a different crop."
        />
      )}

      {listStatus === 'succeeded' && list && list.results.length > 0 && (
        <>
          <div className="mb-3 flex items-center justify-end">
            <span className="text-xs text-ink-500">
              Prices reported in {list.results[0].unit}
            </span>
          </div>
          <div className="ac-card overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-ink-100">
                <thead className="bg-earth-50">
                  <tr>
                    {[
                      'Crop',
                      'Market',
                      'Location',
                      'Min',
                      'Modal',
                      'Max',
                      'Date',
                    ].map((h) => (
                      <th
                        key={h}
                        className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-ink-500 last:text-right"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-100">
                  {list.results.map((row, idx) => (
                    <tr
                      key={`${row.crop}-${row.market}-${row.price_date}-${idx}`}
                      className="transition hover:bg-primary-50/40"
                    >
                      <td className="px-4 py-3 text-sm font-medium text-ink-900">
                        {row.crop}
                      </td>
                      <td className="px-4 py-3 text-sm text-ink-700">
                        {row.market}
                      </td>
                      <td className="px-4 py-3 text-sm text-ink-600">
                        {row.location}
                      </td>
                      <td className="px-4 py-3 text-right text-sm text-ink-700">
                        {fmtInr(row.min_price)}
                      </td>
                      <td className="px-4 py-3 text-right text-sm font-semibold text-primary-700">
                        {fmtInr(row.modal_price)}
                      </td>
                      <td className="px-4 py-3 text-right text-sm text-ink-700">
                        {fmtInr(row.max_price)}
                      </td>
                      <td className="px-4 py-3 text-right text-sm text-ink-600">
                        {formatDate(row.price_date)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="mt-3 flex flex-wrap items-center gap-2 text-xs text-ink-500">
            <span className="ac-chip ac-chip-ink">Source · {list.source}</span>
            <span>
              Data is provided as-is by the upstream feed; prices reflect
              daily mandi reports and may be reported identically when no
              intra-day range is observed.
            </span>
          </p>
        </>
      )}

      {/* Historical aggregation. Always labelled "NOT a forecast". */}
      <section className="mt-10">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="ac-section-label">Trend</p>
            <h2 className="mt-1 font-display text-2xl text-ink-900">
              Price history
            </h2>
            <p className="mt-1 max-w-2xl text-xs text-ink-500">
              Observed AGMARKNET price history (live when available) ·{' '}
              <strong className="font-semibold text-ink-700">not a forecast</strong>.
            </p>
          </div>
        </div>

        {draft.crop && (
          <PriceTrendChart
            crop={draft.crop.trim()}
            state={draft.state.trim() || undefined}
            market={draft.market.trim() || undefined}
            height={240}
          />
        )}
      </section>

      {/* Nearby mandis — geographic price comparison */}
      <section className="mt-10">
        <div className="mb-3">
          <p className="ac-section-label">Geography</p>
          <h2 className="mt-1 font-display text-2xl text-ink-900">
            Nearby mandis
          </h2>
          <p className="mt-1 max-w-2xl text-xs text-ink-500">
            Where to sell for the best net realization. Distances are
            straight-line and transport is estimated.
          </p>
        </div>

        {draft.crop && (
          <MandiMap
            crop={draft.crop.trim()}
            state={draft.state.trim() || undefined}
          />
        )}
      </section>

      {/* Historical aggregation. Always labelled "NOT a forecast". */}
      <section className="mt-10">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="ac-section-label">Roll-up</p>
            <h2 className="mt-1 font-display text-2xl text-ink-900">
              Historical aggregation
            </h2>
            <p className="mt-1 max-w-2xl text-xs text-ink-500">
              Built-in view over the Mongo MarketPrice collection · <strong className="font-semibold text-ink-700">not a forecast</strong>.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-ink-600">
              Granularity
            </label>
            <select
              value={granularity}
              onChange={(e) => {
                setGranularity(e.target.value)
                dispatch(
                  fetchMarketPriceHistory({
                    crop: draft.crop.trim(),
                    state: draft.state.trim(),
                    market: draft.market.trim(),
                    granularity: e.target.value,
                  }),
                )
              }}
              className="rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-sm"
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
        </div>

        {historyStatus === 'loading' && (
          <div className="ac-card p-6 text-center text-sm text-ink-500">
            Loading history…
          </div>
        )}

        {historyStatus === 'succeeded' && history && (
          <div className="ac-card overflow-hidden p-0">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-100 bg-earth-50 px-4 py-2 text-xs text-ink-600">
              <span>
                {history.granularity} · {history.from} → {history.to} ·{' '}
                {history.total_buckets} bucket
                {history.total_buckets === 1 ? '' : 's'} ·{' '}
                {history.distinct_dates} distinct date
                {history.distinct_dates === 1 ? '' : 's'}
              </span>
              <TrendBadge trend={history.trend} />
            </div>
            {history.results && history.results.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-ink-100">
                  <thead className="bg-earth-50">
                    <tr>
                      {[
                        'Period',
                        'Min',
                        'Modal',
                        'Max',
                        'Avg',
                        'Count',
                        'Δ vs prev',
                      ].map((h, i) => (
                        <th
                          key={h}
                          className={`px-4 py-3 text-xs font-medium uppercase tracking-wider text-ink-500 ${
                            i === 0 ? 'text-left' : 'text-right'
                          }`}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100">
                    {history.results.map((r, i) => (
                      <tr
                        key={`${r.period}-${i}`}
                        className="transition hover:bg-primary-50/40"
                      >
                        <td className="px-4 py-3 text-sm font-medium text-ink-900">
                          {r.period}
                        </td>
                        <td className="px-4 py-3 text-right text-sm text-ink-700">
                          {inr.format(r.min)}
                        </td>
                        <td className="px-4 py-3 text-right text-sm font-semibold text-primary-700">
                          {inr.format(r.modal)}
                        </td>
                        <td className="px-4 py-3 text-right text-sm text-ink-700">
                          {inr.format(r.max)}
                        </td>
                        <td className="px-4 py-3 text-right text-sm text-ink-700">
                          {inr.format(r.avg)}
                        </td>
                        <td className="px-4 py-3 text-right text-sm text-ink-700">
                          {r.count}
                        </td>
                        <td className="px-4 py-3 text-right text-sm text-ink-700">
                          {formatPct(r.change_pct_vs_prev)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-6 text-center text-sm text-ink-500">
                No historical rows for this filter.
              </div>
            )}
            {history.note && (
              <p className="border-t border-ink-100 bg-earth-50 px-4 py-2 text-xs text-ink-500">
                {history.note}
              </p>
            )}
          </div>
        )}
      </section>

      {/* Forward projection. Plain-text "linear trend", never "AI" or "ML". */}
      <section className="mt-10">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="ac-section-label">Projection</p>
            <h2 className="mt-1 font-display text-2xl text-ink-900">
              Forward projection
            </h2>
            <p className="mt-1 max-w-2xl text-xs text-ink-500">
              Linear trend extrapolation · <strong className="font-semibold text-ink-700">not a forecast</strong>.
            </p>
          </div>
          <span className="ac-chip ac-chip-honey">Estimate only</span>
        </div>

        {predictionStatus === 'loading' && (
          <div className="ac-card p-6 text-center text-sm text-ink-500">
            Loading…
          </div>
        )}

        {predictionStatus === 'succeeded' && prediction && (
          <div className="ac-card p-5">
            {prediction.available === false && (
              <div>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="ac-chip ac-chip-honey">Insufficient data</span>
                  <span className="text-xs text-ink-500">
                    {prediction.distinct_dates} distinct date
                    {prediction.distinct_dates === 1 ? '' : 's'} on file
                  </span>
                </div>
                <p className="text-sm text-ink-800">{prediction.message}</p>
                {prediction.disclaimer && (
                  <p className="mt-2 text-xs text-ink-500">
                    {prediction.disclaimer}
                  </p>
                )}
              </div>
            )}

            {prediction.available === true && (
              <div>
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <span className="ac-chip ac-chip-primary">Linear trend</span>
                  <span className="text-xs text-ink-500">
                    {prediction.history_summary &&
                      `${prediction.history_summary.distinct_dates} dates used`}
                  </span>
                </div>
                {prediction.history_summary && (
                  <p className="mb-3 text-xs text-ink-600">
                    First date {prediction.history_summary.first_date} · last
                    date {prediction.history_summary.last_date} · slope{' '}
                    {fmtNumber(prediction.history_summary.slope, 3)}
                  </p>
                )}
                {prediction.projection &&
                  prediction.projection.length > 0 && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="text-left text-xs uppercase text-ink-500">
                          <tr>
                            <th className="pb-2">Day</th>
                            <th className="pb-2 text-right">Point</th>
                            <th className="pb-2 text-right">Low</th>
                            <th className="pb-2 text-right">High</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-ink-100">
                          {prediction.projection.map((p) => (
                            <tr key={p.day}>
                              <td className="py-1.5 font-medium text-ink-900">
                                Day {p.day}
                              </td>
                              <td className="py-1.5 text-right text-ink-800">
                                {inr.format(p.point)}
                              </td>
                              <td className="py-1.5 text-right text-ink-500">
                                {inr.format(p.low)}
                              </td>
                              <td className="py-1.5 text-right text-ink-500">
                                {inr.format(p.high)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                {prediction.disclaimer && (
                  <p className="mt-3 border-t border-ink-100 pt-3 text-xs text-ink-500">
                    {prediction.disclaimer}
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </section>
    </>
  )
}

export default MarketPrices
