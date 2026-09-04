"""Offer model.

A negotiation thread between a farmer (represented by a Crop Lot) and a
buyer. The offer holds the *current* (latest) price/quantity; the full
trail of price/quantity changes is in ``OfferMessage``.
"""
from __future__ import annotations

import enum
from datetime import datetime, timezone

from sqlalchemy import DateTime, Enum, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class OfferStatus(str, enum.Enum):
    OPEN = "OPEN"
    ACCEPTED = "ACCEPTED"
    REJECTED = "REJECTED"
    COUNTERED = "COUNTERED"
    FINALIZED = "FINALIZED"
    CANCELLED = "CANCELLED"


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Offer(Base):
    __tablename__ = "offers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    public_id: Mapped[str] = mapped_column(String(32), unique=True, index=True, nullable=False)

    crop_lot_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("crop_lots.id", ondelete="CASCADE"), nullable=False, index=True
    )
    buyer_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("buyers.id", ondelete="CASCADE"), nullable=False, index=True
    )

    status: Mapped[str] = mapped_column(
        Enum(OfferStatus, native_enum=False, length=16),
        nullable=False, default=OfferStatus.OPEN.value, index=True,
    )
    current_price: Mapped[float] = mapped_column(Float, nullable=False)
    current_quantity: Mapped[float] = mapped_column(Float, nullable=False)
    currency: Mapped[str] = mapped_column(String(8), nullable=False, default="INR")

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow
    )

    messages: Mapped[list["OfferMessage"]] = relationship(  # noqa: F821
        "OfferMessage",
        back_populates="offer",
        cascade="all, delete-orphan",
        order_by="OfferMessage.created_at",
        lazy="selectin",
    )

    buyer: Mapped["Buyer"] = relationship(  # noqa: F821
        "Buyer",
        lazy="joined",
    )

    def __repr__(self) -> str:  # pragma: no cover - debug helper
        return (
            f"<Offer {self.public_id} lot={self.crop_lot_id} buyer={self.buyer_id} "
            f"status={self.status}>"
        )
