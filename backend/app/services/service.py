"""Market-price service layer.

This is the single place that decides which provider handles a request,
and what happens when the live provider is misconfigured, rate-limited,
or returns an error.

Behaviour:

* Active provider is chosen from settings (``market_price_provider``).
* On success, the response envelope reports ``is_live=True`` (or
  ``False`` for the demo provider) and the provider's name in
  ``source``.
* On failure from the live provider, behaviour depends on
  ``settings.market_price_demo_fallback``:
    - True  → fall back to the demo provider; envelope reports
              ``is_live=False`` and ``source="demo"``.
    - False → propagate the failure as a 503 (the API layer handles
              that).
* Health endpoint reports the configured provider plus a snapshot of
  the last live call.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import List, Optional

from app.core.config import settings
from app.schemas.market_price import (
    MarketPriceHealth,
    MarketPriceListResponse,
    MarketPriceQuery,
    MarketPriceRead,
)
from app.services.data_gov_provider import DataGovProvider
from app.services.demo_provider import DemoProvider
from app.services.provider import (
    MarketDataProvider,
    MarketDataProviderError,
    ProviderHealth,
)

logger = logging.getLogger(__name__)


def _filter_results(results: List[MarketPriceRead], query: MarketPriceQuery) -> List[MarketPriceRead]:
    """Apply case-insensitive post-filters the provider may have ignored."""
    crop = query.crop.lower() if query.crop else None
    state = query.state.lower() if query.state else None
    market = query.market.lower() if query.market else None
    location = query.location.lower() if query.location else None

    def keep(item: MarketPriceRead) -> bool:
        if crop and crop not in item.crop.lower():
            return False
        if state and (not item.state or state != item.state.lower()):
            return False
        if market and market not in item.market.lower():
            return False
        if location and location not in item.location.lower():
            return False
        return True

    return [item for item in results if keep(item)]


class MarketPriceService:
    """Coordinates market-price providers and response envelopes."""

    def __init__(
        self,
        *,
        live_provider: Optional[MarketDataProvider] = None,
        demo_provider: Optional[MarketDataProvider] = None,
    ) -> None:
        self._live_provider = live_provider or DataGovProvider()
        self._demo_provider = demo_provider or DemoProvider()
        self._last_live_error: Optional[str] = None
        self._last_live_succeeded: bool = False

    # ------------------------------------------------------------------ queries

    def list_prices(self, query: MarketPriceQuery) -> MarketPriceListResponse:
        """Return a market-price list response, using the active provider.

        Falls back to demo data if the live provider errors out and
        ``market_price_demo_fallback`` is enabled; otherwise re-raises
        ``MarketDataProviderError`` so the API layer can return a 503.
        """
        provider = self._select_active_provider()
        fetched_at = datetime.now(tz=timezone.utc)

        try:
            raw = provider.fetch_prices(query)
            self._last_live_succeeded = not self._is_demo(provider)
            self._last_live_error = None
            results = _filter_results(raw, query)
            return MarketPriceListResponse(
                count=len(results),
                source=provider.name,
                is_live=not self._is_demo(provider),
                fetched_at=fetched_at,
                query=query,
                results=results,
            )
        except MarketDataProviderError as exc:
            self._last_live_error = str(exc)
            logger.warning("live market-price provider failed: %s", exc)
            if not settings.market_price_demo_fallback:
                raise

            # Switch to demo and re-filter so the response is consistent.
            demo = self._demo_provider
            raw = demo.fetch_prices(query)
            results = _filter_results(raw, query)
            return MarketPriceListResponse(
                count=len(results),
                source=demo.name,
                is_live=False,
                fetched_at=fetched_at,
                query=query,
                results=results,
            )

    def health(self) -> MarketPriceHealth:
        live_health: ProviderHealth = self._live_provider.health()
        return MarketPriceHealth(
            provider_configured=live_health.configured,
            provider_name=settings.market_price_provider,
            demo_fallback_enabled=settings.market_price_demo_fallback,
            is_live=self._last_live_succeeded,
            last_error=self._last_live_error,
        )

    # ------------------------------------------------------------------ helpers

    def _select_active_provider(self) -> MarketDataProvider:
        name = (settings.market_price_provider or "").strip().lower()
        if name in ("demo", "demo_provider", ""):
            return self._demo_provider
        # Default to the live provider for any other configured name.
        return self._live_provider

    @staticmethod
    def _is_demo(provider: MarketDataProvider) -> bool:
        return getattr(provider, "name", "") == "demo"


# ---------------------------------------------------------------------------
# Singleton accessor — created lazily so module import is side-effect free.
# ---------------------------------------------------------------------------

_service: Optional[MarketPriceService] = None


def get_market_price_service() -> MarketPriceService:
    global _service
    if _service is None:
        _service = MarketPriceService()
    return _service
