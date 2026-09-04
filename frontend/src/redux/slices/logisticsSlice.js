import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'
import api from '../../api/axios.js'

// Compute an estimated net realisation for a (lot, destination) pair.
export const estimateLogistics = createAsyncThunk(
  'logistics/estimate',
  async (payload, { rejectWithValue }) => {
    try {
      const response = await api.post('/logistics/estimate', payload)
      return response.data
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.detail || 'Failed to compute logistics estimate'
      )
    }
  }
)

// List past estimates for a lot.
export const fetchEstimates = createAsyncThunk(
  'logistics/fetchForLot',
  async (cropLotId, { rejectWithValue }) => {
    try {
      const response = await api.get(`/logistics/estimates/${cropLotId}`)
      return response.data
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.detail || 'Failed to load estimates'
      )
    }
  }
)

// Phase 3 — fetch logistics config (vehicle rates, NHB scheme
// reference, other-costs per kg). Cached in the slice so the
// Opportunities page dropdown is populated without re-fetching on
// every form interaction.
export const fetchLogisticsConfig = createAsyncThunk(
  'logistics/fetchConfig',
  async (_, { rejectWithValue }) => {
    try {
      const response = await api.get('/logistics/config')
      return response.data
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.detail || 'Failed to load logistics config'
      )
    }
  }
)

const logisticsSlice = createSlice({
  name: 'logistics',
  initialState: {
    estimates: [],
    estimatesStatus: 'idle',
    estimatesError: null,

    current: null,
    estimateStatus: 'idle',
    estimateError: null,

    // Phase 3 — config (vehicle rates + NHB citation reference).
    config: null,
    configStatus: 'idle',
    configError: null,
  },
  reducers: {
    clearCurrent: (state) => {
      state.current = null
      state.estimateStatus = 'idle'
      state.estimateError = null
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(estimateLogistics.pending, (state) => {
        state.estimateStatus = 'loading'
        state.estimateError = null
      })
      .addCase(estimateLogistics.fulfilled, (state, action) => {
        state.estimateStatus = 'succeeded'
        state.current = action.payload
      })
      .addCase(estimateLogistics.rejected, (state, action) => {
        state.estimateStatus = 'failed'
        state.estimateError = action.payload || action.error.message
      })

      .addCase(fetchEstimates.pending, (state) => {
        state.estimatesStatus = 'loading'
        state.estimatesError = null
      })
      .addCase(fetchEstimates.fulfilled, (state, action) => {
        state.estimatesStatus = 'succeeded'
        state.estimates = action.payload
      })
      .addCase(fetchEstimates.rejected, (state, action) => {
        state.estimatesStatus = 'failed'
        state.estimatesError = action.payload || action.error.message
      })

      .addCase(fetchLogisticsConfig.pending, (state) => {
        state.configStatus = 'loading'
        state.configError = null
      })
      .addCase(fetchLogisticsConfig.fulfilled, (state, action) => {
        state.configStatus = 'succeeded'
        state.config = action.payload
      })
      .addCase(fetchLogisticsConfig.rejected, (state, action) => {
        state.configStatus = 'failed'
        state.configError = action.payload || action.error.message
      })
  },
})

export const { clearCurrent } = logisticsSlice.actions
export default logisticsSlice.reducer
