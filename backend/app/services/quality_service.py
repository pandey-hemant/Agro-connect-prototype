"""Quality service.

Two flows:

1. ``declare_quality(lot_id, ...)`` — farmer records the quality of
   their lot. Creates a new row, or replaces an existing one. Marks the
   assessment as ``FARMER_DECLARED``.

2. ``verify_quality(lot_id, actor, ...)`` — a buyer/verifier confirms
   or disputes the declared quality. If the verifier agrees with the
   declared grade, status becomes ``BUYER_VERIFIED`` (or
   ``VERIFIED_ACCEPTED`` if actor=VERIFIER). If the verifier overrides
   the grade, status becomes ``DISPUTED`` and the new grade is stored.

   If a Deal exists for this lot, its ``quality_status`` is updated to
   match the assessment's status.
"""
from __future__ import annotations

import logging
from typing import Optional

from sqlalchemy.orm import Session, selectinload

from app.db.session import SessionLocal
from app.models import (
    CropLot,
    Deal,
    DeclaredBy,
    QualityAssessment,
    QualityStatus,
)

logger = logging.getLogger(__name__)


class QualityError(Exception):
    """Raised for business-rule violations (returned as 400/404)."""


def _to_read(qa: QualityAssessment) -> dict:
    return {
        "crop_lot_id": int(qa.crop_lot_id),
        "declared_grade": qa.declared_grade,
        "size": qa.size or "",
        "appearance": qa.appearance or "",
        "moisture_pct": float(qa.moisture_pct) if qa.moisture_pct is not None else None,
        "defects_pct": float(qa.defects_pct) if qa.defects_pct is not None else None,
        "notes": qa.notes or "",
        "declared_by": qa.declared_by,
        "quality_status": qa.quality_status,
        "declared_at": qa.declared_at,
        "updated_at": qa.updated_at,
    }


def get_quality(crop_lot_id: int) -> Optional[QualityAssessment]:
    db: Session = SessionLocal()
    try:
        row = (
            db.query(QualityAssessment)
            .options(selectinload(QualityAssessment.crop_lot))
            .filter(QualityAssessment.crop_lot_id == crop_lot_id)
            .one_or_none()
        )
        if row is not None:
            db.expunge(row)
        return row
    finally:
        db.close()


def declare_quality(
    crop_lot_id: int,
    *,
    grade: str,
    size: str = "",
    appearance: str = "",
    moisture_pct: Optional[float] = None,
    defects_pct: Optional[float] = None,
    notes: str = "",
) -> QualityAssessment:
    """Create or replace the farmer-declared quality assessment."""
    db: Session = SessionLocal()
    try:
        lot = db.get(CropLot, crop_lot_id)
        if lot is None:
            raise QualityError(f"Crop lot {crop_lot_id} not found")

        existing = (
            db.query(QualityAssessment)
            .filter(QualityAssessment.crop_lot_id == crop_lot_id)
            .one_or_none()
        )
        if existing is not None:
            existing.declared_grade = grade
            existing.size = size or ""
            existing.appearance = appearance or ""
            existing.moisture_pct = moisture_pct
            existing.defects_pct = defects_pct
            existing.notes = notes or ""
            existing.declared_by = DeclaredBy.FARMER.value
            # If a verifier had already approved, do NOT reset to FARMER_DECLARED.
            # Keep the existing quality_status (BUYER_VERIFIED /
            # VERIFIED_ACCEPTED). The farmer's edit is recorded but does
            # not undo an existing verification.
            if existing.quality_status not in {
                QualityStatus.BUYER_VERIFIED.value,
                QualityStatus.VERIFIED_ACCEPTED.value,
            }:
                existing.quality_status = QualityStatus.FARMER_DECLARED.value
            qa = existing
        else:
            qa = QualityAssessment(
                crop_lot_id=lot.id,
                declared_grade=grade,
                size=size or "",
                appearance=appearance or "",
                moisture_pct=moisture_pct,
                defects_pct=defects_pct,
                notes=notes or "",
                declared_by=DeclaredBy.FARMER.value,
                quality_status=QualityStatus.FARMER_DECLARED.value,
            )
            db.add(qa)

        db.commit()
        db.refresh(qa)
        # refresh relationships
        qa = (
            db.query(QualityAssessment)
            .options(selectinload(QualityAssessment.crop_lot))
            .filter(QualityAssessment.id == qa.id)
            .one()
        )
        return qa
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def verify_quality(
    crop_lot_id: int,
    *,
    actor: str,
    grade: Optional[str] = None,
    defects_pct: Optional[float] = None,
    notes: str = "",
) -> QualityAssessment:
    """A buyer/verifier confirms or disputes the declared quality.

    State transitions:
    - FARMER_DECLARED + grade==declared (or no grade override) +
      actor=BUYER  -> BUYER_VERIFIED
    - FARMER_DECLARED + actor=VERIFIER -> VERIFIED_ACCEPTED
    - grade override differs from declared -> DISPUTED
    - DISPUTED + verifier override agreeing with declaration ->
      VERIFIED_ACCEPTED
    """
    actor = (actor or "").strip().upper()
    if actor not in ("BUYER", "VERIFIER"):
        raise QualityError("actor must be BUYER or VERIFIER")

    db: Session = SessionLocal()
    try:
        qa = (
            db.query(QualityAssessment)
            .options(selectinload(QualityAssessment.crop_lot))
            .filter(QualityAssessment.crop_lot_id == crop_lot_id)
            .one_or_none()
        )
        if qa is None:
            raise QualityError(
                f"No quality assessment for lot {crop_lot_id}; "
                "declare one first."
            )

        # Determine the new grade and status
        new_grade = qa.declared_grade
        if grade is not None and grade != qa.declared_grade:
            new_grade = grade  # verifier is overriding

        if grade is not None and grade != qa.declared_grade:
            # Disputed: grade override differs from the farmer's claim
            new_status = QualityStatus.DISPUTED.value
        elif actor == "VERIFIER":
            new_status = QualityStatus.VERIFIED_ACCEPTED.value
        else:
            new_status = QualityStatus.BUYER_VERIFIED.value

        qa.declared_grade = new_grade
        qa.declared_by = DeclaredBy.BUYER.value if actor == "BUYER" else DeclaredBy.VERIFIER.value
        qa.quality_status = new_status
        if defects_pct is not None:
            qa.defects_pct = defects_pct
        if notes:
            qa.notes = (qa.notes + "\n" + notes).strip() if qa.notes else notes

        # Update the linked deal, if any
        deal = (
            db.query(Deal)
            .filter(Deal.crop_lot_id == qa.crop_lot_id)
            .one_or_none()
        )
        if deal is not None:
            if new_status == QualityStatus.VERIFIED_ACCEPTED.value:
                deal.quality_status = "VERIFIED"
            elif new_status == QualityStatus.BUYER_VERIFIED.value:
                deal.quality_status = "VERIFIED"
            elif new_status == QualityStatus.DISPUTED.value:
                deal.quality_status = "DISPUTED"
            else:
                deal.quality_status = "PENDING"

        db.commit()
        db.refresh(qa)
        qa = (
            db.query(QualityAssessment)
            .options(selectinload(QualityAssessment.crop_lot))
            .filter(QualityAssessment.id == qa.id)
            .one()
        )
        return qa
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


# ---- response shaping -----------------------------------------------------

def quality_to_read(qa: QualityAssessment) -> dict:
    return _to_read(qa)
