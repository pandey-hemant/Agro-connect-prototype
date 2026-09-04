/**
 * DealAuditTrail.jsx — render the deal's full audit trail (Feature H).
 *
 * Reads GET /api/deals/:publicId/audit, which merges
 *   - delivery status changes
 *   - payment status changes (incl. transaction refs)
 *   - verification start / complete / resolve
 *   - issues raised / resolved
 *   - group-sale opt-in
 * into one chronological list. Every entry is append-only on the
 * server, so the trail is the single source of truth for "what
 * happened on this deal".
 *
 * The component never invents or fabricates events; if the trail is
 * empty, it just says so. It also never claims a real bank or
 * external system issued any of the recorded references.
 */
import { useEffect, useState } from 'react'
import api from '../api/axios.js'
import {
  Check,
  AlertTriangle,
  Scale,
  MessageSquare,
  CreditCard,
  Truck,
  Inbox,
  Handshake,
} from 'lucide-react'

const TYPE_META = {
  DELIVERY_STATUS_CHANGED: {
    label: 'Delivery status',
    icon: Truck,
    tone: 'text-primary-700',
  },
  PAYMENT_STATUS_CHANGED: {
    label: 'Payment status',
    icon: CreditCard,
    tone: 'text-success-700',
  },
  VERIFICATION_STARTED: {
    label: 'Verification started',
    icon: Scale,
    tone: 'text-primary-700',
  },
  VERIFICATION_COMPLETED: {
    label: 'Verification completed',
    icon: Scale,
    tone: 'text-success-700',
  },
  VERIFICATION_RESOLVED: {
    label: 'Verification resolved',
    icon: Scale,
    tone: 'text-success-700',
  },
  ISSUE_RAISED: {
    label: 'Issue raised',
    icon: MessageSquare,
    tone: 'text-honey-800',
  },
  ISSUE_RESOLVED: {
    label: 'Issue resolved',
    icon: MessageSquare,
    tone: 'text-success-700',
  },
  GROUP_SALE_OPTED_IN: {
    label: 'Group sale opt-in',
    icon: Handshake,
    tone: 'text-primary-700',
  },
}

const ROLE_TONE = {
  SELLER: 'ac-chip-ink',
  BUYER: 'ac-chip-ink',
  ADMIN: 'ac-chip-honey',
  FPO_COORDINATOR: 'ac-chip-primary',
}

function TypeIcon({ type }) {
  const meta = TYPE_META[type] || {
    label: type,
    icon: Inbox,
    tone: 'text-ink-500',
  }
  const Icon = meta.icon
  return <Icon className={`mt-0.5 h-4 w-4 flex-shrink-0 ${meta.tone}`} />
}

function fmtDate(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

function describeTransition(e) {
  if (e.from && e.to) {
    return (
      <>
        <span className="font-mono text-[11px] text-ink-700">
          {e.from}
        </span>
        <span className="mx-1 text-ink-400">→</span>
        <span className="font-mono text-[11px] text-ink-900">{e.to}</span>
      </>
    )
  }
  if (e.to) {
    return (
      <span className="font-mono text-[11px] text-ink-900">{e.to}</span>
    )
  }
  return <span className="text-xs text-ink-500">—</span>
}

function DetailsList({ details }) {
  if (!details || typeof details !== 'object') return null
  const entries = Object.entries(details).filter(
    ([, v]) => v !== null && v !== undefined && v !== ''
  )
  if (entries.length === 0) return null
  return (
    <ul className="mt-1 space-y-0.5 text-xs text-ink-600">
      {entries.map(([k, v]) => (
        <li key={k}>
          <span className="text-ink-500">{k}:</span>{' '}
          <span className="text-ink-800">
            {typeof v === 'object' ? JSON.stringify(v) : String(v)}
          </span>
        </li>
      ))}
    </ul>
  )
}

export default function DealAuditTrail({ dealPublicId }) {
  const [data, setData] = useState(null)
  const [status, setStatus] = useState('loading')
  const [err, setErr] = useState(null)

  useEffect(() => {
    if (!dealPublicId) return
    let cancelled = false
    setStatus('loading')
    setErr(null)
    api
      .get(`/deals/${dealPublicId}/audit`)
      .then((r) => {
        if (cancelled) return
        setData(r.data)
        setStatus('ready')
      })
      .catch((e) => {
        if (cancelled) return
        setErr(e.response?.data?.detail || e.message)
        setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [dealPublicId])

  if (status === 'loading') {
    return (
      <div className="ac-card p-4 text-sm text-ink-500">
        Loading audit trail…
      </div>
    )
  }
  if (status === 'error' || !data) {
    return (
      <div className="ac-card border-rust-200 bg-rust-50 p-4 text-sm text-rust-800">
        {err || 'Could not load audit trail.'}
      </div>
    )
  }

  const events = Array.isArray(data.events) ? data.events : []

  return (
    <section className="ac-card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="font-display text-base text-ink-900">
            Deal audit trail
          </h2>
          <p className="mt-1 text-xs text-ink-500">
            Every recorded event on this deal, in order. Append-only;
            nothing is rewritten after the fact.
          </p>
        </div>
        <span className="ac-chip ac-chip-ink">
          {events.length} event{events.length === 1 ? '' : 's'}
        </span>
      </div>

      {events.length === 0 ? (
        <p className="mt-4 text-sm text-ink-500">
          No events recorded yet. The first state change will appear here.
        </p>
      ) : (
        <ol className="mt-4 space-y-3">
          {events.map((e, i) => {
            const meta = TYPE_META[e.type] || {
              label: e.type,
              tone: 'text-ink-500',
            }
            const roleCls = e.actor_role
              ? ROLE_TONE[e.actor_role] || 'ac-chip-ink'
              : null
            return (
              <li
                key={`${e.type}-${i}-${e.at}`}
                className="flex items-start gap-3 rounded-card border border-ink-100 bg-white p-3"
              >
                <TypeIcon type={e.type} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`text-sm font-semibold ${meta.tone}`}>
                        {meta.label}
                      </span>
                      {describeTransition(e)}
                    </div>
                    <span className="text-[11px] text-ink-500">
                      {fmtDate(e.at)}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-500">
                    {e.actor_public_id && (
                      <span>
                        by{' '}
                        <span className="font-mono text-[11px] text-ink-700">
                          {e.actor_public_id}
                        </span>
                      </span>
                    )}
                    {e.actor_role && roleCls && (
                      <span className={`ac-chip ${roleCls}`}>
                        {e.actor_role}
                      </span>
                    )}
                    {e.txn_ref && (
                      <span>
                        txn{' '}
                        <code className="rounded bg-earth-50 px-1 text-[11px] text-ink-800">
                          {e.txn_ref}
                        </code>
                      </span>
                    )}
                  </div>
                  <DetailsList details={e.details} />
                </div>
              </li>
            )
          })}
        </ol>
      )}

      <p className="mt-3 text-[11px] italic text-ink-500">
        Transaction references are deterministic internal IDs, not bank
        receipts.
      </p>
    </section>
  )
}
