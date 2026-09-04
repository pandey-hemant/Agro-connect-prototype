"""Helper to create the backend venv. Run with: python _setup_venv.py"""
import subprocess
import sys
from pathlib import Path

VENV = Path(__file__).parent / "backend" / ".venv"

if VENV.exists():
    print(f"venv already exists at {VENV}")
    sys.exit(0)

VENV.parent.mkdir(parents=True, exist_ok=True)
print(f"Creating venv at {VENV}...")
subprocess.check_call([sys.executable, "-m", "venv", str(VENV)])
print("Done.")
