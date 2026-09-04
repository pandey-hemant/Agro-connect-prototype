/**
 * Offers.jsx — per-lot offers list (the buyer's offers on ONE of
 * the farmer's crop lots).
 *
 * Mounted at /seller/crop-lots/:publicId/offers (and the legacy
 * /farmer/crop-lots/:publicId/offers). Business logic preserved
 * verbatim — the lot fetch, the offers fetch, the link-through
 * to the offer detail. The chrome is the redesigned shell.
 *
 * For the "all my offers across all lots" view, see MyOffersIndex.
 */
import { useEffect } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { Link, useParams } from 'react-router-dom'
import { fetchCropLotById } from '../redux/slices/cropLotSlice.js'
import { fetchOffers } from '../redux/slices/offerSlice.js'
import { fmtInr, fmtPerKg, fmtKg } from '../utils/format.js'
import PageHeader from '../components/PageHeader.jsx'
import CropImage from '../components/CropImage.jsx'
import EmptyState from '../components/EmptyState.jsx'
import OfferComparison from '../components/OfferComparison.jsx'
import usePageMeta from '../hooks/usePageMeta.js'

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

function Offers() {
  const { publicId } = useParams()
  const dispatch = useDispatch()
  const { currentLot, detailStatus } = useSelector((state) => state.cropLots)
  usePageMeta({
    title: 'Offers',
    description: 'Every offer buyers have sent on this crop lot.',
  })
  const { list, listStatus, listError } = useSelector((state) => state.offers)

  const lotIdNum = currentLot?.id

  useEffect(() => {
    if (publicId) dispatch(fetchCropLotById(publicId))
  }, [dispatch, publicId])

  useEffect(() => {
    if (lotIdNum) dispatch(fetchOffers(lotIdNum))
  }, [dispatch, lotIdNum])

  return (
    <>
      <PageHeader
        eyebrow={currentLot ? currentLot.crop_name : 'Selling'}
        title="Offers"
        subtitle={
          currentLot
            ? `Every offer buyers have sent on ${currentLot.crop_name} · ${currentLot.quantity} ${currentLot.quantity_unit}.`
            : 'Every offer buyers have sent on this lot.'
        }
        back={{ to: `/seller/crop-lots/${publicId}`, label: 'Back to lot' }}
        actions={
          <Link
            to={`/seller/crop-lots/${publicId}/buyers`}
            className="ac-btn-secondary"
          >
            Match buyers
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

      {detailStatus === 'loading' && (
        <div className="ac-card p-8 text-center text-sm text-ink-500">
          Loading lot…
        </div>
      )}

      {listStatus === 'loading' && (
        <div className="ac-card p-8 text-center text-sm text-ink-500">
          Loading offers…
        </div>
      )}
      {listError && (
        <div className="mb-4 rounded-card border border-rust-200 bg-rust-50 p-4 text-sm text-rust-800">
          {listError}
        </div>
      )}

      {listStatus === 'succeeded' && list.length === 0 && (
        <EmptyState
          kind="empty"
          title="No offers yet"
          description="When buyers make an offer on this lot, it will appear here. You can also match buyers yourself and send the first offer."
          action={
            <Link
              to={`/seller/crop-lots/${publicId}/buyers`}
              className="ac-btn-primary"
            >
              Match buyers
            </Link>
          }
        />
      )}

      {listStatus === 'succeeded' && list.length > 0 && (
        <>
          <OfferComparison
            lot={currentLot}
            offers={list.map((o) => ({
              public_id: o.public_id,
              price: o.current_price,
              quantity: o.current_quantity,
              status: o.status,
              message: o.last_message,
              createdAt: o.created_at,
              buyer_name: o.buyer?.name,
            }))}
          />
          <ul className="ac-stagger mt-4 space-y-3">
          {list.map((o) => {
            const tone = STATUS_TONE[o.status] || STATUS_TONE.OPEN
            const label = STATUS_LABEL[o.status] || o.status
            return (
              <li key={o.public_id}>
                <Link
                  to={`/seller/offers/${o.public_id}`}
                  className="ac-card ac-card-hover flex flex-wrap items-center justify-between gap-3 p-4"
                >
                  <div className="min-w-0">
                    <p className="text-xs uppercase tracking-wide text-ink-500">
                      From {o.buyer?.name || o.buyer_public_id}
                    </p>
                    <p className="mt-0.5 font-display text-xl text-ink-900">
                      {fmtInr(o.current_price)}
                      <span className="ml-2 text-sm font-normal text-ink-500">
                        {fmtPerKg(o.current_price, currentLot?.quantity_unit)}
                      </span>
                    </p>
                    <p className="text-xs text-ink-500">
                      Qty:{' '}
                      {fmtKg(o.current_quantity, currentLot?.quantity_unit)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span
                      className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${tone}`}
                    >
                      {label}
                    </span>
                    <span className="hidden text-xs text-ink-400 sm:inline">
                      Open →
                    </span>
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
        </>
      )}
    </>
  )
}

export default Offers
