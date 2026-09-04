import { Routes, Route, useParams, Navigate, useLocation, Outlet } from 'react-router-dom'
import { useSelector } from 'react-redux'
import Landing from './pages/Landing.jsx'
import Login from './pages/Login.jsx'
import Register from './pages/Register.jsx'
import RoleSelect from './pages/RoleSelect.jsx'
import FarmerDashboard from './pages/FarmerDashboard.jsx'
import SellerDashboard from './pages/SellerDashboard.jsx'
import BuyerDashboard from './pages/BuyerDashboard.jsx'
import CreateCropLot from './pages/CreateCropLot.jsx'
import CropLotDetail from './pages/CropLotDetail.jsx'
import MarketPrices from './pages/MarketPrices.jsx'
import Opportunities from './pages/Opportunities.jsx'
import DecisionSupport from './pages/DecisionSupport.jsx'
import Buyers from './pages/Buyers.jsx'
import BuyerMatch from './pages/BuyerMatch.jsx'
import Offers from './pages/Offers.jsx'
import OfferDetail from './pages/OfferDetail.jsx'
import BuyerOfferDetail from './pages/BuyerOfferDetail.jsx'
import FPOs from './pages/FPOs.jsx'
import Quality from './pages/Quality.jsx'
import Deal from './pages/Deal.jsx'
import BrowseLots from './pages/BrowseLots.jsx'
import MyOffers from './pages/MyOffers.jsx'
import MyDeals from './pages/MyDeals.jsx'
import CreateDemand from './pages/CreateDemand.jsx'
import FarmerDemands from './pages/FarmerDemands.jsx'
import BuyerMyDemands from './pages/BuyerMyDemands.jsx'
import DemandDetails from './pages/DemandDetails.jsx'
import NotFound from './components/NotFound.jsx'
import AppShell from './components/AppShell.jsx'
import MyCropsIndex from './pages/MyCropsIndex.jsx'
import MyOffersIndex from './pages/MyOffersIndex.jsx'
import { selectIsAuthed, selectRole } from './redux/slices/authSlice.js'

// Small wrapper so the URL is the source of truth for the prefilled crop.
function MarketPricesWithCrop() {
  const { crop } = useParams()
  return <MarketPrices initialCrop={decodeURIComponent(crop || '')} />
}

/**
 * RequireAuth — wraps a page so an unauthenticated user is sent to
 * /login (and after login they're sent back to where they tried to
 * go). It also enforces a role match when `role` is provided, sending
 * a wrong-role user to /role. This is the auth gate that
 * implements the requirement "Login page BEFORE role selection".
 */
function RequireAuth({ children, role }) {
  const isAuthed = useSelector(selectIsAuthed)
  const currentRole = useSelector(selectRole)
  const location = useLocation()

  if (!isAuthed) {
    const redirect = encodeURIComponent(location.pathname + location.search)
    return <Navigate to={`/login?next=${redirect}`} replace />
  }
  if (role && currentRole && currentRole !== role) {
    return <Navigate to="/role" replace />
  }
  return children
}

/**
 * AuthedLayout — wraps every logged-in page in the redesigned app
 * shell (top bar + side rail / mobile bottom nav). Centralising this
 * in a single route layout (rather than mounting <AppShell> inside
 * each page) means the side nav, the brand link, the role chip and
 * the scroll-to-top behaviour are consistent everywhere.
 *
 * SideNav returns null when not authed, so even if a stale route
 * somehow reaches here unauthed the user sees a clean page rather
 * than a half-shell.
 */
function AuthedLayout() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  )
}

