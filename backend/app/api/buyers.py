"""Buyer marketplace API.

Demo buyers are clearly marked with ``is_demo=true`` and the response
envelope flags ``is_live=false``. The seeder is idempotent — calling
``POST /buyers/seed-demo`` twice is safe.
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, status

from app.schemas.buyer import (
    BuyerListResponse,
    BuyerMatch,
    BuyerMatchListResponse,
    BuyerRead,
    BuyerSeedResponse,
)
from app.services import seed_demo
from app.services.buyer import get_buyer, list_buyers
from app.services.buyer_matching import match_buyers_for_lot, serialise_match

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/buyers", tags=["buyers"])


@router.get(
    "",
    response_model=BuyerListResponse,
    summary="List buyers (optionally filtered by crop, state, verification).",
)
def get_buyers(
    crop: Optional[str] = Query(default=None, description="Filter by crop name (substring, case-insensitive)."),
    state: Optional[str] = Query(default=None, description="Filter by state (exact, case-insensitive)."),
    verified: Optional[bool] = Query(default=None, description="True = VERIFIED only, False = non-VERIFIED only."),
) -> BuyerListResponse:
    return list_buyers(crop=crop, state=state, verified=verified)


@router.get(
    "/match/{crop_lot_id}",
    response_model=BuyerMatchListResponse,
    summary="Rule-based buyer match for a Crop Lot. Not an AI prediction.",
)
def get_buyer_matches(
    crop_lot_id: int,
    limit: int = Query(default=10, ge=1, le=50),
) -> BuyerMatchListResponse:
    try:
        matches = match_buyers_for_lot(crop_lot_id, limit=limit)
    except LookupError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc

    return BuyerMatchListResponse(
        crop_lot_id=crop_lot_id,
        count=len(matches),
        results=[BuyerMatch(**serialise_match(m)) for m in matches],
    )


@router.get(
    "/{public_id}",
    response_model=BuyerRead,
    summary="Single buyer (by public_id) with all requirements.",
)
def get_buyer_by_public_id(public_id: str) -> BuyerRead:
    buyer = get_buyer(public_id)
    if buyer is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Buyer {public_id} not found",
        )
    return buyer


@router.post(
    "/seed-demo",
    response_model=BuyerSeedResponse,
    summary="Idempotently seed demo buyers + requirements.",
)
def post_seed_demo() -> BuyerSeedResponse:
    try:
        result = seed_demo.seed_demo_buyers()
        return BuyerSeedResponse(**result)
    except Exception as exc:  # pragma: no cover - defensive
        logger.exception("buyer seed failed")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Could not seed demo buyers: {exc}",
        ) from exc
