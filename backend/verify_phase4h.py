"""Phase 4 Module H — Deal + Delivery — regression battery.

Exercises:
- GET /api/deals/{public_id}
- GET /api/deals?crop_lot_id=...
- POST /api/deals/{public_id}/status (forward transitions)
- Idempotent: setting same status is a no-op
- Backwards transitions are rejected (409)
- Once delivery_status=COMPLETED, the deal is locked
- After Module E accept: deal is auto-created with default statuses
- Earlier modules still 200
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
from app.models import Buyer, CropLot  # noqa: E402
from app.services.seed_demo import seed_demo_buyers  # noqa: E402

OK = "\033[92mOK\033[0m"
FAIL = "\033[91mFAIL\0m"
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
        tomato_buyer = (
            db.query(Buyer).filter(Buyer.name.like("%FreshHarvest%")).one_or_none()
        )
        if tomato_buyer is None:
            raise RuntimeError("no tomato buyer found in demo seed")
        return lot_id, int(tomato_buyer.id)
    finally:
        db.close()


def main() -> int:
    print("\n=== Phase 4 Module H — Deal + Delivery ===\n")
    reset_db()

    routes = {r.path for r in app.routes if hasattr(r, "path")}
    for needle in (
        "/api/deals",
        "/api/deals/{public_id}",
        "/api/deals/{public_id}/status",
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
        # 2) List deals for lot (no deals yet) -> count=0 -------------------
        status, body = http(base, "GET", f"/api/deals?crop_lot_id={lot_id}")
        check("GET /api/deals 200 (empty)", status == 200, str(body)[:200])
        check("list count=0", body.get("count") == 0, f"got {body.get('count')}")

        # 3) Unknown deal -> 404 --------------------------------------------
        status, _ = http(base, "GET", "/api/deals/does-not-exist")
        check("GET /api/deals/unknown 404", status == 404, f"status={status}")

        # 4) Create an offer and accept -> deal auto-created ---------------
        status, body = http(base, "POST", "/api/offers", {
            "crop_lot_id": lot_id, "buyer_id": buyer_id,
            "price": 17.0, "quantity": 500.0, "message": "Initial offer",
        })
        check("POST /api/offers 201", status == 201, str(body)[:200])
        offer_pid = body.get("public_id")
        status, body = http(base, "POST", f"/api/offers/{offer_pid}/accept", {
            "actor": "BUYER",
        })
        check("Accept 200", status == 200, str(body)[:200])
        deal_pid = body.get("deal", {}).get("public_id")
        check("Deal public_id present", bool(deal_pid), f"got {deal_pid}")

        # 5) GET single deal ------------------------------------------------
        status, body = http(base, "GET", f"/api/deals/{deal_pid}")
        check("GET /api/deals/{id} 200", status == 200, str(body)[:200])
        check("delivery_status=PENDING",
              body.get("delivery_status") == "PENDING",
              f"got {body.get('delivery_status')}")
        check("logistics_status=NOT_STARTED",
              body.get("logistics_status") == "NOT_STARTED",
              f"got {body.get('logistics_status')}")
        check("payment_status=PENDING",
              body.get("payment_status") == "PENDING",
              f"got {body.get('payment_status')}")
        check("quality_status=PENDING",
              body.get("quality_status") == "PENDING",
              f"got {body.get('quality_status')}")
        check("agreed_price=17.0",
              abs(float(body.get("agreed_price", 0)) - 17.0) < 1e-6,
              f"got {body.get('agreed_price')}")
        check("total_value=8500.0",
              abs(float(body.get("total_value", 0)) - 8500.0) < 1e-6,
              f"got {body.get('total_value')}")

        # 6) List deals for the lot -> 1 ------------------------------------
        status, body = http(base, "GET", f"/api/deals?crop_lot_id={lot_id}")
        check("GET /api/deals 200 (1 deal)", status == 200, str(body)[:200])
        check("list count=1", body.get("count") == 1, f"got {body.get('count')}")
        check("list contains our deal",
              any(d.get("public_id") == deal_pid for d in body.get("results", [])))

        # 7) Forward delivery: PENDING -> PREPARING -----------------------
        status, body = http(base, "POST", f"/api/deals/{deal_pid}/status", {
            "delivery_status": "PREPARING",
        })
        check("delivery->PREPARING 200", status == 200, str(body)[:200])
        check("delivery_status=PREPARING",
              body.get("delivery_status") == "PREPARING",
              f"got {body.get('delivery_status')}")

        # 8) Idempotent: PREPARING -> PREPARING (no-op) --------------------
        status, body = http(base, "POST", f"/api/deals/{deal_pid}/status", {
            "delivery_status": "PREPARING",
        })
        check("delivery same->same 200", status == 200, str(body)[:200])
        check("delivery_status still PREPARING",
              body.get("delivery_status") == "PREPARING")

        # 9) Backwards rejected: PREPARING -> PENDING -> 409 --------------
        status, _ = http(base, "POST", f"/api/deals/{deal_pid}/status", {
            "delivery_status": "PENDING",
        })
        check("delivery backwards 409", status == 409, f"status={status}")

        # 10) Forward delivery: PREPARING -> IN_TRANSIT -> DELIVERED -------
        for nxt in ("IN_TRANSIT", "DELIVERED", "COMPLETED"):
            status, body = http(base, "POST", f"/api/deals/{deal_pid}/status", {
                "delivery_status": nxt,
            })
            check(f"delivery->{nxt} 200", status == 200, str(body)[:200])
            check(f"delivery_status={nxt}",
                  body.get("delivery_status") == nxt,
                  f"got {body.get('delivery_status')}")

        # 11) Locked: any further change -> 409 ---------------------------
        status, _ = http(base, "POST", f"/api/deals/{deal_pid}/status", {
            "payment_status": "PARTIAL",
        })
        check("locked-after-COMPLETED 409", status == 409, f"status={status}")

        # 12) Unknown deal -> 404 on status update ------------------------
        status, _ = http(base, "POST", "/api/deals/does-not-exist/status", {
            "delivery_status": "PREPARING",
        })
        check("status unknown deal 404", status == 404, f"status={status}")

        # 13) Invalid value rejected (4xx) --------------------------------
        status, _ = http(base, "POST", f"/api/deals/{deal_pid}/status", {
            "delivery_status": "NONSENSE",
        })
        check("delivery invalid value 409", status == 409, f"status={status}")

        # 14) Set up a second lot + deal to exercise full forward flow -----
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
        status, body = http(base, "POST", "/api/offers", {
            "crop_lot_id": lot2_id, "buyer_id": buyer_id,
            "price": 18.0, "quantity": 300.0, "message": "Onion offer",
        })
        offer2_pid = body.get("public_id")
        status, body = http(base, "POST", f"/api/offers/{offer2_pid}/accept", {
            "actor": "BUYER",
        })
        deal2_pid = body.get("deal", {}).get("public_id")

        # Drive full delivery + payment + logistics flow
        transitions = [
            {"delivery_status": "PREPARING"},
            {"logistics_status": "PLANNED"},
            {"delivery_status": "IN_TRANSIT"},
            {"logistics_status": "IN_TRANSIT"},
            {"payment_status": "PARTIAL"},
            {"delivery_status": "DELIVERED"},
            {"logistics_status": "DELIVERED"},
            {"payment_status": "PAID"},
            {"delivery_status": "COMPLETED"},
        ]
        for tr in transitions:
            status, body = http(base, "POST", f"/api/deals/{deal2_pid}/status", tr)
            field = next(iter(tr.keys()))
            check(f"deal2 {field}={tr[field]} 200",
                  status == 200, f"status={status} body={body}")

        # 15) Final state ----------------------------------------------------
        status, body = http(base, "GET", f"/api/deals/{deal2_pid}")
        check("deal2 delivery=COMPLETED",
              body.get("delivery_status") == "COMPLETED",
              f"got {body.get('delivery_status')}")
        check("deal2 logistics=DELIVERED",
              body.get("logistics_status") == "DELIVERED",
              f"got {body.get('logistics_status')}")
        check("deal2 payment=PAID",
              body.get("payment_status") == "PAID",
              f"got {body.get('payment_status')}")

        # 16) Earlier modules still 200 -----------------------------------
        for path, label, method in [
            ("/api/health", "Phase 1 /api/health", "GET"),
            ("/api/crop-lots", "Phase 2 /api/crop-lots", "GET"),
            ("/api/market-prices?crop=tomato", "Phase 3 /api/market-prices", "GET"),
            ("/api/market-prices/health", "Phase 3 /api/market-prices/health", "GET"),
            ("/api/buyers", "Phase 4C /api/buyers", "GET"),
            ("/api/fpos", "Phase 4F /api/fpos", "GET"),
            (f"/api/offers?crop_lot_id={lot_id}", "Phase 4E /api/offers", "GET"),
            (f"/api/quality/{lot_id}", "Phase 4G /api/quality", "GET"),
        ]:
            status, _ = http(base, method, path)
            # /api/quality/{lot_id} returns 404 when no assessment declared
            # (the regression only checks the endpoint is reachable, not 5xx)
            if "quality" in path:
                check(f"{label} reachable", status in (200, 404),
                      f"status={status}")
            else:
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
    print("\033[92m=== ALL PHASE 4 MODULE H CHECKS PASSED ===\033[0m")
    return 0


if __name__ == "__main__":
    sys.exit(main())
