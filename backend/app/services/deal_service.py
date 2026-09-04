"""Deal service.

A Deal is the *committed* agreement between a farmer and a buyer. It is
created when an Offer is accepted (see ``offer_service.accept_offer``).

This service exposes:
- ``get_deal(public_id)``
- ``list_deals_for_lot(crop_lot_id)``
- ``update_status(public_id, ...)`` — partial update of the four
  status fields with a no-backwards-transitions state machine.

State machine for ``delivery_status``:
    PENDING -> PREPARING -> IN_TRANSIT -> DELIVERED -> COMPLETED

State machine for ``logistics_status``:
    NOT_STARTED -> PLANNED -> IN_TRANSIT -> DELIVERED

State machine for ``payment_status``:
    PENDING -> PARTIAL -> PAID

``quality_status`` is set by the Quality module (Module G), not here.

A deal is **locked** once ``delivery_status == COMPLETED`` — no further
status changes are accepted.
"""
from __future__ import annotations

import logging
from typing import List, Optional

from sqlalchemy.orm import Session, selectinload

from app.db.session import SessionLocal
from app.models import (
    Buyer,
    CropLot,
    Deal,
    DealDeliveryStatus,
    DealLogisticsStatus,
    DealPaymentStatus,
)

logger = logging.getLogger(__name__)


# Allowed forward transitions
_DELIVERY_ORDER = [
    DealDeliveryStatus.PENDING.value,
    DealDeliveryStatus.PREPARING.value,
    DealDeliveryStatus.IN_TRANSIT.value,
    DealDeliveryStatus.DELIVERED.value,
    DealDeliveryStatus.COMPLETED.value,
]
_LOGISTICS_ORDER = [
    DealLogisticsStatus.NOT_STARTED.value,
    DealLogisticsStatus.PLANNED.value,
    DealLogisticsStatus.IN_TRANSIT.value,
    DealLogisticsStatus.DELIVERED.value,
]
_PAYMENT_ORDER = [
    DealPaymentStatus.PENDING.value,
    DealPaymentStatus.PARTIAL.value,
    DealPaymentStatus.PAID.value,
]


class DealError(Exception):
    """Raised for business-rule violations (returned as 400/404/409)."""


# ---- helpers --------------------------------------------------------------

def _to_read(deal: Deal, lot: Optional[CropLot] = None, buyer: Optional[Buyer] = None) -> dict:
    return {
        "public_id": deal.public_id,
        "crop_lot_id": int(deal.crop_lot_id),
        "buyer_id": int(deal.buyer_id),
        "offer_id": int(deal.offer_id),
        "agreed_price": float(deal.agreed_price),
        "agreed_quantity": float(deal.agreed_quantity),
        "total_value": float(deal.total_value),
        "currency": deal.currency or "INR",
        "quality_status": deal.quality_status,
        "logistics_status": deal.logistics_status,
        "delivery_status": deal.delivery_status,
        "payment_status": deal.payment_status,
        "created_at": deal.created_at,
        "updated_at": deal.updated_at,
    }


def _check_forward_transition(
    field_name: str,
    current: str,
    new: str,
    order: list[str],
) -> None:
    """Raise DealError if ``new`` would be a backwards (or out-of-order) transition."""
    if new == current:
        return  # idempotent
    try:
        cur_idx = order.index(current)
    except ValueError:
        raise DealError(
            f"{field_name} is in an unknown state {current!r}; cannot transition."
        )
    try:
        new_idx = order.index(new)
    except ValueError:
        raise DealError(
            f"{field_name} target {new!r} is not a valid state. "
            f"Allowed: {order}."
        )
    if new_idx < cur_idx:
        raise DealError(
            f"{field_name} cannot move backwards from {current} to {new}."
        )
    # Allow same index (idempotent) or strictly forward.
    if new_idx > cur_idx + 1:
        # Skip is fine: e.g. PENDING -> IN_TRANSIT (skip PREPARING) is allowed
        # because intermediate states are not strictly required. We just
        # forbid going *backwards* or to an unknown value.
        pass


# ---- public API -----------------------------------------------------------

