"""Live data.gov.in provider.

Calls the OGD Platform India resource that republishes AGMARKNET's
"Current Daily Price of Various Commodities from Various Markets (Mandi)".
The resource is published by the Ministry of Agriculture and Farmers
Welfare — the same ministry that runs AGMARKNET directly, but here the
data is exposed as a clean JSON API.

The provider:
  * validates the configured API key up front (constructor),
  * calls the upstream via the shared httpx-style urllib.request path
    (so we do not pull a new dependency for one call),
  * normalizes the upstream record shape into the
    provider-agnostic ``MarketPriceRead`` schema,
  * raises ``MarketDataProviderError`` for any configuration, network,
    parse, or upstream-error condition. The service layer decides
    whether to fall back to demo data or surface the failure.
"""
from __future__ import annotations

import json
import logging
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timezone
from typing import Any, Dict, List, Optional

from app.core.config import settings
from app.schemas.market_price import MarketPriceQuery, MarketPriceRead
from app.services.provider import (
    MarketDataProvider,
    MarketDataProviderError,
    ProviderHealth,
)

logger = logging.getLogger(__name__)

# AGMARKNET convention: prices on this endpoint are reported in INR per
# quintal (100 kg). The upstream does not include a unit field, so we
# declare it here and surface it in the schema's ``unit`` attribute.
DEFAULT_UNIT = "INR/quintal"

# Hard cap on the number of rows we will request from upstream in a
# single call. data.gov.in's resource is paginated; the service layer
# does its own in-memory filtering, so a generous page is fine.
_UPSTREAM_LIMIT = 100


class DataGovProvider(MarketDataProvider):
    """Live data.gov.in mandi price provider."""

    name = "data.gov.in"

    def __init__(
        self,
        *,
        api_key: Optional[str] = None,
        resource_id: Optional[str] = None,
        base_url: str = "https://api.data.gov.in/resource/",
        timeout_seconds: Optional[float] = None,
    ) -> None:
        self._api_key = api_key if api_key is not None else settings.data_gov_in_api_key
        self._resource_id = (
            resource_id if resource_id is not None else settings.data_gov_in_resource_id
        )
        self._base_url = base_url.rstrip("/")
        self._timeout = (
            timeout_seconds
            if timeout_seconds is not None
            else settings.market_price_timeout_seconds
        )
        self._last_error: Optional[str] = None

    # ------------------------------------------------------------------ public

    def fetch_prices(self, query: MarketPriceQuery) -> List[MarketPriceRead]:
        if not self._api_key:
            raise MarketDataProviderError(
                "data.gov.in API key is not configured. "
                "Set DATA_GOV_IN_API_KEY in the backend environment, "
                "or enable market_price_demo_fallback to return demo data."
            )
        if not self._resource_id:
            raise MarketDataProviderError(
                "data.gov.in resource id is not configured "
                "(DATA_GOV_IN_RESOURCE_ID)."
            )

        params: Dict[str, str] = {
            "api-key": self._api_key,
            "format": "json",
            "limit": str(_UPSTREAM_LIMIT),
        }
        if query.state:
            params["filters[state]"] = query.state
        if query.market:
            params["filters[market]"] = query.market
        if query.crop:
            params["filters[commodity]"] = query.crop
        if query.location:
            # data.gov.in's filter is on district, which is the closest
            # thing to our generic ``location`` query.
            params["filters[district]"] = query.location

        url = f"{self._base_url}/{self._resource_id}?{urllib.parse.urlencode(params)}"
        payload = self._http_get_json(url)

        records = payload.get("records") or []
        if not isinstance(records, list):
            self._last_error = "upstream returned non-list records"
            raise MarketDataProviderError(self._last_error)

        fetched_at = datetime.now(tz=timezone.utc)
        results: List[MarketPriceRead] = []
        for raw in records:
            normalized = self._normalize(raw, fetched_at=fetched_at)
            if normalized is not None:
                results.append(normalized)
        self._last_error = None
        return results

    def health(self) -> ProviderHealth:
        return ProviderHealth(
            configured=bool(self._api_key and self._resource_id),
            source=self.name,
            is_live=bool(self._api_key),
            last_error=self._last_error,
        )

    # ----------------------------------------------------------------- helpers

    def _http_get_json(self, url: str) -> Dict[str, Any]:
        request = urllib.request.Request(url, headers={"Accept": "application/json"})
        try:
            with urllib.request.urlopen(request, timeout=self._timeout) as response:
                body = response.read().decode("utf-8")
        except urllib.error.HTTPError as exc:
            self._last_error = f"upstream HTTP {exc.code}: {exc.reason}"
            raise MarketDataProviderError(self._last_error) from exc
        except urllib.error.URLError as exc:
            self._last_error = f"upstream URL error: {exc.reason}"
            raise MarketDataProviderError(self._last_error) from exc
        except TimeoutError as exc:
            self._last_error = "upstream request timed out"
            raise MarketDataProviderError(self._last_error) from exc
        except OSError as exc:
            self._last_error = f"upstream connection error: {exc}"
            raise MarketDataProviderError(self._last_error) from exc

        try:
            data = json.loads(body)
        except json.JSONDecodeError as exc:
            self._last_error = f"upstream returned invalid JSON: {exc}"
            raise MarketDataProviderError(self._last_error) from exc

        if not isinstance(data, dict):
            self._last_error = "upstream returned a non-object JSON body"
            raise MarketDataProviderError(self._last_error)

        return data

    def _normalize(
        self, raw: Dict[str, Any], *, fetched_at: datetime
    ) -> Optional[MarketPriceRead]:
        try:
            commodity = str(raw.get("commodity") or "").strip()
            market = str(raw.get("market") or "").strip()
            district = str(raw.get("district") or "").strip()
            state = str(raw.get("state") or "").strip()
            min_price = float(raw.get("min_price"))
            max_price = float(raw.get("max_price"))
            modal_price = float(raw.get("modal_price"))
        except (TypeError, ValueError, KeyError):
            # Skip malformed records rather than fail the whole batch.
            logger.warning("data_gov_provider: skipping malformed record: %r", raw)
            return None

        if not commodity or not market:
            return None

        price_date = self._parse_arrival_date(raw.get("arrival_date"))
        if price_date is None:
            # Without a date we cannot honestly surface the record.
            return None

        location = ", ".join(part for part in (district, state) if part) or market
        return MarketPriceRead(
            crop=commodity.lower(),
            market=market,
            location=location,
            state=state or None,
            district=district or None,
            min_price=min_price,
            max_price=max_price,
            modal_price=modal_price,
            unit=DEFAULT_UNIT,
            price_date=price_date,
            source=self.name,
            is_live=True,
            fetched_at=fetched_at,
        )

    @staticmethod
    def _parse_arrival_date(value: Any) -> Optional[date]:
        if not value:
            return None
        text = str(value).strip()
        for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y"):
            try:
                return datetime.strptime(text, fmt).date()
            except ValueError:
                continue
        return None
