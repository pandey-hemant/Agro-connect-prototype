/**
 * components/AppShell.jsx — the redesigned application shell.
 *
 * Every authed page mounts inside this so the side rail, top bar,
 * container width, and bottom-nav safe area are all consistent.
 *
 * The shell intentionally does NOT include per-page content — pages
 * render their own <main> with `ac-container` so the page-specific
 * spacing is in the page, not the shell.
 *
 * Public pages (Landing, Login, Register, RoleSelect) bypass the
 * shell entirely. They get just the top bar with "Sign in / Get
 * started" — the landing page has its own hero treatment.
 */
import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import TopBar from './TopBar.jsx'
import SideNav from './SideNav.jsx'
import { useSelector } from 'react-redux'
import { selectIsAuthed } from '../redux/slices/authSlice.js'

export default function AppShell({ title, subtitle, topBarExtras, children }) {
  const isAuthed = useSelector(selectIsAuthed)
  const location = useLocation()

  // When the route changes, scroll the window to the top. Without
  // this, SPA navigations keep the previous scroll position which
  // is jarring inside an app with this much vertical content.
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' })
  }, [location.pathname])

  return (
    <div className="min-h-screen bg-earth-50 text-ink-800">
      <TopBar title={title} subtitle={subtitle}>
        {topBarExtras}
      </TopBar>
      <div className="flex">
        <SideNav />
        {/* The `lg:pl-60` reserves the side rail's width on desktop.
            `pb-24` on small screens leaves room for the bottom nav. */}
        <div className="min-w-0 flex-1 pb-24 lg:pb-0">{children}</div>
      </div>
    </div>
  )
}

/** Helper for pages that want a consistent max-width container. */
export function PageContainer({ children, className = '', size = 'default' }) {
  const sizeMap = {
    default: 'max-w-6xl',
    narrow: 'max-w-3xl',
    wide:   'max-w-7xl',
  }
  return (
    <main className={`${sizeMap[size] || sizeMap.default} mx-auto w-full px-4 py-6 sm:px-6 sm:py-8 lg:px-8 animate-fade-in ${className}`}>
      {children}
    </main>
  )
}
