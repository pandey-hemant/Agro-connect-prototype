"""Buyer model.

A buyer is a person or organisation that wants to buy produce from
farmers. Each buyer can have multiple ``BuyerRequirement`` rows (one
per crop they are interested in).

Demo buyers (seeded by the ``/buyers/seed-demo`` endpoint) are clearly
flagged with ``is_demo=True`` so the UI can render a "Demo buyer" chip.
"""
from __future__ import annotations

import enum
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Enum, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class BuyerVerification(str, enum.Enum):
    """How a buyer is verified.

    Only ``VERIFIED`` buyers should be presented to farmers as
    trustworthy counterparties. ``SELF_DECLARED`` and ``UNVERIFIED``
    are real states (an organisation has not yet been verified) but
    are not "verified".
    """

    UNVERIFIED = "UNVERIFIED"
    VERIFIED = "VERIFIED"
    SELF_DECLARED = "SELF_DECLARED"


class Buyer(Base):
    __tablename__ = "buyers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    public_id: Mapped[str] = mapped_column(String(32), unique=True, index=True, nullable=False)

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    location: Mapped[str] = mapped_column(String(255), nullable=False)
    district: Mapped[str] = mapped_column(String(120), nullable=False)
    state: Mapped[str] = mapped_column(String(120), nullable=False)
    contact_method: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    verification_status: Mapped[str] = mapped_column(
        Enum(BuyerVerification, native_enum=False, length=20),
        nullable=False,
        default=BuyerVerification.SELF_DECLARED.value,
    )
    is_demo: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )

    requirements: Mapped[list["BuyerRequirement"]] = relationship(  # noqa: F821
        "BuyerRequirement",
        back_populates="buyer",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    def __repr__(self) -> str:  # pragma: no cover - debug helper
        return f"<Buyer {self.public_id} {self.name!r} demo={self.is_demo}>"
