import sys

import pytest

from app.core.config import settings
from app.services.transcription import (
    TranscriptionError,
    _resolve_audio_path,
    transcribe_audio,
)


def test_storage_key_cannot_escape_storage_root(tmp_path, monkeypatch):
    root = tmp_path / "storage"
    root.mkdir()
    monkeypatch.setattr(settings, "local_storage_dir", str(root))

    with pytest.raises(TranscriptionError, match="Invalid storage key"):
        _resolve_audio_path(None, "../outside.wav")
    assert _resolve_audio_path(None, "audio/clip.wav") == root / "audio" / "clip.wav"


def test_missing_audio_file_is_reported(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "local_storage_dir", str(tmp_path))
    with pytest.raises(TranscriptionError, match="Audio file not found"):
        transcribe_audio(audio_path="missing.wav")


def test_missing_whisper_implementation_is_a_clear_error(tmp_path, monkeypatch):
    audio = tmp_path / "audio.wav"
    audio.write_bytes(b"RIFF")
    monkeypatch.setitem(sys.modules, "faster_whisper", None)
    monkeypatch.setitem(sys.modules, "whisper", None)

    with pytest.raises(TranscriptionError, match="No Whisper implementation installed"):
        transcribe_audio(audio_path=str(audio))


def test_faster_whisper_failure_is_not_silently_ignored(tmp_path, monkeypatch):
    import app.services.transcription as module

    audio = tmp_path / "audio.wav"
    audio.write_bytes(b"RIFF")

    def boom(*_args, **_kwargs):
        raise RuntimeError("model load failed")

    monkeypatch.setattr(module, "_run_faster_whisper", boom)
    with pytest.raises(TranscriptionError, match="Transcription failed: model load failed"):
        transcribe_audio(audio_path=str(audio))
