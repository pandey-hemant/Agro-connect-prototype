#!/usr/bin/env python3
"""Test script to verify Python 3.14 compatibility of updated dependencies."""

import subprocess
import sys
import os

def run_command(cmd, cwd=None):
    """Run a command and capture output."""
    print(f"Running: {cmd}")
    try:
        result = subprocess.run(cmd, shell=True, capture_output=True, text=True, cwd=cwd)
        if result.returncode == 0:
            print(f"✓ Success")
            print(result.stdout[:500] if result.stdout else "(no output)")
            return True
        else:
            print(f"✗ Failed (code {result.returncode})")
            print(f"Stderr: {result.stderr[:500] if result.stderr else '(none)'}")
            return False
    except Exception as e:
        print(f"✗ Exception: {e}")
        return False

def main():
    print("=" * 60)
    print("Python 3.14 Dependency Compatibility Test")
    print("=" * 60)

    # Check Python version
    python_version = sys.version_info
    print(f"Python version: {python_version.major}.{python_version.minor}.{python_version.micro}")

    if python_version.major != 3 or python_version.minor != 14:
        print("⚠ Warning: This test is designed for Python 3.14")

    backend_dir = os.path.join(os.path.dirname(__file__), "backend")
    os.chdir(backend_dir)

    print("\n1. Creating fresh virtual environment...")
    if os.path.exists(".venv-test"):
        run_command("rmdir /s /q .venv-test", cwd=backend_dir)

    if not run_command("python -m venv .venv-test", cwd=backend_dir):
        print("\nFailed to create virtual environment")
        return False

    # Activate and install (simplified - Windows)
    venv_script = os.path.join(backend_dir, ".venv-test", "Scripts", "activate.bat")

    print("\n2. Testing pydantic-core wheel availability...")
    pip_test_cmd = f".venv-test\\Scripts\\python.exe -m pip download pydantic==2.13.4 --no-deps"
    if not run_command(pip_test_cmd, cwd=backend_dir):
        print("⚠ pydantic 2.13.4 may not have cp314 wheel")

    print("\n3. Testing installation with updated requirements...")
    install_cmd = ".venv-test\\Scripts\\python.exe -m pip install fastapi==0.115.6 uvicorn[standard]==0.34.0 pydantic==2.13.4 pydantic-settings==2.7.1 SQLAlchemy==2.0.36 python-dotenv==1.0.1"

    print("\nStarting installation (this may take a few minutes)...")
    if run_command(install_cmd, cwd=backend_dir):
        print("\n✓ Dependencies installed successfully!")

        print("\n4. Testing import of FastAPI app...")
        import_test_cmd = ".venv-test\\Scripts\\python.exe -c \"from app.main import app; print('✓ FastAPI app imports successfully')\""
        if run_command(import_test_cmd, cwd=backend_dir):
            print("\n" + "=" * 60)
            print("✅ SUCCESS: Backend is compatible with Python 3.14")
            print("=" * 60)
            print("\nTo complete Phase 1:")
            print("1. Run: install-backend.bat (in project root)")
            print("2. Run: start-backend.bat (in project root)")
            print("3. Verify backend at: http://localhost:8000/api/health")
            print("4. Refresh frontend at: http://localhost:5174")
            return True
        else:
            print("\n✗ FastAPI app import failed")
    else:
        print("\n" + "=" * 60)
        print("❌ FAILED: Dependencies not compatible with Python 3.14")
        print("=" * 60)
        print("\nRecommended solution:")
        print("1. Install Python 3.11 or 3.12")
        print("2. Or try these older compatible versions:")
        print("   pip install \"fastapi<0.113\" \"pydantic<2.10\" \"pydantic-settings<2.4\" uvicorn[standard] SQLAlchemy python-dotenv")

        print("\nPython 3.11 installation:")
        print("- Download from https://www.python.org/downloads/release/python-3119/")
        print("- Check 'Add Python to PATH' during installation")
        print("- Restart terminal, then run install-backend.bat again")

    return False

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)