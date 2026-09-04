"""Logistics estimation service.

Computes per-destination distance, transport, loading, unloading, and
"other" costs, and the resulting net realisation. All numbers are
**estimates**. The service is deliberately defensive: any failure from a
live routing API falls back to a haversine estimate and the response still
goes out with ``is_estimate=True``.

Distance strategy:

* If a routing key is configured, try a live road-network call. Any
  error → fall back to haversine.
* If no key is configured, always use haversine from a small built-in
  lookup of district / state centroids.

Pricing:

* Quantity is converted to kilograms first (kg / quintal=100 / ton=1000).
* Transport cost = ``rate * distance_km * quantity_kg`` clamped to
  ``min_transport``.
* Loading = ``loading_per_kg * quantity_kg``.
* Unloading = ``unloading_per_kg * quantity_kg``.
* Other = ``pct * gross_value``.
* Gross value = ``modal_price * quantity_kg`` (or lot's
  ``minimum_acceptable_price`` if present and lower — never above the
  market, to avoid optimistic numbers).
* Net = gross − transport − loading − unloading − other.
"""
from __future__ import annotations

import json
import logging
import math
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional, Tuple

from app.core.config import settings
from app.schemas.logistics import (
    LogisticsConfigResponse,
    LogisticsEstimateBreakdown,
    LogisticsEstimateRead,
    LogisticsEstimateRequest,
)

logger = logging.getLogger(__name__)


# --- small built-in centroid lookup ---------------------------------------
# Coordinates are rough (single decimal place is fine). This is an
# estimate, not a geocoding service. If the district is unknown the
# service uses the state centroid; if the state is unknown it returns
# a default (Delhi) and labels the result as an estimate.
CENTROIDS: Dict[str, Tuple[float, float]] = {
    # states
    "delhi": (28.6139, 77.2090),
    "maharashtra": (19.7515, 75.7139),
    "uttar pradesh": (26.8467, 80.9462),
    "punjab": (31.1471, 75.3412),
    "haryana": (29.0588, 76.0856),
    "karnataka": (15.3173, 75.7139),
    "madhya pradesh": (22.9734, 78.6569),
    "gujarat": (22.2587, 71.1924),
    "andhra pradesh": (15.9129, 79.7400),
    "jharkhand": (23.6102, 85.2799),
    "bihar": (25.0961, 85.3131),
    "tamil nadu": (11.1271, 78.6569),
    "kerala": (10.8505, 76.2711),
    "west bengal": (22.9868, 87.8550),
    "rajasthan": (27.0238, 74.2179),
    "odisha": (20.9517, 85.0985),
    # districts
    "north delhi": (28.7041, 77.1025),
    "nashik": (19.9975, 73.7898),
    "agra": (27.1767, 78.0081),
    "ludhiana": (30.9010, 75.8573),
    "karnal": (29.6857, 76.9905),
    "davangere": (14.4644, 75.9218),
    "indore": (22.7196, 75.8577),
    "rajkot": (22.3039, 70.8022),
    "junagadh": (21.5222, 70.4579),
    "guntur": (16.3067, 80.4365),
    "patna": (25.5941, 85.1376),
    "ranchi": (23.3441, 85.3096),
    "gorakhpur": (26.7606, 83.3732),
}

# well-known market → city centroid override so the demo seeds line up
MARKET_HINT: Dict[str, str] = {
    "azadpur mandi": "delhi",
    "lasalgaon apmc": "nashik",
    "agra mandi": "agra",
    "khanna mandi": "ludhiana",
    "karnal mandi": "karnal",
    "davangere apmc": "davangere",
    "indore mandi": "indore",
    "rajkot apmc": "rajkot",
    "junagadh apmc": "junagadh",
    "guntur apmc": "guntur",
}


# --- unit conversion ------------------------------------------------------

UNIT_TO_KG = {"kg": 1.0, "quintal": 100.0, "ton": 1000.0, "bag": 50.0, "crate": 15.0}


