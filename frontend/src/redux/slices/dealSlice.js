import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'
import api from '../../api/axios.js'

// GET /api/deals/{public_id}
export const fetchDeal = createAsyncThunk(
  'deals/fetch',
  async (publicId, { rejectWithValue }) => {
    try {
      const response = await api.get(`/deals/${publicId}`)
      return response.data
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.detail || 'Failed to load deal'
      )
    }
  }
)

// GET /api/deals?crop_lot_id=...
export const fetchDealsForLot = createAsyncThunk(
  'deals/fetchForLot',
  async (cropLotId, { rejectWithValue }) => {
    try {
      const response = await api.get('/deals', { params: { crop_lot_id: cropLotId } })
      return response.data
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.detail || 'Failed to load deals'
      )
    }
  }
)

// GET /api/deals?buyer_id=...
export const fetchDealsForBuyer = createAsyncThunk(
  'deals/fetchForBuyer',
  async (buyerId, { rejectWithValue }) => {
    try {
      const response = await api.get('/deals', { params: { buyer_id: buyerId } })
      return response.data
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.detail || 'Failed to load deals for buyer'
      )
    }
  }
)

// GET /api/deals — all deals in the system
export const fetchAllDeals = createAsyncThunk(
  'deals/fetchAll',
  async (_, { rejectWithValue }) => {
    try {
      const response = await api.get('/deals')
      return response.data
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.detail || 'Failed to load deals'
      )
    }
  }
)

// GET /api/deals/{public_id}/enriched — deal + joined crop_lot + buyer + offer
export const fetchDealEnriched = createAsyncThunk(
  'deals/fetchEnriched',
  async (publicId, { rejectWithValue }) => {
    try {
      const response = await api.get(`/deals/${publicId}/enriched`)
      return response.data
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.detail || 'Failed to load deal'
      )
    }
  }
)

// GET /api/deals/list-enriched?role=BUYER&buyer_id=…&seller_user_public_id=…
// Returns the same enriched shape as fetchDealEnriched for every
// matching deal, in one round trip.
export const fetchEnrichedDealsForBuyer = createAsyncThunk(
  'deals/fetchEnrichedForBuyer',
  async (buyerId, { rejectWithValue }) => {
    try {
      const response = await api.get('/deals/list-enriched', {
        params: { role: 'BUYER', buyer_id: buyerId },
      })
      return response.data
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.detail || 'Failed to load buyer deals'
      )
    }
  }
)

export const fetchEnrichedDealsForSeller = createAsyncThunk(
  'deals/fetchEnrichedForSeller',
  async (sellerUserPublicId, { rejectWithValue }) => {
    try {
      const response = await api.get('/deals/list-enriched', {
        params: { role: 'FARMER', seller_user_public_id: sellerUserPublicId },
      })
      return response.data
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.detail || 'Failed to load seller deals'
      )
    }
  }
)

// POST /api/deals/{public_id}/status
export const updateDealStatus = createAsyncThunk(
  'deals/updateStatus',
  async ({ publicId, ...body }, { rejectWithValue }) => {
    try {
      const response = await api.post(`/deals/${publicId}/status`, body)
      return response.data
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.detail || 'Failed to update deal status'
      )
    }
  }
)

