/**
 * Opportunities.jsx — net-realization estimator for one crop lot.
 *
 * Mounted at /seller/crop-lots/:publicId/opportunities (and the legacy
 * /farmer/crop-lots/:publicId/opportunities). The business logic —
 * the destination inputs, the vehicle dropdown, the estimate dispatch
 * — is unchanged. The chrome is the redesigned application shell:
 * a PageHeader, design-system cards, an explicit ESTIMATE badge
 * (not a static "result"), and a small trust strip on the modal
 * price (live vs demo fallback).
 */
import { useEffect, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { Link, useParams } from 'react-router-dom'
import { fetchCropLotById } from '../redux/slices/cropLotSlice.js'
import { estimateLogistics, fetchLogisticsConfig } from '../redux/slices/logisticsSlice.js'
import {
  fmtInr,
  fmtPerKg,
  fmtDistanceLabel,
  NOT_AVAILABLE,
} from '../utils/format.js'
import PageHeader from '../components/PageHeader.jsx'
import usePageMeta from '../hooks/usePageMeta.js'

const INPUT =
  'w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500'

function Opportunities() {
  const { publicId } = useParams()
  const dispatch = useDispatch()
  const { currentLot, detailStatus } = useSelector((state) => state.cropLots)
  usePageMeta({
    title: 'Market opportunities',
    description: 'Estimate net realisation at a chosen market — distance, vehicle, and transport cost included.',
  })
  const {
    current: estimate,
    estimateStatus,
    estimateError,
    config,
    configStatus,
  } = useSelector((state) => state.logistics)

  const [destination, setDestination] = useState({ market: '', label: '' })
  const [vehicleType, setVehicleType] = useState('')

  useEffect(() => {
    if (publicId) dispatch(fetchCropLotById(publicId))
  }, [dispatch, publicId])

  useEffect(() => {
    if (!config && configStatus === 'idle') {
      dispatch(fetchLogisticsConfig())
    }
  }, [dispatch, config, configStatus])

  const vehicleRates = (config && config.vehicle_rates) || {}
  const vehicleOptions = Object.keys(vehicleRates).sort()

  const lotIdNum = currentLot?.id

  const handleEstimate = (e) => {
    e.preventDefault()
    if (!destination.market || !destination.label || !lotIdNum) return
    dispatch(
      estimateLogistics({
        crop_lot_id: lotIdNum,
        destination_market: destination.market,
        destination_label: destination.label,
        vehicle_type: vehicleType || undefined,
      })
    )
  }

  return (
    <>
      <PageHeader
        eyebrow={currentLot ? currentLot.crop_name : 'Selling'}
        title="Market opportunities"
        subtitle={
          currentLot
            ? `Estimate net realisation for ${currentLot.crop_name} · ${currentLot.quantity} ${currentLot.quantity_unit} at a chosen destination market.`
            : 'Estimate net realisation for this crop lot at a chosen destination market.'
        }
        back={{ to: `/seller/crop-lots/${publicId}`, label: 'Back to lot' }}
        actions={
          <Link
            to={`/seller/crop-lots/${publicId}/decision`}
            className="ac-btn-secondary"
          >
            Decision support
          </Link>
        }
      />

      {/* Form */}
      <form
        onSubmit={handleEstimate}
        className="ac-card mb-6 grid gap-3 p-5 sm:grid-cols-[1fr_1fr_220px_auto] sm:items-end"
      >
        <div>
          <label className="mb-1 block text-xs font-medium text-ink-700">
            Market
          </label>
          <input
            type="text"
            required
            value={destination.market}
            onChange={(e) =>
              setDestination({ ...destination, market: e.target.value })
            }
            placeholder="e.g. Azadpur Mandi"
            className={INPUT}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-ink-700">
            Label
          </label>
          <input
            type="text"
            required
            value={destination.label}
            onChange={(e) =>
              setDestination({ ...destination, label: e.target.value })
            }
            placeholder="e.g. Delhi"
            className={INPUT}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-ink-700">
            Vehicle
          </label>
          <select
            value={vehicleType}
            onChange={(e) => setVehicleType(e.target.value)}
            className={INPUT}
          >
            <option value="">Default vehicle (20FT)</option>
            {vehicleOptions.map((vt) => (
              <option key={vt} value={vt}>
                {vt} · ₹{Number(vehicleRates[vt] || 0).toFixed(2)}/km
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          disabled={estimateStatus === 'loading' || !lotIdNum}
          className="ac-btn-primary disabled:cursor-not-allowed disabled:opacity-50"
        >
          {estimateStatus === 'loading' ? 'Computing…' : 'Estimate'}
        </button>

        {config && config.nhb_scheme && (
          <p className="sm:col-span-4 mt-1 text-xs text-ink-500">
            Reference rates per km. See NHB scheme reference for cold-storage
            context below.
          </p>
        )}
      </form>

      {estimateError && (
        <div className="mb-4 rounded-card border border-rust-200 bg-rust-50 p-4 text-sm text-rust-800">
          {estimateError}
        </div>
      )}

      {/* Result */}
      {estimateStatus === 'succeeded' && estimate && (
        <section className="ac-card overflow-hidden p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-100 bg-earth-50 px-5 py-3">
            <h2 className="font-display text-lg text-ink-900">
              {estimate.destination_label || NOT_AVAILABLE} ·{' '}
              {estimate.destination_market || NOT_AVAILABLE}
            </h2>
            <span className="ac-chip ac-chip-honey">Estimate</span>
          </div>

          <div className="grid gap-4 p-5 sm:grid-cols-3">
            <div className="rounded-card border border-ink-200 p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
                Gross value
              </p>
              <p className="mt-1 font-display text-2xl text-ink-900">
                {fmtInr(estimate.gross_value)}
              </p>
            </div>
            <div className="rounded-card border border-ink-200 p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
                Total logistics
              </p>
              <p className="mt-1 font-display text-2xl text-ink-900">
                {fmtInr(estimate.total_logistics_cost)}
              </p>
            </div>
            <div className="rounded-card border border-success-200 bg-success-50 p-3">
              <p className="text-xs font-medium uppercase tracking-wide text-success-700">
                Net realisation
              </p>
              <p className="mt-1 font-display text-2xl text-success-700">
                {fmtInr(estimate.net_realization || estimate.net_realisation)}
              </p>
            </div>
          </div>

          <dl className="grid gap-x-6 gap-y-2 border-t border-ink-100 px-5 py-4 text-sm text-ink-700 sm:grid-cols-2">
            {(() => {
              const dist = fmtDistanceLabel(estimate)
              return (
                <div className="flex justify-between sm:block">
                  <dt className="text-ink-500">Distance</dt>
                  <dd className="font-medium text-ink-900">
                    {dist.text}
                    {dist.hint ? (
                      <span className="ml-1 text-xs font-normal text-ink-500">
                        — {dist.hint}
                      </span>
                    ) : null}
                  </dd>
                </div>
              )
            })()}
            <div className="flex justify-between sm:block">
              <dt className="text-ink-500">Vehicle</dt>
              <dd className="font-medium text-ink-900">
                {estimate.vehicle_type || '20FT'}
              </dd>
            </div>
            <div className="flex justify-between sm:block">
              <dt className="text-ink-500">Transport</dt>
              <dd className="font-medium text-ink-900">
                {fmtInr(estimate.transport_cost)}
              </dd>
            </div>
            <div className="flex justify-between sm:block">
              <dt className="text-ink-500">Loading + Unloading</dt>
              <dd className="font-medium text-ink-900">
                {fmtInr(
                  Number(estimate.loading_cost || 0) +
                    Number(estimate.unloading_cost || 0)
                )}
              </dd>
            </div>
            <div className="flex justify-between sm:block">
              <dt className="text-ink-500">Other charges</dt>
              <dd className="font-medium text-ink-900">
                {fmtInr(estimate.other_charges)}
              </dd>
            </div>
            <div className="flex justify-between sm:block">
              <dt className="text-ink-500">Modal price</dt>
              <dd className="font-medium text-ink-900">
                {fmtPerKg(estimate.modal_price_per_kg)}{' '}
                <span
                  className={
                    estimate.is_live_price
                      ? 'ac-chip ac-chip-success ml-1'
                      : 'ac-chip ac-chip-honey ml-1'
                  }
                >
                  {estimate.is_live_price ? 'live' : 'sample fallback'}
                </span>
              </dd>
            </div>
          </dl>

          <div className="border-t border-ink-100 bg-earth-50 px-5 py-3">
            <Link
              to={`/seller/crop-lots/${publicId}/decision`}
              className="text-sm font-medium text-primary-700 transition hover:text-primary-800"
            >
              See decision support for this lot →
            </Link>
          </div>
        </section>
      )}

      {detailStatus === 'loading' && !estimate && (
        <div className="ac-card p-6 text-center text-sm text-ink-500">
          Loading lot…
        </div>
      )}

      {detailStatus === 'succeeded' && currentLot && !estimate && (
        <p className="mt-4 text-xs text-ink-500">
          Showing estimates for{' '}
          <strong className="text-ink-800">{currentLot.crop_name}</strong> ·{' '}
          {currentLot.quantity} {currentLot.quantity_unit}
        </p>
      )}
    </>
  )
}

export default Opportunities
