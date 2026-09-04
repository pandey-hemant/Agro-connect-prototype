import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'
import api from '../../api/axios.js'

// GET /api/fpos
export const fetchFpos = createAsyncThunk(
  'fpos/fetchAll',
  async (_, { rejectWithValue }) => {
    try {
      const response = await api.get('/fpos')
      return response.data
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.detail || 'Failed to load FPOs'
      )
    }
  }
)

// GET /api/fpos/mine — FPOs the current user has at least one crop
// lot joined to. Used by the Farmer dashboard "My FPO" card. Returns
// { results: [], count: 0 } for unauthenticated / buyer / FPO users
// who have no crop lots of their own.
export const fetchMyFpos = createAsyncThunk(
  'fpos/fetchMine',
  async (_, { rejectWithValue }) => {
    try {
      const response = await api.get('/fpos/mine')
      return response.data
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.detail || 'Failed to load my FPOs'
      )
    }
  }
)

// GET /api/fpos/{public_id}
export const fetchFpoById = createAsyncThunk(
  'fpos/fetchById',
  async (publicId, { rejectWithValue }) => {
    try {
      const response = await api.get(`/fpos/${publicId}`)
      return response.data
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.detail || 'Failed to load FPO'
      )
    }
  }
)

// POST /api/fpos
export const createFpo = createAsyncThunk(
  'fpos/create',
  async (payload, { rejectWithValue }) => {
    try {
      const response = await api.post('/fpos', payload)
      return response.data
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.detail || 'Failed to create FPO'
      )
    }
  }
)

// POST /api/fpos/{id}/join
// opt_in is optional; when present the server records the explicit
// per-farmer opt-in at the same time as membership (Feature E).
export const joinFpo = createAsyncThunk(
  'fpos/join',
  async ({ publicId, crop_lot_id, opt_in }, { rejectWithValue }) => {
    try {
      const body = { crop_lot_id }
      if (typeof opt_in === 'boolean') body.opt_in = opt_in
      const response = await api.post(`/fpos/${publicId}/join`, body)
      return response.data
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.detail || 'Failed to join FPO'
      )
    }
  }
)

// POST /api/fpos/{id}/leave
export const leaveFpo = createAsyncThunk(
  'fpos/leave',
  async ({ publicId, crop_lot_id }, { rejectWithValue }) => {
    try {
      const response = await api.post(`/fpos/${publicId}/leave`, { crop_lot_id })
      return response.data
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.detail || 'Failed to leave FPO'
      )
    }
  }
)

// POST /api/fpos/{id}/opt-in — explicit per-lot group-sale opt-in.
// Membership is not enough; opted-in lots are the ones the FPO
// aggregates for bulk-demand matching. The frontend must surface
// this as a separate checkbox.
export const optInFpo = createAsyncThunk(
  'fpos/optIn',
  async ({ publicId, crop_lot_id, opt_in }, { rejectWithValue }) => {
    try {
      const response = await api.post(`/fpos/${publicId}/opt-in`, {
        crop_lot_id,
        opt_in,
      })
      return response.data
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.detail || 'Failed to update opt-in'
      )
    }
  }
)

// POST /api/fpos/seed-demo
export const seedDemoFpos = createAsyncThunk(
  'fpos/seedDemo',
  async (_, { rejectWithValue }) => {
    try {
      const response = await api.post('/fpos/seed-demo')
      return response.data
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.detail || 'Failed to seed sample FPOs'
      )
    }
  }
)

// GET /api/fpos/{id}/aggregate?crop=tomato
export const aggregateFpo = createAsyncThunk(
  'fpos/aggregate',
  async ({ publicId, crop }, { rejectWithValue }) => {
    try {
      const response = await api.get(`/fpos/${publicId}/aggregate`, {
        params: crop ? { crop } : {},
      })
      return response.data
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.detail || 'Failed to compute aggregation'
      )
    }
  }
)