def to_kg(quantity: float, unit: str) -> float:
    factor = UNIT_TO_KG.get((unit or "").strip().lower())
    if factor is None:
        # Unknown unit — assume kg, log it, never crash.
        logger.warning("logistics: unknown unit %r, treating as kg", unit)
        return float(quantity)
    return float(quantity) * factor


# --- haversine -----------------------------------------------------------


def haversine_km(a: Tuple[float, float], b: Tuple[float, float]) -> float:
    """Great-circle distance in kilometres between (lat, lon) pairs."""
    lat1, lon1 = a
    lat2, lon2 = b
    r = 6371.0  # mean Earth radius, km
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    h = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlam / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(h)))


# --- coordinate resolution -----------------------------------------------


def _normalise(s: Optional[str]) -> str:
    return (s or "").strip().lower()


def _coord_for(query: Optional[str]) -> Tuple[float, float]:
    """Resolve a (lat, lon) for a free-text location string.

    Resolution order: market hint → district → state → fallback (Delhi).
    """
    q = _normalise(query)
    if not q:
        return CENTROIDS["delhi"]

    # Market hint
    for key, hint in MARKET_HINT.items():
        if key in q:
            return CENTROIDS.get(hint, CENTROIDS["delhi"])

    # District / state direct match
    for key, coord in CENTROIDS.items():
        if key in q:
            return coord

    # Last token as state guess
    tokens = [t.strip() for t in q.replace(",", " ").split() if t.strip()]
    if tokens:
        last = tokens[-1]
        if last in CENTROIDS:
            return CENTROIDS[last]

    return CENTROIDS["delhi"]


# --- optional live routing ----------------------------------------------


def _live_distance_km(
    origin: Tuple[float, float], dest: Tuple[float, float]
) -> Optional[float]:
    """Attempt a live road-network distance. Returns None on any failure.

    Uses the configured ``ROUTING_URL`` (OSRM-style by default) and is
    only attempted when an API key is configured (to avoid hitting
    public demo servers by accident). Any error is logged at INFO and
    swallowed — the caller falls back to haversine.
    """
    if not (settings.maps_api_key or settings.routing_api_key):
        return None
    try:
        coords = f"{origin[1]},{origin[0]};{dest[1]},{dest[0]}"
        url = f"{settings.routing_url}{coords}?overview=false"
        req = urllib.request.Request(url, headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=settings.market_price_timeout_seconds) as resp:
            data: Dict[str, Any] = json.loads(resp.read().decode("utf-8"))
        routes = data.get("routes") or []
        if not routes:
            return None
        meters = float(routes[0].get("distance") or 0.0)
        if meters <= 0:
            return None
        return meters / 1000.0
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError, ValueError) as exc:
        logger.info("logistics: live routing failed, using haversine estimate: %s", exc)
        return None


# --- price resolution ----------------------------------------------------


# How many kilograms one unit of price represents. Both the live data.gov.in
# feed and our demo provider use INR/quintal, so this is the common case.
UNIT_FACTOR_FOR_PRICE: Dict[str, float] = {
    "kg": 1.0,
    "quintal": 100.0,
    "ton": 1000.0,
}


def _price_per_kg(modal_price: float, unit: str) -> float:
    """Convert a price reported in some unit to per-kg INR.

    The ``unit`` may be a free string like ``"INR/quintal"`` or just
    ``"quintal"``. We pull the last token after the slash and lower-case
    it. Unknown units fall back to per-kg with a warning — never crash.
    """
    raw = (unit or "").strip().lower()
    token = raw.split("/")[-1].strip() if raw else ""
    factor = UNIT_FACTOR_FOR_PRICE.get(token)
    if factor is None:
        logger.warning("logistics: unknown price unit %r, treating as INR/kg", unit)
        return float(modal_price)
    return float(modal_price) / factor


