@echo off
REM AgroConnect Backend Startup Script
echo ================================
echo AgroConnect Backend Startup
echo ================================
echo.

cd /d "%~dp0backend"

REM Clean up existing venv if present
if exist ".venv" (
    echo Removing existing virtual environment...
    rmdir /s /q .venv
)

REM Check if venv exists
if not exist ".venv" (
    echo Creating fresh Python virtual environment...
    python -m venv .venv
    if errorlevel 1 (
        echo ERROR: Failed to create virtual environment
        pause
        exit /b 1
    )
)

REM Activate venv
echo Activating virtual environment...
call .venv\Scripts\activate.bat

REM Install dependencies
echo.
echo Installing dependencies...
pip install -q -r requirements.txt
if errorlevel 1 (
    echo ERROR: Failed to install dependencies
    echo.
    echo Common issues:
    echo - Python 3.14 may not have prebuilt wheels for some packages
    echo - Try using Python 3.11 or 3.12 instead
    echo.
    pause
    exit /b 1
)

REM Start the server
echo.
echo ================================
echo Starting FastAPI server...
echo Backend will run at: http://localhost:8000
echo API docs available at: http://localhost:8000/docs
echo Health check: http://localhost:8000/api/health
echo ================================
echo.
echo Press Ctrl+C to stop the server
echo.

uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload