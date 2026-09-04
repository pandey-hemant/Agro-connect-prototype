# AgroConnect — Phase 1 Prototype

AgroConnect is a prototype platform that strengthens market linkages between
farmers, FPOs, and buyers. **This repository contains only the Phase 1
scaffolding** — the foundation needed to build, run, and connect the frontend
and backend. Authentication, crop lots, market prices, matching, negotiation,
FPO tooling, ML, and recommendations are intentionally out of scope and will
land in later phases.

## Repository layout

```
Agro-connect-prototype/
├── frontend/         # React + Vite + Tailwind + Redux Toolkit + React Router
└── backend/          # FastAPI + SQLAlchemy + SQLite (dev) / Postgres-ready
```

## Prerequisites

- Node.js 18+ and npm
- Python 3.10+ (3.11 recommended)

## Quick start

Open two terminals.

### 1. Backend (FastAPI) — port 8000

```bash
cd backend
python -m venv .venv
# macOS / Linux
source .venv/bin/activate
# Windows (PowerShell)
# .venv\Scripts\Activate.ps1

pip install -r requirements.txt
cp .env.example .env    # optional, defaults work for dev
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

Or use the helper scripts: `backend/run.sh` (macOS/Linux) or
`backend/run.bat` (Windows).

Once running, visit:

- Health: <http://localhost:8000/api/health>
- OpenAPI docs: <http://localhost:8000/docs>

### 2. Frontend (Vite + React) — port 5173

```bash
cd frontend
npm install
npm run dev
```

Open <http://localhost:5173>. The landing page calls `/api/health` through the
Vite dev proxy (configured in `frontend/vite.config.js`) and displays the
backend's response.

## How frontend ↔ backend are wired

- All API routes are mounted under `/api` on the FastAPI side
  (e.g. `GET /api/health`).
- In development, Vite proxies `/api/*` to `http://localhost:8000`, so the
  frontend can call `/api/health` directly without CORS friction.
- The Axios instance in `frontend/src/api/axios.js` defaults to `/api` and
  picks up `VITE_API_BASE_URL` for production builds.

## Phase 1 deliverables (this commit)

1. React + Vite frontend
2. Tailwind CSS (with a custom `primary` green palette)
3. React Router (landing route wired up)
4. Redux Toolkit (store + a `health` slice that calls the backend)
5. FastAPI backend
6. Database configuration (SQLAlchemy + SQLite default, Postgres-ready)
7. Frontend ↔ backend connection (Axios + Vite proxy)
8. Basic health-check endpoint (`GET /api/health`, also pings the DB)
9. Basic landing page
10. This README

## What is **not** in Phase 1

Auth, crop lots, market prices, matching, negotiation, FPO features, ML, and
recommendations are explicitly deferred to later phases. The backend includes
a placeholder `api_router` in `app/api/__init__.py` where those features will
be mounted.

## Production build (frontend)

```bash
cd frontend
npm run build
npm run preview
```

For deployment, set `VITE_API_BASE_URL` to the public backend URL before
running `npm run build`.
