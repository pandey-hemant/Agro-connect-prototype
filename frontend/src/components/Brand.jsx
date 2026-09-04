/**
 * components/Brand.jsx — the single, shared brand mark.
 *
 * Used by the AppShell, the public landing page, and the 404. Keeping
 * it as one component guarantees the wordmark never drifts between
 * pages. Two variants:
 *
 *   <Brand />              → the seedling glyph + "AgroConnect" in
 *                             Fraunces serif. Default.
 *   <Brand mark={false} /> → wordmark only, no glyph. For tight nav rows.
 *
 * The glyph itself is a small inline SVG — not an emoji, not a web font.
 * It's drawn in `currentColor` so the parent controls the tint (e.g.
 * white text on the primary green header, ink-800 on the page).
 */
export default function Brand({ mark = true, className = '', size = 'md' }) {
  const sizes = {
    sm: { wrap: 'gap-2', glyph: 'h-6 w-6', text: 'text-base' },
    md: { wrap: 'gap-2.5', glyph: 'h-8 w-8', text: 'text-lg' },
    lg: { wrap: 'gap-3', glyph: 'h-10 w-10', text: 'text-2xl' },
  }
  const s = sizes[size] || sizes.md
  return (
    <span className={`inline-flex items-center ${s.wrap} ${className}`}>
      {mark && (
        <span
          className={`${s.glyph} inline-flex items-center justify-center rounded-lg bg-primary-700 text-white`}
          aria-hidden="true"
        >
          <svg viewBox="0 0 24 24" className="h-3/5 w-3/5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 20 L12 12" />
            <path d="M12 13 C8 13 6 11 6 8 C9 8 11 9.5 12 13 Z" fill="currentColor" stroke="none" />
            <path d="M12 13 C16 13 18 11 18 8 C15 8 13 9.5 12 13 Z" fill="currentColor" stroke="none" />
            <path d="M12 12 C10 12 9 11 9 9.5 C10.5 9.5 11.5 10 12 12 Z" fill="currentColor" stroke="none" />
          </svg>
        </span>
      )}
      <span className={`font-display font-medium tracking-tight ${s.text} text-ink-900`}>
        AgroConnect
      </span>
    </span>
  )
}
