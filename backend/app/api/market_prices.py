"""Market-price API routes.

Public surface (mounted under ``/api/market-prices``):

    GET  /            list market prices, with optional filters
    GET  /health      lightweight health snapshot

All requests are routed through ``MarketPriceService``, which owns the
choice of provider and the demo fallback policy.
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.schemas.market_price import (
    MarketPriceHealth,
    MarketPriceListResponse,
    MarketPriceQuery,
)
from app.services import MarketPriceService, get_market_price_service
from app.services.provider import MarketDataProviderError

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/market-prices", tags=["market-prices"])


def _service_dependency() -> MarketPriceService:
    return get_market_price_service()


@router.get(
    "",
    response_model=MarketPriceListResponse,
    summary="List market (mandi) price observations.",
)
def list_market_prices(
    crop: Optional[str] = Query(
        default=None,
        description="Filter by crop / commodity name (case-insensitive).",
    ),
    location: Optional[str] = Query(
        default=None,
        description="Filter by district or market location (substring).",
    ),
    market: Optional[str] = Query(
        default=None,
        description="Filter by mandi / market name (substring).",
    ),
    state: Optional[str] = Query(
        default=None,
        description="Filter by state (exact, case-insensitive).",
    ),
    service: MarketPriceService = Depends(_service_dependency),
) -> MarketPriceListResponse:
    query = MarketPriceQuery(
        crop=crop,
        location=location,
        market=market,
        state=state,
    )
    try:
        return service.list_prices(query)
    except MarketDataProviderError as exc:
        logger.error("market-prices: provider error without fallback: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Market price provider unavailable: {exc}",
        ) from exc


@router.get(
    "/health",
    response_model=MarketPriceHealth,
    summary="Health snapshot for the market-price subsystem.",
)
def market_prices_health(
    service: MarketPriceService = Depends(_service_dependency),
) -> MarketPriceHealth:
    return service.health()
