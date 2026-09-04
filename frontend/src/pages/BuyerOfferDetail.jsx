import { useEffect, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  fetchOfferById,
  counterOffer,
  acceptOffer,
  rejectOffer,
  clearAction,
} from '../redux/slices/offerSlice.js'
import { selectActiveBuyer, selectIsBuyer } from '../redux/slices/authSlice.js'
import PageHeader from '../components/PageHeader.jsx'
import usePageMeta from '../hooks/usePageMeta.js'

function BuyerOfferDetail() {
  const { publicId } = useParams()
  const dispatch = useDispatch()
  const navigate = useNavigate()
  usePageMeta({
    title: 'Offer',
    description: 'View, counter, accept, or reject the offer the farmer sent on your demand.',
  })
  const activeBuyer = useSelector(selectActiveBuyer)
  const isBuyer = useSelector(selectIsBuyer)
  const { current, detailStatus, detailError, actionStatus, actionError, lastDeal } =
    useSelector((s) => s.offers)

  const [showCounter, setShowCounter] = useState(false)
  const [counter, setCounter] = useState({ price: '', quantity: '', message: '' })
  const [rejectReason, setRejectReason] = useState('')

  useEffect(() => {
    if (!isBuyer) {
      navigate('/role', { replace: true })
    }
  }, [dispatch, isBuyer, navigate])

  useEffect(() => {
    dispatch(fetchOfferById(publicId))
    return () => { dispatch(clearAction()) }
  }, [dispatch, publicId])

  useEffect(() => {
    if (lastDeal?.public_id) {
      navigate(`/buyer/deals/${lastDeal.public_id}`)
    }
  }, [lastDeal, navigate])

  const handleCounter = (e) => {
    e.preventDefault()
    dispatch(counterOffer({
      publicId,
      actor: 'BUYER',
      price: Number(counter.price),
      quantity: Number(counter.quantity),
      message: counter.message || undefined,
    })).then((action) => {
      if (action.meta.requestStatus === 'succeeded') setShowCounter(false)
    })
  }

  const handleAccept = () => {
    dispatch(acceptOffer({ publicId, actor: 'BUYER' }))
  }

  const handleReject = () => {
    dispatch(rejectOffer({ publicId, actor: 'BUYER', message: rejectReason || undefined }))
  }

  if (detailStatus === 'loading') {
    return (
      <div className="p-8 text-center text-sm text-ink-500">Loading offer…</div>
    )
  }
  if (detailStatus === 'failed') {
    return (
      <div className="p-8 text-sm text-rust-700">{detailError}</div>
    )
  }
  if (!current) return null

  // Only the owning buyer can act
  const isOwn = current.buyer?.id && activeBuyer?.id &&
    Number(current.buyer.id) === Number(activeBuyer.id)
  const canAct = isOwn && ['OPEN', 'COUNTERED'].includes(current.status)

  return (
    <>
      <PageHeader
        eyebrow="Buying"
        title="Offer"
        description={`For crop lot #${current.crop_lot_id} · Status: ${current.status}`}
        back={{ to: '/buyer/offers', label: 'My offers' }}
      />
      <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">

        <section className="ac-card p-5">
          <p className="text-sm text-ink-600">Current price</p>
          <p className="font-display text-2xl font-bold text-ink-900">₹{current.current_price}</p>
          <p className="text-sm text-ink-600">
            Quantity: <strong>{current.current_quantity}</strong>
          </p>
        </section>

        {canAct && (
          <section className="mt-4 ac-card p-5">
            <h2 className="font-display text-lg text-ink-900">Your actions</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={() => setShowCounter((v) => !v)}
                className="rounded-lg border border-primary-200 bg-white px-3 py-1.5 text-sm font-medium text-primary-700 transition hover:bg-primary-50"
              >
                Counter
              </button>
              <button
                onClick={handleAccept}
                disabled={actionStatus === 'loading'}
                className="ac-btn-primary disabled:cursor-not-allowed disabled:opacity-50"
              >
                Accept this price
              </button>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="Reject reason (optional)"
                  className="rounded-lg border border-ink-200 bg-white px-2 py-1 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                />
                <button
                  onClick={handleReject}
                  disabled={actionStatus === 'loading'}
                  className="ac-btn-danger disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Reject
                </button>
              </div>
            </div>
            {actionError && (
              <p className="mt-2 text-sm text-rust-700">{actionError}</p>
            )}
            {showCounter && (
              <form onSubmit={handleCounter} className="mt-3 space-y-2">
                <div className="grid gap-2 sm:grid-cols-2">
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={counter.price}
                    onChange={(e) => setCounter({ ...counter, price: e.target.value })}
                    placeholder="Counter price"
                    className="rounded-lg border border-ink-200 bg-white px-2 py-1.5 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                  />
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={counter.quantity}
                    onChange={(e) => setCounter({ ...counter, quantity: e.target.value })}
                    placeholder="Counter qty"
                    className="rounded-lg border border-ink-200 bg-white px-2 py-1.5 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                  />
                </div>
                <textarea
                  rows={2}
                  value={counter.message}
                  onChange={(e) => setCounter({ ...counter, message: e.target.value })}
                  placeholder="Message (optional)"
                  className="w-full rounded-lg border border-ink-200 bg-white px-2 py-1.5 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                />
                <button
                  type="submit"
                  disabled={actionStatus === 'loading'}
                  className="ac-btn-primary disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Send counter
                </button>
              </form>
            )}
          </section>
        )}

        {!isOwn && (
          <div className="mt-4 rounded-card border border-honey-200 bg-honey-50 p-3 text-sm text-honey-800">
            You are viewing this offer as a different buyer identity ({activeBuyer?.name || 'none'}).
            Switch to <strong>{current.buyer?.name}</strong> on the buyer dashboard to take actions.
          </div>
        )}

        <section className="mt-4 ac-card p-5">
          <h2 className="font-display text-lg text-ink-900">Messages</h2>
          <ol className="mt-3 space-y-2">
            {current.messages?.map((m) => (
              <li
                key={m.id}
                className={`rounded-lg border p-3 text-sm ${
                  m.actor === 'BUYER'
                    ? 'border-primary-100 bg-primary-50'
                    : m.actor === 'SYSTEM'
                      ? 'border-earth-200 bg-earth-50 italic text-ink-600'
                      : 'border-honey-100 bg-honey-50'
                }`}
              >
                <div className="flex items-center gap-2 text-xs text-ink-500">
                  <span className="font-semibold text-ink-700">{m.actor}</span>
                  <span>· {m.action}</span>
                  <span>· {new Date(m.created_at).toLocaleString()}</span>
                </div>
                {m.price && <p className="mt-1">Price: <strong>₹{m.price}</strong></p>}
                {m.quantity && <p>Qty: <strong>{m.quantity}</strong></p>}
                {m.message && <p className="mt-1 text-ink-700">{m.message}</p>}
              </li>
            ))}
          </ol>
        </section>
      </main>
    </>
  )
}

export default BuyerOfferDetail
