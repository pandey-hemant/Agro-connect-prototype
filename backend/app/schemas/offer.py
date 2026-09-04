"""Pydantic schemas for offers and negotiation."""
from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.buyer import BuyerRead


class OfferCreate(BaseModel):
    """Body for POST /api/offers — the first turn in a thread."""

    crop_lot_id: int = Field(..., gt=0, description="Crop Lot to sell.")
    buyer_id: int = Field(..., gt=0, description="Buyer to sell to.")
    price: float = Field(..., gt=0, description="Offered price (per the lot's currency).")
    quantity: float = Field(..., gt=0, description="Offered quantity (in the lot's unit).")
    message: Optional[str] = Field(default=None, max_length=2000)


class OfferCounter(BaseModel):
    """Body for POST /api/offers/{id}/counter."""

    actor: str = Field(..., description="FARMER or BUYER")
    price: float = Field(..., gt=0)
    quantity: float = Field(..., gt=0)
    message: Optional[str] = Field(default=None, max_length=2000)


class OfferActorBody(BaseModel):
    """Body for POST /api/offers/{id}/accept or /reject."""

    actor: str = Field(..., description="FARMER or BUYER")
    reason: Optional[str] = Field(default=None, max_length=2000)


class OfferMessageRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    actor: str
    action: str
    price: Optional[float] = None
    quantity: Optional[float] = None
    message: Optional[str] = None
    created_at: datetime


class OfferRead(BaseModel):
    """A single offer with its message history."""

    model_config = ConfigDict(from_attributes=True)

    public_id: str
    crop_lot_id: int
    buyer: BuyerRead
    status: str
    current_price: float
    current_quantity: float
    currency: str
    created_at: datetime
    updated_at: datetime
    messages: List[OfferMessageRead] = Field(default_factory=list)


class OfferListResponse(BaseModel):
    """Envelope for GET /api/offers?crop_lot_id=..."""

    crop_lot_id: int
    count: int
    results: List[OfferRead]


class OfferCreateResponse(BaseModel):
    """Response for POST /api/offers — includes the freshly-minted public_id."""

    offer: OfferRead
    public_id: str


class DealRead(BaseModel):
    """Deal summary returned when an offer is accepted."""

    model_config = ConfigDict(from_attributes=True)

    public_id: str
    crop_lot_id: int
    buyer_id: int
    offer_id: int
    agreed_price: float
    agreed_quantity: float
    total_value: float
    currency: str
    quality_status: str
    logistics_status: str
    delivery_status: str
    payment_status: str
    created_at: datetime
    updated_at: datetime


class OfferAcceptResponse(BaseModel):
    offer: OfferRead
    deal: DealRead
    crop_lot_status: str
