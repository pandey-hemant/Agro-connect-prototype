"""Phase 4 Module G — Quality — regression battery.

Exercises:
- declare quality (creates row, FARMER_DECLARED)
- re-declare (replaces, but does NOT downgrade BUYER_VERIFIED/VERIFIED_ACCEPTED)
- get quality (404 if none, 200 if present)
- verify (BUYER -> BUYER_VERIFIED, VERIFIER -> VERIFIED_ACCEPTED)
- verify with grade override -> DISPUTED
- verify with grade matching again from DISPUTED -> VERIFIED_ACCEPTED
- linked Deal.quality_status is updated by the verify flow
- earlier modules still 200
"""
from __future__ import annotations

import json
import os
import socket
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid
from datetime import date
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent
os.chdir(BACKEND_DIR)
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

for _k in ("AGROCONNECT_DB", "DATABASE_URL"):
    os.environ.pop(_k, None)

import uvicorn  # noqa: E402

from app.db.base import Base  # noqa: E402
from app.db.session import SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models import CropLot, Deal  # noqa: E402
from app.services.seed_demo import seed_demo_buyers  # noqa: E402

OK = "\033[92mOK\033[0m"
FAIL = "\033[91mFAIL\033[0m"
errors: list[str] = []


def check(label: str, condition: bool, detail: str = "") -> None:
    status = OK if condition else FAIL
    suffix = f" -- {detail}" if detail else ""
    print(f"[{status}] {label}{suffix}")
    if not condition:
        errors.append(label + (f" :: {detail}" if detail else ""))


def reset_db() -> None:
    db_path = BACKEND_DIR / "agroconnect.db"
    if db_path.exists():
        try:
            db_path.unlink()
        except PermissionError:
            pass
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)


