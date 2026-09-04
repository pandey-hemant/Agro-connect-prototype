"""Phase 4 Module C — Buyer Marketplace — regression battery.

Re-runs the Phase 1-3 / A / B checks plus Module C endpoints to confirm
nothing regressed and the buyer marketplace is wired end-to-end.

Approach: boots uvicorn in a background thread on a free port, then
exercises the HTTP API with stdlib ``urllib``. This avoids needing
``httpx`` (not in requirements.txt) and matches how Phase 3 was
verified in CI.

Run with the project's venv:

    cd backend
    ./.venv/Scripts/python.exe verify_phase4c.py
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
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent
os.chdir(BACKEND_DIR)
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

# Wipe the SQLite DB before booting so seeds are deterministic
for _k in ("AGROCONNECT_DB", "DATABASE_URL"):
    os.environ.pop(_k, None)

import uvicorn  # noqa: E402

from app.db.base import Base  # noqa: E402
from app.db.session import engine  # noqa: E402
from app.main import app  # noqa: E402
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


def wait_ready(base: str, timeout: float = 15.0) -> bool:
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
        with urllib.request.urlopen(req, timeout=10) as r:
            raw = r.read().decode("utf-8") or "{}"
            return r.status, json.loads(raw) if raw.strip() else {}
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8") or "{}"
        try:
            return e.code, json.loads(raw)
        except json.JSONDecodeError:
            return e.code, {"raw": raw}


def main() -> int:
    print("\n=== Phase 4 Module C — Buyer Marketplace ===\n")
    reset_db()

    # 1) Routes registered before boot --------------------------------------
    routes = {r.path for r in app.routes if hasattr(r, "path")}
    expected = {
        "/api/health",
        "/api/crop-lots",
        "/api/market-prices",
        "/api/market-prices/health",
        "/api/logistics/estimate",
        "/api/logistics/estimates/{crop_lot_id}",
        "/api/logistics/config",
        "/api/decisions/{crop_lot_id}",
        "/api/decisions/{crop_lot_id}/refresh",
        "/api/buyers",
        "/api/buyers/seed-demo",
    }
    missing = expected - routes
    check("Module C + earlier routes present", not missing, f"missing={missing}")

    # 2) Tables registered --------------------------------------------------
    tables = set(Base.metadata.tables.keys())
    for name in ("buyers", "buyer_requirements"):
        check(f"Table {name} registered", name in tables)

    # 3) Idempotent seed_demo_buyers via service ----------------------------
    first = seed_demo_buyers()
    check("First seed call inserts 6", first["inserted"] == 6,
          f"inserted={first['inserted']}, skipped={first['skipped']}")
    second = seed_demo_buyers()
    check("Second seed call idempotent (inserted=0)", second["inserted"] == 0)
    check("Second seed skipped=6", second["skipped"] == 6)
    check("Second seed total_after=6", second["total_after"] == 6)

    # 4) Boot uvicorn in background -----------------------------------------
    port = find_free_port()
    config = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning")
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{port}"
    if not wait_ready(base, timeout=20.0):
        print("server failed to start")
        return 1

    try:
        # 5) GET /api/buyers -------------------------------------------------
        status, body = http(base, "GET", "/api/buyers")
        check("GET /api/buyers 200", status == 200, str(body)[:200])
        check("Envelope count=6", body.get("count") == 6,
              f"got {body.get('count')}, is_live={body.get('is_live')}")
        check("Envelope is_live=false", body.get("is_live") is False)
        check("Every buyer is_demo=True",
              all(b.get("is_demo") is True for b in body.get("results", [])))

        # 6) Crop filter ----------------------------------------------------
        status, body = http(base, "GET", "/api/buyers?crop=tomato")
        check("GET /api/buyers?crop=tomato 200", status == 200, str(body)[:200])
        check("crop=tomato count>=1", body.get("count", 0) >= 1,
              f"count={body.get('count')}")
        for b in body.get("results", []):
            reqs = b.get("requirements", [])
            if not any("tomato" in (r.get("crop_name", "")).lower() for r in reqs):
                check("crop=tomato filter accurate", False, f"buyer={b.get('public_id')}")
                break
        else:
            check("crop=tomato filter accurate", True)

        # 7) State filter ---------------------------------------------------
        status, body = http(base, "GET", "/api/buyers?state=Delhi")
        check("GET /api/buyers?state=Delhi 200", status == 200, str(body)[:200])
        states = {b.get("state", "") for b in body.get("results", [])}
        check("state=Delhi returns only Delhi",
              states.issubset({"Delhi", ""}) and body.get("count", 0) >= 1,
              f"states={states}")

        # 8) Verified filter ------------------------------------------------
        status, body = http(base, "GET", "/api/buyers?verified=true")
        check("GET /api/buyers?verified=true 200", status == 200, str(body)[:200])
        non_verified = [b for b in body.get("results", [])
                        if b.get("verification_status") != "VERIFIED"]
        check("verified=true returns only VERIFIED", not non_verified,
              f"non-verified={[b.get('public_id') for b in non_verified]}")

        # 9) Single buyer ---------------------------------------------------
        status, body = http(base, "GET", "/api/buyers/" + first["public_ids"][0])
        check("GET /api/buyers/{public_id} 200", status == 200, str(body)[:200])
        check("Single buyer has requirements", len(body.get("requirements", [])) >= 1)
        check("Single buyer is_demo flagged", body.get("is_demo") is True)

        # 10) Unknown buyer -> 404 -----------------------------------------
        status, _ = http(base, "GET", "/api/buyers/does-not-exist")
        check("Unknown buyer -> 404", status == 404, f"status={status}")

        # 11) POST /seed-demo idempotent ------------------------------------
        status, body = http(base, "POST", "/api/buyers/seed-demo")
        check("POST /api/buyers/seed-demo 200", status == 200, str(body)[:200])
        check("HTTP seed idempotent (inserted=0)", body.get("inserted") == 0,
              f"body={body}")
        check("HTTP seed skipped=6", body.get("skipped") == 6)

        # 12) Phase 1-3 + A + B still work -----------------------------------
        status, _ = http(base, "GET", "/api/health")
        check("Phase 1 /api/health still 200", status == 200)

        payload = {
            "farmer_name": "Module C Tester",
            "farmer_phone": "9999900000",
            "crop_name": "Tomato",
            "crop_variety": "Hybrid",
            "quantity": 500.0,
            "quantity_unit": "kg",
            "harvest_date": "2026-08-29",
            "location": "Patna, Bihar",
            "minimum_acceptable_price": 15.0,
        }
        status, body = http(base, "POST", "/api/crop-lots", payload)
        check("Phase 2 POST /api/crop-lots still works",
              status in (200, 201), str(body)[:200])
        public_id = body.get("public_id") if isinstance(body, dict) else None
        check("Phase 2 returned lot public_id", bool(public_id), f"id={public_id}")

        # The public_id is exposed by the API; the integer PK is needed by
        # logistics/decisions. Look it up directly in the DB.
        from app.db.session import SessionLocal  # noqa: PLC0415
        from app.models.crop_lot import CropLot  # noqa: PLC0415
        db = SessionLocal()
        try:
            row = db.query(CropLot).filter_by(public_id=public_id).one_or_none()
            lot_id = row.id if row else None
        finally:
            db.close()
        check("Phase 2 located integer lot_id", bool(lot_id), f"id={lot_id}")

        status, _ = http(base, "GET", "/api/crop-lots")
        check("Phase 2 GET /api/crop-lots still works", status == 200)

        status, body = http(base, "GET", "/api/market-prices?crop=tomato")
        check("Phase 3 GET /api/market-prices still works", status == 200,
              str(body)[:200])
        check("Phase 3 market-prices returns rows",
              body.get("count", 0) > 0 or len(body.get("prices", [])) > 0)

        status, _ = http(base, "GET", "/api/market-prices/health")
        check("Phase 3 /api/market-prices/health still 200", status == 200)

        status, body = http(base, "POST", "/api/logistics/estimate", {
            "crop_lot_id": lot_id,
            "destination_market": "Azadpur Mandi",
            "destination_label": "Delhi",
        })
        check("Phase 4A /api/logistics/estimate still works",
              status == 200, str(body)[:200])
        check("Phase 4A estimate is_estimate=true",
              isinstance(body, dict) and body.get("is_estimate") is True,
              f"body={body}")

        status, body = http(base, "GET", f"/api/decisions/{lot_id}")
        check("Phase 4B /api/decisions/{id} still works",
              status == 200, str(body)[:200])
        check("Phase 4B decision has recommendation",
              isinstance(body, dict) and body.get("recommendation") in {
                  "SELL_NOW", "WAIT", "GROUP_SALE",
              }, f"rec={body.get('recommendation') if isinstance(body, dict) else body}")

    finally:
        server.should_exit = True
        thread.join(timeout=5)

    print()
    if errors:
        print(f"\033[91m=== {len(errors)} CHECK(S) FAILED ===\033[0m")
        for e in errors:
            print("  -", e)
        return 1
    print("\033[92m=== ALL PHASE 4 MODULE C CHECKS PASSED ===\033[0m")
    return 0


if __name__ == "__main__":
    sys.exit(main())
