/**
 * BuyerMyDemands.jsx — buyer's "My Demands" page.
 *
 * Lists every demand the current buyer has created (across all
 * statuses) with offer counts, fill progress, and a quick link to
 * details where Accept / Counter / Reject are available. The
 * business logic — the preferred-path fetch via the active buyer's
 * public_id, the fallback to the convenience list, the status
 * filter — is preserved verbatim. The chrome is the redesigned
 * application shell.
 *
 * Wires to:
 *   GET /api/demands?buyer_public_id=<B-...>
 */
import { useEffect, useMemo, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { Link } from 'react-router-dom'
import {
  fetchRfqDemands,
  fetchRfqDemandsForBuyer,
} from '../redux/slices/demandSlice.js'
import {
  selectIsBuyer,
  selectActiveBuyer,
  selectPublicId,
} from '../redux/slices/authSlice.js'
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

function FilterPill({ value, current, onClick }) {
  const active = value === current
  return (
    <button
      onClick={() => onClick(value)}
      className={`rounded-full px-3 py-1 text-xs font-medium transition ${
        active
          ? 'bg-primary-600 text-white'
          : 'border border-primary-200 bg-white text-primary-700 hover:bg-primary-50'
      }`}
    >
      {value === 'ALL' ? 'All' : STATUS_LABEL[value] || value}
    </button>
  )
}

function BuyerMyDemands() {
  const dispatch = useDispatch()
  const isBuyer = useSelector(selectIsBuyer)
  usePageMeta({
    title: 'My demands',
    description: 'See every demand you have created, with offer counts and fill progress.',
  })
  const activeBuyer = useSelector(selectActiveBuyer)
  const userPublicId = useSelector(selectPublicId)
  const { rfqList, rfqListStatus, rfqListError } = useSelector(
    (s) => s.demands
  )
  const [statusFilter, setStatusFilter] = useState('ALL')

  useEffect(() => {
    if (!isBuyer) return
    // Preferred path: the user picked a buyer on the dashboard
    // (activeBuyer.public_id is set) — load only that buyer's demands.
    if (activeBuyer?.public_id) {
      dispatch(fetchRfqDemandsForBuyer(activeBuyer.public_id))
      return
    }
    // Fallback: no buyer picked — try the first buyer from the
    // convenience list so the page is never empty.
    fetch('/api/auth/buyers')
      .then((r) => r.json())
      .then((body) => {
        const first = (body.results || [])[0]
        if (first && first.public_id) {
          dispatch(fetchRfqDemandsForBuyer(first.public_id))
        } else {
          dispatch(fetchRfqDemands({}))
        }
      })
      .catch(() => dispatch(fetchRfqDemands({})))
  }, [dispatch, isBuyer, activeBuyer?.public_id, userPublicId])

  const demands = useMemo(() => {
    const list = safeArray(rfqList)
    if (statusFilter === 'ALL') return list
    return list.filter((d) => d.status === statusFilter)
  }, [rfqList, statusFilter])

  return (
    <>
      <PageHeader
        eyebrow="Buying"
        title="My Demands"
        description="All demands you have created. Open one to see farmer offers and Accept, Counter, or Reject."
        back={{ to: '/buyer', label: 'Dashboard' }}
        actions={
          <Link to="/buyer/demands/new" className="ac-btn-primary">
            + New Demand
          </Link>
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {['ALL', 'ACTIVE', 'FULFILLED', 'CLOSED'].map((s) => (
          <FilterPill
            key={s}
            value={s}
            current={statusFilter}
            onClick={setStatusFilter}
          />
        ))}
      </div>

      {rfqListStatus === 'loading' && (
        <div className="ac-card p-8 text-center text-sm text-ink-500">
          Loading…
        </div>
      )}
      {rfqListError && (
        <div className="mb-4 rounded-card border border-rust-200 bg-rust-50 p-4 text-sm text-rust-800">
          {rfqListError}
        </div>
      )}

      {rfqListStatus === 'succeeded' && demands.length === 0 && (
        <EmptyState
          kind="empty"
          title="No demands yet"
          description="Tell farmers what you want to buy and they'll see your demand on the marketplace. Create your first demand to get started."
          action={
            <Link to="/buyer/demands/new" className="ac-btn-primary">
              Create your first demand
            </Link>
          }
        />
      )}

      {rfqListStatus === 'succeeded' && demands.length > 0 && (
        <ul className="space-y-3">
          {demands.map((d) => {
            if (!d || !d.public_id) return null
            const pct = Math.min(
              100,
              Math.round(
                (Number(d.filled_quantity_kg || 0) /
                  Math.max(1, Number(d.quantity_kg || 1))) *
                  100
              )
            )
            return (
              <li key={d.public_id}>
                <Link
                  to={`/buyer/demands/${d.public_id}`}
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
                        {d.location || '—'}
                        {d.state ? `, ${d.state}` : ''} ·{' '}
                        {d.required_date
                          ? `by ${d.required_date}`
                          : 'no deadline'}
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
                        Filled
                      </dt>
                      <dd className="mt-0.5 font-display text-base text-success-700">
                        {d.filled_quantity_kg} kg ({pct}%)
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
                        Offers
                      </dt>
                      <dd className="mt-0.5 font-display text-base text-ink-900">
                        {Number(d.offer_count || 0)}
                      </dd>
                    </div>
                  </dl>

                  <p className="mt-3 font-mono text-xs text-ink-400">
                    {d.public_id}
                  </p>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}

export default BuyerMyDemands
