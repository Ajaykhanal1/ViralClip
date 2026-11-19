from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import ValidationError

from app.services.clip_detection import (
    ClipDetectionError,
    DetectClipsRequest,
    DetectClipsResponse,
    detect_clips,
)

router = APIRouter(tags=["clip-detection"])


@router.post("/api/v1/detect-clips")
def detect(req: DetectClipsRequest) -> dict[str, Any]:
    try:
        result: DetectClipsResponse = detect_clips(req)
    except (ClipDetectionError, ValidationError) as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    return {"success": True, "data": result.model_dump()}
