"""Quality assessment for a Crop Lot.

Each Crop Lot has at most one QualityAssessment row. It records the
*declared* grade and supporting notes.

The ``quality_status`` field evolves as different parties see it:
- ``FARMER_DECLARED`` — first time the farmer records the assessment
- ``BUYER_VERIFIED`` — a buyer has seen the lot and confirmed grade
- ``VERIFIED_ACCEPTED`` — a verifier (e.g. FPO/aggregator) has confirmed
- ``DISPUTED`` — a buyer/verifier disagrees with the declared grade
"""
from __future__ import annotations

import enum
from datetime import datetime, timezone

from sqlalchemy import (
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class QualityGrade(str, enum.Enum):
    A = "A"
    B = "B"
    C = "C"
    UNGRADED = "UNGRADED"


class QualityStatus(str, enum.Enum):
    FARMER_DECLARED = "FARMER_DECLARED"
    BUYER_VERIFIED = "BUYER_VERIFIED"
    VERIFIED_ACCEPTED = "VERIFIED_ACCEPTED"
    DISPUTED = "DISPUTED"


class DeclaredBy(str, enum.Enum):
    FARMER = "FARMER"
    BUYER = "BUYER"
    VERIFIER = "VERIFIER"


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class QualityAssessment(Base):
    __tablename__ = "quality_assessments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)

    crop_lot_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("crop_lots.id", ondelete="CASCADE"),
        unique=True,  # at most one per lot
        index=True,
        nullable=False,
    )

    declared_grade: Mapped[str] = mapped_column(
        Enum(QualityGrade, native_enum=False, length=12),
        nullable=False, default=QualityGrade.UNGRADED.value,
    )
    size: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    appearance: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    moisture_pct: Mapped[float] = mapped_column(Float, nullable=True)
    defects_pct: Mapped[float] = mapped_column(Float, nullable=True)
    notes: Mapped[str] = mapped_column(Text, nullable=False, default="")

    declared_by: Mapped[str] = mapped_column(
        Enum(DeclaredBy, native_enum=False, length=12),
        nullable=False, default=DeclaredBy.FARMER.value,
    )
    quality_status: Mapped[str] = mapped_column(
        Enum(QualityStatus, native_enum=False, length=20),
        nullable=False, default=QualityStatus.FARMER_DECLARED.value, index=True,
    )

    declared_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utcnow, onupdate=_utcnow,
    )

    crop_lot: Mapped["CropLot"] = relationship(  # noqa: F821
        "CropLot", lazy="joined",
    )

    def __repr__(self) -> str:  # pragma: no cover - debug helper
        return (
            f"<QualityAssessment lot={self.crop_lot_id} "
            f"grade={self.declared_grade} status={self.quality_status}>"
        )
