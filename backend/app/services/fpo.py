"""FPO / Group Selling service.

FPOs are groups of farmers (represented by their Crop Lots) that want
to aggregate quantity to meet buyer ``min_quantity`` thresholds that
a single lot cannot.

Endpoints supported:
- create_fpo / list_fpos / get_fpo
- join_lot / leave_lot
- aggregate (per-crop totals + which buyers are now reachable)
- seed_demo_fpos (idempotent seeder for the prototype)
"""
from __future__ import annotations

import logging
import uuid
from typing import List, Optional

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.db.session import SessionLocal
from app.models import (
    Buyer,
    BuyerRequirement,
    CropLot,
    FPO,
    FPOMembership,
)

logger = logging.getLogger(__name__)


# ---- helpers --------------------------------------------------------------

def _generate_public_id(db: Session, column) -> str:
    for _ in range(5):
        cand = uuid.uuid4().hex[:16]
        exists = db.execute(select(column).filter_by(public_id=cand)).first()
        if not exists:
            return cand
    return uuid.uuid4().hex  # 32 chars; collision essentially impossible


def _to_membership_read(m: FPOMembership) -> dict:
    lot = m.crop_lot
    return {
        "crop_lot_id": int(m.crop_lot_id),
        "public_id": lot.public_id if lot else "",
        "crop_name": lot.crop_name if lot else "",
        "crop_variety": lot.crop_variety if lot else "",
        "quantity": float(lot.quantity) if lot else 0.0,
        "quantity_unit": lot.quantity_unit if lot else "",
        "location": lot.location if lot else "",
        "harvest_date": lot.harvest_date.isoformat() if (lot and lot.harvest_date) else None,
        "joined_at": m.joined_at,
    }


def _to_fpo_read(fpo: FPO) -> dict:
    members = [_to_membership_read(m) for m in (fpo.memberships or [])]
    return {
        "id": fpo.id,
        "public_id": fpo.public_id,
        "name": fpo.name,
        "location": fpo.location,
        "district": fpo.district or "",
        "state": fpo.state or "",
        "is_demo": bool(fpo.is_demo),
        "created_at": fpo.created_at,
        "member_count": len(members),
        "members": members,
    }


# ---- public API -----------------------------------------------------------

class FPOError(Exception):
    """Raised for business-rule violations (returned as 400/404)."""


def create_fpo(
    *,
    name: str,
    location: str,
    district: str = "",
    state: str = "",
    is_demo: bool = False,
) -> FPO:
    name = (name or "").strip()
    location = (location or "").strip()
    if not name or not location:
        raise FPOError("name and location are required")

    db: Session = SessionLocal()
    try:
        fpo = FPO(
            public_id=_generate_public_id(db, FPO),
            name=name,
            location=location,
            district=(district or "").strip(),
            state=(state or "").strip(),
            is_demo=is_demo,
        )
        db.add(fpo)
        db.commit()
        db.refresh(fpo)
        return fpo
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def list_fpos() -> List[FPO]:
    db: Session = SessionLocal()
    try:
        rows = (
            db.query(FPO)
            .options(selectinload(FPO.memberships).selectinload(FPOMembership.crop_lot))
            .order_by(FPO.created_at.desc())
            .all()
        )
        for r in rows:
            db.expunge(r)
        return rows
    finally:
        db.close()


def get_fpo(public_id: str) -> Optional[FPO]:
    db: Session = SessionLocal()
    try:
        row = (
            db.query(FPO)
            .options(selectinload(FPO.memberships).selectinload(FPOMembership.crop_lot))
            .filter(FPO.public_id == public_id)
            .one_or_none()
        )
        if row is not None:
            db.expunge(row)
        return row
    finally:
        db.close()


