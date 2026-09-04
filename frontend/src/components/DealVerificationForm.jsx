/**
 * DealVerificationForm.jsx — deal-level weight + quality verification.
 *
 * Mounted on the deal page (Feature B). Mirrors the backend
 * state machine:
 *
 *   VERIFICATION_PENDING → VERIFIED            (no discrepancy)
 *                        → DISCREPANCY_FOUND   (weight > ±tolerance
 *                                               or grade mismatch)
 *   DISCREPANCY_FOUND   → RESOLVED             (parties accept one
 *                                               side or split)
 *
 * Workflow:
 *   1. Seller (or admin) starts verification → declared weight +
 *      declared quality. This records a VERIFICATION_PENDING
 *      entry on the deal audit trail.
 *   2. Receiver submits actual weight + verified quality. The
 *      server computes the delta; if within tolerance and grades
 *      match, the verification moves to VERIFIED. Otherwise it
 *      becomes DISCREPANCY_FOUND with auto-populated notes.
 *   3. Either party resolves the discrepancy by picking one of
 *      ACCEPT_ACTUAL / ACCEPT_DECLARED / SPLIT / CANCEL_DEAL.
 *
 * The component never claims a real laboratory certification —
 * verification here is the standard weight/quality handoff step.
 */
import { useEffect, useState } from 'react'
import api from '../api/axios.js'
import { fmtKg, fmtInr, fmtPerKg, NOT_AVAILABLE } from '../utils/format.js'
import { Check, AlertTriangle, Scale, FileText, RotateCcw } from 'lucide-react'

const STATUS_TONE = {
  VERIFICATION_PENDING: {
    label: 'Awaiting receiver',
    cls: 'ac-chip-ink',
  },
  VERIFIED: {
    label: 'Verified',
    cls: 'ac-chip-success',
  },
  DISCREPANCY_FOUND: {
    label: 'Discrepancy found',
    cls: 'ac-chip-honey',
  },
  RESOLVED: {
    label: 'Resolved',
    cls: 'ac-chip-success',
  },
}

const RESOLUTIONS = [
  { value: 'ACCEPT_ACTUAL', label: 'Accept actual (receiver wins)' },
  { value: 'ACCEPT_DECLARED', label: 'Accept declared (seller wins)' },
  { value: 'SPLIT', label: 'Split the difference' },
  { value: 'CANCEL_DEAL', label: 'Cancel the deal' },
]

const INPUT =
  'w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500'

function StatusPill({ status }) {
  const meta = STATUS_TONE[status] || { label: status || 'Unknown', cls: 'ac-chip-ink' }
  return <span className={`ac-chip ${meta.cls}`}>{meta.label}</span>
}

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function fmtPct(v) {
  if (v == null) return NOT_AVAILABLE
  const n = Number(v)
  if (!Number.isFinite(n)) return NOT_AVAILABLE
  return `${n.toFixed(2)}%`
}

