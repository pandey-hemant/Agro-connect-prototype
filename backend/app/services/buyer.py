"""Buyer service — list, fetch, and seed demo buyers.

All records are clearly marked with ``is_demo`` so the UI never presents
a demo buyer as a real registered company.
"""
from __future__ import annotations

from typing import List, Optional

from sqlalchemy.orm import Session, joinedload

from app.db.session import SessionLocal
from app.models.buyer import Buyer
from app.models.buyer_requirement import BuyerRequirement
from app.schemas.buyer import (
    BuyerListResponse,
    BuyerRead,
    BuyerRequirementRead,
)


def _to_read(buyer: Buyer) -> BuyerRead:
    return BuyerRead(
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
            BuyerRequirementRead(
                crop_name=r.crop_name,
                variety=r.variety or "",
                min_quantity=float(r.min_quantity),
                max_quantity=float(r.max_quantity),
                quantity_unit=r.quantity_unit,
                min_price=float(r.min_price),
                max_price=float(r.max_price),
                price_currency=r.price_currency,
                price_unit=r.price_unit,
                preferred_quality_grade=r.preferred_quality_grade or "",
            )
            for r in (buyer.requirements or [])
        ],
        created_at=buyer.created_at,
    )


def list_buyers(
    *,
    crop: Optional[str] = None,
    state: Optional[str] = None,
    verified: Optional[bool] = None,
) -> BuyerListResponse:
    """List buyers, optionally filtered by crop / state / verification.

    The ``is_live`` flag in the response is always False until we have a
    verified-buyer source. Demo buyers are filtered out only when
    ``verified=True`` is explicitly requested AND the source is real;
    for now we keep them so the UI can render the demo chip.
    """
    db: Session = SessionLocal()
    try:
        q = db.query(Buyer).options(joinedload(Buyer.requirements))
        if crop:
            q = q.join(BuyerRequirement).filter(
                BuyerRequirement.crop_name.ilike(f"%{crop.lower()}%")
            ).distinct()
        if state:
            q = q.filter(Buyer.state.ilike(state))
        if verified is True:
            q = q.filter(Buyer.verification_status == "VERIFIED")
        elif verified is False:
            q = q.filter(Buyer.verification_status != "VERIFIED")

        buyers: List[Buyer] = q.order_by(Buyer.created_at.desc()).all()
        out: List[BuyerRead] = [_to_read(b) for b in buyers]
        return BuyerListResponse(
            count=len(out),
            is_live=False,
            source="demo" if any(b.is_demo for b in buyers) else "live",
            results=out,
        )
    finally:
        db.close()


def get_buyer(public_id: str) -> Optional[BuyerRead]:
    db = SessionLocal()
    try:
        buyer = (
            db.query(Buyer)
            .options(joinedload(Buyer.requirements))
            .filter(Buyer.public_id == public_id)
            .one_or_none()
        )
        return _to_read(buyer) if buyer is not None else None
    finally:
        db.close()
