"""Farmer decision model.

One row per Crop Lot. The decision is recomputed on demand (and on
explicit ``/refresh`` calls) — it is a derived view over the lot, market
prices, logistics estimates, and FPO memberships.

NEVER a price prediction: the recommendation is purely a deterministic
function of the data we already have.
"""
from __future__ import annotations

import enum
from datetime import datetime, timezone

from sqlalchemy import JSON, Boolean, DateTime, Enum, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class FarmerDecisionType(str, enum.Enum):
    """What to tell the farmer to do. Rules-based, never a price prediction."""

    SELL_NOW = "SELL_NOW"        # one market clearly dominates
    WAIT = "WAIT"                # current data does not favour waiting
    GROUP_SALE = "GROUP_SALE"    # an FPO aggregate unlocks a buyer


class FarmerDecision(Base):
    __tablename__ = "farmer_decisions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    crop_lot_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("crop_lots.id", ondelete="CASCADE"),
        nullable=False, unique=True, index=True,
    )

    recommendation: Mapped[str] = mapped_column(
        Enum(FarmerDecisionType, native_enum=False, length=16),
        nullable=False,
    )
    reason: Mapped[str] = mapped_column(String(1000), nullable=False)
    insufficient_data: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_estimate: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    # JSON blob: the per-market comparison the decision was based on.
    comparison_json: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow
    )

    def __repr__(self) -> str:  # pragma: no cover - debug helper
        return (
            f"<FarmerDecision lot={self.crop_lot_id} "
            f"rec={self.recommendation} insufficient={self.insufficient_data}>"
        )
