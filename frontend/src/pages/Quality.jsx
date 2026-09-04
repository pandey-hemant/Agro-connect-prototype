/**
 * Quality.jsx — quality assessment for a crop lot.
 *
 * Mounted at /seller/crop-lots/:publicId/quality (and the legacy
 * /farmer/crop-lots/:publicId/quality). The business logic is
 * preserved verbatim — the declare / verify forms, the status
 * badges, the dispute language, the dispatch flow. The chrome is
 * the redesigned application shell.
 *
 * Trust signal: every status surfaces an explicit, plain-English
 * explanation ("This is a farmer-declared grade, not a third-party
 * certificate. Buyers should verify before paying the declared
 * price."). The status badge alone is not enough.
 */
import { useEffect, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { useParams } from 'react-router-dom'
import {
  fetchCropLotById,
} from '../redux/slices/cropLotSlice.js'
import {
  fetchQuality,
  declareQuality,
  verifyQuality,
  clearQuality,
} from '../redux/slices/qualitySlice.js'
import PageHeader from '../components/PageHeader.jsx'
import CropImage from '../components/CropImage.jsx'
import usePageMeta from '../hooks/usePageMeta.js'

const INPUT =
  'w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500'

const STATUS_TONE = {
  FARMER_DECLARED: 'bg-honey-100 text-honey-800',
  BUYER_VERIFIED: 'bg-primary-100 text-primary-800',
  VERIFIED_ACCEPTED: 'bg-success-100 text-success-700',
  DISPUTED: 'bg-rust-100 text-rust-800',
}

const STATUS_LABEL = {
  FARMER_DECLARED: 'Farmer-declared',
  BUYER_VERIFIED: 'Buyer-verified',
  VERIFIED_ACCEPTED: 'Verified · accepted',
  DISPUTED: 'Disputed',
}

function StatusBadge({ status }) {
  const tone = STATUS_TONE[status] || 'bg-ink-100 text-ink-700'
  const label = STATUS_LABEL[status] || status || 'Pending'
  return (
    <span className={`inline-block rounded-full px-3 py-1 text-xs font-medium ${tone}`}>
      {label}
    </span>
  )
}

// Distinguish lot-level assessment (what's declared here) from
// deal-level verification (what gets measured at delivery on the
// Deal page). The Quality.jsx page only edits the lot-level
// assessment; the Deal page is where actual weight/quality at
// delivery is recorded.
function LevelHint() {
  return (
    <p className="mb-4 rounded-card border border-ink-200 bg-earth-50 px-3 py-2 text-xs text-ink-600">
      <strong className="text-ink-800">Lot-level assessment.</strong> This
      page records the farmer's declared grade and any pre-deal
      verification. Actual weight and quality at delivery are recorded
      separately on the deal page as part of the deal-level verification
      flow.
    </p>
  )
}

function Quality() {
  const { publicId } = useParams()
  const dispatch = useDispatch()
  usePageMeta({
    title: 'Quality assessment',
    description: 'Declare or verify the quality grade of this lot. Every status is shown with a plain-English explanation.',
  })
  const { currentLot, detailStatus } = useSelector((state) => state.cropLots)
  const {
    current,
    status,
    error,
    declareStatus,
    declareError,
    verifyStatus,
    verifyError,
  } = useSelector((state) => state.quality)

  const lotIdNum = currentLot?.id

  const [declareForm, setDeclareForm] = useState({
    grade: 'A',
    size: '',
    appearance: '',
    moisture_pct: '',
    defects_pct: '',
    notes: '',
  })
  const [verifyForm, setVerifyForm] = useState({
    actor: 'BUYER',
    grade: '',
    defects_pct: '',
    notes: '',
  })

  useEffect(() => {
    if (publicId) dispatch(fetchCropLotById(publicId))
  }, [dispatch, publicId])

  useEffect(() => {
    if (lotIdNum) dispatch(fetchQuality(lotIdNum))
    return () => {
      dispatch(clearQuality())
    }
  }, [dispatch, lotIdNum])

  const handleDeclare = (e) => {
    e.preventDefault()
    if (!lotIdNum) return
    const body = {
      grade: declareForm.grade,
      size: declareForm.size,
      appearance: declareForm.appearance,
      moisture_pct:
        declareForm.moisture_pct === '' ? null : Number(declareForm.moisture_pct),
      defects_pct:
        declareForm.defects_pct === '' ? null : Number(declareForm.defects_pct),
      notes: declareForm.notes,
    }
    dispatch(declareQuality({ cropLotId: lotIdNum, ...body }))
  }

  const handleVerify = (e) => {
    e.preventDefault()
    if (!lotIdNum) return
    // Server computes the resulting status from a grade mismatch,
    // but we still pass the actor and an explicit status hint so
    // the user sees the DISPUTED path clearly. If the override
    // grade is missing, the server defaults to VERIFIED_ACCEPTED.
    const overrideGrade = verifyForm.grade || ''
    const declaredGrade = current?.declared_grade || ''
    const willDispute =
      overrideGrade && declaredGrade && overrideGrade !== declaredGrade
    dispatch(
      verifyQuality({
        cropLotId: lotIdNum,
        actor: verifyForm.actor,
        grade: overrideGrade || undefined,
        defects_pct:
          verifyForm.defects_pct === '' ? undefined : Number(verifyForm.defects_pct),
        notes: verifyForm.notes,
        status: willDispute ? 'DISPUTED' : 'VERIFIED_ACCEPTED',
      })
    )
  }

  const statusCopy = (() => {
    if (!current) return null
    const qs = current.quality_status || current.status
    if (qs === 'VERIFIED_ACCEPTED' || qs === 'BUYER_VERIFIED') {
      return 'This grade was independently verified by a buyer or verifier.'
    }
    if (qs === 'DISPUTED') {
      return 'A buyer or verifier disagreed with the declared grade. Resolve before trade.'
    }
    return 'This is a farmer-declared grade, not a third-party certificate. Buyers should verify before paying the declared price.'
  })()

  const headerTitle = (() => {
    if (!current) return 'Quality assessment'
    const qs = current.quality_status || current.status
    if (qs === 'VERIFIED_ACCEPTED' || qs === 'BUYER_VERIFIED') {
      return `Buyer-verified grade ${current.declared_grade}`
    }
    if (qs === 'DISPUTED') {
      return `Disputed — declared ${current.declared_grade}`
    }
    return `Farmer-declared grade ${current.declared_grade}`
  })()

  return (
    <>
      <PageHeader
        eyebrow={currentLot ? currentLot.crop_name : 'Quality'}
        title="Quality assessment"
        subtitle={
          currentLot
            ? `For ${currentLot.crop_name} · ${currentLot.quantity} ${currentLot.quantity_unit} · grades are farmer-declared until independently verified.`
            : 'Quality grades are farmer-declared until independently verified by a buyer or verifier. Buyers should not assume a declared grade has been inspected.'
        }
        back={{ to: `/seller/crop-lots/${publicId}`, label: 'Back to lot' }}
      />

      {currentLot && (
        <div className="ac-card mb-6 flex items-center gap-4 p-4">
          <CropImage
            crop={currentLot.crop_name}
            label={currentLot.crop_name}
            className="h-14 w-14 flex-shrink-0 rounded-lg"
          />
          <div className="min-w-0">
            <p className="truncate font-display text-base text-ink-900">
              {currentLot.crop_name}
              {currentLot.crop_variety ? ` · ${currentLot.crop_variety}` : ''}
            </p>
            <p className="truncate text-xs text-ink-500">
              {currentLot.location || '—'} · {currentLot.quantity}{' '}
              {currentLot.quantity_unit}
            </p>
          </div>
        </div>
      )}

      <LevelHint />

      {detailStatus === 'loading' && (
        <div className="ac-card mb-4 p-8 text-center text-sm text-ink-500">
          Loading lot…
        </div>
      )}

      {status === 'loading' && (
        <div className="ac-card mb-4 p-8 text-center text-sm text-ink-500">
          Loading assessment…
        </div>
      )}
      {status === 'failed' && (
        <div className="mb-4 rounded-card border border-rust-200 bg-rust-50 p-4 text-sm text-rust-800">
          {error}
        </div>
      )}

      {status === 'succeeded' && current && (
        <section className="ac-card mb-6 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-display text-lg text-ink-900">{headerTitle}</h2>
              <p className="text-xs text-ink-500">
                Declared by {current.declared_by}
              </p>
              {statusCopy && (
                <p className="mt-2 max-w-2xl text-xs text-ink-500">{statusCopy}</p>
              )}
            </div>
            <StatusBadge status={current.quality_status || current.status} />
          </div>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            {current.size && (
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">
                  Size
                </dt>
                <dd className="mt-0.5 text-ink-800">{current.size}</dd>
              </div>
            )}
            {current.appearance && (
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">
                  Appearance
                </dt>
                <dd className="mt-0.5 text-ink-800">{current.appearance}</dd>
              </div>
            )}
            {current.moisture_pct != null && (
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">
                  Moisture
                </dt>
                <dd className="mt-0.5 text-ink-800">{current.moisture_pct}%</dd>
              </div>
            )}
            {current.defects_pct != null && (
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">
                  Defects
                </dt>
                <dd className="mt-0.5 text-ink-800">{current.defects_pct}%</dd>
              </div>
            )}
            {current.notes && (
              <div className="sm:col-span-2">
                <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">
                  Notes
                </dt>
                <dd className="mt-0.5 text-ink-800">{current.notes}</dd>
              </div>
            )}
          </dl>
          <p className="mt-4 text-xs text-ink-400">
            Last updated {new Date(current.updated_at).toLocaleString()}
          </p>
        </section>
      )}

      {status === 'succeeded' && !current && (
        <section className="ac-card mb-6 p-5">
          <p className="text-sm text-ink-600">
            No assessment declared yet. Declare one below.
          </p>
        </section>
      )}

      <section className="ac-card mb-4 p-5">
        <h2 className="font-display text-lg text-ink-900">
          Declare / re-declare quality
        </h2>
        <p className="mt-1 text-xs text-ink-500">
          This is your own observation, not an official grade.
        </p>
        <form onSubmit={handleDeclare} className="mt-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-700">
                Grade
              </label>
              <select
                value={declareForm.grade}
                onChange={(e) =>
                  setDeclareForm({ ...declareForm, grade: e.target.value })
                }
                className={INPUT}
              >
                <option>A</option>
                <option>B</option>
                <option>C</option>
                <option>UNGRADED</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-700">
                Size
              </label>
              <input
                type="text"
                value={declareForm.size}
                onChange={(e) =>
                  setDeclareForm({ ...declareForm, size: e.target.value })
                }
                placeholder="e.g. Medium"
                className={INPUT}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-700">
                Appearance
              </label>
              <input
                type="text"
                value={declareForm.appearance}
                onChange={(e) =>
                  setDeclareForm({ ...declareForm, appearance: e.target.value })
                }
                placeholder="e.g. Clean, uniform"
                className={INPUT}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-700">
                Moisture %
              </label>
              <input
                type="number"
                step="0.1"
                value={declareForm.moisture_pct}
                onChange={(e) =>
                  setDeclareForm({ ...declareForm, moisture_pct: e.target.value })
                }
                placeholder="e.g. 8.5"
                className={INPUT}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-700">
                Defects %
              </label>
              <input
                type="number"
                step="0.1"
                value={declareForm.defects_pct}
                onChange={(e) =>
                  setDeclareForm({ ...declareForm, defects_pct: e.target.value })
                }
                placeholder="e.g. 2.0"
                className={INPUT}
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-700">
              Notes
            </label>
            <textarea
              rows={2}
              value={declareForm.notes}
              onChange={(e) =>
                setDeclareForm({ ...declareForm, notes: e.target.value })
              }
              placeholder="e.g. Stored in cool conditions, no visible damage"
              className={INPUT}
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={declareStatus === 'loading' || !lotIdNum}
              className="ac-btn-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              {declareStatus === 'loading' ? 'Saving…' : 'Save assessment'}
            </button>
            {declareError && (
              <p className="text-xs text-rust-700">{declareError}</p>
            )}
          </div>
        </form>
      </section>

      <section className="ac-card p-5">
        <h2 className="font-display text-lg text-ink-900">
          Verify as buyer / verifier
        </h2>
        <p className="mt-1 text-xs text-ink-500">
          If you pass a grade that differs from the declared one, status
          becomes DISPUTED.
        </p>
        <form onSubmit={handleVerify} className="mt-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-700">
                Actor
              </label>
              <select
                value={verifyForm.actor}
                onChange={(e) =>
                  setVerifyForm({ ...verifyForm, actor: e.target.value })
                }
                className={INPUT}
              >
                <option>BUYER</option>
                <option>VERIFIER</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-700">
                Grade override
              </label>
              <select
                value={verifyForm.grade}
                onChange={(e) =>
                  setVerifyForm({ ...verifyForm, grade: e.target.value })
                }
                className={INPUT}
              >
                <option value="">No grade override</option>
                <option>A</option>
                <option>B</option>
                <option>C</option>
                <option>UNGRADED</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-ink-700">
                Defects % (optional)
              </label>
              <input
                type="number"
                step="0.1"
                value={verifyForm.defects_pct}
                onChange={(e) =>
                  setVerifyForm({ ...verifyForm, defects_pct: e.target.value })
                }
                placeholder="e.g. 5.0"
                className={INPUT}
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-ink-700">
              Verification notes
            </label>
            <textarea
              rows={2}
              value={verifyForm.notes}
              onChange={(e) =>
                setVerifyForm({ ...verifyForm, notes: e.target.value })
              }
              placeholder="e.g. Inspected on arrival at cold storage"
              className={INPUT}
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={verifyStatus === 'loading' || !lotIdNum}
              className="ac-btn-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              {verifyStatus === 'loading' ? 'Verifying…' : 'Submit verification'}
            </button>
            {verifyError && (
              <p className="text-xs text-rust-700">{verifyError}</p>
            )}
          </div>
        </form>
      </section>
    </>
  )
}

export default Quality
