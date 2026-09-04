/**
 * MyCropsIndex.jsx — farmer's "My Crops" index page.
 *
 * This is the page mounted at /seller/crop-lots (and the legacy
 * /farmer/crop-lots). It lists every crop lot the farmer owns,
 * regardless of status, with quick filters by status and a search
 * by crop name. Clicking a card deep-links to /seller/crop-lots/:id
 * (the redesigned CropLotDetail with the DecisionCard panel).
 *
 * Wires to:
 *   GET /api/crop-lots?owner=<publicId>
 */
import { useEffect, useMemo, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { Link } from 'react-router-dom'
import { fetchMyCropLots } from '../redux/slices/cropLotSlice.js'
import { selectPublicId, selectIsSeller } from '../redux/slices/authSlice.js'
import { fmtKg, fmtPerKg } from '../utils/format.js'
import PageHeader from '../components/PageHeader.jsx'
import CropImage from '../components/CropImage.jsx'
import EmptyState from '../components/EmptyState.jsx'
import usePageMeta from '../hooks/usePageMeta.js'

const STATUSES = [
  { value: 'ALL', label: 'All' },
  { value: 'DRAFT', label: 'Drafts' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'SOLD', label: 'Sold' },
  { value: 'CANCELLED', label: 'Cancelled' },
]

const STATUS_TONE = {
  DRAFT: 'bg-ink-100 text-ink-700',
  ACTIVE: 'bg-success-100 text-success-700',
  SOLD: 'bg-primary-100 text-primary-800',
  CANCELLED: 'bg-rust-100 text-rust-800',
}

function MyCropsIndex() {
  const dispatch = useDispatch()
  const isSeller = useSelector(selectIsSeller)
  const publicId = useSelector(selectPublicId)
  const { list, listStatus, listError } = useSelector((s) => s.cropLots)
  usePageMeta({
    title: 'My crops',
    description: 'Every crop lot you have listed, with status, quality, and offer counts.',
  })

  const [statusFilter, setStatusFilter] = useState('ALL')
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (isSeller) dispatch(fetchMyCropLots())
  }, [dispatch, isSeller])

  const filtered = useMemo(() => {
    let rows = Array.isArray(list) ? list : []
    if (statusFilter !== 'ALL') {
      rows = rows.filter((r) => r.status === statusFilter)
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      rows = rows.filter((r) =>
        String(r.crop_name || '').toLowerCase().includes(q) ||
        String(r.crop_variety || '').toLowerCase().includes(q) ||
        String(r.location || '').toLowerCase().includes(q)
      )
    }
    // Most recent first
    return [...rows].sort((a, b) =>
      String(b.created_at || '').localeCompare(String(a.created_at || ''))
    )
  }, [list, statusFilter, search])

  const counts = useMemo(() => {
    const rows = Array.isArray(list) ? list : []
    const out = { ALL: rows.length }
    for (const s of STATUSES) {
      if (s.value === 'ALL') continue
      out[s.value] = rows.filter((r) => r.status === s.value).length
    }
    return out
  }, [list])

  return (
    <>
      <PageHeader
        eyebrow="Selling"
        title="My Crops"
        subtitle="Every lot you've listed — draft, active, sold, or cancelled. Open one to manage offers, run decision support, or check quality."
        actions={
          <Link to="/seller/crop-lots/new" className="ac-btn-primary">
            + List a new crop lot
          </Link>
        }
      />

      {/* Filters */}
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          {STATUSES.map((s) => {
            const active = statusFilter === s.value
            return (
              <button
                key={s.value}
                type="button"
                onClick={() => setStatusFilter(s.value)}
                className={
                  active
                    ? 'rounded-full bg-primary-600 px-3 py-1 text-xs font-medium text-white shadow-sm transition'
                    : 'rounded-full border border-primary-200 bg-white px-3 py-1 text-xs font-medium text-primary-700 transition hover:bg-primary-50'
                }
              >
                {s.label} · {counts[s.value] ?? 0}
              </button>
            )
          })}
        </div>
        <div className="w-full sm:max-w-xs">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search crop, variety, or location…"
            className="w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
        </div>
      </div>

      {listStatus === 'loading' && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="ac-skeleton h-48 rounded-2xl border border-ink-100"
            />
          ))}
        </div>
      )}

      {listStatus === 'failed' && (
        <EmptyState
          kind="error"
          title="Could not load your crops"
          description={listError || 'Something went wrong. Please try again.'}
        />
      )}

      {listStatus === 'succeeded' && filtered.length === 0 && (
        <EmptyState
          kind={list.length === 0 ? 'empty' : 'info'}
          title={
            list.length === 0
              ? 'You have not listed any crop lots yet'
              : 'No crops match the current filters'
          }
          description={
            list.length === 0
              ? 'List your first crop lot so buyers and FPOs can see what you have to sell.'
              : 'Try a different status or clear the search.'
          }
          action={
            list.length === 0 ? (
              <Link
                to="/seller/crop-lots/new"
                className="ac-btn-primary"
              >
                + List a crop lot
              </Link>
            ) : null
          }
        />
      )}

      {listStatus === 'succeeded' && filtered.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((lot) => {
            if (!lot || !lot.public_id) return null
            const tone = STATUS_TONE[lot.status] || STATUS_TONE.DRAFT
            return (
              <Link
                key={lot.public_id}
                to={`/seller/crop-lots/${lot.public_id}`}
                className="ac-card ac-card-hover group flex flex-col overflow-hidden p-0"
              >
                <div className="h-32 overflow-hidden">
                  <CropImage
                    crop={lot.crop_name}
                    label={lot.crop_name}
                    className="h-full w-full transition duration-500 group-hover:scale-105"
                  />
                </div>
                <div className="flex flex-1 flex-col p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="truncate font-display text-lg text-ink-900">
                        {lot.crop_name}
                      </h3>
                      {lot.crop_variety ? (
                        <p className="truncate text-sm text-ink-500">
                          {lot.crop_variety}
                        </p>
                      ) : null}
                    </div>
                    <span
                      className={`inline-block shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${tone}`}
                    >
                      {lot.status}
                    </span>
                  </div>

                  <dl className="mt-3 grid grid-cols-2 gap-y-2 text-xs text-ink-600">
                    <dt className="text-ink-500">Quantity</dt>
                    <dd className="text-right font-medium text-ink-800">
                      {fmtKg(lot.quantity, lot.quantity_unit)}
                    </dd>
                    <dt className="text-ink-500">Location</dt>
                    <dd className="truncate text-right text-ink-700">
                      {lot.location || '—'}
                    </dd>
                    <dt className="text-ink-500">Harvest</dt>
                    <dd className="text-right text-ink-700">
                      {lot.harvest_date
                        ? new Date(lot.harvest_date).toLocaleDateString()
                        : '—'}
                    </dd>
                    {lot.minimum_acceptable_price != null && (
                      <>
                        <dt className="text-ink-500">Min price</dt>
                        <dd className="text-right font-medium text-primary-700">
                          {fmtPerKg(
                            lot.minimum_acceptable_price,
                            lot.quantity_unit
                          )}
                        </dd>
                      </>
                    )}
                  </dl>

                  <div className="mt-4 flex items-center justify-between border-t border-ink-100 pt-3 text-[11px] text-ink-400">
                    <span className="font-mono">{lot.public_id}</span>
                    <span className="text-primary-700 group-hover:underline">
                      Open lot →
                    </span>
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      )}

      {!publicId && (
        <p className="mt-6 text-center text-xs text-ink-400">
          We could not determine which farmer you are. Try signing in again.
        </p>
      )}
    </>
  )
}

export default MyCropsIndex
