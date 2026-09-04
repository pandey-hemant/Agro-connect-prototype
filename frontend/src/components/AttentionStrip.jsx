/**
 * AttentionStrip.jsx — single-row "what needs your attention"
 * surface for dashboards.
 *
 * The brief said: "attention states using existing data." This is
 * that. The component is intentionally dumb — it just renders a
 * list of {tone, label, link, count} items, sorted by count
 * descending, with the most-pressing item first. Tones:
 *
 *   - rust    — needs action now (open offer with a counter waiting,
 *               FPO invitation, deal that needs shipping action)
 *   - honey   — informational, not blocking (a lot flagged SELL_NOW)
 *   - primary — neutral notification (offers received, deals in
 *               transit)
 *
 * Both dashboards (FarmerDashboard, BuyerDashboard) feed the same
 * shape. The component does not call any APIs.
 */
import { Link } from 'react-router-dom'

const TONE_STYLES = {
  rust: 'border-rust-200 bg-rust-50 text-rust-800',
  honey: 'border-honey-200 bg-honey-50 text-honey-900',
  primary: 'border-primary-200 bg-primary-50 text-primary-900',
}

export default function AttentionStrip({ items }) {
  if (!Array.isArray(items) || items.length === 0) return null
  // Drop zero-count items, then sort by count desc
  const visible = items
    .filter((it) => it && Number(it.count) > 0)
    .sort((a, b) => Number(b.count) - Number(a.count))
  if (visible.length === 0) return null

  return (
    <section
      aria-label="Needs your attention"
      className="mb-6 rounded-card border border-ink-200 bg-white p-3"
    >
      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-500">
        <span className="font-semibold uppercase tracking-wide text-ink-600">
          Needs attention
        </span>
        <span className="hidden h-3 w-px bg-ink-200 sm:inline-block" />
        {visible.map((it) => {
          const tone = TONE_STYLES[it.tone] || TONE_STYLES.primary
          return (
            <Link
              key={it.id}
              to={it.to}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-medium transition hover:opacity-90 ${tone}`}
            >
              <span className="rounded-full bg-white/70 px-1.5 py-0.5 text-[10px] font-bold text-ink-700">
                {it.count}
              </span>
              <span>{it.label}</span>
              <span aria-hidden="true">→</span>
            </Link>
          )
        })}
      </div>
    </section>
  )
}
