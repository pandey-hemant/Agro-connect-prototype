"""Deal model.

A Deal is the *committed* agreement between a farmer and a buyer. It
is created when an Offer is accepted (see ``app.services.offer_service``).
The Deal keeps its own status fields so the negotiation history is
preserved and the deal can move forward independently of the offer.

Delivery / payment status fields are written by Module H; they are
defined here so the schema is stable across modules.
"""
from __future__ import annotations

import enum
from datetime import datetime, timezone

from sqlalchemy import DateTime, Enum, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class DealQualityStatus(str, enum.Enum):
    PENDING = "PENDING"
    VERIFIED = "VERIFIED"
    ACCEPTED = "ACCEPTED"
    DISPUTED = "DISPUTED"


class DealLogisticsStatus(str, enum.Enum):
    NOT_STARTED = "NOT_STARTED"
    PLANNED = "PLANNED"
    IN_TRANSIT = "IN_TRANSIT"
    DELIVERED = "DELIVERED"


class DealDeliveryStatus(str, enum.Enum):
    PENDING = "PENDING"
    PREPARING = "PREPARING"
    IN_TRANSIT = "IN_TRANSIT"
    DELIVERED = "DELIVERED"
    COMPLETED = "COMPLETED"


class DealPaymentStatus(str, enum.Enum):
    PENDING = "PENDING"
    PARTIAL = "PARTIAL"
    PAID = "PAID"


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Deal(Base):
    __tablename__ = "deals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    public_id: Mapped[str] = mapped_column(String(32), unique=True, index=True, nullable=False)

    crop_lot_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("crop_lots.id", ondelete="CASCADE"), nullable=False, index=True
    )
    buyer_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("buyers.id", ondelete="CASCADE"), nullable=False, index=True
    )
    offer_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("offers.id", ondelete="CASCADE"), nullable=False, index=True
    )

    agreed_price: Mapped[float] = mapped_column(Float, nullable=False)
    agreed_quantity: Mapped[float] = mapped_column(Float, nullable=False)
    total_value: Mapped[float] = mapped_column(Float, nullable=False)
    currency: Mapped[str] = mapped_column(String(8), nullable=False, default="INR")

    quality_status: Mapped[str] = mapped_column(
        Enum(DealQualityStatus, native_enum=False, length=16),
        nullable=False, default=DealQualityStatus.PENDING.value,
    )
    logistics_status: Mapped[str] = mapped_column(
        Enum(DealLogisticsStatus, native_enum=False, length=16),
        nullable=False, default=DealLogisticsStatus.NOT_STARTED.value,
    )
    delivery_status: Mapped[str] = mapped_column(
        Enum(DealDeliveryStatus, native_enum=False, length=16),
        nullable=False, default=DealDeliveryStatus.PENDING.value,
    )
    payment_status: Mapped[str] = mapped_column(
        Enum(DealPaymentStatus, native_enum=False, length=16),
        nullable=False, default=DealPaymentStatus.PENDING.value,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow
    )

    def __repr__(self) -> str:  # pragma: no cover - debug helper
        return (
            f"<Deal {self.public_id} lot={self.crop_lot_id} buyer={self.buyer_id} "
            f"delivery={self.delivery_status}>"
        )