const fpoSlice = createSlice({
  name: 'fpos',
  initialState: {
    list: [],
    listMeta: null,
    listStatus: 'idle',
    listError: null,

    current: null,
    detailStatus: 'idle',
    detailError: null,

    createStatus: 'idle',
    createError: null,

    seedStatus: 'idle',
    seedError: null,
    seedResult: null,

    aggregate: null,
    aggregateStatus: 'idle',
    aggregateError: null,

    myFpos: [],
    myFposStatus: 'idle',
    myFposError: null,
    myLotPublicIds: [],

    optInStatus: 'idle',
    optInError: null,
  },
  reducers: {
    clearCurrentFpo: (state) => {
      state.current = null
      state.detailStatus = 'idle'
      state.detailError = null
    },
    clearFpoCreate: (state) => {
      state.createStatus = 'idle'
      state.createError = null
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchFpos.pending, (state) => {
        state.listStatus = 'loading'
        state.listError = null
      })
      .addCase(fetchFpos.fulfilled, (state, action) => {
        state.listStatus = 'succeeded'
        state.list = action.payload.results || []
        state.listMeta = {
          count: action.payload.count,
          is_live: action.payload.is_live,
          source: action.payload.source,
        }
      })
      .addCase(fetchFpos.rejected, (state, action) => {
        state.listStatus = 'failed'
        state.listError = action.payload || action.error.message
      })

      .addCase(fetchFpoById.pending, (state) => {
        state.detailStatus = 'loading'
        state.detailError = null
      })
      .addCase(fetchFpoById.fulfilled, (state, action) => {
        state.detailStatus = 'succeeded'
        state.current = action.payload
      })
      .addCase(fetchFpoById.rejected, (state, action) => {
        state.detailStatus = 'failed'
        state.detailError = action.payload || action.error.message
      })

      .addCase(createFpo.pending, (state) => {
        state.createStatus = 'loading'
        state.createError = null
      })
      .addCase(createFpo.fulfilled, (state, action) => {
        state.createStatus = 'succeeded'
        if (action.payload) {
          state.current = action.payload
          if (state.listStatus === 'succeeded') state.list.unshift(action.payload)
        }
      })
      .addCase(createFpo.rejected, (state, action) => {
        state.createStatus = 'failed'
        state.createError = action.payload || action.error.message
      })

      .addCase(joinFpo.pending, (state) => {
        state.detailStatus = 'loading'
      })
      .addCase(joinFpo.fulfilled, (state, action) => {
        state.detailStatus = 'succeeded'
        if (action.payload) state.current = action.payload
      })
      .addCase(joinFpo.rejected, (state, action) => {
        state.detailStatus = 'failed'
        state.detailError = action.payload || action.error.message
      })

      .addCase(leaveFpo.pending, (state) => {
        state.detailStatus = 'loading'
      })
      .addCase(leaveFpo.fulfilled, (state, action) => {
        state.detailStatus = 'succeeded'
        if (action.payload) state.current = action.payload
      })
      .addCase(leaveFpo.rejected, (state, action) => {
        state.detailStatus = 'failed'
        state.detailError = action.payload || action.error.message
      })

      .addCase(optInFpo.pending, (state) => {
        state.optInStatus = 'loading'
        state.optInError = null
      })
      .addCase(optInFpo.fulfilled, (state, action) => {
        state.optInStatus = 'succeeded'
        // Update current FPO's matching member so subsequent re-fetches
        // don't clobber the local opt-in state.
        if (state.current && action.payload) {
          const m = (state.current.members || []).find(
            (mm) => mm.crop_lot_id === action.payload.crop_lot_id
          )
          if (m) {
            m.opted_in = action.payload.opted_in
            m.opted_in_at = action.payload.opted_in_at
          }
        }
      })
      .addCase(optInFpo.rejected, (state, action) => {
        state.optInStatus = 'failed'
        state.optInError = action.payload || action.error.message
      })

      .addCase(seedDemoFpos.pending, (state) => {
        state.seedStatus = 'loading'
        state.seedError = null
      })
      .addCase(seedDemoFpos.fulfilled, (state, action) => {
        state.seedStatus = 'succeeded'
        state.seedResult = action.payload
      })
      .addCase(seedDemoFpos.rejected, (state, action) => {
        state.seedStatus = 'failed'
        state.seedError = action.payload || action.error.message
      })

      .addCase(aggregateFpo.pending, (state) => {
        state.aggregateStatus = 'loading'
        state.aggregateError = null
      })
      .addCase(aggregateFpo.fulfilled, (state, action) => {
        state.aggregateStatus = 'succeeded'
        state.aggregate = action.payload
      })
      .addCase(aggregateFpo.rejected, (state, action) => {
        state.aggregateStatus = 'failed'
        state.aggregateError = action.payload || action.error.message
      })

      .addCase(fetchMyFpos.pending, (state) => {
        state.myFposStatus = 'loading'
        state.myFposError = null
      })
      .addCase(fetchMyFpos.fulfilled, (state, action) => {
        state.myFposStatus = 'succeeded'
        state.myFpos = action.payload?.results || []
        state.myLotPublicIds = action.payload?.my_lot_public_ids || []
      })
      .addCase(fetchMyFpos.rejected, (state, action) => {
        state.myFposStatus = 'failed'
        state.myFposError = action.payload || action.error.message
        state.myFpos = []
        state.myLotPublicIds = []
      })
  },
})

export const { clearCurrentFpo, clearFpoCreate } = fpoSlice.actions
export default fpoSlice.reducer
