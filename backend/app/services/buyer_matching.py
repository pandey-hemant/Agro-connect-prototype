"""Buyer-matching engine.

Given a Crop Lot, score each Buyer 0-100 against the lot and return the
results sorted by score (descending). The score is a transparent sum of
small rule-based increments; the response includes the contributing
reasons so the UI can render them and the farmer can see *why* a buyer
was matched.

Scoring rules (per the plan):

    Same crop (case-insensitive)              +40
    Variety match (when buyer specifies one)  +15
    Lot qty within buyer's [min, max]         +20
    Location substring match                  +10
    Quality grade match (both present)        +10
    Price expectations within range          +5
    Buyer is VERIFIED                         +5

Maximum possible score: 105. The score is *capped* at 100 in the
response for readability; the raw breakdown is preserved in ``reasons``.

The matcher is **not** an AI. Every score component is a deterministic
rule. The ``match_explanation`` field is a short human-readable string
built from the same rules; it never says "AI", "smart", or "predicted".
"""
from __future__ import annotations

import logging
import re
from typing import List, Optional

from app.db.session import SessionLocal
from app.models.buyer import Buyer, BuyerVerification
from app.models.buyer_requirement import BuyerRequirement
from app.models.crop_lot import CropLot
from app.schemas.buyer import BuyerRead

logger = logging.getLogger(__name__)


# ---- helpers --------------------------------------------------------------

def _to_kg(quantity: float, unit: str) -> float:
    """Convert a quantity to kilograms. Mirrors the logistics converter."""
    factors = {"kg": 1.0, "quintal": 100.0, "ton": 1000.0}
    token = (unit or "").strip().lower()
    return float(quantity) * factors.get(token, 1.0)


def _to_inr_per_kg(price: float, price_unit: str) -> float:
    """Convert a price to INR/kg. Mirrors the logistics converter."""
    factors = {"kg": 1.0, "quintal": 100.0, "ton": 1000.0}
    raw = (price_unit or "").strip().lower()
    token = raw.split("/")[-1].strip() if raw else ""
    factor = factors.get(token)
    if factor is None:
        return float(price)
    return float(price) / factor


def _location_score(lot: CropLot, buyer: Buyer) -> int:
    """+10 when any of (location, district, state) shares a 3+ char token."""
    lot_text = " ".join([lot.location or "", getattr(lot, "district", "") or "",
                         getattr(lot, "state", "") or ""]).lower()
    buyer_text = " ".join([buyer.location or "", buyer.district or "",
                           buyer.state or ""]).lower()
    # Use 3+ char alpha tokens
    lot_tokens = {t for t in re.findall(r"[a-z]{3,}", lot_text)}
    buyer_tokens = {t for t in re.findall(r"[a-z]{3,}", buyer_text)}
    return 10 if (lot_tokens & buyer_tokens) else 0


def _quality_grade_for_lot(lot_id: int) -> Optional[str]:
    """Return the buyer's grade expectation string for a lot, if available.

    Module G will populate this from ``QualityAssessment``; until then we
    return ``None`` and the matcher simply skips the grade rule.
    """
    try:
        from app.models.quality_assessment import QualityAssessment  # noqa: WPS433
    except ImportError:
        return None
    try:
        db = SessionLocal()
        try:
            qa = db.get(QualityAssessment, lot_id)
            return qa.declared_grade if qa else None
        finally:
            db.close()
    except Exception:  # pragma: no cover - defensive
        logger.exception("matching: could not read quality assessment for lot %s", lot_id)
        return None


# ---- public API -----------------------------------------------------------

