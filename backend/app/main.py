"""FastAPI application entry point for AgroConnect."""
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import health, api_router
from app.core.config import settings

logger = logging.getLogger(__name__)

app = FastAPI(
    title="AgroConnect API",
    version="0.2.0",
    description="Backend for the AgroConnect farmer–market linkage prototype.",
)

# CORS: in dev the frontend runs on a different port than the API.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers — every API route is mounted under /api so the frontend proxy works
# as configured in vite.config.js.
app.include_router(health.router, prefix="/api", tags=["health"])
app.include_router(api_router, prefix="/api", tags=["v1"])


@app.on_event("startup")
def on_startup() -> None:
    """Create tables on startup so a fresh SQLite file just works.

    We import the models package so every model is registered against
    ``Base.metadata`` before ``create_all`` runs. Replace with Alembic
    migrations in a later phase.
    """
    try:
        # Importing the package triggers model registration on Base.
        from app.db.session import engine
        from app.db.base import Base
        import app.models  # noqa: F401  -- side-effect import

        Base.metadata.create_all(bind=engine)
        logger.info("Database tables created successfully")
    except Exception as e:  # pragma: no cover - defensive
        logger.error(f"Failed to create database tables: {e}")
        # Don't crash the app - health endpoint will report database as degraded
        pass
