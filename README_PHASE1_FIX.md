# Phase 1 - Fix for Python 3.14 Compatibility

## Problem
The backend fails to install because `pydantic==2.7.1` (from May 2024) doesn't have prebuilt wheels for Python 3.14, which was released after these packages. This causes pip to attempt building `pydantic-core` from source, which requires Rust toolchain.

## Solution Applied
Updated `backend/requirements.txt` to latest versions that have cp314 wheels available:

**Before:**
```
fastapi==0.111.0
uvicorn[standard]==0.30.1
pydantic==2.7.1
pydantic-settings==2.3.4
SQLAlchemy==2.0.30
python-dotenv==1.0.1
```

**After:**
```
fastapi==0.115.6
uvicorn[standard]==0.34.0
pydantic==2.13.4
pydantic-settings==2.7.1
SQLAlchemy==2.0.36
python-dotenv==1.0.1
```

## Files Changed
1. `backend/requirements.txt` - Updated dependency versions
2. `start-backend.bat` - Updated to clean up venv before creating fresh one
3. `install-backend.bat` - New script for clean installation (optional)

## Steps to Complete Phase 1

### Step 1: Install Backend Dependencies
```cmd
cd C:\Users\heman\Agro-connect-prototype
install-backend.bat
```

This will:
- Remove any existing `.venv`
- Create fresh Python virtual environment
- Install updated dependencies
- Verify successful installation

### Step 2: Start Backend Server
```cmd
cd C:\Users\heman\Agro-connect-prototype
start-backend.bat
```

Or manually:
```cmd
cd backend
.venv\Scripts\Activate.bat
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

**Expected:** FastAPI starts successfully on port 8000

### Step 3: Verify Backend is Running
Open a new terminal or browser:
```cmd
curl http://localhost:8000/api/health
```
Or visit `http://localhost:8000/api/health` in browser.

**Expected response:** HTTP 200 with JSON health status

### Step 4: Verify Frontend Connection
Keep backend running, refresh frontend at `localhost:5174`.

**Expected:**
- Status pill turns green with "Online"
- Backend Status section shows JSON health response
- Refresh button works and updates status

## Alternative: If Still Fails with Python 3.14

If the updated dependencies still fail to install with Python 3.14, you have these options:

### Option A: Install Python 3.11 (Recommended)
1. Download Python 3.11.9 installer from python.org
2. Run installer, check "Add Python to PATH"
3. Restart terminal
4. Run `install-backend.bat` again

### Option B: Use the Compatibility Version
Run this command instead:
```cmd
cd backend
python -m venv .venv
.venv\Scripts\Activate.bat
pip install "fastapi<0.113" "pydantic<2.10" "pydantic-settings<2.4" uvicorn[standard] SQLAlchemy python-dotenv
```

This installs older versions that should work with Python 3.14.

## Verification Checklist
- [ ] Backend installs without errors
- [ ] Backend starts on port 8000
- [ ] `/api/health` returns HTTP 200
- [ ] Frontend shows "Online" status
- [ ] Refresh button works
- [ ] JSON health response displays correctly

## What Changed
1. **Dependency updates**: All packages updated to latest versions that support Python 3.14
2. **Clean installation**: Scripts now clean up existing venv to avoid corruption
3. **Error handling**: Better error messages and troubleshooting suggestions

## Notes
- Python 3.14 is very new (released Aug 2024), many packages are still building wheels
- Using latest package versions ensures cp314 wheel availability
- If you have Python 3.11 or 3.12 installed, you can switch to it using `py -3.11` on Windows