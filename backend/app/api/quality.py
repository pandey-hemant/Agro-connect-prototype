"""Quality assessment API.

Endpoints (all under ``/api``):

- ``GET  /quality/{crop_lot_id}``                — fetch current assessment
- ``POST /quality/{crop_lot_id}``                — farmer declare / replace
- ``POST /quality/{crop_lot_id}/verify``         — buyer/verifier confirm or dispute
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, status

from app.schemas.quality import (
    QualityAssessmentRead,
    QualityDeclare,
    QualityVerify,
)
from app.services.quality_service import (
    QualityError,
    declare_quality,
    get_quality,
    quality_to_read,
    verify_quality,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/quality", tags=["quality"])


@router.get(
    "/{crop_lot_id}",
    response_model=QualityAssessmentRead,
    summary="Get the current quality assessment for a Crop Lot.",
)
def get_quality_for_lot(crop_lot_id: int) -> QualityAssessmentRead:
    qa = get_quality(crop_lot_id)
    if qa is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No quality assessment for crop lot {crop_lot_id}",
        )
    return QualityAssessmentRead(**quality_to_read(qa))


@router.post(
    "/{crop_lot_id}",
    response_model=QualityAssessmentRead,
    summary="Farmer declares (or replaces) the quality of a Crop Lot.",
)
def post_declare_quality(
    crop_lot_id: int, payload: QualityDeclare,
) -> QualityAssessmentRead:
    try:
        qa = declare_quality(
            crop_lot_id,
            grade=payload.grade,
            size=payload.size,
            appearance=payload.appearance,
            moisture_pct=payload.moisture_pct,
            defects_pct=payload.defects_pct,
            notes=payload.notes,
        )
    except QualityError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc),
        ) from exc
    return QualityAssessmentRead(**quality_to_read(qa))


@router.post(
    "/{crop_lot_id}/verify",
    response_model=QualityAssessmentRead,
    summary="A buyer/verifier confirms or disputes the declared quality.",
)
def post_verify_quality(
    crop_lot_id: int, payload: QualityVerify,
) -> QualityAssessmentRead:
    try:
        qa = verify_quality(
            crop_lot_id,
            actor=payload.actor,
            grade=payload.grade,
            defects_pct=payload.defects_pct,
            notes=payload.notes,
        )
    except QualityError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc),
        ) from exc
    return QualityAssessmentRead(**quality_to_read(qa))
