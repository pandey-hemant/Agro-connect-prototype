/**
 * DemandDetails.jsx — single-demand view + Make-Offer form.
 *
 * Used by:
 *   - Farmer → /farmer/demands/:publicId   (sees a Make Offer form)
 *   - Buyer  → /buyer/demands/:publicId    (sees offers + Accept/Counter/Reject)
 *
 * Wires to:
 *   GET  /api/demands/:publicId
 *   GET  /api/demands/:publicId/offers
 *   POST /api/demands/:publicId/offers   (farmer)
 *   POST /api/offers/:publicId/counter   (buyer)
 *   POST /api/offers/:publicId/accept    (buyer)
 *   POST /api/offers/:publicId/reject    (buyer)
 *   PATCH /api/demands/:publicId         (buyer — close)
 *
 * All business logic is preserved verbatim — the MakeOfferForm, the
 * Accept/Reject/Counter handlers (which still use direct fetch with
 * X-Demo-User, on purpose — they're not part of the demand slice),
 * the close-demand control, the goBack role-aware nav. The chrome
 * is the redesigned shell: PageHeader with eyebrow/title/actions,
 * CropImage hero, design-system tokens, ac-card for sections.
 *
 * Trust signals: the demand status badge reads in plain English
 * ("Active / Fulfilled / Closed") rather than the raw enum. The
 * author tag on offer messages shows the FARMER vs BUYER distinction
 * so the conversation is easy to follow.
 */
import { useEffect, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { Link, useParams, useNavigate } from 'react-router-dom'
import {
  fetchRfqDemandById,
  fetchOffersForRfqDemand,
  createOfferOnRfqDemand,
  updateRfqDemand,
  clearRfqAction,
  clearRfqCurrent,
} from '../redux/slices/demandSlice.js'
import {
  selectIsSeller,
  selectIsBuyer,
  selectPublicId,
} from '../redux/slices/authSlice.js'
import PageHeader from '../components/PageHeader.jsx'
import usePageMeta from '../hooks/usePageMeta.js'
import CropImage from '../components/CropImage.jsx'

function safeArray(v) {
  if (Array.isArray(v)) return v
  if (v && Array.isArray(v.results)) return v.results
  return []
}

const DEMAND_TONE = {
  ACTIVE: 'bg-success-100 text-success-700',
  CLOSED: 'bg-ink-100 text-ink-700',
  FULFILLED: 'bg-primary-100 text-primary-800',
}

const DEMAND_LABEL = {
  ACTIVE: 'Active',
  CLOSED: 'Closed',
  FULFILLED: 'Fulfilled',
}

function DemandStatusBadge({ status }) {
  return (
    <span
      className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${
        DEMAND_TONE[status] || 'bg-ink-100 text-ink-700'
      }`}
    >
      {DEMAND_LABEL[status] || status}
    </span>
  )
}

const OFFER_TONE = {
  OPEN: 'bg-primary-100 text-primary-800',
  COUNTERED: 'bg-honey-100 text-honey-800',
  ACCEPTED: 'bg-success-100 text-success-700',
  REJECTED: 'bg-rust-100 text-rust-800',
  CANCELLED: 'bg-ink-100 text-ink-700',
}

const OFFER_LABEL = {
  OPEN: 'Open',
  COUNTERED: 'Countered',
  ACCEPTED: 'Accepted',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
}

function OfferStatusBadge({ status }) {
  return (
    <span
      className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${
        OFFER_TONE[status] || 'bg-ink-100 text-ink-700'
      }`}
    >
      {OFFER_LABEL[status] || status}
    </span>
  )
}

const INPUT =
  'w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 disabled:bg-ink-50 disabled:opacity-60'

