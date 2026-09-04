"""Abstract market-data provider.

A provider knows how to fetch mandi (market) price observations from a
single source — a government API, a paid feed, a hand-curated file, or a
demo seed. The rest of AgroConnect does not care which source a record
came from; the ``source`` and ``is_live`` fields on the returned
``MarketPriceRead`` make that explicit to clients.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import List, Optional

from app.schemas.market_price import MarketPriceQuery, MarketPriceRead


class MarketDataProvider(ABC):
    """Abstract base for any source of market-price data.

    Subclasses MUST be safe to construct even when their backing service
    is unreachable: they should validate configuration up front and
    raise ``MarketDataProviderError`` if the provider is misconfigured
    (for example, a required API key is missing). They SHOULD NOT make
    any network calls in ``__init__``.
    """

    #: Short identifier exposed to the client in ``MarketPriceRead.source``
    #: and ``MarketPriceListResponse.source``. Example: ``"data.gov.in"``.
    name: str

    @abstractmethod
    def fetch_prices(self, query: MarketPriceQuery) -> List[MarketPriceRead]:
        """Return all price records matching ``query``.

        The base class performs no filtering — every subclass decides
        whether to filter server-side, client-side, or some mix. Providers
        MUST always return ``MarketPriceRead`` instances, never raw
        provider-specific dicts, so the API surface is uniform.
        """

    @abstractmethod
    def health(self) -> "ProviderHealth":
        """Return a snapshot of the provider's state for the health endpoint."""


class MarketDataProviderError(RuntimeError):
    """Raised when a live provider is misconfigured, unreachable, or errors out.

    The service layer turns this into either a graceful demo fallback
    (when ``market_price_demo_fallback`` is on) or a 503 response.
    """


class ProviderHealth:
    """Lightweight health payload returned by ``MarketDataProvider.health``."""

    def __init__(
        self,
        *,
        configured: bool,
        source: str,
        is_live: bool,
        last_error: Optional[str] = None,
    ) -> None:
        self.configured = configured
        self.source = source
        self.is_live = is_live
        self.last_error = last_error
