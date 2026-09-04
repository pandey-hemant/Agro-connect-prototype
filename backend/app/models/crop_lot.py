"""ORM model for crop lots — the core farmer-side entity in AgroConnect.

A CropLot represents a single lot of produce a farmer wants to sell. It
captures the farmer-provided facts (crop, variety, quantity, location,
expected price). Quality information entered here is *farmer-provided*
and is NOT an official quality grade — that distinction will be enforced
by later phases.
"""
from __future__ import annotations

import enum
from datetime import date, datetime, timezone
from typing import Optional

from sqlalchemy import Date, DateTime, Float, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class CropLotStatus(str, enum.Enum):
    """Lifecycle states for a crop lot.

    Phase 2 only writes ``ACTIVE`` for new lots. The other values are
    reserved for later phases (selling/negotiation/deal flow) and are
    defined here so the schema is stable going forward.
    """

    DRAFT = "DRAFT"
    ACTIVE = "ACTIVE"
    SOLD = "SOLD"
    CANCELLED = "CANCELLED"


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class CropLot(Base):
    __tablename__ = "crop_lots"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    # Human-friendly, display-safe identifier. We expose this on the wire
    # instead of the numeric primary key.
    public_id: Mapped[str] = mapped_column(String(32), unique=True, index=True, nullable=False)

    # --- Required farmer inputs ---
    crop_name: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    crop_variety: Mapped[str] = mapped_column(String(120), nullable=False)
    quantity: Mapped[float] = mapped_column(Float, nullable=False)
    quantity_unit: Mapped[str] = mapped_column(String(16), nullable=False)

    # Either a future harvest date or an already-harvested date. The
    # farmer chooses via the UI; we don't enforce which.
    harvest_date: Mapped[date] = mapped_column(Date, nullable=False)

    location: Mapped[str] = mapped_column(String(255), nullable=False)

    # --- Optional / soft-required ---
    preferred_selling_radius_km: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    farmer_quality_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    minimum_acceptable_price: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    price_currency: Mapped[str] = mapped_column(String(8), nullable=False, default="INR")

    status: Mapped[str] = mapped_column(
        String(16), nullable=False, default=CropLotStatus.ACTIVE.value, index=True
    )

    # --- Audit ---
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow
    )

    def __repr__(self) -> str:  # pragma: no cover - debug helper
        return f"<CropLot {self.public_id} {self.crop_name} {self.status}>"
