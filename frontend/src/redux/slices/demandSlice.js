/**
 * demandSlice.js — buyer demand (requirement) management +
 * rule-based "demands relevant to a lot" lookup + first-class
 * Demand (RFQ) endpoints.
 *
 * Legacy subdoc-array endpoints (still supported, used by the
 * Buyer dashboard's "My Requirements" panel):
 *   GET    /api/buyers/demands                       — list all demands (with filters)
 *   GET    /api/buyers/demands-for-lot/:publicId     — scored demands for a lot
 *   GET    /api/buyers/:publicId/requirements        — list a buyer's requirements
 *   POST   /api/buyers/:publicId/requirements        — add a requirement
 *   DELETE /api/buyers/:publicId/requirements/:index — remove a requirement
 *
 * First-class Demand (RFQ) endpoints (used by the Buyer Demands page
 * and the Farmer's "Browse Buyer Demands" page):
 *   GET    /api/demands                       — list with filters
 *   GET    /api/demands/:publicId             — one demand
 *   POST   /api/demands                       — create (BUYER only)
 *   PATCH  /api/demands/:publicId             — update (status etc.)
 *   GET    /api/demands/:publicId/offers      — offers on a demand
 *   POST   /api/demands/:publicId/offers      — farmer creates offer
 *   GET    /api/demands/by-buyer/:publicId    — demands for a buyer
 *
 * The backend wraps list responses in { results: [...] }. The thunks
 * unwrap so reducers always receive a plain array.
 */
import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'
import api from '../../api/axios.js'

const unwrapList = (resp) => (resp && Array.isArray(resp.results) ? resp.results : [])

export const fetchAllDemands = createAsyncThunk(
  'demands/fetchAll',
  async (params = {}, { rejectWithValue }) => {
    try {
      const response = await api.get('/buyers/demands', { params })
      return unwrapList(response.data)
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.detail || 'Failed to load demands'
      )
    }
  }
)

export const fetchDemandsForLot = createAsyncThunk(
  'demands/fetchForLot',
  async (publicId, { rejectWithValue }) => {
    try {
      const response = await api.get(`/buyers/demands-for-lot/${publicId}`)
      return unwrapList(response.data)
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.detail || 'Failed to load demands for lot'
      )
    }
  }
)

export const fetchBuyerRequirements = createAsyncThunk(
  'demands/fetchForBuyer',
  async (publicId, { rejectWithValue }) => {
    try {
      const response = await api.get(`/buyers/${publicId}/requirements`)
      return unwrapList(response.data)
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.detail || 'Failed to load buyer requirements'
      )
    }
  }
)

export const addRequirement = createAsyncThunk(
  'demands/addRequirement',
  async ({ publicId, ...body }, { rejectWithValue }) => {
    try {
      const response = await api.post(`/buyers/${publicId}/requirements`, body)
      // backend returns the full buyer; the caller can refetch
      return response.data
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.detail || 'Failed to add requirement'
      )
    }
  }
)

export const removeRequirement = createAsyncThunk(
  'demands/removeRequirement',
  async ({ publicId, index }, { rejectWithValue }) => {
    try {
      const response = await api.delete(
        `/buyers/${publicId}/requirements/${index}`
      )
      return { publicId, index, buyer: response.data }
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.detail || 'Failed to remove requirement'
      )
    }
  }
)

// ------------------------------------------------------------------
// First-class Demand (RFQ) thunks
// ------------------------------------------------------------------

export const fetchRfqDemands = createAsyncThunk(
  'demands/fetchRfq',
  async (params = {}, { rejectWithValue }) => {
    try {
      const response = await api.get('/demands', { params })
      return unwrapList(response.data)
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.detail || 'Failed to load demands'
      )
    }
  }
)

export const fetchRfqDemandById = createAsyncThunk(
  'demands/fetchRfqById',
  async (publicId, { rejectWithValue }) => {
    try {
      const response = await api.get(`/demands/${publicId}`)
      return response.data
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.detail || 'Failed to load demand'
      )
    }
  }
)

export const fetchRfqDemandsForBuyer = createAsyncThunk(
  'demands/fetchRfqForBuyer',
  async (buyerPublicId, { rejectWithValue }) => {
    try {
      const response = await api.get(`/demands/by-buyer/${buyerPublicId}`)
      return unwrapList(response.data)
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.detail || 'Failed to load buyer demands'
      )
    }
  }
)

