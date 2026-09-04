import { useEffect, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  setRole,
  selectRole,
  demoLogin,
  selectAuthStatus,
  selectAuthError,
  selectActiveFpo,
  selectDisplayName,
  logout,
} from '../redux/slices/authSlice.js'
import { fetchBuyers } from '../redux/slices/buyerSlice.js'
import { fetchFpos } from '../redux/slices/fpoSlice.js'
import Brand from '../components/Brand.jsx'
import usePageMeta from '../hooks/usePageMeta.js'

/**
 * RoleSelect — entry page after Landing, and the "Switch role" page.
 *
 * Three role cards: SELLER (Farmer), BUYER (Trader), FPO (Group).
 * On click, dispatches demoLogin thunk (talks to /api/auth/demo-login)
 * and navigates to the appropriate dashboard. The demoLogin thunk
 * receives the role and (for buyer) the picked buyer. The picked FPO
 * is only used locally for the dashboard; the backend stores
 * active_fpo_id once a /api/fpos create happens.
 *
 * Switch-role behaviour:
 *   • If the user lands on /role with no current role → first-time pick.
 *   • If the user lands on /role?switch=1 (i.e. clicked "Switch role"
 *     from a dashboard), the picker is shown regardless of current role.
 *   • If the user lands on /role without ?switch=1 and already has a role,
 *     they are sent straight to that role's dashboard.
 */
