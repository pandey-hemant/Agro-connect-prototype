"""Offer / negotiation service.

State machine for an offer:

    OPEN --> COUNTERED  (one side counters)
    OPEN --> ACCEPTED   (the *other* side accepts; deal is created)
    COUNTERED --> ACCEPTED  (deal is created)
    OPEN --> REJECTED
    COUNTERED --> REJECTED
    any --> CANCELLED  (by the side that opened it; we keep it simple)

Only the ``accept`` action creates a Deal. We never mutate the buyer's
or the lot's existing state from a counter or reject; we only append a
message and update ``Offer.status``.

Acceptance is gated:

* The offer must be in ``OPEN`` or ``COUNTERED`` status.
* The lot must not already be ``SOLD`` (one deal per lot).
* The lot must exist and be ``ACTIVE`` (or ``DRAFT`` for prototype).

The Deal is created with the offer's *current* price/quantity.
"""
from __future__ import annotations

import logging
import uuid
from typing import List, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.db.session import SessionLocal
from app.models import (
    Buyer,
    CropLot,
    Deal,
    DealPaymentStatus,
    DealQualityStatus,
    DealDeliveryStatus,
    DealLogisticsStatus,
    Offer,
    OfferAction,
    OfferActor,
    OfferMessage,
    OfferStatus,
)
from app.schemas.buyer import BuyerRead, BuyerRequirementRead
from app.schemas.offer import (
    DealRead,
    OfferMessageRead,
    OfferRead,
)

logger = logging.getLogger(__name__)


# ---- helpers --------------------------------------------------------------

def _validate_actor(actor: str) -> str:
    actor = (actor or "").strip().upper()
    if actor not in {OfferActor.FARMER.value, OfferActor.BUYER.value}:
        raise OfferError(f"actor must be FARMER or BUYER, got {actor!r}")
    return actor


def _validate_action(action: str) -> str:
    action = (action or "").strip().upper()
    try:
        return OfferAction(action).value
    except ValueError as exc:
        raise OfferError(f"action must be one of {[a.value for a in OfferAction]}") from exc


def _to_offer_message_read(msg: OfferMessage) -> OfferMessageRead:
    return OfferMessageRead(
        id=msg.id,
        actor=msg.actor,
        action=msg.action,
        price=msg.price,
        quantity=msg.quantity,
        message=msg.message,
        created_at=msg.created_at,
    )


def _to_buyer_read(buyer: Buyer) -> BuyerRead:
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


def _to_offer_read(offer: Offer) -> OfferRead:
    return OfferRead(
        public_id=offer.public_id,
        crop_lot_id=offer.crop_lot_id,
        buyer=_to_buyer_read(offer.buyer),
        status=offer.status,
        current_price=float(offer.current_price),
        current_quantity=float(offer.current_quantity),
        currency=offer.currency,
        created_at=offer.created_at,
        updated_at=offer.updated_at,
        messages=[_to_offer_message_read(m) for m in (offer.messages or [])],
    )


def _generate_public_id(db: Session, column) -> str:
    for _ in range(5):
        cand = uuid.uuid4().hex[:16]
        exists = db.execute(select(column).filter_by(public_id=cand)).first()
        if not exists:
            return cand
    return uuid.uuid4().hex  # 32 chars; collision essentially impossible


# ---- public API -----------------------------------------------------------

class OfferError(Exception):
    """Raised for business-rule violations (returns 400/404/409 at the API)."""


def create_offer(
    *,
    crop_lot_id: int,
    buyer_id: int,
    price: float,
    quantity: float,
    message: Optional[str] = None,
) -> Offer:
    """Create a new Offer in OPEN status with an OFFER message."""
    if price <= 0 or quantity <= 0:
        raise OfferError("price and quantity must be > 0")

    db: Session = SessionLocal()
    try:
        lot = db.get(CropLot, crop_lot_id)
        if lot is None:
            raise OfferError(f"Crop lot {crop_lot_id} not found")
        if lot.status == "SOLD":
            raise OfferError("Crop lot is already SOLD")
        if lot.status == "CANCELLED":
            raise OfferError("Crop lot is CANCELLED")

        buyer = db.get(Buyer, buyer_id)
        if buyer is None:
            raise OfferError(f"Buyer {buyer_id} not found")

        offer = Offer(
            public_id=_generate_public_id(db, Offer),
            crop_lot_id=lot.id,
            buyer_id=buyer.id,
            status=OfferStatus.OPEN.value,
            current_price=float(price),
            current_quantity=float(quantity),
            currency=lot.price_currency or "INR",
        )
        db.add(offer)
        db.flush()  # populate id

        db.add(OfferMessage(
            offer_id=offer.id,
            actor=OfferActor.BUYER.value,
            action=OfferAction.OFFER.value,
            price=float(price),
            quantity=float(quantity),
            message=message,
        ))

        db.commit()
        db.refresh(offer)
        # Re-fetch with relationships for the response
        offer = (
            db.query(Offer)
            .options(selectinload(Offer.buyer).selectinload(Buyer.requirements),
                     selectinload(Offer.messages))
            .filter(Offer.id == offer.id)
            .one()
        )
        return offer
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def list_offers_for_lot(crop_lot_id: int) -> List[Offer]:
    db: Session = SessionLocal()
    try:
        rows = (
            db.query(Offer)
            .options(selectinload(Offer.buyer).selectinload(Buyer.requirements),
                     selectinload(Offer.messages))
            .filter(Offer.crop_lot_id == crop_lot_id)
            .order_by(Offer.created_at.desc())
            .all()
        )
        # Detach for safety
        for r in rows:
            db.expunge(r)
        return rows
    finally:
        db.close()


