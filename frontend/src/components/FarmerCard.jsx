/**
 * FarmerCard.jsx — public farmer info for the buyer marketplace.
 *
 * Renders inside a `lot` card on /buyer/marketplace. Fetches
 * /api/crop-lots/:publicId/farmer-card on mount and renders:
 *   - Farmer name + location (lot-level location wins, then user)
 *   - CredibilityBadge (Not enough history yet when unavailable)
 *   - Identity-verification badge (separate from credibility score:
 *     credibility reflects deal history; identity verification
 *     reflects KYC/PAN/Aadhaar integration, which is not yet wired
 *     up — we surface the state honestly as "Identity not verified")
 *
 * Hard rules (from the spec):
 *   - NEVER displays phone, email, or any private contact data.
 *   - When the card is unavailable, the section collapses to a small
 *     "Farmer info not available" line — never a hard error.
 *   - Loading is shown as a quiet skeleton, not a spinner.
 */
import { useEffect, useState } from 'react'
import api from '../api/axios.js'
import CredibilityBadge from './CredibilityBadge.jsx'
import { ShieldCheck, BadgeCheck, BadgeAlert } from 'lucide-react'

export default function FarmerCard({ lotPublicId, layout = 'card' }) {
  const [card, setCard] = useState(null)
  const [status, setStatus] = useState('loading')
  const [err, setErr] = useState(null)

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    setErr(null)
    api
      .get(`/crop-lots/${lotPublicId}/farmer-card`)
      .then((r) => {
        if (cancelled) return
        setCard(r.data)
        setStatus('succeeded')
      })
      .catch((e) => {
        if (cancelled) return
        setErr(e.response?.data?.detail || e.message)
        setStatus('failed')
      })
    return () => {
      cancelled = true
    }
  }, [lotPublicId])

  if (status === 'loading') {
    return (
      <div className="mt-2 flex animate-pulse items-center gap-2 text-xs text-ink-500">
        <span className="inline-block h-3 w-20 rounded bg-ink-100" />
        <span className="inline-block h-3 w-12 rounded bg-ink-100" />
      </div>
    )
  }
  if (status === 'failed' || !card) {
    return (
      <p className="mt-2 text-xs text-ink-400">
        Farmer info not available.
        {err ? <span className="ml-1 text-ink-300">({err})</span> : null}
      </p>
    )
  }
  if (!card.available) {
    return (
      <p className="mt-2 text-xs text-ink-400">Farmer info not available.</p>
    )
  }

  const f = card.farmer
  const identityVerified = !!card.identity_verified
  return (
    <div
      className={
        layout === 'row'
          ? 'flex flex-wrap items-center gap-2 text-xs text-ink-700'
          : 'mt-3 rounded-card border border-ink-100 bg-earth-50 p-3'
      }
    >
      <div className={layout === 'row' ? 'flex items-center gap-2' : 'flex items-start justify-between gap-2'}>
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary-600" aria-hidden="true" />
          <span className="font-medium text-ink-800">{f.name}</span>
          {f.is_demo && (
            <span className="ac-chip ac-chip-ink" title="Seeded sample farmer">
              sample
            </span>
          )}
        </div>
        {layout === 'card' && <CredibilityBadge credibility={card.credibility} compact />}
      </div>
      {(f.location || f.state) && (
        <p className={`text-xs text-ink-600 ${layout === 'row' ? '' : 'mt-1'}`}>
          📍 {[f.location, f.state].filter(Boolean).join(' · ')}
        </p>
      )}

      {/* Identity verification — separate from credibility. The
          flag is sourced from the backend; an explanatory note
          appears beneath so buyers understand what it does and
          doesn't mean. */}
      <p
        className={`flex items-center gap-1 text-xs ${
          layout === 'row' ? '' : 'mt-1'
        }`}
        title={
          card.identity_verification_note ||
          (identityVerified
            ? 'Identity verified'
            : 'Identity not verified — KYC integration pending')
        }
      >
        {identityVerified ? (
          <BadgeCheck className="h-3.5 w-3.5 text-success-700" />
        ) : (
          <BadgeAlert className="h-3.5 w-3.5 text-honey-700" />
        )}
        <span
          className={
            identityVerified ? 'text-success-700' : 'text-honey-800'
          }
        >
          {identityVerified
            ? 'Identity verified'
            : 'Identity not verified'}
        </span>
        {!identityVerified && (
          <span className="text-ink-400"> · KYC integration pending</span>
        )}
      </p>

      {layout === 'row' && <CredibilityBadge credibility={card.credibility} compact />}
      {layout === 'card' && !card.credibility?.available && (
        <p className="mt-1 text-xs text-ink-500">
          {card.credibility?.message || 'Not enough history yet.'}
        </p>
      )}
    </div>
  )
}
