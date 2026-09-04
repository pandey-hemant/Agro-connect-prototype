/**
 * components/NotFound.jsx — the redesigned 404.
 *
 * Deliberate choices:
 *   - No pictogram. A "made" 404 should not rely on an illustration
 *     to feel deliberate; the typography and a small hand-drawn
 *     glyph carry the weight.
 *   - Context-aware CTAs: home (role-aware), switch role, browse
 *     market prices — the three real paths a user could want.
 *   - Show the actual path the user tried so it doesn't look like
 *     the app "forgot" where they were.
 *   - No giant hero. A 404 is a service message, not a billboard.
 */
import { Link, useLocation } from 'react-router-dom'
import { useSelector } from 'react-redux'
import { selectIsAuthed, selectRole } from '../redux/slices/authSlice.js'
import Brand from './Brand.jsx'

export default function NotFound() {
  const isAuthed = useSelector(selectIsAuthed)
  const role = useSelector(selectRole)
  const location = useLocation()
  const home = isAuthed ? (role === 'BUYER' ? '/buyer' : '/seller') : '/'
  const tried = location?.pathname || ''

  return (
    <div className="flex min-h-screen flex-col bg-earth-50 text-ink-800">
      <header className="border-b border-earth-200 bg-white">
        <div className="mx-auto flex h-14 max-w-6xl items-center px-4 sm:px-6">
          <Link to={home} aria-label="AgroConnect home">
            <Brand size="sm" />
          </Link>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center px-4 py-10 text-center sm:px-6 animate-fade-in">
        <p
          aria-hidden="true"
          className="font-display text-[7rem] font-medium leading-none text-primary-700 sm:text-[9rem]"
        >
          404
        </p>
        <h1 className="mt-4 font-display text-2xl text-ink-900 sm:text-3xl">
          We can't find that page
        </h1>
        <p className="mt-3 max-w-md text-ink-500">
          The link you followed may be broken, or the page may have moved
          when we redesigned the app. Try heading home — the journey you
          came for is one click away.
        </p>
        {tried && (
          <p className="mt-3 max-w-md rounded-md border border-earth-200 bg-white px-3 py-1.5 font-mono text-xs text-ink-500">
            Path:&nbsp;{tried}
          </p>
        )}
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Link to={home} className="ac-btn-primary">
            <svg
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M3 11.5 12 4l9 7.5" />
              <path d="M5 10v9a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9" />
            </svg>
            Go to home
          </Link>
          {isAuthed && (
            <Link to="/role" className="ac-btn-secondary">
              Switch role
            </Link>
          )}
          <Link to="/market-prices" className="ac-btn-ghost">
            Browse market prices
          </Link>
        </div>
        <p className="mt-8 text-xs text-ink-400">
          Tip — the side bar on the left (or the bottom bar on mobile)
          always shows the way back to where you want to go.
        </p>
      </main>
      <footer className="border-t border-earth-200 py-4 text-center text-xs text-ink-400">
        AgroConnect · Built for Indian agriculture
      </footer>
    </div>
  )
}
