"""Pydantic schemas for the CropLot resource.

We keep two response shapes on purpose:
- ``CropLotRead`` — the full record, returned on detail and create.
- ``CropLotSummary`` — a lighter record for the list endpoint.

Both share the same status enum so the API contract is uniform.
"""
from __future__ import annotations

import enum
from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator


class CropLotStatus(str, enum.Enum):
    DRAFT = "DRAFT"
    ACTIVE = "ACTIVE"
    SOLD = "SOLD"
    CANCELLED = "CANCELLED"


# A small, conservative allow-list for unit values. We don't want the
# farmer (or any client) pushing arbitrary strings into the database.
ALLOWED_UNITS = {"kg", "quintal", "ton", "bag", "crate"}


class CropLotBase(BaseModel):
    crop_name: str = Field(..., min_length=1, max_length=120, description="Common crop name (e.g. 'Tomato').")
    crop_variety: str = Field(..., min_length=1, max_length=120, description="Variety of the crop (e.g. 'Roma').")

    quantity: float = Field(..., gt=0, description="Quantity of produce in this lot. Must be > 0.")
    quantity_unit: str = Field(..., description="Unit for the quantity, e.g. 'kg', 'quintal', 'ton', 'bag', 'crate'.")

    harvest_date: date = Field(..., description="Expected or actual harvest date (YYYY-MM-DD).")
    location: str = Field(..., min_length=1, max_length=255, description="Free-text location / village / district.")

    preferred_selling_radius_km: Optional[float] = Field(
        default=None, ge=0, description="How far the farmer is willing to ship/sell."
    )
    farmer_quality_notes: Optional[str] = Field(
        default=None,
        max_length=2000,
        description=(
            "Farmer-provided quality observations. "
            "Not an official quality grade."
        ),
    )
    minimum_acceptable_price: Optional[float] = Field(
        default=None, ge=0, description="Lowest price the farmer will accept (in price_currency)."
    )
    price_currency: str = Field(default="INR", min_length=1, max_length=8)

    @field_validator("quantity_unit")
    @classmethod
    def _normalise_unit(cls, value: str) -> str:
        normalised = value.strip().lower()
        if not normalised:
            raise ValueError("quantity_unit must not be empty")
        if normalised not in ALLOWED_UNITS:
            raise ValueError(
                f"quantity_unit must be one of: {', '.join(sorted(ALLOWED_UNITS))}"
            )
        return normalised

    @field_validator("crop_name", "crop_variety", "location", "price_currency")
    @classmethod
    def _strip_text(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("must not be empty or whitespace")
        return cleaned


class CropLotCreate(CropLotBase):
    """Payload for POST /api/crop-lots.

    ``status`` is intentionally not accepted from clients in Phase 2 —
    the backend always assigns ``ACTIVE`` on creation. This keeps the
    lifecycle state server-controlled until a real workflow exists.
    """


class CropLotRead(CropLotBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    public_id: str
    status: CropLotStatus
    created_at: datetime
    updated_at: datetime


class CropLotSummary(BaseModel):
    """Lightweight projection for list views."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    public_id: str
    crop_name: str
    crop_variety: str
    quantity: float
    quantity_unit: str
    harvest_date: date
    location: str
    status: CropLotStatus
    minimum_acceptable_price: Optional[float] = None
    price_currency: str
    created_at: datetime
