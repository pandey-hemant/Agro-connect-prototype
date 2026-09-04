"""Phase 4 Module D — Buyer Matching — regression battery.

Re-runs Phase 1-3 / A / B / C checks plus Module D endpoints to confirm
buyer matching is wired and Phase 1-3 / A / B / C still work.

Approach: boots uvicorn in a background thread on a free port, then
exercises the HTTP API with stdlib ``urllib``.

Run with the project's venv:

    cd backend
    ./.venv/Scripts/python.exe verify_phase4d.py
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
from app.models import CropLot  # noqa: E402
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


def wait_ready(base: str, timeout: float = 20.0) -> bool:
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


def _make_lot(
    crop_name: str, variety: str, quantity: float, unit: str,
    location: str, minimum_acceptable_price: float | None = None,
) -> int:
    """Insert a Crop Lot row directly in the DB and return its integer id."""
    db = SessionLocal()
    try:
        lot = CropLot(
            public_id="CL-" + uuid.uuid4().hex[:12].upper(),
            crop_name=crop_name,
            crop_variety=variety,
            quantity=quantity,
            quantity_unit=unit,
            harvest_date=date.today(),
            location=location,
            minimum_acceptable_price=minimum_acceptable_price,
        )
        db.add(lot)
        db.commit()
        db.refresh(lot)
        return int(lot.id)
    finally:
        db.close()


def main() -> int:
    print("\n=== Phase 4 Module D — Buyer Matching ===\n")
    reset_db()

    # 1) Routes registered --------------------------------------------------
    routes = {r.path for r in app.routes if hasattr(r, "path")}
    for needle in (
        "/api/health",
        "/api/crop-lots",
        "/api/market-prices",
        "/api/market-prices/health",
        "/api/logistics/estimate",
        "/api/logistics/config",
        "/api/decisions/{crop_lot_id}",
        "/api/buyers",
        "/api/buyers/match/{crop_lot_id}",
        "/api/buyers/seed-demo",
    ):
        check(f"Route present: {needle}", any(needle in p for p in routes))

    # 2) Seed demo buyers + create a tomato lot in Bihar --------------------
    result = seed_demo_buyers()
    check("Demo buyers seeded", result["inserted"] == 6, f"inserted={result['inserted']}")

    lot_id = _make_lot("Tomato", "Hybrid", 500.0, "kg",
                       "Patna, Bihar", minimum_acceptable_price=18.0)
    check("Created Tomato 500kg lot", isinstance(lot_id, int) and lot_id > 0,
          f"lot_id={lot_id}")

    # 3) Boot uvicorn -------------------------------------------------------
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
        # 4) /buyers/match/{lot_id} returns matches ------------------------
        status, body = http(base, "GET", f"/api/buyers/match/{lot_id}")
        check("GET /api/buyers/match/{id} 200", status == 200, str(body)[:200])
        check("Envelope count >= 1", body.get("count", 0) >= 1,
              f"count={body.get('count')}")
        check("Envelope method=rule-based", body.get("method") == "rule-based",
              f"method={body.get('method')}")
        check("Envelope crop_lot_id matches",
              body.get("crop_lot_id") == lot_id,
              f"got={body.get('crop_lot_id')} want={lot_id}")

        # 5) Sort: highest score first -------------------------------------
        scores = [m["score"] for m in body["results"]]
        check("Matches sorted by score desc", scores == sorted(scores, reverse=True),
              f"scores={scores}")

        # 6) Every score has reasons + match_explanation -------------------
        for m in body["results"]:
            if not m.get("reasons") or not m.get("match_explanation"):
                check("Match has reasons + explanation", False, str(m)[:200])
                break
        else:
            check("Every match has reasons + explanation", True)

        # 7) Explanation never says AI / smart / predicted ----------------
        for m in body["results"]:
            text = (m.get("match_explanation", "") + " " +
                    " ".join(m.get("reasons", []))).lower()
            for banned in (" ai ", " ai.", "ai-based", "smart-match", "predicted"):
                if banned in text:
                    check("No AI language in match output", False,
                          f"found {banned!r} in {text[:120]}")
                    break
            else:
                continue
            break
        else:
            check("No AI/smart/predicted language in match output", True)

        # 8) Top match has crop-match reason (40 points) -------------------
        top = body["results"][0]
        check("Top score >= 40 (crop match)", top["score"] >= 40,
              f"top={top['score']}, reasons={top['reasons']}")

        # 9) Tomato buyers should outrank non-tomato buyers ---------------
        top_buyer_crops = {
            (r.get("crop_name") or "").lower()
            for r in top["buyer"]["requirements"]
        }
        check("Top buyer demands tomato (or has matching crop)",
              "tomato" in top_buyer_crops,
              f"top_buyer_crops={top_buyer_crops}, score={top['score']}")

        # 10) Buyers without tomato demand get score 0 --------------------
        zero = [m for m in body["results"] if m["score"] == 0]
        nonzero = [m for m in body["results"] if m["score"] > 0]
        check("Some buyers with score 0 (no tomato demand)",
              len(zero) >= 1, f"zero={len(zero)} nonzero={len(nonzero)}")
        check("Some buyers with score > 0", len(nonzero) >= 1,
              f"nonzero={len(nonzero)}")

        # 11) limit query param respected ----------------------------------
        status, body = http(base, "GET", f"/api/buyers/match/{lot_id}?limit=2")
        check("GET match?limit=2 200", status == 200, str(body)[:200])
        check("limit=2 returns at most 2", body.get("count", 0) <= 2,
              f"count={body.get('count')}")

        # 12) Unknown lot -> 404 -------------------------------------------
        status, _ = http(base, "GET", "/api/buyers/match/99999")
        check("Unknown lot -> 404", status == 404, f"status={status}")

        # 13) Phase 1-3 + A + B + C still work -----------------------------
        for path, label in [
            ("/api/health", "Phase 1 /api/health"),
            ("/api/crop-lots", "Phase 2 /api/crop-lots"),
            ("/api/market-prices?crop=tomato", "Phase 3 /api/market-prices"),
            ("/api/market-prices/health", "Phase 3 /api/market-prices/health"),
            ("/api/buyers", "Phase 4C /api/buyers"),
        ]:
            status, _ = http(base, "GET", path)
            check(f"{label} still 200", status == 200, f"status={status}")

        status, _ = http(base, "POST", "/api/buyers/seed-demo")
        check("Phase 4C /api/buyers/seed-demo still 200",
              status == 200, f"status={status}")

        status, _ = http(base, "GET", f"/api/decisions/{lot_id}")
        check("Phase 4B /api/decisions still 200", status == 200)

        status, body = http(base, "POST", "/api/logistics/estimate", {
            "crop_lot_id": lot_id,
            "destination_market": "Azadpur Mandi",
            "destination_label": "Delhi",
        })
        check("Phase 4A /api/logistics/estimate still 200",
              status == 200, str(body)[:200])

    finally:
        server.should_exit = True
        thread.join(timeout=5)

    print()
    if errors:
        print(f"\033[91m=== {len(errors)} CHECK(S) FAILED ===\033[0m")
        for e in errors:
            print("  -", e)
        return 1
    print("\033[92m=== ALL PHASE 4 MODULE D CHECKS PASSED ===\033[0m")
    return 0


if __name__ == "__main__":
    sys.exit(main())