const dealSlice = createSlice({
  name: 'deals',
  initialState: {
    current: null,
    status: 'idle',
    error: null,

    list: [],
    listStatus: 'idle',
    listError: null,

    // Enriched views (deal + joined crop_lot + buyer)
    enriched: null,
    enrichedStatus: 'idle',
    enrichedError: null,

    enrichedList: [],
    enrichedListStatus: 'idle',
    enrichedListError: null,

    updateStatus: 'idle',
    updateError: null,
  },
  reducers: {
    clearCurrentDeal: (state) => {
      state.current = null
      state.status = 'idle'
      state.error = null
    },
    clearEnrichedDeal: (state) => {
      state.enriched = null
      state.enrichedStatus = 'idle'
      state.enrichedError = null
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchDeal.pending, (state) => {
        state.status = 'loading'
        state.error = null
      })
      .addCase(fetchDeal.fulfilled, (state, action) => {
        state.status = 'succeeded'
        state.current = action.payload
      })
      .addCase(fetchDeal.rejected, (state, action) => {
        state.status = 'failed'
        state.error = action.payload || action.error.message
      })

      .addCase(fetchDealsForLot.pending, (state) => {
        state.listStatus = 'loading'
        state.listError = null
      })
      .addCase(fetchDealsForLot.fulfilled, (state, action) => {
        state.listStatus = 'succeeded'
        state.list = action.payload.results || []
      })
      .addCase(fetchDealsForLot.rejected, (state, action) => {
        state.listStatus = 'failed'
        state.listError = action.payload || action.error.message
      })

      .addCase(fetchDealsForBuyer.pending, (state) => {
        state.listStatus = 'loading'
        state.listError = null
      })
      .addCase(fetchDealsForBuyer.fulfilled, (state, action) => {
        state.listStatus = 'succeeded'
        state.list = action.payload.results || []
      })
      .addCase(fetchDealsForBuyer.rejected, (state, action) => {
        state.listStatus = 'failed'
        state.listError = action.payload || action.error.message
      })

      .addCase(fetchAllDeals.pending, (state) => {
        state.listStatus = 'loading'
        state.listError = null
      })
      .addCase(fetchAllDeals.fulfilled, (state, action) => {
        state.listStatus = 'succeeded'
        state.list = action.payload.results || []
      })
      .addCase(fetchAllDeals.rejected, (state, action) => {
        state.listStatus = 'failed'
        state.listError = action.payload || action.error.message
      })

      .addCase(updateDealStatus.pending, (state) => {
        state.updateStatus = 'loading'
        state.updateError = null
      })
      .addCase(updateDealStatus.fulfilled, (state, action) => {
        state.updateStatus = 'succeeded'
        state.current = action.payload
      })
      .addCase(updateDealStatus.rejected, (state, action) => {
        state.updateStatus = 'failed'
        state.updateError = action.payload || action.error.message
      })

      .addCase(fetchDealEnriched.pending, (state) => {
        state.enrichedStatus = 'loading'
        state.enrichedError = null
      })
      .addCase(fetchDealEnriched.fulfilled, (state, action) => {
        state.enrichedStatus = 'succeeded'
        state.enriched = action.payload
      })
      .addCase(fetchDealEnriched.rejected, (state, action) => {
        state.enrichedStatus = 'failed'
        state.enrichedError = action.payload || action.error.message
      })

      .addCase(fetchEnrichedDealsForBuyer.pending, (state) => {
        state.enrichedListStatus = 'loading'
        state.enrichedListError = null
      })
      .addCase(fetchEnrichedDealsForBuyer.fulfilled, (state, action) => {
        state.enrichedListStatus = 'succeeded'
        state.enrichedList = action.payload.results || []
      })
      .addCase(fetchEnrichedDealsForBuyer.rejected, (state, action) => {
        state.enrichedListStatus = 'failed'
        state.enrichedListError = action.payload || action.error.message
      })

      .addCase(fetchEnrichedDealsForSeller.pending, (state) => {
        state.enrichedListStatus = 'loading'
        state.enrichedListError = null
      })
      .addCase(fetchEnrichedDealsForSeller.fulfilled, (state, action) => {
        state.enrichedListStatus = 'succeeded'
        state.enrichedList = action.payload.results || []
      })
      .addCase(fetchEnrichedDealsForSeller.rejected, (state, action) => {
        state.enrichedListStatus = 'failed'
        state.enrichedListError = action.payload || action.error.message
      })
  },
})

export const { clearCurrentDeal, clearEnrichedDeal } = dealSlice.actions
export default dealSlice.reducer