function MakeOfferForm({ demand, onSubmitted }) {
  const dispatch = useDispatch()
  const { rfqActionStatus, rfqActionError } = useSelector((s) => s.demands)
  const [price, setPrice] = useState('')
  const [quantity, setQuantity] = useState('')
  const [message, setMessage] = useState('')

  const remaining = Math.max(
    0,
    Number(demand.quantity_kg || 0) - Number(demand.filled_quantity_kg || 0)
  )
  const disabled =
    demand.status !== 'ACTIVE' ||
    remaining === 0 ||
    rfqActionStatus === 'loading'

  const submit = async (e) => {
    e.preventDefault()
    if (!price || !quantity) return
    const action = await dispatch(
      createOfferOnRfqDemand({
        publicId: demand.public_id,
        price: Number(price),
        quantity: Number(quantity),
        message: message || undefined,
      })
    )
    if (action.meta.requestStatus === 'fulfilled') {
      setPrice('')
      setQuantity('')
      setMessage('')
      onSubmitted?.()
    }
  }

  return (
    <form onSubmit={submit} className="ac-card p-5">
      <p className="ac-section-label">Make an offer</p>
      {demand.status !== 'ACTIVE' && (
        <p className="mt-2 text-sm text-rust-800">
          This demand is {DEMAND_LABEL[demand.status] || demand.status} — offers
          are not accepted.
        </p>
      )}
      {demand.status === 'ACTIVE' && remaining === 0 && (
        <p className="mt-2 text-sm text-honey-800">
          The buyer has already filled this demand.
        </p>
      )}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-ink-700">
            Your price (₹/kg)
          </label>
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            required
            disabled={disabled}
            className={INPUT}
            placeholder={demand.max_price_per_kg || ''}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-ink-700">
            Quantity (kg, max {remaining})
          </label>
          <input
            type="number"
            min="1"
            max={remaining}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            required
            disabled={disabled}
            className={INPUT}
            placeholder={remaining}
          />
        </div>
      </div>
      <div className="mt-3">
        <label className="mb-1 block text-xs font-medium text-ink-700">
          Message (optional)
        </label>
        <textarea
          rows={2}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          disabled={disabled}
          className={INPUT}
          placeholder="Tell the buyer about availability, transport, etc."
        />
      </div>
      {rfqActionError && (
        <p className="mt-2 text-sm text-rust-700">{rfqActionError}</p>
      )}
      <div className="mt-3 flex items-center gap-3">
        <button
          type="submit"
          disabled={disabled}
          className="ac-btn-primary disabled:cursor-not-allowed disabled:opacity-50"
        >
          {rfqActionStatus === 'loading' ? 'Submitting…' : 'Submit offer'}
        </button>
        <p className="text-xs text-ink-500">
          Your offer will be visible to the buyer immediately.
        </p>
      </div>
    </form>
  )
}

