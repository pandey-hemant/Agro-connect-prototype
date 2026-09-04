/**
 * FPODashboard.jsx — FPO-role entry point.
 *
 * The view differs depending on whether the FPO user has an activeFpo:
 *   - No activeFpo → show the picker (existing FPOs to switch into)
 *     + a "create new" / "seed demo" form
 *   - Has activeFpo → show the FPO detail, the by-crop aggregate,
 *     the member lots list with a "remove" button, and the "add a
 *     member lot" form.
 *
 * The page is laid out in the same shape as the Farmer / Buyer
 * dashboards: hero with the active FPO + primary CTA, then a stat
 * row, then a content body.
 *
 * All business logic preserved verbatim:
 *   - fetchFpos / fetchFpoById / aggregateFpo
 *   - createFpo / seedDemoFpos
 *   - setActiveFpo + demoLogin (the dual-write that keeps the
 *     X-Demo-User header and the authSlice in sync — see memory
 *     note on the JWT auth architecture)
 *   - leaveFpo (sends crop_lot_id, the Mongo ObjectId; see memory
 *     note on the FPO membership contract)
 *   - handleJoin: a direct api.post to /fpos/:id/join with a
 *     crop_lot_id. This bypasses the joinFpo thunk on purpose —
 *     the FPO-role join is a slightly different code path (no
 *     Redux `myFpos` update needed) and reusing the thunk would
 *     pull in seller-only selectors.
 */
