"""Pydantic schemas for the Decision Support endpoint.

The response is intentionally a small, transparent object: a single
recommendation, the human-readable reason, the comparison table the
recommendation was based on, and a flag for "we don't have enough data".
"""
from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field


class MarketComparisonRow(BaseModel):
    """One row of the comparison table shown to the farmer."""

    market: str
    location: Optional[str] = None
    state: Optional[str] = None
    modal_price: float = Field(..., description="Modal price per kg INR used.")
    modal_price_source_unit: str = Field(default="INR/kg")
    distance_km: float = Field(..., ge=0)
    transport_cost: float = Field(..., ge=0)
    loading_cost: float = Field(..., ge=0)
    unloading_cost: float = Field(..., ge=0)
    other_charges: float = Field(..., ge=0)
    total_logistics_cost: float = Field(..., ge=0)
    gross_value: float = Field(..., ge=0)
    net_realisation: float = Field(...)
    is_estimate: bool = Field(default=True)


class FarmerDecisionRead(BaseModel):
    """Stored (or freshly-computed) decision for a Crop Lot."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    crop_lot_id: int
    recommendation: str
    reason: str
    insufficient_data: bool
    is_estimate: bool
    comparison: List[MarketComparisonRow]
    created_at: datetime
    updated_at: datetime
