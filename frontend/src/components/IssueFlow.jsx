/**
 * IssueFlow.jsx — issue / dispute flow on a deal (Feature I).
 *
 * State machine:
 *   OPEN ──acknowledge──▶ UNDER_REVIEW ──resolve──▶ RESOLVED
 *
 * Distinct from deal-level verification: an issue is a complaint
 * that needs human attention — late delivery, payment dispute,
 * suspected fraud, etc. The verifier step (Feature B) is the
 * standard weight/quality handoff; this is the broader dispute
 * channel.
 *
 * Both parties can raise issues; only one transition at a time is
 * allowed and the server is the source of truth.
 */
import { useEffect, useState } from 'react'
import api from '../api/axios.js'
import { AlertTriangle, Check, MessageSquare, ChevronRight } from 'lucide-react'

const TYPES = [
  { value: 'QUALITY', label: 'Quality' },
  { value: 'WEIGHT', label: 'Weight' },
  { value: 'PAYMENT', label: 'Payment' },
  { value: 'DELIVERY', label: 'Delivery' },
  { value: 'OTHER', label: 'Other' },
]

const STATUS_TONE = {
  OPEN: 'ac-chip-honey',
  UNDER_REVIEW: 'ac-chip-primary',
  RESOLVED: 'ac-chip-success',
}

const STATUS_NEXT = {
  OPEN: { to: 'UNDER_REVIEW', label: 'Acknowledge' },
  UNDER_REVIEW: { to: 'RESOLVED', label: 'Mark resolved' },
  RESOLVED: null,
}

const ROLE_OPTIONS = [
  { value: 'SELLER', label: 'Seller' },
  { value: 'BUYER', label: 'Buyer' },
]

const INPUT =
  'w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500'

function StatusPill({ status }) {
  const cls = STATUS_TONE[status] || 'ac-chip-ink'
  return <span className={`ac-chip ${cls}`}>{status || 'UNKNOWN'}</span>
}