import { useEffect, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { Link, useNavigate } from 'react-router-dom'
import {
  fetchFpos,
  createFpo,
  seedDemoFpos,
  fetchFpoById,
  aggregateFpo,
  leaveFpo,
} from '../redux/slices/fpoSlice.js'
import {
  selectActiveFpo,
  setActiveFpo,
  demoLogin,
  selectIsFpo,
} from '../redux/slices/authSlice.js'
import { fetchAvailableCropLots } from '../redux/slices/cropLotSlice.js'
import PageHeader from '../components/PageHeader.jsx'
import usePageMeta from '../hooks/usePageMeta.js'
import EmptyState from '../components/EmptyState.jsx'
import StatCard from '../components/StatCard.jsx'
import { fmtInr } from '../utils/format.js'

// Safe number coercion — used by the by-crop aggregate rows which
// occasionally come back with missing fields.
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

// ---- Active-FPO hero + stat row --------------------------------------

function FpoHero({ activeFpo, onSwitch, onCreate }) {
  return (
    <div className="rounded-card border border-earth-200 bg-gradient-to-br from-primary-50 via-earth-50 to-white p-5 sm:p-7">
      <p className="ac-section-label">Your FPO</p>
      <h1 className="mt-1 font-display text-3xl font-medium text-ink-900 sm:text-4xl">
        {activeFpo?.name || 'Pick an FPO to manage'}
      </h1>
      <p className="mt-2 max-w-2xl text-ink-500">
        {activeFpo
          ? 'Pool member lots, see your by-crop aggregate, and negotiate as a group with larger buyers.'
          : 'Pick a sample FPO, create a new one, or seed the sample data below.'}
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {activeFpo ? (
          <>
            <Link to="/fpos" className="ac-btn-secondary">
              Switch FPO
            </Link>
            <button onClick={onSwitch} className="ac-btn-ghost">
              Sign out
            </button>
          </>
        ) : (
          <>
            <button onClick={onCreate} className="ac-btn-primary">
              + Create FPO
            </button>
            <Link to="/fpos" className="ac-btn-secondary">
              All FPOs
            </Link>
          </>
        )}
      </div>
    </div>
  )
}

function FpoStatRow({ current, aggregate, lotCount }) {
  const memberCount = num(current?.member_count, 0)
  const cropRows = Array.isArray(aggregate?.by_crop) ? aggregate.by_crop.length : 0
  const totalQty = (Array.isArray(aggregate?.by_crop) ? aggregate.by_crop : []).reduce(
    (a, r) => a + num(r?.total_quantity, 0),
    0
  )
  const estValue = (Array.isArray(aggregate?.by_crop) ? aggregate.by_crop : []).reduce(
    (a, r) => a + Number(r?.estimated_value || 0),
    0
  )
  return (
    <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        label="Member lots"
        value={memberCount}
        hint={memberCount > 0 ? 'Across all crops' : 'No members yet'}
        tone={memberCount > 0 ? 'primary' : 'default'}
        icon={
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <path d="M3 7h18l-1.5 12a2 2 0 0 1-2 1.8H6.5a2 2 0 0 1-2-1.8L3 7Z" />
          </svg>
        }
      />
      <StatCard
        label="Crops in pool"
        value={cropRows}
        hint={cropRows > 0 ? 'Distinct crops' : '—'}
        icon={
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <path d="M12 3a5 5 0 0 0-5 5c0 4 5 11 5 11s5-7 5-11a5 5 0 0 0-5-5Z" />
            <circle cx="12" cy="8" r="2" />
          </svg>
        }
      />
      <StatCard
        label="Pooled quantity"
        value={`${fmtInr(totalQty)} kg`}
        hint="All members, all crops"
        icon={
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <path d="M3 7h18l-1.5 12a2 2 0 0 1-2 1.8H6.5a2 2 0 0 1-2-1.8L3 7Z" />
            <path d="M8 7V5a4 4 0 0 1 8 0v2" />
          </svg>
        }
      />
      <StatCard
        label="Estimated pool value"
        value={`₹${fmtInr(estValue)}`}
        hint="Sum of by-crop estimates"
        tone="primary"
        icon={
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <path d="M12 2v20" />
            <path d="M17 6H9a3 3 0 0 0 0 6h6a3 3 0 0 1 0 6H7" />
          </svg>
        }
      />
    </div>
  )
}

// ---- Picker (no active FPO yet) --------------------------------------

function FpoPicker({ onSwitchInto }) {
  const dispatch = useDispatch()
  const { list, listStatus, seedStatus, seedResult, seedError } =
    useSelector((s) => s.fpos || {})
  const fpos = list || []
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({
    name: '',
    location: '',
    district: '',
    state: '',
  })
  const createStatus = useSelector((s) => s.fpos?.createStatus)
  const createError = useSelector((s) => s.fpos?.createError)

  const handleCreate = (e) => {
    e.preventDefault()
    dispatch(createFpo(form))
  }
  const handleSeed = () => {
    dispatch(seedDemoFpos())
  }

  return (
    <>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <p className="ac-section-label">Available FPOs</p>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={handleSeed}
            disabled={seedStatus === 'loading'}
            className="ac-btn-secondary disabled:cursor-not-allowed disabled:opacity-50"
          >
            {seedStatus === 'loading' ? 'Seeding…' : 'Seed sample FPOs'}
          </button>
          <button
            onClick={() => setShowCreate((v) => !v)}
            className="ac-btn-primary"
          >
            {showCreate ? 'Close' : '+ New FPO'}
          </button>
        </div>
      </div>

      {seedStatus === 'succeeded' && seedResult && (
        <div className="mt-3 rounded-card border border-honey-200 bg-honey-50 p-3 text-sm text-honey-800">
          Sample seed: <strong>{seedResult.inserted}</strong> inserted,{' '}
          <strong>{seedResult.skipped}</strong> skipped.
        </div>
      )}

      {showCreate && (
        <form
          onSubmit={handleCreate}
          className="ac-card mt-4 grid gap-3 p-5 sm:grid-cols-2"
        >
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
          <div className="sm:col-span-2 flex items-center gap-3">
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
        <p className="mt-4 text-sm text-ink-500">Loading FPOs…</p>
      )}

      {seedError && (
        <div className="mt-3 rounded-card border border-rust-200 bg-rust-50 p-3 text-sm text-rust-800">
          {seedError}
        </div>
      )}

      {fpos.length === 0 && listStatus !== 'loading' && (
        <EmptyState
          className="mt-4"
          kind="info"
          title="No FPOs available yet"
          description="Seed the sample FPOs above to see how the dashboard behaves with sample data, or create one from the form."
          action={
            <button
              onClick={handleSeed}
              disabled={seedStatus === 'loading'}
              className="ac-btn-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              {seedStatus === 'loading' ? 'Seeding…' : 'Seed sample FPOs'}
            </button>
          }
        />
      )}

      {fpos.length > 0 && (
        <div className="ac-stagger mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {fpos.map((f) => (
            <article key={f.public_id} className="ac-card ac-card-hover p-4">
              <div className="min-w-0">
                <h3 className="truncate font-display text-lg text-ink-900">
                  {str(f.name, 'Unnamed FPO')}
                </h3>
                <p className="truncate text-sm text-ink-600">
                  📍 {str(f.location, '—')}
                </p>
                <p className="text-xs text-ink-500">
                  Members: {num(f.member_count, 0)}
                </p>
              </div>
              <button
                onClick={() => onSwitchInto(f)}
                className="ac-btn-primary mt-3 w-full"
              >
                Enter →
              </button>
            </article>
          ))}
        </div>
      )}
    </>
  )
}

