/**
 * useCountUp.js — animate a number from 0 → target on mount/update.
 *
 * Used by NetRealizationCard, DecisionCard, and PriceTrendChart's
 * delta headline so the headline doesn't pop into existence — it
 * counts up. Respects prefers-reduced-motion: when set, the hook
 * jumps straight to the target value with no animation.
 *
 * Trust rules:
 *   - Never uses easing curves that overshoot — easing is "easeOut"
 *     so the number decelerates into the target.
 *   - Honours the global prefers-reduced-motion override: if the
 *     user has asked for less motion, we skip the animation
 *     entirely.
 *   - Falls back to the target value immediately on every error
 *     path (no broken state, no NaN flash).
 */
import { useEffect, useRef, useState } from 'react'

function prefersReducedMotion() {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export default function useCountUp(target, { duration = 600, decimals = 0 } = {}) {
  const safeTarget = Number.isFinite(Number(target)) ? Number(target) : 0
  const [value, setValue] = useState(safeTarget)
  const fromRef = useRef(safeTarget)
  const rafRef = useRef(null)

  useEffect(() => {
    if (prefersReducedMotion()) {
      setValue(safeTarget)
      fromRef.current = safeTarget
      return
    }
    const from = fromRef.current
    const to = safeTarget
    if (from === to) return
    const start = performance.now()
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration)
      // ease-out cubic — decelerates into the target.
      const eased = 1 - Math.pow(1 - t, 3)
      const v = from + (to - from) * eased
      const factor = Math.pow(10, decimals)
      const rounded = Math.round(v * factor) / factor
      setValue(rounded)
      if (t < 1) {
        rafRef.current = requestAnimationFrame(step)
      } else {
        fromRef.current = to
      }
    }
    rafRef.current = requestAnimationFrame(step)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [safeTarget, duration, decimals])

  return value
}
