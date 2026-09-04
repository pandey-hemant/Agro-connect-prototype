/**
 * Deal.jsx — single deal detail (status board + money + parties).
 *
 * Mounted at /seller/deals/:publicId (and the legacy
 * /farmer/deals/:publicId). Shared with buyers (also exposed at
 * /buyer/deals/:publicId). The business logic — the enriched
 * fetch, the delivery/payment status updates, the best-effort
 * logistics + cold-storage estimates — is preserved verbatim. The
 * chrome is the redesigned shell.
 *
 * Trust signal: every estimate block carries an "estimate"
 * framing. The completed-deal lock is shown as a green strip with
 * plain language, not a silent disabled state.
 */
import { useEffect, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { Link, useParams, useNavigate } from 'react-router-dom'
import {
  fetchDealEnriched,
  updateDealStatus,
  clearEnrichedDeal,
  fetchEnrichedDealsForBuyer,
  fetchEnrichedDealsForSeller,
} from '../redux/slices/dealSlice.js'
import api from '../api/axios.js'
import {
  selectActiveBuyer,
  selectPublicId,
  selectIsBuyer,
  selectIsSeller,
} from '../redux/slices/authSlice.js'
import { fmtInr } from '../utils/format.js'
import PageHeader from '../components/PageHeader.jsx'
import CropImage from '../components/CropImage.jsx'
import PaymentLifecycle from '../components/PaymentLifecycle.jsx'
import FarmerCard from '../components/FarmerCard.jsx'
import DealVerificationForm from '../components/DealVerificationForm.jsx'
import IssueFlow from '../components/IssueFlow.jsx'
import DealAuditTrail from '../components/DealAuditTrail.jsx'
import usePageMeta from '../hooks/usePageMeta.js'

const DELIVERY_OPTIONS = [
  'PENDING',
  'PREPARING',
  'IN_TRANSIT',
  'DELIVERED',
  'COMPLETED',
]
const PAYMENT_OPTIONS = ['UNPAID', 'PARTIAL', 'PAID', 'REFUNDED']

const SELECT =
  'mt-2 w-full rounded-lg border border-ink-200 bg-white px-2 py-1.5 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500'

function StatusField({ label, value, options, onChange, disabled, tone }) {
  return (
    <div className="rounded-card border border-ink-200 p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
        {label}
      </p>
      <p className={`mt-1 font-display text-lg ${tone || 'text-ink-900'}`}>
        {value}
      </p>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled || options.indexOf(value) === options.length - 1}
        className={
          SELECT +
          ' disabled:cursor-not-allowed disabled:bg-ink-50 disabled:opacity-60'
        }
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      {disabled && (
        <p className="mt-1 text-xs text-ink-400">Locked</p>
      )}
    </div>
  )
}

