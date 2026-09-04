"""Market-price service layer.

This package isolates how AgroConnect obtains mandi (market) price data
from how the rest of the backend uses it.

Layering:

    API router  →  MarketPriceService  →  MarketDataProvider (ABC)
                                            ├── DataGovProvider
                                            └── DemoProvider

The service chooses which provider to call, the provider does the actual
data fetching, and the service converts provider output into the
provider-agnostic ``MarketPriceRead`` schema used by the API.
"""
from app.services import seed_demo  # noqa: F401  -- provides seed_demo_buyers, ...
from app.services.fpo import (  # noqa: F401
    aggregate as fpo_aggregate,
    create_fpo,
    fpo_to_read,
    get_fpo,
    join_lot,
    leave_lot,
    list_fpos,
    seed_demo_fpos,
)
from app.services.provider import MarketDataProvider
from app.services.service import MarketPriceService, get_market_price_service

__all__ = [
    "MarketDataProvider",
    "MarketPriceService",
    "get_market_price_service",
    "seed_demo",
    "create_fpo",
    "list_fpos",
    "get_fpo",
    "join_lot",
    "leave_lot",
    "fpo_aggregate",
    "fpo_to_read",
    "seed_demo_fpos",
]
