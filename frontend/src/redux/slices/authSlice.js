/**
 * Auth slice — JWT-based "who am I" state.
 *
 * AgroConnect's prototype auth:
 *   • POST /api/auth/register  → bcrypt-hashed password + JWT
 *   • POST /api/auth/login     → bcrypt-compared + JWT
 *   • GET  /api/auth/me        → returns the user (or null when anon)
 *   • POST /api/auth/logout    → 200 ok (stateless; client drops the token)
 *
 * The JWT is stored under a separate localStorage key
 * (`agroconnect.auth.token.v1`) and the axios interceptor sends it
 * as `Authorization: Bearer …` on every request. The user payload is
 * also cached under `agroconnect.auth.v1` so the UI can render the
 * profile picture and "you are signed in as X" line without a
 * round-trip. The token is the source of truth for *who* the
 * request is from; the cached payload is for rendering only.
 *
 * Role comes from the database on every request (the backend's
 * demoAuth middleware does the lookup). The token itself contains
 * `sub` (publicId) and `role` but the backend re-reads the user
 * document, so a client cannot elevate its role by tampering with
 * the token.
 */
import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'
import api from '../../api/axios.js'

const STORAGE_KEY = 'agroconnect.auth.v1'
const TOKEN_KEY = 'agroconnect.auth.token.v1'

function readPersisted() {
  if (typeof window === 'undefined') {
    return {
      role: null, publicId: null, displayName: null, email: null,
      name: null, phone: null, isDemo: null,
      activeBuyer: null, activeFpo: null, token: null,
    }
  }
  let user = {
    role: null, publicId: null, displayName: null, email: null,
    name: null, phone: null, isDemo: null,
    activeBuyer: null, activeFpo: null,
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      user = {
        role: parsed.role || null,
        publicId: parsed.publicId || null,
        displayName: parsed.displayName || null,
        email: parsed.email || null,
        name: parsed.name || null,
        phone: parsed.phone || null,
        isDemo: parsed.isDemo ?? null,
        activeBuyer: parsed.activeBuyer || null,
        activeFpo: parsed.activeFpo || null,
      }
    }
  } catch {
    /* keep defaults */
  }
  let token = null
  try {
    token = window.localStorage.getItem(TOKEN_KEY) || null
  } catch {
    /* keep null */
  }
  return { ...user, token }
}

function applyUser(state, payload, token) {
  const u = payload || {}
  state.publicId = u.public_id || null
  if (u.role) state.role = u.role
  if (u.display_name != null) state.displayName = u.display_name
  if (u.email != null) state.email = u.email
  if (u.name != null) state.name = u.name
  if (u.phone != null) state.phone = u.phone
  if (u.is_demo != null) state.isDemo = !!u.is_demo
  if (u.active_buyer_id != null) {
    state.activeBuyer = {
      id: u.active_buyer_id,
      public_id: null,
      name: state.activeBuyer?.name || null,
    }
  } else if (u.role !== 'BUYER') {
    state.activeBuyer = null
  }
  if (u.active_fpo_id) {
    state.activeFpo = {
      public_id: u.active_fpo_id,
      name: state.activeFpo?.name || null,
    }
  } else if (u.role !== 'FPO') {
    state.activeFpo = null
  }
  if (token != null) {
    state.token = token
  }
  writePersisted(state)
}

function writePersisted(state) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        role: state.role,
        publicId: state.publicId,
        displayName: state.displayName,
        email: state.email,
        name: state.name,
        phone: state.phone,
        isDemo: state.isDemo,
        activeBuyer: state.activeBuyer,
        activeFpo: state.activeFpo,
      }),
    )
  } catch {
    /* localStorage unavailable; we just lose persistence */
  }
  try {
    if (state.token) {
      window.localStorage.setItem(TOKEN_KEY, state.token)
    } else {
      window.localStorage.removeItem(TOKEN_KEY)
    }
  } catch {
    /* keep going */
  }
}

const initialState = {
  ...readPersisted(),
  status: 'idle',
  error: null,
}

/**
 * Thunk: register a new account. POST /api/auth/register.
 * Returns `{ user, token }`. Auto-logs the user in on success.
 */
