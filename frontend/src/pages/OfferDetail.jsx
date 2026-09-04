/**
 * OfferDetail.jsx — counter / accept / reject an offer.
 *
 * Mounted at /seller/offers/:publicId (and the legacy
 * /farmer/offers/:publicId). The full offer lifecycle is here:
 * the current price, the message log, the counter form, accept,
 * reject. Business logic preserved verbatim — same dispatch chain,
 * same redirect to /deals after accept, same clearAction on
 * unmount. The chrome is the redesigned shell.
 *
 * Trust signal: the current_price block uses the shared `ac-card`
 * + `font-display` typography so the headline number reads as the
 * commitment, not as a label. The status chip in the page header
 * mirrors the legacy table tone.
 */
import { useEffect, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { useParams, useNavigate } from 'react-router-dom'
import {
  fetchOfferById,
  counterOffer,
  acceptOffer,
  rejectOffer,
  clearAction,
} from '../redux/slices/offerSlice.js'
import { fmtInr } from '../utils/format.js'
import PageHeader from '../components/PageHeader.jsx'
import CropImage from '../components/CropImage.jsx'
import usePageMeta from '../hooks/usePageMeta.js'

const INPUT =
  'w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500'

const STATUS_TONE = {
  OPEN: 'bg-honey-100 text-honey-800',
  COUNTERED: 'bg-primary-100 text-primary-800',
  ACCEPTED: 'bg-success-100 text-success-700',
  REJECTED: 'bg-rust-100 text-rust-800',
  FINALIZED: 'bg-primary-100 text-primary-800',
  CANCELLED: 'bg-ink-100 text-ink-700',
}

const STATUS_LABEL = {
  OPEN: 'Open',
  COUNTERED: 'Countered',
  ACCEPTED: 'Accepted',
  REJECTED: 'Rejected',
  FINALIZED: 'Finalized',
  CANCELLED: 'Cancelled',
}

function OfferDetail() {
  const { publicId } = useParams()
  const dispatch = useDispatch()
  usePageMeta({
    title: 'Offer',
    description: 'Counter, accept, or reject this offer. View the full message log and current terms.',
  })
  const navigate = useNavigate()
  const {
    current,
    detailStatus,
    detailError,
    actionStatus,
    actionError,
    lastDeal,
  } = useSelector((state) => state.offers)

  const [showCounter, setShowCounter] = useState(false)
  const [counter, setCounter] = useState({
    actor: 'FARMER',
    price: '',
    quantity: '',
    message: '',
  })
  const [rejectReason, setRejectReason] = useState('')

  useEffect(() => {
    dispatch(fetchOfferById(publicId))
    return () => {
      dispatch(clearAction())
    }
  }, [dispatch, publicId])

  useEffect(() => {
    if (lastDeal?.public_id) {
      navigate(`/seller/deals/${lastDeal.public_id}`)
    }
  }, [lastDeal, navigate])

  const handleCounter = (e) => {
    e.preventDefault()
    dispatch(
      counterOffer({
        publicId,
        actor: counter.actor,
        price: Number(counter.price),
        quantity: Number(counter.quantity),
        message: counter.message || undefined,
      })
    ).then((action) => {
      if (action.meta.requestStatus === 'succeeded') setShowCounter(false)
    })
  }

  const handleAccept = () => {
    dispatch(acceptOffer({ publicId, actor: 'FARMER' }))
  }

  const handleReject = () => {
    dispatch(
      rejectOffer({ publicId, actor: 'FARMER', message: rejectReason || undefined })
    )
  }

  if (detailStatus === 'loading') {
    return (
      <>
        <PageHeader eyebrow="Selling" title="Offer" subtitle="Loading offer…" />
        <div className="ac-card p-8 text-center text-sm text-ink-500">
          Loading offer…
        </div>
      </>
    )
  }
  if (detailStatus === 'failed') {
    return (
      <>
        <PageHeader eyebrow="Selling" title="Offer" />
        <div className="mb-4 rounded-card border border-rust-200 bg-rust-50 p-4 text-sm text-rust-800">
          {detailError}
        </div>
      </>
    )
  }
  if (!current) return null

  const lot = current.crop_lot || {}
  const statusLabel = STATUS_LABEL[current.status] || current.status
  const statusTone = STATUS_TONE[current.status] || STATUS_TONE.OPEN

  return (
    <>
      <PageHeader
        eyebrow={lot.crop_name || 'Selling'}
        title={`Offer from ${current.buyer?.name || 'buyer'}`}
        subtitle={
          lot.crop_name
            ? `For ${lot.crop_name}${lot.crop_variety ? ` · ${lot.crop_variety}` : ''} · ${lot.quantity || ''} ${lot.quantity_unit || ''}`
            : 'Counter, accept, or reject this offer.'
        }
        back={{ to: '/seller/offers', label: 'All offers' }}
        actions={
          lot.public_id && (
            <span
              className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${statusTone}`}
            >
              {statusLabel}
            </span>
          )
        }
      />

      {lot.crop_name && (
        <div className="ac-card mb-6 flex items-center gap-4 p-4">
          <CropImage
            crop={lot.crop_name}
            label={lot.crop_name}
            className="h-14 w-14 flex-shrink-0 rounded-lg"
          />
          <div className="min-w-0">
            <p className="truncate font-display text-base text-ink-900">
              {lot.crop_name}
              {lot.crop_variety ? ` · ${lot.crop_variety}` : ''}
            </p>
            <p className="truncate text-xs text-ink-500">
              {lot.location || '—'} · {lot.quantity} {lot.quantity_unit}
            </p>
          </div>
        </div>
      )}

      <section className="ac-card mb-6 p-5">
        <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
          Current price
        </p>
        <p className="mt-1 font-display text-3xl text-ink-900">
          {fmtInr(current.current_price)}
        </p>
        <p className="mt-1 text-sm text-ink-600">
          Quantity: <strong className="text-ink-800">{current.current_quantity}</strong>
        </p>
        {current.crop_lot?.public_id && (
          <p className="mt-2 text-xs text-ink-500">
            Lot:{' '}
            <a
              href={`/seller/crop-lots/${current.crop_lot.public_id}`}
              className="text-primary-700 hover:underline"
            >
              {current.crop_lot.public_id}
            </a>
          </p>
        )}
      </section>

      {['OPEN', 'COUNTERED'].includes(current.status) && (
        <section className="ac-card mb-6 p-5">
          <h2 className="font-display text-lg text-ink-900">Actions</h2>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              onClick={() => setShowCounter((v) => !v)}
              className="ac-btn-secondary"
            >
              {showCounter ? 'Close counter' : 'Counter'}
            </button>
            <button
              onClick={handleAccept}
              disabled={actionStatus === 'loading'}
              className="ac-btn-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              Accept
            </button>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Reject reason (optional)"
                className={INPUT + ' w-56'}
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
            <p className="mt-3 text-sm text-rust-700">{actionError}</p>
          )}
          {showCounter && (
            <form onSubmit={handleCounter} className="mt-4 space-y-3 border-t border-ink-100 pt-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-ink-700">
                    Actor
                  </label>
                  <select
                    value={counter.actor}
                    onChange={(e) =>
                      setCounter({ ...counter, actor: e.target.value })
                    }
                    className={INPUT}
                  >
                    <option value="FARMER">Farmer</option>
                    <option value="BUYER">Buyer</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-ink-700">
                    Counter price
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={counter.price}
                    onChange={(e) =>
                      setCounter({ ...counter, price: e.target.value })
                    }
                    className={INPUT}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-ink-700">
                    Counter qty
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={counter.quantity}
                    onChange={(e) =>
                      setCounter({ ...counter, quantity: e.target.value })
                    }
                    className={INPUT}
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-ink-700">
                  Message (optional)
                </label>
                <textarea
                  rows={2}
                  value={counter.message}
                  onChange={(e) =>
                    setCounter({ ...counter, message: e.target.value })
                  }
                  className={INPUT}
                />
              </div>
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

      <section className="ac-card p-5">
        <h2 className="font-display text-lg text-ink-900">Messages</h2>
        {current.messages && current.messages.length > 0 ? (
          <ol className="mt-3 space-y-2">
            {current.messages.map((m) => (
              <li
                key={m.id}
                className="rounded-card border border-ink-100 bg-earth-50 p-3 text-sm"
              >
                <div className="flex flex-wrap items-center gap-2 text-xs text-ink-500">
                  <span className="font-semibold text-ink-700">{m.actor}</span>
                  <span>· {m.action}</span>
                  <span>· {new Date(m.created_at).toLocaleString()}</span>
                </div>
                {m.price && (
                  <p className="mt-1 text-ink-800">
                    Price: <strong>{fmtInr(m.price)}</strong>
                  </p>
                )}
                {m.quantity && (
                  <p className="text-ink-800">Qty: <strong>{m.quantity}</strong></p>
                )}
                {m.message && (
                  <p className="mt-1 text-ink-700">{m.message}</p>
                )}
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-3 text-sm text-ink-500">No messages yet.</p>
        )}
      </section>
    </>
  )
}

export default OfferDetail
