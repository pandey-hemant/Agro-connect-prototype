"""Decision Support service.

Rules-based, never AI. The farmer gets one of three recommendations:

* ``SELL_NOW`` — one market clearly dominates the others on net
  realisation, OR only one market is reachable.
* ``WAIT`` — current data does not favour waiting. This is a *negative*
  statement: we are NOT predicting future prices. We are saying "based on
  the markets we can see right now, there is no clear winner, so
  waiting is not justified by the data."
* ``GROUP_SALE`` — the farmer is a member of an FPO whose aggregate
  quantity unlocks a buyer that the lot alone could not satisfy.

If the crop has fewer than 3 distinct markets with prices in the last 7
days, the decision sets ``insufficient_data: true`` and explains the gap.
"""
from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import List, Optional, Tuple

from app.models.crop_lot import CropLot
from app.models.farmer_decision import FarmerDecision, FarmerDecisionType
from app.schemas.decision import FarmerDecisionRead, MarketComparisonRow
from app.schemas.logistics import LogisticsEstimateRequest
from app.services.logistics import estimate_for_lot

logger = logging.getLogger(__name__)


# A new market must beat the best by at least this fraction to be the
# "clear winner". Below this, prices are considered stable and we say
# "no clear gain from waiting". Not a price prediction; just a threshold
# for "are the differences we see big enough to act on?".
_STABLE_SPREAD_FRACTION = 0.05  # 5%


def _distinct_markets_with_prices(crop_name: str, lookback_days: int = 7) -> List[dict]:
    """Return distinct (market, state, district) markets with prices for the crop.

    Filters to the last ``lookback_days``. The "best" modal price per
    market is what's returned — we use that for the comparison.
    """
    from app.schemas.market_price import MarketPriceQuery
    from app.services import get_market_price_service

    service = get_market_price_service()
    response = service.list_prices(MarketPriceQuery(crop=crop_name))
    cutoff = date.today() - timedelta(days=lookback_days)

    # (market, state) -> best modal_price
    best_per_market: dict[Tuple[str, Optional[str]], dict] = {}
    for r in response.results:
        if r.price_date < cutoff:
            continue
        key = (r.market, r.state)
        existing = best_per_market.get(key)
        if existing is None or r.modal_price > existing["modal_price"]:
            best_per_market[key] = {
                "market": r.market,
                "location": r.location,
                "state": r.state,
                "district": r.district,
                "modal_price": r.modal_price,
                "unit": r.unit,
                "price_date": r.price_date,
                "is_live": r.is_live,
                "source": r.source,
            }
    return list(best_per_market.values())


def _build_comparison(lot: CropLot, markets: List[dict]) -> List[MarketComparisonRow]:
    """For each market, compute a fresh logistics estimate from the lot."""
    rows: List[MarketComparisonRow] = []
    for m in markets:
        try:
            est = estimate_for_lot(
                LogisticsEstimateRequest(
                    crop_lot_id=lot.id,
                    destination_label=f"{m['market']} ({m.get('location') or ''})".strip(),
                    destination_market=m["market"],
                )
            )
        except Exception as exc:  # pragma: no cover - defensive
            logger.warning("decision: estimate failed for %s: %s", m["market"], exc)
            continue
        rows.append(
            MarketComparisonRow(
                market=m["market"],
                location=m.get("location"),
                state=m.get("state"),
                modal_price=est.modal_price_per_kg,
                modal_price_source_unit=est.breakdown.modal_price_source_unit,
                distance_km=est.distance_km,
                transport_cost=est.transport_cost,
                loading_cost=est.loading_cost,
                unloading_cost=est.unloading_cost,
                other_charges=est.other_charges,
                total_logistics_cost=est.total_logistics_cost,
                gross_value=est.gross_value,
                net_realisation=est.net_realisation,
                is_estimate=True,
            )
        )
    return rows


