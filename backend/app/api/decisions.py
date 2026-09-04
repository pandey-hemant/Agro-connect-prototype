"""Decision Support API.

Returns a stored or freshly-computed recommendation for a Crop Lot.
Rules-based — the response always labels itself as an estimate and never
as an AI prediction.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, status

from app.schemas.decision import FarmerDecisionRead
from app.services.decision_support import compute_decision, get_decision

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/decisions", tags=["decisions"])


@router.get(
    "/{crop_lot_id}",
    response_model=FarmerDecisionRead,
    summary="Decision recommendation for a Crop Lot (computed lazily if missing).",
)
def get_for_lot(crop_lot_id: int) -> FarmerDecisionRead:
    try:
        return get_decision(crop_lot_id)
    except LookupError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)
        ) from exc
    except Exception as exc:  # pragma: no cover - defensive
        logger.exception("decision lookup failed")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Could not compute decision: {exc}",
        ) from exc


@router.post(
    "/{crop_lot_id}/refresh",
    response_model=FarmerDecisionRead,
    summary="Recompute the decision for a Crop Lot (always).",
)
def post_refresh(crop_lot_id: int) -> FarmerDecisionRead:
    try:
        return compute_decision(crop_lot_id)
    except LookupError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)
        ) from exc
    except Exception as exc:  # pragma: no cover - defensive
        logger.exception("decision refresh failed")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Could not refresh decision: {exc}",
        ) from exc
