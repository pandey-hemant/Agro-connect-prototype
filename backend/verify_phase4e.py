"""Phase 4 Module E — Offers & Negotiation — regression battery.

Re-runs Phase 1-3 / A / B / C / D checks plus Module E endpoints to
confirm the offer/negotiation/deal flow is wired and earlier modules
still work.

Run with the project's venv:

    cd backend
    ./.venv/Scripts/python.exe verify_phase4e.py
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
from app.models import Buyer, CropLot, Deal, Offer  # noqa: E402
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


def _setup_lot_and_buyer() -> tuple[int, int]:
    """Seed buyers + create a Crop Lot; return (lot_id, tomato_buyer_id)."""
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
    print("\n=== Phase 4 Module E — Offers & Negotiation ===\n")
    reset_db()

    routes = {r.path for r in app.routes if hasattr(r, "path")}
    for needle in (
        "/api/health", "/api/crop-lots", "/api/market-prices",
        "/api/market-prices/health", "/api/logistics/estimate",
        "/api/logistics/config", "/api/decisions/{crop_lot_id}",
        "/api/buyers", "/api/buyers/match/{crop_lot_id}",
        "/api/buyers/seed-demo",
        "/api/offers", "/api/offers/{public_id}",
        "/api/offers/{public_id}/counter",
        "/api/offers/{public_id}/accept",
        "/api/offers/{public_id}/reject",
        "/api/offers/{public_id}/messages",
    ):
        check(f"Route present: {needle}", any(needle in p for p in routes))

    lot_id, buyer_id = _setup_lot_and_buyer()
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
        # 2) POST /api/offers creates an OPEN offer with OFFER message -----
        status, body = http(base, "POST", "/api/offers", {
            "crop_lot_id": lot_id,
            "buyer_id": buyer_id,
            "price": 17.0,
            "quantity": 500.0,
            "message": "Initial buyer offer",
        })
        check("POST /api/offers 201", status == 201, str(body)[:200])
        offer_public_id = body.get("public_id")
        check("Response has public_id", bool(offer_public_id), f"got {offer_public_id}")
        check("Response has offer.status=OPEN",
              body.get("offer", {}).get("status") == "OPEN",
              f"status={body.get('offer', {}).get('status')}")
        msgs = body.get("offer", {}).get("messages", [])
        check("First message is OFFER/BUYER", len(msgs) == 1 and
              msgs[0].get("action") == "OFFER" and
              msgs[0].get("actor") == "BUYER",
              f"msgs={msgs}")

        # 3) GET /api/offers?crop_lot_id=... returns 1 ---------------------
        status, body = http(base, "GET", f"/api/offers?crop_lot_id={lot_id}")
        check("GET /api/offers 200", status == 200, str(body)[:200])
        check("list count=1", body.get("count") == 1, f"count={body.get('count')}")
        check("list contains our offer",
              any(o.get("public_id") == offer_public_id for o in body.get("results", [])))

        # 4) GET single offer ----------------------------------------------
        status, body = http(base, "GET", f"/api/offers/{offer_public_id}")
        check("GET /api/offers/{id} 200", status == 200, str(body)[:200])
        check("Single offer has 1 message", len(body.get("messages", [])) == 1)

        # 5) POST counter ---------------------------------------------------
        status, body = http(base, "POST", f"/api/offers/{offer_public_id}/counter", {
            "actor": "FARMER",
            "price": 18.5,
            "quantity": 500.0,
            "message": "Counter at 18.5",
        })
        check("POST counter 200", status == 200, str(body)[:200])
        check("Offer is now COUNTERED", body.get("status") == "COUNTERED",
              f"status={body.get('status')}")
        check("Counter updated current_price=18.5",
              abs(float(body.get("current_price", 0)) - 18.5) < 1e-6,
              f"current_price={body.get('current_price')}")
        check("Counter has 2 messages", len(body.get("messages", [])) == 2)
        # The latest message should be the counter
        last = body["messages"][-1]
        check("Last message is COUNTER/FARMER",
              last.get("action") == "COUNTER" and last.get("actor") == "FARMER",
              f"last={last}")

        # 6) GET messages ---------------------------------------------------
        status, body = http(base, "GET", f"/api/offers/{offer_public_id}/messages")
        check("GET messages 200", status == 200, str(body)[:200])
        check("Messages returns 2 entries", len(body) == 2, f"len={len(body)}")

        # 7) POST accept creates Deal + marks lot SOLD ---------------------
        status, body = http(base, "POST", f"/api/offers/{offer_public_id}/accept", {
            "actor": "BUYER",
        })
        check("POST accept 200", status == 200, str(body)[:200])
        check("Accept response has offer.status=ACCEPTED",
              body.get("offer", {}).get("status") == "ACCEPTED",
              f"status={body.get('offer', {}).get('status')}")
        check("Accept response has deal", bool(body.get("deal")),
              f"deal={body.get('deal')}")
        deal = body.get("deal", {})
        check("Deal.agreed_price=18.5",
              abs(float(deal.get("agreed_price", 0)) - 18.5) < 1e-6,
              f"price={deal.get('agreed_price')}")
        check("Deal.total_value=9250.0",
              abs(float(deal.get("total_value", 0)) - 9250.0) < 1e-6,
              f"total={deal.get('total_value')}")
        check("Accept response marks lot SOLD",
              body.get("crop_lot_status") == "SOLD",
              f"lot_status={body.get('crop_lot_status')}")
        deal_public_id = deal.get("public_id")

        # 8) Re-accept is idempotent (returns same offer+deal) -------------
        status, body = http(base, "POST", f"/api/offers/{offer_public_id}/accept", {
            "actor": "BUYER",
        })
        check("Re-accept 200", status == 200, str(body)[:200])
        check("Re-accept returns same deal public_id",
              body.get("deal", {}).get("public_id") == deal_public_id,
              f"got {body.get('deal', {}).get('public_id')}")

        # 9) Rejecting an accepted offer returns 409 -----------------------
        status, body = http(base, "POST", f"/api/offers/{offer_public_id}/reject", {
            "actor": "FARMER", "reason": "too late",
        })
        check("Reject-after-accept 409", status == 409, f"status={status} body={body}")

        # 10) Countering an accepted offer returns 409 ---------------------
        status, _ = http(base, "POST", f"/api/offers/{offer_public_id}/counter", {
            "actor": "FARMER", "price": 19.0, "quantity": 500.0,
        })
        check("Counter-after-accept 409", status == 409, f"status={status}")

        # 11) A second offer for the same SOLD lot is rejected ------------
        # Need another buyer to attempt a new offer
        db = SessionLocal()
        try:
            other_buyer = (
                db.query(Buyer)
                .filter(Buyer.name.like("%SpiceRoute%"))
                .one_or_none()
            )
            other_id = int(other_buyer.id) if other_buyer else None
        finally:
            db.close()
        if other_id:
            status, body = http(base, "POST", "/api/offers", {
                "crop_lot_id": lot_id,
                "buyer_id": other_id,
                "price": 19.0,
                "quantity": 500.0,
            })
            check("Offer on SOLD lot 400", status == 400,
                  f"status={status} body={body}")

        # 12) Unknown offer -> 404 -----------------------------------------
        status, _ = http(base, "GET", "/api/offers/does-not-exist")
        check("Unknown offer 404", status == 404, f"status={status}")

        # 13) Bad actor rejected ------------------------------------------
        status, _ = http(base, "POST", f"/api/offers/{offer_public_id}/counter", {
            "actor": "ROBOT", "price": 1, "quantity": 1,
        })
        # The counter will hit the bad actor first (validation)
        # But the offer is already ACCEPTED, so we get 409 either way.
        check("Counter bad actor or accepted offer -> 4xx",
              status in (400, 409, 422), f"status={status}")

        # 14) Deal persisted ----------------------------------------------
        db = SessionLocal()
        try:
            d = db.query(Deal).filter(Deal.public_id == deal_public_id).one_or_none()
            check("Deal persisted in DB", d is not None, f"deal={d}")
            check("Deal.agreed_quantity=500.0",
                  d and abs(float(d.agreed_quantity) - 500.0) < 1e-6)
            check("Deal.delivery_status=PENDING",
                  d and d.delivery_status == "PENDING",
                  f"delivery={d.delivery_status if d else None}")
        finally:
            db.close()

        # 15) Phase 1-3 + A-D still work -----------------------------------
        for path, label in [
            ("/api/health", "Phase 1 /api/health"),
            ("/api/crop-lots", "Phase 2 /api/crop-lots"),
            ("/api/market-prices?crop=tomato", "Phase 3 /api/market-prices"),
            ("/api/market-prices/health", "Phase 3 /api/market-prices/health"),
            ("/api/buyers", "Phase 4C /api/buyers"),
            (f"/api/buyers/match/{lot_id}", "Phase 4D /api/buyers/match"),
            (f"/api/decisions/{lot_id}", "Phase 4B /api/decisions"),
        ]:
            status, _ = http(base, "GET", path)
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
    print("\033[92m=== ALL PHASE 4 MODULE E CHECKS PASSED ===\033[0m")
    return 0


if __name__ == "__main__":
    sys.exit(main())
