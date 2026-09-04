"""Test SQLAlchemy Python 3.14 compatibility."""
import sys
import traceback

print(f"Python version: {sys.version}")

# Test 1: Check SQLAlchemy version
try:
    import sqlalchemy
    print(f"✓ SQLAlchemy imported: version {sqlalchemy.__version__}")
except Exception as e:
    print(f"❌ SQLAlchemy import failed: {e}")
    traceback.print_exc()
    sys.exit(1)

# Test 2: Check typing module
try:
    from typing import Union, Optional
    print(f"✓ typing imports work")
    print(f"  Union type: {type(Union)}")
    print(f"  Optional type: {type(Optional)}")

    # Test Union behavior
    u = Union[int, str]
    print(f"  Union[int, str] = {u}, type = {type(u)}")

    # Check if it supports __getitem__
    if hasattr(u, '__getitem__'):
        print(f"  Union has __getitem__: {u.__getitem__}")
    else:
        print(f"  ⚠ Union does not have __getitem__")

except Exception as e:
    print(f"❌ typing test failed: {e}")
    traceback.print_exc()

# Test 3: Try to import our CropLot model
try:
    sys.path.insert(0, '.')
    from app.models.crop_lot import CropLot
    print(f"✓ CropLot model imported successfully")
    print(f"  Table: {CropLot.__tablename__}")
    print(f"  Columns: {[c.name for c in CropLot.__table__.columns]}")
except Exception as e:
    print(f"❌ CropLot model import failed: {e}")
    traceback.print_exc()

# Test 4: Try to import the main app
try:
    from app.main import app
    print(f"✓ FastAPI app imported successfully")
    print(f"  Title: {app.title}")
    print(f"  Version: {app.version}")

    # Count routes
    routes = [r.path for r in app.routes if hasattr(r, 'path')]
    print(f"  Total routes: {len(routes)}")
    for r in sorted(routes):
        if r:
            print(f"    {r}")
except Exception as e:
    print(f"❌ FastAPI app import failed: {e}")
    traceback.print_exc()

# Test 5: Test database table creation
try:
    from app.db.session import engine
    from app.db.base import Base
    import app.models  # noqa: F401

    print(f"✓ Database models loaded")
    print(f"  Tables to create: {list(Base.metadata.tables.keys())}")

    # Try to create tables
    Base.metadata.create_all(bind=engine)
    print(f"✓ Tables created successfully")
except Exception as e:
    print(f"❌ Table creation failed: {e}")
    traceback.print_exc()