def join_lot(fpo_public_id: str, crop_lot_id: int) -> FPO:
    """Add a Crop Lot to an FPO. Idempotent — joining twice is a no-op."""
    db: Session = SessionLocal()
    try:
        fpo = (
            db.query(FPO)
            .options(selectinload(FPO.memberships).selectinload(FPOMembership.crop_lot))
            .filter(FPO.public_id == fpo_public_id)
            .one_or_none()
        )
        if fpo is None:
            raise FPOError(f"FPO {fpo_public_id} not found")

        lot = db.get(CropLot, crop_lot_id)
        if lot is None:
            raise FPOError(f"Crop lot {crop_lot_id} not found")

        # Idempotent: check uniqueness
        existing = (
            db.query(FPOMembership)
            .filter(
                FPOMembership.fpo_id == fpo.id,
                FPOMembership.crop_lot_id == lot.id,
            )
            .one_or_none()
        )
        if existing is not None:
            return fpo

        try:
            db.add(FPOMembership(fpo_id=fpo.id, crop_lot_id=lot.id))
            db.commit()
        except IntegrityError:
            db.rollback()  # raced with another join — treat as no-op
        db.refresh(fpo)
        # Re-fetch with relationships
        fpo = (
            db.query(FPO)
            .options(selectinload(FPO.memberships).selectinload(FPOMembership.crop_lot))
            .filter(FPO.id == fpo.id)
            .one()
        )
        return fpo
    except FPOError:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def leave_lot(fpo_public_id: str, crop_lot_id: int) -> FPO:
    """Remove a Crop Lot from an FPO. No-op if not a member."""
    db: Session = SessionLocal()
    try:
        fpo = (
            db.query(FPO)
            .options(selectinload(FPO.memberships).selectinload(FPOMembership.crop_lot))
            .filter(FPO.public_id == fpo_public_id)
            .one_or_none()
        )
        if fpo is None:
            raise FPOError(f"FPO {fpo_public_id} not found")

        existing = (
            db.query(FPOMembership)
            .filter(
                FPOMembership.fpo_id == fpo.id,
                FPOMembership.crop_lot_id == crop_lot_id,
            )
            .one_or_none()
        )
        if existing is not None:
            db.delete(existing)
            db.commit()
        db.refresh(fpo)
        fpo = (
            db.query(FPO)
            .options(selectinload(FPO.memberships).selectinload(FPOMembership.crop_lot))
            .filter(FPO.id == fpo.id)
            .one()
        )
        return fpo
    except FPOError:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


# ---- aggregation ----------------------------------------------------------

# Rough per-crop floor price (INR/kg) used only for an *estimate* of the
# aggregate's value when the user has not set a min price on the FPO.
# These are not predictions; they are explicit demo estimates clearly
# flagged as such in the response and UI.
_DEFAULT_CROP_FLOOR_INR_PER_KG: dict[str, float] = {
    "tomato": 15.0,
    "onion": 18.0,
    "potato": 12.0,
    "wheat": 22.0,
    "rice": 25.0,
    "maize": 18.0,
    "soybean": 38.0,
    "cotton": 55.0,
    "groundnut": 55.0,
}


def _floor_for(crop_name: str) -> float:
    return _DEFAULT_CROP_FLOOR_INR_PER_KG.get((crop_name or "").strip().lower(), 15.0)


def _normalise_unit(unit: str) -> str:
    u = (unit or "").strip().lower()
    if u in ("kg", "kilogram", "kilograms"):
        return "kg"
    if u in ("q", "qtl", "quintal", "quintals"):
        return "quintal"
    if u in ("t", "ton", "tonne", "tonnes", "mt"):
        return "ton"
    return u or "kg"


def _to_kg(qty: float, unit: str) -> float:
    u = _normalise_unit(unit)
    if u == "kg":
        return float(qty)
    if u == "quintal":
        return float(qty) * 100.0
    if u == "ton":
        return float(qty) * 1000.0
    return float(qty)


def _to_kg_floor(qty: float, unit: str, floor_inr_per_kg: float) -> float:
    return _to_kg(qty, unit) * floor_inr_per_kg


