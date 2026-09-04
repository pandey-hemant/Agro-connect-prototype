"""Deal + Delivery API.

Endpoints (all under ``/api``):

- ``GET  /deals/{public_id}``         — single deal
- ``GET  /deals?crop_lot_id=``        — list deals for a lot
- ``POST /deals/{public_id}/status``  — partial status update with
                                        no-backwards state machine
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field

from app.schemas.offer import DealRead
from app.services.deal_service import (
    DealError,
    deal_to_read,
    get_deal,
    list_all_deals,
    list_deals_for_buyer,
    list_deals_for_lot,
    update_status,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/deals", tags=["deals"])


class DealStatusUpdate(BaseModel):
    delivery_status: Optional[str] = Field(default=None)
    logistics_status: Optional[str] = Field(default=None)
    payment_status: Optional[str] = Field(default=None)
    quality_status: Optional[str] = Field(default=None)


class DealListResponse(BaseModel):
    crop_lot_id: int
    buyer_id: Optional[int] = None
    count: int
    results: list[DealRead]


@router.get(
    "/{public_id}",
    response_model=DealRead,
    summary="Single deal by public_id.",
)
def get_deal_by_public_id(public_id: str) -> DealRead:
    deal = get_deal(public_id)
    if deal is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Deal {public_id} not found",
        )
    return DealRead(**deal_to_read(deal))


@router.get(
    "",
    response_model=DealListResponse,
    summary="List deals. Pass either ?crop_lot_id= or ?buyer_id= or omit for all.",
)
def get_deals(
    crop_lot_id: Optional[int] = Query(default=None, gt=0, description="Crop Lot to list deals for."),
    buyer_id: Optional[int] = Query(default=None, gt=0, description="Buyer to list deals for."),
) -> DealListResponse:
    if crop_lot_id is not None:
        deals = list_deals_for_lot(crop_lot_id)
        return DealListResponse(
            crop_lot_id=crop_lot_id, buyer_id=None,
            count=len(deals),
            results=[DealRead(**deal_to_read(d)) for d in deals],
        )
    if buyer_id is not None:
        deals = list_deals_for_buyer(buyer_id)
        return DealListResponse(
            crop_lot_id=0, buyer_id=buyer_id,
            count=len(deals),
            results=[DealRead(**deal_to_read(d)) for d in deals],
        )
    deals = list_all_deals()
    return DealListResponse(
        crop_lot_id=0, buyer_id=None,
        count=len(deals),
        results=[DealRead(**deal_to_read(d)) for d in deals],
    )


@router.post(
    "/{public_id}/status",
    response_model=DealRead,
    summary="Partial update of deal statuses. No backwards transitions.",
)
def post_update_status(
    public_id: str, payload: DealStatusUpdate,
) -> DealRead:
    try:
        deal = update_status(
            public_id,
            delivery_status=payload.delivery_status,
            logistics_status=payload.logistics_status,
            payment_status=payload.payment_status,
            quality_status=payload.quality_status,
        )
    except DealError as exc:
        msg = str(exc).lower()
        # Locked / backwards transitions -> 409; not found -> 404
        if "not found" in msg:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail=str(exc),
            ) from exc
        if "completed" in msg or "backwards" in msg or "valid" in msg:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail=str(exc),
            ) from exc
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc),
        ) from exc
    return DealRead(**deal_to_read(deal))
