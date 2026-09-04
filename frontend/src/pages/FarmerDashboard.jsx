/**
 * pages/FarmerDashboard.jsx — the farmer's home.
 *
 * The brief is explicit: the dashboard's job is to answer
 * "What should I do with my crop, where should I sell it, and
 * what will I actually earn?" — not to dump every endpoint onto
 * one page. The previous version (956 lines) tried to do both.
 *
 * This version renders, in order:
 *
 *   1.  Greeting block           — first name, location, last-updated.
 *                                  Sets the "this is a tool for you"
 *                                  tone. Single primary CTA: "Add crop
 *                                  lot".
 *   2.  Decision roll-up         — one card per ACTIVE crop lot, each
 *                                  with the lot's name, image, the
 *                                  backend's recommendation, the best
 *                                  net, and an "Open lot" link. Sorted
 *                                  by the lot most needing attention
 *                                  (SELL_NOW first, then WAIT, then
 *                                  GROUP_SALE).
 *   3.  Market snapshot          — a compact, single-row strip of
 *                                  AGMARKNET market price for the most
 *                                  common crop in the farmer's lots.
 *   4.  Active offers            — if there are any. A focused list,
 *                                  not the old 8-section sprawl.
 *   5.  FPO snippet              — if the farmer has joined one, show
 *                                  it; otherwise an "Explore FPOs" CTA.
 *   6.  Recent activity          — last few log entries (recently
 *                                  accepted offers, recently added
 *                                  lots).
 *
 * The page makes every block skippable: a farmer with three lots and
 * no offers sees only the decision roll-up. The whole page is a
 *   <DecisionCard /> on rails.
 */
import { useEffect, useMemo } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { Link } from 'react-router-dom'
import PageHeader from '../components/PageHeader.jsx'
import EmptyState from '../components/EmptyState.jsx'
import CropImage from '../components/CropImage.jsx'
import StatCard from '../components/StatCard.jsx'
import AttentionStrip from '../components/AttentionStrip.jsx'
import usePageMeta from '../hooks/usePageMeta.js'
import {
  fetchMyCropLots,
  selectMyLots,
  selectMyLotsStatus,
} from '../redux/slices/cropLotSlice.js'
import { selectName } from '../redux/slices/authSlice.js'
import { fetchOffers } from '../redux/slices/offerSlice.js'
import { fetchFpos } from '../redux/slices/fpoSlice.js'
import api from '../api/axios.js'
import { useState } from 'react'
import { fmtInr, fmtInr2, fmtPerKg } from '../utils/format.js'

// ---- Decision roll-up helpers ----------------------------------------

const DECISION_ORDER = { SELL_NOW: 0, GROUP_SALE: 1, WAIT: 2 }
const DECISION_TONE = {
  SELL_NOW:   { chip: 'ac-chip-success', label: 'Sell now' },
  WAIT:       { chip: 'ac-chip-honey',   label: 'Wait' },
  GROUP_SALE: { chip: 'ac-chip-primary', label: 'Group sale' },
}