// ---- Main component ---------------------------------------------------

function FPODashboard() {
  const dispatch = useDispatch()
  const navigate = useNavigate()
  usePageMeta({
    title: 'FPO dashboard',
    description: 'Manage your FPO — member lots, by-crop aggregate, and pooled selling.',
  })
  const isFpo = useSelector(selectIsFpo)
  const activeFpo = useSelector(selectActiveFpo)
  const aggregate = useSelector((s) => s.fpos?.aggregate)
  const aggregateStatus = useSelector((s) => s.fpos?.aggregateStatus)
  const current = useSelector((s) => s.fpos?.current)
  const currentStatus = useSelector((s) => s.fpos?.currentStatus)
  const availableLots = useSelector((s) => s.cropLots?.list || [])

  const [lotId, setLotId] = useState('')
  const [joinError, setJoinError] = useState(null)

  useEffect(() => {
    if (!isFpo) {
      navigate('/role', { replace: true })
    }
  }, [isFpo, navigate])

  useEffect(() => {
    dispatch(fetchFpos())
    dispatch(fetchAvailableCropLots())
  }, [dispatch])

  // When the user has an active FPO, fetch its detail + aggregate.
  useEffect(() => {
    if (activeFpo?.public_id) {
      dispatch(fetchFpoById(activeFpo.public_id))
      dispatch(aggregateFpo({ publicId: activeFpo.public_id }))
    }
  }, [dispatch, activeFpo?.public_id])

  const handleJoin = (e) => {
    e.preventDefault()
    if (!activeFpo?.public_id || !lotId) return
    setJoinError(null)
    import('../api/axios.js').then(({ default: api }) => {
      api
        .post(`/fpos/${activeFpo.public_id}/join`, { crop_lot_id: lotId })
        .then(() => {
          dispatch(fetchFpoById(activeFpo.public_id))
          dispatch(aggregateFpo({ publicId: activeFpo.public_id }))
          setLotId('')
        })
        .catch((err) => {
          setJoinError(
            err?.response?.data?.detail || err?.message || 'Failed to add lot'
          )
        })
    })
  }

  const handleLeave = (cropLotId) => {
    if (!activeFpo?.public_id) return
    dispatch(leaveFpo({ publicId: activeFpo.public_id, crop_lot_id: cropLotId }))
      .then((action) => {
        if (action.meta.requestStatus === 'succeeded') {
          dispatch(fetchFpoById(activeFpo.public_id))
          dispatch(aggregateFpo({ publicId: activeFpo.public_id }))
        }
      })
  }

  const handleSwitchInto = (fpo) => {
    dispatch(setActiveFpo(fpo))
    dispatch(demoLogin({ role: 'FPO', fpoId: fpo.public_id }))
  }

  const handleSwitchOut = () => {
    dispatch(setActiveFpo(null))
  }

  return (
    <>
      <PageHeader
        eyebrow="FPO"
        title="FPO dashboard"
        description={
          activeFpo
            ? `Managing ${activeFpo.name}. Pool member lots, see your by-crop aggregate, and negotiate as a group.`
            : 'Pick an FPO to manage, or create a new one.'
        }
      />
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">

        <FpoHero
          activeFpo={activeFpo}
          onSwitch={handleSwitchOut}
          onCreate={() => { /* picker handles the create toggle below */ }}
        />

        {!activeFpo && (
          <FpoPicker onSwitchInto={handleSwitchInto} />
        )}

        {activeFpo && (
          <div>
            <FpoStatRow
              current={current}
              aggregate={aggregate}
              lotCount={Array.isArray(current?.members) ? current.members.length : 0}
            />

            {/* Aggregate by crop */}
            <section className="ac-card mt-8 p-5">
              <p className="ac-section-label">Pool by crop</p>
              <h2 className="mt-1 font-display text-2xl text-ink-900">
                What you've pooled, by crop
              </h2>
              <p className="mt-2 text-xs text-honey-800">
                ⚠{' '}
                {str(
                  aggregate?.note,
                  'Pooled member quantity. Useful for negotiating with larger buyers.'
                )}
              </p>
              {aggregateStatus === 'loading' && (
                <p className="mt-3 text-sm text-ink-500">Computing…</p>
              )}
              {aggregate && (
                <div className="mt-3">
                  {Array.isArray(aggregate.by_crop) &&
                  aggregate.by_crop.length === 0 ? (
                    <EmptyState
                      kind="info"
                      title="No pooled lots yet"
                      description="Add a member lot below to start building the pool."
                    />
                  ) : (
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
                          {Array.isArray(aggregate.by_crop) &&
                            aggregate.by_crop.map((row, i) => {
                              if (!row) return null
                              const lotCount = num(row.lot_count, 0)
                              const totalQty = num(row.total_quantity, 0)
                              const qtyUnit = str(row.quantity_unit, 'kg')
                              const estValue = safeToFixed(
                                row.estimated_value,
                                0,
                                '0'
                              )
                              return (
                                <tr key={`${str(row.crop_name, 'crop')}-${i}`}>
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
                  )}
                </div>
              )}
            </section>

            {/* Member lots */}
            <section className="ac-card mt-6 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="ac-section-label">Member lots</p>
                  <h2 className="mt-1 font-display text-xl text-ink-900">
                    Lots that are pooled in this FPO
                  </h2>
                </div>
              </div>
              {Array.isArray(current?.members) && current.members.length > 0 ? (
                <ul className="ac-stagger mt-3 space-y-2">
                  {current.members.map((m) => (
                    <li
                      key={String(m.crop_lot_id)}
                      className="flex items-center justify-between rounded-card border border-ink-100 bg-earth-50 px-3 py-2 text-sm"
                    >
                      <span className="font-mono text-xs text-ink-700">
                        {String(m.crop_lot_id)}
                      </span>
                      <button
                        onClick={() => handleLeave(String(m.crop_lot_id))}
                        className="rounded-full border border-rust-200 bg-white px-2.5 py-0.5 text-xs font-medium text-rust-700 transition hover:bg-rust-50"
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-ink-600">No member lots yet.</p>
              )}

              <form
                onSubmit={handleJoin}
                className="mt-4 flex flex-wrap items-end gap-2"
              >
                <div className="flex-1 min-w-[12rem]">
                  <label className="mb-1 block text-xs font-medium text-ink-700">
                    Add a crop lot
                  </label>
                  <select
                    value={lotId}
                    onChange={(e) => setLotId(e.target.value)}
                    className={INPUT}
                    aria-label="Select an ACTIVE lot to add to this FPO"
                  >
                    <option value="">Select an ACTIVE lot</option>
                    {availableLots.map((l) => (
                      <option key={l.public_id} value={l.public_id}>
                        {l.public_id} · {l.crop_name} {l.quantity}
                        {l.quantity_unit} · {l.location}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="submit"
                  disabled={!lotId}
                  className="ac-btn-primary disabled:cursor-not-allowed disabled:opacity-50"
                >
                  + Add member lot
                </button>
              </form>
              {joinError && (
                <p className="mt-2 text-sm text-rust-700">{joinError}</p>
              )}
            </section>
          </div>
        )}
      </main>
    </>
  )
}

export default FPODashboard
