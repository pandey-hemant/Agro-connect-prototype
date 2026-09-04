"""Idempotent demo seeders for buyers and FPOs.

The seeders:

* Mark every record with ``is_demo=True`` so the UI can render a
  "Demo buyer" / "Demo FPO" chip.
* Check the table first; if rows already exist (from a previous seed),
  they are NOT re-inserted. The endpoint always reports how many were
  inserted vs skipped.
* Never modify real rows. If the table is non-empty for any reason,
  the seeder is a no-op.

The crop list is aligned with the demo market-price provider so the
matcher has something useful to match against.
"""
from __future__ import annotations

import logging
import uuid
from typing import Dict, List, Tuple

from app.db.session import SessionLocal
from app.models.buyer import Buyer, BuyerVerification
from app.models.buyer_requirement import BuyerRequirement

logger = logging.getLogger(__name__)


# (name, district, state, contact, verification, [(crop, variety,
#   min_qty, max_qty, unit, min_price, max_price, price_unit, grade), ...])
_DEMO_BUYERS: List[Tuple[str, str, str, str, str, List[Tuple]]] = [
    (
        "[DEMO] FreshHarvest Pvt Ltd",
        "North Delhi", "Delhi",
        "buy@freshharvest.example",
        BuyerVerification.VERIFIED.value,
        [
            ("tomato", "hybrid", 100, 1000, "kg", 15, 25, "INR/kg", "A"),
            ("potato", "",      200, 2000, "kg",  9, 14, "INR/kg", ""),
        ],
    ),
    (
        "[DEMO] SpiceRoute Foods",
        "Nashik", "Maharashtra",
        "contact@spiceroute.example",
        BuyerVerification.VERIFIED.value,
        [
            ("onion",  "",       500, 5000, "kg",  18, 28, "INR/kg", "B"),
            ("tomato", "hybrid", 200, 2000, "kg",  16, 24, "INR/kg", "A"),
        ],
    ),
    (
        "[DEMO] Punjab Agro Trading",
        "Ludhiana", "Punjab",
        "trade@punjabagro.example",
        BuyerVerification.SELF_DECLARED.value,
        [
            ("wheat",  "",       50,  500, "quintal", 2200, 2500, "INR/quintal", "A"),
            ("rice",   "basmati",100, 1000, "quintal", 2800, 3300, "INR/quintal", "A"),
        ],
    ),
    (
        "[DEMO] Karnal Mandi Aggregator",
        "Karnal", "Haryana",
        "call: +91-00000-00000",
        BuyerVerification.UNVERIFIED.value,
        [
            ("rice",   "",       50,  800, "quintal", 2700, 3200, "INR/quintal", ""),
            ("wheat",  "",       50,  500, "quintal", 2200, 2500, "INR/quintal", "B"),
        ],
    ),
    (
        "[DEMO] Karnataka State Co-op",
        "Davangere", "Karnataka",
        "coop@karnatakasc.example",
        BuyerVerification.VERIFIED.value,
        [
            ("maize",  "",       100, 1500, "kg", 19, 24, "INR/kg", "B"),
            ("soybean","",       100, 1500, "kg", 42, 48, "INR/kg", "A"),
        ],
    ),
    (
        "[DEMO] Gujarat Cotton Exporters",
        "Rajkot", "Gujarat",
        "export@gujcotton.example",
        BuyerVerification.SELF_DECLARED.value,
        [
            ("cotton",    "",  100, 3000, "quintal", 6500, 7500, "INR/quintal", "A"),
            ("groundnut","",  100, 2000, "quintal", 5500, 6200, "INR/quintal", "B"),
        ],
    ),
]


def seed_demo_buyers() -> Dict[str, object]:
    """Idempotently seed demo buyers + requirements.

    Returns a dict with keys ``inserted``, ``skipped``, ``total_after``,
    and ``public_ids`` (list of public_id strings of the inserted buyers
    — empty when the seeder is a no-op).
    """
    db = SessionLocal()
    try:
        existing = db.query(Buyer).count()
        if existing > 0:
            logger.info("seed_demo_buyers: %d buyers already present, skipping", existing)
            return {
                "inserted": 0,
                "skipped": existing,
                "total_after": existing,
                "public_ids": [],
            }

        inserted = 0
        public_ids: List[str] = []
        for (
            name, district, state, contact, verification, reqs,
        ) in _DEMO_BUYERS:
            pub = uuid.uuid4().hex[:16]
            buyer = Buyer(
                public_id=pub,
                name=name,
                location=f"{district}, {state}",
                district=district,
                state=state,
                contact_method=contact,
                verification_status=verification,
                is_demo=True,
            )
            db.add(buyer)
            db.flush()  # populate buyer.id

            for (
                crop, variety, min_q, max_q, unit,
                min_p, max_p, price_unit, grade,
            ) in reqs:
                db.add(BuyerRequirement(
                    buyer_id=buyer.id,
                    crop_name=crop,
                    variety=variety,
                    min_quantity=min_q,
                    max_quantity=max_q,
                    quantity_unit=unit,
                    min_price=min_p,
                    max_price=max_p,
                    price_currency="INR",
                    price_unit=price_unit,
                    preferred_quality_grade=grade,
                    is_demo=True,
                ))
            inserted += 1
            public_ids.append(pub)

        db.commit()
        total = db.query(Buyer).count()
        logger.info("seed_demo_buyers: inserted %d buyers, total now %d", inserted, total)
        return {
            "inserted": inserted,
            "skipped": 0,
            "total_after": total,
            "public_ids": public_ids,
        }
    finally:
        db.close()
