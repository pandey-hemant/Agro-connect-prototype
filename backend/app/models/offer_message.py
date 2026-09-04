"""Offer message — a single turn in the negotiation thread.

We keep the full history so the farmer and buyer can see exactly what
was offered, countered, accepted, rejected, or noted.
"""
from __future__ import annotations

import enum
from datetime import datetime, timezone

from sqlalchemy import DateTime, Enum, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class OfferActor(str, enum.Enum):
    FARMER = "FARMER"
    BUYER = "BUYER"
    SYSTEM = "SYSTEM"


class OfferAction(str, enum.Enum):
    OFFER = "OFFER"
    COUNTER = "COUNTER"
    ACCEPT = "ACCEPT"
    REJECT = "REJECT"
    NOTE = "NOTE"


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class OfferMessage(Base):
    __tablename__ = "offer_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    offer_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("offers.id", ondelete="CASCADE"), nullable=False, index=True
    )

    actor: Mapped[str] = mapped_column(
        Enum(OfferActor, native_enum=False, length=10), nullable=False
    )
    action: Mapped[str] = mapped_column(
        Enum(OfferAction, native_enum=False, length=10), nullable=False
    )
    price: Mapped[float | None] = mapped_column(Float, nullable=True)
    quantity: Mapped[float | None] = mapped_column(Float, nullable=True)
    message: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )

    offer: Mapped["Offer"] = relationship(  # noqa: F821
        "Offer", back_populates="messages"
    )

    def __repr__(self) -> str:  # pragma: no cover - debug helper
        return (
            f"<OfferMessage offer={self.offer_id} {self.actor}/{self.action} "
            f"price={self.price}>"
        )
