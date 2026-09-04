"""FPOs (Farmer Producer Organisations) API.

Endpoints (all under ``/api``):

- ``POST /fpos``                       — create an FPO
- ``GET  /fpos``                       — list FPOs
- ``GET  /fpos/{public_id}``           — single FPO with members
- ``POST /fpos/{public_id}/join``      — body: ``{crop_lot_id}`` add a lot
- ``POST /fpos/{public_id}/leave``     — body: ``{crop_lot_id}`` remove a lot
- ``GET  /fpos/{public_id}/aggregate?crop=tomato`` — totals + reachable buyers
- ``POST /fpos/seed-demo``             — idempotent demo seeder
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, status

from app.schemas.fpo import (
    FPOAggregateResponse,
    FPOCreate,
    FPOJoinRequest,
    FPOListResponse,
    FPORead,
    FPOSeedResponse,
)
from app.services.fpo import (
    FPOError,
    aggregate,
    create_fpo,
    fpo_to_read,
    get_fpo,
    join_lot,
    leave_lot,
    list_fpos,
    seed_demo_fpos,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/fpos", tags=["fpos"])


@router.post(
    "",
    response_model=FPORead,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new FPO.",
)
def post_create_fpo(payload: FPOCreate) -> FPORead:
    try:
        fpo = create_fpo(
            name=payload.name,
            location=payload.location,
            district=payload.district,
            state=payload.state,
        )
    except FPOError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc),
        ) from exc
    return FPORead(**fpo_to_read(fpo))


@router.get(
    "",
    response_model=FPOListResponse,
    summary="List FPOs.",
)
def get_fpos() -> FPOListResponse:
    fpos = list_fpos()
    return FPOListResponse(
        count=len(fpos),
        is_live=False,  # prototype — FPOs are demo until you mark them live
        source="local",
        results=[FPORead(**fpo_to_read(f)) for f in fpos],
    )


@router.get(
    "/seed-demo",
    response_model=FPOSeedResponse,
    summary="Idempotent demo seeder. Returns a small body, never errors on re-call.",
    include_in_schema=False,
)
@router.post(
    "/seed-demo",
    response_model=FPOSeedResponse,
    summary="Idempotently seed 2 demo FPOs.",
)
def post_seed_demo_fpos() -> FPOSeedResponse:
    out = seed_demo_fpos()
    return FPOSeedResponse(
        inserted=int(out["inserted"]),
        skipped=int(out["skipped"]),
        total_after=int(out["total_after"]),
        is_live=False,
        source="demo",
        public_ids=out.get("public_ids", []),
    )


@router.get(
    "/{public_id}",
    response_model=FPORead,
    summary="Single FPO (by public_id) with its member lots.",
)
def get_fpo_by_public_id(public_id: str) -> FPORead:
    fpo = get_fpo(public_id)
    if fpo is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"FPO {public_id} not found",
        )
    return FPORead(**fpo_to_read(fpo))


@router.post(
    "/{public_id}/join",
    response_model=FPORead,
    summary="Add a Crop Lot to this FPO. Idempotent.",
)
def post_join(public_id: str, payload: FPOJoinRequest) -> FPORead:
    try:
        fpo = join_lot(public_id, payload.crop_lot_id)
    except FPOError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc),
        ) from exc
    return FPORead(**fpo_to_read(fpo))


@router.post(
    "/{public_id}/leave",
    response_model=FPORead,
    summary="Remove a Crop Lot from this FPO. No-op if not a member.",
)
def post_leave(public_id: str, payload: FPOJoinRequest) -> FPORead:
    try:
        fpo = leave_lot(public_id, payload.crop_lot_id)
    except FPOError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc),
        ) from exc
    return FPORead(**fpo_to_read(fpo))


@router.get(
    "/{public_id}/aggregate",
    response_model=FPOAggregateResponse,
    summary="Per-crop aggregates + buyers whose min_quantity is reachable.",
)
def get_aggregate(
    public_id: str,
    crop: Optional[str] = Query(default=None, description="Optional crop filter (e.g. 'tomato')."),
) -> FPOAggregateResponse:
    try:
        result = aggregate(public_id, crop=crop)
    except FPOError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=str(exc),
        ) from exc
    return FPOAggregateResponse(**result)
