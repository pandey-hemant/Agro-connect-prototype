"""Test Python 3.14 compatibility for Pydantic."""
import sys

print(f"Python version: {sys.version}")
print(f"Python implementation: {sys.implementation.name}")

# Test 1: Basic typing imports
try:
    from typing import Optional, Union
    print("✓ typing imports work")
except Exception as e:
    print(f"❌ typing import failed: {e}")

# Test 2: Test typing.Union behavior
try:
    from typing import Union

    # Test if Union is a proper class in Python 3.14
    u = Union[int, str]
    print(f"✓ Union test: {u}")

    # Check if it has __getitem__
    if hasattr(u, '__getitem__'):
        print(f"  Union.__getitem__ exists: {u.__getitem__}")
except Exception as e:
    print(f"❌ Union test failed: {e}")
    import traceback
    traceback.print_exc()

# Test 3: Try importing Pydantic with the new requirements
try:
    import pydantic
    print(f"✓ Pydantic imported: {pydantic.__version__}")

    # Test a simple model
    from pydantic import BaseModel

    class SimpleModel(BaseModel):
        name: str
        age: Optional[int] = None

    m = SimpleModel(name="test")
    print(f"✓ Simple Pydantic model works: {m}")

except Exception as e:
    print(f"❌ Pydantic import/model failed: {e}")
    import traceback
    traceback.print_exc()

# Test 4: Try importing our schemas
try:
    # First add current directory to path
    import os
    import sys
    sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

    from app.schemas.crop_lot import CropLotCreate
    print("✓ CropLotCreate schema imported")

    # Test creating an instance
    test_data = {
        "crop_name": "Tomato",
        "crop_variety": "Roma",
        "quantity": 100.0,
        "quantity_unit": "kg",
        "harvest_date": "2026-09-01",
        "location": "Test Village",
    }

    lot = CropLotCreate(**test_data)
    print(f"✓ CropLotCreate instantiated: {lot}")

except Exception as e:
    print(f"❌ Our schemas import failed: {e}")
    import traceback
    traceback.print_exc()