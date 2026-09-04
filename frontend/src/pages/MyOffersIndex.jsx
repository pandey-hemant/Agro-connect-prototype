/**
 * MyOffersIndex.jsx — farmer's "Offers" inbox index.
 *
 * Mounted at /seller/offers (and the legacy /farmer/offers). It
 * surfaces every offer the farmer has received across all their
 * crop lots, with a status filter and quick stats. Clicking a row
 * deep-links to /seller/offers/:publicId (the redesigned OfferDetail).
 *
 * Because the existing offer slice fetches per-lot, this page first
 * loads the farmer's crop lots, then fans out and merges the offers
 * from each lot into a single list. The merge runs once on mount
 * and again when the lots list changes (e.g. after a new lot is
 * created elsewhere in the app).
 */
import { useEffect, useMemo, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { Link } from 'react-router-dom'
import { fetchMyCropLots } from '../redux/slices/cropLotSlice.js'
import { fetchOffers, clearCurrentOffer } from '../redux/slices/offerSlice.js'
import { selectIsSeller } from '../redux/slices/authSlice.js'
import { fmtInr, fmtPerKg, fmtKg } from '../utils/format.js'
import PageHeader from '../components/PageHeader.jsx'
import EmptyState from '../components/EmptyState.jsx'
import usePageMeta from '../hooks/usePageMeta.js'
import api from '../api/axios.js'

const STATUS_TABS = [
  { value: 'ALL', label: 'All' },
  { value: 'OPEN', label: 'Open' },
  { value: 'COUNTERED', label: 'Countered' },
  { value: 'ACCEPTED', label: 'Accepted' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'FINALIZED', label: 'Finalized' },
  { value: 'CANCELLED', label: 'Cancelled' },
]

const STATUS_TONE = {
  OPEN: 'bg-primary-100 text-primary-800',
  COUNTERED: 'bg-honey-100 text-honey-800',
  ACCEPTED: 'bg-success-100 text-success-700',
  REJECTED: 'bg-rust-100 text-rust-800',
  FINALIZED: 'bg-primary-100 text-primary-800',
  CANCELLED: 'bg-ink-100 text-ink-700',
}

function MyOffersIndex() {
  const dispatch = useDispatch()
  const isSeller = useSelector(selectIsSeller)
  const { list: lots, listStatus: lotsStatus } = useSelector((s) => s.cropLots)
  usePageMeta({
    title: 'Offers inbox',
    description: 'Every offer buyers have sent on your crop lots, in one place.',
  })

  const [mergedOffers, setMergedOffers] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [search, setSearch] = useState('')

  // 1) Pull the farmer's lots
  useEffect(() => {
    if (isSeller) dispatch(fetchMyCropLots())
  }, [dispatch, isSeller])

  // 2) For each lot, pull its offers. We re-run whenever the lot list
  //    shape changes. Each offer is decorated with its lot summary so
  //    the row can show the crop, variety, and quantity context.
  useEffect(() => {
    if (!isSeller) return
    let cancelled = false
    const run = async () => {
      if (!Array.isArray(lots) || lots.length === 0) {
        if (!cancelled) {
          setMergedOffers([])
          setLoading(false)
          setError(null)
        }
        return
      }
      setLoading(true)
      setError(null)
      try {
        const results = await Promise.allSettled(
          lots.map((lot) =>
            api
              .get('/offers', { params: { crop_lot_id: lot.public_id } })
              .then((r) => {
                const arr = Array.isArray(r.data?.results) ? r.data.results : []
                return arr.map((o) => ({
                  ...o,
                  crop_lot_summary: {
                    public_id: lot.public_id,
                    crop_name: lot.crop_name,
                    crop_variety: lot.crop_variety,
                    location: lot.location,
                    quantity: lot.quantity,
                    quantity_unit: lot.quantity_unit,
                  },
                }))
              })
          )
        )
        if (cancelled) return
        const flat = results
          .filter((r) => r.status === 'fulfilled')
          .flatMap((r) => r.value)
        // Newest first
        flat.sort((a, b) =>
          String(b.created_at || '').localeCompare(String(a.created_at || ''))
        )
        setMergedOffers(flat)
      } catch (e) {
        if (!cancelled) setError('Failed to load offers')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [dispatch, isSeller, lots])

  useEffect(() => () => dispatch(clearCurrentOffer()), [dispatch])

  const counts = useMemo(() => {
    const out = { ALL: mergedOffers.length }
    for (const s of STATUS_TABS) {
      if (s.value === 'ALL') continue
      out[s.value] = mergedOffers.filter((o) => o.status === s.value).length
    }
    return out
  }, [mergedOffers])

  const filtered = useMemo(() => {
    let rows = mergedOffers
    if (statusFilter !== 'ALL') {
      rows = rows.filter((o) => o.status === statusFilter)
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      rows = rows.filter((o) => {
        const lot = o.crop_lot_summary || {}
        return (
          String(lot.crop_name || '').toLowerCase().includes(q) ||
          String(lot.location || '').toLowerCase().includes(q) ||
          String(o.buyer_public_id || '').toLowerCase().includes(q)
        )
      })
    }
    return rows
  }, [mergedOffers, statusFilter, search])

  const isLoading = lotsStatus === 'loading' || loading

  return (
    <>
      <PageHeader
        eyebrow="Selling"
        title="Offers"
        subtitle="Every offer buyers have sent you, across all your crop lots. Open one to counter, accept, or reject."
      />

      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          {STATUS_TABS.map((s) => {
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
            placeholder="Search crop, location, or buyer…"
            className="w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
        </div>
      </div>

      {isLoading && (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="ac-skeleton h-20 rounded-2xl border border-ink-100"
            />
          ))}
        </div>
      )}

      {error && (
        <EmptyState kind="error" title="Could not load offers" description={error} />
      )}

      {!isLoading && !error && filtered.length === 0 && (
        <EmptyState
          kind="empty"
          title={
            mergedOffers.length === 0
              ? 'No offers yet'
              : 'No offers match the current filters'
          }
          description={
            mergedOffers.length === 0
              ? 'When buyers make offers on your lots, they will appear here. You can also browse buyer demands to find ones that match your crops.'
              : 'Try a different status or clear the search.'
          }
          action={
            mergedOffers.length === 0 ? (
              <div className="flex flex-wrap gap-2">
                <Link to="/farmer/demands" className="ac-btn-primary">
                  Browse buyer demands
                </Link>
                <Link to="/seller/crop-lots" className="ac-btn-ghost">
                  My Crops
                </Link>
              </div>
            ) : null
          }
        />
      )}

      {!isLoading && !error && filtered.length > 0 && (
        <ul className="divide-y divide-ink-100 overflow-hidden rounded-2xl border border-ink-100 bg-white shadow-sm">
          {filtered.map((o) => {
            if (!o || !o.public_id) return null
            const lot = o.crop_lot_summary || {}
            const tone = STATUS_TONE[o.status] || STATUS_TONE.OPEN
            return (
              <li key={o.public_id}>
                <Link
                  to={`/seller/offers/${o.public_id}`}
                  className="flex flex-col gap-2 px-4 py-3 transition hover:bg-primary-50/40 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="font-display text-base text-ink-900">
                        {lot.crop_name || 'Crop lot'}
                      </span>
                      {lot.crop_variety ? (
                        <span className="text-xs text-ink-500">
                          · {lot.crop_variety}
                        </span>
                      ) : null}
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${tone}`}
                      >
                        {o.status}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-xs text-ink-500">
                      Buyer {o.buyer_public_id} ·{' '}
                      {lot.location || '—'} · {fmtKg(lot.quantity, lot.quantity_unit)}
                    </p>
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    <div className="text-right">
                      <p className="font-semibold text-ink-900">
                        {fmtInr(o.current_price)}
                      </p>
                      <p className="text-xs text-ink-500">
                        {fmtPerKg(o.current_price, lot.quantity_unit)} ·{' '}
                        {fmtKg(o.current_quantity, lot.quantity_unit)}
                      </p>
                    </div>
                    <div className="hidden text-right text-xs text-ink-500 sm:block">
                      {o.created_at
                        ? new Date(o.created_at).toLocaleDateString()
                        : '—'}
                    </div>
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

export default MyOffersIndex