function RoleSelect() {
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const role = useSelector(selectRole)
  const activeFpo = useSelector(selectActiveFpo)
  const displayName = useSelector(selectDisplayName)
  const authStatus = useSelector(selectAuthStatus)
  const authError = useSelector(selectAuthError)
  const [searchParams] = useSearchParams()
  const isSwitching = searchParams.get('switch') === '1'
  usePageMeta({
    title: isSwitching ? 'Switch role' : 'Choose your role',
    description: 'Sign in as a farmer, buyer, or FPO. You can switch any time.',
  })

  const handleSignOut = () => {
    dispatch(logout())
    navigate('/login', { replace: true })
  }

  // Buyers + FPOs lists for the picker
  const buyers = useSelector((s) => s.buyers?.list || [])
  const fpos = useSelector((s) => s.fpos?.list || [])
  const [selectedBuyer, setSelectedBuyer] = useState(null)
  const [selectedFpo, setSelectedFpo] = useState(activeFpo?.public_id || null)

  useEffect(() => {
    dispatch(fetchBuyers())
    dispatch(fetchFpos())
  }, [dispatch])

  // First-time / no-role entry: if a role is already set (and we are NOT
  // explicitly switching), bounce to the right dashboard.
  useEffect(() => {
    if (isSwitching) return
    if (role === 'SELLER') navigate('/seller', { replace: true })
    if (role === 'BUYER') navigate('/buyer', { replace: true })
    if (role === 'FPO') navigate('/fpos', { replace: true })
  }, [role, navigate, isSwitching])

  const choose = (next) => {
    dispatch(setRole(next))
    if (next === 'SELLER') {
      dispatch(demoLogin({ role: 'SELLER' })).then((a) => {
        if (a.meta.requestStatus === 'fulfilled') navigate('/seller', { replace: true })
      })
    } else if (next === 'BUYER') {
      const buyerId = selectedBuyer?.id
      dispatch(demoLogin({ role: 'BUYER', buyerId })).then((a) => {
        if (a.meta.requestStatus === 'fulfilled') navigate('/buyer', { replace: true })
      })
    } else if (next === 'FPO') {
      const fpoId = selectedFpo || undefined
      dispatch(demoLogin({ role: 'FPO', fpoId })).then((a) => {
        if (a.meta.requestStatus === 'fulfilled') navigate('/fpos', { replace: true })
      })
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-primary-50 to-white">
      <header className="border-b border-primary-100 bg-white/70 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-4">
          <Link to="/" aria-label="AgroConnect home">
            <Brand variant="mark" size="md" />
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            {isSwitching && role && (
              <span className="rounded-full bg-primary-50 px-3 py-1 text-xs font-medium text-primary-800">
                Currently signed in as {role}{displayName ? ` (${displayName})` : ''}
              </span>
            )}
            <Link
              to="/login"
              className="rounded-lg border border-primary-200 bg-white px-3 py-1.5 text-sm font-medium text-primary-700 transition hover:bg-primary-50"
            >
              Sign in as different user
            </Link>
            <button
              type="button"
              onClick={handleSignOut}
              className="rounded-lg border border-rust-200 bg-white px-3 py-1.5 text-sm font-medium text-rust-800 transition hover:bg-rust-50"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-12">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-ink-900 sm:text-4xl">
            {isSwitching ? 'Switch role' : 'How do you want to use AgroConnect?'}
          </h1>
          <p className="mt-3 text-lg text-ink-600">
            {isSwitching
              ? 'You are currently signed in as ' + (role || 'none') + '. Choose a different role to continue.'
              : 'Pick a role to continue. You can change this any time from the top bar.'}
          </p>
        </div>

        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <button
            onClick={() => choose('SELLER')}
            disabled={authStatus === 'loading'}
            className="rounded-2xl border-2 border-primary-200 bg-white p-8 text-left shadow-sm transition hover:border-primary-500 hover:shadow-md disabled:opacity-50"
          >
            <div className="text-4xl">🌾</div>
            <h2 className="mt-3 text-2xl font-semibold text-ink-900">I'm a Seller (Farmer)</h2>
            <p className="mt-2 text-sm text-ink-600">
              List a crop lot, see buyer matches, accept offers, track delivery and payment.
            </p>
            <ul className="mt-4 space-y-1 text-sm text-ink-700">
              <li>• Create and manage crop lots</li>
              <li>• See matched buyers and offers</li>
              <li>• Negotiate and accept the best deal</li>
              <li>• Track deal delivery and payment</li>
            </ul>
            <div className="mt-6 inline-flex items-center rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white">
              Continue as Seller →
            </div>
          </button>

          <button
            onClick={() => choose('BUYER')}
            disabled={authStatus === 'loading'}
            className="rounded-2xl border-2 border-primary-200 bg-white p-8 text-left shadow-sm transition hover:border-primary-500 hover:shadow-md disabled:opacity-50"
          >
            <div className="text-4xl">🛒</div>
            <h2 className="mt-3 text-2xl font-semibold text-ink-900">I'm a Buyer (Trader)</h2>
            <p className="mt-2 text-sm text-ink-600">
              Browse listed produce, place offers, negotiate, and accept the farmer's counter.
            </p>
            <ul className="mt-4 space-y-1 text-sm text-ink-700">
              <li>• Browse available crop lots</li>
              <li>• Place offers on produce</li>
              <li>• Counter and accept prices</li>
              <li>• Manage purchases and deliveries</li>
            </ul>
            <div className="mt-3 rounded-lg border border-primary-100 bg-primary-50 p-2 text-xs text-primary-800">
              Optional: pick a sample buyer
            </div>
            <select
              value={selectedBuyer?.id || ''}
              onChange={(e) => {
                const b = buyers.find((x) => String(x.id) === e.target.value)
                setSelectedBuyer(b || null)
              }}
              className="mt-2 w-full rounded-lg border border-ink-200 px-2 py-1.5 text-sm"
              onClick={(e) => e.stopPropagation()}
            >
              <option value="">(no buyer — use default)</option>
              {buyers.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({b.location})
                </option>
              ))}
            </select>
            <div className="mt-3 inline-flex items-center rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white">
              Continue as Buyer →
            </div>
          </button>

          <button
            onClick={() => choose('FPO')}
            disabled={authStatus === 'loading'}
            className="rounded-2xl border-2 border-primary-200 bg-white p-8 text-left shadow-sm transition hover:border-primary-500 hover:shadow-md disabled:opacity-50"
          >
            <div className="text-4xl">🤝</div>
            <h2 className="mt-3 text-2xl font-semibold text-ink-900">I'm an FPO (Group)</h2>
            <p className="mt-2 text-sm text-ink-600">
              Aggregate member lots, group-sell, and reach larger buyers.
            </p>
            <ul className="mt-4 space-y-1 text-sm text-ink-700">
              <li>• Create or join an FPO</li>
              <li>• Pool member crop lots</li>
              <li>• Show aggregated quantity per crop</li>
              <li>• Group-sell to larger buyers</li>
            </ul>
            <div className="mt-3 rounded-lg border border-primary-100 bg-primary-50 p-2 text-xs text-primary-800">
              Optional: pick a sample FPO
            </div>
            <select
              value={selectedFpo || ''}
              onChange={(e) => setSelectedFpo(e.target.value || null)}
              className="mt-2 w-full rounded-lg border border-ink-200 px-2 py-1.5 text-sm"
              onClick={(e) => e.stopPropagation()}
            >
              <option value="">(no FPO — create one on dashboard)</option>
              {fpos.map((f) => (
                <option key={f.public_id} value={f.public_id}>
                  {f.name} ({f.location})
                </option>
              ))}
            </select>
            <div className="mt-3 inline-flex items-center rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white">
              Continue as FPO →
            </div>
          </button>
        </div>

        {authError && (
          <div className="mt-6 rounded-lg border border-rust-200 bg-rust-50 p-3 text-sm text-rust-800">
            {authError}
          </div>
        )}

        <p className="mt-8 text-center text-xs text-ink-500">
          This role gate scopes sample data; real authentication would
          be wired to a regulated identity provider in production.
        </p>
      </main>
    </div>
  )
}

export default RoleSelect