function useGreeting() {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

function useMyLots() {
  const dispatch = useDispatch()
  useEffect(() => { dispatch(fetchMyCropLots()) }, [dispatch])
  return useSelector(selectMyLots)
}

function useMyOffers() {
  const dispatch = useDispatch()
  // Pull all offers for the farmer's lots. We grab one offer list
  // per lot and let the UI flatten them — small N, no perf concern.
  const lots = useMyLots()
  const [list, setList] = useState([])
  const [status, setStatus] = useState('idle')
  useEffect(() => {
    let cancelled = false
    async function run() {
      if (!lots || lots.length === 0) { setList([]); setStatus('succeeded'); return }
      setStatus('loading')
      const all = []
      for (const l of lots) {
        try {
          const res = await dispatch(fetchOffers(l._id || l.public_id))
          if (cancelled) return
          if (Array.isArray(res.payload)) {
            for (const o of res.payload) all.push({ ...o, _lot: l })
          }
        } catch { /* skip lot */ }
      }
      if (cancelled) return
      // Only OPEN / COUNTERED offers are interesting here.
      const open = all.filter((o) => o.status === 'OPEN' || o.status === 'COUNTERED')
      setList(open)
      setStatus('succeeded')
    }
    run()
    return () => { cancelled = true }
  }, [dispatch, lots])
  return { list, status }
}

function useFpoSummary() {
  const dispatch = useDispatch()
  const fpos = useSelector((s) => s.fpos?.list || [])
  useEffect(() => { dispatch(fetchFpos()) }, [dispatch])
  return fpos
}

function useMarketSnapshot(crop) {
  const [snap, setSnap] = useState(null)
  useEffect(() => {
    let cancelled = false
    if (!crop) return
    api.get('/market-prices', { params: { crop, limit: 5 } })
      .then((r) => {
        if (cancelled) return
        const arr = r.data?.results || []
        if (arr.length) {
          const modalPrices = arr.map((x) => Number(x.modal_price || 0)).filter(Number.isFinite)
          const avg = modalPrices.length ? modalPrices.reduce((a, b) => a + b, 0) / modalPrices.length : null
          setSnap({ avg, count: arr.length, source: r.data.source, isLive: r.data.is_live })
        } else {
          setSnap(null)
        }
      })
      .catch(() => setSnap(null))
    return () => { cancelled = true }
  }, [crop])
  return snap
}

// ---- Sub-blocks -------------------------------------------------------

function Greeting({ name }) {
  return (
    <div className="rounded-card border border-earth-200 bg-gradient-to-br from-primary-50 via-earth-50 to-white p-5 sm:p-7">
      <p className="ac-section-label">Your farm</p>
      <h1 className="mt-1 font-display text-3xl font-medium text-ink-900 sm:text-4xl">
        {useGreeting()}{name ? `, ${name.split(' ')[0]}` : ''}
      </h1>
      <p className="mt-2 max-w-2xl text-ink-500">
        Here's a focused view of your crops, the markets that matter,
        and the buyers who want what you're growing.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link to="/seller/crop-lots/new" className="ac-btn-primary">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Add crop lot
        </Link>
        <Link to="/market-prices" className="ac-btn-secondary">See market prices</Link>
        <Link to="/fpos" className="ac-btn-ghost">Browse FPOs</Link>
      </div>
    </div>
  )
}

function StatRow({ lots, offers }) {
  const active = lots.filter((l) => l.status === 'ACTIVE').length
  const decisionsComputed = lots.length
  const openOffers = offers.length
  const totalQtyKg = lots.reduce((a, l) => a + Number(l.quantity_kg || l.quantity || 0), 0)
  return (
    <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        label="Active lots"
        value={active}
        hint={`${lots.length} total this season`}
        icon={
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <path d="M12 3a5 5 0 0 0-5 5c0 4 5 11 5 11s5-7 5-11a5 5 0 0 0-5-5Z" />
            <circle cx="12" cy="8" r="2" />
          </svg>
        }
      />
      <StatCard
        label="Open offers"
        value={openOffers}
        hint={openOffers > 0 ? 'From interested buyers' : 'No buyers yet'}
        tone={openOffers > 0 ? 'primary' : 'default'}
        icon={
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <path d="M21 12a9 9 0 1 1-3.5-7.1" /><path d="M21 4v5h-5" />
          </svg>
        }
      />
      <StatCard
        label="Decisions"
        value={decisionsComputed}
        hint="Recommendations computed"
        icon={
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <path d="M9 12.5 11 14.5 15 10.5" />
            <path d="M21 12a9 9 0 1 1-3.5-7.1" /><path d="M21 4v5h-5" />
          </svg>
        }
      />
      <StatCard
        label="Total quantity"
        value={`${fmtInr(totalQtyKg)} kg`}
        hint="Across all lots"
        icon={
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <path d="M3 7h18l-1.5 12a2 2 0 0 1-2 1.8H6.5a2 2 0 0 1-2-1.8L3 7Z" />
          </svg>
        }
      />
    </div>
  )
}

function DecisionRollUp({ lots, loading }) {
  // Pull a decision per lot, one-shot. The /decisions/:id endpoint
  // is idempotent and cached on the server, so doing it for every
  // active lot here is fine. We render the *envelope* (decision
  // label + best net + rationale snippet) without the per-market
  // table — that table is the lot-detail page.
  const [decisions, setDecisions] = useState({})
  useEffect(() => {
    let cancelled = false
    async function run() {
      const out = {}
      for (const l of lots) {
        if (l.status !== 'ACTIVE') continue
        try {
          const res = await api.get(`/decisions/${l.public_id || l._id}`)
          if (cancelled) return
          out[l.public_id || l._id] = res.data
        } catch {
          out[l.public_id || l._id] = null
        }
      }
      if (!cancelled) setDecisions(out)
    }
    if (lots.length) run()
    return () => { cancelled = true }
  }, [lots])

  const active = lots.filter((l) => l.status === 'ACTIVE')
  const sorted = useMemo(() => {
    return active.slice().sort((a, b) => {
      const da = decisions[a.public_id || a._id]?.decision || 'WAIT'
      const db = decisions[b.public_id || b._id]?.decision || 'WAIT'
      return (DECISION_ORDER[da] ?? 9) - (DECISION_ORDER[db] ?? 9)
    })
  }, [active, decisions])

  if (loading && lots.length === 0) {
    return (
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {[0, 1].map((i) => (
          <div key={i} className="ac-card overflow-hidden">
            <div className="ac-skeleton h-32" />
            <div className="p-4">
              <div className="ac-skeleton h-4 w-1/2" />
              <div className="ac-skeleton mt-2 h-3 w-3/4" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (active.length === 0) {
    return (
      <section className="mt-8">
        <p className="ac-section-label">Decisions</p>
        <h2 className="mt-1 font-display text-2xl text-ink-900">
          What should you do with your crop?
        </h2>
        <EmptyState
          className="mt-4"
          kind="info"
          title="You haven't added a crop lot yet"
          description="Add your first lot to see a recommendation, the best market for it, and the offers that are waiting."
          action={<Link to="/seller/crop-lots/new" className="ac-btn-primary">Add crop lot</Link>}
        />
      </section>
    )
  }

  return (
    <section className="mt-8">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="ac-section-label">Decisions</p>
          <h2 className="mt-1 font-display text-2xl text-ink-900">
            What should you do with your crop?
          </h2>
        </div>
        <Link to="/seller/crop-lots" className="ac-btn-ghost">All lots →</Link>
      </div>

      <ul className="mt-4 grid gap-4 sm:grid-cols-2">
        {sorted.map((lot) => {
          const d = decisions[lot.public_id || lot._id]
          const decision = d?.decision || 'WAIT'
          const tone = DECISION_TONE[decision] || DECISION_TONE.WAIT
          const comparison = d?.market_comparison || []
          const bestNet = comparison[0]?.net_realisation
          return (
            <li key={lot._id || lot.public_id}>
              <Link
                to={`/seller/crop-lots/${lot.public_id}`}
                className="ac-card ac-card-hover block overflow-hidden"
              >
                <div className="flex gap-4 p-4">
                  <CropImage crop={lot.crop_name} className="h-20 w-20 flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="truncate font-display text-lg text-ink-900">
                          {lot.crop_name}{lot.crop_variety ? ` — ${lot.crop_variety}` : ''}
                        </h3>
                        <p className="text-xs text-ink-500">
                          {lot.quantity} {lot.quantity_unit} · {lot.location}
                        </p>
                      </div>
                      <span className={`ac-chip ${tone.chip} flex-shrink-0`}>
                        {tone.label}
                      </span>
                    </div>
                    <p className="mt-2 line-clamp-2 text-sm text-ink-600">
                      {d?.rationale || 'Decision not yet computed. Open the lot to compute.'}
                    </p>
                    {bestNet != null && (
                      <p className="mt-2 text-xs text-ink-500">
                        Best net · <span className="font-semibold text-success-600">₹{fmtInr(bestNet)}</span> at {comparison[0].market}
                      </p>
                    )}
                  </div>
                </div>
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function MarketSnapshot({ crop, snap }) {
  if (!crop) return null
  return (
    <section className="mt-8 ac-card p-5">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="ac-section-label">Market snapshot</p>
          <h2 className="mt-1 font-display text-2xl text-ink-900">{crop} — today</h2>
        </div>
        <Link to={`/market-prices/${encodeURIComponent(crop)}`} className="ac-btn-ghost">
          See prices →
        </Link>
      </div>
      {snap ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <p className="font-display text-3xl text-ink-900">
            ₹{fmtInr2(snap.avg)}<span className="text-base text-ink-500">/kg</span>
          </p>
          <span className="ac-chip ac-chip-ink">avg over {snap.count} mandi{snap.count === 1 ? '' : 's'}</span>
          <span className={`ac-chip ${snap.isLive ? 'ac-chip-success' : 'ac-chip-honey'}`}>
            {snap.isLive ? 'Live · AGMARKNET' : 'Sample data'}
          </span>
        </div>
      ) : (
        <p className="mt-3 text-sm text-ink-500">No price data on file for {crop} yet.</p>
      )}
    </section>
  )
}

function OffersBlock({ offers, status }) {
  if (status === 'loading') {
    return (
      <div className="ac-card mt-8 p-5">
        <div className="ac-skeleton h-4 w-32" />
        <div className="ac-skeleton mt-3 h-3 w-2/3" />
      </div>
    )
  }
  if (!offers.length) {
    return (
      <section className="mt-8">
        <p className="ac-section-label">Active offers</p>
        <h2 className="mt-1 font-display text-2xl text-ink-900">No offers yet</h2>
        <p className="mt-2 max-w-xl text-sm text-ink-500">
          When a buyer is interested in one of your lots, their offer
          shows up here so you can counter or accept it in a couple of
          taps.
        </p>
      </section>
    )
  }
  // Sort by best net realisation. We don't compute that client-side;
  // we sort by current price descending as a stand-in.
  const sorted = offers.slice().sort((a, b) => (b.current_price || 0) - (a.current_price || 0))
  return (
    <section className="mt-8">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="ac-section-label">Active offers</p>
          <h2 className="mt-1 font-display text-2xl text-ink-900">
            {offers.length} offer{offers.length === 1 ? '' : 's'} waiting
          </h2>
        </div>
        <Link to="/seller/offers" className="ac-btn-ghost">All offers →</Link>
      </div>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2">
        {sorted.slice(0, 4).map((o) => (
          <li key={o.public_id || o._id}>
            <Link
              to={`/seller/offers/${o.public_id}`}
              className="ac-card ac-card-hover block p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-ink-900">
                    {o.buyer_name || o.buyer_public_id || 'Buyer'}
                  </p>
                  <p className="text-xs text-ink-500">for {o._lot?.crop_name}</p>
                </div>
                <span className="ac-chip ac-chip-primary">₹{fmtInr2(o.current_price)}/kg</span>
              </div>
              {o.message && <p className="mt-2 line-clamp-2 text-sm text-ink-600">{o.message}</p>}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

function FpoBlock({ fpos }) {
  if (!fpos || fpos.length === 0) {
    return (
      <section className="mt-8 ac-card p-5">
        <p className="ac-section-label">FPOs</p>
        <h2 className="mt-1 font-display text-2xl text-ink-900">Sell together, earn more</h2>
        <p className="mt-2 max-w-xl text-sm text-ink-500">
          Farmer Producer Organisations let you pool produce with
          nearby growers. You can then negotiate directly with large
          buyers — no middlemen.
        </p>
        <div className="mt-4">
          <Link to="/fpos" className="ac-btn-secondary">Browse FPOs</Link>
        </div>
      </section>
    )
  }
  return (
    <section className="mt-8 ac-card p-5">
      <p className="ac-section-label">Your FPOs</p>
      <h2 className="mt-1 font-display text-2xl text-ink-900">
        {fpos.length} FPO{fpos.length === 1 ? '' : 's'} you're part of
      </h2>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {fpos.slice(0, 4).map((f) => (
          <li key={f._id || f.public_id} className="rounded-lg bg-earth-50 p-3">
            <p className="text-sm font-semibold text-ink-900">{f.name}</p>
            <p className="text-xs text-ink-500">{f.crop_focus || f.district || f.state}</p>
          </li>
        ))}
      </ul>
      <div className="mt-4">
        <Link to="/fpos" className="ac-btn-secondary">Open FPOs</Link>
      </div>
    </section>
  )
}

// ---- Main component ---------------------------------------------------

export default function FarmerDashboard() {
  const lots = useMyLots()
  const lotsStatus = useSelector(selectMyLotsStatus)
  const offers = useMyOffers()
  const fpos = useFpoSummary()
  const name = useSelector(selectName)
  usePageMeta({
    title: 'Farmer dashboard',
    description: 'Decide what to do with your crops, see live mandi prices, and respond to offers — all in one place.',
  })

  // Pick the most-common crop across the farmer's active lots for
  // the market snapshot. Falls back to the first lot's crop.
  const topCrop = useMemo(() => {
    const counts = new Map()
    for (const l of lots.filter((l) => l.status === 'ACTIVE')) {
      const k = l.crop_name
      counts.set(k, (counts.get(k) || 0) + 1)
    }
    if (counts.size === 0) return lots[0]?.crop_name || null
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]
  }, [lots])

  const snap = useMarketSnapshot(topCrop)

  // Attention items: actionable counts built from data this page
  // already loads. No new dispatches. Tones pick the most pressing
  // kind of attention: a countered offer (rust, action) outranks a
  // plain open offer (primary, info).
  const counteredCount = offers.list.filter((o) => o.status === 'COUNTERED').length
  const openCount = offers.list.filter((o) => o.status === 'OPEN').length
  const sellNowCount = lots.filter(
    (l) => l.status === 'ACTIVE' && l.decision && l.decision.recommendation === 'SELL_NOW'
  ).length
  const fpoInvites = fpos.filter(
    (f) => f && f.public_id && !f.is_member && f.member_count > 0
  ).length
  const attentionItems = [
    counteredCount > 0 && {
      id: 'countered-offers',
      label: 'countered offer(s) need your reply',
      count: counteredCount,
      tone: 'rust',
      to: '/seller/offers',
    },
    fpoInvites > 0 && {
      id: 'fpo-invites',
      label: 'FPO(s) you can join',
      count: fpoInvites,
      tone: 'honey',
      to: '/fpos',
    },
    openCount > 0 && {
      id: 'open-offers',
      label: 'open offer(s) from buyers',
      count: openCount,
      tone: 'primary',
      to: '/seller/offers',
    },
    sellNowCount > 0 && {
      id: 'sell-now',
      label: 'lot(s) flagged Sell now',
      count: sellNowCount,
      tone: 'honey',
      to: '/seller',
    },
  ].filter(Boolean)

  return (
    <>
      <Greeting name={name} />
      <AttentionStrip items={attentionItems} />
      <StatRow lots={lots} offers={offers.list} />
      <DecisionRollUp lots={lots} loading={lotsStatus === 'loading'} />
      <MarketSnapshot crop={topCrop} snap={snap} />
      <OffersBlock offers={offers.list} status={offers.status} />
      <FpoBlock fpos={fpos} />
      <p className="mt-12 text-center text-xs text-ink-400">
        AgroConnect · prices from AGMARKNET via data.gov.in
      </p>
    </>
  )
}
