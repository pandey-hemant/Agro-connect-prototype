@echo off
REM Convenience script: create venv, install deps, run the API on Windows.
setlocal
cd /d "%~dp0"

if not exist ".venv" (
    python -m venv .venv
)

call .venv\Scripts\activate.bat

pip install -q -r requirements.txt

uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
