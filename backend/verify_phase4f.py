"""Phase 4 Module F — FPO / Group Selling — regression battery.

Exercises:
- create / list / get
- join / leave (idempotent join)
- aggregate per-crop totals + reachable buyers
- seed-demo (idempotent)
- one-deal-per-lot still respected (Phase 4E)
- Phase 1-4E still green
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
from app.models import CropLot, FPO  # noqa: E402
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


def _seed_lots_and_buyers() -> tuple[list[int], list[int]]:
    """Create 3 tomato lots (varied quantity) and 1 onion lot; seed buyers."""
    seed_demo_buyers()
    db = SessionLocal()
    try:
        lots: list[CropLot] = []
        for i, (qty, crop, var) in enumerate([
            (300.0, "Tomato", "Hybrid"),
            (250.0, "Tomato", "Hybrid"),
            (200.0, "Tomato", "Desi"),
            (400.0, "Onion", "Red"),
        ]):
            lot = CropLot(
                public_id="CL-" + uuid.uuid4().hex[:12].upper(),
                crop_name=crop,
                crop_variety=var,
                quantity=qty,
                quantity_unit="kg",
                harvest_date=date.today(),
                location="Patna, Bihar" if i < 3 else "Lucknow, UP",
            )
            db.add(lot)
            lots.append(lot)
        db.commit()
        for lot in lots:
            db.refresh(lot)
        return [int(l.id) for l in lots], []
    finally:
        db.close()


def main() -> int:
    print("\n=== Phase 4 Module F — FPO / Group Selling ===\n")
    reset_db()

    routes = {r.path for r in app.routes if hasattr(r, "path")}
    for needle in (
        "/api/fpos",
        "/api/fpos/seed-demo",
        "/api/fpos/{public_id}",
        "/api/fpos/{public_id}/join",
        "/api/fpos/{public_id}/leave",
        "/api/fpos/{public_id}/aggregate",
    ):
        check(f"Route present: {needle}", any(needle in p for p in routes))

    lot_ids, _ = _seed_lots_and_buyers()
    check("3 tomato + 1 onion lots ready", len(lot_ids) == 4,
          f"lot_ids={lot_ids}")

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
        # 2) Seed demo FPOs -------------------------------------------------
        status, body = http(base, "POST", "/api/fpos/seed-demo")
        check("POST /api/fpos/seed-demo 200", status == 200, str(body)[:200])
        check("Seeded inserted >= 1", body.get("inserted", 0) >= 1,
              f"inserted={body.get('inserted')}")
        check("Returned is_live=false", body.get("is_live") is False)
        public_ids_seed = list(body.get("public_ids") or [])
        check("Returned public_ids list", len(public_ids_seed) >= 1,
              f"public_ids={public_ids_seed}")

        # 2b) Re-seed is idempotent -----------------------------------------
        status, body = http(base, "POST", "/api/fpos/seed-demo")
        check("Re-seed skipped >= 1", body.get("skipped", 0) >= 1,
              f"skipped={body.get('skipped')} body={body}")

        # 3) List FPOs -------------------------------------------------------
        status, body = http(base, "GET", "/api/fpos")
        check("GET /api/fpos 200", status == 200, str(body)[:200])
        check("List count >= 2", body.get("count", 0) >= 2,
              f"count={body.get('count')}")

        # 4) Get a single FPO ----------------------------------------------
        fpo_pid = body["results"][0]["public_id"]
        status, body = http(base, "GET", f"/api/fpos/{fpo_pid}")
        check("GET /api/fpos/{id} 200", status == 200, str(body)[:200])
        check("FPO has public_id", body.get("public_id") == fpo_pid)

        # 5) Create a custom FPO -------------------------------------------
        status, body = http(base, "POST", "/api/fpos", {
            "name": "Test FPO",
            "location": "Test, Bihar",
            "district": "Test",
            "state": "Bihar",
        })
        check("POST /api/fpos 201", status == 201, str(body)[:200])
        custom_pid = body.get("public_id")
        check("Custom FPO created", bool(custom_pid), f"got {custom_pid}")

        # 6) Join 2 tomato lots (totalling 550kg) ---------------------------
        status, body = http(base, "POST", f"/api/fpos/{custom_pid}/join", {
            "crop_lot_id": lot_ids[0],
        })
        check("Join lot1 200", status == 200, str(body)[:200])
        check("Members=1", body.get("member_count") == 1, f"got {body.get('member_count')}")

        status, body = http(base, "POST", f"/api/fpos/{custom_pid}/join", {
            "crop_lot_id": lot_ids[1],
        })
        check("Join lot2 200", status == 200, str(body)[:200])
        check("Members=2", body.get("member_count") == 2, f"got {body.get('member_count')}")

        # 7) Join is idempotent --------------------------------------------
        status, body = http(base, "POST", f"/api/fpos/{custom_pid}/join", {
            "crop_lot_id": lot_ids[0],
        })
        check("Re-join same lot 200", status == 200, str(body)[:200])
        check("Members still=2", body.get("member_count") == 2, f"got {body.get('member_count')}")

        # 8) Leave a lot ----------------------------------------------------
        status, body = http(base, "POST", f"/api/fpos/{custom_pid}/leave", {
            "crop_lot_id": lot_ids[0],
        })
        check("Leave lot1 200", status == 200, str(body)[:200])
        check("Members=1 after leave", body.get("member_count") == 1,
              f"got {body.get('member_count')}")

        # 9) Aggregate for tomato ------------------------------------------
        status, body = http(base, "POST", f"/api/fpos/{custom_pid}/join", {
            "crop_lot_id": lot_ids[0],
        })
        check("Re-join lot1 200", status == 200, str(body)[:200])
        status, body = http(base, "GET", f"/api/fpos/{custom_pid}/aggregate?crop=tomato")
        check("GET aggregate 200", status == 200, str(body)[:200])
        check("Aggregate has 1 crop row", len(body.get("by_crop", [])) == 1,
              f"rows={body.get('by_crop')}")
        if body.get("by_crop"):
            row = body["by_crop"][0]
            check("Aggregate tomato total=550kg",
                  abs(float(row.get("total_quantity", 0)) - 550.0) < 1e-6,
                  f"row={row}")
            check("Aggregate lot_count=2",
                  int(row.get("lot_count", 0)) == 2,
                  f"row={row}")

        # 10) Reachability (demo buyer for tomato with min_quantity=400kg) -
        check("Aggregate reachable_buyers list present",
              isinstance(body.get("reachable_buyers"), list),
              f"reachable={body.get('reachable_buyers')}")

        # 11) Join the onion lot and re-aggregate (no crop filter) ----------
        status, body = http(base, "POST", f"/api/fpos/{custom_pid}/join", {
            "crop_lot_id": lot_ids[3],
        })
        check("Join onion lot 200", status == 200, str(body)[:200])
        status, body = http(base, "GET", f"/api/fpos/{custom_pid}/aggregate")
        check("GET aggregate (no filter) 200", status == 200, str(body)[:200])
        check("Aggregate has 2 crop rows (tomato + onion)",
              len(body.get("by_crop", [])) == 2,
              f"rows={body.get('by_crop')}")

        # 12) Unknown FPO -> 404 --------------------------------------------
        status, _ = http(base, "GET", "/api/fpos/does-not-exist")
        check("Unknown FPO 404", status == 404, f"status={status}")

        # 13) Join with unknown lot -> 400 ----------------------------------
        status, _ = http(base, "POST", f"/api/fpos/{custom_pid}/join", {
            "crop_lot_id": 999999,
        })
        check("Join unknown lot 400", status == 400, f"status={status}")

        # 14) FPO persisted in DB ------------------------------------------
        db = SessionLocal()
        try:
            f = db.query(FPO).filter(FPO.public_id == custom_pid).one_or_none()
            check("Custom FPO persisted in DB", f is not None, f"fpo={f}")
            check("Demo FPOs are is_demo=true",
                  all(fp.is_demo for fp in db.query(FPO).all()
                      if fp.public_id in public_ids_seed),
                  "demo flag check")
        finally:
            db.close()

        # 15) Earlier modules still 200 -------------------------------------
        for path, label in [
            ("/api/health", "Phase 1 /api/health"),
            ("/api/crop-lots", "Phase 2 /api/crop-lots"),
            ("/api/market-prices?crop=tomato", "Phase 3 /api/market-prices"),
            ("/api/market-prices/health", "Phase 3 /api/market-prices/health"),
            ("/api/buyers", "Phase 4C /api/buyers"),
            (f"/api/offers?crop_lot_id={lot_ids[0]}", "Phase 4E /api/offers"),
            (f"/api/decisions/{lot_ids[0]}", "Phase 4B /api/decisions"),
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
    print("\033[92m=== ALL PHASE 4 MODULE F CHECKS PASSED ===\033[0m")
    return 0


if __name__ == "__main__":
    sys.exit(main())
