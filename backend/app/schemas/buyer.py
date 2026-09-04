"""Pydantic schemas for the Buyer marketplace."""
from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field


class BuyerRequirementRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    crop_name: str
    variety: str = ""
    min_quantity: float
    max_quantity: float
    quantity_unit: str
    min_price: float
    max_price: float
    price_currency: str = "INR"
    price_unit: str = "INR/kg"
    preferred_quality_grade: str = ""


class BuyerRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    public_id: str
    name: str
    location: str
    district: str
    state: str
    contact_method: str
    verification_status: str
    is_demo: bool
    requirements: List[BuyerRequirementRead] = Field(default_factory=list)
    created_at: datetime


class BuyerListResponse(BaseModel):
    """Envelope so the UI can tell demo vs live at a glance."""

    count: int
    is_live: bool
    source: str
    results: List[BuyerRead]


class BuyerSeedResponse(BaseModel):
    """Idempotent demo seeder result."""

    inserted: int
    skipped: int
    total_after: int
    is_live: bool = False
    source: str = "demo"


class BuyerMatch(BaseModel):
    """A single buyer match for a Crop Lot.

    ``score`` is a 0-100 rule-based score (not an AI prediction). The
    contributing rules are returned in ``reasons`` and a short summary
    in ``match_explanation``.
    """

    buyer: BuyerRead
    score: int = Field(..., ge=0, le=100)
    reasons: List[str] = Field(default_factory=list)
    match_explanation: str


class BuyerMatchListResponse(BaseModel):
    """Envelope so the UI can show a header like 'Matches for Tomato 500kg'."""

    crop_lot_id: int
    count: int
    method: str = "rule-based"
    results: List[BuyerMatch]
