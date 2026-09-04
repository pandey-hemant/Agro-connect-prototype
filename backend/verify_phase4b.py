"""Phase 4 Module B verification — decision support works and Phase 1-3 + A still work."""
import sys
import traceback
import uuid
from datetime import date

print(f"Python: {sys.version}")

# 1. App imports & routes are wired.
try:
    from app.main import app
    paths = sorted({r.path for r in app.routes if hasattr(r, "path")})
    print(f"OK app imported — {len(paths)} routes total")
    for needle in (
        "/api/health",
        "/api/crop-lots",
        "/api/market-prices",
        "/api/market-prices/health",
        "/api/logistics/config",
        "/api/logistics/estimate",
        "/api/logistics/estimates/{crop_lot_id}",
        "/api/decisions/{crop_lot_id}",
    ):
        assert any(needle in p for p in paths), f"missing route: {needle}"
        print(f"    present: {needle}")
except Exception as exc:
    print(f"FAIL route check: {exc}")
    traceback.print_exc()
    sys.exit(1)

# 2. Models registered.
try:
    from app.db.base import Base
    from app.models import FarmerDecision
    table = Base.metadata.tables.get("farmer_decisions")
    assert table is not None, "farmer_decisions table not registered"
    cols = {c.name for c in table.columns}
    needed = {
        "id", "crop_lot_id", "recommendation", "reason",
        "insufficient_data", "is_estimate", "comparison_json",
        "created_at", "updated_at",
    }
    missing = needed - cols
    assert not missing, f"missing columns: {missing}"
    print(f"OK farmer_decisions model registered with {len(cols)} columns")
except Exception as exc:
    print(f"FAIL model registration: {exc}")
    traceback.print_exc()
    sys.exit(1)

# 3. End-to-end: create a lot, compute a decision, fetch it.
try:
    from app.db.session import SessionLocal, engine
    from app.db.base import Base
    from app.models.crop_lot import CropLot, CropLotStatus
    from app.services.decision_support import compute_decision, get_decision

    Base.metadata.create_all(bind=engine)

    db = SessionLocal()
    try:
        lot = CropLot(
            public_id=uuid.uuid4().hex[:16],
            crop_name="tomato",
            crop_variety="hybrid",
            quantity=500.0,
            quantity_unit="kg",
            harvest_date=date.today(),
            location="Nashik, Maharashtra",
            minimum_acceptable_price=1500.0,
            status=CropLotStatus.ACTIVE.value,
        )
        db.add(lot)
        db.commit()
        db.refresh(lot)
        lot_id = lot.id
    finally:
        db.close()

    # Lazy GET: should compute and persist.
    first = get_decision(lot_id)
    assert first.id >= 1
    assert first.crop_lot_id == lot_id
    assert first.recommendation in {"SELL_NOW", "WAIT", "GROUP_SALE"}
    assert first.is_estimate is True
    assert isinstance(first.comparison, list)
    print(f"OK GET /decisions/{{id}} lazy compute — "
          f"rec={first.recommendation} insufficient={first.insufficient_data} "
          f"rows={len(first.comparison)}")

    # Same call again should return the same persisted row (id stable).
    second = get_decision(lot_id)
    assert second.id == first.id
    print(f"OK lazy GET is idempotent (id stable at {second.id})")

    # POST /refresh should recompute and return the latest.
    refreshed = compute_decision(lot_id)
    assert refreshed.id == first.id  # same row updated
    print(f"OK POST /decisions/{{id}}/refresh updates in place "
          f"(id={refreshed.id}, rec={refreshed.recommendation})")

    if first.comparison:
        row = first.comparison[0]
        assert row.distance_km > 0
        assert row.net_realisation != 0
        print(f"OK comparison row — market={row.market!r} "
              f"net=INR{row.net_realisation:.0f} distance={row.distance_km:.1f}km")
except Exception as exc:
    print(f"FAIL decision end-to-end: {exc}")
    traceback.print_exc()
    sys.exit(1)

# 4. Module A still works.
try:
    from app.services.logistics import estimate_for_lot, list_for_lot, config_view
    cfg = config_view()
    assert cfg.is_estimate is True
    from app.schemas.logistics import LogisticsEstimateRequest
    est = estimate_for_lot(LogisticsEstimateRequest(
        crop_lot_id=lot_id, destination_label="Azadpur Mandi",
        destination_market="azadpur mandi",
    ))
    assert est.is_estimate is True
    assert est.gross_value > 0
    print(f"OK Module A still works — new estimate net=INR{est.net_realisation:.0f}")
except Exception as exc:
    print(f"FAIL Module A regression: {exc}")
    traceback.print_exc()
    sys.exit(1)

# 5. Phase 3 still works.
try:
    from app.services import get_market_price_service
    from app.schemas.market_price import MarketPriceQuery
    svc = get_market_price_service()
    response = svc.list_prices(MarketPriceQuery(crop="tomato"))
    assert response.count >= 1
    assert response.is_live is False
    print(f"OK Phase 3 still works — market-prices/tomato returned {response.count} demo rows")
except Exception as exc:
    print(f"FAIL Phase 3 regression: {exc}")
    traceback.print_exc()
    sys.exit(1)

print("\nALL PHASE 4 MODULE B (DECISION SUPPORT) CHECKS PASSED")