def _fpo_unlocks_buyer(lot: CropLot) -> Optional[dict]:
    """If the lot is in an FPO whose aggregate quantity unlocks a buyer
    that the lot alone could not satisfy, return a small descriptor.

    Returns ``None`` when no FPO or no such buyer exists. Buyer/FPO
    tables are created by later modules (C, F); if they don't exist
    yet, this returns ``None`` cleanly.
    """
    try:
        from app.db.session import SessionLocal
        from app.models.buyer_requirement import BuyerRequirement
        from app.models.fpo import FPO
        from app.models.fpo_membership import FPOMembership
        from app.models.crop_lot import CropLot as _CL
    except ImportError:
        return None

    db = SessionLocal()
    try:
        memberships = (
            db.query(FPOMembership).filter(FPOMembership.crop_lot_id == lot.id).all()
        )
        if not memberships:
            return None

        for m in memberships:
            fpo = db.get(FPO, m.fpo_id)
            if fpo is None:
                continue
            member_lot_ids = [
                r.crop_lot_id
                for r in db.query(FPOMembership).filter(FPOMembership.fpo_id == fpo.id).all()
            ]
            member_lots = (
                db.query(_CL).filter(_CL.id.in_(member_lot_ids)).all()
                if member_lot_ids else []
            )
            from app.services.logistics import to_kg
            agg_kg = sum(
                to_kg(ml.quantity, ml.quantity_unit)
                for ml in member_lots
                if ml.crop_name.lower() == lot.crop_name.lower()
            )
            if agg_kg <= 0:
                continue

            reqs = (
                db.query(BuyerRequirement)
                .filter(BuyerRequirement.crop_name.ilike(lot.crop_name))
                .all()
            )
            lot_kg = to_kg(lot.quantity, lot.quantity_unit)
            for req in reqs:
                from app.services.logistics import to_kg as _to_kg
                buyer_min_kg = _to_kg(req.min_quantity, req.quantity_unit)
                if agg_kg >= buyer_min_kg > lot_kg:
                    from app.models.buyer import Buyer
                    buyer = db.get(Buyer, req.buyer_id)
                    if buyer is None:
                        continue
                    return {
                        "fpo_id": fpo.id,
                        "fpo_name": fpo.name,
                        "aggregate_kg": agg_kg,
                        "buyer_id": buyer.id,
                        "buyer_name": buyer.name,
                        "buyer_min_quantity": req.min_quantity,
                        "buyer_quantity_unit": req.quantity_unit,
                    }
        return None
    finally:
        db.close()


def _decide(rows: List[MarketComparisonRow], lot: CropLot) -> Tuple[FarmerDecisionType, str, bool]:
    """Apply the rules and return (recommendation, reason, insufficient_data)."""
    if not rows:
        return (
            FarmerDecisionType.SELL_NOW,
            "No market prices found for this crop. Add market-price data before "
            "requesting a decision.",
            True,
        )

    if len(rows) == 1:
        only = rows[0]
        return (
            FarmerDecisionType.SELL_NOW,
            f"Only one market ({only.market}) currently lists prices for this crop. "
            f"Best estimate: net realisation INR {only.net_realisation:,.0f}.",
            False,
        )

    # Sort by net realisation, best first.
    rows_sorted = sorted(rows, key=lambda r: r.net_realisation, reverse=True)
    best, second = rows_sorted[0], rows_sorted[1]
    if best.net_realisation <= 0:
        return (
            FarmerDecisionType.WAIT,
            "Net realisation at the best market is non-positive after logistics. "
            "Do not sell under these terms; review quantity, transport, or destination.",
            True,
        )

    # Check FPO first — it can override a single-market "SELL_NOW" when
    # the group sale unlocks a buyer the lot alone can't reach.
    fpo_hit = _fpo_unlocks_buyer(lot)
    if fpo_hit is not None:
        return (
            FarmerDecisionType.GROUP_SALE,
            f"Your FPO '{fpo_hit['fpo_name']}' aggregates "
            f"{fpo_hit['aggregate_kg']:.0f} kg of {lot.crop_name}, which meets "
            f"buyer '{fpo_hit['buyer_name']}' minimum of "
            f"{fpo_hit['buyer_min_quantity']} {fpo_hit['buyer_quantity_unit']} — "
            f"something your lot alone ({_lot_kg_text(lot)}) cannot do.",
            False,
        )

    # Spread: how much better is the best vs the second?
    if second.net_realisation > 0:
        spread = (best.net_realisation - second.net_realisation) / second.net_realisation
    else:
        spread = 1.0  # second is non-positive; best clearly wins
    if spread >= _STABLE_SPREAD_FRACTION:
        return (
            FarmerDecisionType.SELL_NOW,
            f"{best.market} offers the best net realisation "
            f"(INR {best.net_realisation:,.0f}, {spread*100:.1f}% above the next-best "
            f"{second.market} at INR {second.net_realisation:,.0f}).",
            False,
        )
    return (
        FarmerDecisionType.WAIT,
        f"Prices are stable — best net is {best.market} at INR "
        f"{best.net_realisation:,.0f}, only "
        f"{spread*100:.1f}% above the next market. Waiting yields no clear gain "
        f"from the data we have. (Not a future-price prediction.)",
        False,
    )


