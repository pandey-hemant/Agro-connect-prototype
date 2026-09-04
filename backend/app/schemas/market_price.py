"""Pydantic schemas for the Market Price resource.

A MarketPrice is one observation of prices for a single commodity at a
single market on a single day. The schema is intentionally
provider-agnostic: the API surface does not leak data.gov.in's exact
field names. The ``is_live`` flag is critical — the frontend uses it to
distinguish real external data from the development/demo fallback.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field


class MarketPriceRead(BaseModel):
    """A single market-price observation returned to the client."""

    crop: str = Field(..., description="Commodity / crop name (normalized lower-case).")
    market: str = Field(..., description="Name of the mandi / market.")
    location: str = Field(
        ..., description="District (and optionally state) where the market is located."
    )
    state: Optional[str] = Field(default=None, description="State, if known.")
    district: Optional[str] = Field(default=None, description="District, if known.")

    min_price: float = Field(..., ge=0, description="Lowest reported price for the day.")
    max_price: float = Field(..., ge=0, description="Highest reported price for the day.")
    modal_price: float = Field(
        ..., ge=0, description="Modal (most common) price for the day — the representative figure."
    )
    unit: str = Field(default="INR/quintal", description="Unit for the price figures.")
    price_date: date = Field(..., description="The date the price was observed at the market.")

    source: str = Field(..., description="Where the data came from (e.g. 'data.gov.in', 'demo').")
    is_live: bool = Field(
        ..., description="True if the data was fetched live from an external source, False for demo/seed data."
    )
    fetched_at: datetime = Field(..., description="When AgroConnect retrieved this record.")


class MarketPriceQuery(BaseModel):
    """Query parameters for the market-price list endpoint."""

    model_config = ConfigDict(from_attributes=True)

    crop: Optional[str] = Field(default=None, description="Filter by crop/commodity name (case-insensitive).")
    location: Optional[str] = Field(default=None, description="Filter by district or market location.")
    market: Optional[str] = Field(default=None, description="Filter by specific market/mandi name.")
    state: Optional[str] = Field(default=None, description="Filter by state.")


class MarketPriceListResponse(BaseModel):
    """Response envelope for market-price list queries.

    We use an envelope (not a bare array) so the frontend can always
    know whether the data is live, how many records matched, and what
    source produced the data — without re-parsing individual records.
    """

    count: int = Field(..., description="Number of records returned.")
    source: str = Field(..., description="The active provider's source label.")
    is_live: bool = Field(..., description="Whether the data is live or demo.")
    fetched_at: datetime = Field(..., description="When this batch was retrieved.")
    query: MarketPriceQuery = Field(..., description="Echoes the filters that were applied.")
    results: List[MarketPriceRead] = Field(default_factory=list, description="The matching records.")


class MarketPriceHealth(BaseModel):
    """Lightweight health info for the market-price subsystem."""

    provider_configured: bool = Field(
        ..., description="True if the real provider's API key is set and it can be called."
    )
    provider_name: str = Field(..., description="Name of the active provider.")
    demo_fallback_enabled: bool = Field(
        ..., description="True if the service will return demo data when the live provider fails."
    )
    is_live: bool = Field(..., description="Whether the last successful fetch was live or demo.")
    last_error: Optional[str] = Field(default=None, description="Last error message from the live provider, if any.")
