"""Logistics estimate model.

A row records one logistics calculation for a (Crop Lot, destination
market) pair. All numeric fields are clearly estimates — never live road
data unless a routing API is configured and reachable.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class LogisticsEstimate(Base):
    __tablename__ = "logistics_estimates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    crop_lot_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("crop_lots.id", ondelete="CASCADE"), nullable=False, index=True
    )

    destination_label: Mapped[str] = mapped_column(String(255), nullable=False)
    destination_market: Mapped[str] = mapped_column(String(255), nullable=False)
    vehicle_type: Mapped[str] = mapped_column(String(64), nullable=False, default="mini-truck")

    # All in INR; distances in km; always an estimate unless a live
    # routing API succeeded at the time of calculation.
    distance_km: Mapped[float] = mapped_column(Float, nullable=False)
    transport_cost: Mapped[float] = mapped_column(Float, nullable=False)
    loading_cost: Mapped[float] = mapped_column(Float, nullable=False)
    unloading_cost: Mapped[float] = mapped_column(Float, nullable=False)
    other_charges: Mapped[float] = mapped_column(Float, nullable=False)
    total_logistics_cost: Mapped[float] = mapped_column(Float, nullable=False)

    gross_value: Mapped[float] = mapped_column(Float, nullable=False)
    net_realisation: Mapped[float] = mapped_column(Float, nullable=False)
    modal_price_per_kg: Mapped[float] = mapped_column(Float, nullable=False)
    price_source: Mapped[str] = mapped_column(String(64), nullable=False, default="demo")
    is_live_price: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    is_estimate: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )

    def __repr__(self) -> str:  # pragma: no cover - debug helper
        return (
            f"<LogisticsEstimate lot={self.crop_lot_id} "
            f"to={self.destination_market!r} net={self.net_realisation:.2f}>"
        )
