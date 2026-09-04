/**
 * CropLotDetail.jsx — the single page that anchors a farmer's
 * relationship to one lot.
 *
 * Mounted at /seller/crop-lots/:publicId (and the legacy
 * /farmer/crop-lots/:publicId). The business logic is preserved
 * verbatim — the lot fetch, the cold-storage form, the cold-storage
 * estimate, the timestamp block. The chrome is the redesigned
 * application shell, and the two pre-built trust cards
 * (<DecisionCard /> and <NetRealizationCard />) are mounted in
 * place of the legacy "find best market" link-strip.
 *
 * Order on the page (top → bottom):
 *   1. Hero — image, crop + variety, status badge, public_id, key facts
 *   2. DecisionCard — rule-based recommendation, market comparison,
 *      ML trend (labelled "Not a forecast")
 *   3. NetRealizationCard — live net calculation with the lot's
 *      quantity as default
 *   4. Action strip — Opportunities, Match buyers, Offers, Quality
 *   5. Cold storage — same form + estimate as before, kept compact
 *   6. Quality notes + timestamps
 *
 * Trust signals: the "farmer quality notes" block is labelled as
 * farmer-provided and never as a grade. The cold-storage estimate
 * keeps its "estimate only" disclaimer in plain text.
 */
import { useEffect, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { Link, useParams } from 'react-router-dom'
import {
  fetchCropLotById,
  clearDetailState,
} from '../redux/slices/cropLotSlice.js'
import api from '../api/axios.js'
import { fmtInr, fmtPerKg, fmtKg } from '../utils/format.js'
import PageHeader from '../components/PageHeader.jsx'
import CropImage from '../components/CropImage.jsx'
import DecisionCard from '../components/DecisionCard.jsx'
import NetRealizationCard from '../components/NetRealizationCard.jsx'
import PriceTrendChart from '../components/PriceTrendChart.jsx'
import MandiMap from '../components/MandiMap.jsx'
import CredibilityBadge from '../components/CredibilityBadge.jsx'
import useCredibility from '../hooks/useCredibility.js'
import usePageMeta from '../hooks/usePageMeta.js'

const STATUS_TONE = {
  DRAFT: 'bg-ink-100 text-ink-700',
  ACTIVE: 'bg-success-100 text-success-700',
  SOLD: 'bg-primary-100 text-primary-800',
  CANCELLED: 'bg-rust-100 text-rust-800',
}

const STATUS_LABEL = {
  DRAFT: 'Draft',
  ACTIVE: 'Active',
  SOLD: 'Sold',
  CANCELLED: 'Cancelled',
}

const INPUT =
  'w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500'

function StatusBadge({ status }) {
  const tone = STATUS_TONE[status] || STATUS_TONE.DRAFT
  const label = STATUS_LABEL[status] || status
  return (
    <span
      className={`inline-block rounded-full px-4 py-1.5 text-xs font-semibold ${tone}`}
    >
      {label}
    </span>
  )
}

function CropLotDetail() {
  const { publicId } = useParams()
  const dispatch = useDispatch()
  usePageMeta({
    title: 'Crop lot',
    description: 'Decision support, net realisation, offers, and quality for this crop lot.',
  })
  const { currentLot, detailStatus, detailError } = useSelector(
    (state) => state.cropLots
  )
  // Inline credibility chip — buyer view, see the farmer's score
  // without opening the full FarmerCard. Same endpoint as FarmerCard
  // (uses module-level cache so no duplicate request).
  const { credibility: farmerCredibility } = useCredibility(
    currentLot?.seller_user_public_id,
    'SELLER'
  )

  const [cold, setCold] = useState({
    required: false,
    duration_days: 30,
    rate_per_kg_per_day: 0.2,
  })
  const [coldSaving, setColdSaving] = useState(false)
  const [coldSaveError, setColdSaveError] = useState(null)
  const [coldSaveOk, setColdSaveOk] = useState(false)
  const [estimate, setEstimate] = useState(null)
  const [estLoading, setEstLoading] = useState(false)
  const [estError, setEstError] = useState(null)

  useEffect(() => {
    dispatch(fetchCropLotById(publicId))
    return () => {
      dispatch(clearDetailState())
    }
  }, [dispatch, publicId])

  useEffect(() => {
    if (currentLot) {
      setCold({
        required: !!currentLot.cold_storage_required,
        duration_days: currentLot.cold_storage_duration_days || 30,
        rate_per_kg_per_day: currentLot.cold_storage_rate_per_kg_per_day || 0.2,
      })
    }
  }, [currentLot])

  const saveCold = async (e) => {
    e.preventDefault()
    setColdSaving(true)
    setColdSaveError(null)
    setColdSaveOk(false)
    try {
      await api.patch(`/crop-lots/${publicId}`, {
        cold_storage_required: cold.required,
        cold_storage_duration_days: Number(cold.duration_days),
        cold_storage_rate_per_kg_per_day: Number(cold.rate_per_kg_per_day),
      })
      setColdSaveOk(true)
      dispatch(fetchCropLotById(publicId))
    } catch (err) {
      setColdSaveError(err.response?.data?.detail || err.message)
    } finally {
      setColdSaving(false)
    }
  }

  const runEstimate = async () => {
    setEstLoading(true)
    setEstError(null)
    try {
      const res = await api.post('/cold-storage/estimate', {
        crop_lot_id: publicId,
        days: Number(cold.duration_days),
        rate_per_kg_per_day: Number(cold.rate_per_kg_per_day),
      })
      setEstimate(res.data)
    } catch (err) {
      setEstError(err.response?.data?.detail || err.message)
    } finally {
      setEstLoading(false)
    }
  }

  if (detailStatus === 'loading') {
    return (
      <>
        <PageHeader
          eyebrow="Selling"
          title="Crop lot"
          subtitle="Loading lot…"
        />
        <div className="ac-card p-12 text-center text-sm text-ink-500">
          Loading crop lot…
        </div>
      </>
    )
  }

  if (detailStatus === 'failed') {
    return (
      <>
        <PageHeader eyebrow="Selling" title="Crop lot" />
        <div className="rounded-card border border-rust-200 bg-rust-50 p-5 text-sm text-rust-800">
          <p className="font-medium">Failed to load crop lot</p>
          <p className="mt-1 text-xs text-rust-700">{detailError}</p>
          <button
            onClick={() => dispatch(fetchCropLotById(publicId))}
            className="ac-btn-secondary mt-3"
          >
            Retry
          </button>
        </div>
      </>
    )
  }

  if (!currentLot) return null

  return (
    <>
      <PageHeader
        eyebrow="Selling"
        title={currentLot.crop_name}
        subtitle={
          currentLot.crop_variety
            ? `${currentLot.crop_variety} · ${currentLot.quantity} ${currentLot.quantity_unit} · ${currentLot.location || ''}`
            : `${currentLot.quantity} ${currentLot.quantity_unit} · ${currentLot.location || ''}`
        }
        back={{ to: '/seller/crop-lots', label: 'My Crops' }}
        actions={<StatusBadge status={currentLot.status} />}
      />

      {/* Hero */}
      <section className="ac-card mb-6 overflow-hidden p-0">
        <div className="grid gap-0 md:grid-cols-[260px_1fr]">
          <div className="h-48 md:h-full">
            <CropImage
              crop={currentLot.crop_name}
              label={currentLot.crop_name}
              className="h-full w-full"
            />
          </div>
          <div className="p-5 sm:p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h1 className="font-display text-3xl text-ink-900">
                {currentLot.crop_name}
              </h1>
              <div className="flex flex-wrap items-center gap-2">
                <CredibilityBadge credibility={farmerCredibility} compact />
                <span className="rounded-full bg-ink-100 px-3 py-1 font-mono text-xs text-ink-600">
                  {currentLot.public_id}
                </span>
              </div>
            </div>
            {currentLot.crop_variety && (
              <p className="mt-1 text-base text-ink-500">
                {currentLot.crop_variety}
              </p>
            )}

            <dl className="mt-5 grid grid-cols-2 gap-y-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">
                  Quantity
                </dt>
                <dd className="mt-0.5 font-display text-base text-ink-900">
                  {fmtKg(currentLot.quantity, currentLot.quantity_unit)}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">
                  Harvest
                </dt>
                <dd className="mt-0.5 text-ink-800">
                  {currentLot.harvest_date
                    ? new Date(currentLot.harvest_date).toLocaleDateString()
                    : '—'}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">
                  Location
                </dt>
                <dd className="mt-0.5 text-ink-800">
                  {currentLot.location || '—'}
                </dd>
              </div>
              {currentLot.preferred_selling_radius_km != null && (
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">
                    Selling radius
                  </dt>
                  <dd className="mt-0.5 text-ink-800">
                    {currentLot.preferred_selling_radius_km} km
                  </dd>
                </div>
              )}
              {currentLot.minimum_acceptable_price != null && (
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">
                    Min price
                  </dt>
                  <dd className="mt-0.5 font-semibold text-primary-700">
                    {fmtInr(currentLot.minimum_acceptable_price)}
                    <span className="ml-1 text-xs font-normal text-ink-500">
                      {fmtPerKg(
                        currentLot.minimum_acceptable_price,
                        currentLot.quantity_unit
                      )}
                    </span>
                  </dd>
                </div>
              )}
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">
                  Created
                </dt>
                <dd className="mt-0.5 text-ink-800">
                  {currentLot.created_at
                    ? new Date(currentLot.created_at).toLocaleDateString()
                    : '—'}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </section>

      {/* Decision + net realization (the two trust cards) */}
      <div className="mb-6 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <DecisionCard cropLotId={currentLot.id} />
        <NetRealizationCard lot={currentLot} />
      </div>

      {/* Price history + nearby mandis — geography-aware selling */}
      <div className="mb-6 grid gap-6 lg:grid-cols-[1fr_1fr]">
        <PriceTrendChart
          crop={currentLot.crop_name}
          state={currentLot.state || undefined}
          height={220}
        />
        <MandiMap
          crop={currentLot.crop_name}
          state={currentLot.state || undefined}
          lot={currentLot}
        />
      </div>

      {/* Quality notes (trust: never labelled as a grade) */}
      {currentLot.farmer_quality_notes && (
        <section className="ac-card mb-6 p-5">
          <p className="ac-section-label">Quality notes</p>
          <p className="mt-2 whitespace-pre-wrap text-sm text-ink-800">
            {currentLot.farmer_quality_notes}
          </p>
          <p className="mt-2 text-xs text-honey-900">
            ℹ Farmer-provided, not an official quality grade.
          </p>
        </section>
      )}

      {/* Action strip — deep links to the legacy per-lot pages */}
      <section className="ac-card mb-6 p-5">
        <p className="ac-section-label">Sell this lot</p>
        <p className="mt-1 text-sm text-ink-600">
          Find the best market, see the decision, match buyers,
          negotiate, declare quality.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link
            to={`/seller/crop-lots/${currentLot.public_id}/opportunities`}
            className="ac-btn-primary"
          >
            Find best market
          </Link>
          <Link
            to={`/seller/crop-lots/${currentLot.public_id}/decision`}
            className="ac-btn-secondary"
          >
            Decision support
          </Link>
          <Link
            to={`/seller/crop-lots/${currentLot.public_id}/buyers`}
            className="ac-btn-secondary"
          >
            Match buyers
          </Link>
          <Link
            to={`/seller/crop-lots/${currentLot.public_id}/offers`}
            className="ac-btn-secondary"
          >
            Offers
          </Link>
          <Link
            to={`/seller/crop-lots/${currentLot.public_id}/quality`}
            className="ac-btn-secondary"
          >
            Quality
          </Link>
          <Link to="/fpos" className="ac-btn-ghost">
            Join an FPO
          </Link>
        </div>
        <div className="mt-4 border-t border-ink-100 pt-4">
          <p className="text-sm text-ink-600">
            See current mandi prices for{' '}
            <strong className="text-ink-800">{currentLot.crop_name}</strong> to
            benchmark your minimum acceptable price.
          </p>
          <Link
            to={`/market-prices/${encodeURIComponent(currentLot.crop_name)}`}
            className="ac-btn-ghost mt-2"
          >
            Check market price for {currentLot.crop_name} →
          </Link>
        </div>
      </section>

      {/* Cold storage — same form + estimate as before, kept compact */}
      <section className="ac-card mb-6 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="ac-section-label">Cold storage</p>
          <span className="ac-chip ac-chip-honey">Estimate</span>
        </div>
        <p className="mt-1 text-xs text-honey-900">
          ⚠ Estimate only. Compares sell-now vs store-then-sell using the
          lot's quantity, current offers / expected price, and your rate.
        </p>
        <form
          onSubmit={saveCold}
          className="mt-3 grid gap-3 sm:grid-cols-[auto_1fr_1fr_auto] sm:items-end"
        >
          <label className="inline-flex items-center gap-2 text-sm text-ink-700">
            <input
              type="checkbox"
              checked={cold.required}
              onChange={(e) =>
                setCold({ ...cold, required: e.target.checked })
              }
              className="h-4 w-4 rounded border-ink-300 text-primary-600 focus:ring-primary-500"
            />
            Required
          </label>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-700">
              Days
            </label>
            <input
              type="number"
              min="0"
              max="365"
              value={cold.duration_days}
              onChange={(e) =>
                setCold({ ...cold, duration_days: e.target.value })
              }
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
              value={cold.rate_per_kg_per_day}
              onChange={(e) =>
                setCold({ ...cold, rate_per_kg_per_day: e.target.value })
              }
              className={INPUT}
            />
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={coldSaving}
              className="ac-btn-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              {coldSaving ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={runEstimate}
              disabled={estLoading}
              className="ac-btn-secondary disabled:cursor-not-allowed disabled:opacity-50"
            >
              {estLoading ? '…' : 'Estimate'}
            </button>
          </div>
        </form>
        {coldSaveError && (
          <p className="mt-2 text-sm text-rust-700">{coldSaveError}</p>
        )}
        {coldSaveOk && (
          <p className="mt-2 text-sm text-success-700">Saved.</p>
        )}
        {estError && (
          <p className="mt-2 text-sm text-rust-700">{estError}</p>
        )}
        {estimate && (
          <div className="mt-3 rounded-card border border-ink-100 bg-earth-50 p-4 text-sm">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
                  Sell now value
                </p>
                <p className="mt-1 font-display text-base text-ink-900">
                  {fmtInr(estimate.sell_now_value || 0)}
                </p>
                <p className="text-xs text-ink-500">
                  @ {fmtPerKg(estimate.sell_now_price_per_kg || 0)}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
                  Store then sell (net)
                </p>
                <p className="mt-1 font-display text-base text-ink-900">
                  {fmtInr(estimate.net_store_then_sell || 0)}
                </p>
                <p className="text-xs text-ink-500">
                  @ {fmtPerKg(estimate.store_then_sell_price_per_kg || 0)}
                </p>
              </div>
            </div>
            <p className="mt-2 text-xs text-ink-600">
              Storage cost: {fmtInr(estimate.storage_cost || 0)} · Δ vs sell
              now: {fmtInr(estimate.delta_vs_sell_now || 0)}
            </p>
            <p
              className={`mt-1 text-sm font-semibold ${
                estimate.recommendation === 'STORE_THEN_SELL'
                  ? 'text-primary-700'
                  : estimate.recommendation === 'SELL_NOW'
                  ? 'text-success-700'
                  : 'text-honey-800'
              }`}
            >
              Recommendation: {estimate.recommendation}
            </p>
            <p className="text-xs text-ink-600">{estimate.rationale}</p>
          </div>
        )}
      </section>

      {/* Timestamps */}
      <section className="ac-card p-5">
        <p className="ac-section-label">Timestamps</p>
        <p className="mt-2 text-sm text-ink-600">
          Created:{' '}
          {currentLot.created_at
            ? new Date(currentLot.created_at).toLocaleString()
            : '—'}
        </p>
        <p className="text-sm text-ink-600">
          Last updated:{' '}
          {currentLot.updated_at
            ? new Date(currentLot.updated_at).toLocaleString()
            : '—'}
        </p>
      </section>
    </>
  )
}

export default CropLotDetail
