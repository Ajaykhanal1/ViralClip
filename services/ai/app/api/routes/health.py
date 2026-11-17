from datetime import UTC, datetime

from fastapi import APIRouter

from app import __version__
from app.core.config import settings

router = APIRouter(tags=["health"])


@router.get("/health")
@router.get("/api/v1/health")
def health() -> dict[str, object]:
    return {
        "status": "ok",
        "service": settings.app_name,
        "version": __version__,
        "environment": settings.node_env,
        "timestamp": datetime.now(UTC).isoformat(),
    }
