/**
 * FPOs.jsx — Farmer Producer Organisations (group selling).
 *
 * The seller-facing FPO index. Shows every FPO the current farmer
 * can join, an inline "create" form, a join form (pick an ACTIVE
 * crop lot to commit), and an aggregate view (by crop, member lots,
 * reachable buyers) for the selected FPO.
 *
 * All business logic is preserved verbatim:
 *   - fetchFpos / fetchMyFpos / createFpo / seedDemoFpos
 *   - aggregateFpo (re-dispatched when selected FPO or crop filter
 *     changes)
 *   - joinFpo (sends crop_lot_id — the Mongo ObjectId of the lot
 *     the farmer is committing, not the public_id; see memory note
 *     on the FPO membership contract)
 *   - leaveFpo (same)
 *   - The safe-number helpers (num / safeToFixed / str) are kept
 *     in module scope because they guard against malformed
 *     aggregate rows crashing the page
 *
 * The chrome is the redesigned shell: PageHeader, design tokens,
 * ac-card, ac-btn-*, ac-chip-*, EmptyState for the "no FPOs" case.
 */
import { useEffect, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { Link } from 'react-router-dom'
import {
  fetchFpos,
  createFpo,
  seedDemoFpos,
  clearFpoCreate,
  aggregateFpo,
  leaveFpo,
  joinFpo,
  fetchMyFpos,
} from '../redux/slices/fpoSlice.js'
import { fetchCropLots } from '../redux/slices/cropLotSlice.js'
import { selectIsSeller } from '../redux/slices/authSlice.js'
import PageHeader from '../components/PageHeader.jsx'
import usePageMeta from '../hooks/usePageMeta.js'
import EmptyState from '../components/EmptyState.jsx'
import GroupSaleOptIn from '../components/GroupSaleOptIn.jsx'

// Safe number coercion. A single malformed / partial / legacy
// aggregate row used to crash the whole FPO page via .toFixed() on
// undefined. Now every numeric read goes through these helpers.
function num(v, fallback = 0) {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}
function safeToFixed(v, digits = 0, fallback = '0') {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return n.toFixed(digits)
}
function str(v, fallback = '') {
  if (v === null || v === undefined) return fallback
  return String(v)
}

const INPUT =
  'w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500'

function FeedbackStrip({ feedback, onDismiss }) {
  if (!feedback) return null
  const tone =
    feedback.kind === 'success'
      ? 'border-success-200 bg-success-50 text-success-700'
      : 'border-rust-200 bg-rust-50 text-rust-800'
  return (
    <div
      className={`mb-4 cursor-pointer rounded-card border p-3 text-sm ${tone}`}
      onClick={onDismiss}
    >
      {feedback.text}{' '}
      <span className="ml-2 text-xs text-ink-500">(click to dismiss)</span>
    </div>
  )
}

function JoinFpoCard({ fpo, onClose, onJoined }) {
  const dispatch = useDispatch()
  const lots = useSelector((s) => s.cropLots?.list || [])
  const lotsStatus = useSelector((s) => s.cropLots?.listStatus)
  const [selectedLot, setSelectedLot] = useState('')
  const [optIn, setOptIn] = useState(true) // explicit per-lot opt-in
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (lotsStatus === 'idle') dispatch(fetchCropLots())
  }, [dispatch, lotsStatus])

  // Only ACTIVE lots owned by the current user are joinable.
  const myActive = (Array.isArray(lots) ? lots : []).filter(
    (l) => l && l.status === 'ACTIVE'
  )

  const submit = async () => {
    if (!selectedLot) {
      setError('Please pick a crop lot to join with.')
      return
    }
    setSubmitting(true)
    setError(null)
    // Pass opt_in so the server can record the explicit choice at
    // join time. The user can change it later via the /opt-in
    // endpoint (rendered by GroupSaleOptIn).
    const action = await dispatch(
      joinFpo({ publicId: fpo.public_id, crop_lot_id: selectedLot, opt_in: optIn })
    )
    setSubmitting(false)
    if (action.meta.requestStatus === 'fulfilled') {
      onJoined && onJoined()
      onClose && onClose()
    } else {
      setError(action.payload || 'Failed to join FPO')
    }
  }

  return (
    <div className="mt-3 rounded-card border border-primary-200 bg-primary-50 p-3">
      <p className="text-xs font-medium text-primary-900">
        Pick one of your ACTIVE crop lots to join{' '}
        <strong>{fpo.name}</strong>:
      </p>
      {myActive.length === 0 ? (
        <p className="mt-2 text-xs text-honey-800">
          You have no ACTIVE crop lots. Create one from the Seller dashboard
          first.
        </p>
      ) : (
        <select
          value={selectedLot}
          onChange={(e) => setSelectedLot(e.target.value)}
          className={INPUT + ' mt-2'}
        >
          <option value="">— Select a crop lot —</option>
          {myActive.map((l) => (
            <option key={l.public_id} value={l.public_id}>
              {l.crop_name} · {l.quantity}
              {l.quantity_unit || 'kg'} · {l.location || 'no location'}
            </option>
          ))}
        </select>
      )}
      {/* Explicit opt-in checkbox — Feature E. Membership is not
          enough; the lot must be opted in to count toward group-sale
          aggregation. */}
      <label className="mt-2 flex items-start gap-2 text-xs text-primary-900">
        <input
          type="checkbox"
          checked={optIn}
          onChange={(e) => setOptIn(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-ink-300 text-primary-600 focus:ring-primary-500"
        />
        <span>
          <strong>Opt in this lot for group sales.</strong> Opted-in
          lots are aggregated with other farmers' lots to meet
          bulk-buyer demand. You can change this later.
        </span>
      </label>
      {error && <p className="mt-2 text-xs text-rust-700">{error}</p>}
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={submitting || myActive.length === 0}
          className="ac-btn-primary disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? 'Joining…' : 'Confirm join'}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="ac-btn-ghost"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

function FPOs() {
  const dispatch = useDispatch()
  const isSeller = useSelector(selectIsSeller)
  usePageMeta({
    title: 'FPOs',
    description: 'Farmer Producer Organisations — join one to aggregate, share logistics, and bulk-sell.',
  })
  const {
    list,
    listMeta,
    listStatus,
    listError,
    createStatus,
    createError,
    seedStatus,
    seedResult,
    seedError,
    aggregate,
    aggregateStatus,
  } = useSelector((state) => state.fpos)

  const [form, setForm] = useState({
    name: '',
    location: '',
    district: '',
    state: '',
  })
  const [showCreate, setShowCreate] = useState(false)
  const [selectedFpo, setSelectedFpo] = useState(null)
  const [crop, setCrop] = useState('')
  const [joiningFpoId, setJoiningFpoId] = useState(null)
  const [feedback, setFeedback] = useState(null)

  useEffect(() => {
    dispatch(fetchFpos())
    if (isSeller) dispatch(fetchMyFpos())
  }, [dispatch, isSeller])

  useEffect(
    () => () => {
      dispatch(clearFpoCreate())
    },
    [dispatch]
  )

  useEffect(() => {
    if (selectedFpo) {
      dispatch(aggregateFpo({ publicId: selectedFpo, crop: crop || undefined }))
    }
  }, [dispatch, selectedFpo, crop])

  const handleCreate = (e) => {
    e.preventDefault()
    dispatch(createFpo(form))
  }

  const handleLeave = async (fpoPublicId, cropLotId) => {
    if (!cropLotId) return
    const action = await dispatch(
      leaveFpo({ publicId: fpoPublicId, crop_lot_id: cropLotId })
    )
    if (action.meta.requestStatus === 'fulfilled') {
      setFeedback({
        kind: 'success',
        text: 'Left the FPO. Your crop lot is still ACTIVE.',
      })
      dispatch(fetchFpos())
      if (isSeller) dispatch(fetchMyFpos())
      if (selectedFpo === fpoPublicId) {
        dispatch(aggregateFpo({ publicId: fpoPublicId, crop: crop || undefined }))
      }
    } else {
      setFeedback({ kind: 'error', text: action.payload || 'Failed to leave FPO' })
    }
  }

  const handleJoined = () => {
    setFeedback({
      kind: 'success',
      text: 'Joined the FPO. Member count updated.',
    })
    dispatch(fetchFpos())
    if (isSeller) dispatch(fetchMyFpos())
  }

  return (
    <>
      <PageHeader
        eyebrow="FPOs"
        title="FPOs / Group Selling"
        description="Aggregate your crop lot with other farmers' to reach larger buyers. Pool volume, share logistics, get a better price."
        actions={
          <>
            <Link to="/buyers" className="ac-btn-secondary">
              Buyer marketplace
            </Link>
            <button
              onClick={() => setShowCreate((v) => !v)}
              className="ac-btn-primary"
            >
              {showCreate ? 'Close' : '+ New FPO'}
            </button>
          </>
        }
      />

      <FeedbackStrip feedback={feedback} onDismiss={() => setFeedback(null)} />

      {seedStatus === 'succeeded' && seedResult && (
        <div className="mb-4 rounded-card border border-honey-200 bg-honey-50 p-3 text-sm text-honey-800">
          Sample seed: <strong>{seedResult.inserted}</strong> inserted,{' '}
          <strong>{seedResult.skipped}</strong> skipped. Total:{' '}
          <strong>{seedResult.total_after}</strong>.
        </div>
      )}

      {showCreate && (
        <form onSubmit={handleCreate} className="ac-card mb-6 p-5">
          <p className="ac-section-label">New FPO</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-700">
                FPO name
              </label>
              <input
                type="text"
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Nashik Onion Growers Co-op"
                className={INPUT}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-700">
                Location
              </label>
              <input
                type="text"
                required
                value={form.location}
                onChange={(e) =>
                  setForm({ ...form, location: e.target.value })
                }
                placeholder="e.g. Nashik"
                className={INPUT}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-700">
                District (optional)
              </label>
              <input
                type="text"
                value={form.district}
                onChange={(e) =>
                  setForm({ ...form, district: e.target.value })
                }
                className={INPUT}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-700">
                State (optional)
              </label>
              <input
                type="text"
                value={form.state}
                onChange={(e) => setForm({ ...form, state: e.target.value })}
                className={INPUT}
              />
            </div>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <button
              type="submit"
              disabled={createStatus === 'loading'}
              className="ac-btn-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              {createStatus === 'loading' ? 'Creating…' : 'Create FPO'}
            </button>
            {createError && (
              <p className="text-sm text-rust-700">{createError}</p>
            )}
          </div>
        </form>
      )}

      {listStatus === 'loading' && (
        <div className="ac-card p-8 text-center text-sm text-ink-500">
          Loading FPOs…
        </div>
      )}
      {listStatus === 'failed' && (
        <div className="mb-4 rounded-card border border-rust-200 bg-rust-50 p-5 text-sm text-rust-800">
          {listError}
        </div>
      )}

      {listStatus === 'succeeded' && list.length === 0 && (
        <EmptyState
          kind="empty"
          title="No FPOs yet"
          description="Create one above to get started, or seed sample FPOs to see how the group-selling flow works."
          action={
            <button
              onClick={() => dispatch(seedDemoFpos())}
              disabled={seedStatus === 'loading'}
              className="ac-btn-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              {seedStatus === 'loading' ? 'Seeding…' : 'Seed sample FPOs'}
            </button>
          }
        />
      )}

      {list.length > 0 && (
        <ul className="grid gap-4 sm:grid-cols-2">
          {list.map((f) => {
            if (!f || !f.public_id) return null
            const district = str(f.district)
            const state = str(f.state)
            const hasSubtitle = district || state
            const members = num(f.member_count, 0)
            const myLots = num(f.my_lot_count, 0)
            const isMember = !!f.is_member || myLots > 0
            const description = str(f.description)
            return (
              <li
                key={f.public_id}
                className={`ac-card p-5 ${
                  isMember ? 'border-primary-300' : ''
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="font-display text-lg text-ink-900">
                      {str(f.name, 'Unnamed FPO')}
                    </h3>
                    <p className="text-sm text-ink-600">
                      📍 {str(f.location, '—')}
                    </p>
                    {hasSubtitle && (
                      <p className="text-xs text-ink-500">
                        {[district, state].filter(Boolean).join(', ')}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {isMember && (
                      <span className="ac-chip ac-chip-success">✓ Joined</span>
                    )}
                    {f.is_demo && (
                      <span className="ac-chip ac-chip-honey">Sample</span>
                    )}
                  </div>
                </div>

                {description && (
                  <p className="mt-2 text-sm text-ink-700">{description}</p>
                )}

                <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-ink-700">
                  <span>
                    Members: <strong>{members}</strong>
                  </span>
                  {isMember && (
                    <span className="text-xs text-success-700">
                      {myLots === 1
                        ? '1 of your crop lots is in this FPO'
                        : `${myLots} of your crop lots are in this FPO`}
                    </span>
                  )}
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    onClick={() => setSelectedFpo(f.public_id)}
                    className="ac-btn-secondary"
                  >
                    View aggregate
                  </button>
                  {isSeller && !isMember && (
                    <button
                      onClick={() => setJoiningFpoId(f.public_id)}
                      className="ac-btn-primary"
                    >
                      Join FPO
                    </button>
                  )}
                  {isSeller && isMember && (
                    <button
                      onClick={() => {
                        const myMemberLots = Array.isArray(
                          f.my_member_lot_public_ids
                        )
                          ? f.my_member_lot_public_ids
                          : []
                        if (myMemberLots.length > 0) {
                          handleLeave(f.public_id, myMemberLots[0])
                        } else {
                          setFeedback({
                            kind: 'error',
                            text: 'No member lot to leave with.',
                          })
                        }
                      }}
                      className="ac-btn-danger"
                    >
                      Leave FPO
                    </button>
                  )}
                </div>

                {joiningFpoId === f.public_id && (
                  <JoinFpoCard
                    fpo={f}
                    onClose={() => setJoiningFpoId(null)}
                    onJoined={handleJoined}
                  />
                )}

                {/* Per-lot group-sale opt-in (Feature E). Shown for
                    members only. Renders nothing useful if the user
                    has no joined lots. */}
                {isMember &&
                  Array.isArray(f.my_member_lot_public_ids) &&
                  f.my_member_lot_public_ids.length > 0 && (
                    <div className="mt-3">
                      <GroupSaleOptIn
                        fpoPublicId={f.public_id}
                        myMemberLotPublicIds={f.my_member_lot_public_ids}
                      />
                    </div>
                  )}
              </li>
            )
          })}
        </ul>
      )}

      {selectedFpo && (
        <section className="ac-card mt-8 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="ac-section-label">FPO aggregation</p>
            <input
              type="text"
              value={crop}
              onChange={(e) => setCrop(e.target.value)}
              placeholder="Filter by crop (optional)"
              className={INPUT + ' w-56'}
            />
          </div>
          {aggregateStatus === 'loading' && (
            <p className="mt-3 text-sm text-ink-500">Computing…</p>
          )}
          {aggregateStatus === 'succeeded' && aggregate && (
            <div className="mt-4 space-y-4">
              {aggregate.note && (
                <p className="text-xs text-honey-800">⚠ {aggregate.note}</p>
              )}
              {Array.isArray(aggregate.by_crop) &&
              aggregate.by_crop.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs uppercase tracking-wide text-ink-500">
                      <tr>
                        <th className="pb-2">Crop</th>
                        <th className="pb-2">Lots</th>
                        <th className="pb-2">Total qty</th>
                        <th className="pb-2">Estimated value</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-ink-100">
                      {aggregate.by_crop.map((row, i) => {
                        if (!row) return null
                        const lotCount = num(row.lot_count, 0)
                        const totalQty = num(row.total_quantity, 0)
                        const qtyUnit = str(row.quantity_unit, 'kg')
                        const estValue = safeToFixed(row.estimated_value, 0, '0')
                        return (
                          <tr key={i}>
                            <td className="py-2 font-medium text-ink-900">
                              {str(row.crop_name, 'Unknown')}
                            </td>
                            <td className="py-2 text-ink-700">{lotCount}</td>
                            <td className="py-2 text-ink-700">
                              {totalQty} {qtyUnit}
                            </td>
                            <td className="py-2 text-ink-700">₹{estValue}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-ink-600">No members yet.</p>
              )}

              {Array.isArray(aggregate.by_crop) &&
                aggregate.by_crop.length > 0 && (
                  <div>
                    <p className="ac-section-label">Member lots</p>
                    <ul className="mt-2 space-y-1 text-sm text-ink-700">
                      {aggregate.by_crop
                        .flatMap((row) =>
                          Array.isArray(row?.member_public_ids)
                            ? row.member_public_ids
                            : []
                        )
                        .map((lotId) => (
                          <li
                            key={lotId}
                            className="flex items-center justify-between gap-2"
                          >
                            <span className="font-mono text-xs">{lotId}</span>
                            <button
                              onClick={() =>
                                handleLeave(
                                  str(aggregate.fpo_public_id, ''),
                                  lotId
                                )
                              }
                              className="rounded-full border border-rust-200 px-2.5 py-0.5 text-xs font-medium text-rust-700 transition hover:bg-rust-50"
                            >
                              Leave
                            </button>
                          </li>
                        ))}
                    </ul>
                    <p className="mt-2 text-xs text-ink-500">
                      Leaving an FPO is safe — your crop lot stays ACTIVE.
                    </p>
                  </div>
                )}

              {Array.isArray(aggregate.reachable_buyers) &&
                aggregate.reachable_buyers.length > 0 && (
                  <div>
                    <p className="ac-section-label">Reachable buyers</p>
                    <ul className="mt-2 space-y-1 text-sm text-ink-700">
                      {aggregate.reachable_buyers.map((rb, i) => (
                        <li key={i}>
                          {str(rb?.buyer_name, 'Unknown buyer')} — needs{' '}
                          {num(rb?.min_quantity, 0)}{' '}
                          {str(rb?.quantity_unit, 'kg')} for{' '}
                          {str(rb?.crop_name, '—')}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
            </div>
          )}
        </section>
      )}
    </>
  )
}

export default FPOs
