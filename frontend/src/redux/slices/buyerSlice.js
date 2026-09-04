import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'
import api from '../../api/axios.js'

// GET /api/buyers — list, optionally with ?crop= or ?state= filters
export const fetchBuyers = createAsyncThunk(
  'buyers/fetchAll',
  async (params = {}, { rejectWithValue }) => {
    try {
      const response = await api.get('/buyers', { params })
      return response.data
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.detail || 'Failed to load buyers'
      )
    }
  }
)

// GET /api/buyers/{public_id}
export const fetchBuyerById = createAsyncThunk(
  'buyers/fetchById',
  async (publicId, { rejectWithValue }) => {
    try {
      const response = await api.get(`/buyers/${publicId}`)
      return response.data
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.detail || 'Failed to load buyer'
      )
    }
  }
)

// POST /api/buyers/seed-demo
export const seedDemoBuyers = createAsyncThunk(
  'buyers/seedDemo',
  async (_, { rejectWithValue }) => {
    try {
      const response = await api.post('/buyers/seed-demo')
      return response.data
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.detail || 'Failed to seed sample buyers'
      )
    }
  }
)

// GET /api/buyers/match/{crop_lot_id}
export const matchBuyers = createAsyncThunk(
  'buyers/match',
  async (cropLotId, { rejectWithValue }) => {
    try {
      const response = await api.get(`/buyers/match/${cropLotId}`)
      return response.data
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.detail || 'Failed to match buyers'
      )
    }
  }
)

const buyerSlice = createSlice({
  name: 'buyers',
  initialState: {
    list: [],
    listMeta: null,
    listStatus: 'idle',
    listError: null,

    current: null,
    detailStatus: 'idle',
    detailError: null,

    matches: [],
    matchesMeta: null,
    matchesStatus: 'idle',
    matchesError: null,

    seedStatus: 'idle',
    seedError: null,
    seedResult: null,
  },
  reducers: {
    clearCurrentBuyer: (state) => {
      state.current = null
      state.detailStatus = 'idle'
      state.detailError = null
    },
    clearSeed: (state) => {
      state.seedStatus = 'idle'
      state.seedError = null
      state.seedResult = null
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchBuyers.pending, (state) => {
        state.listStatus = 'loading'
        state.listError = null
      })
      .addCase(fetchBuyers.fulfilled, (state, action) => {
        state.listStatus = 'succeeded'
        state.list = action.payload.results || []
        state.listMeta = {
          count: action.payload.count,
          is_live: action.payload.is_live,
          source: action.payload.source,
        }
      })
      .addCase(fetchBuyers.rejected, (state, action) => {
        state.listStatus = 'failed'
        state.listError = action.payload || action.error.message
      })

      .addCase(fetchBuyerById.pending, (state) => {
        state.detailStatus = 'loading'
        state.detailError = null
      })
      .addCase(fetchBuyerById.fulfilled, (state, action) => {
        state.detailStatus = 'succeeded'
        state.current = action.payload
      })
      .addCase(fetchBuyerById.rejected, (state, action) => {
        state.detailStatus = 'failed'
        state.detailError = action.payload || action.error.message
      })

      .addCase(matchBuyers.pending, (state) => {
        state.matchesStatus = 'loading'
        state.matchesError = null
      })
      .addCase(matchBuyers.fulfilled, (state, action) => {
        state.matchesStatus = 'succeeded'
        state.matches = action.payload.results || []
        state.matchesMeta = {
          count: action.payload.count,
          method: action.payload.method,
          crop_lot_id: action.payload.crop_lot_id,
        }
      })
      .addCase(matchBuyers.rejected, (state, action) => {
        state.matchesStatus = 'failed'
        state.matchesError = action.payload || action.error.message
      })

      .addCase(seedDemoBuyers.pending, (state) => {
        state.seedStatus = 'loading'
        state.seedError = null
      })
      .addCase(seedDemoBuyers.fulfilled, (state, action) => {
        state.seedStatus = 'succeeded'
        state.seedResult = action.payload
      })
      .addCase(seedDemoBuyers.rejected, (state, action) => {
        state.seedStatus = 'failed'
        state.seedError = action.payload || action.error.message
      })
  },
})

export const { clearCurrentBuyer, clearSeed } = buyerSlice.actions
export default buyerSlice.reducer
