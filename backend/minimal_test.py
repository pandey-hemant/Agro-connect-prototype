"""Minimal test to isolate Python 3.14 typing.Union issue."""
import sys
import traceback
sys.path.insert(0, '.')

print(f"Python {sys.version}")

# Test 1: Just import Pydantic
try:
    import pydantic
    print(f"✓ Pydantic: {pydantic.__version__}")
except Exception as e:
    print(f"❌ Pydantic import failed: {e}")
    traceback.print_exc()

# Test 2: Import pydantic_core
try:
    import pydantic_core
    print(f"✓ pydantic-core: {pydantic_core.__version__}")
except Exception as e:
    print(f"❌ pydantic-core import failed: {e}")
    traceback.print_exc()

# Test 3: Simple Pydantic model
try:
    from pydantic import BaseModel

    class TestModel(BaseModel):
        name: str

    m = TestModel(name="test")
    print(f"✓ Simple Pydantic model works: {m}")
except Exception as e:
    print(f"❌ Simple Pydantic model failed: {e}")
    traceback.print_exc()

# Test 4: Import our actual app models
try:
    from app.db.base import Base
    print(f"✓ SQLAlchemy Base imported")
except Exception as e:
    print(f"❌ SQLAlchemy Base import failed: {e}")
    traceback.print_exc()

# Test 5: Import our models package
try:
    import app.models
    print(f"✓ app.models imported")
except Exception as e:
    print(f"❌ app.models import failed: {e}")
    traceback.print_exc()

# Test 6: Try to create our CropLot model
try:
    from app.models.crop_lot import CropLot
    print(f"✓ CropLot model imported")
except Exception as e:
    print(f"❌ CropLot model import failed: {e}")
    traceback.print_exc()