def get_offer(public_id: str) -> Optional[Offer]:
    db: Session = SessionLocal()
    try:
        row = (
            db.query(Offer)
            .options(selectinload(Offer.buyer).selectinload(Buyer.requirements),
                     selectinload(Offer.messages))
            .filter(Offer.public_id == public_id)
            .one_or_none()
        )
        if row is not None:
            db.expunge(row)
        return row
    finally:
        db.close()


def _append_message_and_update(
    offer_public_id: str,
    *,
    actor: str,
    action: str,
    new_status: Optional[str] = None,
    price: Optional[float] = None,
    quantity: Optional[float] = None,
    message: Optional[str] = None,
) -> Offer:
    actor = _validate_actor(actor)
    action = _validate_action(action)
    if price is not None and price <= 0:
        raise OfferError("price must be > 0")
    if quantity is not None and quantity <= 0:
        raise OfferError("quantity must be > 0")

    db: Session = SessionLocal()
    try:
        offer = (
            db.query(Offer)
            .options(selectinload(Offer.buyer).selectinload(Buyer.requirements),
                     selectinload(Offer.messages))
            .filter(Offer.public_id == offer_public_id)
            .one_or_none()
        )
        if offer is None:
            raise OfferError(f"Offer {offer_public_id} not found")

        if offer.status in {
            OfferStatus.ACCEPTED.value, OfferStatus.REJECTED.value,
            OfferStatus.CANCELLED.value, OfferStatus.FINALIZED.value,
        }:
            raise OfferError(
                f"Offer is already {offer.status}; cannot {action.lower()}."
            )

        if new_status:
            offer.status = new_status
        if price is not None:
            offer.current_price = float(price)
        if quantity is not None:
            offer.current_quantity = float(quantity)

        db.add(OfferMessage(
            offer_id=offer.id,
            actor=actor,
            action=action,
            price=float(price) if price is not None else None,
            quantity=float(quantity) if quantity is not None else None,
            message=message,
        ))
        db.commit()
        db.refresh(offer)
        offer = (
            db.query(Offer)
            .options(selectinload(Offer.buyer).selectinload(Buyer.requirements),
                     selectinload(Offer.messages))
            .filter(Offer.id == offer.id)
            .one()
        )
        return offer
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def counter_offer(
    offer_public_id: str,
    *,
    actor: str,
    price: float,
    quantity: float,
    message: Optional[str] = None,
) -> Offer:
    """Append a COUNTER message and set status to COUNTERED."""
    return _append_message_and_update(
        offer_public_id,
        actor=actor,
        action=OfferAction.COUNTER.value,
        new_status=OfferStatus.COUNTERED.value,
        price=price,
        quantity=quantity,
        message=message,
    )


def reject_offer(
    offer_public_id: str,
    *,
    actor: str,
    reason: Optional[str] = None,
) -> Offer:
    return _append_message_and_update(
        offer_public_id,
        actor=actor,
        action=OfferAction.REJECT.value,
        new_status=OfferStatus.REJECTED.value,
        message=reason,
    )


