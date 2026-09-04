/**
 * PaymentLifecycle.jsx — explicit deal/payment STATE FLOW.
 *
 * AgroConnect does not implement a real money gateway. Instead it
 * shows a transparent, auditable STATE FLOW with deterministic
 * transitions and clear UX about which step is happening. The
 * component is a UI surface; the actual status update is sent to
 * /api/deals/:id/payment-transition. Actual settlement is handled
 * by regulated payment infrastructure outside AgroConnect.
 *
 * State machine (intentionally explicit):
 *
 *   CREATED ──► PAYMENT_PENDING ──► PAYMENT_INITIATED ──► PAYMENT_SECURED
 *                                              │                  │
 *                                              │                  ▼
 *                                              │            PAYMENT_RELEASED ──► COMPLETED
 *                                              ▼
 *                                          DISPUTED ──► REFUNDED
 *
 * Trust rules:
 *   - Every transition is a separate POST call. The server returns
 *     the new state + a transaction reference so the user sees
 *     exactly what was recorded.
 *   - Buttons are disabled if the next transition is not legal from
 *     the current state (no free-form "set status" dropdown).
 *   - The component never claims a real bank or real money moved.
 */
import { useState } from 'react'
import api from '../api/axios.js'
import { fmtInr } from '../utils/format.js'
import { Check, Lock, AlertTriangle, ArrowRight, BadgeCheck, RefreshCcw } from 'lucide-react'

/* canonical ordered list of states for the rail */
const RAIL = [
  'PAYMENT_PENDING',
  'PAYMENT_INITIATED',
  'PAYMENT_SECURED',
  'PAYMENT_RELEASED',
  'COMPLETED',
]

const ALIASES = {
  CREATED: 'PAYMENT_PENDING',
  UNPAID: 'PAYMENT_PENDING',
  PARTIAL: 'PAYMENT_INITIATED',
  PAID: 'PAYMENT_SECURED',
  REFUNDED: 'REFUNDED',
  DISPUTED: 'DISPUTED',
  DELIVERED: 'COMPLETED',
}

function normalize(s) {
  if (!s) return 'PAYMENT_PENDING'
  const upper = String(s).toUpperCase()
  return ALIASES[upper] || upper
}

function railIndex(state) {
  const i = RAIL.indexOf(state)
  return i < 0 ? -1 : i
}

const ACTION_META = {
  PAYMENT_PENDING: { label: 'Mark awaiting payment', tone: 'secondary' },
  PAYMENT_INITIATED: { label: 'Record payment initiated', tone: 'primary' },
  PAYMENT_SECURED: { label: 'Confirm payment secured', tone: 'primary' },
  PAYMENT_RELEASED: { label: 'Release payment to farmer', tone: 'primary' },
  COMPLETED: { label: 'Mark deal completed', tone: 'success' },
}

function nextState(state) {
  const i = railIndex(state)
  if (i < 0 || i >= RAIL.length - 1) return null
  return RAIL[i + 1]
}

