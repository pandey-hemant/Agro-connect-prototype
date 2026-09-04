"""API router for the crop-lot workflow.

Endpoints (all mounted under ``/api`` by ``app.main``):
- ``POST   /crop-lots``  — create a new lot
- ``GET    /crop-lots``  — list lots (newest first)
- ``GET    /crop-lots/{public_id}`` — fetch a single lot

Errors are raised as ``HTTPException`` with a small, consistent shape so
the frontend can surface useful messages without needing to parse
arbitrary strings.
"""
from __future__ import annotations

import secrets
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.crop_lot import CropLot, CropLotStatus as ModelStatus
from app.schemas.crop_lot import (
    CropLotCreate,
    CropLotRead,
    CropLotStatus,
    CropLotSummary,
)

router = APIRouter()


def _generate_public_id(db: Session) -> str:
    """Generate a short, URL-safe, unique public ID.

    We retry on the (extremely rare) collision rather than building a
    bespoke retry loop in the caller. 12 chars ≈ 71 bits of entropy in
    a base-62-ish alphabet — plenty for a prototype.
    """
    for _ in range(5):
        candidate = "CL-" + secrets.token_urlsafe(9).replace("_", "").replace("-", "")[:12].upper()
        exists = db.execute(select(CropLot.id).where(CropLot.public_id == candidate)).first()
        if not exists:
            return candidate
    # Fallback: use timestamp + random bytes to guarantee uniqueness.
    import time
    return f"CL-{int(time.time() * 1000):X}{secrets.token_hex(2).upper()}"


@router.post(
    "/crop-lots",
    response_model=CropLotRead,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new crop lot",
)
def create_crop_lot(payload: CropLotCreate, db: Session = Depends(get_db)) -> CropLot:
    """Persist a new crop lot and return the canonical record."""
    lot = CropLot(
        public_id=_generate_public_id(db),
        crop_name=payload.crop_name,
        crop_variety=payload.crop_variety,
        quantity=payload.quantity,
        quantity_unit=payload.quantity_unit,
        harvest_date=payload.harvest_date,
        location=payload.location,
        preferred_selling_radius_km=payload.preferred_selling_radius_km,
        farmer_quality_notes=payload.farmer_quality_notes,
        minimum_acceptable_price=payload.minimum_acceptable_price,
        price_currency=payload.price_currency,
        status=ModelStatus.ACTIVE.value,
    )
    db.add(lot)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Could not create crop lot due to a data conflict. Please retry.",
        ) from exc
    except Exception as exc:  # pragma: no cover - defensive
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Unexpected error while creating crop lot.",
        ) from exc

    db.refresh(lot)
    return lot


@router.get(
    "/crop-lots",
    response_model=List[CropLotSummary],
    summary="List crop lots (newest first)",
)
def list_crop_lots(db: Session = Depends(get_db)) -> List[CropLot]:
    lots = db.execute(
        select(CropLot).order_by(CropLot.created_at.desc())
    ).scalars().all()
    return list(lots)


@router.get(
    "/crop-lots/available",
    response_model=List[CropLotSummary],
    summary="List ACTIVE crop lots for buyers (the marketplace).",
)
def list_available_crop_lots(
    crop: Optional[str] = None,
    state: Optional[str] = None,
    db: Session = Depends(get_db),
) -> List[CropLot]:
    """Return crop lots in ACTIVE status, newest first.

    Optional filters: ``crop`` (substring, case-insensitive) and
    ``state`` (substring, case-insensitive). Sold / cancelled lots are
    excluded. This is the buyer-facing listing.
    """
    stmt = select(CropLot).where(CropLot.status == ModelStatus.ACTIVE.value)
    if crop:
        stmt = stmt.where(CropLot.crop_name.ilike(f"%{crop}%"))
    if state:
        # No state column on the lot; fall back to a substring on location
        stmt = stmt.where(CropLot.location.ilike(f"%{state}%"))
    stmt = stmt.order_by(CropLot.created_at.desc())
    return list(db.execute(stmt).scalars().all())


@router.get(
    "/crop-lots/{public_id}",
    response_model=CropLotRead,
    summary="Fetch a single crop lot by its public ID",
)
def get_crop_lot(public_id: str, db: Session = Depends(get_db)) -> CropLot:
    lot = db.execute(
        select(CropLot).where(CropLot.public_id == public_id)
    ).scalar_one_or_none()
    if lot is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Crop lot '{public_id}' was not found.",
        )
    return lot
