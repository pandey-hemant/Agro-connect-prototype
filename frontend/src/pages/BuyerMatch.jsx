/**
 * BuyerMatch.jsx — rule-based buyer match list for one crop lot.
 *
 * Mounted at /seller/crop-lots/:publicId/buyers (and the legacy
 * /farmer/crop-lots/:publicId/buyers). The business logic — the
 * match dispatch, the score bar, the "send offer" modal, the
 * redirect to a fresh deal — is preserved verbatim. The chrome is
 * the redesigned application shell.
 *
 * Trust signal: the score is always labelled "Rule-based" with
 * the 0–100 range stated up front. The match explanation is shown
 * verbatim so the farmer can see why a buyer was suggested.
 */
import { useEffect, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { fetchCropLotById } from '../redux/slices/cropLotSlice.js'
import { matchBuyers } from '../redux/slices/buyerSlice.js'
import { createOffer, clearAction } from '../redux/slices/offerSlice.js'
import PageHeader from '../components/PageHeader.jsx'
import CropImage from '../components/CropImage.jsx'
import PriceTrendChart from '../components/PriceTrendChart.jsx'
import MandiMap from '../components/MandiMap.jsx'
import usePageMeta from '../hooks/usePageMeta.js'

const INPUT =
  'w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500'

function scoreTone(score) {
  if (score >= 70) return 'bg-success-500'
  if (score >= 40) return 'bg-honey-500'
  return 'bg-rust-500'
}

function ScoreBar({ score }) {
  return (
    <div className="h-2 w-28 overflow-hidden rounded-full bg-ink-100">
      <div
        className={`h-full ${scoreTone(score)}`}
        style={{ width: `${Math.min(100, score)}%` }}
      />
    </div>
  )
}

function BuyerMatch() {
  const { publicId } = useParams()
  const dispatch = useDispatch()
  usePageMeta({
    title: 'Matched buyers',
    description: 'Rule-based buyer matches for this crop lot. Each match shows a 0–100 score and reasoning.',
  })
  const navigate = useNavigate()
  const { currentLot, detailStatus } = useSelector((state) => state.cropLots)
  const {
    matches,
    matchStatus,
    matchError,
    actionStatus,
    actionError,
    lastDeal,
  } = useSelector((state) => state.offers)

  const lotIdNum = currentLot?.id

  const [offerModal, setOfferModal] = useState(null)
  const [offerError, setOfferError] = useState(null)

  useEffect(() => {
    if (publicId) dispatch(fetchCropLotById(publicId))
  }, [dispatch, publicId])

  useEffect(() => {
    if (lotIdNum) dispatch(matchBuyers(lotIdNum))
  }, [dispatch, lotIdNum])

  useEffect(() => {
    return () => {
      dispatch(clearAction())
    }
  }, [dispatch])

  useEffect(() => {
    if (lastDeal?.public_id) {
      navigate(`/seller/deals/${lastDeal.public_id}`)
    }
  }, [lastDeal, navigate])

  const openOfferModal = (buyer) => {
    setOfferError(null)
    setOfferModal({
      buyer,
      price: '',
      quantity: currentLot?.quantity || '',
      message: '',
    })
  }

  const submitOffer = (e) => {
    e.preventDefault()
    if (!offerModal || !lotIdNum) return
    const price = Number(offerModal.price)
    const quantity = Number(offerModal.quantity)
    if (!price || !quantity) {
      setOfferError('Price and quantity are required.')
      return
    }
    dispatch(
      createOffer({
        crop_lot_id: lotIdNum,
        buyer_id: offerModal.buyer.id,
        price,
        quantity,
        message: offerModal.message || undefined,
      })
    ).then((action) => {
      if (action.meta.requestStatus === 'rejected') {
        setOfferError(action.payload || 'Failed to send offer')
      } else {
        setOfferModal(null)
      }
    })
  }

  return (
    <>
      <PageHeader
        eyebrow={currentLot ? currentLot.crop_name : 'Selling'}
        title="Matched buyers"
        subtitle={
          currentLot
            ? `Buyers that match ${currentLot.crop_name} · ${currentLot.quantity} ${currentLot.quantity_unit}. Score is rule-based (0–100) — not an AI prediction.`
            : 'Score is rule-based (0–100) — not an AI prediction.'
        }
        back={{ to: `/seller/crop-lots/${publicId}`, label: 'Back to lot' }}
        actions={
          <Link
            to={`/seller/crop-lots/${publicId}/decision`}
            className="ac-btn-secondary"
          >
            Decision support
          </Link>
        }
      />

      {currentLot && (
        <div className="ac-card mb-6 flex items-center gap-4 p-4">
          <CropImage
            crop={currentLot.crop_name}
            label={currentLot.crop_name}
            className="h-14 w-14 flex-shrink-0 rounded-lg"
          />
          <div className="min-w-0">
            <p className="truncate font-display text-base text-ink-900">
              {currentLot.crop_name}
              {currentLot.crop_variety ? ` · ${currentLot.crop_variety}` : ''}
            </p>
            <p className="truncate text-xs text-ink-500">
              {currentLot.location || '—'} · {currentLot.quantity}{' '}
              {currentLot.quantity_unit}
            </p>
          </div>
        </div>
      )}

      {currentLot && (
        <div className="mb-6 grid gap-6 lg:grid-cols-2">
          <PriceTrendChart
            crop={currentLot.crop_name}
            state={currentLot.state || undefined}
            height={200}
          />
          <MandiMap
            crop={currentLot.crop_name}
            state={currentLot.state || undefined}
            lot={currentLot}
          />
        </div>
      )}

      {detailStatus === 'loading' && (
        <div className="ac-card p-8 text-center text-sm text-ink-500">
          Loading lot…
        </div>
      )}

      {matchStatus === 'loading' && (
        <div className="ac-card p-8 text-center text-sm text-ink-500">
          Matching buyers…
        </div>
      )}
      {matchError && (
        <div className="mb-4 rounded-card border border-rust-200 bg-rust-50 p-4 text-sm text-rust-800">
          {matchError}
        </div>
      )}

      {matchStatus === 'succeeded' && matches && (
        <div className="ac-stagger space-y-3">
          {matches.length === 0 && (
            <div className="ac-card p-6 text-sm text-ink-600">
              No buyers matched. Seed sample buyers or refine the lot.
            </div>
          )}
          {matches.map((m) => (
            <article key={m.buyer.public_id} className="ac-card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="flex flex-wrap items-center gap-2 font-display text-lg text-ink-900">
                    {m.buyer.name}
                    {m.buyer.is_demo && (
                      <span className="ac-chip ac-chip-ink">Sample</span>
                    )}
                    {m.buyer.verification_status === 'VERIFIED' && (
                      <span className="ac-chip ac-chip-success">Verified</span>
                    )}
                  </h2>
                  <p className="mt-0.5 text-sm text-ink-600">
                    {m.buyer.location}
                    {m.buyer.state ? ` · ${m.buyer.state}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-display text-2xl text-ink-900">
                    {m.score}
                  </span>
                  <ScoreBar score={m.score} />
                </div>
              </div>
              <p className="mt-2 text-xs text-ink-500">
                {m.match_explanation}
              </p>
              {m.reasons?.length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-1.5 text-xs">
                  {m.reasons.map((r, i) => (
                    <li
                      key={i}
                      className="rounded-full bg-primary-50 px-2.5 py-0.5 text-primary-800"
                    >
                      {r}
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-4">
                <button
                  onClick={() => openOfferModal(m.buyer)}
                  className="ac-btn-primary"
                >
                  Send offer
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {offerModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/40 p-4">
          <form
            onSubmit={submitOffer}
            className="w-full max-w-md rounded-card border border-ink-200 bg-white p-5 shadow-xl"
          >
            <h3 className="font-display text-lg text-ink-900">
              Send offer to {offerModal.buyer.name}
            </h3>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-ink-700">
                  Price/quintal
                </label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={offerModal.price}
                  onChange={(e) =>
                    setOfferModal({ ...offerModal, price: e.target.value })
                  }
                  className={INPUT}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-ink-700">
                  Quantity
                </label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={offerModal.quantity}
                  onChange={(e) =>
                    setOfferModal({ ...offerModal, quantity: e.target.value })
                  }
                  className={INPUT}
                />
              </div>
            </div>
            <div className="mt-3">
              <label className="mb-1 block text-xs font-medium text-ink-700">
                Message (optional)
              </label>
              <textarea
                rows={2}
                value={offerModal.message}
                onChange={(e) =>
                  setOfferModal({ ...offerModal, message: e.target.value })
                }
                className={INPUT}
              />
            </div>
            {offerError && (
              <p className="mt-2 text-sm text-rust-700">{offerError}</p>
            )}
            {actionError && (
              <p className="mt-2 text-sm text-rust-700">{actionError}</p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOfferModal(null)}
                className="ac-btn-ghost"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={actionStatus === 'loading'}
                className="ac-btn-primary disabled:cursor-not-allowed disabled:opacity-50"
              >
                {actionStatus === 'loading' ? 'Sending…' : 'Send offer'}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  )
}

export default BuyerMatch
