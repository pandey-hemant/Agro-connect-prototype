"""Pydantic schemas for FPOs (Farmer Producer Organisations)."""
from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field


class FPOCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    location: str = Field(..., min_length=1, max_length=255)
    district: str = Field(default="", max_length=120)
    state: str = Field(default="", max_length=120)


class FPOMembershipRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    crop_lot_id: int
    public_id: str
    crop_name: str
    crop_variety: str
    quantity: float
    quantity_unit: str
    location: str
    harvest_date: Optional[str] = None
    joined_at: datetime


class FPORead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    public_id: str
    name: str
    location: str
    district: str
    state: str
    is_demo: bool
    created_at: datetime
    member_count: int = 0
    members: List[FPOMembershipRead] = Field(default_factory=list)


class FPOListResponse(BaseModel):
    count: int
    is_live: bool
    source: str
    results: List[FPORead]


class FPOSeedResponse(BaseModel):
    inserted: int
    skipped: int
    total_after: int
    is_live: bool = False
    source: str = "demo"
    public_ids: List[str] = Field(default_factory=list)


class FPOJoinRequest(BaseModel):
    crop_lot_id: int = Field(..., gt=0)


class FPOLotAggregate(BaseModel):
    """Aggregated quantity/value across an FPO for one crop."""

    crop_name: str
    lot_count: int
    total_quantity: float
    quantity_unit: str
    estimated_value: float
    currency: str = "INR"
    member_public_ids: List[str] = Field(default_factory=list)


class FPOBuyerReachability(BaseModel):
    """A buyer whose min_quantity the aggregate can now satisfy."""

    buyer_public_id: str
    buyer_name: str
    crop_name: str
    min_quantity: float
    aggregate_quantity: float
    quantity_unit: str


class FPOAggregateResponse(BaseModel):
    fpo_public_id: str
    fpo_name: str
    crop: Optional[str] = None
    by_crop: List[FPOLotAggregate] = Field(default_factory=list)
    reachable_buyers: List[FPOBuyerReachability] = Field(default_factory=list)
    note: str = ""
