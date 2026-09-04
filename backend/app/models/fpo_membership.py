"""FPO Membership — link table between an FPO and a Crop Lot.

A farmer (represented by a Crop Lot) can join an FPO. Joining means the
lot can be aggregated with the FPO's other lots for group sales.

Each (fpo, crop_lot) pair is unique — joining twice is a no-op.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Integer, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class FPOMembership(Base):
    __tablename__ = "fpo_memberships"
    __table_args__ = (UniqueConstraint("fpo_id", "crop_lot_id", name="uq_fpo_membership"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    fpo_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("fpos.id", ondelete="CASCADE"), nullable=False, index=True
    )
    crop_lot_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("crop_lots.id", ondelete="CASCADE"), nullable=False, index=True
    )

    joined_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )

    fpo: Mapped["FPO"] = relationship(  # noqa: F821
        "FPO", back_populates="memberships",
    )
    crop_lot: Mapped["CropLot"] = relationship(  # noqa: F821
        "CropLot", lazy="joined",
    )

    def __repr__(self) -> str:  # pragma: no cover - debug helper
        return f"<FPOMembership fpo={self.fpo_id} lot={self.crop_lot_id}>"
