/**
 * Register.jsx — create a new AgroConnect account.
 *
 * Posts to /api/auth/register. The backend validates required fields,
 * checks for duplicate email, bcrypt-hashes the password, and returns
 * a `{ user, token }` payload — so the user is logged in immediately
 * on success. The same token goes through the auth slice the Login
 * page uses, so the redirect logic is identical.
 *
 * Validation mirrors the backend (single source of truth would be a
 * shared schema library, but the prototype keeps the rules inline):
 *   - name         non-empty
 *   - email        simple shape + unique on the server
 *   - phone        optional, trimmed
 *   - password     ≥ 6 characters
 *   - confirm      matches password
 *   - role         SELLER | BUYER | FPO
 *
 * Errors from the server are surfaced as a single inline message.
 */
import { useEffect, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  register,
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

const ROLE_DESCRIPTIONS = {
  SELLER: 'Sell your produce. List crop lots, see buyer demand, accept offers.',
  BUYER: 'Source produce. Browse lots, post demands, message farmers.',
  FPO: 'Aggregate members. Co-ordinate harvest, share logistics, bulk-sell.',
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

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

function Register() {
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const next = searchParams.get('next')
  const status = useSelector(selectAuthStatus)
  const error = useSelector(selectAuthError)
  const role = useSelector(selectRole)
  const publicId = useSelector(selectPublicId)
  usePageMeta({
    title: 'Create account',
    description: 'Create your AgroConnect account — choose your role and start in under a minute.',
  })

  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    password: '',
    confirm: '',
    role: 'SELLER',
  })
  const [clientError, setClientError] = useState(null)
  const [showPassword, setShowPassword] = useState(false)

  // If the user is already signed in, don't show the form at all.
  useEffect(() => {
    if (publicId && role) {
      const target = sanitizeNext(next) || ROLE_LANDING[role] || '/role'
      navigate(target, { replace: true })
    }
  }, [publicId, role, navigate, next])

  const update = (k) => (e) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  const validate = () => {
    if (!form.name.trim()) return 'Full name is required'
    if (!form.email.trim()) return 'Email is required'
    if (!EMAIL_RE.test(form.email.trim())) return 'A valid email is required'
    if (!form.password) return 'Password is required'
    if (form.password.length < 6) return 'Password must be at least 6 characters'
    if (form.password !== form.confirm) return 'Passwords do not match'
    if (!['SELLER', 'BUYER', 'FPO'].includes(form.role)) return 'Pick a role'
    return null
  }

  const onSubmit = async (e) => {
    e.preventDefault()
    setClientError(null)
    const v = validate()
    if (v) {
      setClientError(v)
      return
    }
    const action = await dispatch(
      register({
        name: form.name.trim(),
        email: form.email.trim().toLowerCase(),
        phone: form.phone.trim(),
        password: form.password,
        confirm_password: form.confirm,
        role: form.role,
      }),
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
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <a href="/" aria-label="AgroConnect home">
            <Brand variant="mark" size="md" />
          </a>
          <Link
            to="/login"
            className="text-sm font-medium text-primary-700 hover:text-primary-800"
          >
            ← Back to sign in
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="text-3xl font-bold text-ink-900">Create account</h1>
        <p className="mt-2 text-ink-600">
          Sign up as a farmer, buyer, or FPO. Accounts use a bcrypt-hashed
          password and a signed token so you stay signed in across
          refreshes.
        </p>

        <div className="mt-4 rounded-lg border border-honey-200 bg-honey-50 p-3 text-sm text-honey-800">
          <strong>Sample identities only.</strong> Don't reuse a real-world password.
          For evaluation you can also use one of the pre-seeded sample
          accounts on the{' '}
          <Link to="/login" className="underline">sign in page</Link>.
        </div>

        <form
          onSubmit={onSubmit}
          className="mt-6 space-y-4 rounded-2xl border border-earth-200 bg-white p-6 shadow-sm"
        >
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-ink-700">
              Full name
            </label>
            <input
              id="name"
              type="text"
              autoComplete="name"
              value={form.name}
              onChange={update('name')}
              className="mt-1 block w-full rounded-lg border border-ink-200 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
              placeholder="Ramesh Kumar"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-ink-700">
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="username"
                value={form.email}
                onChange={update('email')}
                className="mt-1 block w-full rounded-lg border border-ink-200 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                placeholder="you@example.com"
              />
            </div>
            <div>
              <label htmlFor="phone" className="block text-sm font-medium text-ink-700">
                Phone <span className="text-ink-400">(optional)</span>
              </label>
              <input
                id="phone"
                type="tel"
                autoComplete="tel"
                value={form.phone}
                onChange={update('phone')}
                className="mt-1 block w-full rounded-lg border border-ink-200 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                placeholder="+91 9999999999"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-ink-700">
                Password
              </label>
              <div className="mt-1 flex">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={form.password}
                  onChange={update('password')}
                  className="block w-full rounded-l-lg border border-ink-200 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                  placeholder="At least 6 characters"
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
            <div>
              <label htmlFor="confirm" className="block text-sm font-medium text-ink-700">
                Confirm password
              </label>
              <input
                id="confirm"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                value={form.confirm}
                onChange={update('confirm')}
                className="mt-1 block w-full rounded-lg border border-ink-200 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                placeholder="Re-enter password"
              />
            </div>
          </div>

          <fieldset>
            <legend className="text-sm font-medium text-ink-700">I am a…</legend>
            <div className="mt-2 grid gap-3 sm:grid-cols-3">
              {['SELLER', 'BUYER', 'FPO'].map((r) => (
                <label
                  key={r}
                  className={`flex cursor-pointer flex-col rounded-lg border p-3 text-sm transition ${
                    form.role === r
                      ? 'border-primary-500 bg-primary-50 ring-1 ring-primary-500'
                      : 'border-ink-200 hover:border-primary-300'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-ink-900">
                      {r === 'SELLER' ? 'Farmer / Seller' : r === 'BUYER' ? 'Buyer' : 'FPO'}
                    </span>
                    <input
                      type="radio"
                      name="role"
                      value={r}
                      checked={form.role === r}
                      onChange={update('role')}
                      className="h-4 w-4 text-primary-600"
                    />
                  </div>
                  <span className="mt-1 text-xs text-ink-600">
                    {ROLE_DESCRIPTIONS[r]}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {(clientError || error) && (
            <div className="rounded-lg border border-rust-200 bg-rust-50 p-3 text-sm text-rust-800">
              {clientError || error}
            </div>
          )}

          <button
            type="submit"
            disabled={status === 'loading'}
            className="w-full rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-primary-700 disabled:opacity-50"
          >
            {status === 'loading' ? 'Creating account…' : 'Create account'}
          </button>

          <p className="text-center text-sm text-ink-600">
            Already have an account?{' '}
            <Link
              to="/login"
              className="font-medium text-primary-700 hover:text-primary-800"
            >
              Sign in
            </Link>
          </p>
        </form>
      </main>
    </div>
  )
}

export default Register
