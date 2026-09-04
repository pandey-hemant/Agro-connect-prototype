import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'
import api from '../../api/axios.js'

// The backend wraps every list response in { results: [...] }. The thunks
// unwrap the envelope so the reducers (and any caller reading
// action.payload directly) always receive a plain array. This is what
// prevents the FarmerDashboard `offers.slice is not a function` crash
// when the dashboard dispatches fetchOffers and stores action.payload
// in local state — without unwrapping here, the dashboard would store
// the {results: [...]} envelope and `.slice()` would throw.
const unwrapList = (resp) =>
  resp && Array.isArray(resp.results) ? resp.results : []

// GET /api/offers?crop_lot_id=...
export const fetchOffers = createAsyncThunk(
  'offers/fetchForLot',
  async (cropLotId, { rejectWithValue }) => {
    try {
      const response = await api.get('/offers', { params: { crop_lot_id: cropLotId } })
      return unwrapList(response.data)
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.detail || 'Failed to load offers'
      )
    }
  }
)

// GET /api/offers/by-buyer/{buyer_id}
export const fetchOffersByBuyer = createAsyncThunk(
  'offers/fetchByBuyer',
  async (buyerId, { rejectWithValue }) => {
    try {
      const response = await api.get(`/offers/by-buyer/${buyerId}`)
      return unwrapList(response.data)
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.detail || 'Failed to load buyer offers'
      )
    }
  }
)

// GET /api/offers/{public_id}
export const fetchOfferById = createAsyncThunk(
  'offers/fetchById',
  async (publicId, { rejectWithValue }) => {
    try {
      const response = await api.get(`/offers/${publicId}`)
      return response.data
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.detail || 'Failed to load offer'
      )
    }
  }
)

// POST /api/offers
export const createOffer = createAsyncThunk(
  'offers/create',
  async (payload, { rejectWithValue }) => {
    try {
      const response = await api.post('/offers', payload)
      return response.data
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.detail || 'Failed to create offer'
      )
    }
  }
)

// POST /api/offers/{id}/counter
export const counterOffer = createAsyncThunk(
  'offers/counter',
  async ({ publicId, ...body }, { rejectWithValue }) => {
    try {
      const response = await api.post(`/offers/${publicId}/counter`, body)
      return response.data
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.detail || 'Failed to counter offer'
      )
    }
  }
)

// POST /api/offers/{id}/accept
export const acceptOffer = createAsyncThunk(
  'offers/accept',
  async ({ publicId, ...body }, { rejectWithValue }) => {
    try {
      const response = await api.post(`/offers/${publicId}/accept`, body)
      return response.data
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.detail || 'Failed to accept offer'
      )
    }
  }
)

// POST /api/offers/{id}/reject
export const rejectOffer = createAsyncThunk(
  'offers/reject',
  async ({ publicId, ...body }, { rejectWithValue }) => {
    try {
      const response = await api.post(`/offers/${publicId}/reject`, body)
      return response.data
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.detail || 'Failed to reject offer'
      )
    }
  }
)

const offerSlice = createSlice({
  name: 'offers',
  initialState: {
    list: [],
    listStatus: 'idle',
    listError: null,

    current: null,
    detailStatus: 'idle',
    detailError: null,

    actionStatus: 'idle',
    actionError: null,
    lastDeal: null,
  },
  reducers: {
    clearCurrentOffer: (state) => {
      state.current = null
      state.detailStatus = 'idle'
      state.detailError = null
    },
    clearAction: (state) => {
      state.actionStatus = 'idle'
      state.actionError = null
      state.lastDeal = null
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchOffers.pending, (state) => {
        state.listStatus = 'loading'
        state.listError = null
      })
      .addCase(fetchOffers.fulfilled, (state, action) => {
        state.listStatus = 'succeeded'
        // thunk already unwraps; defend again at the reducer boundary
        state.list = Array.isArray(action.payload) ? action.payload : []
      })
      .addCase(fetchOffers.rejected, (state, action) => {
        state.listStatus = 'failed'
        state.listError = action.payload || action.error.message
      })

      .addCase(fetchOffersByBuyer.pending, (state) => {
        state.listStatus = 'loading'
        state.listError = null
      })
      .addCase(fetchOffersByBuyer.fulfilled, (state, action) => {
        state.listStatus = 'succeeded'
        // thunk already unwraps; defend again at the reducer boundary
        state.list = Array.isArray(action.payload) ? action.payload : []
      })
      .addCase(fetchOffersByBuyer.rejected, (state, action) => {
        state.listStatus = 'failed'
        state.listError = action.payload || action.error.message
      })

      .addCase(fetchOfferById.pending, (state) => {
        state.detailStatus = 'loading'
        state.detailError = null
      })
      .addCase(fetchOfferById.fulfilled, (state, action) => {
        state.detailStatus = 'succeeded'
        state.current = action.payload
      })
      .addCase(fetchOfferById.rejected, (state, action) => {
        state.detailStatus = 'failed'
        state.detailError = action.payload || action.error.message
      })

      .addCase(createOffer.pending, (state) => {
        state.actionStatus = 'loading'
        state.actionError = null
      })
      .addCase(createOffer.fulfilled, (state, action) => {
        state.actionStatus = 'succeeded'
        if (state.listStatus === 'succeeded' && action.payload?.offer) {
          state.list.unshift(action.payload.offer)
        }
      })
      .addCase(createOffer.rejected, (state, action) => {
        state.actionStatus = 'failed'
        state.actionError = action.payload || action.error.message
      })

      .addCase(counterOffer.pending, (state) => {
        state.actionStatus = 'loading'
        state.actionError = null
      })
      .addCase(counterOffer.fulfilled, (state, action) => {
        state.actionStatus = 'succeeded'
        if (action.payload?.offer) state.current = action.payload.offer
      })
      .addCase(counterOffer.rejected, (state, action) => {
        state.actionStatus = 'failed'
        state.actionError = action.payload || action.error.message
      })

      .addCase(acceptOffer.pending, (state) => {
        state.actionStatus = 'loading'
        state.actionError = null
      })
      .addCase(acceptOffer.fulfilled, (state, action) => {
        state.actionStatus = 'succeeded'
        if (action.payload?.offer) state.current = action.payload.offer
        state.lastDeal = action.payload?.deal || null
      })
      .addCase(acceptOffer.rejected, (state, action) => {
        state.actionStatus = 'failed'
        state.actionError = action.payload || action.error.message
      })

      .addCase(rejectOffer.pending, (state) => {
        state.actionStatus = 'loading'
        state.actionError = null
      })
      .addCase(rejectOffer.fulfilled, (state, action) => {
        state.actionStatus = 'succeeded'
        if (action.payload?.offer) state.current = action.payload.offer
      })
      .addCase(rejectOffer.rejected, (state, action) => {
        state.actionStatus = 'failed'
        state.actionError = action.payload || action.error.message
      })
  },
})

export const { clearCurrentOffer, clearAction } = offerSlice.actions
export default offerSlice.reducer
