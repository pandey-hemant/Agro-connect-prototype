import { useEffect } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { Link, useNavigate } from 'react-router-dom'
import {
  fetchEnrichedDealsForBuyer,
  fetchEnrichedDealsForSeller,
  clearEnrichedDeal,
} from '../redux/slices/dealSlice.js'
import {
  selectActiveBuyer,
  selectIsBuyer,
  selectIsSeller,
  selectPublicId,
} from '../redux/slices/authSlice.js'
import PageHeader from '../components/PageHeader.jsx'
import usePageMeta from '../hooks/usePageMeta.js'

const DELIVERY_STYLES = {
  PENDING: 'bg-earth-100 text-ink-700',
  PREPARING: 'bg-honey-100 text-honey-800',
  IN_TRANSIT: 'bg-primary-100 text-primary-800',
  DELIVERED: 'bg-success-100 text-success-700',
  COMPLETED: 'bg-success-200 text-success-700',
  DISPUTED: 'bg-rust-100 text-rust-800',
}

const PAYMENT_STYLES = {
  UNPAID: 'bg-earth-100 text-ink-700',
  PARTIAL: 'bg-honey-100 text-honey-800',
  PAID: 'bg-success-100 text-success-700',
  REFUNDED: 'bg-rust-100 text-rust-800',
}

const NEUTRAL_STATUS = 'bg-earth-100 text-ink-700'

function MyDeals() {
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const isBuyer = useSelector(selectIsBuyer)
  usePageMeta({
    title: 'My deals',
    description: 'Track delivery and payment for every deal you are part of — buying or selling.',
  })
  const isSeller = useSelector(selectIsSeller)
  const activeBuyer = useSelector(selectActiveBuyer)
  const farmerPublicId = useSelector(selectPublicId)
  const { enrichedList, enrichedListStatus, enrichedListError } =
    useSelector((s) => s.deals)

  useEffect(() => {
    if (!isBuyer && !isSeller) {
      navigate('/role', { replace: true })
    }
  }, [dispatch, isBuyer, isSeller, navigate])

  useEffect(() => {
    if (isSeller && farmerPublicId) {
      dispatch(fetchEnrichedDealsForSeller(farmerPublicId))
    } else if (isBuyer && activeBuyer?.id) {
      dispatch(fetchEnrichedDealsForBuyer(activeBuyer.id))
    }
    return () => { dispatch(clearEnrichedDeal()) }
  }, [dispatch, isBuyer, isSeller, activeBuyer?.id, farmerPublicId])

  const title = isSeller ? 'My Deals' : 'My Purchases'
  const sub = isSeller
    ? 'Deals you have sold, across all your crop lots. Track delivery and payment.'
    : 'Deals you are buying, as ' + (activeBuyer?.name || 'no active buyer') + '.'

  return (
    <>
      <PageHeader
        eyebrow="Deals"
        title={title}
        description={sub}
        back={{ to: isSeller ? '/seller' : '/buyer', label: 'Back to dashboard' }}
      />
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">

        {isBuyer && !activeBuyer && (
          <div className="mb-4 rounded-card border border-honey-200 bg-honey-50 p-3 text-sm text-honey-800">
            No active buyer selected. <Link to="/buyer" className="font-medium underline">Pick a buyer first</Link>.
          </div>
        )}

        {enrichedListStatus === 'loading' && (
          <div className="ac-card p-8 text-center text-sm text-ink-500">
            Loading deals…
          </div>
        )}
        {enrichedListError && (
          <div className="rounded-card border border-rust-200 bg-rust-50 p-6 text-sm text-rust-800">
            {enrichedListError}
          </div>
        )}

        {enrichedListStatus === 'succeeded' && enrichedList.length === 0 && (
          <div className="ac-card p-12 text-center">
            <p className="font-display text-lg text-ink-900">No deals yet</p>
            <p className="mt-2 text-sm text-ink-600">
              Deals are created automatically when an offer is accepted.
            </p>
          </div>
        )}

        {enrichedListStatus === 'succeeded' && enrichedList.length > 0 && (
          <div className="ac-stagger space-y-3">
            {enrichedList.map((d) => (
              <Link
                key={d.public_id}
                to={`/${isSeller ? 'farmer' : 'buyer'}/deals/${d.public_id}`}
                className="ac-card ac-card-hover block p-5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-mono text-sm text-ink-700">{d.public_id}</p>
                    <p className="mt-1 font-medium text-ink-900">
                      {d.crop_lot?.crop_name || 'Crop lot'}{' '}
                      {d.crop_lot?.quantity
                        ? `· ${d.crop_lot.quantity}${d.crop_lot.quantity_unit || 'kg'}`
                        : ''}
                    </p>
                    <p className="text-xs text-ink-500">
                      {isSeller
                        ? `Buyer: ${d.buyer?.name || '—'}`
                        : `Seller lot: ${d.crop_lot?.public_id || '—'}`}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${
                        DELIVERY_STYLES[d.delivery_status] || NEUTRAL_STATUS
                      }`}
                    >
                      {d.delivery_status}
                    </span>
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${
                        PAYMENT_STYLES[d.payment_status] || NEUTRAL_STATUS
                      }`}
                    >
                      pay: {d.payment_status}
                    </span>
                  </div>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  <div>
                    <p className="text-xs text-ink-500">Agreed ₹/kg</p>
                    <p className="font-medium text-ink-900">
                      ₹{d.agreed_price_per_kg}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-ink-500">Quantity</p>
                    <p className="font-medium text-ink-900">
                      {d.agreed_quantity} {d.crop_lot?.quantity_unit || 'kg'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-ink-500">Total</p>
                    <p className="font-medium text-success-700">
                      ₹{Number(d.total_value || 0).toFixed(0)}
                    </p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </>
  )
}

export default MyDeals
