import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'
import api from '../../api/axios.js'

// Async thunks for backend interaction
// The backend wraps every list response in { results: [...] }. The
// thunks unwrap the envelope so the reducers always receive an array
// (or a single object for detail/create), and the UI can use .map /
// .length / .unshift directly.
const unwrapList = (resp) => (resp && Array.isArray(resp.results) ? resp.results : [])

export const createCropLot = createAsyncThunk(
  'cropLots/create',
  async (payload, { rejectWithValue }) => {
    try {
      const response = await api.post('/crop-lots', payload)
      return response.data
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.detail || 'Failed to create crop lot'
      )
    }
  }
)

export const fetchCropLots = createAsyncThunk(
  'cropLots/fetchAll',
  async (_, { rejectWithValue }) => {
    try {
      const response = await api.get('/crop-lots')
      return unwrapList(response.data)
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.detail || 'Failed to fetch crop lots'
      )
    }
  }
)

export const fetchCropLotById = createAsyncThunk(
  'cropLots/fetchById',
  async (publicId, { rejectWithValue }) => {
    try {
      const response = await api.get(`/crop-lots/${publicId}`)
      return response.data
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.detail || 'Failed to fetch crop lot'
      )
    }
  }
)

// GET /api/crop-lots/available — buyer marketplace listing
export const fetchAvailableCropLots = createAsyncThunk(
  'cropLots/fetchAvailable',
  async (params = {}, { rejectWithValue }) => {
    try {
      const response = await api.get('/crop-lots/available', { params })
      return unwrapList(response.data)
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.detail || 'Failed to fetch available crop lots'
      )
    }
  }
)

// GET /api/crop-lots?owner=<publicId> — seller's own lots, regardless
// of status. The dashboard's "Decisions" roll-up is filtered to
// ACTIVE on the client, but the same thunk powers a future "My lots"
// list page that needs the full set.
export const fetchMyCropLots = createAsyncThunk(
  'cropLots/fetchMine',
  async (_, { getState, rejectWithValue }) => {
    try {
      const owner = getState().auth?.publicId
      if (!owner) return []
      const response = await api.get('/crop-lots', { params: { owner } })
      return unwrapList(response.data)
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.detail || 'Failed to fetch your crop lots'
      )
    }
  }
)

const cropLotSlice = createSlice({
  name: 'cropLots',
  initialState: {
    // List state
    list: [],
    listStatus: 'idle', // 'idle' | 'loading' | 'succeeded' | 'failed'
    listError: null,

    // Create state
    createStatus: 'idle',
    createError: null,
    createdLot: null,

    // Detail state
    currentLot: null,
    detailStatus: 'idle',
    detailError: null,
  },
  reducers: {
    clearCreateState: (state) => {
      state.createStatus = 'idle'
      state.createError = null
      state.createdLot = null
    },
    clearDetailState: (state) => {
      state.currentLot = null
      state.detailStatus = 'idle'
      state.detailError = null
    },
  },
  extraReducers: (builder) => {
    builder
      // Create
      .addCase(createCropLot.pending, (state) => {
        state.createStatus = 'loading'
        state.createError = null
      })
      .addCase(createCropLot.fulfilled, (state, action) => {
        state.createStatus = 'succeeded'
        state.createdLot = action.payload
        // Prepend to list if it's already loaded
        if (state.listStatus === 'succeeded') {
          state.list.unshift(action.payload)
        }
      })
      .addCase(createCropLot.rejected, (state, action) => {
        state.createStatus = 'failed'
        state.createError = action.payload || action.error.message
      })

      // Fetch all
      .addCase(fetchCropLots.pending, (state) => {
        state.listStatus = 'loading'
        state.listError = null
      })
      .addCase(fetchCropLots.fulfilled, (state, action) => {
        state.listStatus = 'succeeded'
        state.list = action.payload
      })
      .addCase(fetchCropLots.rejected, (state, action) => {
        state.listStatus = 'failed'
        state.listError = action.payload || action.error.message
      })

      // Fetch by ID
      .addCase(fetchCropLotById.pending, (state) => {
        state.detailStatus = 'loading'
        state.detailError = null
      })
      .addCase(fetchCropLotById.fulfilled, (state, action) => {
        state.detailStatus = 'succeeded'
        state.currentLot = action.payload
      })
      .addCase(fetchCropLotById.rejected, (state, action) => {
        state.detailStatus = 'failed'
        state.detailError = action.payload || action.error.message
      })

      // Available (buyer marketplace)
      .addCase(fetchAvailableCropLots.pending, (state) => {
        state.listStatus = 'loading'
        state.listError = null
      })
      .addCase(fetchAvailableCropLots.fulfilled, (state, action) => {
        state.listStatus = 'succeeded'
        state.list = action.payload
      })
      .addCase(fetchAvailableCropLots.rejected, (state, action) => {
        state.listStatus = 'failed'
        state.listError = action.payload || action.error.message
      })

      // My lots (seller). Reuses `list` so legacy selectors still
      // work; if the dashboard ever needs both views, we'd split
      // the slice, but for now this is enough.
      .addCase(fetchMyCropLots.pending, (state) => {
        state.listStatus = 'loading'
        state.listError = null
      })
      .addCase(fetchMyCropLots.fulfilled, (state, action) => {
        state.listStatus = 'succeeded'
        state.list = action.payload
      })
      .addCase(fetchMyCropLots.rejected, (state, action) => {
        state.listStatus = 'failed'
        state.listError = action.payload || action.error.message
      })
  },
})

// Selectors. We keep both names so older call sites still work.
export const selectMyLots = (state) => state.cropLots.list
export const selectMyLotsStatus = (state) => state.cropLots.listStatus
export const selectList = (state) => state.cropLots.list
export const selectListStatus = (state) => state.cropLots.listStatus

export const { clearCreateState, clearDetailState } = cropLotSlice.actions
export default cropLotSlice.reducer