def aggregate(
    fpo_public_id: str,
    crop: Optional[str] = None,
) -> dict:
    """Compute aggregate quantity per crop + buyers now reachable.

    If ``crop`` is provided, only that crop is included. Otherwise we
    return a per-crop summary.

    A buyer is "reachable" when the FPO's aggregate quantity for the
    crop in the buyer's preferred unit meets the buyer's ``min_quantity``.
    """
    db: Session = SessionLocal()
    try:
        fpo = (
            db.query(FPO)
            .options(selectinload(FPO.memberships).selectinload(FPOMembership.crop_lot))
            .filter(FPO.public_id == fpo_public_id)
            .one_or_none()
        )
        if fpo is None:
            raise FPOError(f"FPO {fpo_public_id} not found")

        # Bucket by crop + unit
        by_crop: dict[tuple[str, str], dict] = {}
        for m in (fpo.memberships or []):
            lot = m.crop_lot
            if lot is None:
                continue
            lot_crop = (lot.crop_name or "").strip()
            if not lot_crop:
                continue
            if crop and lot_crop.lower() != crop.lower():
                continue
            key = (lot_crop.lower(), _normalise_unit(lot.quantity_unit))
            bucket = by_crop.setdefault(key, {
                "crop_name": lot_crop,
                "lots": [],
                "unit": key[1],
                "qty": 0.0,
            })
            bucket["lots"].append(lot)
            bucket["qty"] += float(lot.quantity)

        by_crop_rows: List[dict] = []
        for key, b in sorted(by_crop.items(), key=lambda x: x[1]["crop_name"].lower()):
            floor = _floor_for(b["crop_name"])
            est_value = _to_kg_floor(b["qty"], b["unit"], floor)
            by_crop_rows.append({
                "crop_name": b["crop_name"],
                "lot_count": len(b["lots"]),
                "total_quantity": float(b["qty"]),
                "quantity_unit": b["unit"],
                "estimated_value": round(est_value, 2),
                "currency": "INR",
                "member_public_ids": [lot.public_id for lot in b["lots"] if lot],
            })

        # Reachable buyers
        reachable: List[dict] = []
        # Per crop, per unit → quantity
        crop_to_unit_to_qty: dict[str, dict[str, float]] = {}
        for b in by_crop_rows:
            crop_to_unit_to_qty.setdefault(b["crop_name"].lower(), {})[b["quantity_unit"]] = (
                b["total_quantity"]
            )

        if crop_to_unit_to_qty:
            buyers = (
                db.query(Buyer)
                .options(selectinload(Buyer.requirements))
                .all()
            )
            for buyer in buyers:
                for req in (buyer.requirements or []):
                    if not req.crop_name:
                        continue
                    units = crop_to_unit_to_qty.get(req.crop_name.lower())
                    if not units:
                        continue
                    qty_in_buyer_unit = units.get(_normalise_unit(req.quantity_unit))
                    if qty_in_buyer_unit is None:
                        # fall back to converting the FPO's quantity into buyer's unit
                        # using one of the FPO units we have
                        for fpo_unit, fpo_qty in units.items():
                            qty_in_buyer_unit = _to_kg(fpo_qty, fpo_unit)
                            if _normalise_unit(req.quantity_unit) == "quintal":
                                qty_in_buyer_unit = qty_in_buyer_unit / 100.0
                            elif _normalise_unit(req.quantity_unit) == "ton":
                                qty_in_buyer_unit = qty_in_buyer_unit / 1000.0
                            break
                    if qty_in_buyer_unit is None:
                        continue
                    if float(req.min_quantity) <= float(qty_in_buyer_unit):
                        reachable.append({
                            "buyer_public_id": buyer.public_id,
                            "buyer_name": buyer.name,
                            "crop_name": req.crop_name,
                            "min_quantity": float(req.min_quantity),
                            "aggregate_quantity": float(qty_in_buyer_unit),
                            "quantity_unit": req.quantity_unit or "kg",
                        })

        return {
            "fpo_public_id": fpo.public_id,
            "fpo_name": fpo.name,
            "crop": crop,
            "by_crop": by_crop_rows,
            "reachable_buyers": reachable,
            "note": (
                "Aggregated quantity may unlock buyers whose min_quantity a "
                "single lot could not meet. Estimated value uses a clearly-"
                "labelled floor price, not a market prediction."
            ),
        }
    finally:
        db.close()


# ---- response shaping -----------------------------------------------------

def fpo_to_read(fpo: FPO) -> dict:
    return _to_fpo_read(fpo)


# ---- demo seeder ----------------------------------------------------------

_DEMO_FPOS: list[dict] = [
    {
        "name": "[DEMO] Patna Kisan Producer Co. Ltd",
        "location": "Patna, Bihar",
        "district": "Patna",
        "state": "Bihar",
    },
    {
        "name": "[DEMO] Lucknow Vegetable Growers FPO",
        "location": "Lucknow, Uttar Pradesh",
        "district": "Lucknow",
        "state": "Uttar Pradesh",
    },
]


def seed_demo_fpos() -> dict:
    """Idempotently seed 2 demo FPOs.

    Returns ``{inserted, skipped, total_after, public_ids}``.
    """
    db: Session = SessionLocal()
    try:
        existing_names = {row.name for row in db.query(FPO.name).all()}
        inserted = 0
        skipped = 0
        public_ids: list[str] = []
        for d in _DEMO_FPOS:
            if d["name"] in existing_names:
                skipped += 1
                continue
            fpo = FPO(
                public_id=_generate_public_id(db, FPO),
                name=d["name"],
                location=d["location"],
                district=d.get("district", ""),
                state=d.get("state", ""),
                is_demo=True,
            )
            db.add(fpo)
            db.flush()
            public_ids.append(fpo.public_id)
            inserted += 1
        db.commit()
        total_after = db.query(FPO).count()
        return {
            "inserted": inserted,
            "skipped": skipped,
            "total_after": int(total_after),
            "public_ids": public_ids,
        }
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