export const register = createAsyncThunk(
  'auth/register',
  async (
    { name, email, phone, password, confirm_password, role } = {},
    { rejectWithValue }
  ) => {
    try {
      const response = await api.post('/auth/register', {
        name,
        email,
        phone,
        password,
        confirm_password,
        role,
      })
      return response.data // { user, token, token_type }
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.detail || 'registration failed',
      )
    }
  },
)

/**
 * Thunk: prototype email/password login. POST /api/auth/login.
 * Returns `{ user, token }`. Backend uses bcrypt for real accounts
 * and falls back to plain-text comparison for legacy demo accounts.
 */
export const login = createAsyncThunk(
  'auth/login',
  async ({ email, password } = {}, { rejectWithValue }) => {
    try {
      const response = await api.post('/auth/login', { email, password })
      return response.data // { user, token, token_type }
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.detail || 'login failed',
      )
    }
  },
)

/**
 * Thunk: GET /api/auth/me. If a token is present, returns the current
 * user. If the token is gone or the user was deleted, returns null.
 * Used to rehydrate the UI on refresh.
 */
export const fetchMe = createAsyncThunk(
  'auth/fetchMe',
  async (_arg, { rejectWithValue }) => {
    try {
      const response = await api.get('/auth/me')
      return response.data // { user } or { user: null }
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.detail || 'failed to fetch current user',
      )
    }
  },
)

/**
 * Thunk: POST /api/auth/logout. Stateless on the server (the JWT
 * isn't tracked) but we still hit the endpoint so future revisions
 * (a denylist, audit log) will work. Locally we drop the token and
 * the cached user payload.
 */
export const logout = createAsyncThunk(
  'auth/logout',
  async (_arg, { rejectWithValue }) => {
    try {
      await api.post('/auth/logout')
      return true
    } catch (error) {
      // Even on failure, we still want the client to drop the token —
      // an expired/invalid token is a valid reason for logout. The
      // server already treats 401 as "anonymous" for everything that
      // matters, so a 401 here is fine.
      return true
    }
  },
)

/**
 * Thunk: talk to the backend /api/auth/demo-login. Reuses the stored
 * publicId if we already have one so the backend updates the existing
 * row instead of creating a new one. Still returns a JWT.
 *
 * Phase 4 — buyerId is sent as-is. Previously the backend coerced
 * it with `Number(buyerId)` which returned NaN for Mongo ObjectId
 * strings, surfacing a 500. The backend now accepts ObjectId,
 * BUY-... publicId, or numeric ids; 4xx with a clear message is
 * returned for any other input and rendered as `state.error`.
 */
export const demoLogin = createAsyncThunk(
  'auth/demoLogin',
  async ({ role, buyerId, fpoId } = {}, { rejectWithValue, getState }) => {
    try {
      const existing = getState().auth.publicId
      const response = await api.post('/auth/demo-login', {
        role,
        buyerId: buyerId == null || buyerId === '' ? undefined : buyerId,
        fpoId: fpoId == null || fpoId === '' ? undefined : fpoId,
        publicId: existing || undefined,
      })
      return response.data
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.detail || 'demo-login failed',
      )
    }
  },
)

