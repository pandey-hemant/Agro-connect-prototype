import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'
import api from '../../api/axios.js'

// GET /api/quality/{crop_lot_id}
export const fetchQuality = createAsyncThunk(
  'quality/fetch',
  async (cropLotId, { rejectWithValue }) => {
    try {
      const response = await api.get(`/quality/${cropLotId}`)
      return response.data
    } catch (error) {
      // 404 is expected when no assessment declared — surface as a 'null' state
      if (error.response?.status === 404) return null
      return rejectWithValue(
        error.response?.data?.detail || 'Failed to load quality'
      )
    }
  }
)

// POST /api/quality/{crop_lot_id}  (declare / re-declare)
export const declareQuality = createAsyncThunk(
  'quality/declare',
  async ({ cropLotId, ...body }, { rejectWithValue }) => {
    try {
      const response = await api.post(`/quality/${cropLotId}`, body)
      return response.data
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.detail || 'Failed to declare quality'
      )
    }
  }
)

// POST /api/quality/{crop_lot_id}/verify
export const verifyQuality = createAsyncThunk(
  'quality/verify',
  async ({ cropLotId, ...body }, { rejectWithValue }) => {
    try {
      const response = await api.post(`/quality/${cropLotId}/verify`, body)
      return response.data
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.detail || 'Failed to verify quality'
      )
    }
  }
)

const qualitySlice = createSlice({
  name: 'quality',
  initialState: {
    current: null,
    status: 'idle',
    error: null,

    declareStatus: 'idle',
    declareError: null,

    verifyStatus: 'idle',
    verifyError: null,
  },
  reducers: {
    clearQuality: (state) => {
      state.current = null
      state.status = 'idle'
      state.error = null
      state.declareStatus = 'idle'
      state.declareError = null
      state.verifyStatus = 'idle'
      state.verifyError = null
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchQuality.pending, (state) => {
        state.status = 'loading'
        state.error = null
      })
      .addCase(fetchQuality.fulfilled, (state, action) => {
        state.status = 'succeeded'
        state.current = action.payload
      })
      .addCase(fetchQuality.rejected, (state, action) => {
        state.status = 'failed'
        state.error = action.payload || action.error.message
      })

      .addCase(declareQuality.pending, (state) => {
        state.declareStatus = 'loading'
        state.declareError = null
      })
      .addCase(declareQuality.fulfilled, (state, action) => {
        state.declareStatus = 'succeeded'
        state.current = action.payload
      })
      .addCase(declareQuality.rejected, (state, action) => {
        state.declareStatus = 'failed'
        state.declareError = action.payload || action.error.message
      })

      .addCase(verifyQuality.pending, (state) => {
        state.verifyStatus = 'loading'
        state.verifyError = null
      })
      .addCase(verifyQuality.fulfilled, (state, action) => {
        state.verifyStatus = 'succeeded'
        state.current = action.payload
      })
      .addCase(verifyQuality.rejected, (state, action) => {
        state.verifyStatus = 'failed'
        state.verifyError = action.payload || action.error.message
      })
  },
})

export const { clearQuality } = qualitySlice.actions
export default qualitySlice.reducer
