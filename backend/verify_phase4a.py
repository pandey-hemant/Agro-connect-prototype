"""Phase 4 Module A verification — logistics endpoints work and Phase 1-3 still works."""
import sys
import traceback
import uuid

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
    ):
        assert any(needle in p for p in paths), f"missing route: {needle}"
        print(f"    present: {needle}")
except Exception as exc:
    print(f"FAIL route check: {exc}")
    traceback.print_exc()
    sys.exit(1)

# 2. LogisticsEstimate model is registered for create_all.
try:
    from app.db.base import Base
    from app.models import LogisticsEstimate
    table = Base.metadata.tables.get("logistics_estimates")
    assert table is not None, "logistics_estimates table not registered"
    cols = {c.name for c in table.columns}
    needed = {
        "id", "crop_lot_id", "destination_label", "destination_market",
        "vehicle_type", "distance_km", "transport_cost", "loading_cost",
        "unloading_cost", "other_charges", "total_logistics_cost",
        "gross_value", "net_realisation", "modal_price_per_kg", "price_source",
        "is_live_price", "is_estimate", "created_at",
    }
    missing = needed - cols
    assert not missing, f"missing columns: {missing}"
    print(f"OK logistics_estimates model registered with {len(cols)} columns")
except Exception as exc:
    print(f"FAIL model registration: {exc}")
    traceback.print_exc()
    sys.exit(1)

# 3. config_view() returns a config with is_estimate=True.
try:
    from app.services.logistics import config_view
    cfg = config_view()
    assert cfg.is_estimate is True
    assert cfg.transport_rate_per_km_per_kg > 0
    assert cfg.loading_per_kg > 0
    assert cfg.unloading_per_kg > 0
    print(f"OK logistics config — rate={cfg.transport_rate_per_km_per_kg} "
          f"loading={cfg.loading_per_kg} other%={cfg.other_charges_pct} "
          f"is_estimate={cfg.is_estimate}")
except Exception as exc:
    print(f"FAIL config view: {exc}")
    traceback.print_exc()
    sys.exit(1)

# 4. estimate_for_lot() works end-to-end against the in-memory SQLite.
try:
    from datetime import date
    from app.db.session import SessionLocal, engine
    from app.db.base import Base
    from app.models.crop_lot import CropLot, CropLotStatus
    from app.schemas.logistics import LogisticsEstimateRequest
    from app.services.logistics import estimate_for_lot, list_for_lot

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

    req = LogisticsEstimateRequest(
        crop_lot_id=lot_id,
        destination_label="Azadpur Mandi, Delhi",
        destination_market="azadpur mandi",
        vehicle_type="mini-truck",
    )
    result = estimate_for_lot(req)
    assert result.is_estimate is True
    assert result.distance_km > 0
    assert result.gross_value > 0
    assert result.net_realisation > 0
    assert result.net_realisation < result.gross_value
    assert result.total_logistics_cost > 0
    print(f"OK estimate_for_lot — distance={result.distance_km:.1f}km "
          f"transport=INR{result.transport_cost:.0f} "
          f"net=INR{result.net_realisation:.0f} (gross=INR{result.gross_value:.0f})")

    history = list_for_lot(lot_id)
    assert len(history) == 1
    assert history[0].id == result.id
    print(f"OK list_for_lot returned {len(history)} row(s)")
except Exception as exc:
    print(f"FAIL end-to-end estimate: {exc}")
    traceback.print_exc()
    sys.exit(1)

# 5. Settings are reachable.
try:
    from app.core.config import settings
    assert settings.logistics_transport_rate_per_km_per_kg > 0
    assert settings.logistics_default_vehicle
    assert settings.routing_url.startswith("http")
    print(f"OK settings — default_vehicle={settings.logistics_default_vehicle!r} "
          f"routing_url={settings.routing_url}")
except Exception as exc:
    print(f"FAIL settings: {exc}")
    traceback.print_exc()
    sys.exit(1)

# 6. Phase 3 still works.
try:
    from app.services import get_market_price_service
    svc = get_market_price_service()
    assert svc._demo_provider is not None
    from app.schemas.market_price import MarketPriceQuery
    response = svc.list_prices(MarketPriceQuery(crop="wheat"))
    assert response.count >= 1
    assert response.is_live is False
    assert response.source == "demo"
    print(f"OK Phase 3 still works — market-prices/wheat returned {response.count} demo rows")
except Exception as exc:
    print(f"FAIL Phase 3 regression: {exc}")
    traceback.print_exc()
    sys.exit(1)

print("\nALL PHASE 4 MODULE A (LOGISTICS) CHECKS PASSED")
