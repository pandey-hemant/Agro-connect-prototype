import axios from 'axios'

// Base URL uses the Vite dev proxy: any request to /api/* is forwarded to
// the backend (configured in vite.config.js). In production, set
// VITE_API_BASE_URL to the real backend host.
const baseURL = import.meta.env.VITE_API_BASE_URL
  ? `${import.meta.env.VITE_API_BASE_URL}/api`
  : '/api'

const api = axios.create({
  baseURL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
})

// Inject the JWT (Authorization: Bearer …) and the legacy X-Demo-User
// header on every request so the backend's demoAuth middleware can
// attach req.user. The Bearer token is the primary path; the
// X-Demo-User header is kept as a fallback for verifier scripts and
// any pre-JWT backend that's still around.
api.interceptors.request.use((config) => {
  try {
    const token = window.localStorage.getItem('agroconnect.auth.token.v1')
    if (token) {
      config.headers['Authorization'] = `Bearer ${token}`
    }
  } catch {
    /* localStorage unavailable; just skip the Bearer header */
  }
  try {
    const raw = window.localStorage.getItem('agroconnect.auth.v1')
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && parsed.publicId) {
        config.headers['X-Demo-User'] = parsed.publicId
      }
    }
  } catch {
    /* localStorage unavailable; just skip the X-Demo-User header */
  }
  return config
})

export default api