def _modal_price_per_kg(crop_name: str) -> Tuple[float, str, bool, str]:
    """Return (price_per_kg, source, is_live, source_unit) for a crop.

    Uses the existing MarketPriceService so the price source stays
    consistent with the rest of the app (live when AGMARKNET is
    configured, demo otherwise).
    """
    try:
        from app.schemas.market_price import MarketPriceQuery
        from app.services import get_market_price_service

        service = get_market_price_service()
        response = service.list_prices(MarketPriceQuery(crop=crop_name))
        if response.results:
            # Pick the highest modal_price; ties broken by most recent date.
            best = max(response.results, key=lambda r: (r.modal_price, r.price_date))
            per_kg = _price_per_kg(best.modal_price, best.unit)
            return per_kg, response.source, bool(response.is_live), best.unit
        # No results → fall through to the seed default below.
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("logistics: market-price lookup failed: %s", exc)

    # Safe fallback so a logistics call still works in isolation.
    return 10.0, "fallback", False, "INR/kg"


# --- public API ----------------------------------------------------------


def estimate_for_lot(req: LogisticsEstimateRequest) -> LogisticsEstimateRead:
    """Compute the logistics estimate for a Crop Lot + destination market.

    This is the only function the API router needs to call.
    """
    from app.db.session import SessionLocal
    from app.models.crop_lot import CropLot
    from app.models.logistics_estimate import LogisticsEstimate

    db = SessionLocal()
    try:
        lot = db.get(CropLot, req.crop_lot_id)
        if lot is None:
            raise LookupError(f"Crop lot {req.crop_lot_id} not found")

        qty_kg = to_kg(lot.quantity, lot.quantity_unit)
        modal_price_per_kg, price_source, is_live, source_unit = _modal_price_per_kg(lot.crop_name)
        # If the farmer set a minimum acceptable price below the market,
        # we use the lower of the two (so the net isn't an over-promise).
        if lot.minimum_acceptable_price is not None:
            unit = (lot.quantity_unit or "").strip().lower()
            if unit in UNIT_TO_KG:
                floor_per_kg = float(lot.minimum_acceptable_price) / UNIT_TO_KG[unit]
            else:
                floor_per_kg = float(lot.minimum_acceptable_price)
            modal_price_per_kg = min(modal_price_per_kg, floor_per_kg)

        modal_price = modal_price_per_kg
        gross_value = modal_price_per_kg * qty_kg

        origin = _coord_for(lot.location)
        dest = _coord_for(req.destination_market or req.destination_label)
        distance = _live_distance_km(origin, dest) or haversine_km(origin, dest)

        rate = float(settings.logistics_transport_rate_per_km_per_kg)
        min_transport = float(settings.logistics_min_transport)
        loading_per_kg = float(settings.logistics_loading_per_kg)
        unloading_per_kg = float(settings.logistics_unloading_per_kg)
        other_pct = float(settings.logistics_other_charges_pct)

        transport = max(min_transport, rate * distance * qty_kg)
        loading = loading_per_kg * qty_kg
        unloading = unloading_per_kg * qty_kg
        other = other_pct * gross_value
        total = transport + loading + unloading + other
        net = gross_value - total

        vehicle = (req.vehicle_type or settings.logistics_default_vehicle).strip() or "mini-truck"

        row = LogisticsEstimate(
            crop_lot_id=lot.id,
            destination_label=req.destination_label.strip(),
            destination_market=req.destination_market.strip(),
            vehicle_type=vehicle,
            distance_km=float(distance),
            transport_cost=float(transport),
            loading_cost=float(loading),
            unloading_cost=float(unloading),
            other_charges=float(other),
            total_logistics_cost=float(total),
            gross_value=float(gross_value),
            net_realisation=float(net),
            modal_price_per_kg=float(modal_price),
            price_source=price_source,
            is_live_price=is_live,
            is_estimate=True,
        )
        db.add(row)
        db.commit()
        db.refresh(row)

        breakdown = LogisticsEstimateBreakdown(
            quantity=lot.quantity,
            quantity_unit=lot.quantity_unit,
            quantity_kg=float(qty_kg),
            modal_price_per_kg=float(modal_price),
            modal_price_source_unit=source_unit,
            price_source=price_source,
            is_live_price=is_live,
            distance_km=float(distance),
            transport_rate_per_km_per_kg=rate,
            loading_per_kg=loading_per_kg,
            unloading_per_kg=unloading_per_kg,
            other_charges_pct=other_pct,
            min_transport=min_transport,
            vehicle_type=vehicle,
        )
        return LogisticsEstimateRead(
            id=row.id,
            crop_lot_id=row.crop_lot_id,
            destination_label=row.destination_label,
            destination_market=row.destination_market,
            vehicle_type=row.vehicle_type,
            distance_km=row.distance_km,
            transport_cost=row.transport_cost,
            loading_cost=row.loading_cost,
            unloading_cost=row.unloading_cost,
            other_charges=row.other_charges,
            total_logistics_cost=row.total_logistics_cost,
            gross_value=row.gross_value,
            net_realisation=row.net_realisation,
            modal_price_per_kg=row.modal_price_per_kg,
            price_source=row.price_source,
            is_live_price=row.is_live_price,
            is_estimate=True,
            breakdown=breakdown,
            created_at=row.created_at,
        )
    finally:
        db.close()