def accept_offer(
    offer_public_id: str,
    *,
    actor: str,
) -> tuple[Offer, Deal]:
    """Accept an open/countered offer; create a Deal and mark the lot SOLD.

    Idempotent: if the offer is already ACCEPTED, return the existing
    offer + its deal rather than creating a duplicate.
    """
    actor = _validate_actor(actor)

    db: Session = SessionLocal()
    try:
        offer = (
            db.query(Offer)
            .options(selectinload(Offer.buyer).selectinload(Buyer.requirements),
                     selectinload(Offer.messages))
            .filter(Offer.public_id == offer_public_id)
            .one_or_none()
        )
        if offer is None:
            raise OfferError(f"Offer {offer_public_id} not found")

        if offer.status == OfferStatus.ACCEPTED.value:
            # Idempotent: return the existing deal
            deal = (
                db.query(Deal).filter(Deal.offer_id == offer.id).one_or_none()
            )
            if deal is None:
                # Should not happen, but defensively rebuild one
                deal = _create_deal_from_offer(db, offer)
                db.commit()
                db.refresh(deal)
            return offer, deal

        if offer.status in {
            OfferStatus.REJECTED.value, OfferStatus.CANCELLED.value,
            OfferStatus.FINALIZED.value,
        }:
            raise OfferError(f"Offer is {offer.status}; cannot accept.")

        lot = db.get(CropLot, offer.crop_lot_id)
        if lot is None:
            raise OfferError("Underlying crop lot disappeared.")
        if lot.status == "SOLD":
            raise OfferError("Crop lot is already SOLD to another buyer.")
        if lot.status == "CANCELLED":
            raise OfferError("Crop lot is CANCELLED.")

        # Mark offer accepted + append message
        offer.status = OfferStatus.ACCEPTED.value
        db.add(OfferMessage(
            offer_id=offer.id,
            actor=actor,
            action=OfferAction.ACCEPT.value,
            price=offer.current_price,
            quantity=offer.current_quantity,
            message=f"Accepted by {actor.lower()}.",
        ))

        # Create the deal
        deal = _create_deal_from_offer(db, offer)
        db.add(deal)
        db.flush()  # populate deal.id

        # Mark the lot SOLD (so other open offers for this lot cannot be accepted)
        lot.status = "SOLD"

        # Auto-reject every other offer that is still open or in negotiation
        # for the same lot — the lot is now sold to *this* buyer. The
        # rejected offers get a "SYSTEM" REJECT message explaining why.
        other_open = (
            db.query(Offer)
            .filter(
                Offer.crop_lot_id == lot.id,
                Offer.id != offer.id,
                Offer.status.in_({
                    OfferStatus.OPEN.value,
                    OfferStatus.COUNTERED.value,
                }),
            )
            .all()
        )
        for other in other_open:
            other.status = OfferStatus.REJECTED.value
            db.add(OfferMessage(
                offer_id=other.id,
                actor=OfferActor.SYSTEM.value,
                action=OfferAction.REJECT.value,
                price=other.current_price,
                quantity=other.current_quantity,
                message=(
                    "Auto-rejected: the crop lot has been sold to another buyer. "
                    f"Accepted offer: {offer.public_id}."
                ),
            ))

        db.commit()
        db.refresh(offer)
        db.refresh(deal)

        offer = (
            db.query(Offer)
            .options(selectinload(Offer.buyer).selectinload(Buyer.requirements),
                     selectinload(Offer.messages))
            .filter(Offer.id == offer.id)
            .one()
        )
        return offer, deal
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def _create_deal_from_offer(db: Session, offer: Offer) -> Deal:
    """Create a Deal row from the current state of an offer.

    Public_id is unique; we re-use the offer public_id as a hint but
    generate fresh to avoid coupling.
    """
    total = float(offer.current_price) * float(offer.current_quantity)
    return Deal(
        public_id="DEAL-" + uuid.uuid4().hex[:12].upper(),
        crop_lot_id=offer.crop_lot_id,
        buyer_id=offer.buyer_id,
        offer_id=offer.id,
        agreed_price=float(offer.current_price),
        agreed_quantity=float(offer.current_quantity),
        total_value=total,
        currency=offer.currency or "INR",
        quality_status=DealQualityStatus.PENDING.value,
        logistics_status=DealLogisticsStatus.NOT_STARTED.value,
        delivery_status=DealDeliveryStatus.PENDING.value,
        payment_status=DealPaymentStatus.PENDING.value,
    )


# ---- response shaping -----------------------------------------------------

def offer_to_read(offer: Offer) -> OfferRead:
    return _to_offer_read(offer)


def deal_to_read(deal: Deal) -> DealRead:
    return DealRead(
        public_id=deal.public_id,
        crop_lot_id=deal.crop_lot_id,
        buyer_id=deal.buyer_id,
        offer_id=deal.offer_id,
        agreed_price=float(deal.agreed_price),
        agreed_quantity=float(deal.agreed_quantity),
        total_value=float(deal.total_value),
        currency=deal.currency,
        quality_status=deal.quality_status,
        logistics_status=deal.logistics_status,
        delivery_status=deal.delivery_status,
        payment_status=deal.payment_status,
        created_at=deal.created_at,
        updated_at=deal.updated_at,
    )
