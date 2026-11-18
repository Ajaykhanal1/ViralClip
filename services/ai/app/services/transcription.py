from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from app.core.config import settings


class TranscriptionError(Exception):
    pass


def _resolve_audio_path(audio_path: str | None, storage_key: str | None) -> Path:
    if storage_key:
        root = Path(settings.local_storage_dir)
        if not root.is_absolute():
            # resolve relative to repo root when running from services/ai
            root = (Path(__file__).resolve().parents[4] / settings.local_storage_dir).resolve()
        p = (root / storage_key).resolve()
        if not str(p).startswith(str(root.resolve())):
            raise TranscriptionError("Invalid storage key")
        return p
    if audio_path:
        p = Path(audio_path)
        if not p.is_absolute():
            p = (Path(settings.local_storage_dir) / p).resolve()
        return p
    raise TranscriptionError("audio_path or storage_key is required")


def _run_faster_whisper(path: Path, language: str | None, translate: bool) -> dict[str, Any]:
    from faster_whisper import WhisperModel  # type: ignore

    model = WhisperModel(
        settings.whisper_model,
        device=settings.whisper_device,
        compute_type=settings.whisper_compute_type,
    )
    task = "translate" if translate else "transcribe"
    segments_iter, info = model.transcribe(
        str(path),
        language=language or None,
        task=task,
        word_timestamps=True,
        vad_filter=True,
    )
    segments = []
    for i, seg in enumerate(segments_iter):
        words = None
        if getattr(seg, "words", None):
            words = [
                {
                    "startMs": int(max(0, (w.start or 0)) * 1000),
                    "endMs": int(max(0, (w.end or 0)) * 1000),
                    "text": (w.word or "").strip(),
                    "confidence": getattr(w, "probability", None),
                }
                for w in seg.words
                if (w.word or "").strip()
            ]
        segments.append(
            {
                "index": i,
                "startMs": int(max(0, (seg.start or 0)) * 1000),
                "endMs": int(max(0, (seg.end or 0)) * 1000),
                "text": (seg.text or "").strip(),
                "speaker": None,
                "words": words,
            }
        )
    return {
        "language": info.language,
        "detectedLanguage": info.language,
        "duration": getattr(info, "duration", None),
        "model": settings.whisper_model,
        "segments": segments,
    }


def _run_openai_whisper(path: Path, language: str | None, translate: bool) -> dict[str, Any]:
    import whisper  # type: ignore

    model = whisper.load_model(settings.whisper_model)
    task = "translate" if translate else "transcribe"
    result = model.transcribe(str(path), language=language or None, task=task, word_timestamps=True, verbose=False)
    segments = []
    for i, seg in enumerate(result.get("segments", []) or []):
        words = None
        if seg.get("words"):
            words = [
                {
                    "startMs": int(max(0, (w.get("start") or 0)) * 1000),
                    "endMs": int(max(0, (w.get("end") or 0)) * 1000),
                    "text": str(w.get("word") or "").strip(),
                    "confidence": w.get("probability"),
                }
                for w in seg.get("words") or []
                if str(w.get("word") or "").strip()
            ]
        segments.append(
            {
                "index": i,
                "startMs": int(max(0, (seg.get("start") or 0)) * 1000),
                "endMs": int(max(0, (seg.get("end") or 0)) * 1000),
                "text": str(seg.get("text") or "").strip(),
                "speaker": None,
                "words": words,
            }
        )
    return {
        "language": result.get("language"),
        "detectedLanguage": result.get("language"),
        "duration": None,
        "model": settings.whisper_model,
        "segments": segments,
    }


def transcribe_audio(
    audio_path: str | None = None,
    storage_key: str | None = None,
    language: str | None = None,
    translate: bool = False,
) -> dict[str, Any]:
    path = _resolve_audio_path(audio_path, storage_key)
    if not path.exists():
        raise TranscriptionError(f"Audio file not found: {path}")
    # Try faster-whisper first, then openai-whisper.
    try:
        return _run_faster_whisper(path, language, translate)
    except ModuleNotFoundError:
        pass
    except Exception as e:
        # If faster-whisper is installed but fails, surface error (do not silently fall back).
        raise TranscriptionError(f"Transcription failed: {e}") from e
    try:
        return _run_openai_whisper(path, language, translate)
    except ModuleNotFoundError as e:
        raise TranscriptionError(
            "No Whisper implementation installed. Install faster-whisper or openai-whisper."
        ) from e
    except Exception as e:
        raise TranscriptionError(f"Transcription failed: {e}") from e