export default function PaymentLifecycle({ deal, onChange }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [txnId, setTxnId] = useState(deal?.last_txn_id || null)

  if (!deal) return null

  const state = normalize(deal.paymentStatus || deal.status)
  const idx = railIndex(state)
  const next = nextState(state)
  const isDisputed = state === 'DISPUTED'
  const isRefunded = state === 'REFUNDED'
  const isDone = state === 'COMPLETED'

  const transition = async (target) => {
    if (busy) return
    setBusy(true)
    setErr(null)
    try {
      const r = await api.post(`/deals/${deal.public_id || deal.id}/payment-transition`, {
        to: target,
        // Amount is informational; the server echoes it back in the
        // txn record so users see exactly what was logged.
        amount: deal.amount || deal.total || null,
      })
      const newTxn = r.data?.txn_id || r.data?.transaction_id || null
      if (newTxn) setTxnId(newTxn)
      onChange?.({ ...deal, paymentStatus: target, last_txn_id: newTxn })
    } catch (e) {
      setErr(e.response?.data?.detail || e.message || 'Could not update payment state')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-card border border-ink-100 bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-display text-base text-ink-900">
          Payment lifecycle
        </h3>
        <span className="ac-chip ac-chip-ink">
          Current: <strong className="ml-1 text-ink-900">{state}</strong>
        </span>
      </div>

      {/* State rail */}
      <ol className="mt-3 grid grid-cols-5 gap-1" aria-label="Payment progress">
        {RAIL.map((s, i) => {
          const reached = idx >= i
          return (
            <li key={s} className="flex flex-col items-center text-center">
              <span
                className={
                  reached
                    ? 'flex h-7 w-7 items-center justify-center rounded-full bg-success-600 text-white'
                    : 'flex h-7 w-7 items-center justify-center rounded-full bg-ink-200 text-ink-500'
                }
                aria-current={i === idx ? 'step' : undefined}
              >
                {reached ? <Check className="h-4 w-4" /> : i + 1}
              </span>
              <span
                className={
                  reached
                    ? 'mt-1 text-[10px] font-medium text-ink-800'
                    : 'mt-1 text-[10px] text-ink-500'
                }
              >
                {labelFor(s)}
              </span>
            </li>
          )
        })}
      </ol>

      {/* Active action */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {next && !isDisputed && !isRefunded && (
          <button
            type="button"
            disabled={busy}
            onClick={() => transition(next)}
            className={
              (ACTION_META[next]?.tone === 'success' ? 'ac-btn-success ' : 'ac-btn-primary ') +
              'disabled:cursor-not-allowed disabled:opacity-50'
            }
          >
            {ACTION_META[next]?.label || `Move to ${next}`}
            <ArrowRight className="ml-1 inline h-4 w-4" />
          </button>
        )}
        {!isDisputed && !isRefunded && !isDone && (
          <button
            type="button"
            disabled={busy}
            onClick={() => transition('DISPUTED')}
            className="ac-btn-ghost disabled:cursor-not-allowed disabled:opacity-50"
          >
            <AlertTriangle className="mr-1 inline h-4 w-4" />
            Open dispute
          </button>
        )}
        {isDisputed && (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => transition('REFUNDED')}
              className="ac-btn-secondary"
            >
              <RefreshCcw className="mr-1 inline h-4 w-4" />
              Issue refund
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => transition('PAYMENT_SECURED')}
              className="ac-btn-ghost"
            >
              Resolve dispute · return to secured
            </button>
          </>
        )}
        {isDone && (
          <span className="ac-chip ac-chip-success">
            <BadgeCheck className="mr-1 inline h-3 w-3" />
            Deal complete
          </span>
        )}
      </div>

      {/* Audit trail */}
      <div className="mt-3 rounded-card border border-ink-100 bg-earth-50 p-3 text-xs text-ink-600">
        {txnId ? (
          <p>
            <Lock className="mr-1 inline h-3 w-3" />
            Last recorded transaction:{' '}
            <code className="rounded bg-white px-1 text-[11px] text-ink-800">
              {txnId}
            </code>
          </p>
        ) : (
          <p>
            <Lock className="mr-1 inline h-3 w-3" />
            No transaction recorded yet. The first transition will issue a
            reference that appears in the deal audit trail.
          </p>
        )}
        {deal.amount && (
          <p className="mt-1">Deal value: {fmtInr(deal.amount)}</p>
        )}
        {err && <p className="mt-1 text-rust-700">{err}</p>}
        <p className="mt-1 italic text-ink-500">
          Payment state flow only. Actual settlement is handled by
          regulated payment infrastructure outside AgroConnect. Transaction
          references above are deterministic internal IDs, not bank
          receipts.
        </p>
      </div>
    </section>
  )
}

function labelFor(s) {
  switch (s) {
    case 'PAYMENT_PENDING':
      return 'Pending'
    case 'PAYMENT_INITIATED':
      return 'Initiated'
    case 'PAYMENT_SECURED':
      return 'Secured'
    case 'PAYMENT_RELEASED':
      return 'Released'
    case 'COMPLETED':
      return 'Complete'
    default:
      return s
  }
}
