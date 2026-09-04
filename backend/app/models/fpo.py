"""FPO (Farmer Producer Organisation) model.

A group / co-operative of farmers. FPOs let many small lots be aggregated
to reach buyer ``min_quantity`` thresholds that a single lot cannot.

Demo FPOs (seeded by the ``/fpos/seed-demo`` endpoint) are clearly
flagged with ``is_demo=True`` so the UI can render a "Demo FPO" chip.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class FPO(Base):
    __tablename__ = "fpos"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    public_id: Mapped[str] = mapped_column(String(32), unique=True, index=True, nullable=False)

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    location: Mapped[str] = mapped_column(String(255), nullable=False)
    district: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    state: Mapped[str] = mapped_column(String(120), nullable=False, default="")

    is_demo: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow
    )

    memberships: Mapped[list["FPOMembership"]] = relationship(  # noqa: F821
        "FPOMembership",
        back_populates="fpo",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    def __repr__(self) -> str:  # pragma: no cover - debug helper
        return f"<FPO {self.public_id} {self.name!r} demo={self.is_demo}>"
