/**
 * components/PageHeader.jsx — the consistent page-level header.
 *
 * Replaces the ad-hoc hero strips each page used to render
 * ("h1 + p + LiveBadge + back-button"). One component, four props:
 *
 *   <PageHeader
 *     eyebrow="Farmer journey"     // tiny uppercase tag
 *     title="Onion — Nashik"       // h1, serif
 *     description="..."            // supporting paragraph
 *     actions={<>...</>}           // right-side buttons
 *   />
 *
 * Designed to read well in the top bar (where the page's title is
 * mirrored) and on the page itself.
 */
import { Link } from 'react-router-dom'

export default function PageHeader({ eyebrow, title, description, actions, back }) {
  return (
    <div className="mb-6 sm:mb-8">
      {back && (
        <Link
          to={back.to}
          className="mb-3 inline-flex items-center gap-1.5 text-sm text-ink-500 transition hover:text-ink-800"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <path d="M15 6l-6 6 6 6" />
          </svg>
          {back.label || 'Back'}
        </Link>
      )}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 flex-1">
          {eyebrow && (
            <p className="ac-section-label mb-1.5">{eyebrow}</p>
          )}
          <h1 className="font-display text-3xl font-medium leading-tight text-ink-900 sm:text-4xl">
            {title}
          </h1>
          {description && (
            <p className="mt-2 max-w-2xl text-base text-ink-500">{description}</p>
          )}
        </div>
        {actions && (
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        )}
      </div>
    </div>
  )
}
