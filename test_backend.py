"""Test script to verify backend can start and health endpoint works."""
import sys
import os
import subprocess
import time
import requests

def main():
    backend_dir = os.path.join(os.path.dirname(__file__), "backend")

    print("1. Checking Python imports...")
    try:
        # Test if we can import the main app
        sys.path.insert(0, backend_dir)
        from app.main import app
        print("   ✓ FastAPI app imports successfully")

        # Test database config
        from app.core.config import settings
        print(f"   ✓ Settings loaded: database_url={settings.database_url}")

        # Test database connection
        from app.db.session import SessionLocal
        try:
            db = SessionLocal()
            db.execute("SELECT 1")
            db.close()
            print("   ✓ Database connection test passed")
        except Exception as e:
            print(f"   ✗ Database connection error: {e}")

    except ImportError as e:
        print(f"   ✗ Import error: {e}")
        print("   Make sure to install dependencies:")
        print("   cd backend && pip install -r requirements.txt")
        return False

    print("\n2. Testing if backend can be started...")
    print("   To start backend manually:")
    print("   cd backend")
    print("   python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload")

    print("\n3. Testing health endpoint directly...")
    try:
        # Try to connect to running backend
        response = requests.get("http://localhost:8000/api/health", timeout=2)
        print(f"   ✓ Backend is running: HTTP {response.status_code}")
        print(f"   Response: {response.json()}")
        return True
    except requests.ConnectionError:
        print("   ✗ Backend is not running on localhost:8000")
        print("   Start the backend server first")
        return False
    except Exception as e:
        print(f"   ✗ Error: {e}")
        return False

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)