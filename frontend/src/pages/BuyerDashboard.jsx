/**
 * BuyerDashboard.jsx — buyer's home screen.
 *
 * The page is laid out in order of what a buyer most often needs to
 * do when they land here:
 *
 *   1.  Active-buyer hero        — the greeting, the active buyer
 *                                  identity, and one primary action.
 *                                  If no buyer is picked, this is the
 *                                  BuyerPicker (seed + choose).
 *   2.  Stat row                 — active demands, open offers,
 *                                  deals in progress, lifetime
 *                                  purchase value.
 *   3.  Prioritized quick-actions — the four most common next steps,
 *                                  each as a card. The primary
 *                                  "browse marketplace" sits first.
 *   4.  Demands block            — own demands, with a create CTA.
 *   5.  Offers & deals snapshots — last 5 each, side by side.
 *
 * The previous version had a "tile grid" that listed every route and
 * a redundant CTA strip. Both are gone: the new design is a
 * prioritized "what now" view, in the same shape as the Farmer
 * dashboard.
 *
 * All Redux dispatches and business logic are preserved verbatim
 * (the `require('../redux/slices/demandSlice.js').removeRequirement`
 * runtime require is the deliberate escape hatch we keep).
 */
import { useEffect, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { Link, useNavigate } from 'react-router-dom'
import {
  fetchBuyers,
  seedDemoBuyers,
  clearSeed,
} from '../redux/slices/buyerSlice.js'
import {
  fetchOffersByBuyer,
  clearCurrentOffer,
} from '../redux/slices/offerSlice.js'
import { fetchEnrichedDealsForBuyer } from '../redux/slices/dealSlice.js'
import {
  selectActiveBuyer,
  setActiveBuyer,
  selectIsBuyer,
} from '../redux/slices/authSlice.js'
import {
  fetchBuyerRequirements,
  clearAction,
} from '../redux/slices/demandSlice.js'
import PageHeader from '../components/PageHeader.jsx'
import EmptyState from '../components/EmptyState.jsx'
import StatCard from '../components/StatCard.jsx'
import AttentionStrip from '../components/AttentionStrip.jsx'
import usePageMeta from '../hooks/usePageMeta.js'
import { fmtInr, fmtInr2 } from '../utils/format.js'

const INPUT =
  'w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500'

const OFFER_STATUS_TONE = {
  OPEN: 'bg-primary-100 text-primary-800',
  COUNTERED: 'bg-honey-100 text-honey-800',
  ACCEPTED: 'bg-success-100 text-success-700',
  REJECTED: 'bg-rust-100 text-rust-800',
  FINALIZED: 'bg-primary-100 text-primary-800',
  CANCELLED: 'bg-ink-100 text-ink-700',
}

function OfferStatusPill({ status }) {
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
        OFFER_STATUS_TONE[status] || 'bg-ink-100 text-ink-700'
      }`}
    >
      {status}
    </span>
  )
}

function useGreeting() {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

// ---- BuyerPicker (first-time flow) -----------------------------------

function BuyerPicker() {
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const {
    list,
    listStatus,
    listError,
    seedStatus,
    seedResult,
    seedError,
  } = useSelector((s) => s.buyers)
  const [selectedId, setSelectedId] = useState('')

  useEffect(() => {
    if (listStatus === 'idle') dispatch(fetchBuyers({}))
  }, [dispatch, listStatus])

  useEffect(() => () => {
    dispatch(clearSeed())
  }, [dispatch])

  const confirm = () => {
    const buyer = list.find((b) => String(b.id) === String(selectedId))
    if (!buyer) return
    dispatch(setActiveBuyer(buyer))
    navigate('/buyer', { replace: true })
  }

  return (
    <section className="ac-card p-5">
      <p className="ac-section-label">Choose buyer</p>
      <h2 className="mt-1 font-display text-2xl text-ink-900">
        Which buyer are you?
      </h2>
      <p className="mt-2 max-w-2xl text-sm text-ink-600">
        Pick which sample buyer identity to
        use — this scopes the offers and deals you see on the rest of
        the dashboard. You can switch later from the dashboard.
      </p>

      {listStatus === 'loading' && (
        <p className="mt-3 text-sm text-ink-500">Loading buyers…</p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          onClick={() => dispatch(seedDemoBuyers())}
          disabled={seedStatus === 'loading' || list.length > 0}
          className="ac-btn-secondary disabled:cursor-not-allowed disabled:opacity-50"
        >
          {seedStatus === 'loading' ? 'Seeding…' : 'Seed sample buyers'}
        </button>
        {list.length === 0 && (
          <span className="text-xs text-ink-500">
            No buyers yet — click <em>Seed sample buyers</em> to add 6
            sample buyers.
          </span>
        )}
      </div>

      {seedStatus === 'succeeded' && seedResult && (
        <div className="mt-3 rounded-card border border-honey-200 bg-honey-50 p-3 text-sm text-honey-800">
          Seeded {seedResult.inserted} sample buyers. Sample data is clearly
          labelled.
        </div>
      )}
      {seedError && (
        <div className="mt-3 rounded-card border border-rust-200 bg-rust-50 p-3 text-sm text-rust-800">
          {seedError}
        </div>
      )}

      {list.length > 0 && (
        <div className="mt-4">
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            className={INPUT}
            aria-label="Choose buyer identity"
          >
            <option value="">— Select a buyer —</option>
            {list.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} {b.is_demo ? '· sample' : ''}{' '}
                {b.location ? `· ${b.location}` : ''}
              </option>
            ))}
          </select>
          <button
            onClick={confirm}
            disabled={!selectedId}
            className="ac-btn-primary mt-3 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Continue as this buyer →
          </button>
        </div>
      )}

      {listError && <p className="mt-3 text-sm text-rust-700">{listError}</p>}
    </section>
  )
}

// ---- Hero + stat row --------------------------------------------------

function BuyerHero({ activeBuyer, onSwitch }) {
  return (
    <div className="rounded-card border border-earth-200 bg-gradient-to-br from-primary-50 via-earth-50 to-white p-5 sm:p-7">
      <p className="ac-section-label">Your buying</p>
      <h1 className="mt-1 font-display text-3xl font-medium text-ink-900 sm:text-4xl">
        {useGreeting()}{activeBuyer?.name ? `, ${activeBuyer.name.split(' ')[0]}` : ''}
      </h1>
      <p className="mt-2 max-w-2xl text-ink-500">
        Browse what's on offer, publish what you want to buy, and track
        every negotiation and delivery in one place.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Link to="/buyer/marketplace" className="ac-btn-primary">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3-3" />
          </svg>
          Browse marketplace
        </Link>
        <Link to="/buyer/demands/new" className="ac-btn-secondary">
          + Create demand
        </Link>
        {activeBuyer && (
          <button onClick={onSwitch} className="ac-btn-ghost">
            Switch buyer
          </button>
        )}
      </div>
    </div>
  )
}

function BuyerStatRow({ demands, offers, deals }) {
  const activeDemands = demands.filter(
    (d) => d.status === 'ACTIVE' || d.status === 'PENDING' || !d.status
  ).length
  const openOffers = offers.filter(
    (o) => o.status === 'OPEN' || o.status === 'COUNTERED'
  ).length
  const dealsInProgress = deals.filter(
    (d) => d.delivery_status !== 'COMPLETED' && d.delivery_status !== 'DELIVERED'
  ).length
  const lifetimeValue = deals.reduce(
    (a, d) => a + Number(d.total_value || 0),
    0
  )
  return (
    <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        label="Active demands"
        value={activeDemands}
        hint={activeDemands > 0 ? 'Visible to farmers' : 'No demands yet'}
        tone={activeDemands > 0 ? 'primary' : 'default'}
        icon={
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <path d="M3 7h18l-1.5 12a2 2 0 0 1-2 1.8H6.5a2 2 0 0 1-2-1.8L3 7Z" />
            <path d="M8 7V5a4 4 0 0 1 8 0v2" />
          </svg>
        }
      />
      <StatCard
        label="Open offers"
        value={openOffers}
        hint={openOffers > 0 ? 'Negotiating' : 'No open offers'}
        tone={openOffers > 0 ? 'primary' : 'default'}
        icon={
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <path d="M21 12a9 9 0 1 1-3.5-7.1" />
            <path d="M21 4v5h-5" />
          </svg>
        }
      />
      <StatCard
        label="Deals in progress"
        value={dealsInProgress}
        hint={dealsInProgress > 0 ? 'Track delivery' : 'Nothing moving'}
        icon={
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <path d="M3 7h11v8H3z" />
            <path d="M14 10h4l3 3v2h-7" />
            <circle cx="7" cy="17" r="2" />
            <circle cx="17" cy="17" r="2" />
          </svg>
        }
      />
      <StatCard
        label="Lifetime purchases"
        value={`₹${fmtInr(lifetimeValue)}`}
        hint="Across all deals"
        icon={
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <path d="M12 2v20" />
            <path d="M17 6H9a3 3 0 0 0 0 6h6a3 3 0 0 1 0 6H7" />
          </svg>
        }
      />
    </div>
  )
}

// ---- Quick actions grid -----------------------------------------------

const QUICK_ACTIONS = [
  {
    to: '/buyer/marketplace',
    title: 'Browse marketplace',
    blurb: 'See every ACTIVE crop lot from farmers and make offers.',
    tone: 'primary',
  },
  {
    to: '/buyer/demands/new',
    title: 'Create a demand',
    blurb: 'Tell farmers what you want — crop, quantity, price, location.',
    tone: 'honey',
  },
  {
    to: '/buyer/offers',
    title: 'My offers',
    blurb: 'Track every offer you have placed — open, countered, accepted.',
    tone: 'default',
  },
  {
    to: '/buyer/deals',
    title: 'My purchases',
    blurb: 'Track delivery and payment for every deal you are buying.',
    tone: 'default',
  },
]

function QuickActions() {
  return (
    <section className="mt-8">
      <p className="ac-section-label">What now?</p>
      <h2 className="mt-1 font-display text-2xl text-ink-900">
        Pick what you want to do next
      </h2>
      <div className="ac-stagger mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {QUICK_ACTIONS.map((a) => {
          const border =
            a.tone === 'honey'
              ? 'border-honey-300'
              : a.tone === 'primary'
                ? 'border-primary-200'
                : 'border-earth-200'
          return (
            <Link
              key={a.to}
              to={a.to}
              className={`ac-card ac-card-hover block p-5 ${border}`}
            >
              <h3 className="font-display text-lg text-ink-900">
                {a.title}
              </h3>
              <p className="mt-1 text-sm text-ink-600">{a.blurb}</p>
            </Link>
          )
        })}
      </div>
    </section>
  )
}

// ---- Demands card -----------------------------------------------------

function MyDemandsCard({ buyerPublicId }) {
  const dispatch = useDispatch()
  const {
    buyerReqs,
    buyerReqsStatus,
    buyerReqsError,
    actionStatus,
    actionError,
  } = useSelector((s) => s.demands)

  useEffect(() => {
    if (buyerPublicId) dispatch(fetchBuyerRequirements(buyerPublicId))
    return () => {
      dispatch(clearAction())
    }
  }, [dispatch, buyerPublicId])

  const remove = (idx) => {
    if (!buyerPublicId) return
    if (!window.confirm('Remove this demand?')) return
    dispatch(
      // eslint-disable-next-line no-undef
      require('../redux/slices/demandSlice.js').removeRequirement({
        publicId: buyerPublicId,
        index: idx,
      })
    ).then((a) => {
      if (a.meta.requestStatus === 'fulfilled' && buyerPublicId) {
        dispatch(fetchBuyerRequirements(buyerPublicId))
      }
    })
  }

  return (
    <section className="ac-card mt-8 p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="ac-section-label">My demands</p>
        <Link to="/buyer/demands/new" className="ac-btn-secondary">
          + Create demand
        </Link>
      </div>
      {buyerReqsStatus === 'loading' && (
        <p className="text-sm text-ink-500">Loading…</p>
      )}
      {buyerReqsError && (
        <p className="text-sm text-rust-700">{buyerReqsError}</p>
      )}
      {actionError && (
        <p className="mt-2 text-sm text-rust-700">{actionError}</p>
      )}
      {buyerReqsStatus === 'succeeded' && buyerReqs.length === 0 && (
        <EmptyState
          kind="info"
          title="No demands yet"
          description="Tell farmers what you want to buy and they'll see your demand on the marketplace. Click Create demand above."
          action={
            <Link to="/buyer/demands/new" className="ac-btn-primary">
              + Create demand
            </Link>
          }
        />
      )}
      {buyerReqsStatus === 'succeeded' && buyerReqs.length > 0 && (
        <ul className="divide-y divide-ink-100">
          {buyerReqs.map((r, i) => (
            <li key={i} className="py-2 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="font-medium text-ink-900">
                    {r.crop_name}
                  </span>
                  {r.crop_variety ? ` · ${r.crop_variety}` : ''}{' '}
                  <span className="text-ink-600">· ≥{r.min_quantity_kg} kg</span>
                  {r.max_price_per_kg != null && (
                    <span className="text-ink-600">
                      {' '}
                      · ≤₹{r.max_price_per_kg}/kg
                    </span>
                  )}
                  {r.required_date && (
                    <span className="text-ink-600">
                      {' '}
                      · by {r.required_date}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => remove(i)}
                  disabled={actionStatus === 'loading'}
                  className="rounded-full border border-rust-200 px-2 py-0.5 text-xs font-medium text-rust-700 transition hover:bg-rust-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  remove
                </button>
              </div>
              {(r.location || r.notes) && (
                <p className="mt-1 text-xs text-ink-500">
                  {[r.location, r.notes].filter(Boolean).join(' · ')}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// ---- Activity snapshots ----------------------------------------------

function ActivitySnapshots({ offers, deals, offerStatus, dealStatus, offerError, dealError }) {
  return (
    <section className="mt-8">
      <p className="ac-section-label">Activity</p>
      <h2 className="mt-1 font-display text-2xl text-ink-900">
        What's happening with your buying
      </h2>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <article className="ac-card p-5">
          <p className="ac-section-label">Recent offers</p>
          {offerStatus === 'loading' && (
            <p className="mt-3 text-sm text-ink-500">Loading…</p>
          )}
          {offerError && <p className="mt-3 text-sm text-rust-700">{offerError}</p>}
          {offerStatus === 'succeeded' && (
            <ul className="mt-3 divide-y divide-ink-100">
              {offers.slice(0, 5).map((o) => (
                <li key={o.public_id} className="py-2 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-ink-900">
                      ₹{fmtInr2(o.current_price)}{' '}
                      <span className="text-ink-500">
                        · qty {o.current_quantity}
                      </span>
                    </span>
                    <OfferStatusPill status={o.status} />
                  </div>
                  <Link
                    to={`/buyer/offers/${o.public_id}`}
                    className="text-xs text-primary-700 hover:underline"
                  >
                    open
                  </Link>
                </li>
              ))}
              {offers.length === 0 && (
                <li className="py-3 text-sm text-ink-600">No offers yet.</li>
              )}
            </ul>
          )}
          <div className="mt-3 border-t border-earth-100 pt-3">
            <Link to="/buyer/offers" className="ac-btn-ghost text-xs">
              All offers →
            </Link>
          </div>
        </article>

        <article className="ac-card p-5">
          <p className="ac-section-label">Recent deals</p>
          {dealStatus === 'loading' && (
            <p className="mt-3 text-sm text-ink-500">Loading…</p>
          )}
          {dealError && <p className="mt-3 text-sm text-rust-700">{dealError}</p>}
          {dealStatus === 'succeeded' && (
            <ul className="mt-3 divide-y divide-ink-100">
              {deals.slice(0, 5).map((d) => (
                <li key={d.public_id} className="py-2 text-sm">
                  <div className="font-medium text-ink-900">
                    {d.crop_lot?.crop_name || 'Crop'}{' '}
                    {d.crop_lot?.quantity
                      ? `· ${d.crop_lot.quantity}${
                          d.crop_lot.quantity_unit || 'kg'
                        }`
                      : ''}
                  </div>
                  <div className="mt-0.5 text-xs text-ink-600">
                    ₹{fmtInr(Number(d.total_value || 0))} ·{' '}
                    {d.delivery_status} · pay {d.payment_status}
                  </div>
                  <Link
                    to={`/buyer/deals/${d.public_id}`}
                    className="text-xs text-primary-700 hover:underline"
                  >
                    open deal
                  </Link>
                </li>
              ))}
              {deals.length === 0 && (
                <li className="py-3 text-sm text-ink-600">No deals yet.</li>
              )}
            </ul>
          )}
          <div className="mt-3 border-t border-earth-100 pt-3">
            <Link to="/buyer/deals" className="ac-btn-ghost text-xs">
              All purchases →
            </Link>
          </div>
        </article>
      </div>
    </section>
  )
}

// ---- Main component ---------------------------------------------------

function BuyerDashboardInner() {
  const dispatch = useDispatch()
  const activeBuyer = useSelector(selectActiveBuyer)
  const { list: myOffers, listStatus: offerStatus, listError: offerError } =
    useSelector((s) => s.offers)
  const { enrichedList: myDeals, enrichedListStatus, enrichedListError } =
    useSelector((s) => s.deals)
  const { buyerReqs } = useSelector((s) => s.demands)

  useEffect(() => {
    if (activeBuyer?.id) {
      dispatch(fetchOffersByBuyer(activeBuyer.id))
      dispatch(fetchEnrichedDealsForBuyer(activeBuyer.id))
    }
    return () => {
      dispatch(clearCurrentOffer())
    }
  }, [dispatch, activeBuyer?.id])

  if (!activeBuyer?.id) return <BuyerPicker />

  // Attention items: actionable counts the dashboard already loads.
  // - countered offers need a buyer reply
  // - open offers are still on the table
  // - deals awaiting delivery (PREPARING / IN_TRANSIT) need attention
  const counteredCount = (myOffers || []).filter((o) => o.status === 'COUNTERED').length
  const openCount = (myOffers || []).filter((o) => o.status === 'OPEN').length
  const dealsInTransit = (myDeals || []).filter(
    (d) => d.delivery_status === 'PREPARING' || d.delivery_status === 'IN_TRANSIT'
  ).length
  const attentionItems = [
    counteredCount > 0 && {
      id: 'countered-offers',
      label: 'countered offer(s) need your reply',
      count: counteredCount,
      tone: 'rust',
      to: '/buyer/offers',
    },
    openCount > 0 && {
      id: 'open-offers',
      label: 'open offer(s) awaiting farmer',
      count: openCount,
      tone: 'primary',
      to: '/buyer/offers',
    },
    dealsInTransit > 0 && {
      id: 'deals-in-transit',
      label: 'deal(s) in transit',
      count: dealsInTransit,
      tone: 'honey',
      to: '/buyer/deals',
    },
  ].filter(Boolean)

  return (
    <div>
      <BuyerHero
        activeBuyer={activeBuyer}
        onSwitch={() => dispatch(setActiveBuyer(null))}
      />
      <AttentionStrip items={attentionItems} />
      <BuyerStatRow
        demands={buyerReqs || []}
        offers={myOffers || []}
        deals={myDeals || []}
      />
      <QuickActions />
      <MyDemandsCard buyerPublicId={activeBuyer.public_id} />
      <ActivitySnapshots
        offers={myOffers || []}
        deals={myDeals || []}
        offerStatus={offerStatus}
        dealStatus={enrichedListStatus}
        offerError={offerError}
        dealError={enrichedListError}
      />
    </div>
  )
}

function BuyerDashboard() {
  const navigate = useNavigate()
  const isBuyer = useSelector(selectIsBuyer)
  usePageMeta({
    title: 'Buyer dashboard',
    description: 'Browse produce, publish demands, place offers, and track purchases in one place.',
  })

  useEffect(() => {
    if (!isBuyer) {
      navigate('/role', { replace: true })
    }
  }, [isBuyer, navigate])

  return (
    <>
      <PageHeader
        eyebrow="Buying"
        title="Buyer dashboard"
        description="Browse produce, publish demands, place offers, and track purchases."
      />
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <BuyerDashboardInner />
      </main>
    </>
  )
}

export default BuyerDashboard
