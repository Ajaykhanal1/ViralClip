import hmac
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app import __version__
from app.api.routes import detect_clips, health, transcribe
from app.core.config import settings
from app.core.logging import configure_logging, logger

configure_logging(settings.log_level)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    logger.info("AI engine starting", extra={"environment": settings.node_env})
    yield
    logger.info("AI engine stopped")


app = FastAPI(
    title="ViralClip AI Engine",
    version=__version__,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def require_service_token(request: Request, call_next):  # type: ignore[no-untyped-def]
    # Liveness is public so orchestrators do not need the shared secret.
    if settings.service_token and request.url.path not in ("/health", "/api/v1/health"):
        supplied = request.headers.get("x-ai-service-token", "")
        if not hmac.compare_digest(supplied, settings.service_token):
            return JSONResponse(
                status_code=401,
                content={
                    "success": False,
                    "error": {"code": "UNAUTHORIZED", "message": "Service token required"},
                },
            )
    return await call_next(request)


@app.middleware("http")
async def request_context(request: Request, call_next):  # type: ignore[no-untyped-def]
    request_id = request.headers.get("x-request-id") or str(uuid4())
    request.state.request_id = request_id
    started = time.perf_counter()

    response = await call_next(request)

    duration_ms = round((time.perf_counter() - started) * 1000)
    response.headers["x-request-id"] = request_id
    logger.info(
        "request completed",
        extra={
            "request_id": request_id,
            "method": request.method,
            "path": request.url.path,
            "status_code": response.status_code,
            "duration_ms": duration_ms,
        },
    )
    return response


def _serializable_validation_details(exc: RequestValidationError) -> list[dict[str, object]]:
    # Pydantic puts exception instances in `ctx`, which is not JSON serializable.
    details: list[dict[str, object]] = []
    for issue in exc.errors():
        item: dict[str, object] = dict(issue)
        ctx = item.get("ctx")
        if isinstance(ctx, dict):
            item["ctx"] = {key: str(value) for key, value in ctx.items()}
        details.append(item)
    return details


@app.exception_handler(RequestValidationError)
async def validation_error_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content={
            "success": False,
            "error": {
                "code": "VALIDATION_ERROR",
                "message": "Request validation failed",
                "details": _serializable_validation_details(exc),
            },
            "requestId": getattr(request.state, "request_id", None),
        },
    )


@app.exception_handler(StarletteHTTPException)
async def http_error_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "success": False,
            "error": {"code": "HTTP_ERROR", "message": str(exc.detail)},
            "requestId": getattr(request.state, "request_id", None),
        },
    )


@app.exception_handler(Exception)
async def unhandled_error_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception(
        "unhandled error",
        extra={"request_id": getattr(request.state, "request_id", None)},
    )
    return JSONResponse(
        status_code=500,
        content={
            "success": False,
            "error": {
                "code": "INTERNAL_ERROR",
                "message": "An unexpected error occurred",
            },
            "requestId": getattr(request.state, "request_id", None),
        },
    )


app.include_router(health.router)
app.include_router(transcribe.router)
app.include_router(detect_clips.router)
