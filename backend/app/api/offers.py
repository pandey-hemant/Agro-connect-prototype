"""Offers + negotiation API.

Endpoints (all under ``/api``):

- ``POST /offers``                   — open a new offer (first message)
- ``GET  /offers?crop_lot_id=``      — list offers for a lot
- ``GET  /offers/{public_id}``       — single offer with messages
- ``POST /offers/{public_id}/counter``— counter (appends COUNTER message)
- ``POST /offers/{public_id}/accept`` — accept (creates Deal, marks lot SOLD)
- ``POST /offers/{public_id}/reject`` — reject
- ``GET  /offers/{public_id}/messages``— full message history
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, status

from app.models.crop_lot import CropLot
from app.schemas.offer import (
    OfferAcceptResponse,
    OfferActorBody,
    OfferCounter,
    OfferCreate,
    OfferCreateResponse,
    OfferListResponse,
    OfferMessageRead,
    OfferRead,
)
from app.services.offer_service import (
    OfferError,
    accept_offer,
    counter_offer,
    create_offer,
    deal_to_read,
    get_offer,
    list_offers_for_lot,
    offer_to_read,
    reject_offer,
)
from app.db.session import SessionLocal

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/offers", tags=["offers"])


def _to_message_read_list(messages) -> list[OfferMessageRead]:
    return [
        OfferMessageRead(
            id=m.id, actor=m.actor, action=m.action,
            price=m.price, quantity=m.quantity, message=m.message,
            created_at=m.created_at,
        )
        for m in (messages or [])
    ]


@router.post(
    "",
    response_model=OfferCreateResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Open a new offer (first message).",
)
def post_create_offer(payload: OfferCreate) -> OfferCreateResponse:
    try:
        offer = create_offer(
            crop_lot_id=payload.crop_lot_id,
            buyer_id=payload.buyer_id,
            price=payload.price,
            quantity=payload.quantity,
            message=payload.message,
        )
    except OfferError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc
    return OfferCreateResponse(
        offer=offer_to_read(offer),
        public_id=offer.public_id,
    )


@router.get(
    "",
    response_model=OfferListResponse,
    summary="List offers for a Crop Lot.",
)
def get_offers(
    crop_lot_id: int = Query(..., gt=0, description="Crop Lot to list offers for."),
) -> OfferListResponse:
    offers = list_offers_for_lot(crop_lot_id)
    return OfferListResponse(
        crop_lot_id=crop_lot_id,
        count=len(offers),
        results=[offer_to_read(o) for o in offers],
    )


@router.get(
    "/by-buyer/{buyer_id}",
    response_model=OfferListResponse,
    summary="List all offers opened by a specific buyer (across all lots).",
)
def get_offers_by_buyer(buyer_id: int) -> OfferListResponse:
    """Return every offer opened by ``buyer_id``, newest first.

    The frontend uses this to render a buyer's "My Offers" view. The
    query is intentionally simple: it surfaces all offers (open, in
    negotiation, accepted, rejected) so the buyer can see the full
    history of their negotiation activity.
    """
    from sqlalchemy.orm import selectinload
    from app.db.session import SessionLocal
    from app.models import Buyer, Offer

    db = SessionLocal()
    try:
        if db.get(Buyer, buyer_id) is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Buyer {buyer_id} not found",
            )
        rows = (
            db.query(Offer)
            .options(
                selectinload(Offer.buyer).selectinload(Buyer.requirements),
                selectinload(Offer.messages),
            )
            .filter(Offer.buyer_id == buyer_id)
            .order_by(Offer.created_at.desc())
            .all()
        )
        for r in rows:
            db.expunge(r)
        return OfferListResponse(
            crop_lot_id=0,  # not lot-scoped; envelope still shaped consistently
            count=len(rows),
            results=[offer_to_read(o) for o in rows],
        )
    finally:
        db.close()


@router.get(
    "/{public_id}",
    response_model=OfferRead,
    summary="Single offer (by public_id) with all messages.",
)
def get_offer_by_public_id(public_id: str) -> OfferRead:
    offer = get_offer(public_id)
    if offer is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Offer {public_id} not found",
        )
    return offer_to_read(offer)


@router.get(
    "/{public_id}/messages",
    response_model=list[OfferMessageRead],
    summary="Full message history for an offer.",
)
def get_offer_messages(public_id: str) -> list[OfferMessageRead]:
    offer = get_offer(public_id)
    if offer is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Offer {public_id} not found",
        )
    return _to_message_read_list(offer.messages)


@router.post(
    "/{public_id}/counter",
    response_model=OfferRead,
    summary="Append a counter-offer (sets status to COUNTERED).",
)
def post_counter(public_id: str, payload: OfferCounter) -> OfferRead:
    try:
        offer = counter_offer(
            public_id,
            actor=payload.actor,
            price=payload.price,
            quantity=payload.quantity,
            message=payload.message,
        )
    except OfferError as exc:
        # 409 for state conflicts (offer already in a terminal state)
        if "already" in str(exc).lower():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=str(exc),
            ) from exc
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc
    return offer_to_read(offer)


@router.post(
    "/{public_id}/reject",
    response_model=OfferRead,
    summary="Reject an offer (sets status to REJECTED).",
)
def post_reject(public_id: str, payload: OfferActorBody) -> OfferRead:
    try:
        offer = reject_offer(
            public_id, actor=payload.actor, reason=payload.reason,
        )
    except OfferError as exc:
        # 409 for state conflicts (offer already in a terminal state)
        if "already" in str(exc).lower():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=str(exc),
            ) from exc
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc
    return offer_to_read(offer)


@router.post(
    "/{public_id}/accept",
    response_model=OfferAcceptResponse,
    summary="Accept an offer; creates a Deal and marks the Crop Lot SOLD.",
)
def post_accept(public_id: str, payload: OfferActorBody) -> OfferAcceptResponse:
    try:
        offer, deal = accept_offer(public_id, actor=payload.actor)
    except OfferError as exc:
        # 409 for state conflicts (already accepted / lot already SOLD)
        if "already" in str(exc).lower():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=str(exc),
            ) from exc
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc

    # Look up the current lot status
    db = SessionLocal()
    try:
        lot = db.get(CropLot, offer.crop_lot_id)
        lot_status = lot.status if lot else "UNKNOWN"
    finally:
        db.close()

    return OfferAcceptResponse(
        offer=offer_to_read(offer),
        deal=deal_to_read(deal),
        crop_lot_status=lot_status,
    )
