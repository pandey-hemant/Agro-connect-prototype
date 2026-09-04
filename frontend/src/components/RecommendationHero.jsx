/**
 * components/RecommendationHero.jsx — the visual hero for a sell/hold
 * recommendation. Lives at the top of the Decision Support page so the
 * farmer sees "what to do with my crop" before anything else.
 *
 * Three states, three colours, three clear action verbs. Estimate chip
 * always visible (we are rule-based, not AI).
 */
const HERO = {
  SELL_NOW: {
    label: 'Sell now',
    verb: 'Sell your crop now',
    blurb: 'Current market conditions favour selling. Lock in the price and avoid further storage risk.',
    bg: 'from-success-100 to-success-200',
    text: 'text-success-600',
    ring: 'ring-success-300',
    glyph: (
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
        <path d="M3 17 9 11l4 4 8-8" /><path d="M14 7h7v7" />
      </svg>
    ),
  },
  WAIT: {
    label: 'Wait',
    verb: 'Hold for a better price',
    blurb: 'Market is likely to improve. Hold if you can — but watch the trend closely and re-check in a few days.',
    bg: 'from-honey-100 to-honey-200',
    text: 'text-honey-700',
    ring: 'ring-honey-300',
    glyph: (
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
      </svg>
    ),
  },
  GROUP_SALE: {
    label: 'Group sale',
    verb: 'Pool with other farmers',
    blurb: 'A group sale could net you more than selling alone. Check the FPO opportunities on the Opportunities page.',
    bg: 'from-primary-100 to-primary-200',
    text: 'text-primary-700',
    ring: 'ring-primary-300',
    glyph: (
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
        <circle cx="9" cy="9" r="3" /><circle cx="17" cy="11" r="2.5" />
        <path d="M3 19c0-3 2.5-5 6-5s6 2 6 5" /><path d="M14 19c0-2 1.5-4 4-4s3 1.5 3 4" />
      </svg>
    ),
  },
}

export default function RecommendationHero({ rec, reason, insufficient }) {
  const conf = HERO[rec] || {
    label: rec || 'No recommendation',
    verb: 'No recommendation yet',
    blurb: reason || 'We need a bit more data before we can advise.',
    bg: 'from-earth-100 to-earth-200',
    text: 'text-ink-700',
    ring: 'ring-ink-200',
    glyph: (
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" /><path d="M9 10a3 3 0 1 1 4.5 2.6c-.9.5-1.5 1-1.5 2.4" /><path d="M12 17h.01" />
      </svg>
    ),
  }
  return (
    <div
      className={`relative overflow-hidden rounded-card bg-gradient-to-br ${conf.bg} p-6 ring-1 ${conf.ring} animate-fade-in`}
      role="region"
      aria-label="Recommendation"
    >
      <div className="flex flex-wrap items-start gap-4">
        <span className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-white/70 ${conf.text}`}>
          {conf.glyph}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="ac-section-label text-ink-500">Recommendation</span>
            <span className="ac-chip bg-white/70 text-ink-700">Estimate · rule-based</span>
            {insufficient && (
              <span className="ac-chip bg-honey-200 text-honey-700">Insufficient data</span>
            )}
          </div>
          <h2 className={`mt-1 font-display text-2xl ${conf.text} sm:text-3xl`}>
            {conf.verb}
          </h2>
          <p className="mt-1 text-sm text-ink-700 sm:text-base">
            {conf.blurb}
          </p>
        </div>
      </div>
    </div>
  )
}
