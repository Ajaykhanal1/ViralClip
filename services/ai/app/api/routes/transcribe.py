from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services.transcription import TranscriptionError, transcribe_audio

router = APIRouter(tags=["transcription"])


class TranscribeRequest(BaseModel):
    audioPath: str | None = None
    storageKey: str | None = None
    language: str | None = Field(
        default=None, description="Manual language code; null/omit to auto-detect"
    )
    translateToEnglish: bool = False


@router.post("/api/v1/transcribe")
def transcribe(req: TranscribeRequest) -> dict[str, Any]:
    if not req.audioPath and not req.storageKey:
        raise HTTPException(status_code=422, detail="audioPath or storageKey is required")
    try:
        result = transcribe_audio(
            audio_path=req.audioPath,
            storage_key=req.storageKey,
            language=req.language,
            translate=req.translateToEnglish,
        )
        return {"success": True, "data": result}
    except TranscriptionError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Transcription failed: {e}") from e
