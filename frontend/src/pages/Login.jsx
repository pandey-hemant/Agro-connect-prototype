/**
 * Login.jsx — the first page the user lands on.
 *
 * Flow:
 *   1. User opens "/" → Landing links to "/login".
 *   2. User enters email + password (or picks a demo account).
 *   3. POST /api/auth/login → if 200, store publicId + JWT in Redux
 *      and localStorage and redirect to the role's dashboard
 *      (or to a `?next=` redirect target if RequireAuth sent them
 *      here from a deep link).
 *
 * The "Use demo account" buttons are auto-login: they fill the form
 * and submit with the well-known demo password. The same password is
 * also shown next to the account so anyone can copy it manually.
 * The backend stores the demo passwords in plain text on the
 * `User.password` field (the seeder does that) and `User.verifyPassword`
 * checks them as a fallback for legacy demo accounts.
 *
 * The "Create account" link at the bottom opens /register, which
 * calls POST /api/auth/register and is the path for new users.
 */
import { useEffect, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import api from '../api/axios.js'
import {
  login,
  selectAuthStatus,
  selectAuthError,
  selectRole,
  selectPublicId,
} from '../redux/slices/authSlice.js'
import Brand from '../components/Brand.jsx'
import usePageMeta from '../hooks/usePageMeta.js'

const ROLE_LANDING = {
  SELLER: '/farmer',
  BUYER: '/buyer',
  FPO: '/fpos',
}

// Static demo passwords — the same values stored on the
// `User.password` field by the backend seeder for legacy demo
// accounts. The Login page also renders them inline so they're not a
// secret anyway. Centralised here so the "Use" button and the inline
// "password: …" line can never disagree.
const DEMO_PASSWORDS = {
  'farmer@agroconnect.demo': 'farmer123',
  'buyer@agroconnect.demo': 'buyer123',
  'fpofarmer@agroconnect.demo': 'farmer123',
}

function sanitizeNext(raw) {
  if (!raw) return null
  try {
    const decoded = decodeURIComponent(raw)
    if (typeof decoded !== 'string') return null
    if (!decoded.startsWith('/')) return null
    if (decoded.startsWith('//')) return null
    return decoded
  } catch {
    return null
  }
}

function Login() {
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const next = searchParams.get('next')
  const status = useSelector(selectAuthStatus)
  const error = useSelector(selectAuthError)
  const role = useSelector(selectRole)
  const publicId = useSelector(selectPublicId)
  usePageMeta({
    title: 'Sign in',
    description: 'Sign in to your AgroConnect account — farmers, buyers, and FPOs all sign in here.',
  })

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [demoAccounts, setDemoAccounts] = useState([])
  const [demoLoadError, setDemoLoadError] = useState(null)
  const [validationError, setValidationError] = useState(null)
  const [autoLogingInAs, setAutoLogingInAs] = useState(null)

  // Already logged in? Send the user to the right place on mount.
  // This is the refresh-survives-login case. If the URL carried a
  // `?next=` redirect target (from RequireAuth), honour it as long as
  // it's a local path (defence against open redirects).
  useEffect(() => {
    if (publicId && role) {
      const target = sanitizeNext(next) || ROLE_LANDING[role] || '/role'
      navigate(target, { replace: true })
    }
  }, [publicId, role, navigate, next])

  // Fetch the demo-accounts list for the "Use demo account" section.
  // Failures are non-fatal — the form still works without the list.
  useEffect(() => {
    let cancelled = false
    api
      .get('/auth/demo-accounts')
      .then((resp) => {
        if (cancelled) return
        const list = resp?.data?.results
        if (Array.isArray(list)) setDemoAccounts(list)
      })
      .catch((err) => {
        if (cancelled) return
        setDemoLoadError(
          err?.response?.data?.detail || 'Could not load sample accounts'
        )
      })
    return () => { cancelled = true }
  }, [])

  // One-click auto-login for the demo accounts. The demo passwords
  // are public (the seeder stores them in plain text on the
  // User.password field and the page already shows them inline), so
  // skipping the manual fill-in is fine and matches what the user
  // asked for ("Use Demo Farmer/Buyer/FPO" buttons).
  const onAutoDemoLogin = async (acc) => {
    if (!acc || !acc.email) return
    const plain = DEMO_PASSWORDS[acc.email]
    if (!plain) return
    setValidationError(null)
    setAutoLogingInAs(acc.email)
    setEmail(acc.email)
    setPassword(plain)
    const action = await dispatch(
      login({ email: acc.email, password: plain }),
    )
    setAutoLogingInAs(null)
    if (action.meta.requestStatus === 'fulfilled') {
      const u = action.payload?.user || {}
      const r = u.role
      const target = sanitizeNext(next)
        || (r && ROLE_LANDING[r])
        || '/role'
      navigate(target, { replace: true })
    }
  }

  // "Fill only" — useful when the user wants to type the password
  // themselves (e.g. when their password has been changed from the
  // public default).
  const onFillDemo = (acc) => {
    if (!acc || !acc.email) return
    setEmail(acc.email)
    setPassword('')
    setValidationError(null)
  }

  const onSubmit = async (e) => {
    e.preventDefault()
    setValidationError(null)
    if (!email.trim()) {
      setValidationError('Email is required')
      return
    }
    if (!password) {
      setValidationError('Password is required')
      return
    }
    const action = await dispatch(
      login({ email: email.trim().toLowerCase(), password })
    )
    if (action.meta.requestStatus === 'fulfilled') {
      const u = action.payload?.user || {}
      const r = u.role
      const target = sanitizeNext(next)
        || (r && ROLE_LANDING[r])
        || '/role'
      navigate(target, { replace: true })
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-primary-50 to-white">
      <header className="border-b border-primary-100 bg-white/70 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <a href="/" aria-label="AgroConnect home">
            <Brand variant="mark" size="md" />
          </a>
          <div className="flex items-center gap-4">
            <Link
              to="/register"
              className="text-sm font-medium text-primary-700 hover:text-primary-800"
            >
              Create account
            </Link>
            <a
              href="/"
              className="text-sm font-medium text-primary-700 hover:text-primary-800"
            >
              ← Back to home
            </a>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-12">
        <div className="grid gap-8 md:grid-cols-2">
          <section>
            <h1 className="text-3xl font-bold text-ink-900 sm:text-4xl">
              Sign in
            </h1>
            <p className="mt-3 text-ink-600">
              AgroConnect connects farmers, buyers, and FPOs. Sign in to
              access your dashboard, manage crop lots, and track deals.
            </p>

            <div className="mt-4 rounded-lg border border-honey-200 bg-honey-50 p-3 text-sm text-honey-800">
              <strong>Sample identities.</strong> The accounts
              below are pre-seeded sample identities for evaluation.
              Do not use a real password.
            </div>

            <form
              onSubmit={onSubmit}
              className="mt-6 space-y-4 rounded-2xl border border-earth-200 bg-white p-6 shadow-sm"
            >
              <div>
                <label
                  htmlFor="email"
                  className="block text-sm font-medium text-ink-700"
                >
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 block w-full rounded-lg border border-ink-200 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                  placeholder="you@example.com"
                />
              </div>
              <div>
                <label
                  htmlFor="password"
                  className="block text-sm font-medium text-ink-700"
                >
                  Password
                </label>
                <div className="mt-1 flex">
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="block w-full rounded-l-lg border border-ink-200 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="rounded-r-lg border border-l-0 border-ink-200 bg-earth-50 px-3 text-xs font-medium text-ink-600 hover:bg-earth-100"
                  >
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>

              {(validationError || error) && (
                <div className="rounded-lg border border-rust-200 bg-rust-50 p-3 text-sm text-rust-800">
                  {validationError || error}
                </div>
              )}

              <button
                type="submit"
                disabled={status === 'loading'}
                className="w-full rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-primary-700 disabled:opacity-50"
              >
                {status === 'loading' ? 'Signing in…' : 'Sign in'}
              </button>

              <p className="text-center text-sm text-ink-600">
                New here?{' '}
                <Link
                  to="/register"
                  className="font-medium text-primary-700 hover:text-primary-800"
                >
                  Create an account
                </Link>
              </p>
            </form>
          </section>

          <section>
            <div className="rounded-2xl border border-primary-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-ink-900">
                Use a sample account
              </h2>
              <p className="mt-1 text-sm text-ink-600">
                One click to sign in as a pre-seeded sample identity. The
                same password is shown next to each account so you can
                also type it manually.
              </p>

              {demoLoadError && (
                <p className="mt-3 rounded-lg border border-honey-200 bg-honey-50 p-2 text-xs text-honey-800">
                  {demoLoadError}
                </p>
              )}

              <ul className="mt-4 space-y-3">
                {(demoAccounts || []).map((acc) => {
                  if (!acc || !acc.email) return null
                  const plainPassword = DEMO_PASSWORDS[acc.email] || ''
                  const isAuto = autoLogingInAs === acc.email
                  return (
                    <li
                      key={acc.email}
                      className="rounded-xl border border-earth-200 bg-earth-50 p-3"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium text-ink-900">
                            {acc.display_name || acc.email}
                          </p>
                          <p className="text-xs text-ink-500">
                            {acc.email}
                          </p>
                          <p className="mt-1 text-xs text-ink-600">
                            Role:{' '}
                            <span className="rounded-full bg-primary-100 px-2 py-0.5 text-[10px] font-medium text-primary-800">
                              {acc.role}
                            </span>
                          </p>
                          {plainPassword && (
                            <p className="mt-1 font-mono text-xs text-ink-700">
                              password: {plainPassword}
                            </p>
                          )}
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <button
                            type="button"
                            onClick={() => onAutoDemoLogin(acc)}
                            disabled={status === 'loading' || isAuto}
                            className="rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-primary-700 disabled:opacity-50"
                          >
                            {isAuto ? 'Signing in…' : 'Use sample account'}
                          </button>
                          <button
                            type="button"
                            onClick={() => onFillDemo(acc)}
                            className="text-[11px] font-medium text-primary-700 hover:text-primary-800"
                          >
                            Just fill email
                          </button>
                        </div>
                      </div>
                    </li>
                  )
                })}
                {demoAccounts.length === 0 && !demoLoadError && (
                  <li className="rounded-xl border border-dashed border-ink-200 p-3 text-xs text-ink-500">
                    Sample accounts loading…
                  </li>
                )}
              </ul>

              <p className="mt-4 text-xs text-ink-500">
                After signing in you'll be sent straight to your role's
                dashboard. Use the "Logout" link in the top bar to
                change identity.
              </p>
            </div>

            <div className="mt-4 rounded-2xl border border-earth-200 bg-white p-6 shadow-sm">
              <h3 className="text-sm font-semibold text-ink-900">
                What happens after login?
              </h3>
              <ul className="mt-2 space-y-1 text-sm text-ink-700">
                <li>• A signed JWT is stored in your browser and sent on every request.</li>
                <li>• Passwords are bcrypt-hashed on the server (pre-seeded sample accounts are an exception).</li>
                <li>• Refresh the page and you'll stay signed in.</li>
                <li>• Use "Logout" to clear your session.</li>
              </ul>
            </div>
          </section>
        </div>
      </main>
    </div>
  )
}

export default Login
