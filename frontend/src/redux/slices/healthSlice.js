/**
 * healthSlice — connectivity indicator state.
 *
 * Drives the "Online" / "Offline" / "Degraded" pill on the Landing
 * page. Polled from the page itself (Landing.jsx); the slice just
 * stores the result and never polls on its own.
 *
 * Wire shape (from GET /api/health):
 *   { status, service, version, database, db_mode, db_error,
 *     timestamp }
 *
 * The Redux state surfaces:
 *   - status: 'idle' | 'loading' | 'succeeded' | 'failed'
 *   - data: the last successful payload (kept even after a failure
 *     so the UI can show "last seen online at …")
 *   - lastCheckedAt: ISO timestamp of the last attempt
 *   - consecutiveFailures: counter — used by the page to switch
 *     to a tighter poll interval after a backend outage
 *   - error: human-readable failure reason (axios message, network
 *     error, etc.); NEVER includes the API key
 */
import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'
import axios from 'axios'

// A dedicated axios instance with a tighter timeout (6s) so a dead
// backend doesn't sit on "Checking…" for the full default 10s. The
// error path is what the slice's `rejected` reducer handles, so a
// timeout still flows through to the UI as "Offline" — no crash.
const healthApi = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL
    ? `${import.meta.env.VITE_API_BASE_URL}/api`
    : '/api',
  timeout: 6000,
  headers: { 'Content-Type': 'application/json' },
})

// Hit the FastAPI health endpoint through the Vite /api proxy.
export const fetchHealth = createAsyncThunk(
  'health/fetchHealth',
  async () => {
    const response = await healthApi.get('/health')
    return response.data
  },
)

const healthSlice = createSlice({
  name: 'health',
  initialState: {
    status: 'idle', // 'idle' | 'loading' | 'succeeded' | 'failed'
    data: null,
    error: null,
    lastCheckedAt: null, // ISO string
    consecutiveFailures: 0,
  },
  reducers: {
    // Manual reset — used by the Refresh button on Landing.
    resetHealth: () => ({
      status: 'idle',
      data: null,
      error: null,
      lastCheckedAt: null,
      consecutiveFailures: 0,
    }),
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchHealth.pending, (state) => {
        state.status = 'loading'
        // Preserve the previous data + lastCheckedAt so the UI can
        // still render the pill ("last seen …" line) while a new
        // request is in flight. We only flip `status` to 'loading'
        // and clear the last error.
        state.error = null
      })
      .addCase(fetchHealth.fulfilled, (state, action) => {
        state.status = 'succeeded'
        state.data = action.payload
        state.error = null
        state.lastCheckedAt = new Date().toISOString()
        state.consecutiveFailures = 0
      })
      .addCase(fetchHealth.rejected, (state, action) => {
        state.status = 'failed'
        // Keep the last successful data so the UI can show
        // "Online · last seen 2 min ago" during a transient outage.
        // Only the lastCheckedAt + error + counter change.
        state.error =
          action.error?.message ||
          (typeof action.payload === 'string' ? action.payload : null) ||
          'unreachable'
        state.lastCheckedAt = new Date().toISOString()
        state.consecutiveFailures += 1
      })
  },
})

export const { resetHealth } = healthSlice.actions

// Selectors. Components use these instead of reaching into state
// directly so the "Online" derivation is centralised.
export const selectHealthStatus = (state) => state.health.status
export const selectHealthData = (state) => state.health.data
export const selectHealthError = (state) => state.health.error
export const selectHealthLastCheckedAt = (state) => state.health.lastCheckedAt
export const selectHealthConsecutiveFailures = (state) =>
  state.health.consecutiveFailures

// Derived "effective" status. The page renders this rather than the
// raw `status` so the Degraded case (succeeded but db error) and
// the "still loading for the first time" case (idle) are both
// handled in one place.
export const selectEffectiveHealth = (state) => {
  const s = state.health
  if (s.status === 'succeeded' && s.data && s.data.database === 'ok') {
    return { kind: 'online', label: 'Online' }
  }
  if (s.status === 'succeeded' && s.data && s.data.database !== 'ok') {
    return { kind: 'degraded', label: 'Degraded' }
  }
  if (s.status === 'loading' && s.data) {
    return { kind: 'recheck', label: 'Online · re-checking…' }
  }
  if (s.status === 'loading' && !s.data) {
    return { kind: 'checking', label: 'Checking…' }
  }
  if (s.status === 'failed') {
    return { kind: 'offline', label: 'Offline' }
  }
  return { kind: 'idle', label: 'Not yet requested' }
}

export default healthSlice.reducer
