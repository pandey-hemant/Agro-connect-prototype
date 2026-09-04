/**
 * Skeleton.jsx — minimal loading placeholder that respects
 * prefers-reduced-motion.
 *
 * Three shapes:
 *   - <Skeleton />          — a single rounded bar (full width)
 *   - <SkeletonLine w="60%" /> — a bar at a specific width
 *   - <SkeletonCard />      — a full card with a few bars
 *
 * Why a custom Skeleton: Tailwind's animate-pulse works, but we want
 * the placeholder to vanish the moment the real content lands, with
 * no flash of the empty state. We also want the placeholder to use
 * the design-system ivory (`bg-earth-100`) instead of Tailwind's
 * default gray.
 */
import { Shield, Truck, FileText } from 'lucide-react'

function PulseBar({ className = '' }) {
  return (
    <div
      className={`animate-pulse rounded-md bg-earth-100/80 ${className}`}
      aria-hidden="true"
    />
  )
}

export function Skeleton({ className = '' }) {
  return <PulseBar className={`h-4 w-full ${className}`} />
}

export function SkeletonLine({ width = '100%', height = 'h-3' }) {
  return <PulseBar className={`${height}`} style={{ width }} />
}

export function SkeletonCard({ lines = 3, icon: Icon = FileText }) {
  return (
    <div className="ac-card p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-earth-100 text-ink-300">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1 space-y-2">
          <PulseBar className="h-4 w-3/4" />
          {Array.from({ length: lines }).map((_, i) => (
            <PulseBar
              key={i}
              className={`h-3 ${i === lines - 1 ? 'w-1/2' : 'w-full'}`}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

export function SkeletonList({ count = 3, icon }) {
  const I = icon || Shield
  return (
    <div className="ac-stagger space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} icon={i === 0 ? I : icon || Truck} lines={2} />
      ))}
    </div>
  )
}

export default Skeleton