function AuthorTag({ author }) {
  const tone =
    author === 'FARMER'
      ? 'bg-honey-100 text-honey-800'
      : author === 'BUYER'
      ? 'bg-primary-100 text-primary-800'
      : 'bg-ink-100 text-ink-700'
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${tone}`}
    >
      {author}
    </span>
  )
}

function DemandDetails() {
  const { publicId } = useParams()
  const dispatch = useDispatch()
  usePageMeta({
    title: 'Demand',
    description: 'View a buyer demand and either make an offer (as farmer) or manage incoming offers (as buyer).',
  })
  const navigate = useNavigate()
  const isSeller = useSelector(selectIsSeller)
  const isBuyer = useSelector(selectIsBuyer)
  const userPublicId = useSelector(selectPublicId)

  const {
    rfqCurrent,
    rfqCurrentStatus,
    rfqCurrentError,
    rfqOffers,
    rfqOffersStatus,
    rfqOffersError,
    rfqActionStatus,
    rfqActionError,
  } = useSelector((s) => s.demands)

  const [activeOffer, setActiveOffer] = useState(null)
  const [counterPrice, setCounterPrice] = useState('')
  const [counterQuantity, setCounterQuantity] = useState('')
  const [counterMessage, setCounterMessage] = useState('')

  useEffect(() => {
    if (publicId) {
      dispatch(fetchRfqDemandById(publicId))
      dispatch(fetchOffersForRfqDemand(publicId))
    }
    return () => {
      dispatch(clearRfqCurrent())
      dispatch(clearRfqAction())
    }
  }, [dispatch, publicId])

  const offers = safeArray(rfqOffers)
  const demand = rfqCurrent

  const isCreator =
    demand && userPublicId && demand.created_by_user_public_id === userPublicId

  const handleAccept = async (offerId) => {
    const res = await fetch(`/api/offers/${offerId}/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ actor: 'BUYER' }),
    })
    if (res.ok) {
      // refetch
      dispatch(fetchOffersForRfqDemand(publicId))
      dispatch(fetchRfqDemandById(publicId))
    } else {
      const body = await res.json().catch(() => ({}))
      alert(`Accept failed: ${body.detail || res.status}`)
    }
  }

  const handleReject = async (offerId) => {
    if (!confirm('Reject this offer?')) return
    const res = await fetch(`/api/offers/${offerId}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ actor: 'BUYER', message: 'Rejected by buyer' }),
    })
    if (res.ok) {
      dispatch(fetchOffersForRfqDemand(publicId))
    } else {
      const body = await res.json().catch(() => ({}))
      alert(`Reject failed: ${body.detail || res.status}`)
    }
  }

  const handleCounter = async (offerId) => {
    if (!counterPrice && !counterQuantity) {
      alert('Enter a new price or quantity to counter with.')
      return
    }
    const body = {
      actor: 'BUYER',
      ...(counterPrice ? { price: Number(counterPrice) } : {}),
      ...(counterQuantity ? { quantity: Number(counterQuantity) } : {}),
      ...(counterMessage ? { message: counterMessage } : {}),
    }
    const res = await fetch(`/api/offers/${offerId}/counter`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    })
    if (res.ok) {
      setActiveOffer(null)
      setCounterPrice('')
      setCounterQuantity('')
      setCounterMessage('')
      dispatch(fetchOffersForRfqDemand(publicId))
    } else {
      const errBody = await res.json().catch(() => ({}))
      alert(`Counter failed: ${errBody.detail || res.status}`)
    }
  }

  const handleClose = async () => {
    if (!confirm('Close this demand? It will no longer accept offers.')) return
    const action = await dispatch(
      updateRfqDemand({ publicId, status: 'CLOSED' })
    )
    if (action.meta.requestStatus === 'fulfilled') {
      // refresh list
      dispatch(fetchRfqDemandById(publicId))
    }
  }

  const goBack = () => {
    if (isSeller) navigate('/farmer/demands')
    else if (isBuyer) navigate('/buyer/demands')
    else navigate('/')
  }

  if (rfqCurrentStatus === 'loading') {
    return (
      <>
        <PageHeader
          eyebrow={isSeller ? 'Selling' : 'Buying'}
          title="Demand"
          subtitle="Loading demand…"
        />
        <div className="ac-card p-8 text-center text-sm text-ink-500">
          Loading demand…
        </div>
      </>
    )
  }

  if (rfqCurrentError) {
    return (
      <>
        <PageHeader
          eyebrow={isSeller ? 'Selling' : 'Buying'}
          title="Demand"
          back={{ to: goBack() || '/', label: 'Back' }}
        />
        <div className="rounded-card border border-rust-200 bg-rust-50 p-4 text-sm text-rust-800">
          {rfqCurrentError}
        </div>
        <button onClick={goBack} className="ac-btn-ghost mt-4">
          ← Go back
        </button>
      </>
    )
  }

  if (!demand) return null

  return (
    <>
      <PageHeader
        eyebrow={isSeller ? 'Selling' : 'Buying'}
        title={`${demand.crop_name}${
          demand.crop_variety ? ` · ${demand.crop_variety}` : ''
        }`}
        description={`Buyer: ${demand.buyer_public_id} · ${
          demand.location || '—'
        }${demand.state ? `, ${demand.state}` : ''}`}
        back={{ to: goBack() || '/', label: 'Back' }}
        actions={<DemandStatusBadge status={demand.status} />}
      />

      {/* Demand hero (with crop tile) */}
      <section className="ac-card mb-6 overflow-hidden p-0">
        <div className="grid gap-0 md:grid-cols-[200px_1fr]">
          <div className="h-40 md:h-full">
            <CropImage
              crop={demand.crop_name}
              className="h-full w-full"
            />
          </div>
          <div className="p-5 sm:p-6">
            <h2 className="font-display text-2xl text-ink-900">
              {demand.crop_name}
              {demand.crop_variety ? (
                <span className="ml-2 text-base font-normal text-ink-500">
                  · {demand.crop_variety}
                </span>
              ) : null}
            </h2>
            <p className="mt-1 text-sm text-ink-600">
              Buyer {demand.buyer_public_id} · {demand.location || '—'}
              {demand.state ? `, ${demand.state}` : ''}
            </p>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">
                  Required
                </dt>
                <dd className="mt-0.5 font-display text-base text-ink-900">
                  {demand.quantity_kg} kg
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">
                  Filled
                </dt>
                <dd className="mt-0.5 font-display text-base text-success-700">
                  {demand.filled_quantity_kg} kg
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">
                  Max ₹/kg
                </dt>
                <dd className="mt-0.5 font-display text-base text-ink-900">
                  {demand.max_price_per_kg != null
                    ? `₹${demand.max_price_per_kg}`
                    : '—'}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">
                  Required by
                </dt>
                <dd className="mt-0.5 font-display text-base text-ink-900">
                  {demand.required_date || '—'}
                </dd>
              </div>
            </dl>
            {demand.notes && (
              <p className="mt-3 text-sm text-ink-600">
                <span className="text-xs font-medium text-ink-500">Notes:</span>{' '}
                {demand.notes}
              </p>
            )}
            <p className="mt-3 font-mono text-xs text-ink-400">
              {demand.public_id}
            </p>
            {isBuyer && isCreator && demand.status === 'ACTIVE' && (
              <div className="mt-4 flex flex-wrap gap-2 border-t border-ink-100 pt-4">
                <button
                  onClick={handleClose}
                  disabled={rfqActionStatus === 'loading'}
                  className="ac-btn-danger disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Close demand
                </button>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Make offer (farmer) */}
      {isSeller && demand.status === 'ACTIVE' && (
        <div className="mb-6">
          <MakeOfferForm
            demand={demand}
            onSubmitted={() => {
              dispatch(fetchOffersForRfqDemand(publicId))
              dispatch(fetchRfqDemandById(publicId))
            }}
          />
        </div>
      )}

      {/* Offers list */}
      <section className="ac-card p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="ac-section-label">Offers ({offers.length})</p>
        </div>

        {rfqActionError && (
          <p className="mt-2 text-sm text-rust-700">{rfqActionError}</p>
        )}

        {rfqOffersStatus === 'loading' && (
          <p className="mt-3 text-sm text-ink-500">Loading offers…</p>
        )}
        {rfqOffersError && (
          <p className="mt-2 text-sm text-rust-700">{rfqOffersError}</p>
        )}
        {rfqOffersStatus === 'succeeded' && offers.length === 0 && (
          <p className="mt-3 text-sm text-ink-500">
            No offers yet. Be the first to submit one.
          </p>
        )}

        {offers.length > 0 && (
          <ul className="mt-4 space-y-3">
            {offers.map((o) => {
              if (!o || !o.public_id) return null
              const isActive = activeOffer === o.public_id
              const canActOnOffer =
                isBuyer &&
                isCreator &&
                demand.status === 'ACTIVE' &&
                (o.status === 'OPEN' || o.status === 'COUNTERED')
              return (
                <li
                  key={o.public_id}
                  className="rounded-card border border-ink-100 bg-earth-50 p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-display text-base text-ink-900">
                        ₹{o.current_price}/kg · {o.current_quantity} kg
                      </p>
                      <p className="text-xs text-ink-500">
                        by {o.farmer_user_public_id || 'farmer'} ·{' '}
                        {new Date(o.created_at).toLocaleString()}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <OfferStatusBadge status={o.status} />
                      {o.deal_public_id && (
                        <Link
                          to={
                            isSeller
                              ? `/farmer/deals/${o.deal_public_id}`
                              : `/buyer/deals/${o.deal_public_id}`
                          }
                          className="rounded-full bg-success-100 px-3 py-1 text-xs font-semibold text-success-700 transition hover:bg-success-200"
                        >
                          View deal →
                        </Link>
                      )}
                    </div>
                  </div>

                  {Array.isArray(o.messages) && o.messages.length > 0 && (
                    <ul className="mt-3 space-y-1.5 border-t border-ink-100 pt-2 text-xs text-ink-700">
                      {o.messages.map((m, idx) => (
                        <li key={idx} className="flex items-start gap-2">
                          <AuthorTag author={m.author} />
                          <span className="flex-1">
                            {m.message}
                            {m.price != null && (
                              <span className="ml-1 text-ink-500">
                                @ ₹{m.price}/kg · {m.quantity}kg
                              </span>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {canActOnOffer && (
                    <div className="mt-3 flex flex-wrap gap-2 border-t border-ink-100 pt-3">
                      <button
                        onClick={() => handleAccept(o.public_id)}
                        className="ac-btn-primary"
                      >
                        Accept
                      </button>
                      <button
                        onClick={() => handleReject(o.public_id)}
                        className="ac-btn-danger"
                      >
                        Reject
                      </button>
                      <button
                        onClick={() =>
                          setActiveOffer(isActive ? null : o.public_id)
                        }
                        className="ac-btn-secondary"
                      >
                        {isActive ? 'Cancel' : 'Counter'}
                      </button>
                      <Link
                        to={
                          isSeller
                            ? `/farmer/offers/${o.public_id}`
                            : `/buyer/offers/${o.public_id}`
                        }
                        className="ac-btn-ghost"
                      >
                        Open detail →
                      </Link>
                    </div>
                  )}

                  {canActOnOffer && isActive && (
                    <div className="mt-3 rounded-card border border-honey-200 bg-honey-50 p-3">
                      <p className="text-xs font-medium text-honey-800">
                        Send a counter
                      </p>
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        <input
                          type="number"
                          min="0.01"
                          step="0.01"
                          value={counterPrice}
                          onChange={(e) => setCounterPrice(e.target.value)}
                          placeholder={`price (was ₹${o.current_price})`}
                          className={INPUT}
                        />
                        <input
                          type="number"
                          min="1"
                          value={counterQuantity}
                          onChange={(e) =>
                            setCounterQuantity(e.target.value)
                          }
                          placeholder={`qty (was ${o.current_quantity})`}
                          className={INPUT}
                        />
                      </div>
                      <textarea
                        rows={2}
                        value={counterMessage}
                        onChange={(e) => setCounterMessage(e.target.value)}
                        placeholder="Message (optional)"
                        className={INPUT + ' mt-2'}
                      />
                      <button
                        onClick={() => handleCounter(o.public_id)}
                        className="ac-btn-primary mt-2"
                      >
                        Send counter
                      </button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </>
  )
}

export default DemandDetails
