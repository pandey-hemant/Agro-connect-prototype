/**
 * components/TopBar.jsx — the new, redesigned application top bar.
 *
 * The original design had a horizontal header with the brand,
 * role badge, name/email, and logout. It was rendered on every
 * page, often alongside a per-page gradient header, and the visual
 * language drifted page to page.
 *
 * This version is deliberately minimal:
 *   - the brand glyph and wordmark on the left
 *   - an optional `title` slot for the page headline (so the page
 *     doesn't need its own hero strip)
 *   - a small right cluster with the role chip and a profile menu
 *
 * It pairs with `SideNav` (the left rail on desktop, bottom nav on
 * mobile). The two together form the `AppShell`.
 *
 * Backwards compatible: existing pages that import `TopBar` and
 * pass `children` still work — `children` is rendered to the right
 * of the brand on screens wide enough, and below the brand on
 * narrow screens.
 */
import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useDispatch, useSelector } from 'react-redux'
import {
  selectIsAuthed,
  selectRole,
  selectName,
  selectEmail,
  logout,
  switchRole,
} from '../redux/slices/authSlice.js'
import Brand from './Brand.jsx'

function useOutsideClick(ref, handler) {
  useEffect(() => {
    function onClick(e) {
      if (ref.current && !ref.current.contains(e.target)) handler()
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [ref, handler])
}

function ProfileMenu({ name, email, role, onLogout, onSwitchRole }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)
  useOutsideClick(wrapRef, () => setOpen(false))
  const initials = (name || email || 'A').trim().slice(0, 1).toUpperCase()
  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-full border border-earth-200 bg-white py-1 pl-1 pr-2.5 text-sm font-medium text-ink-700 shadow-sm transition hover:border-primary-200 hover:bg-primary-50"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary-700 text-xs font-semibold text-white">
          {initials}
        </span>
        <span className="hidden sm:inline">{name || email || 'You'}</span>
        <svg viewBox="0 0 24 24" className="h-4 w-4 text-ink-400" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-card border border-earth-200 bg-white shadow-card-hover animate-fade-in"
        >
          <div className="border-b border-earth-100 bg-earth-50 px-4 py-3">
            <p className="truncate text-sm font-semibold text-ink-900">{name || 'You'}</p>
            <p className="truncate text-xs text-ink-500">{email || ''}</p>
            <span className="ac-chip ac-chip-primary mt-2">
              {role === 'BUYER' ? 'Buyer' : 'Farmer / Seller'}
            </span>
          </div>
          <div className="p-1">
            <Link
              to="/role"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink-700 hover:bg-earth-100"
              role="menuitem"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4 text-ink-400" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                <path d="M4 7h12l-3-3M20 17H8l3 3" />
              </svg>
              Switch role
            </Link>
            <button
              type="button"
              onClick={() => { onSwitchRole(); setOpen(false) }}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink-700 hover:bg-earth-100"
              role="menuitem"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4 text-ink-400" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              Quick role switch
            </button>
            <button
              type="button"
              onClick={() => { onLogout(); setOpen(false) }}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-rust-600 hover:bg-rust-50"
              role="menuitem"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                <path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4" />
                <path d="M10 17 5 12l5-5" /><path d="M5 12h11" />
              </svg>
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function TopBar({ title, subtitle, children, hideAuth = false }) {
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const location = useLocation()
  const isAuthed = useSelector(selectIsAuthed)
  const role = useSelector(selectRole)
  const name = useSelector(selectName)
  const email = useSelector(selectEmail)

  const onLogout = () => {
    dispatch(logout())
    navigate('/')
  }
  const onSwitchRole = () => {
    const next = role === 'SELLER' ? 'BUYER' : 'SELLER'
    dispatch(switchRole(next))
    navigate(next === 'SELLER' ? '/seller' : '/buyer')
  }

  return (
    <header
      className="sticky top-0 z-30 border-b border-earth-200 bg-white/85 backdrop-blur"
    >
      <div className="flex h-14 items-center gap-3 px-4 sm:px-6 lg:px-8">
        {/* Brand: links to the role-appropriate home when authed, else to / */}
        <Link to={isAuthed && role === 'BUYER' ? '/buyer' : isAuthed ? '/seller' : '/'} className="flex-shrink-0">
          <Brand size="sm" />
        </Link>
        {/* Page-level title in the centre. Hidden on small screens
            because the page itself renders its headline. */}
        {(title || subtitle) && (
          <div className="ml-2 hidden min-w-0 flex-1 border-l border-earth-200 pl-4 md:block">
            {title && (
              <p className="truncate text-sm font-semibold text-ink-900">{title}</p>
            )}
            {subtitle && (
              <p className="truncate text-xs text-ink-500">{subtitle}</p>
            )}
          </div>
        )}
        <div className="ml-auto flex items-center gap-2">
          {children}
          {!hideAuth && isAuthed && (
            <ProfileMenu
              name={name}
              email={email}
              role={role}
              onLogout={onLogout}
              onSwitchRole={onSwitchRole}
            />
          )}
          {!hideAuth && !isAuthed && (
            <div className="flex items-center gap-2">
              <Link
                to="/login"
                state={{ from: location.pathname }}
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-ink-700 hover:bg-earth-100"
              >
                Sign in
              </Link>
              <Link to="/register" className="ac-btn-primary py-1.5">
                Get started
              </Link>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