export const switchRole = createAsyncThunk(
  'auth/switchRole',
  async ({ role, buyerId, fpoId } = {}, { rejectWithValue }) => {
    try {
      const response = await api.post('/auth/switch-role', {
        role,
        buyerId: buyerId == null || buyerId === '' ? undefined : buyerId,
        fpoId: fpoId == null || fpoId === '' ? undefined : fpoId,
      })
      return response.data
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.detail || 'switch-role failed',
      )
    }
  },
)

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    setRole(state, action) {
      const next = action.payload
      if (!['SELLER', 'BUYER', 'FPO'].includes(next)) {
        state.role = null
      } else {
        state.role = next
        if (next === 'SELLER') {
          state.activeBuyer = null
          state.activeFpo = null
        }
        if (next === 'BUYER') {
          state.activeFpo = null
        }
        if (next === 'FPO') {
          state.activeBuyer = null
        }
      }
      writePersisted(state)
    },
    setActiveBuyer(state, action) {
      const buyer = action.payload
      if (buyer && typeof buyer === 'object' && buyer.id) {
        state.activeBuyer = {
          id: buyer.id,
          public_id: buyer.public_id,
          name: buyer.name,
        }
        state.role = 'BUYER'
      } else {
        state.activeBuyer = null
      }
      writePersisted(state)
    },
    setActiveFpo(state, action) {
      const fpo = action.payload
      if (fpo && typeof fpo === 'object' && fpo.public_id) {
        state.activeFpo = {
          public_id: fpo.public_id,
          name: fpo.name,
        }
        state.role = 'FPO'
      } else {
        state.activeFpo = null
      }
      writePersisted(state)
    },
    clearAuth(state) {
      state.role = null
      state.publicId = null
      state.displayName = null
      state.email = null
      state.name = null
      state.phone = null
      state.isDemo = null
      state.activeBuyer = null
      state.activeFpo = null
      state.token = null
      writePersisted(state)
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(login.pending, (state) => {
        state.status = 'loading'
        state.error = null
      })
      .addCase(login.fulfilled, (state, action) => {
        state.status = 'succeeded'
        applyUser(state, action.payload?.user, action.payload?.token)
      })
      .addCase(login.rejected, (state, action) => {
        state.status = 'failed'
        state.error = action.payload || action.error.message
      })
      .addCase(register.pending, (state) => {
        state.status = 'loading'
        state.error = null
      })
      .addCase(register.fulfilled, (state, action) => {
        state.status = 'succeeded'
        applyUser(state, action.payload?.user, action.payload?.token)
      })
      .addCase(register.rejected, (state, action) => {
        state.status = 'failed'
        state.error = action.payload || action.error.message
      })
      .addCase(demoLogin.pending, (state) => {
        state.status = 'loading'
        state.error = null
      })
      .addCase(demoLogin.fulfilled, (state, action) => {
        state.status = 'succeeded'
        applyUser(state, action.payload?.user, action.payload?.token)
      })
      .addCase(demoLogin.rejected, (state, action) => {
        state.status = 'failed'
        state.error = action.payload || action.error.message
      })
      .addCase(fetchMe.fulfilled, (state, action) => {
        const u = action.payload?.user
        if (u) {
          // /me doesn't return a token (it uses the one we sent). Just
          // refresh the cached user payload.
          applyUser(state, u, state.token)
        } else {
          // Token was invalid or the user was deleted. Drop everything.
          state.role = null
          state.publicId = null
          state.displayName = null
          state.email = null
          state.name = null
          state.phone = null
          state.isDemo = null
          state.activeBuyer = null
          state.activeFpo = null
          state.token = null
          writePersisted(state)
        }
      })
      .addCase(switchRole.fulfilled, (state, action) => {
        applyUser(state, action.payload?.user, state.token)
      })
      .addCase(logout.fulfilled, (state) => {
        state.role = null
        state.publicId = null
        state.displayName = null
        state.email = null
        state.name = null
        state.phone = null
        state.isDemo = null
        state.activeBuyer = null
        state.activeFpo = null
        state.token = null
        state.status = 'idle'
        state.error = null
        writePersisted(state)
      })
  },
})

export const { setRole, setActiveBuyer, setActiveFpo, clearAuth } = authSlice.actions

export const selectRole = (state) => state.auth.role
export const selectPublicId = (state) => state.auth.publicId
export const selectDisplayName = (state) => state.auth.displayName
export const selectEmail = (state) => state.auth.email
export const selectName = (state) => state.auth.name || state.auth.displayName
export const selectPhone = (state) => state.auth.phone
export const selectIsDemo = (state) => !!state.auth.isDemo
export const selectActiveBuyer = (state) => state.auth.activeBuyer
export const selectActiveFpo = (state) => state.auth.activeFpo
export const selectToken = (state) => state.auth.token
export const selectIsSeller = (state) => state.auth.role === 'SELLER'
export const selectIsBuyer = (state) => state.auth.role === 'BUYER'
export const selectIsFpo = (state) => state.auth.role === 'FPO'
export const selectIsAuthed = (state) => !!state.auth.publicId
export const selectAuthStatus = (state) => state.auth.status
export const selectAuthError = (state) => state.auth.error

export default authSlice.reducer
