/**
 * DecisionSupport.jsx — rule-based sell-now / wait / store-then-sell
 * advisor for one crop lot.
 *
 * Mounted at /seller/crop-lots/:publicId/decision (and the legacy
 * /farmer/crop-lots/:publicId/decision). The business logic is
 * preserved verbatim — the recommendation badge, the market
 * comparison table, the cold-storage form, the NHB scheme footer.
 * The chrome is the redesigned application shell.
 *
 * Trust signal: every estimate block carries an "ESTIMATE" chip and
 * an explicit "rule-based, not AI" disclaimer. The cold-storage
 * comparison is clearly framed as "sell now vs store then sell" —
 * never as a price forecast.
 */
import { useEffect, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { Link, useParams } from 'react-router-dom'
import { fetchCropLotById } from '../redux/slices/cropLotSlice.js'
import { fetchDecision, refreshDecision } from '../redux/slices/decisionSlice.js'
import { fetchLogisticsConfig } from '../redux/slices/logisticsSlice.js'
import api from '../api/axios.js'
import {
  fmtInr,
  fmtInr2,
  fmtDistanceLabel,
  fmtPerKg,
  NOT_AVAILABLE,
} from '../utils/format.js'
import PageHeader from '../components/PageHeader.jsx'
import CropImage from '../components/CropImage.jsx'
import RecommendationHero from '../components/RecommendationHero.jsx'
import usePageMeta from '../hooks/usePageMeta.js'

const INPUT =
  'w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500'

const RECOMMENDATION_TONE = {
  SELL_NOW: 'bg-success-100 text-success-700',
  WAIT: 'bg-honey-100 text-honey-800',
  GROUP_SALE: 'bg-primary-100 text-primary-800',
}

const RECOMMENDATION_LABEL = {
  SELL_NOW: 'Sell now',
  WAIT: 'Wait',
  GROUP_SALE: 'Group sale',
}

function RecommendationBadge({ rec }) {
  const tone = RECOMMENDATION_TONE[rec] || 'bg-ink-100 text-ink-700'
  const label = RECOMMENDATION_LABEL[rec] || rec
  return (
    <span className={`inline-block rounded-full px-3 py-1 text-sm font-semibold ${tone}`}>
      {label}
    </span>
  )
}

function sourceLabelForRow(row) {
  if (row.is_routed && row.distance_provider === 'geoapify') {
    return 'Road distance · Geoapify'
  }
  if (row.is_routed && row.distance_provider === 'osrm') {
    return 'Road distance · OSRM'
  }
  if (row.origin_kind === 'state' || row.origin_kind === 'district') {
    return `Estimated (${row.origin_kind}-centroid)`
  }
  if (row.origin_kind === 'geocoded') {
    return 'Road distance · geocoded'
  }
  return 'Estimated (haversine)'
}

function DecisionSupport() {
  const { publicId } = useParams()
  const dispatch = useDispatch()
  usePageMeta({
    title: 'Decision support',
    description: 'Rule-based sell-now / wait / store-then-sell recommendation. Not an AI prediction. Estimate only.',
  })
  const { currentLot } = useSelector((state) =>
    state.cropLots.currentLot && state.cropLots.currentLot.public_id === publicId
      ? { currentLot: state.cropLots.currentLot }
      : { currentLot: null }
  )
  const { current, status, error } = useSelector((state) => state.decisions)
  const { config: logisticsConfig } = useSelector((state) => state.logistics)

  const [coldDays, setColdDays] = useState(30)
  const [coldRate, setColdRate] = useState(0.2)
  const [coldEstimate, setColdEstimate] = useState(null)
  const [coldLoading, setColdLoading] = useState(false)
  const [coldError, setColdError] = useState(null)

  useEffect(() => {
    if (publicId) {
      dispatch(fetchCropLotById(publicId)).then((action) => {
        if (action.meta.requestStatus === 'fulfilled') {
          dispatch(fetchDecision(action.payload.id))
          const got = action.payload
          if (got) {
            if (got.cold_storage_duration_days > 0)
              setColdDays(got.cold_storage_duration_days)
            if (got.cold_storage_rate_per_kg_per_day > 0)
              setColdRate(got.cold_storage_rate_per_kg_per_day)
          }
        }
      })
    }
  }, [dispatch, publicId])

  useEffect(() => {
    if (!logisticsConfig) dispatch(fetchLogisticsConfig())
  }, [dispatch, logisticsConfig])

  const runColdEstimate = async () => {
    if (!publicId) return
    setColdLoading(true)
    setColdError(null)
    try {
      const res = await api.post('/cold-storage/estimate', {
        crop_lot_id: publicId,
        days: Number(coldDays),
        rate_per_kg_per_day: Number(coldRate),
      })
      setColdEstimate(res.data)
    } catch (err) {
      setColdError(err.response?.data?.detail || err.message)
    } finally {
      setColdLoading(false)
    }
  }

  return (
    <>
      <PageHeader
        eyebrow={currentLot ? currentLot.crop_name : 'Selling'}
        title="Decision support"
        subtitle={
          currentLot
            ? `Rule-based recommendation for ${currentLot.crop_name} · ${currentLot.quantity} ${currentLot.quantity_unit}. Not an AI prediction. Estimate only.`
            : 'Rule-based recommendation. Not an AI prediction. Estimate only.'
        }
        back={{ to: `/seller/crop-lots/${publicId}`, label: 'Back to lot' }}
        actions={
          <Link
            to={`/seller/crop-lots/${publicId}/opportunities`}
            className="ac-btn-secondary"
          >
            Opportunities
          </Link>
        }
      />

      {currentLot && (
        <div className="ac-card mb-6 flex items-center gap-4 p-4">
          <CropImage
            crop={currentLot.crop_name}
            label={currentLot.crop_name}
            className="h-14 w-14 flex-shrink-0 rounded-lg"
          />
          <div className="min-w-0">
            <p className="truncate font-display text-base text-ink-900">
              {currentLot.crop_name}
              {currentLot.crop_variety ? ` · ${currentLot.crop_variety}` : ''}
            </p>
            <p className="truncate text-xs text-ink-500">
              {currentLot.location || '—'} · {currentLot.quantity}{' '}
              {currentLot.quantity_unit}
            </p>
          </div>
        </div>
      )}

      {status === 'loading' && (
        <div className="ac-card p-8 text-center text-sm text-ink-500">
          Computing decision…
        </div>
      )}
      {status === 'failed' && (
        <div className="mb-4 rounded-card border border-rust-200 bg-rust-50 p-4 text-sm text-rust-800">
          {error}
        </div>
      )}

      {status === 'succeeded' && current && (
        <div className="space-y-6">
          <RecommendationHero
            rec={current.recommendation}
            reason={current.reason}
            insufficient={current.insufficient_data}
          />

          <section className="ac-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-display text-lg text-ink-900">Why this recommendation?</h2>
              <button
                onClick={() => dispatch(refreshDecision(current.crop_lot_id))}
                className="text-sm font-medium text-primary-700 transition hover:text-primary-800"
              >
                ↻ Recompute
              </button>
            </div>
            <p className="mt-3 text-sm text-ink-800">{current.reason || NOT_AVAILABLE}</p>
          </section>

          {current.comparison?.length > 0 && (
            <section className="ac-card overflow-hidden p-0">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-100 bg-earth-50 px-5 py-3">
                <h2 className="font-display text-lg text-ink-900">
                  Market comparison
                </h2>
                <span
                  className="ac-chip ac-chip-ink"
                  title="Distances use the configured routing provider (Geoapify when the key is set) and fall back to haversine. Logistical costs are rule-based."
                >
                  Distances:{' '}
                  {current.comparison.some((r) => r.is_routed)
                    ? 'road (routed)'
                    : 'estimated'}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-ink-100 text-sm">
                  <thead className="bg-earth-50 text-xs uppercase tracking-wider text-ink-500">
                    <tr>
                      <th className="px-4 py-2 text-left">Market</th>
                      <th className="px-4 py-2 text-left">Price/kg</th>
                      <th className="px-4 py-2 text-left">Distance · Source</th>
                      <th className="px-4 py-2 text-left">Vehicle · Rate/km</th>
                      <th className="px-4 py-2 text-left">Transport</th>
                      <th className="px-4 py-2 text-left">Logistics</th>
                      <th className="px-4 py-2 text-left">
                        Net (you may receive)
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-100">
                    {current.comparison.map((row, i) => {
                      const dist = fmtDistanceLabel(row)
                      const sourceLabel = sourceLabelForRow(row)
                      return (
                        <tr
                          key={i}
                          className="transition hover:bg-primary-50/40"
                        >
                          <td className="px-4 py-2 font-medium text-ink-900">
                            {row.market || NOT_AVAILABLE}
                            <div className="text-xs text-ink-500">
                              {row.state || row.location || ''}
                            </div>
                          </td>
                          <td className="px-4 py-2 text-ink-800">
                            {fmtPerKg(row.modal_price)}
                          </td>
                          <td className="px-4 py-2 text-ink-800">
                            {dist.text}
                            {dist.hint ? (
                              <div className="text-xs text-ink-500">
                                {dist.hint}
                              </div>
                            ) : null}
                            <div className="mt-0.5 text-xs text-ink-500">
                              {sourceLabel}
                            </div>
                          </td>
                          <td className="px-4 py-2 text-xs text-ink-700">
                            {row.vehicle_type ? (
                              <>
                                <span className="font-medium text-ink-900">
                                  {row.vehicle_type}
                                </span>
                                <span className="text-ink-500">
                                  {' '}
                                  · ₹{fmtInr2(row.vehicle_rate_per_km)}/km
                                </span>
                                <div className="text-ink-500">
                                  × {row.num_vehicles || 1} vehicle
                                  {(row.num_vehicles || 1) > 1 ? 's' : ''}
                                </div>
                              </>
                            ) : (
                              <span className="text-ink-400">—</span>
                            )}
                          </td>
                          <td className="px-4 py-2 text-ink-800">
                            {Number.isFinite(Number(row.transport_cost)) ? (
                              <span className="font-medium text-ink-900">
                                {fmtInr(row.transport_cost)}
                              </span>
                            ) : (
                              <span className="text-ink-400">—</span>
                            )}
                          </td>
                          <td className="px-4 py-2 text-ink-800">
                            {fmtInr(row.total_logistics_cost)}
                          </td>
                          <td className="px-4 py-2 font-semibold text-success-700">
                            {fmtInr(row.net_realisation)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section className="ac-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-display text-lg text-ink-900">
                Cold storage option
              </h2>
              <span className="ac-chip ac-chip-ink">
                Estimate · rule-based
              </span>
            </div>
            <p className="mt-2 text-xs text-honey-900">
              ⚠ Not a price forecast. Compares sell-now vs store-then-sell
              using current offers, your expected price, or market average.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-ink-700">
                  Storage days
                </label>
                <input
                  type="number"
                  min="1"
                  max="365"
                  value={coldDays}
                  onChange={(e) => setColdDays(e.target.value)}
                  className={INPUT}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-ink-700">
                  Rate ₹/kg/day
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={coldRate}
                  onChange={(e) => setColdRate(e.target.value)}
                  className={INPUT}
                />
              </div>
              <div className="flex items-end">
                <button
                  onClick={runColdEstimate}
                  disabled={coldLoading}
                  className="ac-btn-primary w-full disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {coldLoading ? 'Computing…' : 'Compare'}
                </button>
              </div>
            </div>
            {coldError && (
              <p className="mt-2 text-sm text-rust-700">{coldError}</p>
            )}
            {coldEstimate && (
              <div className="mt-4 rounded-card border border-ink-100 bg-earth-50 p-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
                      Amount if you sell now
                    </p>
                    <p className="mt-1 font-display text-lg text-ink-900">
                      {fmtInr(coldEstimate.sell_now_value)}
                    </p>
                    <p className="text-xs text-ink-500">
                      @ {fmtPerKg(coldEstimate.sell_now_price_per_kg)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
                      Amount if you store then sell
                    </p>
                    <p className="mt-1 font-display text-lg text-ink-900">
                      {fmtInr(coldEstimate.net_store_then_sell)}
                    </p>
                    <p className="text-xs text-ink-500">
                      @ {fmtPerKg(coldEstimate.store_then_sell_price_per_kg)}
                    </p>
                  </div>
                </div>
                <div className="mt-3 grid gap-2 text-xs text-ink-600 sm:grid-cols-3">
                  <div>Storage cost: {fmtInr(coldEstimate.storage_cost)}</div>
                  <div>Wastage: {fmtInr(coldEstimate.wastage_value)}</div>
                  <div>
                    Δ vs sell now: {fmtInr(coldEstimate.delta_vs_sell_now)}
                  </div>
                </div>
                <div className="mt-3 rounded-card border border-ink-200 bg-white p-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
                    Recommendation
                  </p>
                  <p
                    className={`mt-1 text-sm font-semibold ${
                      coldEstimate.recommendation === 'STORE_THEN_SELL'
                        ? 'text-primary-700'
                        : coldEstimate.recommendation === 'SELL_NOW'
                        ? 'text-success-700'
                        : 'text-honey-800'
                    }`}
                  >
                    {coldEstimate.recommendation || 'NEUTRAL'}
                  </p>
                  <p className="mt-1 text-xs text-ink-600">
                    {coldEstimate.rationale || NOT_AVAILABLE}
                  </p>
                  <p className="mt-1 text-xs text-ink-500">
                    Breakeven post-storage price:{' '}
                    {fmtPerKg(coldEstimate.breakeven_price_per_kg)}
                  </p>
                </div>
              </div>
            )}

            {logisticsConfig && logisticsConfig.nhb_scheme && (
              <div className="mt-3 border-t border-ink-100 pt-3 text-xs text-ink-500">
                <p>
                  <span className="font-medium text-ink-700">
                    Cold storage:
                  </span>{' '}
                  scheme reference — {logisticsConfig.nhb_scheme.name}
                  {logisticsConfig.nhb_scheme.citation_url ? (
                    <>
                      {' '}
                      (
                      <a
                        href={logisticsConfig.nhb_scheme.citation_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary-700 hover:underline"
                      >
                        {logisticsConfig.nhb_scheme.citation_url.replace(
                          /^https?:\/\//,
                          ''
                        )}
                      </a>
                      ).
                    </>
                  ) : null}
                  {' '}The estimate above uses the user-supplied rate and is
                  NOT a current NHB tariff.
                </p>
              </div>
            )}
          </section>

          <div>
            <Link
              to={`/seller/crop-lots/${publicId}/buyers`}
              className="text-sm font-medium text-primary-700 transition hover:text-primary-800"
            >
              See matched buyers →
            </Link>
          </div>
        </div>
      )}
    </>
  )
}

export default DecisionSupport
