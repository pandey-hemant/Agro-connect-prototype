@echo off
REM AgroConnect Backend Installation Script
echo ================================
echo AgroConnect Backend Installation
echo ================================
echo.

cd /d "%~dp0backend"

echo Checking Python version...
python --version
echo.

echo Reading requirements.txt...
type requirements.txt
echo.

echo Press any key to continue with installation or Ctrl+C to cancel...
pause > nul
echo.

REM Create fresh venv
if exist ".venv" (
    echo Removing existing virtual environment...
    rmdir /s /q .venv
)

echo Creating fresh Python virtual environment...
python -m venv .venv
if errorlevel 1 (
    echo ERROR: Failed to create virtual environment
    pause
    exit /b 1
)

echo Activating virtual environment...
call .venv\Scripts\activate.bat

echo Installing dependencies...
pip install -r requirements.txt
if errorlevel 1 (
    echo ERROR: Failed to install dependencies
    echo.
    echo Issue: Dependencies may not have wheels for Python 3.14
    echo Solution: Use Python 3.11 or 3.12 instead
    echo.
    pause
    exit /b 1
)

echo.
echo ================================
echo Installation complete!
echo ================================
echo.
echo To start the backend server:
echo   1. Run: start-backend.bat
echo   2. Or manually: cd backend && .venv\Scripts\Activate.bat
echo                     uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
echo.
echo Backend will run at: http://localhost:8000
echo API docs: http://localhost:8000/docs
echo Health check: http://localhost:8000/api/health
echo ================================
echo.
pause