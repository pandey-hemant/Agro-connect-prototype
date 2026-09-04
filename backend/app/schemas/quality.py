"""Pydantic schemas for the Quality assessment flow."""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator


class QualityDeclare(BaseModel):
    """Farmer declares the quality of a Crop Lot."""

    grade: str = Field(..., description="One of A, B, C, UNGRADED.")
    size: str = Field(default="", max_length=64)
    appearance: str = Field(default="", max_length=255)
    moisture_pct: Optional[float] = Field(default=None, ge=0, le=100)
    defects_pct: Optional[float] = Field(default=None, ge=0, le=100)
    notes: str = Field(default="", max_length=2000)

    @field_validator("grade")
    @classmethod
    def _grade_upper(cls, v: str) -> str:
        v = (v or "").strip().upper()
        if v not in ("A", "B", "C", "UNGRADED"):
            raise ValueError("grade must be one of A, B, C, UNGRADED")
        return v


class QualityVerify(BaseModel):
    """A buyer/verifier confirms (or disputes) the declared quality."""

    actor: str = Field(..., description="BUYER or VERIFIER")
    grade: Optional[str] = Field(default=None, description="Override grade (optional).")
    defects_pct: Optional[float] = Field(default=None, ge=0, le=100)
    notes: str = Field(default="", max_length=2000)

    @field_validator("actor")
    @classmethod
    def _actor_upper(cls, v: str) -> str:
        v = (v or "").strip().upper()
        if v not in ("BUYER", "VERIFIER"):
            raise ValueError("actor must be BUYER or VERIFIER")
        return v

    @field_validator("grade")
    @classmethod
    def _grade_upper(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        v2 = v.strip().upper()
        if v2 not in ("A", "B", "C", "UNGRADED"):
            raise ValueError("grade must be one of A, B, C, UNGRADED")
        return v2


class QualityAssessmentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    crop_lot_id: int
    declared_grade: str
    size: str
    appearance: str
    moisture_pct: Optional[float]
    defects_pct: Optional[float]
    notes: str
    declared_by: str
    quality_status: str
    declared_at: datetime
    updated_at: datetime
