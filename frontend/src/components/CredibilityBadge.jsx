/**
 * CredibilityBadge.jsx — deterministic credibility score chip.
 *
 * Reads `{available, score, factors}` from the /api/credibility/users/:id
 * endpoint (or the farmer-card endpoint, which embeds the same shape).
 *
 * Trust rules:
 *   - Never displays a default middle score for unknown users.
 *   - When `available: false`, the chip shows "Not enough history yet".
 *   - Tones follow the design tokens: success for strong, honey for
 *     moderate, ink for unrated, rust only for the missing-data case.
 *   - Tooltip explains the factors without inventing any "AI" framing.
 */
import { Info } from 'lucide-react'

function tier(score) {
  if (score == null) return 'ink'
  if (score >= 70) return 'success'
  if (score >= 40) return 'honey'
  return 'earth'
}

const TONE = {
  success: 'bg-success-100 text-success-800 border-success-200',
  honey: 'bg-honey-100 text-honey-900 border-honey-200',
  earth: 'bg-earth-100 text-earth-900 border-earth-200',
  ink: 'bg-ink-100 text-ink-700 border-ink-200',
}

function tooltip(credibility) {
  if (!credibility) return ''
  if (!credibility.available) {
    return credibility.message || 'Not enough history yet.'
  }
  const f = credibility.factors || {}
  return `Score ${credibility.score}/100 · ${f.completed_deals || 0} of ${f.total_deals || 0} deals completed · ${f.active_listings || 0} active listing${(f.active_listings || 0) === 1 ? '' : 's'}.`
}

export default function CredibilityBadge({ credibility, compact = false }) {
  if (!credibility) return null
  if (!credibility.available) {
    return (
      <span className="ac-chip ac-chip-ink" title="No deal history yet">
        Not enough history yet
      </span>
    )
  }
  const tone = TONE[tier(credibility.score)]
  const tip = tooltip(credibility)
  if (compact) {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${tone}`}
        title={tip}
      >
        {credibility.score}
        <Info className="h-3 w-3 opacity-60" aria-hidden="true" />
      </span>
    )
  }
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${tone}`}
      title={tip}
    >
      <span aria-hidden="true">★</span>
      Credibility {credibility.score}/100
    </span>
  )
}
