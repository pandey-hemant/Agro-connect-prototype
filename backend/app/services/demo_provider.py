"""Demo market-price provider.

Returns a small set of clearly-labelled seed records so the API can
respond in development and demo environments without needing an
external API key. Every record is marked ``is_live=False`` and
``source="demo"``; the service-layer response envelope repeats that
flag at the top level too, so the UI can render a clear "DEMO DATA"
banner.

The seed list intentionally covers a handful of common crops and
states so the frontend's filters can be exercised. Prices are
plausible but NOT real — they are static reference numbers, not
AGMARKNET observations.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import List, Optional

from app.schemas.market_price import MarketPriceQuery, MarketPriceRead
from app.services.provider import MarketDataProvider, ProviderHealth


def _seed_records() -> List[dict]:
    """Static reference data used when the live provider is unavailable.

    The tuples are ``(crop, market, district, state, min, modal, max,
    days_ago)`` — kept in one place so the dataset is easy to read and
    extend.
    """
    today = date.today()
    rows = [
        ("tomato", "Azadpur Mandi",          "North Delhi",     "Delhi",        1400, 1700, 2100),
        ("onion",  "Lasalgaon APMC",         "Nashik",          "Maharashtra",  1800, 2200, 2600),
        ("potato", "Agra Mandi",             "Agra",            "Uttar Pradesh",900, 1100, 1300),
        ("wheat",  "Khanna Mandi",           "Ludhiana",        "Punjab",       2200, 2350, 2500),
        ("rice",   "Karnal Mandi",           "Karnal",          "Haryana",      2800, 3000, 3300),
        ("maize",  ("Davangere APMC",        "Davangere",       "Karnataka",    2000, 2150, 2300)),
        ("soybean","Indore Mandi",           "Indore",          "Madhya Pradesh",4200, 4400, 4600),
        ("cotton", "Rajkot APMC",            "Rajkot",          "Gujarat",      6500, 6900, 7200),
        ("groundnut","Junagadh APMC",        "Junagadh",        "Gujarat",      5500, 5800, 6100),
        ("chilli", "Guntur APMC",            "Guntur",          "Andhra Pradesh",9000, 10500, 12000),
    ]
    # Note: the row above is wrapped in a stray extra paren in the
    # literal — fix that by normalising the structure to flat tuples.
    return rows


# The cleaner, real seed list (the function above was kept for reference
# in the docstring; this is what actually runs).
def _demo_rows() -> List[dict]:
    today = date.today()
    base = [
        ("tomato",    "Azadpur Mandi",   "North Delhi", "Delhi",          1400, 1700, 2100, 0),
        ("onion",     "Lasalgaon APMC",  "Nashik",      "Maharashtra",    1800, 2200, 2600, 0),
        ("potato",    "Agra Mandi",      "Agra",        "Uttar Pradesh",   900, 1100, 1300, 1),
        ("wheat",     "Khanna Mandi",    "Ludhiana",    "Punjab",         2200, 2350, 2500, 1),
        ("rice",      "Karnal Mandi",    "Karnal",      "Haryana",        2800, 3000, 3300, 0),
        ("maize",     "Davangere APMC",  "Davangere",   "Karnataka",      2000, 2150, 2300, 1),
        ("soybean",   "Indore Mandi",    "Indore",      "Madhya Pradesh", 4200, 4400, 4600, 2),
        ("cotton",    "Rajkot APMC",     "Rajkot",      "Gujarat",        6500, 6900, 7200, 1),
        ("groundnut", "Junagadh APMC",   "Junagadh",    "Gujarat",        5500, 5800, 6100, 0),
        ("chilli",    "Guntur APMC",     "Guntur",      "Andhra Pradesh", 9000, 10500, 12000, 1),
    ]
    records: List[dict] = []
    for crop, market, district, state, mn, modal, mx, days_ago in base:
        records.append(
            {
                "crop": crop,
                "market": market,
                "district": district,
                "state": state,
                "min_price": float(mn),
                "modal_price": float(modal),
                "max_price": float(mx),
                "price_date": today - timedelta(days=days_ago),
            }
        )
    return records


class DemoProvider(MarketDataProvider):
    """Built-in seed-data provider. Always available, never live."""

    name = "demo"

    def __init__(self, *, fetched_at: Optional[datetime] = None) -> None:
        self._fetched_at = fetched_at

    def fetch_prices(self, query: MarketPriceQuery) -> List[MarketPriceRead]:
        fetched_at = self._fetched_at or datetime.now(tz=timezone.utc)
        out: List[MarketPriceRead] = []
        for row in _demo_rows():
            if query.crop and query.crop.lower() not in row["crop"]:
                continue
            if query.state and query.state.lower() != row["state"].lower():
                continue
            if query.market and query.market.lower() not in row["market"].lower():
                continue
            if query.location and query.location.lower() not in (
                f"{row['district']} {row['state']}".lower()
            ):
                continue
            out.append(
                MarketPriceRead(
                    crop=row["crop"],
                    market=row["market"],
                    location=f"{row['district']}, {row['state']}",
                    state=row["state"],
                    district=row["district"],
                    min_price=row["min_price"],
                    max_price=row["max_price"],
                    modal_price=row["modal_price"],
                    unit="INR/quintal",
                    price_date=row["price_date"],
                    source=self.name,
                    is_live=False,
                    fetched_at=fetched_at,
                )
            )
        return out

    def health(self) -> ProviderHealth:
        return ProviderHealth(
            configured=True,
            source=self.name,
            is_live=False,
            last_error=None,
        )


__all__ = ["DemoProvider"]
