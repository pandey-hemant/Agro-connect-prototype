/**
 * components/EmptyState.jsx — a consistent empty/error state.
 *
 * The old app rendered a "rounded-xl border p-12 text-center" with
 * one or two lines. That works for "no data" but it confuses three
 * very different states: empty, error, and "not found yet". This
 * unifies them on a single visual with three intents.
 */
export default function EmptyState({
  kind = 'empty',          // 'empty' | 'error' | 'info'
  title,
  description,
  icon,
  action,
}) {
  const palette = {
    empty:  { wrap: 'border-earth-200 bg-white',     glyph: 'bg-primary-50 text-primary-700' },
    error:  { wrap: 'border-rust-200 bg-rust-50',     glyph: 'bg-rust-100 text-rust-600' },
    info:   { wrap: 'border-honey-200 bg-honey-50',   glyph: 'bg-honey-100 text-honey-700' },
  }[kind] || {}
  return (
    <div className={`flex flex-col items-center justify-center rounded-card border px-6 py-10 text-center ${palette.wrap}`}>
      {icon && (
        <span className={`mb-3 flex h-12 w-12 items-center justify-center rounded-full ${palette.glyph}`}>
          {icon}
        </span>
      )}
      {title && (
        <h3 className="text-base font-semibold text-ink-900">{title}</h3>
      )}
      {description && (
        <p className="mt-1.5 max-w-md text-sm text-ink-500">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