export const createRfqDemand = createAsyncThunk(
  'demands/createRfq',
  async (body, { rejectWithValue }) => {
    try {
      const response = await api.post('/demands', body)
      return response.data
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.detail || 'Failed to create demand'
      )
    }
  }
)

export const updateRfqDemand = createAsyncThunk(
  'demands/updateRfq',
  async ({ publicId, ...body }, { rejectWithValue }) => {
    try {
      const response = await api.patch(`/demands/${publicId}`, body)
      return response.data
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.detail || 'Failed to update demand'
      )
    }
  }
)

export const fetchOffersForRfqDemand = createAsyncThunk(
  'demands/fetchOffersForRfq',
  async (publicId, { rejectWithValue }) => {
    try {
      const response = await api.get(`/demands/${publicId}/offers`)
      return unwrapList(response.data)
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.detail || 'Failed to load offers for demand'
      )
    }
  }
)

export const createOfferOnRfqDemand = createAsyncThunk(
  'demands/createOfferOnRfq',
  async ({ publicId, ...body }, { rejectWithValue }) => {
    try {
      const response = await api.post(`/demands/${publicId}/offers`, body)
      return response.data
    } catch (error) {
      return rejectWithValue(
        error.response?.data?.detail || 'Failed to create offer on demand'
      )
    }
  }
)

