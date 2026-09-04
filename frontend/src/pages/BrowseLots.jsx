import { useEffect, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { Link, useNavigate } from 'react-router-dom'
import { fetchAvailableCropLots } from '../redux/slices/cropLotSlice.js'
import { selectActiveBuyer, selectIsBuyer } from '../redux/slices/authSlice.js'
import { createOffer, clearAction } from '../redux/slices/offerSlice.js'
import PageHeader from '../components/PageHeader.jsx'
import CropImage from '../components/CropImage.jsx'
import EmptyState from '../components/EmptyState.jsx'
import FarmerCard from '../components/FarmerCard.jsx'
import usePageMeta from '../hooks/usePageMeta.js'

function BrowseLots() {
  const dispatch = useDispatch()
  const navigate = useNavigate()
  usePageMeta({
    title: 'Marketplace',
    description: 'Browse all active crop lots and place offers on produce you want to buy.',
  })
  const isBuyer = useSelector(selectIsBuyer)
  const activeBuyer = useSelector(selectActiveBuyer)
  const { list, listStatus, listError } = useSelector((s) => s.cropLots)
  const { actionStatus, actionError, lastDeal } = useSelector((s) => s.offers)

  const [cropFilter, setCropFilter] = useState('')
  const [stateFilter, setStateFilter] = useState('')
  const [offerModal, setOfferModal] = useState(null)
  const [offerError, setOfferError] = useState(null)

  useEffect(() => {
    if (!isBuyer) {
      navigate('/role', { replace: true })
    }
  }, [dispatch, isBuyer, navigate])

  useEffect(() => {
    dispatch(fetchAvailableCropLots({
      ...(cropFilter ? { crop: cropFilter } : {}),
      ...(stateFilter ? { state: stateFilter } : {}),
    }))
  }, [dispatch, cropFilter, stateFilter])

  useEffect(() => {
    return () => { dispatch(clearAction()) }
  }, [dispatch])

  useEffect(() => {
    if (lastDeal?.public_id) {
      navigate(`/buyer/deals/${lastDeal.public_id}`)
    }
  }, [lastDeal, navigate])

  const openOffer = (lot) => {
    setOfferError(null)
    setOfferModal({
      lot,
      price: '',
      quantity: lot.quantity,
      message: '',
    })
  }

  const submitOffer = (e) => {
    e.preventDefault()
    if (!offerModal || !activeBuyer?.id) {
      setOfferError('Select a buyer identity from the dashboard first.')
      return
    }
    const price = Number(offerModal.price)
    const quantity = Number(offerModal.quantity)
    if (!price || !quantity) {
      setOfferError('Price and quantity are required.')
      return
    }
    dispatch(createOffer({
      crop_lot_id: offerModal.lot.id,
      buyer_id: activeBuyer.id,
      price,
      quantity,
      message: offerModal.message || undefined,
    })).then((action) => {
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
        eyebrow="Buying"
        title="Browse marketplace"
        description="All ACTIVE crop lots from farmers. Pick one to make an offer."
        back={{ to: '/buyer', label: 'Back to dashboard' }}
        actions={
          <Link to="/buyer/demands/new" className="ac-btn-secondary">
            + New demand
          </Link>
        }
      />
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">

        {!activeBuyer && (
          <div className="mb-4 rounded-card border border-honey-200 bg-honey-50 p-3 text-sm text-honey-800">
            No active buyer selected. <Link to="/buyer" className="font-medium underline">Pick a buyer first</Link> to send offers.
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
            placeholder="Filter by state (e.g. Bihar)"
            className="rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
        </div>

        {listStatus === 'loading' && (
          <div className="ac-card p-8 text-center text-sm text-ink-500">
            Loading available crop lots…
          </div>
        )}
        {listStatus === 'failed' && (
          <EmptyState
            kind="error"
            title="Could not load marketplace"
            description={listError || 'Please retry.'}
            action={
              <button
                onClick={() => dispatch(fetchAvailableCropLots({}))}
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
            title="No available lots"
            description="Try changing filters, or check back later."
          />
        )}

        {listStatus === 'succeeded' && list.length > 0 && (
          <div className="ac-stagger grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {list.map((lot) => (
              <article
                key={lot.public_id}
                className="ac-card ac-card-hover overflow-hidden"
              >
                <CropImage
                  crop={lot.crop_name}
                  label={lot.crop_name}
                  className="h-32 w-full rounded-b-none"
                  showName={false}
                />
                <div className="p-5">
                  <div className="flex items-start justify-between">
                    <div className="min-w-0">
                      <h3 className="truncate font-display text-lg text-ink-900">{lot.crop_name}</h3>
                      {lot.crop_variety && (
                        <p className="truncate text-sm text-ink-500">{lot.crop_variety}</p>
                      )}
                    </div>
                    <span className="rounded-full bg-success-50 px-2 py-0.5 text-xs font-medium text-success-700">
                      {lot.status}
                    </span>
                  </div>
                  <dl className="mt-3 space-y-1 text-sm text-ink-700">
                    <div>📦 <strong>{lot.quantity} {lot.quantity_unit}</strong></div>
                    <div>📍 {lot.location || '—'}</div>
                    {lot.minimum_acceptable_price && (
                      <div>Min ₹{lot.minimum_acceptable_price}/{lot.quantity_unit}</div>
                    )}
                  </dl>
                  <FarmerCard lotPublicId={lot.public_id} layout="row" />
                  <button
                    onClick={() => openOffer(lot)}
                    disabled={!activeBuyer}
                    className="ac-btn-primary mt-4 w-full disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Make offer
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </main>

      {offerModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/40 p-4">
          <form
            onSubmit={submitOffer}
            className="w-full max-w-md rounded-card border border-ink-200 bg-white p-5 shadow-xl"
          >
            <h3 className="font-display text-lg text-ink-900">
              Make offer on {offerModal.lot.crop_name}
            </h3>
            <p className="mt-1 text-xs text-ink-500">
              {offerModal.lot.quantity} {offerModal.lot.quantity_unit} · acting as{' '}
              <strong>{activeBuyer?.name || 'no buyer selected'}</strong>
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <input
                type="number"
                step="0.01"
                required
                value={offerModal.price}
                onChange={(e) => setOfferModal({ ...offerModal, price: e.target.value })}
                placeholder={`Price / ${offerModal.lot.quantity_unit}`}
                className="rounded-lg border border-ink-200 px-2 py-1.5 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
              <input
                type="number"
                step="0.01"
                required
                value={offerModal.quantity}
                onChange={(e) => setOfferModal({ ...offerModal, quantity: e.target.value })}
                placeholder="Quantity"
                className="rounded-lg border border-ink-200 px-2 py-1.5 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              />
            </div>
            <textarea
              rows={2}
              value={offerModal.message}
              onChange={(e) => setOfferModal({ ...offerModal, message: e.target.value })}
              placeholder="Message to farmer (optional)"
              className="mt-2 w-full rounded-lg border border-ink-200 px-2 py-1.5 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
            {offerError && <p className="mt-2 text-sm text-rust-700">{offerError}</p>}
            {actionError && <p className="mt-2 text-sm text-rust-700">{actionError}</p>}
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

export default BrowseLots
