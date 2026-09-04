"""Logistics & net-realisation API.

All numbers returned here are estimates. The UI is expected to surface
an ESTIMATE chip on every card that came from this endpoint.
"""
from __future__ import annotations

import logging
from typing import List

from fastapi import APIRouter, HTTPException, status

from app.schemas.logistics import (
    LogisticsConfigResponse,
    LogisticsEstimateRead,
    LogisticsEstimateRequest,
)
from app.services.logistics import config_view, estimate_for_lot, list_for_lot

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/logistics", tags=["logistics"])


@router.get(
    "/config",
    response_model=LogisticsConfigResponse,
    summary="Current logistics rate card (marked as ESTIMATE).",
)
def get_config() -> LogisticsConfigResponse:
    return config_view()


@router.post(
    "/estimate",
    response_model=LogisticsEstimateRead,
    summary="Compute a logistics + net-realisation estimate.",
)
def post_estimate(payload: LogisticsEstimateRequest) -> LogisticsEstimateRead:
    try:
        return estimate_for_lot(payload)
    except LookupError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)
        ) from exc
    except Exception as exc:  # pragma: no cover - defensive
        logger.exception("logistics estimate failed")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Could not compute logistics estimate: {exc}",
        ) from exc


@router.get(
    "/estimates/{crop_lot_id}",
    response_model=List[LogisticsEstimateRead],
    summary="List past logistics estimates for a Crop Lot.",
)
def get_estimates_for_lot(crop_lot_id: int) -> List[LogisticsEstimateRead]:
    return list_for_lot(crop_lot_id)
