"""Health-check endpoint used by the frontend and load balancers."""
import traceback
from fastapi import APIRouter
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.db.session import SessionLocal

router = APIRouter()


@router.get("/health", summary="Liveness + DB ping")
def health() -> dict:
    """Return service status and whether the database is reachable."""
    db_ok = True
    db_error: str | None = None
    db_details: str | None = None

    try:
        db = SessionLocal()
        try:
            # Test database connection with simple query
            db.execute(text("SELECT 1"))
        except SQLAlchemyError as exc:
            db_ok = False
            db_error = str(exc)
            db_details = traceback.format_exc()
        finally:
            db.close()
    except Exception as exc:
        # If we can't even create a session (e.g., config error)
        db_ok = False
        db_error = f"Session creation failed: {exc}"
        db_details = traceback.format_exc()

    return {
        "status": "ok" if db_ok else "degraded",
        "service": "agroconnect-api",
        "version": "0.1.0",
        "database": "ok" if db_ok else "error",
        "database_error": db_error,
        "timestamp": __import__("datetime").datetime.now().isoformat(),
    }