const demandSlice = createSlice({
  name: 'demands',
  initialState: {
    // All demands (flat list, legacy)
    all: [],
    allStatus: 'idle',
    allError: null,

    // Demands relevant to a particular lot (scored)
    forLot: [],
    forLotId: null,
    forLotStatus: 'idle',
    forLotError: null,

    // Per-buyer requirements
    buyerReqs: [],
    buyerReqsStatus: 'idle',
    buyerReqsError: null,

    // Mutation state (add/remove)
    actionStatus: 'idle',
    actionError: null,

    // First-class RFQ list (used by Farmer → "Browse Demands" page
    // and Buyer → "My Demands" page)
    rfqList: [],
    rfqListStatus: 'idle',
    rfqListError: null,

    // One RFQ demand (used by DemandDetails page)
    rfqCurrent: null,
    rfqCurrentStatus: 'idle',
    rfqCurrentError: null,

    // Offers on a single RFQ demand
    rfqOffers: [],
    rfqOffersStatus: 'idle',
    rfqOffersError: null,

    // Demand creation / update mutation
    rfqActionStatus: 'idle',
    rfqActionError: null,
  },
  reducers: {
    clearForLot(state) {
      state.forLot = []
      state.forLotId = null
      state.forLotStatus = 'idle'
      state.forLotError = null
    },
    clearAction(state) {
      state.actionStatus = 'idle'
      state.actionError = null
    },
    clearRfqCurrent(state) {
      state.rfqCurrent = null
      state.rfqCurrentStatus = 'idle'
      state.rfqCurrentError = null
    },
    clearRfqAction(state) {
      state.rfqActionStatus = 'idle'
      state.rfqActionError = null
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchAllDemands.pending, (state) => {
        state.allStatus = 'loading'
        state.allError = null
      })
      .addCase(fetchAllDemands.fulfilled, (state, action) => {
        state.allStatus = 'succeeded'
        state.all = action.payload
      })
      .addCase(fetchAllDemands.rejected, (state, action) => {
        state.allStatus = 'failed'
        state.allError = action.payload || action.error.message
      })

      .addCase(fetchDemandsForLot.pending, (state) => {
        state.forLotStatus = 'loading'
        state.forLotError = null
      })
      .addCase(fetchDemandsForLot.fulfilled, (state, action) => {
        state.forLotStatus = 'succeeded'
        state.forLot = action.payload
      })
      .addCase(fetchDemandsForLot.rejected, (state, action) => {
        state.forLotStatus = 'failed'
        state.forLotError = action.payload || action.error.message
      })

      .addCase(fetchBuyerRequirements.pending, (state) => {
        state.buyerReqsStatus = 'loading'
        state.buyerReqsError = null
      })
      .addCase(fetchBuyerRequirements.fulfilled, (state, action) => {
        state.buyerReqsStatus = 'succeeded'
        state.buyerReqs = action.payload
      })
      .addCase(fetchBuyerRequirements.rejected, (state, action) => {
        state.buyerReqsStatus = 'failed'
        state.buyerReqsError = action.payload || action.error.message
      })

      .addCase(addRequirement.pending, (state) => {
        state.actionStatus = 'loading'
        state.actionError = null
      })
      .addCase(addRequirement.fulfilled, (state) => {
        state.actionStatus = 'succeeded'
      })
      .addCase(addRequirement.rejected, (state, action) => {
        state.actionStatus = 'failed'
        state.actionError = action.payload || action.error.message
      })

      .addCase(removeRequirement.pending, (state) => {
        state.actionStatus = 'loading'
        state.actionError = null
      })
      .addCase(removeRequirement.fulfilled, (state) => {
        state.actionStatus = 'succeeded'
      })
      .addCase(removeRequirement.rejected, (state, action) => {
        state.actionStatus = 'failed'
        state.actionError = action.payload || action.error.message
      })

      // ---------------- RFQ list ----------------
      .addCase(fetchRfqDemands.pending, (state) => {
        state.rfqListStatus = 'loading'
        state.rfqListError = null
      })
      .addCase(fetchRfqDemands.fulfilled, (state, action) => {
        state.rfqListStatus = 'succeeded'
        state.rfqList = action.payload
      })
      .addCase(fetchRfqDemands.rejected, (state, action) => {
        state.rfqListStatus = 'failed'
        state.rfqListError = action.payload || action.error.message
      })

      // ---------------- RFQ by id ----------------
      .addCase(fetchRfqDemandById.pending, (state) => {
        state.rfqCurrentStatus = 'loading'
        state.rfqCurrentError = null
      })
      .addCase(fetchRfqDemandById.fulfilled, (state, action) => {
        state.rfqCurrentStatus = 'succeeded'
        state.rfqCurrent = action.payload
      })
      .addCase(fetchRfqDemandById.rejected, (state, action) => {
        state.rfqCurrentStatus = 'failed'
        state.rfqCurrentError = action.payload || action.error.message
      })

      // ---------------- RFQ for buyer (re-uses rfqList so the
      // "My Demands" page shows the same list component) -----
      .addCase(fetchRfqDemandsForBuyer.fulfilled, (state, action) => {
        state.rfqListStatus = 'succeeded'
        state.rfqList = action.payload
      })

      // ---------------- RFQ create / update ----------------
      .addCase(createRfqDemand.pending, (state) => {
        state.rfqActionStatus = 'loading'
        state.rfqActionError = null
      })
      .addCase(createRfqDemand.fulfilled, (state, action) => {
        state.rfqActionStatus = 'succeeded'
        // Prepend so the new demand shows up immediately in the list
        if (action.payload && action.payload.public_id) {
          state.rfqList = [action.payload, ...(state.rfqList || [])]
        }
      })
      .addCase(createRfqDemand.rejected, (state, action) => {
        state.rfqActionStatus = 'failed'
        state.rfqActionError = action.payload || action.error.message
      })
      .addCase(updateRfqDemand.pending, (state) => {
        state.rfqActionStatus = 'loading'
        state.rfqActionError = null
      })
      .addCase(updateRfqDemand.fulfilled, (state, action) => {
        state.rfqActionStatus = 'succeeded'
        if (action.payload && action.payload.public_id) {
          const idx = (state.rfqList || []).findIndex(
            (d) => d.public_id === action.payload.public_id
          )
          if (idx >= 0) state.rfqList[idx] = action.payload
          if (state.rfqCurrent?.public_id === action.payload.public_id) {
            state.rfqCurrent = action.payload
          }
        }
      })
      .addCase(updateRfqDemand.rejected, (state, action) => {
        state.rfqActionStatus = 'failed'
        state.rfqActionError = action.payload || action.error.message
      })

      // ---------------- RFQ offers ----------------
      .addCase(fetchOffersForRfqDemand.pending, (state) => {
        state.rfqOffersStatus = 'loading'
        state.rfqOffersError = null
      })
      .addCase(fetchOffersForRfqDemand.fulfilled, (state, action) => {
        state.rfqOffersStatus = 'succeeded'
        state.rfqOffers = action.payload
      })
      .addCase(fetchOffersForRfqDemand.rejected, (state, action) => {
        state.rfqOffersStatus = 'failed'
        state.rfqOffersError = action.payload || action.error.message
      })
      .addCase(createOfferOnRfqDemand.fulfilled, (state, action) => {
        if (action.payload && action.payload.public_id) {
          state.rfqOffers = [action.payload, ...(state.rfqOffers || [])]
        }
      })
  },
})

export const {
  clearForLot,
  clearAction,
  clearRfqCurrent,
  clearRfqAction,
} = demandSlice.actions
export default demandSlice.reducer