function Deal() {
  const { publicId } = useParams()
  const dispatch = useDispatch()
  usePageMeta({
    title: 'Deal',
    description: 'Status board, parties, money, and delivery & payment updates for this deal.',
  })
  const navigate = useNavigate()
  const isBuyer = useSelector(selectIsBuyer)
  const isSeller = useSelector(selectIsSeller)
  const activeBuyer = useSelector(selectActiveBuyer)
  const farmerPublicId = useSelector(selectPublicId)
  const farmerRole = useSelector((state) => state.auth.role) || 'SELLER'
  const { enriched, enrichedStatus, enrichedError, updateStatus, updateError } =
    useSelector((state) => state.deals)

  const [logistics, setLogistics] = useState(null)
  const [logisticsErr, setLogisticsErr] = useState(null)
  const [coldStorage, setColdStorage] = useState(null)
  const [coldStorageErr, setColdStorageErr] = useState(null)

  useEffect(() => {
    if (publicId) dispatch(fetchDealEnriched(publicId))
    return () => {
      dispatch(clearEnrichedDeal())
    }
  }, [dispatch, publicId])

  useEffect(() => {
    if (enrichedStatus !== 'failed') return
    if (isBuyer && activeBuyer?.id) {
      dispatch(fetchEnrichedDealsForBuyer(activeBuyer.id))
    } else if (isSeller && farmerPublicId) {
      dispatch(fetchEnrichedDealsForSeller(farmerPublicId))
    }
  }, [
    enrichedStatus,
    isBuyer,
    isSeller,
    activeBuyer?.id,
    farmerPublicId,
    dispatch,
  ])

  useEffect(() => {
    if (!enriched) return
    let cancelled = false
    const run = async () => {
      const lot = enriched.crop_lot
      if (lot && lot.location) {
        try {
          const r = await api.post('/logistics/estimate', {
            crop_lot_id: lot.public_id,
            distance_km: 100,
            vehicle: 'mini-truck',
            quantity_kg: enriched.agreed_quantity,
          })
          if (!cancelled) {
            setLogistics(r.data)
            setLogisticsErr(null)
          }
        } catch (e) {
          if (!cancelled) {
            setLogisticsErr(
              e.response?.data?.detail || 'Could not estimate logistics.'
            )
          }
        }
      } else {
        setLogisticsErr('Pickup location not set on the crop lot.')
      }
      try {
        const r2 = await api.post('/cold-storage/estimate', {
          crop: lot?.crop_name,
          quantity_kg: enriched.agreed_quantity,
          days: 3,
        })
        if (!cancelled) {
          setColdStorage(r2.data)
          setColdStorageErr(null)
        }
      } catch (e) {
        if (!cancelled) {
          setColdStorageErr(
            e.response?.data?.detail || 'Cold-storage estimate unavailable.'
          )
        }
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [enriched])

  const update = (body) => {
    dispatch(updateDealStatus({ publicId, ...body }))
  }

  if (enrichedStatus === 'loading') {
    return (
      <>
        <PageHeader
          eyebrow="Deals"
          title="Deal"
          subtitle="Loading deal…"
        />
        <div className="ac-card p-8 text-center text-sm text-ink-500">
          Loading deal…
        </div>
      </>
    )
  }
  if (enrichedStatus === 'failed' && !enriched) {
    return (
      <>
        <PageHeader eyebrow="Deals" title="Deal" />
        <div className="mx-auto max-w-xl rounded-card border border-rust-200 bg-rust-50 p-5 text-rust-800">
          <p className="font-medium">Could not load this deal.</p>
          <p className="mt-1 text-sm">{enrichedError}</p>
          <button onClick={() => navigate(-1)} className="ac-btn-ghost mt-3">
            ← Go back
          </button>
        </div>
      </>
    )
  }
  if (!enriched) return null

  const lot = enriched.crop_lot || {}
  const buyer = enriched.buyer || {}
  const offer = enriched.offer || null
  const locked = enriched.delivery_status === 'COMPLETED'
  const backLink = isSeller ? '/seller/deals' : '/buyer/deals'

  return (
    <>
      <PageHeader
        eyebrow={lot.crop_name || 'Deals'}
        title={`Deal · ${buyer.name || enriched.buyer_id || 'buyer'}`}
        subtitle={
          lot.crop_name
            ? `${lot.crop_name}${lot.crop_variety ? ` · ${lot.crop_variety}` : ''} · ${lot.quantity || ''} ${lot.quantity_unit || ''}`
            : 'Status board for this deal.'
        }
        back={{ to: backLink, label: 'All deals' }}
        actions={
          <span className="rounded-full bg-ink-100 px-3 py-1 font-mono text-xs text-ink-600">
            {enriched.public_id}
          </span>
        }
      />

      {locked && (
        <div className="mb-4 rounded-card border border-success-200 bg-success-50 p-4 text-sm text-success-700">
          ✓ Deal is COMPLETED. Status fields are locked from further changes.
        </div>
      )}

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
              {lot.location || '—'}
              {lot.public_id ? (
                <>
                  {' · '}
                  <Link
                    to={`/seller/crop-lots/${lot.public_id}`}
                    className="text-primary-700 hover:underline"
                  >
                    Open crop lot
                  </Link>
                </>
              ) : null}
            </p>
          </div>
        </div>
      )}

      {/* Parties + crop */}
      <section className="ac-card mb-6 p-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
              Crop
            </p>
            <p className="mt-1 font-display text-lg text-ink-900">
              {lot.crop_name || '—'}
            </p>
            {lot.crop_variety && (
              <p className="text-xs text-ink-600">{lot.crop_variety}</p>
            )}
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
              Buyer
            </p>
            <p className="mt-1 font-display text-lg text-ink-900">
              {buyer.name || enriched.buyer_id || '—'}
            </p>
            {buyer.location && (
              <p className="text-xs text-ink-600">{buyer.location}</p>
            )}
            {buyer.contact && (
              <p className="text-xs text-ink-600">{buyer.contact}</p>
            )}
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
              Offer
            </p>
            {offer ? (
              <>
                <p className="mt-1 font-display text-lg text-ink-900">
                  {offer.status}
                </p>
                {offer.public_id && (
                  <Link
                    to={`/seller/offers/${offer.public_id}`}
                    className="mt-1 inline-block text-xs text-primary-700 hover:underline"
                  >
                    Open offer
                  </Link>
                )}
              </>
            ) : (
              <p className="mt-1 text-sm text-ink-500">—</p>
            )}
          </div>
        </div>
      </section>

      {/* Money */}
      <section className="ac-card mb-6 p-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
              Agreed ₹/kg
            </p>
            <p className="mt-1 font-display text-lg text-ink-900">
              {fmtInr(enriched.agreed_price_per_kg)}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
              Quantity
            </p>
            <p className="mt-1 font-display text-lg text-ink-900">
              {enriched.agreed_quantity} {lot.quantity_unit || 'kg'}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
              Total value
            </p>
            <p className="mt-1 font-display text-lg text-success-700">
              {fmtInr(enriched.total_value || 0)}
            </p>
          </div>
        </div>
      </section>

      {/* Pickup / Delivery */}
      <section className="mb-6 grid gap-3 sm:grid-cols-2">
        <div className="rounded-card border border-ink-200 bg-white p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
            Pickup location
          </p>
          <p className="mt-1 font-display text-lg text-ink-900">
            {lot.location || '—'}
          </p>
          {lot.state && (
            <p className="text-xs text-ink-600">{lot.state}</p>
          )}
        </div>
        <div className="rounded-card border border-ink-200 bg-white p-3">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
            Delivery location
          </p>
          <p className="mt-1 font-display text-lg text-ink-900">
            {buyer.location || enriched.notes || '—'}
          </p>
          {buyer.state && (
            <p className="text-xs text-ink-600">{buyer.state}</p>
          )}
        </div>
      </section>

      {/* Status updates */}
      <section className="mb-6 grid gap-3 sm:grid-cols-2">
        <StatusField
          label="Delivery status"
          value={enriched.delivery_status}
          options={DELIVERY_OPTIONS}
          onChange={(v) => update({ delivery_status: v })}
          disabled={locked}
          tone="text-primary-700"
        />
        <StatusField
          label="Payment status"
          value={enriched.payment_status}
          options={PAYMENT_OPTIONS}
          onChange={(v) => update({ payment_status: v })}
          disabled={locked}
          tone="text-success-700"
        />
      </section>

      {/* Explicit payment state flow — actual settlement is handled
          by regulated payment infrastructure outside AgroConnect. */}
      <div className="mb-6">
        <PaymentLifecycle
          deal={{
            public_id: enriched.public_id,
            paymentStatus: enriched.payment_status,
            amount: enriched.total_value,
            last_txn_id: enriched.last_txn_id,
          }}
          onChange={(d) => {
            // Reflect the new state in the same view by re-fetching
            // the enriched record. The dedicated endpoint already
            // persisted the transition.
            dispatch(fetchDealEnriched(enriched.public_id))
          }}
        />
      </div>

      {/* Verification — start, submit, resolve (Feature B). */}
      <div className="mb-6">
        <DealVerificationForm dealPublicId={enriched.public_id} />
      </div>

      {/* Issues — OPEN → UNDER_REVIEW → RESOLVED (Feature I). */}
      <div className="mb-6">
        <IssueFlow
          dealPublicId={enriched.public_id}
          currentUser={{
            publicId: farmerPublicId || activeBuyer?.id || 'system',
            role: farmerRole,
          }}
        />
      </div>

      {/* Audit trail — chronological log of every state change (Feature H). */}
      <div className="mb-6">
        <DealAuditTrail dealPublicId={enriched.public_id} />
      </div>

      {/* Farmer credibility (visible to buyers on this deal) */}
      {lot.public_id && isBuyer && (
        <div className="mb-6">
          <FarmerCard lotPublicId={lot.public_id} layout="card" />
        </div>
      )}

      {updateError && (
        <div className="mb-4 rounded-card border border-rust-200 bg-rust-50 p-3 text-sm text-rust-800">
          {updateError}
        </div>
      )}
      {updateStatus === 'loading' && (
        <p className="mb-4 text-sm text-ink-500">Updating…</p>
      )}

      {/* Logistics estimate */}
      <section className="ac-card mb-4 p-5">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-base text-ink-900">
            Logistics estimate
          </h2>
          <span className="ac-chip ac-chip-honey">Estimate</span>
        </div>
        {logistics && (
          <div className="mt-2 grid gap-2 text-sm sm:grid-cols-3">
            <div>
              <p className="text-xs text-ink-500">Distance</p>
              <p className="font-medium text-ink-900">
                {Number(logistics.distance_km || 0).toFixed(0)} km
              </p>
            </div>
            <div>
              <p className="text-xs text-ink-500">Transport</p>
              <p className="font-medium text-ink-900">
                {fmtInr(logistics.transport_cost || 0)}
              </p>
            </div>
            <div>
              <p className="text-xs text-ink-500">Total estimated</p>
              <p className="font-medium text-ink-900">
                {fmtInr(logistics.total_cost || 0)}
              </p>
            </div>
          </div>
        )}
        {logisticsErr && (
          <p className="mt-2 text-sm text-ink-500">{logisticsErr}</p>
        )}
      </section>

      {/* Cold-storage estimate */}
      <section className="ac-card mb-4 p-5">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-base text-ink-900">
            Cold-storage estimate
          </h2>
          <span className="ac-chip ac-chip-honey">Estimate</span>
        </div>
        {coldStorage && (
          <div className="mt-2 grid gap-2 text-sm sm:grid-cols-3">
            <div>
              <p className="text-xs text-ink-500">Nearest facility</p>
              <p className="font-medium text-ink-900">
                {coldStorage.facility_name || '—'}
              </p>
              {coldStorage.city && (
                <p className="text-xs text-ink-500">{coldStorage.city}</p>
              )}
            </div>
            <div>
              <p className="text-xs text-ink-500">Capacity</p>
              <p className="font-medium text-ink-900">
                {coldStorage.capacity_kg
                  ? `${coldStorage.capacity_kg} kg`
                  : '—'}
              </p>
            </div>
            <div>
              <p className="text-xs text-ink-500">Cost</p>
              <p className="font-medium text-ink-900">
                {fmtInr(coldStorage.cost || 0)}
              </p>
            </div>
          </div>
        )}
        {coldStorageErr && (
          <p className="mt-2 text-sm text-ink-500">{coldStorageErr}</p>
        )}
      </section>

      <section className="ac-card p-5">
        <h2 className="font-display text-base text-ink-900">Timestamps</h2>
        <p className="mt-1 text-sm text-ink-700">
          Created: {new Date(enriched.created_at).toLocaleString()}
        </p>
        <p className="text-sm text-ink-700">
          Updated: {new Date(enriched.updated_at).toLocaleString()}
        </p>
      </section>
    </>
  )
}

export default Deal
