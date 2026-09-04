import { useEffect } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { Link, useNavigate } from 'react-router-dom'
import { fetchCropLots } from '../redux/slices/cropLotSlice.js'
import { selectIsSeller } from '../redux/slices/authSlice.js'
import PageHeader from '../components/PageHeader.jsx'
import CropImage from '../components/CropImage.jsx'
import EmptyState from '../components/EmptyState.jsx'
import usePageMeta from '../hooks/usePageMeta.js'

function StatusBadge({ status }) {
  const styles = {
    DRAFT: 'bg-earth-100 text-ink-700',
    ACTIVE: 'bg-success-50 text-success-700',
    SOLD: 'bg-primary-100 text-primary-800',
    CANCELLED: 'bg-rust-100 text-rust-800',
  }
  return (
    <span className={`inline-block rounded-full px-3 py-1 text-xs font-semibold ${styles[status] || styles.DRAFT}`}>
      {status}
    </span>
  )
}

function SellerDashboard() {
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const isSeller = useSelector(selectIsSeller)
  const { list, listStatus, listError } = useSelector((state) => state.cropLots)
  usePageMeta({
    title: 'Seller dashboard',
    description: 'Manage your crop lots, respond to buyer offers, and track your deals in one place.',
  })

  useEffect(() => {
    if (!isSeller) {
      // If a buyer lands here, send them to the buyer dashboard or role select.
      navigate('/role', { replace: true })
      return
    }
    dispatch(fetchCropLots())
  }, [dispatch, isSeller, navigate])

  return (
    <>
      <PageHeader
        eyebrow="Selling"
        title="Seller dashboard"
        description="Manage your crop lots, respond to offers, and track your deals."
        actions={
          <>
            <Link to="/seller/deals" className="ac-btn-secondary">
              My deals
            </Link>
            <Link to="/seller/crop-lots/new" className="ac-btn-primary">
              + List a new crop lot
            </Link>
          </>
        }
      />
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">

        {/* Sell workflow helper */}
        <div className="mb-6 rounded-card border border-primary-200 bg-primary-50/40 p-4 text-sm text-ink-700">
          <p>
            <strong className="text-ink-900">Sell workflow:</strong> List a lot
            → Buyers offer → You counter or accept → Crop lot becomes{' '}
            <span className="rounded bg-primary-100 px-1 text-primary-800">SOLD</span>{' '}
            → Track delivery &amp; payment under <em>My deals</em>.
          </p>
        </div>

        {listStatus === 'loading' && (
          <div className="ac-card p-8 text-center text-sm text-ink-500">
            Loading crop lots…
          </div>
        )}

        {listStatus === 'failed' && (
          <EmptyState
            kind="error"
            title="Could not load crop lots"
            description={listError || 'Please retry.'}
            action={
              <button
                onClick={() => dispatch(fetchCropLots())}
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
            title="No crop lots yet"
            description="Create your first crop lot to start connecting with buyers."
            action={
              <Link
                to="/seller/crop-lots/new"
                className="ac-btn-primary"
              >
                + List a crop lot
              </Link>
            }
          />
        )}

        {listStatus === 'succeeded' && list.length > 0 && (
          <div className="ac-stagger grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {list.map((lot) => (
              <article
                key={lot.public_id}
                className="ac-card ac-card-hover overflow-hidden"
              >
                <Link
                  to={`/seller/crop-lots/${lot.public_id}`}
                  className="block"
                  aria-label={`${lot.crop_name} ${lot.quantity} ${lot.quantity_unit}`}
                >
                  <CropImage
                    crop={lot.crop_name}
                    label={`${lot.crop_name}`}
                    className="h-32 w-full rounded-b-none"
                    showName={false}
                  />
                  <div className="p-5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="truncate font-display text-lg text-ink-900">
                          {lot.crop_name}
                        </h3>
                        {lot.crop_variety && (
                          <p className="truncate text-sm text-ink-500">
                            {lot.crop_variety}
                          </p>
                        )}
                      </div>
                      <StatusBadge status={lot.status} />
                    </div>

                    <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs text-ink-600">
                      <dt className="text-ink-400">Quantity</dt>
                      <dd className="text-right font-medium text-ink-900">
                        {lot.quantity} {lot.quantity_unit}
                      </dd>
                      {lot.location && (
                        <>
                          <dt className="text-ink-400">Location</dt>
                          <dd className="truncate text-right font-medium text-ink-700">
                            {lot.location}
                          </dd>
                        </>
                      )}
                      {lot.harvest_date && (
                        <>
                          <dt className="text-ink-400">Harvest</dt>
                          <dd className="text-right font-medium text-ink-700">
                            {new Date(lot.harvest_date).toLocaleDateString()}
                          </dd>
                        </>
                      )}
                      {lot.minimum_acceptable_price ? (
                        <>
                          <dt className="text-ink-400">Min price</dt>
                          <dd className="text-right font-medium text-primary-700">
                            ₹{lot.minimum_acceptable_price}/{lot.quantity_unit}
                          </dd>
                        </>
                      ) : null}
                    </dl>
                  </div>
                </Link>

                <div className="flex flex-wrap gap-1.5 border-t border-earth-100 px-4 py-3 text-xs">
                  <Link
                    to={`/seller/crop-lots/${lot.public_id}/offers`}
                    className="rounded-full border border-primary-200 bg-white px-2.5 py-1 font-medium text-primary-700 transition hover:bg-primary-50"
                  >
                    Offers
                  </Link>
                  <Link
                    to={`/seller/crop-lots/${lot.public_id}/buyers`}
                    className="rounded-full border border-primary-200 bg-white px-2.5 py-1 font-medium text-primary-700 transition hover:bg-primary-50"
                  >
                    Buyers
                  </Link>
                  <Link
                    to={`/seller/crop-lots/${lot.public_id}/opportunities`}
                    className="rounded-full border border-primary-200 bg-white px-2.5 py-1 font-medium text-primary-700 transition hover:bg-primary-50"
                  >
                    Opportunities
                  </Link>
                  <Link
                    to={`/seller/crop-lots/${lot.public_id}/decision`}
                    className="rounded-full border border-primary-200 bg-white px-2.5 py-1 font-medium text-primary-700 transition hover:bg-primary-50"
                  >
                    Decision
                  </Link>
                  <Link
                    to={`/seller/crop-lots/${lot.public_id}/quality`}
                    className="rounded-full border border-primary-200 bg-white px-2.5 py-1 font-medium text-primary-700 transition hover:bg-primary-50"
                  >
                    Quality
                  </Link>
                </div>
              </article>
            ))}
          </div>
        )}
      </main>
    </>
  )
}

export default SellerDashboard
