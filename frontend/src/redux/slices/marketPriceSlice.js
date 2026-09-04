import { createSlice, createAsyncThunk } from '@reduxjs/toolkit'
import api from '../../api/axios.js'

// Fetch the current market-price list, with optional filters.
// Filters are kept on the server (via the /api/market-prices query
// params) so the response count + is_live flag are always accurate.
export const fetchMarketPrices = createAsyncThunk(
  'marketPrices/fetchMarketPrices',
  async (filters = {}) => {
    const params = {}
    if (filters.crop) params.crop = filters.crop
    if (filters.location) params.location = filters.location
    if (filters.market) params.market = filters.market
    if (filters.state) params.state = filters.state
    const response = await api.get('/market-prices', { params })
    return response.data
  },
)

// Lightweight health snapshot for the market-price subsystem.
export const fetchMarketPricesHealth = createAsyncThunk(
  'marketPrices/fetchMarketPricesHealth',
  async () => {
    const response = await api.get('/market-prices/health')
    return response.data
  },
)

// Phase 3 — historical aggregation. Returns weekly/daily/monthly buckets
// with min/max/avg/modal/count and a trend badge. The response includes
// `note` that always says "NOT a forecast" — this is a built-in view
// over the Mongo MarketPrice collection, nothing more.
export const fetchMarketPriceHistory = createAsyncThunk(
  'marketPrices/fetchHistory',
  async (filters = {}) => {
    const params = {}
    if (filters.crop) params.crop = filters.crop
    if (filters.state) params.state = filters.state
    if (filters.market) params.market = filters.market
    if (filters.from) params.from = filters.from
    if (filters.to) params.to = filters.to
    if (filters.granularity) params.granularity = filters.granularity
    const response = await api.get('/market-prices/history', { params })
    return response.data
  },
)

// Phase 3 — price-prediction placeholder. By default returns
// `available: false` with a transparent "insufficient data" message.
// When enough distinct dates are present, returns a linear-trend
// extrapolation that is LABELED as such — never as a forecast.
export const fetchMarketPricePrediction = createAsyncThunk(
  'marketPrices/fetchPrediction',
  async (filters = {}) => {
    const params = {}
    if (filters.crop) params.crop = filters.crop
    if (filters.state) params.state = filters.state
    if (filters.market) params.market = filters.market
    if (filters.days) params.days = filters.days
    const response = await api.get('/market-prices/prediction', { params })
    return response.data
  },
)

const marketPriceSlice = createSlice({
  name: 'marketPrices',
  initialState: {
    // Last list response envelope (or null).
    list: null,
    listStatus: 'idle', // 'idle' | 'loading' | 'succeeded' | 'failed'
    listError: null,
    // Last applied filter set, so the UI can echo what was searched.
    filters: { crop: '', location: '', market: '', state: '' },
    // Health snapshot.
    health: null,
    healthStatus: 'idle',
    healthError: null,
    // Phase 3 — history (bucketed) + prediction envelopes.
    history: null,
    historyStatus: 'idle',
    historyError: null,
    prediction: null,
    predictionStatus: 'idle',
    predictionError: null,
  },
  reducers: {
    setFilter(state, action) {
      const { key, value } = action.payload
      state.filters[key] = value ?? ''
    },
    resetFilters(state) {
      state.filters = { crop: '', location: '', market: '', state: '' }
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchMarketPrices.pending, (state) => {
        state.listStatus = 'loading'
        state.listError = null
      })
      .addCase(fetchMarketPrices.fulfilled, (state, action) => {
        state.listStatus = 'succeeded'
        state.list = action.payload
      })
      .addCase(fetchMarketPrices.rejected, (state, action) => {
        state.listStatus = 'failed'
        state.listError = action.error.message
      })
      .addCase(fetchMarketPricesHealth.pending, (state) => {
        state.healthStatus = 'loading'
        state.healthError = null
      })
      .addCase(fetchMarketPricesHealth.fulfilled, (state, action) => {
        state.healthStatus = 'succeeded'
        state.health = action.payload
      })
      .addCase(fetchMarketPricesHealth.rejected, (state, action) => {
        state.healthStatus = 'failed'
        state.healthError = action.error.message
      })
      .addCase(fetchMarketPriceHistory.pending, (state) => {
        state.historyStatus = 'loading'
        state.historyError = null
      })
      .addCase(fetchMarketPriceHistory.fulfilled, (state, action) => {
        state.historyStatus = 'succeeded'
        state.history = action.payload
      })
      .addCase(fetchMarketPriceHistory.rejected, (state, action) => {
        state.historyStatus = 'failed'
        state.historyError = action.error.message
      })
      .addCase(fetchMarketPricePrediction.pending, (state) => {
        state.predictionStatus = 'loading'
        state.predictionError = null
      })
      .addCase(fetchMarketPricePrediction.fulfilled, (state, action) => {
        state.predictionStatus = 'succeeded'
        state.prediction = action.payload
      })
      .addCase(fetchMarketPricePrediction.rejected, (state, action) => {
        state.predictionStatus = 'failed'
        state.predictionError = action.error.message
      })
  },
})

export const { setFilter, resetFilters } = marketPriceSlice.actions
export default marketPriceSlice.reducer