def get_deal(public_id: str) -> Optional[Deal]:
    db: Session = SessionLocal()
    try:
        row = db.query(Deal).filter(Deal.public_id == public_id).one_or_none()
        if row is not None:
            db.expunge(row)
        return row
    finally:
        db.close()


def list_deals_for_lot(crop_lot_id: int) -> List[Deal]:
    db: Session = SessionLocal()
    try:
        rows = (
            db.query(Deal)
            .filter(Deal.crop_lot_id == crop_lot_id)
            .order_by(Deal.created_at.desc())
            .all()
        )
        for r in rows:
            db.expunge(r)
        return rows
    finally:
        db.close()


def list_deals_for_buyer(buyer_id: int) -> List[Deal]:
    """Return every deal the buyer is party to, newest first.

    The buyer is identified by ``Deal.buyer_id`` — the same buyer that
    opened the offer that produced the deal.
    """
    db: Session = SessionLocal()
    try:
        rows = (
            db.query(Deal)
            .filter(Deal.buyer_id == buyer_id)
            .order_by(Deal.created_at.desc())
            .all()
        )
        for r in rows:
            db.expunge(r)
        return rows
    finally:
        db.close()


def list_all_deals() -> List[Deal]:
    """Return every deal in the system, newest first.

    Used for the seller-side "My deals" view where the seller is the
    owner of the crop lot — since sellers are not user accounts in the
    prototype, we surface every deal so the prototype can render the
    list. In a real system this would filter by ``Deal.crop_lot.owner_id``.
    """
    db: Session = SessionLocal()
    try:
        rows = db.query(Deal).order_by(Deal.created_at.desc()).all()
        for r in rows:
            db.expunge(r)
        return rows
    finally:
        db.close()


def update_status(
    public_id: str,
    *,
    delivery_status: Optional[str] = None,
    logistics_status: Optional[str] = None,
    payment_status: Optional[str] = None,
    quality_status: Optional[str] = None,
) -> Deal:
    """Partial update of deal statuses with no-backwards state machine.

    Once ``delivery_status == COMPLETED`` the deal is locked — no further
    changes are accepted.
    """
    db: Session = SessionLocal()
    try:
        deal = db.query(Deal).filter(Deal.public_id == public_id).one_or_none()
        if deal is None:
            raise DealError(f"Deal {public_id} not found")

        if deal.delivery_status == DealDeliveryStatus.COMPLETED.value:
            raise DealError(
                "Deal is COMPLETED; no further status changes are accepted."
            )

        if delivery_status is not None:
            _check_forward_transition(
                "delivery_status", deal.delivery_status, delivery_status, _DELIVERY_ORDER,
            )
            deal.delivery_status = delivery_status
        if logistics_status is not None:
            _check_forward_transition(
                "logistics_status", deal.logistics_status, logistics_status, _LOGISTICS_ORDER,
            )
            deal.logistics_status = logistics_status
        if payment_status is not None:
            _check_forward_transition(
                "payment_status", deal.payment_status, payment_status, _PAYMENT_ORDER,
            )
            deal.payment_status = payment_status
        if quality_status is not None:
            # Quality is set by the Quality module; we do not enforce a
            # transition here. We just accept the value (validate via the
            # DealQualityStatus enum to keep things consistent).
            allowed_quality = {e.value for e in [
                DealDeliveryStatus.PENDING,  # noqa: F841 (re-use enum import for set)
            ]}
            # Use the actual DealQualityStatus enum if available
            try:
                from app.models import DealQualityStatus
                allowed_quality = {e.value for e in DealQualityStatus}
            except ImportError:  # pragma: no cover
                allowed_quality = {"PENDING", "VERIFIED", "ACCEPTED", "DISPUTED"}
            if quality_status not in allowed_quality:
                raise DealError(
                    f"quality_status {quality_status!r} is not a valid value. "
                    f"Allowed: {sorted(allowed_quality)}"
                )
            deal.quality_status = quality_status

        db.commit()
        db.refresh(deal)
        return deal
    except DealError:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


# ---- response shaping -----------------------------------------------------

def deal_to_read(deal: Deal) -> dict:
    return _to_read(deal)