export default function DealVerificationForm({ dealPublicId, tolerancePct = 2 }) {
  const [record, setRecord] = useState(null)
  const [status, setStatus] = useState('loading') // loading | ready | error
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)

  // start form
  const [declaredWeight, setDeclaredWeight] = useState('')
  const [declaredGrade, setDeclaredGrade] = useState('')
  const [declaredNotes, setDeclaredNotes] = useState('')

  // verify form
  const [actualWeight, setActualWeight] = useState('')
  const [verifiedGrade, setVerifiedGrade] = useState('')
  const [discrepancyNotes, setDiscrepancyNotes] = useState('')

  // resolve form
  const [resolution, setResolution] = useState('ACCEPT_ACTUAL')
  const [resolutionNotes, setResolutionNotes] = useState('')

  useEffect(() => {
    if (!dealPublicId) return
    let cancelled = false
    setStatus('loading')
    setErr(null)
    api
      .get(`/deals/${dealPublicId}/verification`)
      .then((r) => {
        if (cancelled) return
        setRecord(r.data)
        setStatus('ready')
      })
      .catch((e) => {
        if (cancelled) return
        if (e.response?.status === 404) {
          // No record yet — that's a normal starting state.
          setRecord(null)
          setStatus('ready')
        } else {
          setErr(e.response?.data?.detail || e.message)
          setStatus('error')
        }
      })
    return () => {
      cancelled = true
    }
  }, [dealPublicId])

  const start = async () => {
    if (!declaredWeight) {
      setErr('Declared weight is required to start verification.')
      return
    }
    setBusy(true)
    setErr(null)
    try {
      const r = await api.post(`/deals/${dealPublicId}/verification`, {
        declared_weight_kg: Number(declaredWeight),
        declared_quality: {
          grade: declaredGrade || undefined,
          notes: declaredNotes || undefined,
        },
      })
      setRecord(r.data)
    } catch (e) {
      setErr(e.response?.data?.detail || e.message)
    } finally {
      setBusy(false)
    }
  }

  const submit = async () => {
    if (!actualWeight) {
      setErr('Actual weight is required to verify.')
      return
    }
    setBusy(true)
    setErr(null)
    try {
      const body = { actual_weight_kg: Number(actualWeight) }
      if (verifiedGrade) {
        body.verified_quality = { grade: verifiedGrade }
      }
      if (discrepancyNotes) {
        body.discrepancy_notes = discrepancyNotes
      }
      const r = await api.patch(`/deals/${dealPublicId}/verification`, body)
      setRecord(r.data)
      setActualWeight('')
      setVerifiedGrade('')
      setDiscrepancyNotes('')
    } catch (e) {
      setErr(e.response?.data?.detail || e.message)
    } finally {
      setBusy(false)
    }
  }

  const resolve = async () => {
    setBusy(true)
    setErr(null)
    try {
      const r = await api.patch(
        `/deals/${dealPublicId}/verification/resolve`,
        { resolution, resolution_notes: resolutionNotes || '' }
      )
      setRecord(r.data)
    } catch (e) {
      setErr(e.response?.data?.detail || e.message)
    } finally {
      setBusy(false)
    }
  }

  if (status === 'loading') {
    return (
      <div className="ac-card p-4 text-sm text-ink-500">
        Loading verification…
      </div>
    )
  }
  if (status === 'error' && !record) {
    return (
      <div className="ac-card border-rust-200 bg-rust-50 p-4 text-sm text-rust-800">
        {err || 'Could not load verification.'}
      </div>
    )
  }

  return (
    <section className="ac-card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="font-display text-base text-ink-900">
            Weight & quality verification
          </h2>
          <p className="mt-1 text-xs text-ink-500">
            Receiver measures at delivery; the server records the delta
            on the deal audit trail. Tolerance ±{tolerancePct}%.
          </p>
        </div>
        {record && <StatusPill status={record.status} />}
      </div>

      {err && (
        <p className="mt-3 rounded-card border border-rust-200 bg-rust-50 p-2 text-xs text-rust-800">
          {err}
        </p>
      )}

      {/* Step 1: start verification */}
      {!record && (
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-700">
              Declared weight (kg)
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={declaredWeight}
              onChange={(e) => setDeclaredWeight(e.target.value)}
              className={INPUT}
              placeholder="e.g. 1000"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-700">
              Declared grade
            </label>
            <input
              type="text"
              value={declaredGrade}
              onChange={(e) => setDeclaredGrade(e.target.value)}
              className={INPUT}
              placeholder="e.g. A / B / FAQ"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-700">
              Notes
            </label>
            <input
              type="text"
              value={declaredNotes}
              onChange={(e) => setDeclaredNotes(e.target.value)}
              className={INPUT}
              placeholder="optional"
            />
          </div>
          <div className="sm:col-span-3">
            <button
              type="button"
              onClick={start}
              disabled={busy}
              className="ac-btn-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Scale className="mr-1 inline h-4 w-4" />
              {busy ? 'Starting…' : 'Start verification'}
            </button>
          </div>
        </div>
      )}

      {/* Step 2: declared vs verified */}
      {record && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-card border border-ink-100 bg-earth-50 p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
              Declared (seller)
            </p>
            <p className="mt-1 font-display text-base text-ink-900">
              {fmtKg(record.declared_weight_kg)}
            </p>
            <p className="text-xs text-ink-600">
              Grade: {record.declared_quality?.grade || '—'}
            </p>
            {record.declared_quality?.notes && (
              <p className="text-xs text-ink-500">
                <FileText className="mr-1 inline h-3 w-3" />
                {record.declared_quality.notes}
              </p>
            )}
          </div>
          <div className="rounded-card border border-ink-100 bg-white p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-500">
              Actual (receiver)
            </p>
            <p className="mt-1 font-display text-base text-ink-900">
              {fmtKg(record.actual_weight_kg)}
            </p>
            <p className="text-xs text-ink-600">
              Grade: {record.verified_quality?.grade || '—'}
            </p>
            {record.weight_delta_pct != null && (
              <p className="text-xs text-ink-600">
                Delta: <strong>{fmtPct(record.weight_delta_pct)}</strong>{' '}
                (tolerance ±{tolerancePct}%)
              </p>
            )}
            {record.quality_match === false && (
              <p className="text-xs text-rust-700">
                <AlertTriangle className="mr-1 inline h-3 w-3" />
                Grade mismatch
              </p>
            )}
          </div>
        </div>
      )}

      {/* Submit actual */}
      {record && record.status === 'VERIFICATION_PENDING' && (
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-700">
              Actual weight (kg)
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={actualWeight}
              onChange={(e) => setActualWeight(e.target.value)}
              className={INPUT}
              placeholder="measured at delivery"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-700">
              Verified grade
            </label>
            <input
              type="text"
              value={verifiedGrade}
              onChange={(e) => setVerifiedGrade(e.target.value)}
              className={INPUT}
              placeholder="optional"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-700">
              Discrepancy notes
            </label>
            <input
              type="text"
              value={discrepancyNotes}
              onChange={(e) => setDiscrepancyNotes(e.target.value)}
              className={INPUT}
              placeholder="optional — auto-filled if blank"
            />
          </div>
          <div className="sm:col-span-3">
            <button
              type="button"
              onClick={submit}
              disabled={busy}
              className="ac-btn-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Check className="mr-1 inline h-4 w-4" />
              {busy ? 'Submitting…' : 'Submit actual weight & quality'}
            </button>
          </div>
        </div>
      )}

      {/* Discrepancy resolution */}
      {record && record.status === 'DISCREPANCY_FOUND' && (
        <div className="mt-4">
          {record.discrepancy_notes && (
            <p className="mb-3 rounded-card border border-honey-200 bg-honey-50 p-2 text-xs text-honey-800">
              <AlertTriangle className="mr-1 inline h-3 w-3" />
              {record.discrepancy_notes}
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-700">
                Resolution
              </label>
              <select
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
                className={INPUT}
              >
                {RESOLUTIONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-700">
                Resolution notes
              </label>
              <input
                type="text"
                value={resolutionNotes}
                onChange={(e) => setResolutionNotes(e.target.value)}
                className={INPUT}
                placeholder="optional"
              />
            </div>
          </div>
          <div className="mt-3">
            <button
              type="button"
              onClick={resolve}
              disabled={busy}
              className="ac-btn-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RotateCcw className="mr-1 inline h-4 w-4" />
              {busy ? 'Resolving…' : 'Resolve discrepancy'}
            </button>
          </div>
        </div>
      )}

      {/* Resolved summary */}
      {record && record.status === 'RESOLVED' && (
        <div className="mt-4 rounded-card border border-success-200 bg-success-50 p-3 text-xs text-success-700">
          <p>
            <Check className="mr-1 inline h-3 w-3" />
            Resolved as <strong>{record.resolution || '—'}</strong>
            {record.resolution_notes ? ` — ${record.resolution_notes}` : ''}.
          </p>
        </div>
      )}

      {record && record.status === 'VERIFIED' && (
        <div className="mt-4 rounded-card border border-success-200 bg-success-50 p-3 text-xs text-success-700">
          <p>
            <Check className="mr-1 inline h-3 w-3" />
            Weight and grade matched the declaration within tolerance.
            The deal audit trail has been updated.
          </p>
        </div>
      )}
    </section>
  )
}
