"""Phase 3 verification — backend imports cleanly and routes are wired."""
import sys
import traceback

print(f"Python: {sys.version}")

try:
    from app.main import app
    print("OK app imported")
    paths = sorted({r.path for r in app.routes if hasattr(r, "path")})
    print(f"  total routes: {len(paths)}")
    for p in paths:
        if p:
            print(f"    {p}")
except Exception as exc:
    print(f"FAIL importing app: {exc}")
    traceback.print_exc()
    sys.exit(1)

try:
    from app.services import get_market_price_service
    svc = get_market_price_service()
    print("OK service constructed")
    print(f"  live provider:  {svc._live_provider.name}")
    print(f"  demo provider:  {svc._demo_provider.name}")
except Exception as exc:
    print(f"FAIL constructing service: {exc}")
    traceback.print_exc()
    sys.exit(1)

try:
    from app.schemas.market_price import MarketPriceQuery
    demo = svc._demo_provider
    q = MarketPriceQuery()
    records = demo.fetch_prices(q)
    assert records, "demo provider returned no records"
    for r in records[:3]:
        assert r.is_live is False
        assert r.source == "demo"
    print(f"OK demo provider returned {len(records)} records, all is_live=False")
except Exception as exc:
    print(f"FAIL demo provider: {exc}")
    traceback.print_exc()
    sys.exit(1)

try:
    q = MarketPriceQuery(crop="tomato")
    response = svc.list_prices(q)
    print(f"OK service.list_prices returned {response.count} records")
    print(f"   source={response.source!r}  is_live={response.is_live}")
    assert response.count >= 1
    assert response.is_live is False
    assert response.source == "demo"
    print("OK fallback to demo provider when live provider is unconfigured")
except Exception as exc:
    print(f"FAIL service.list_prices: {exc}")
    traceback.print_exc()
    sys.exit(1)

try:
    q = MarketPriceQuery(crop="wheat")
    response = svc.list_prices(q)
    assert all(r.crop == "wheat" for r in response.results)
    print(f"OK filter by crop='wheat' returned {response.count} records")
except Exception as exc:
    print(f"FAIL filter: {exc}")
    traceback.print_exc()
    sys.exit(1)

try:
    h = svc.health()
    print(f"OK health: provider_name={h.provider_name!r} "
          f"is_live={h.is_live} demo_fallback={h.demo_fallback_enabled}")
except Exception as exc:
    print(f"FAIL health: {exc}")
    traceback.print_exc()
    sys.exit(1)

print("\nALL PHASE 3 BACKEND CHECKS PASSED")