def _lot_kg_text(lot: CropLot) -> str:
    from app.services.logistics import to_kg
    return f"{to_kg(lot.quantity, lot.quantity_unit):.0f} kg"


def compute_decision(crop_lot_id: int) -> FarmerDecisionRead:
    """Compute the decision (always) and persist it. Returns the read view."""
    from app.db.session import SessionLocal

    db = SessionLocal()
    try:
        lot = db.get(CropLot, crop_lot_id)
        if lot is None:
            raise LookupError(f"Crop lot {crop_lot_id} not found")

        markets = _distinct_markets_with_prices(lot.crop_name)
        if len(markets) < 3:
            logger.info(
                "decision: only %d markets for crop=%s — marking insufficient",
                len(markets), lot.crop_name,
            )
        rows = _build_comparison(lot, markets)
        rec, reason, insufficient = _decide(rows, lot)
        if len(markets) < 3 and not insufficient:
            reason = (
                f"Only {len(markets)} market(s) have prices for {lot.crop_name} in the "
                f"last 7 days. " + reason
            )
            insufficient = True

        existing = (
            db.query(FarmerDecision)
            .filter(FarmerDecision.crop_lot_id == crop_lot_id)
            .one_or_none()
        )
        comparison_payload = [r.model_dump() for r in rows]
        if existing is None:
            row = FarmerDecision(
                crop_lot_id=crop_lot_id,
                recommendation=rec.value,
                reason=reason,
                insufficient_data=insufficient,
                is_estimate=True,
                comparison_json=comparison_payload,
            )
            db.add(row)
        else:
            existing.recommendation = rec.value
            existing.reason = reason
            existing.insufficient_data = insufficient
            existing.is_estimate = True
            existing.comparison_json = comparison_payload
            row = existing
        db.commit()
        db.refresh(row)

        return FarmerDecisionRead(
            id=row.id,
            crop_lot_id=row.crop_lot_id,
            recommendation=row.recommendation,
            reason=row.reason,
            insufficient_data=row.insufficient_data,
            is_estimate=True,
            comparison=[MarketComparisonRow(**r) for r in (row.comparison_json or [])],
            created_at=row.created_at,
            updated_at=row.updated_at,
        )
    finally:
        db.close()


def get_decision(crop_lot_id: int) -> FarmerDecisionRead:
    """Return the stored decision, computing it lazily if missing."""
    from app.db.session import SessionLocal

    db = SessionLocal()
    try:
        row = (
            db.query(FarmerDecision)
            .filter(FarmerDecision.crop_lot_id == crop_lot_id)
            .one_or_none()
        )
    finally:
        db.close()
    if row is None:
        return compute_decision(crop_lot_id)
    return FarmerDecisionRead(
        id=row.id,
        crop_lot_id=row.crop_lot_id,
        recommendation=row.recommendation,
        reason=row.reason,
        insufficient_data=row.insufficient_data,
        is_estimate=True,
        comparison=[MarketComparisonRow(**r) for r in (row.comparison_json or [])],
        created_at=row.created_at,
        updated_at=row.updated_at,
    )