def find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def wait_ready(base: str, timeout: float = 25.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(base + "/api/health", timeout=1.0) as r:
                if r.status == 200:
                    return True
        except (urllib.error.URLError, ConnectionError, OSError):
            time.sleep(0.2)
    return False


def http(base: str, method: str, path: str, body: dict | None = None) -> tuple[int, dict]:
    url = base + path
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={"Content-Type": "application/json"} if data else {},
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            raw = r.read().decode("utf-8") or "{}"
            return r.status, json.loads(raw) if raw.strip() else {}
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8") or "{}"
        try:
            return e.code, json.loads(raw)
        except json.JSONDecodeError:
            return e.code, {"raw": raw}


def _seed_lot_and_buyer() -> tuple[int, int]:
    """Seed buyers + create a Crop Lot; return (lot_id, buyer_id)."""
    seed_demo_buyers()
    db = SessionLocal()
    try:
        lot = CropLot(
            public_id="CL-" + uuid.uuid4().hex[:12].upper(),
            crop_name="Tomato",
            crop_variety="Hybrid",
            quantity=500.0,
            quantity_unit="kg",
            harvest_date=date.today(),
            location="Patna, Bihar",
        )
        db.add(lot)
        db.commit()
        db.refresh(lot)
        lot_id = int(lot.id)

        from app.models import Buyer
        tomato_buyer = (
            db.query(Buyer)
            .filter(Buyer.name.like("%FreshHarvest%"))
            .one_or_none()
        )
        if tomato_buyer is None:
            raise RuntimeError("no tomato buyer found in demo seed")
        return lot_id, int(tomato_buyer.id)
    finally:
        db.close()


def main() -> int:
    print("\n=== Phase 4 Module G — Quality ===\n")
    reset_db()

    routes = {r.path for r in app.routes if hasattr(r, "path")}
    for needle in (
        "/api/quality/{crop_lot_id}",
        "/api/quality/{crop_lot_id}/verify",
    ):
        check(f"Route present: {needle}", any(needle in p for p in routes))

    lot_id, buyer_id = _seed_lot_and_buyer()
    check("Lot + buyer ready", lot_id > 0 and buyer_id > 0,
          f"lot_id={lot_id} buyer_id={buyer_id}")

    # 1) Boot uvicorn -------------------------------------------------------
    port = find_free_port()
    config = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning")
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{port}"
    if not wait_ready(base, timeout=25.0):
        print("server failed to start")
        return 1

    try:
        # 2) GET quality before declaration -> 404 -------------------------
        status, _ = http(base, "GET", f"/api/quality/{lot_id}")
        check("GET quality (no assessment) 404", status == 404, f"status={status}")

        # 3) POST declare --------------------------------------------------
        status, body = http(base, "POST", f"/api/quality/{lot_id}", {
            "grade": "A",
            "size": "Medium",
            "appearance": "Bright red, firm",
            "moisture_pct": 88.0,
            "defects_pct": 2.5,
            "notes": "Hand-picked, no bruising.",
        })
        check("POST declare 200", status == 200, str(body)[:200])
        check("quality_status=FARMER_DECLARED",
              body.get("quality_status") == "FARMER_DECLARED",
              f"status={body.get('quality_status')}")
        check("declared_grade=A", body.get("declared_grade") == "A")
        check("declared_by=FARMER", body.get("declared_by") == "FARMER")

        # 4) GET quality -> 200 --------------------------------------------
        status, body = http(base, "GET", f"/api/quality/{lot_id}")
        check("GET quality 200", status == 200, str(body)[:200])

        # 5) Bad grade rejected -------------------------------------------
        status, _ = http(base, "POST", f"/api/quality/{lot_id}", {
            "grade": "Z",
        })
        check("Bad grade 4xx", status in (400, 422), f"status={status}")

        # 6) Bad verify actor rejected (schema validation) ---------------
        status, _ = http(base, "POST", f"/api/quality/{lot_id}/verify", {
            "actor": "ROBOT",
        })
        check("Bad verify actor 4xx", status in (400, 422), f"status={status}")

        # 7) Verify without prior assessment (separate lot) ----------------
        # Create a second lot with no quality
        db = SessionLocal()
        try:
            lot2 = CropLot(
                public_id="CL-" + uuid.uuid4().hex[:12].upper(),
                crop_name="Onion", crop_variety="Red",
                quantity=300.0, quantity_unit="kg",
                harvest_date=date.today(),
                location="Lucknow, UP",
            )
            db.add(lot2); db.commit(); db.refresh(lot2)
            lot2_id = int(lot2.id)
        finally:
            db.close()
        status, _ = http(base, "POST", f"/api/quality/{lot2_id}/verify", {
            "actor": "BUYER",
        })
        check("Verify without assessment 400", status == 400, f"status={status}")

        # 8) Verify as BUYER -> BUYER_VERIFIED ----------------------------
        status, body = http(base, "POST", f"/api/quality/{lot_id}/verify", {
            "actor": "BUYER",
            "notes": "Buyer saw the lot; agrees grade A.",
        })
        check("Verify BUYER 200", status == 200, str(body)[:200])
        check("quality_status=BUYER_VERIFIED",
              body.get("quality_status") == "BUYER_VERIFIED",
              f"status={body.get('quality_status')}")
        check("declared_by=BUYER", body.get("declared_by") == "BUYER")

        # 9) Re-declare must NOT downgrade verified status ----------------
        status, body = http(base, "POST", f"/api/quality/{lot_id}", {
            "grade": "A",
            "size": "Medium",
            "appearance": "Bright red, firm",
            "notes": "Farmer added more notes after sale.",
        })
        check("Re-declare 200", status == 200, str(body)[:200])
        check("Re-declare keeps BUYER_VERIFIED",
              body.get("quality_status") == "BUYER_VERIFIED",
              f"status={body.get('quality_status')}")

        # 10) Verify as VERIFIER (same grade) -> VERIFIED_ACCEPTED ---------
        status, body = http(base, "POST", f"/api/quality/{lot_id}/verify", {
            "actor": "VERIFIER",
        })
        check("Verify VERIFIER 200", status == 200, str(body)[:200])
        check("quality_status=VERIFIED_ACCEPTED",
              body.get("quality_status") == "VERIFIED_ACCEPTED",
              f"status={body.get('quality_status')}")
        check("declared_by=VERIFIER",
              body.get("declared_by") == "VERIFIER",
              f"declared_by={body.get('declared_by')}")

        # 11) Verify with grade override -> DISPUTED ----------------------
        status, body = http(base, "POST", f"/api/quality/{lot_id}/verify", {
            "actor": "BUYER",
            "grade": "B",
            "notes": "Quality looks lower than declared.",
        })
        check("Verify override 200", status == 200, str(body)[:200])
        check("quality_status=DISPUTED",
              body.get("quality_status") == "DISPUTED",
              f"status={body.get('quality_status')}")
        check("declared_grade=B",
              body.get("declared_grade") == "B",
              f"declared_grade={body.get('declared_grade')}")

        # 12) Verify as VERIFIER with no grade override from DISPUTED ------
        # Since the current grade is B (the override), no override is needed
        # to "agree" — but our logic currently compares the incoming grade
        # to the existing declared_grade. The intent is that an additional
        # verifier passing through without changing the grade does NOT
        # dispute. The flow says: if grade is None OR matches declared,
        # then status is BUYER_VERIFIED or VERIFIED_ACCEPTED.
        status, body = http(base, "POST", f"/api/quality/{lot_id}/verify", {
            "actor": "VERIFIER",
        })
        check("Verify VERIFIER again 200", status == 200, str(body)[:200])
        check("quality_status=VERIFIED_ACCEPTED (re-verified)",
              body.get("quality_status") == "VERIFIED_ACCEPTED",
              f"status={body.get('quality_status')}")

        # 13) Now create a deal and verify quality sync --------------------
        # Open an offer and accept it
        status, body = http(base, "POST", "/api/offers", {
            "crop_lot_id": lot_id, "buyer_id": buyer_id,
            "price": 17.0, "quantity": 500.0, "message": "Initial offer",
        })
        offer_pid = body.get("public_id")
        check("POST /api/offers 201", status == 201, str(body)[:200])
        status, body = http(base, "POST", f"/api/offers/{offer_pid}/accept", {
            "actor": "BUYER",
        })
        check("Accept offer 200", status == 200, str(body)[:200])
        deal_pid = body.get("deal", {}).get("public_id")

        # Now verify quality — Deal.quality_status should be updated
        status, body = http(base, "POST", f"/api/quality/{lot_id}/verify", {
            "actor": "VERIFIER",
        })
        check("Verify after deal 200", status == 200, str(body)[:200])

        # Confirm the deal's quality_status is VERIFIED (linked)
        db = SessionLocal()
        try:
            d = db.query(Deal).filter(Deal.public_id == deal_pid).one_or_none()
            check("Deal linked to lot, exists", d is not None, f"deal={d}")
            check("Deal.quality_status=VERIFIED after verify",
                  d is not None and d.quality_status == "VERIFIED",
                  f"got {d.quality_status if d else None}")
        finally:
            db.close()

        # 14) Earlier modules still 200 -----------------------------------
        for path, label, method in [
            ("/api/health", "Phase 1 /api/health", "GET"),
            ("/api/crop-lots", "Phase 2 /api/crop-lots", "GET"),
            ("/api/market-prices?crop=tomato", "Phase 3 /api/market-prices", "GET"),
            ("/api/market-prices/health", "Phase 3 /api/market-prices/health", "GET"),
            ("/api/buyers", "Phase 4C /api/buyers", "GET"),
            ("/api/buyers/seed-demo", "Phase 4C /api/buyers/seed-demo", "POST"),
            ("/api/fpos", "Phase 4F /api/fpos", "GET"),
            (f"/api/offers?crop_lot_id={lot_id}", "Phase 4E /api/offers", "GET"),
        ]:
            status, _ = http(base, method, path)
            check(f"{label} still 200", status == 200, f"status={status}")

    finally:
        server.should_exit = True
        thread.join(timeout=5)

    print()
    if errors:
        print(f"\033[91m=== {len(errors)} CHECK(S) FAILED ===\033[0m")
        for e in errors:
            print("  -", e)
        return 1
    print("\033[92m=== ALL PHASE 4 MODULE G CHECKS PASSED ===\033[0m")
    return 0


if __name__ == "__main__":
    sys.exit(main())
