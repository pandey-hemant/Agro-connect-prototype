"""Pydantic schemas for the logistics endpoint.

Every result is annotated with ``is_estimate: true`` so the UI can render
the ESTIMATE chip without having to know which fields came from a live
routing API and which did not.
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class LogisticsEstimateRequest(BaseModel):
    crop_lot_id: int = Field(..., gt=0)
    destination_market: str = Field(..., min_length=1, max_length=255)
    destination_label: str = Field(..., min_length=1, max_length=255)
    vehicle_type: Optional[str] = Field(default=None, max_length=64)


class LogisticsEstimateBreakdown(BaseModel):
    """Transparent breakdown of how net realisation was computed."""

    quantity: float
    quantity_unit: str
    quantity_kg: float
    modal_price_per_kg: float
    modal_price_source_unit: str
    price_source: str
    is_live_price: bool
    distance_km: float
    transport_rate_per_km_per_kg: float
    loading_per_kg: float
    unloading_per_kg: float
    other_charges_pct: float
    min_transport: float
    vehicle_type: str


class LogisticsEstimateRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    crop_lot_id: int
    destination_label: str
    destination_market: str
    vehicle_type: str

    distance_km: float
    transport_cost: float
    loading_cost: float
    unloading_cost: float
    other_charges: float
    total_logistics_cost: float

    gross_value: float
    net_realisation: float
    modal_price_per_kg: float
    price_source: str
    is_live_price: bool

    is_estimate: bool
    breakdown: LogisticsEstimateBreakdown
    created_at: datetime


class LogisticsConfigResponse(BaseModel):
    """Current logistics rate card. All values are estimates by design."""

    is_estimate: bool = True
    transport_rate_per_km_per_kg: float
    min_transport: float
    loading_per_kg: float
    unloading_per_kg: float
    other_charges_pct: float
    avg_speed_kmph: float
    default_vehicle: str
    maps_api_configured: bool
    routing_api_configured: bool
    notes: str