function fmtDate(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

export default function IssueFlow({ dealPublicId, currentUser }) {
  const [list, setList] = useState([])
  const [status, setStatus] = useState('loading')
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)

  // raise form
  const [type, setType] = useState('QUALITY')
  const [description, setDescription] = useState('')
  const [raisedByRole, setRaisedByRole] = useState('SELLER')
  const [evidenceRaw, setEvidenceRaw] = useState('')

  // resolve form
  const [activeId, setActiveId] = useState(null)
  const [resolutionNotes, setResolutionNotes] = useState('')
  const [assignedTo, setAssignedTo] = useState('')

  useEffect(() => {
    if (!dealPublicId) return
    let cancelled = false
    setStatus('loading')
    api
      .get(`/deals/${dealPublicId}/issues`)
      .then((r) => {
        if (cancelled) return
        setList(r.data?.results || [])
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

  const raise = async () => {
    if (!description.trim()) {
      setErr('Description is required.')
      return
    }
    setBusy(true)
    setErr(null)
    try {
      const evidence_urls = evidenceRaw
        .split(/\n|,/)
        .map((s) => s.trim())
        .filter(Boolean)
      const body = {
        type,
        description: description.trim(),
        raised_by: currentUser?.publicId || 'system',
        raised_by_role: raisedByRole,
      }
      if (evidence_urls.length) body.evidence_urls = evidence_urls
      const r = await api.post(`/deals/${dealPublicId}/issues`, body)
      setList((prev) => [r.data, ...prev])
      setDescription('')
      setEvidenceRaw('')
    } catch (e) {
      setErr(e.response?.data?.detail || e.message)
    } finally {
      setBusy(false)
    }
  }

  const advance = async (issue) => {
    const next = STATUS_NEXT[issue.status]
    if (!next) return
    setBusy(true)
    setErr(null)
    try {
      const body = { status: next.to }
      if (resolutionNotes) body.resolution_notes = resolutionNotes
      if (assignedTo) body.assigned_to = assignedTo
      const r = await api.patch(
        `/deals/${dealPublicId}/issues/${issue.public_id}`,
        body
      )
      setList((prev) =>
        prev.map((i) => (i.public_id === issue.public_id ? r.data : i))
      )
      setActiveId(null)
      setResolutionNotes('')
      setAssignedTo('')
    } catch (e) {
      setErr(e.response?.data?.detail || e.message)
    } finally {
      setBusy(false)
    }
  }

  if (status === 'loading') {
    return (
      <div className="ac-card p-4 text-sm text-ink-500">Loading issues…</div>
    )
  }
  if (status === 'error' && list.length === 0) {
    return (
      <div className="ac-card border-rust-200 bg-rust-50 p-4 text-sm text-rust-800">
        {err || 'Could not load issues.'}
      </div>
    )
  }

  return (
    <section className="ac-card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="font-display text-base text-ink-900">
            Issues & disputes
          </h2>
          <p className="mt-1 text-xs text-ink-500">
            Raise a concern about quality, weight, payment, or delivery.
            Issues move OPEN → UNDER_REVIEW → RESOLVED.
          </p>
        </div>
        <span className="ac-chip ac-chip-ink">
          {list.length} issue{list.length === 1 ? '' : 's'}
        </span>
      </div>

      {err && (
        <p className="mt-3 rounded-card border border-rust-200 bg-rust-50 p-2 text-xs text-rust-800">
          {err}
        </p>
      )}

      {/* Raise form */}
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-ink-700">
            Type
          </label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className={INPUT}
          >
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-ink-700">
            Raised by
          </label>
          <select
            value={raisedByRole}
            onChange={(e) => setRaisedByRole(e.target.value)}
            className={INPUT}
          >
            {ROLE_OPTIONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-ink-700">
            Evidence URLs
          </label>
          <input
            type="text"
            value={evidenceRaw}
            onChange={(e) => setEvidenceRaw(e.target.value)}
            className={INPUT}
            placeholder="one per line or comma-separated"
          />
        </div>
        <div className="sm:col-span-3">
          <label className="mb-1 block text-xs font-medium text-ink-700">
            Description
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className={INPUT + ' h-20 resize-y'}
            placeholder="What went wrong?"
          />
        </div>
        <div className="sm:col-span-3">
          <button
            type="button"
            onClick={raise}
            disabled={busy}
            className="ac-btn-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            <MessageSquare className="mr-1 inline h-4 w-4" />
            {busy ? 'Raising…' : 'Raise issue'}
          </button>
        </div>
      </div>

      {/* Issue list */}
      <ul className="mt-4 space-y-3">
        {list.length === 0 && (
          <li className="rounded-card border border-ink-100 bg-earth-50 p-3 text-xs text-ink-500">
            No issues raised yet on this deal.
          </li>
        )}
        {list.map((issue) => {
          const next = STATUS_NEXT[issue.status]
          const isActive = activeId === issue.public_id
          return (
            <li
              key={issue.public_id}
              className="rounded-card border border-ink-100 bg-white p-3"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill status={issue.status} />
                  <span className="ac-chip ac-chip-ink">
                    {issue.type}
                  </span>
                  <span className="text-xs text-ink-500">
                    by {issue.raised_by_role} · {fmtDate(issue.created_at)}
                  </span>
                </div>
                <span className="font-mono text-[10px] text-ink-400">
                  {issue.public_id}
                </span>
              </div>
              <p className="mt-2 text-sm text-ink-800">{issue.description}</p>
              {Array.isArray(issue.evidence_urls) &&
                issue.evidence_urls.length > 0 && (
                  <ul className="mt-2 list-inside list-disc text-xs text-ink-600">
                    {issue.evidence_urls.map((u, i) => (
                      <li key={i}>
                        <a
                          href={u}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="break-all text-primary-700 hover:underline"
                        >
                          {u}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              {issue.resolution_notes && (
                <p className="mt-2 rounded-card border border-success-200 bg-success-50 p-2 text-xs text-success-700">
                  <Check className="mr-1 inline h-3 w-3" />
                  Resolution notes: {issue.resolution_notes}
                </p>
              )}
              {next && (
                <div className="mt-2">
                  {isActive ? (
                    <div className="grid gap-2 sm:grid-cols-2">
                      <input
                        type="text"
                        value={resolutionNotes}
                        onChange={(e) => setResolutionNotes(e.target.value)}
                        className={INPUT}
                        placeholder={
                          next.to === 'RESOLVED'
                            ? 'resolution notes (recommended)'
                            : 'notes (optional)'
                        }
                      />
                      <input
                        type="text"
                        value={assignedTo}
                        onChange={(e) => setAssignedTo(e.target.value)}
                        className={INPUT}
                        placeholder="assign to (optional)"
                      />
                      <div className="sm:col-span-2 flex gap-2">
                        <button
                          type="button"
                          onClick={() => advance(issue)}
                          disabled={busy}
                          className="ac-btn-primary disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {busy ? 'Working…' : `Confirm: ${next.label}`}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setActiveId(null)
                            setResolutionNotes('')
                            setAssignedTo('')
                          }}
                          className="ac-btn-ghost"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setActiveId(issue.public_id)}
                      className="ac-btn-ghost"
                    >
                      <ChevronRight className="mr-1 inline h-3 w-3" />
                      {next.label}
                    </button>
                  )}
                </div>
              )}
              {!next && issue.resolved_at && (
                <p className="mt-2 text-xs text-ink-500">
                  Resolved {fmtDate(issue.resolved_at)}
                </p>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
