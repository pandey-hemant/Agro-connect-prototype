import { configureStore } from '@reduxjs/toolkit'
import healthReducer from './slices/healthSlice.js'
import cropLotReducer from './slices/cropLotSlice.js'
import marketPriceReducer from './slices/marketPriceSlice.js'
import logisticsReducer from './slices/logisticsSlice.js'
import decisionReducer from './slices/decisionSlice.js'
import buyerReducer from './slices/buyerSlice.js'
import offerReducer from './slices/offerSlice.js'
import fpoReducer from './slices/fpoSlice.js'
import qualityReducer from './slices/qualitySlice.js'
import dealReducer from './slices/dealSlice.js'
import authReducer from './slices/authSlice.js'
import demandReducer from './slices/demandSlice.js'

export const store = configureStore({
  reducer: {
    auth: authReducer,
    health: healthReducer,
    cropLots: cropLotReducer,
    marketPrices: marketPriceReducer,
    logistics: logisticsReducer,
    decisions: decisionReducer,
    buyers: buyerReducer,
    offers: offerReducer,
    fpos: fpoReducer,
    quality: qualityReducer,
    deals: dealReducer,
    demands: demandReducer,
  },
})
