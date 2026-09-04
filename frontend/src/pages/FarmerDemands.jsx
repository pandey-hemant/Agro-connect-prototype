/**
 * FarmerDemands.jsx — farmer's view of all ACTIVE buyer demands
 * (the first-class Demand / RFQ surface, not the legacy subdoc-array
 * requirements).
 *
 * The farmer can:
 *   - Browse every ACTIVE demand (filter by crop / state / location)
 *   - Click into one to see full details and submit an offer
 *
 * Wired to:
 *   GET /api/demands
 *
 * The data flow is preserved verbatim. The chrome is the redesigned
 * shell: PageHeader, design-system tokens, rust/earth/ink colors,
 * `ac-card ac-card-hover` for list rows, EmptyState for the no-match
 * case. The "No active demands" empty state is intentionally an
 * info-toned EmptyState so the farmer understands it's a market
 * signal, not a bug.
 */
import { useEffect, useMemo, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { Link } from 'react-router-dom'
import { fetchRfqDemands } from '../redux/slices/demandSlice.js'
import { selectIsSeller } from '../redux/slices/authSlice.js'
import PageHeader from '../components/PageHeader.jsx'
import EmptyState from '../components/EmptyState.jsx'
import usePageMeta from '../hooks/usePageMeta.js'

function safeArray(v) {
  if (Array.isArray(v)) return v
  if (v && Array.isArray(v.results)) return v.results
  return []
}

const STATUS_TONE = {
  ACTIVE: 'bg-success-100 text-success-700',
  CLOSED: 'bg-ink-100 text-ink-700',
  FULFILLED: 'bg-primary-100 text-primary-800',
}

const STATUS_LABEL = {
  ACTIVE: 'Active',
  CLOSED: 'Closed',
  FULFILLED: 'Fulfilled',
}

function StatusBadge({ status }) {
  return (
    <span
      className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${
        STATUS_TONE[status] || 'bg-ink-100 text-ink-700'
      }`}
    >
      {STATUS_LABEL[status] || status}
    </span>
  )
}

const FILTER_INPUT =
  'w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500'

function FarmerDemands() {
  const dispatch = useDispatch()
  const isSeller = useSelector(selectIsSeller)
  usePageMeta({
    title: 'Buyer demands',
    description: 'See every active demand from buyers — filter by crop, state, and location. Click in to make an offer.',
  })
  const { rfqList, rfqListStatus, rfqListError } = useSelector(
    (s) => s.demands
  )

  const [cropFilter, setCropFilter] = useState('')
  const [stateFilter, setStateFilter] = useState('')
  const [locationFilter, setLocationFilter] = useState('')

  useEffect(() => {
    if (!isSeller) return
    const params = { status: 'ACTIVE' }
    if (cropFilter.trim()) params.crop = cropFilter.trim()
    if (stateFilter.trim()) params.state = stateFilter.trim()
    if (locationFilter.trim()) params.location = locationFilter.trim()
    dispatch(fetchRfqDemands(params))
  }, [dispatch, isSeller, cropFilter, stateFilter, locationFilter])

  const demands = useMemo(() => safeArray(rfqList), [rfqList])

  return (
    <>
      <PageHeader
        eyebrow="Selling"
        title="Buyer Demands"
        description="Live requests from buyers — pick a demand, set your price and quantity, and post an offer. The buyer can accept, counter, or reject."
        back={{ to: '/farmer', label: 'Dashboard' }}
        actions={
          <Link to="/buyers" className="ac-btn-ghost">
            Buyers
          </Link>
        }
      />

      {/* Filters */}
      <section className="ac-card mb-4 p-4">
        <p className="ac-section-label">Filter</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-700">
              Crop
            </label>
            <input
              type="text"
              value={cropFilter}
              onChange={(e) => setCropFilter(e.target.value)}
              placeholder="e.g. Onion"
              className={FILTER_INPUT}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-700">
              State
            </label>
            <input
              type="text"
              value={stateFilter}
              onChange={(e) => setStateFilter(e.target.value)}
              placeholder="e.g. Bihar"
              className={FILTER_INPUT}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-700">
              Location
            </label>
            <input
              type="text"
              value={locationFilter}
              onChange={(e) => setLocationFilter(e.target.value)}
              placeholder="e.g. Patna"
              className={FILTER_INPUT}
            />
          </div>
        </div>
      </section>

      {rfqListStatus === 'loading' && (
        <div className="ac-card p-8 text-center text-sm text-ink-500">
          Loading demands…
        </div>
      )}
      {rfqListError && (
        <div className="mb-4 rounded-card border border-rust-200 bg-rust-50 p-4 text-sm text-rust-800">
          {rfqListError}
        </div>
      )}

      {rfqListStatus === 'succeeded' && demands.length === 0 && (
        <EmptyState
          kind="info"
          title="No active demands right now"
          description="No buyers are asking for the crop / state / location you filtered for. Try clearing filters, or check back later when more buyers post requests."
        />
      )}

      {rfqListStatus === 'succeeded' && demands.length > 0 && (
        <ul className="space-y-3">
          {demands.map((d) => {
            if (!d || !d.public_id) return null
            const remaining = Math.max(
              0,
              Number(d.quantity_kg || 0) - Number(d.filled_quantity_kg || 0)
            )
            return (
              <li key={d.public_id}>
                <Link
                  to={`/farmer/demands/${d.public_id}`}
                  className="ac-card ac-card-hover block p-5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="font-display text-xl text-ink-900">
                        {d.crop_name}
                        {d.crop_variety ? (
                          <span className="ml-1 text-sm font-normal text-ink-500">
                            · {d.crop_variety}
                          </span>
                        ) : null}
                      </h3>
                      <p className="text-xs text-ink-500">
                        Buyer: {d.buyer_public_id} · {d.location || '—'}
                        {d.state ? `, ${d.state}` : ''}
                      </p>
                    </div>
                    <StatusBadge status={d.status} />
                  </div>

                  <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">
                        Required
                      </dt>
                      <dd className="mt-0.5 font-display text-base text-ink-900">
                        {d.quantity_kg} kg
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">
                        Max ₹/kg
                      </dt>
                      <dd className="mt-0.5 font-display text-base text-ink-900">
                        {d.max_price_per_kg != null
                          ? `₹${d.max_price_per_kg}`
                          : '—'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">
                        Remaining
                      </dt>
                      <dd className="mt-0.5 font-display text-base text-ink-900">
                        {remaining} kg
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">
                        Required by
                      </dt>
                      <dd className="mt-0.5 font-display text-base text-ink-900">
                        {d.required_date || '—'}
                      </dd>
                    </div>
                  </dl>

                  {d.notes && (
                    <p className="mt-3 text-sm text-ink-600">
                      <span className="text-xs font-medium text-ink-500">
                        Notes:
                      </span>{' '}
                      {d.notes}
                    </p>
                  )}

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-ink-100 pt-3 text-xs text-ink-500">
                    <span>
                      {Number(d.offer_count || 0)} offer
                      {Number(d.offer_count || 0) === 1 ? '' : 's'} so far
                    </span>
                    <span className="font-mono text-ink-400">
                      {d.public_id}
                    </span>
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}

export default FarmerDemands