def match_buyers_for_lot(
    lot_id: int,
    *,
    limit: int = 10,
) -> List[dict]:
    """Return scored buyer matches for ``lot_id``.

    The result is a list of dicts with: ``buyer`` (BuyerRead),
    ``score`` (int 0-100), ``reasons`` (list[str]) and
    ``match_explanation`` (str).

    Buyers with no matching requirement (crop mismatch) get a score of
    zero and a single reason explaining why they are not a fit.
    """
    db = SessionLocal()
    try:
        lot = db.get(CropLot, lot_id)
        if lot is None:
            raise LookupError(f"Crop lot {lot_id} not found")

        # Load all buyers with their requirements in one round-trip
        buyers: List[Buyer] = (
            db.query(Buyer).options().all()
        )

        lot_qty_kg = _to_kg(lot.quantity, lot.quantity_unit)
        lot_grade = _quality_grade_for_lot(lot.id)
        lot_crop_norm = (lot.crop_name or "").strip().lower()
        lot_variety_norm = (lot.crop_variety or "").strip().lower()

        results: List[dict] = []
        for buyer in buyers:
            score = 0
            reasons: List[str] = []

            # Find the *best* matching requirement row for this buyer.
            # A buyer can list multiple requirements; we score the best.
            best_req: Optional[BuyerRequirement] = None
            best_req_score = 0
            for req in buyer.requirements:
                req_crop_norm = (req.crop_name or "").strip().lower()
                if req_crop_norm and req_crop_norm == lot_crop_norm:
                    # this req matches the crop; use it
                    if best_req is None:
                        best_req = req
                        best_req_score = 1
                    # prefer req that also matches variety
                    req_variety_norm = (req.variety or "").strip().lower()
                    if req_variety_norm and req_variety_norm == lot_variety_norm:
                        best_req = req

            if best_req is None:
                results.append({
                    "buyer": buyer,
                    "score": 0,
                    "reasons": [
                        f"Does not currently list a demand for {lot.crop_name}.",
                    ],
                    "match_explanation": "No matching crop demand.",
                })
                continue

            # Crop match (required to be in best_req by construction)
            score += 40
            reasons.append(f"Demands {lot.crop_name}.")

            # Variety match
            req_variety = (best_req.variety or "").strip().lower()
            if req_variety and req_variety == lot_variety_norm:
                score += 15
                reasons.append(f"Variety '{lot.crop_variety}' matches.")

            # Quantity match
            req_min_kg = _to_kg(best_req.min_quantity, best_req.quantity_unit)
            req_max_kg = _to_kg(best_req.max_quantity, best_req.quantity_unit)
            if req_min_kg <= lot_qty_kg <= req_max_kg:
                score += 20
                reasons.append(
                    f"Lot quantity {lot_qty_kg:g}kg within buyer's "
                    f"[{req_min_kg:g}, {req_max_kg:g}] kg range."
                )
            else:
                reasons.append(
                    f"Lot quantity {lot_qty_kg:g}kg outside buyer's "
                    f"[{req_min_kg:g}, {req_max_kg:g}] kg range."
                )

            # Location match
            loc_pts = _location_score(lot, buyer)
            if loc_pts:
                score += loc_pts
                reasons.append("Lot location overlaps with buyer's region.")

            # Quality grade match
            req_grade = (best_req.preferred_quality_grade or "").strip().upper()
            if lot_grade and req_grade and lot_grade.upper() == req_grade:
                score += 10
                reasons.append(f"Quality grade '{lot_grade}' matches buyer's preference.")
            # If no quality assessment yet, we don't award (or penalise) the
            # grade rule — Module G will fill it in.

            # Price expectations — only if farmer gave minimum_acceptable_price
            if lot.minimum_acceptable_price is not None:
                farmer_per_kg = _to_inr_per_kg(
                    float(lot.minimum_acceptable_price), lot.price_currency + "/kg"
                )
                # Buyer price range is in its own price_unit; convert to /kg
                try:
                    min_p_per_kg = _to_inr_per_kg(float(best_req.min_price), best_req.price_unit)
                    max_p_per_kg = _to_inr_per_kg(float(best_req.max_price), best_req.price_unit)
                except (TypeError, ValueError):
                    min_p_per_kg = max_p_per_kg = None

                if (min_p_per_kg is not None and max_p_per_kg is not None
                        and min_p_per_kg <= farmer_per_kg <= max_p_per_kg):
                    score += 5
                    reasons.append("Farmer's expected price fits buyer's range.")
                else:
                    reasons.append(
                        f"Farmer's expected {farmer_per_kg:.2f}/kg is outside "
                        f"buyer's [{min_p_per_kg}, {max_p_per_kg}]/kg range."
                        if min_p_per_kg is not None
                        else "Buyer's price range could not be compared."
                    )

            # Verification bonus
            if buyer.verification_status == BuyerVerification.VERIFIED.value:
                score += 5
                reasons.append("Buyer is verified.")

            score_capped = min(score, 100)
            explanation = _build_explanation(score_capped, reasons)
            results.append({
                "buyer": buyer,
                "score": score_capped,
                "reasons": reasons,
                "match_explanation": explanation,
            })

        # Sort by score desc, then by buyer name for stable output
        results.sort(key=lambda r: (-r["score"], _buyer_name(r["buyer"])))
        return results[: max(1, limit)]
    finally:
        db.close()


def _buyer_name(buyer: Buyer) -> str:
    return (buyer.name or "").lower()


def _build_explanation(score: int, reasons: List[str]) -> str:
    """Build a short, human-readable explanation from the rule reasons.

    Never uses the words "AI", "smart", or "predicted".
    """
    if score <= 0:
        return "Not a match: " + (reasons[0] if reasons else "no demand for this crop.")
    top = [r for r in reasons if not r.startswith("Lot quantity") and
           not r.startswith("Farmer's expected")]
    summary = "; ".join(top[:3]) if top else "Matched on key attributes."
    return f"Match score {score}/100. {summary}"


def serialise_match(match: dict) -> dict:
    """Convert a match dict to a wire-safe payload."""
    buyer: Buyer = match["buyer"]
    return {
        "buyer": BuyerRead(
            id=buyer.id,
            public_id=buyer.public_id,
            name=buyer.name,
            location=buyer.location,
            district=buyer.district,
            state=buyer.state,
            contact_method=buyer.contact_method,
            verification_status=buyer.verification_status,
            is_demo=bool(buyer.is_demo),
            requirements=[
                {
                    "crop_name": r.crop_name,
                    "variety": r.variety or "",
                    "min_quantity": float(r.min_quantity),
                    "max_quantity": float(r.max_quantity),
                    "quantity_unit": r.quantity_unit,
                    "min_price": float(r.min_price),
                    "max_price": float(r.max_price),
                    "price_currency": r.price_currency,
                    "price_unit": r.price_unit,
                    "preferred_quality_grade": r.preferred_quality_grade or "",
                }
                for r in (buyer.requirements or [])
            ],
            created_at=buyer.created_at,
        ),
        "score": int(match["score"]),
        "reasons": list(match["reasons"]),
        "match_explanation": match["match_explanation"],
    }