def list_for_lot(crop_lot_id: int) -> List[LogisticsEstimateRead]:
    from app.db.session import SessionLocal
    from app.models.logistics_estimate import LogisticsEstimate

    db = SessionLocal()
    try:
        rows = (
            db.query(LogisticsEstimate)
            .filter(LogisticsEstimate.crop_lot_id == crop_lot_id)
            .order_by(LogisticsEstimate.created_at.desc())
            .all()
        )
        out: List[LogisticsEstimateRead] = []
        for r in rows:
            breakdown = LogisticsEstimateBreakdown(
                quantity=0.0,
                quantity_unit="",
                quantity_kg=0.0,
                modal_price_per_kg=r.modal_price_per_kg,
                modal_price_source_unit="INR/kg",
                price_source=r.price_source,
                is_live_price=r.is_live_price,
                distance_km=r.distance_km,
                transport_rate_per_km_per_kg=settings.logistics_transport_rate_per_km_per_kg,
                loading_per_kg=settings.logistics_loading_per_kg,
                unloading_per_kg=settings.logistics_unloading_per_kg,
                other_charges_pct=settings.logistics_other_charges_pct,
                min_transport=settings.logistics_min_transport,
                vehicle_type=r.vehicle_type,
            )
            out.append(
                LogisticsEstimateRead(
                    id=r.id,
                    crop_lot_id=r.crop_lot_id,
                    destination_label=r.destination_label,
                    destination_market=r.destination_market,
                    vehicle_type=r.vehicle_type,
                    distance_km=r.distance_km,
                    transport_cost=r.transport_cost,
                    loading_cost=r.loading_cost,
                    unloading_cost=r.unloading_cost,
                    other_charges=r.other_charges,
                    total_logistics_cost=r.total_logistics_cost,
                    gross_value=r.gross_value,
                    net_realisation=r.net_realisation,
                    modal_price_per_kg=r.modal_price_per_kg,
                    price_source=r.price_source,
                    is_live_price=r.is_live_price,
                    is_estimate=True,
                    breakdown=breakdown,
                    created_at=r.created_at,
                )
            )
        return out
    finally:
        db.close()


def config_view() -> LogisticsConfigResponse:
    return LogisticsConfigResponse(
        is_estimate=True,
        transport_rate_per_km_per_kg=float(settings.logistics_transport_rate_per_km_per_kg),
        min_transport=float(settings.logistics_min_transport),
        loading_per_kg=float(settings.logistics_loading_per_kg),
        unloading_per_kg=float(settings.logistics_unloading_per_kg),
        other_charges_pct=float(settings.logistics_other_charges_pct),
        avg_speed_kmph=float(settings.logistics_avg_speed_kmph),
        default_vehicle=str(settings.logistics_default_vehicle),
        maps_api_configured=bool(settings.maps_api_key),
        routing_api_configured=bool(settings.routing_api_key),
        notes=(
            "All values are estimates. Distance is haversine from rough "
            "district/state centroids unless a live routing API key is "
            "configured (then it is used with a haversine fallback on any "
            "failure)."
        ),
    )
