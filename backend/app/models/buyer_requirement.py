"""Buyer requirement model.

One row per (buyer, crop) demand. Decoupled from Buyer so a single
buyer can express interest in multiple crops with different quantity
and price ranges.
"""
from __future__ import annotations

from sqlalchemy import Boolean, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class BuyerRequirement(Base):
    __tablename__ = "buyer_requirements"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    buyer_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("buyers.id", ondelete="CASCADE"), nullable=False, index=True
    )

    crop_name: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    variety: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    min_quantity: Mapped[float] = mapped_column(Float, nullable=False)
    max_quantity: Mapped[float] = mapped_column(Float, nullable=False)
    quantity_unit: Mapped[str] = mapped_column(String(16), nullable=False, default="kg")
    min_price: Mapped[float] = mapped_column(Float, nullable=False)
    max_price: Mapped[float] = mapped_column(Float, nullable=False)
    price_currency: Mapped[str] = mapped_column(String(8), nullable=False, default="INR")
    price_unit: Mapped[str] = mapped_column(String(32), nullable=False, default="INR/kg")
    preferred_quality_grade: Mapped[str] = mapped_column(String(8), nullable=False, default="")

    is_demo: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    buyer: Mapped["Buyer"] = relationship(  # noqa: F821
        "Buyer",
        back_populates="requirements",
    )

    def __repr__(self) -> str:  # pragma: no cover - debug helper
        return (
            f"<BuyerRequirement buyer={self.buyer_id} crop={self.crop_name!r} "
            f"qty=[{self.min_quantity}-{self.max_quantity}] {self.quantity_unit}>"
        )
