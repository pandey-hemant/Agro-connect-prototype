"""Quick standalone test that verifies the FastAPI routes load correctly.

Run this with `python verify_api.py` (or from within the .venv) to ensure
no import errors. Does NOT start a server — just validates the code
compiles and routes are mounted as expected.
"""
import sys
sys.path.insert(0, ".")

def main() -> None:
    try:
        from app.main import app

        # Collect routes that have a path attribute
        routes = []
        for route in app.routes:
            if hasattr(route, "path"):
                routes.append(route.path)

        print("✓ Backend imports OK")
        print(f"Found {len(routes)} routes:")
        for r in sorted(routes):
            if r:  # skip the root "/" placeholder
                print(f"  {r}")

        # Quick sanity: make sure crop-lots endpoints are present
        crop_lot_routes = [r for r in routes if "crop-lots" in r]
        if crop_lot_routes:
            print("\n✓ Crop-lot routes present:")
            for r in crop_lot_routes:
                print(f"  {r}")
        else:
            print("\n❌ No crop-lot routes found (check api_router)")

    except ImportError as e:
        print(f"❌ Import failed: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"❌ Unexpected error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