function App() {
  return (
    <Routes>
      {/* Public routes — no app shell. */}
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/role" element={<RequireAuth><RoleSelect /></RequireAuth>} />

      {/* All authed routes share the redesigned app shell via this
          layout. The role gate is per-route (so a buyer can't reach a
          seller-only URL, etc.) and the shell supplies the chrome.
          The per-route <RequireAuth> wrapper still checks `isAuthed`
          so the layout below is only mounted for logged-in users. */}
      <Route element={<AuthedLayout />}>

        {/* Seller routes (role-gated) */}
        <Route path="/seller" element={<RequireAuth role="SELLER"><SellerDashboard /></RequireAuth>} />
        <Route path="/seller/crop-lots" element={<RequireAuth role="SELLER"><MyCropsIndex /></RequireAuth>} />
        <Route path="/seller/crop-lots/new" element={<RequireAuth role="SELLER"><CreateCropLot /></RequireAuth>} />
        <Route path="/seller/crop-lots/:publicId" element={<RequireAuth role="SELLER"><CropLotDetail /></RequireAuth>} />
        <Route path="/seller/crop-lots/:publicId/opportunities" element={<RequireAuth role="SELLER"><Opportunities /></RequireAuth>} />
        <Route path="/seller/crop-lots/:publicId/decision" element={<RequireAuth role="SELLER"><DecisionSupport /></RequireAuth>} />
        <Route path="/seller/crop-lots/:publicId/buyers" element={<RequireAuth role="SELLER"><BuyerMatch /></RequireAuth>} />
        <Route path="/seller/crop-lots/:publicId/offers" element={<RequireAuth role="SELLER"><Offers /></RequireAuth>} />
        <Route path="/seller/crop-lots/:publicId/quality" element={<RequireAuth role="SELLER"><Quality /></RequireAuth>} />
        <Route path="/seller/offers" element={<RequireAuth role="SELLER"><MyOffersIndex /></RequireAuth>} />
        <Route path="/seller/offers/:publicId" element={<RequireAuth role="SELLER"><OfferDetail /></RequireAuth>} />
        <Route path="/seller/deals" element={<RequireAuth role="SELLER"><MyDeals /></RequireAuth>} />
        <Route path="/farmer/deals/:publicId" element={<RequireAuth role="SELLER"><Deal /></RequireAuth>} />

        {/* Buyer routes (role-gated) */}
        <Route path="/buyer" element={<RequireAuth role="BUYER"><BuyerDashboard /></RequireAuth>} />
        <Route path="/buyer/demands" element={<RequireAuth role="BUYER"><BuyerMyDemands /></RequireAuth>} />
        <Route path="/buyer/demands/new" element={<RequireAuth role="BUYER"><CreateDemand /></RequireAuth>} />
        <Route path="/buyer/demands/:publicId" element={<RequireAuth role="BUYER"><DemandDetails /></RequireAuth>} />
        <Route path="/buyer/marketplace" element={<RequireAuth role="BUYER"><BrowseLots /></RequireAuth>} />
        <Route path="/buyer/offers" element={<RequireAuth role="BUYER"><MyOffers /></RequireAuth>} />
        <Route path="/buyer/offers/:publicId" element={<RequireAuth role="BUYER"><BuyerOfferDetail /></RequireAuth>} />
        <Route path="/buyer/deals" element={<RequireAuth role="BUYER"><MyDeals /></RequireAuth>} />
        <Route path="/buyer/deals/:publicId" element={<RequireAuth role="BUYER"><Deal /></RequireAuth>} />

        {/* Legacy / shared — auth required. */}
        <Route path="/farmer" element={<RequireAuth role="SELLER"><FarmerDashboard /></RequireAuth>} />
        <Route path="/farmer/create" element={<RequireAuth role="SELLER"><CreateCropLot /></RequireAuth>} />
        <Route path="/farmer/demands" element={<RequireAuth role="SELLER"><FarmerDemands /></RequireAuth>} />
        <Route path="/farmer/demands/:publicId" element={<RequireAuth role="SELLER"><DemandDetails /></RequireAuth>} />
        <Route path="/farmer/crop-lots" element={<RequireAuth role="SELLER"><MyCropsIndex /></RequireAuth>} />
        <Route path="/farmer/crop-lots/:publicId" element={<RequireAuth role="SELLER"><CropLotDetail /></RequireAuth>} />
        <Route path="/farmer/offers" element={<RequireAuth role="SELLER"><MyOffersIndex /></RequireAuth>} />
        <Route path="/farmer/crop-lots/:publicId/opportunities" element={<RequireAuth role="SELLER"><Opportunities /></RequireAuth>} />
        <Route path="/farmer/crop-lots/:publicId/decision" element={<RequireAuth role="SELLER"><DecisionSupport /></RequireAuth>} />
        <Route path="/farmer/crop-lots/:publicId/buyers" element={<RequireAuth role="SELLER"><BuyerMatch /></RequireAuth>} />
        <Route path="/farmer/crop-lots/:publicId/offers" element={<RequireAuth role="SELLER"><Offers /></RequireAuth>} />
        <Route path="/farmer/crop-lots/:publicId/quality" element={<RequireAuth role="SELLER"><Quality /></RequireAuth>} />
        <Route path="/farmer/offers/:publicId" element={<RequireAuth role="SELLER"><OfferDetail /></RequireAuth>} />
        <Route path="/buyers" element={<RequireAuth><Buyers /></RequireAuth>} />
        <Route path="/fpos" element={<RequireAuth><FPOs /></RequireAuth>} />
        <Route path="/market-prices" element={<RequireAuth><MarketPrices /></RequireAuth>} />
        <Route
          path="/market-prices/:crop"
          element={<RequireAuth><MarketPricesWithCrop /></RequireAuth>}
        />
      </Route>

      {/* Custom 404 — last so it only matches when nothing else did. */}
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}

export default App
