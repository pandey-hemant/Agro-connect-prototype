import { useEffect, useMemo, useRef } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { Link } from 'react-router-dom'
import {
  fetchHealth,
  selectEffectiveHealth,
  selectHealthConsecutiveFailures,
  selectHealthData,
  selectHealthError,
  selectHealthLastCheckedAt,
  selectHealthStatus,
} from '../redux/slices/healthSlice.js'
import Brand from '../components/Brand.jsx'
import usePageMeta from '../hooks/usePageMeta.js'

// One pill, one set of styles. The colour is driven by `kind` so
// "Online" and "Degraded" are visually distinguishable and so the
// "Checking…" placeholder doesn't flash red on first paint.
const STATUS_STYLES = {
  online: 'bg-primary-100 text-primary-800',
  recheck: 'bg-primary-100 text-primary-800',
  degraded: 'bg-honey-100 text-honey-800',
  checking: 'bg-honey-100 text-honey-800',
  offline: 'bg-rust-100 text-rust-800',
  idle: 'bg-earth-200 text-ink-700',
}

function StatusPill({ kind, label }) {
  const classes = STATUS_STYLES[kind] || STATUS_STYLES.idle
  return (
    <span
      data-status={kind}
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium ${classes}`}
    >
      <span className="h-2 w-2 rounded-full bg-current opacity-70" />
      {label}
    </span>
  )
}

// "x seconds ago" — only re-renders when the parent re-renders.
function RelativeTime({ iso }) {
  if (!iso) return null
  const now = Date.now()
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return null
  const seconds = Math.max(0, Math.round((now - then) / 1000))
  let label
  if (seconds < 5) label = 'just now'
  else if (seconds < 60) label = `${seconds}s ago`
  else if (seconds < 3600) label = `${Math.round(seconds / 60)} min ago`
  else label = `${Math.round(seconds / 3600)} h ago`
  return <span className="text-xs text-ink-500">checked {label}</span>
}

function Landing() {
  const dispatch = useDispatch()
  const effective = useSelector(selectEffectiveHealth)
  usePageMeta({
    title: 'AgroConnect — Decide, sell, and earn more',
    description: 'AgroConnect helps farmers choose where to sell, see live mandi prices, compare offers, and connect directly with buyers. Built for Indian agriculture.',
  })
  const status = useSelector(selectHealthStatus)
  const data = useSelector(selectHealthData)
  const error = useSelector(selectHealthError)
  const lastCheckedAt = useSelector(selectHealthLastCheckedAt)
  const consecutiveFailures = useSelector(selectHealthConsecutiveFailures)

  // Adaptive poll interval: 15s when the backend looks healthy,
  // 5s after one or more consecutive failures so a restarted
  // backend is detected within a few seconds. The interval is
  // tracked in a ref so a failure mid-flight re-arms it.
  const tickRef = useRef(null)
  useEffect(() => {
    let cancelled = false
    const arm = (ms) => {
      if (cancelled) return
      if (tickRef.current) clearTimeout(tickRef.current)
      tickRef.current = setTimeout(() => {
        if (cancelled) return
        dispatch(fetchHealth())
      }, ms)
    }
    // Fire one immediately on mount so the pill updates without
    // waiting a full interval.
    dispatch(fetchHealth())
    arm(consecutiveFailures > 0 ? 5000 : 15000)
    return () => {
      cancelled = true
      if (tickRef.current) clearTimeout(tickRef.current)
    }
  }, [dispatch, consecutiveFailures])

  // When the slice flips to `succeeded` or `failed`, the
  // extraReducers update `consecutiveFailures`, which re-runs this
  // effect and re-arms the timer at the new cadence.
  const debugPayload = useMemo(() => {
    if (status === 'succeeded') return data
    if (status === 'failed') {
      return { error: error || 'unreachable', status: 'unreachable' }
    }
    return null
  }, [status, data, error])

  return (
    <div className="min-h-screen bg-gradient-to-b from-primary-50 to-white">
      <header className="border-b border-primary-100 bg-white/70 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-4">
          <Brand variant="mark" size="md" />
          <div className="flex items-center gap-3">
            <StatusPill kind={effective.kind} label={effective.label} />
            <RelativeTime iso={lastCheckedAt} />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-16">
        <section className="text-center">
          <h1 className="text-4xl font-bold tracking-tight text-ink-900 sm:text-5xl">
            Strengthen Market Linkages for Farmers
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-ink-600">
            AgroConnect connects farmers, FPOs, and buyers
            through transparent pricing and direct trade.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-4">
            <Link
              to="/login"
              className="inline-flex items-center rounded-lg bg-primary-600 px-6 py-3 text-base font-medium text-white shadow-sm transition hover:bg-primary-700"
            >
              Sign in →
            </Link>
            <Link
              to="/fpos"
              className="inline-flex items-center rounded-lg border border-primary-200 bg-white px-6 py-3 text-base font-medium text-primary-700 transition hover:bg-primary-50"
            >
              FPOs / Groups
            </Link>
            <Link
              to="/market-prices"
              className="inline-flex items-center rounded-lg border border-primary-200 bg-white px-6 py-3 text-base font-medium text-primary-700 transition hover:bg-primary-50"
            >
              Market Prices
            </Link>
          </div>
        </section>

        <section className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {[
            { title: 'Direct Trade', body: 'Connect farmers with verified buyers, cutting out middlemen.', to: '/buyers' },
            { title: 'Market Prices', body: 'Transparent, location-aware pricing to support fair deals.', to: '/market-prices' },
            { title: 'Farmer Collectives', body: 'Tools for FPOs to coordinate and negotiate as a group.', to: '/fpos' },
          ].map((card) => (
            <div
              key={card.title}
              className="rounded-xl border border-earth-200 bg-white p-6 shadow-sm transition hover:shadow-md"
            >
              <h3 className="text-lg font-semibold text-ink-900">{card.title}</h3>
              <p className="mt-2 text-sm text-ink-600">{card.body}</p>
              <Link
                to={card.to}
                className="mt-3 inline-block text-sm font-medium text-primary-700 hover:text-primary-800"
              >
                Open {card.title.toLowerCase()} →
              </Link>
            </div>
          ))}
        </section>

        <section className="mt-16">
          <div className="rounded-2xl border border-primary-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold text-ink-900">Backend Status</h2>
            <p className="mt-1 text-sm text-ink-600">
              Live response from the Node/Express <code className="rounded bg-earth-100 px-1 py-0.5">/api/health</code> endpoint.
              Polled every 15s when healthy, every 5s after a failure.
            </p>
            <div className="mt-4 rounded-lg bg-earth-50 p-4 font-mono text-sm text-ink-800">
              {debugPayload && (
                <pre className="whitespace-pre-wrap break-all">
                  {JSON.stringify(debugPayload, null, 2)}
                </pre>
              )}
              {!debugPayload && status === 'loading' && (
                <span>Requesting /api/health…</span>
              )}
              {!debugPayload && status === 'idle' && <span>Not yet requested.</span>}
            </div>
            <button
              onClick={() => dispatch(fetchHealth())}
              className="mt-4 inline-flex items-center rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-primary-700"
            >
              Refresh
            </button>
          </div>
        </section>
      </main>

      <footer className="border-t border-earth-200 bg-white py-6">
        <div className="mx-auto max-w-6xl px-6 text-center text-sm text-ink-500">
          AgroConnect · Node/Express backend · Transaction Trust phase
        </div>
      </footer>
    </div>
  )
}

export default Landing
