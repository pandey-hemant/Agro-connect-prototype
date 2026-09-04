import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'
import api from '../../api/axios.js'

// Get the stored (lazily-computed) decision for a Crop Lot.
export const fetchDecision = createAsyncThunk(
  'decisions/fetch',
  async (cropLotId, { rejectWithValue }) => {
    try {
      const response = await api.get(`/decisions/${cropLotId}`)
      return response.data
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.detail || 'Failed to load decision'
      )
    }
  }
)

// Force a recompute.
export const refreshDecision = createAsyncThunk(
  'decisions/refresh',
  async (cropLotId, { rejectWithValue }) => {
    try {
      const response = await api.post(`/decisions/${cropLotId}/refresh`)
      return response.data
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.detail || 'Failed to refresh decision'
      )
    }
  }
)

const decisionSlice = createSlice({
  name: 'decisions',
  initialState: {
    current: null,
    status: 'idle',
    error: null,
  },
  reducers: {
    clearDecision: (state) => {
      state.current = null
      state.status = 'idle'
      state.error = null
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchDecision.pending, (state) => {
        state.status = 'loading'
        state.error = null
      })
      .addCase(fetchDecision.fulfilled, (state, action) => {
        state.status = 'succeeded'
        state.current = action.payload
      })
      .addCase(fetchDecision.rejected, (state, action) => {
        state.status = 'failed'
        state.error = action.payload || action.error.message
      })

      .addCase(refreshDecision.pending, (state) => {
        state.status = 'loading'
      })
      .addCase(refreshDecision.fulfilled, (state, action) => {
        state.status = 'succeeded'
        state.current = action.payload
      })
      .addCase(refreshDecision.rejected, (state, action) => {
        state.status = 'failed'
        state.error = action.payload || action.error.message
      })
  },
})

export const { clearDecision } = decisionSlice.actions
export default decisionSlice.reducer
