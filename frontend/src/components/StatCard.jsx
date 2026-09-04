/**
 * components/StatCard.jsx — a single dashboard stat tile.
 *
 * Replaces the many inline "card with text-3xl font-bold" patterns
 * scattered across the dashboard pages. Renders a label, a value,
 * and an optional hint/tone. The tone is one of a small fixed set
 * so the dashboard reads as a coherent whole.
 */
export default function StatCard({
  label,
  value,
  hint,
  tone = 'default',         // 'default' | 'positive' | 'negative' | 'warn' | 'primary'
  icon,
  to,                       // optional link target
}) {
  const toneMap = {
    default: { value: 'text-ink-900', accent: 'text-ink-500' },
    primary: { value: 'text-primary-800', accent: 'text-primary-700' },
    positive:{ value: 'text-success-600', accent: 'text-success-500' },
    negative:{ value: 'text-rust-600', accent: 'text-rust-500' },
    warn:    { value: 'text-honey-700', accent: 'text-honey-600' },
  }[tone] || {}

  const body = (
    <div className="ac-card ac-card-hover p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-ink-400">
          {label}
        </p>
        {icon && (
          <span className={`flex h-9 w-9 items-center justify-center rounded-full bg-earth-50 ${toneMap.accent}`}>
            {icon}
          </span>
        )}
      </div>
      <p className={`mt-3 font-display text-3xl font-medium leading-none ${toneMap.value}`}>
        {value}
      </p>
      {hint && (
        <p className="mt-2 text-xs text-ink-500">{hint}</p>
      )}
    </div>
  )
  if (to) {
    // Importing Link directly to keep this card's body plain and
    // let the caller pass a route — the wrapper is thin.
    return <a href={to} className="block">{body}</a>
  }
  return body
}
