import { useEffect, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { Link, useNavigate } from 'react-router-dom'
import {
  createRfqDemand,
  fetchRfqDemandsForBuyer,
  fetchRfqDemands,
  clearRfqAction,
  fetchRfqDemandById,
} from '../redux/slices/demandSlice.js'
import { selectActiveBuyer, selectIsBuyer, selectPublicId } from '../redux/slices/authSlice.js'
import PageHeader from '../components/PageHeader.jsx'
import usePageMeta from '../hooks/usePageMeta.js'

function CreateDemand() {
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const isBuyer = useSelector(selectIsBuyer)
  usePageMeta({
    title: 'Create demand',
    description: 'Tell farmers what you want to buy — quantity, price, location, and required date.',
  })
  const activeBuyer = useSelector(selectActiveBuyer)
  const userPublicId = useSelector(selectPublicId)
  const { rfqActionStatus, rfqActionError, rfqList, rfqListStatus } =
    useSelector((s) => s.demands)

  const [form, setForm] = useState({
    crop_name: '',
    crop_variety: '',
    quantity_kg: '',
    max_price_per_kg: '',
    location: '',
    state: '',
    required_date: '',
    notes: '',
  })
  const [savedId, setSavedId] = useState(null)

  useEffect(() => {
    if (!isBuyer) navigate('/role', { replace: true })
  }, [dispatch, isBuyer, navigate])

  // Load this buyer's existing demands so the page shows the list of
  // every demand the buyer has created, including ones made just now.
  useEffect(() => {
    if (!isBuyer) return
    if (activeBuyer?.public_id) {
      dispatch(fetchRfqDemandsForBuyer(activeBuyer.public_id))
    } else {
      // No buyer picked yet — at least show all ACTIVE demands so the
      // empty state isn't "loading…" forever.
      dispatch(fetchRfqDemands({}))
    }
  }, [dispatch, isBuyer, activeBuyer?.public_id])

  useEffect(() => () => { dispatch(clearRfqAction()) }, [dispatch])

  const update = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const submit = async (e) => {
    e.preventDefault()
    if (!form.crop_name.trim() || !form.quantity_kg) return
    if (!activeBuyer?.public_id && !userPublicId) {
      // No buyer context — can't create a demand.
      return
    }
    const body = {
      crop_name: form.crop_name.trim(),
      crop_variety: form.crop_variety.trim(),
      quantity_kg: Number(form.quantity_kg),
      max_price_per_kg:
        form.max_price_per_kg === '' ? null : Number(form.max_price_per_kg),
      location: form.location.trim(),
      state: form.state.trim(),
      required_date: form.required_date || '',
      notes: form.notes.trim(),
      // Send the explicit buyer_public_id so the backend can resolve
      // the right Buyer record (password-login users have no
      // activeBuyerId by default).
      buyer_public_id: activeBuyer?.public_id || undefined,
    }
    const action = await dispatch(createRfqDemand(body))
    if (action.meta.requestStatus === 'fulfilled' && action.payload?.public_id) {
      setSavedId(action.payload.public_id)
      // Refetch the buyer's demand list so the new demand appears
      // immediately, and clear the form.
      if (activeBuyer?.public_id) {
        dispatch(fetchRfqDemandsForBuyer(activeBuyer.public_id))
      }
      // Refresh the in-memory current demand (in case the page is
      // visited again with the same id).
      dispatch(fetchRfqDemandById(action.payload.public_id))
      setForm({
        crop_name: '',
        crop_variety: '',
        quantity_kg: '',
        max_price_per_kg: '',
        location: '',
        state: '',
        required_date: '',
        notes: '',
      })
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Buying"
        title="Create a demand"
        description="Tell farmers what you want to buy. Once a demand is ACTIVE, farmers can see it and submit offers. Acceptance of any offer creates a Deal."
        back={{ to: '/buyer', label: 'Back to dashboard' }}
      />
      <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">

        {savedId && (
          <div className="mb-4 rounded-card border border-success-200 bg-success-50 p-3 text-sm text-success-700">
            ✅ Demand created.{' '}
            <Link
              to={`/buyer/demands/${savedId}`}
              className="font-medium underline"
            >
              Open it →
            </Link>
          </div>
        )}

        <form
          onSubmit={submit}
          className="grid gap-4 rounded-card border border-earth-200 bg-white p-6 shadow-sm sm:grid-cols-2"
        >
          <div className="sm:col-span-2">
            <label className="text-sm font-medium text-ink-700">Crop *</label>
            <input
              type="text"
              required
              value={form.crop_name}
              onChange={(e) => update('crop_name', e.target.value)}
              placeholder="e.g. Onion"
              className="mt-1 w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-ink-700">Variety (optional)</label>
            <input
              type="text"
              value={form.crop_variety}
              onChange={(e) => update('crop_variety', e.target.value)}
              placeholder="e.g. Red"
              className="mt-1 w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-ink-700">Quantity (kg) *</label>
            <input
              type="number"
              required
              min="1"
              value={form.quantity_kg}
              onChange={(e) => update('quantity_kg', e.target.value)}
              placeholder="e.g. 500"
              className="mt-1 w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-ink-700">Max price (₹/kg)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.max_price_per_kg}
              onChange={(e) => update('max_price_per_kg', e.target.value)}
              placeholder="e.g. 25"
              className="mt-1 w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-ink-700">Required by (date)</label>
            <input
              type="date"
              value={form.required_date}
              onChange={(e) => update('required_date', e.target.value)}
              className="mt-1 w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-ink-700">Pickup location</label>
            <input
              type="text"
              value={form.location}
              onChange={(e) => update('location', e.target.value)}
              placeholder="e.g. Patna"
              className="mt-1 w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-ink-700">State</label>
            <input
              type="text"
              value={form.state}
              onChange={(e) => update('state', e.target.value)}
              placeholder="e.g. Bihar"
              className="mt-1 w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="text-sm font-medium text-ink-700">Notes</label>
            <textarea
              rows={2}
              value={form.notes}
              onChange={(e) => update('notes', e.target.value)}
              placeholder="Any other context (quality, packaging, etc.)"
              className="mt-1 w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
          </div>

          {rfqActionError && (
            <div className="sm:col-span-2 rounded-card border border-rust-200 bg-rust-50 p-3 text-sm text-rust-800">
              {rfqActionError}
            </div>
          )}

          <div className="sm:col-span-2 flex items-center justify-end gap-2">
            <Link to="/buyer" className="ac-btn-secondary">
              Cancel
            </Link>
            <button
              type="submit"
              disabled={rfqActionStatus === 'loading'}
              className="ac-btn-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              {rfqActionStatus === 'loading' ? 'Saving…' : 'Save demand'}
            </button>
          </div>
        </form>

        <section className="mt-8">
          <h2 className="mb-2 font-display text-lg text-ink-900">Your existing demands</h2>
          {rfqListStatus === 'loading' && (
            <p className="text-sm text-ink-500">Loading…</p>
          )}
          {rfqListStatus === 'succeeded' && rfqList.length === 0 && (
            <p className="text-sm text-ink-600">No demands yet — your first one is just above.</p>
          )}
          {rfqListStatus === 'succeeded' && rfqList.length > 0 && (
            <ul className="ac-stagger space-y-2">
              {rfqList.map((r) => (
                <li
                  key={r.public_id}
                  className="ac-card p-3 text-sm"
                >
                  <Link
                    to={`/buyer/demands/${r.public_id}`}
                    className="font-medium text-ink-900 hover:underline"
                  >
                    {r.crop_name}
                    {r.crop_variety ? ` · ${r.crop_variety}` : ''}
                  </Link>
                  {' · '}{r.quantity_kg} kg
                  {r.max_price_per_kg != null && ` · ≤₹${r.max_price_per_kg}/kg`}
                  {r.location && ` · ${r.location}`}
                  {r.required_date && ` · by ${r.required_date}`}
                  {' · '}
                  <span className="rounded-full bg-earth-100 px-2 py-0.5 text-[10px] font-medium text-ink-700">
                    {r.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </>
  )
}

export default CreateDemand
