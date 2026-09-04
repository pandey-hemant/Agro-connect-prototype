import { useEffect, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { Link } from 'react-router-dom'
import { fetchBuyers, seedDemoBuyers, clearSeed } from '../redux/slices/buyerSlice.js'
import PageHeader from '../components/PageHeader.jsx'
import EmptyState from '../components/EmptyState.jsx'
import usePageMeta from '../hooks/usePageMeta.js'

function VerificationBadge({ status }) {
  const styles = {
    VERIFIED: 'bg-success-50 text-success-700',
    UNVERIFIED: 'bg-earth-100 text-ink-700',
    SELF_DECLARED: 'bg-honey-50 text-honey-800',
  }
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[status] || styles.UNVERIFIED}`}>
      {status || 'UNVERIFIED'}
    </span>
  )
}

function Buyers() {
  const dispatch = useDispatch()
  const { list, listMeta, listStatus, listError, seedStatus, seedResult, seedError } =
    useSelector((state) => state.buyers)
  usePageMeta({
    title: 'Buyer marketplace',
    description: 'See every registered buyer, what they are looking for, and their verification status.',
  })

  const [cropFilter, setCropFilter] = useState('')
  const [stateFilter, setStateFilter] = useState('')

  useEffect(() => {
    dispatch(fetchBuyers({
      ...(cropFilter ? { crop: cropFilter } : {}),
      ...(stateFilter ? { state: stateFilter } : {}),
    }))
  }, [dispatch, cropFilter, stateFilter])

  useEffect(() => () => { dispatch(clearSeed()) }, [dispatch])

  return (
    <>
      <PageHeader
        eyebrow="Marketplace"
        title="Buyer marketplace"
        description="Verified buyers with crop requirements."
        back={{ to: '/', label: 'Home' }}
        actions={
          <button
            onClick={() => dispatch(seedDemoBuyers())}
            disabled={seedStatus === 'loading'}
            className="ac-btn-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            {seedStatus === 'loading' ? 'Seeding…' : 'Seed sample buyers'}
          </button>
        }
      />
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">

        {seedStatus === 'succeeded' && seedResult && (
          <div className="mb-4 rounded-card border border-honey-200 bg-honey-50 p-3 text-sm text-honey-800">
            Sample seed: <strong>{seedResult.inserted}</strong> inserted,{' '}
            <strong>{seedResult.skipped}</strong> skipped.{' '}
            Total after: <strong>{seedResult.total_after}</strong>.
          </div>
        )}
        {seedStatus === 'failed' && (
          <div className="mb-4 rounded-card border border-rust-200 bg-rust-50 p-3 text-sm text-rust-800">
            {seedError}
          </div>
        )}

        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <input
            type="text"
            value={cropFilter}
            onChange={(e) => setCropFilter(e.target.value)}
            placeholder="Filter by crop (e.g. tomato)"
            className="rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
          <input
            type="text"
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value)}
            placeholder="Filter by state (e.g. Delhi)"
            className="rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
        </div>

        {listMeta && listMeta.is_live === false && (
          <div className="mb-4 rounded-card border border-honey-200 bg-honey-50 p-3 text-sm text-honey-800">
            Source: <strong>sample</strong>. Sample buyers are not real registered companies.
          </div>
        )}

        {listStatus === 'loading' && (
          <div className="ac-card p-8 text-center text-sm text-ink-500">
            Loading buyers…
          </div>
        )}
        {listStatus === 'failed' && (
          <EmptyState
            kind="error"
            title="Could not load buyers"
            description={listError || 'Please retry.'}
            action={
              <button
                onClick={() => dispatch(fetchBuyers({}))}
                className="ac-btn-secondary"
              >
                Retry
              </button>
            }
          />
        )}

        {listStatus === 'succeeded' && list.length === 0 && (
          <EmptyState
            kind="empty"
            title="No buyers yet"
            description="Click Seed sample buyers above to populate the marketplace."
            action={
              <button
                onClick={() => dispatch(seedDemoBuyers())}
                className="ac-btn-primary"
              >
                Seed sample buyers
              </button>
            }
          />
        )}

        {listStatus === 'succeeded' && list.length > 0 && (
          <div className="ac-stagger grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {list.map((b) => (
              <article
                key={b.public_id}
                className="ac-card ac-card-hover p-5"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="truncate font-display text-lg text-ink-900">{b.name}</h3>
                    <p className="truncate text-sm text-ink-600">📍 {b.location || '—'}</p>
                  </div>
                  {b.is_demo && (
                    <span className="ac-chip ac-chip-honey flex-shrink-0">Sample</span>
                  )}
                </div>
                <div className="mt-3 flex items-center gap-2 text-xs">
                  <VerificationBadge status={b.verification_status} />
                  <span className="text-ink-500">· {b.contact_method || '—'}</span>
                </div>
                {b.requirements?.length > 0 && (
                  <div className="mt-4 border-t border-earth-100 pt-3">
                    <p className="ac-section-label">Requirements</p>
                    <ul className="mt-2 space-y-1 text-sm text-ink-700">
                      {b.requirements.slice(0, 3).map((r, i) => (
                        <li key={i}>
                          <span className="font-medium">{r.crop_name}</span>
                          {' '} · {r.min_quantity}–{r.max_quantity} {r.quantity_unit}
                          {' '} · ₹{r.min_price}–₹{r.max_price}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </main>
    </>
  )
}

export default Buyers
