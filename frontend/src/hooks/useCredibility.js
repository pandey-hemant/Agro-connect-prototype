/**
 * useCredibility.js — fetch a user's credibility score, with caching.
 *
 * Calls GET /api/credibility/users/:publicId?role=... and returns
 * {credibility, status, error}. Caches the result in a module-level
 * Map keyed by (publicId, role) so multiple components on the same
 * page don't trigger duplicate requests.
 *
 * Trust rules:
 *   - Never returns a default middle score. If the API says
 *     `available: false`, that's what we return.
 *   - Never throws; a 404 is reported via the `error` field so the
 *     component can choose to render the "Not enough history yet"
 *     chip instead of an error boundary.
 *   - The hook is read-only — it never mutates any document.
 */
import { useEffect, useState } from 'react'
import api from '../api/axios.js'

// Module-level cache: { 'publicId|role': { data, ts } }
const cache = new Map()
const TTL_MS = 60_000

function key(publicId, role) {
  return `${publicId}|${role || ''}`
}

function getCached(publicId, role) {
  const entry = cache.get(key(publicId, role))
  if (!entry) return null
  if (Date.now() - entry.ts > TTL_MS) {
    cache.delete(key(publicId, role))
    return null
  }
  return entry.data
}

function setCached(publicId, role, data) {
  cache.set(key(publicId, role), { data, ts: Date.now() })
}

export default function useCredibility(publicId, role) {
  const [credibility, setCredibility] = useState(() =>
    publicId ? getCached(publicId, role) : null
  )
  const [status, setStatus] = useState(() => {
    if (!publicId) return 'idle'
    return getCached(publicId, role) ? 'succeeded' : 'loading'
  })
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!publicId) {
      setCredibility(null)
      setStatus('idle')
      return
    }
    const cached = getCached(publicId, role)
    if (cached) {
      setCredibility(cached)
      setStatus('succeeded')
      return
    }
    let cancelled = false
    setStatus('loading')
    setError(null)
    const params = {}
    if (role) params.role = role
    api
      .get(`/credibility/users/${encodeURIComponent(publicId)}`, { params })
      .then((r) => {
        if (cancelled) return
        const data = r.data || null
        setCached(publicId, role, data)
        setCredibility(data)
        setStatus('succeeded')
      })
      .catch((e) => {
        if (cancelled) return
        // 404 → user not found; treat as "no credibility" rather
        // than an error, so the component can render the chip.
        if (e.response?.status === 404) {
          const empty = { available: false, score: null, message: 'User not found' }
          setCached(publicId, role, empty)
          setCredibility(empty)
          setStatus('succeeded')
          return
        }
        setError(e.response?.data?.detail || e.message)
        setStatus('failed')
      })
    return () => {
      cancelled = true
    }
  }, [publicId, role])

  return { credibility, status, error }
}
