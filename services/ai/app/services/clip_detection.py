"""Heuristic clip detection: transcript + scene + audio signals -> ranked short clips.

Scores are relative engagement signals, not predictions of virality.
"""

from __future__ import annotations

import json
import math
import os
import re
import subprocess
import wave
from array import array
from dataclasses import dataclass
from pathlib import Path
from statistics import mean
from uuid import uuid4

from pydantic import BaseModel, Field, model_validator

from app.core.config import settings

SIGNAL_NAMES = (
    "hookStrength",
    "emotionalIntensity",
    "interestingStatements",
    "storyCompleteness",
    "educationalValue",
    "dialogueQuality",
    "sceneChanges",
    "speakerChanges",
    "audioEnergy",
    "visualInterest",
)

DEFAULT_WEIGHTS: dict[str, float] = {
    "hookStrength": 1.6,
    "emotionalIntensity": 1.1,
    "interestingStatements": 1.0,
    "storyCompleteness": 1.2,
    "educationalValue": 0.8,
    "dialogueQuality": 0.7,
    "sceneChanges": 0.8,
    "speakerChanges": 0.6,
    "audioEnergy": 0.7,
    "visualInterest": 0.7,
}

SIGNAL_LABELS = {
    "hookStrength": "hook strength",
    "emotionalIntensity": "emotional intensity",
    "interestingStatements": "interesting statements",
    "storyCompleteness": "story completeness",
    "educationalValue": "educational value",
    "dialogueQuality": "dialogue quality",
    "sceneChanges": "scene changes",
    "speakerChanges": "speaker changes",
    "audioEnergy": "audio energy",
    "visualInterest": "visual interest",
}

DISCLAIMER = (
    "Engagement scores are heuristic signals for review only; "
    "they do not predict guaranteed virality."
)

HOOK_PATTERNS = (
    r"\bdid you know\b",
    r"\bthe (truth|secret|reason|catch)\b",
    r"\bwhat if\b",
    r"\bmost people\b",
    r"\bnever\b",
    r"\bstop\b",
    r"\bwhy\b",
    r"\bhow\b",
    r"\bwatch this\b",
    r"\bhere.s why\b",
    r"\bnumber \d+\b",
)
EMOTION_WORDS = (
    "amazing",
    "incredible",
    "shocking",
    "insane",
    "terrifying",
    "brilliant",
    "unbelievable",
    "heartbreaking",
    "furious",
    "terrible",
    "love",
    "hate",
    "fear",
    "angry",
    "surprised",
    "stunned",
    "wild",
    "crazy",
    "perfect",
    "disaster",
    "victory",
)
INTEREST_WORDS = (
    "because",
    "however",
    "actually",
    "but",
    "yet",
    "instead",
    "unexpectedly",
    "research",
    "study",
    "percent",
    "%",
    "million",
    "billion",
    "first",
    "last",
    "best",
    "worst",
    "never",
    "always",
    "everyone",
    "nobody",
)
EDUCATION_WORDS = (
    "because",
    "so",
    "why",
    "how",
    "step",
    "learn",
    "means",
    "example",
    "research",
    "study",
    "proof",
    "according",
    "explains",
    "reason",
    "simple",
    "method",
    "technique",
)
VISUAL_WORDS = ("look", "see", "watch", "here", "this", "picture", "imagine", "screen", "show")

STOP_WORDS = frozenset(
    (
        "the a an and or but if then than so to of in on for with is are was were "
        "be been it its this that these those i you he she we they them their our "
        "your my me at as by from into about just really very"
    ).split()
)


class ClipDetectionError(Exception):
    pass


class TranscriptSegmentIn(BaseModel):
    startMs: int = Field(ge=0)
    endMs: int = Field(ge=0)
    text: str
    speaker: str | None = None

    @model_validator(mode="after")
    def _ordered_timestamps(self) -> TranscriptSegmentIn:
        if self.endMs <= self.startMs:
            raise ValueError("endMs must be greater than startMs")
        return self


class DetectClipsRequest(BaseModel):
    sourceDurationMs: int = Field(gt=0)
    storageKey: str | None = None
    audioStorageKey: str | None = None
    segments: list[TranscriptSegmentIn]
    minDurationSeconds: float | None = None
    maxDurationSeconds: float | None = None
    maxClips: int | None = None
    weights: dict[str, float] | None = None
    sceneChangesMs: list[float] | None = None
    audioLevels: list[float] | None = None


class ClipSignalScores(BaseModel):
    hookStrength: float
    emotionalIntensity: float
    interestingStatements: float
    storyCompleteness: float
    educationalValue: float
    dialogueQuality: float
    sceneChanges: float
    speakerChanges: float
    audioEnergy: float
    visualInterest: float


class SuggestedSubtitleConfig(BaseModel):
    enabled: bool = True
    position: str = "bottom"
    fontSize: int = 32
    textColor: str = "#FFFFFF"
    backgroundColor: str = "rgba(0,0,0,0.6)"
    outlineColor: str = "#000000"
    maxWordsPerLine: int = 5
    highlightKeywords: list[str] = Field(default_factory=list)


class DetectedClip(BaseModel):
    candidateId: str
    startMs: int
    endMs: int
    durationMs: int
    hookMs: int
    transcript: str
    suggestedTitle: str
    description: str
    engagementScore: float
    explanation: str
    signals: ClipSignalScores
    subtitleConfig: SuggestedSubtitleConfig


class DetectClipsResponse(BaseModel):
    analysisKey: str
    model: str
    sourceDurationMs: int
    candidatesGenerated: int
    overlappingSkipped: int
    duplicateSkipped: int
    weights: ClipSignalScores
    disclaimer: str
    clips: list[DetectedClip]


@dataclass
class _Sentence:
    startMs: int
    endMs: int
    text: str
    complete: bool


@dataclass
class _IdeaUnit:
    startMs: int
    endMs: int
    text: str
    complete: bool
    speaker: str | None
    energy: float = 50.0


def _clamp(value: float, low: float = 0.0, high: float = 100.0) -> float:
    return max(low, min(high, value))


def _resolve_media_path(storage_key: str) -> Path:
    root = Path(settings.local_storage_dir)
    if not root.is_absolute():
        # Storage keys are shared with the Node worker, which resolves them from the repo root.
        root = (Path(__file__).resolve().parents[4] / settings.local_storage_dir).resolve()
    root = root.resolve()
    path = (root / storage_key).resolve()
    if not str(path).startswith(str(root) + os.sep) and path != root:
        raise ClipDetectionError("Invalid storage key")
    return path


def resolve_weights(overrides: dict[str, float] | None) -> dict[str, float]:
    base = dict(DEFAULT_WEIGHTS)
    configured = settings.clip_weights_json.strip()
    if configured:
        try:
            parsed = json.loads(configured)
        except json.JSONDecodeError as exc:
            raise ClipDetectionError("clip_weights_json must be valid JSON") from exc
        if not isinstance(parsed, dict):
            raise ClipDetectionError("clip_weights_json must be an object")
        for name, value in parsed.items():
            if name in base and isinstance(value, (int, float)) and value >= 0:
                base[name] = float(value)
    for name, value in (overrides or {}).items():
        if name in base and isinstance(value, (int, float)) and value >= 0:
            base[name] = float(value)
    if sum(base.values()) <= 0:
        raise ClipDetectionError("At least one signal weight must be greater than zero")
    return base


def read_audio_levels(path: Path, duration_ms: int, bin_ms: int = 1000) -> list[float]:
    """Return coarse RMS levels (0-100) from the 16 kHz mono WAV artifact."""
    try:
        with wave.open(str(path), "rb") as wav:
            if wav.getsampwidth() != 2 or wav.getnchannels() < 1:
                return []
            rate = wav.getframerate()
            channels = wav.getnchannels()
            samples = array("h")
            samples.frombytes(wav.readframes(wav.getnframes()))
    except (OSError, wave.Error):
        return []

    if not samples or rate <= 0:
        return []

    step = max(1, rate // 2000)  # ~2 kHz is plenty for loudness bins.
    mono = samples[::channels] if channels > 1 else samples
    sampled = mono[::step]
    bin_size = max(1, round((rate / step) * bin_ms / 1000))
    raw = []
    for offset in range(0, len(sampled), bin_size):
        chunk = sampled[offset : offset + bin_size]
        if chunk:
            rms = math.sqrt(sum(sample * sample for sample in chunk) / len(chunk)) / 32768 * 100
            raw.append(rms)
    peak = max(raw) if raw else 0.0
    if peak <= 0:
        return []
    levels = [_clamp(value / peak * 100) for value in raw]
    expected = max(1, math.ceil(duration_ms / bin_ms))
    return (levels + [0.0] * expected)[:expected]


def detect_scene_changes(path: Path, threshold: float, timeout: float) -> list[float]:
    """Timestamps (ms) where FFmpeg's scene score crosses the configured threshold."""
    command = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "info",
        "-nostats",
        "-i",
        str(path),
        "-vf",
        f"select='gt(scene,{threshold})',showinfo",
        "-an",
        "-f",
        "null",
        os.devnull,
    ]
    try:
        result = subprocess.run(  # noqa: S603 - fixed argument list, no shell
            command,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
        # Shortcut: scene cues are optional; without FFmpeg the other signals still score clips.
        return []
    return [
        round(float(value) * 1000)
        for value in re.findall(r"pts_time:([0-9]+(?:\.[0-9]+)?)", result.stderr)
    ]


def _sentences(text: str) -> list[str]:
    return [
        part.strip() for part in re.findall(r"[^.!?…]+(?:[.!?…]+[\"')\]]*)?", text) if part.strip()
    ]


def build_idea_units(segments: list[TranscriptSegmentIn], duration_ms: int) -> list[_IdeaUnit]:
    """Split transcript segments into complete ideas without cutting sentences in half."""
    timed: list[_Sentence] = []
    for segment in segments:
        start = max(0, min(duration_ms, segment.startMs))
        end = max(start, min(duration_ms, segment.endMs))
        text = segment.text.strip()
        if not text or end <= start:
            continue
        parts = _sentences(text)
        if not parts:
            continue
        total = sum(len(part) for part in parts)
        cursor = start
        for index, part in enumerate(parts):
            part_end = (
                end
                if index == len(parts) - 1
                else start
                + round((end - start) * (sum(len(p) for p in parts[: index + 1]) / total))
            )
            timed.append(
                _Sentence(
                    startMs=cursor,
                    endMs=part_end,
                    text=part,
                    complete=part[-1] in ".!?…)",
                )
            )
            cursor = part_end

    units: list[_IdeaUnit] = []
    buffer: list[_Sentence] = []
    for sentence in timed:
        buffer.append(sentence)
        span = buffer[-1].endMs - buffer[0].startMs
        if sentence.complete or span >= 15000:
            units.append(
                _IdeaUnit(
                    startMs=buffer[0].startMs,
                    endMs=buffer[-1].endMs,
                    text=" ".join(item.text for item in buffer),
                    complete=buffer[-1].complete,
                    speaker=None,
                )
            )
            buffer = []
    if buffer:
        units.append(
            _IdeaUnit(
                startMs=buffer[0].startMs,
                endMs=buffer[-1].endMs,
                text=" ".join(item.text for item in buffer),
                complete=buffer[-1].complete,
                speaker=None,
            )
        )

    # Re-attach speakers from the original segments by time overlap.
    for unit in units:
        matching = [
            seg.speaker
            for seg in segments
            if seg.speaker and seg.startMs < unit.endMs and seg.endMs > unit.startMs
        ]
        unit.speaker = matching[0] if matching else None
    return units


def _levels_in_range(levels: list[float], start_ms: int, end_ms: int) -> list[float]:
    if not levels:
        return []
    start = max(0, int(start_ms // 1000))
    end = max(start + 1, math.ceil(end_ms / 1000))
    return levels[start:end]


def _count_regex(text: str, patterns: tuple[str, ...]) -> int:
    lowered = text.lower()
    return sum(len(re.findall(pattern, lowered)) for pattern in patterns)


def _count_words(text: str, words: tuple[str, ...]) -> int:
    lowered = text.lower()
    return sum(lowered.count(word) for word in words)


def score_candidate(
    units: list[_IdeaUnit],
    start_ms: int,
    end_ms: int,
    scene_ms: list[float],
    levels: list[float],
    weights: dict[str, float],
    target_ms: int,
    source_start_ms: int,
) -> dict[str, float]:
    window = [unit for unit in units if unit.startMs < end_ms and unit.endMs > start_ms]
    text = " ".join(unit.text for unit in window)
    duration_s = max(1, (end_ms - start_ms) / 1000)
    hook_text = " ".join(unit.text for unit in window if unit.startMs < start_ms + 4000)
    hook_lower = hook_text.lower()
    in_scenes = [t for t in scene_ms if start_ms <= t <= end_ms]
    in_levels = _levels_in_range(levels, start_ms, end_ms)
    speaker_transitions = sum(
        1
        for prev, curr in zip(window, window[1:], strict=False)
        if prev.speaker and curr.speaker and prev.speaker != curr.speaker
    )
    distinct_speakers = len({unit.speaker for unit in window if unit.speaker})
    sentences = _sentences(text)
    exclamations = text.count("!")

    hook = 15.0
    hook += 20 if "?" in hook_text else 0
    hook += 30 if _count_regex(hook_lower, HOOK_PATTERNS) else 0
    hook += 10 if exclamations and window and window[0].endMs <= start_ms + 1200 else 0
    hook += 10 if start_ms == source_start_ms else 0
    hook += min(15, max(0, mean(in_levels[:3]) / 5)) if in_levels else 0

    emotion = 12 + _count_words(text, EMOTION_WORDS) * 18 + exclamations * 10
    interesting = (
        12
        + len(re.findall(r"\b\d+(?:\.\d+)?\b|%", text)) * 9
        + _count_words(text, INTEREST_WORDS) * 7
    )
    education = 10 + _count_words(text, EDUCATION_WORDS) * 12
    dialogue = (
        70 + min(30, speaker_transitions * 10)
        if distinct_speakers >= 2
        else 45 + min(25, len(sentences) * 5)
    )
    completeness = 0.0
    completeness += 40 if window and window[-1].complete else 10
    completeness += 20 if len(window) >= 2 else 0
    completeness += 20 if abs((end_ms - start_ms) - target_ms) <= 10000 else 8
    completeness += 20 if start_ms == source_start_ms else 5

    expected_scenes = max(1, duration_s / 8)
    scene_ratio = len(in_scenes) / expected_scenes
    scene_value = min(100, scene_ratio * 65) if scene_ms else 50
    speaker_value = (
        min(100, 30 + speaker_transitions / max(1, duration_s / 10) * 50)
        if distinct_speakers >= 2
        else 30
    )
    audio_value = mean(in_levels) if in_levels else 50
    visual_value = 20 + min(60, scene_ratio * 35) + min(30, _count_words(text, VISUAL_WORDS) * 8)

    return {
        "hookStrength": _clamp(hook),
        "emotionalIntensity": _clamp(emotion),
        "interestingStatements": _clamp(interesting),
        "storyCompleteness": _clamp(completeness),
        "educationalValue": _clamp(education),
        "dialogueQuality": _clamp(dialogue),
        "sceneChanges": _clamp(scene_value),
        "speakerChanges": _clamp(speaker_value),
        "audioEnergy": _clamp(audio_value),
        "visualInterest": _clamp(visual_value),
    }


def _first_sentence(text: str, limit: int = 90) -> str:
    sentence = (_sentences(text) or [text])[0].strip()
    if len(sentence) <= limit:
        return sentence
    return sentence[:limit].rsplit(" ", 1)[0].rstrip(",.;:") + "…"


def _description(units: list[_IdeaUnit], start_ms: int, end_ms: int) -> str:
    window = [unit.text for unit in units if unit.startMs < end_ms and unit.endMs > start_ms]
    text = " ".join(window)
    sentences = _sentences(text)
    summary = " ".join(sentences[:2]) if sentences else text
    if len(sentences) > 2:
        summary = f"{summary} … {sentences[-1]}"
    if len(summary) > 240:
        summary = summary[:237].rsplit(" ", 1)[0] + "…"
    return summary


def _highlight_keywords(text: str) -> list[str]:
    words = [word.strip(".,!?;:\"'()[]") for word in text.split()]
    unique: list[str] = []
    for word in words:
        lowered = word.lower()
        if (
            len(word) >= 5
            and lowered not in STOP_WORDS
            and lowered not in [item.lower() for item in unique]
        ):
            unique.append(word)
    return unique[:4]


def _overlap_ratio(a: DetectedClip, b: DetectedClip) -> float:
    intersection = min(a.endMs, b.endMs) - max(a.startMs, b.startMs)
    if intersection <= 0:
        return 0.0
    return intersection / min(a.endMs - a.startMs, b.endMs - b.startMs)


def _text_similarity(a: str, b: str) -> float:
    from difflib import SequenceMatcher

    return SequenceMatcher(None, a.lower(), b.lower()).ratio()


def detect_clips(request: DetectClipsRequest) -> DetectClipsResponse:
    duration = request.sourceDurationMs
    min_seconds = max(
        5.0,
        settings.clip_min_duration_seconds
        if request.minDurationSeconds is None
        else request.minDurationSeconds,
    )
    max_seconds = (
        settings.clip_max_duration_seconds
        if request.maxDurationSeconds is None
        else request.maxDurationSeconds
    )
    max_ms = min(round(max_seconds * 1000), duration)
    min_ms = min(round(min_seconds * 1000), max_ms)
    if min_ms <= 0 or max_ms <= 0:
        raise ClipDetectionError("Clip duration must be positive")
    target_ms = round(settings.clip_target_duration_seconds * 1000)
    max_clips = max(1, min(20, request.maxClips or settings.clip_max_clips))
    weights = resolve_weights(request.weights)

    segments = [segment for segment in request.segments if segment.endMs > segment.startMs]
    if not segments:
        raise ClipDetectionError("No transcript segments were provided")

    units = build_idea_units(segments, duration)
    if not units:
        raise ClipDetectionError("Transcript segments have no usable text")

    if request.audioLevels is not None:
        levels = [_clamp(float(value)) for value in request.audioLevels]
    elif request.audioStorageKey:
        levels = read_audio_levels(_resolve_media_path(request.audioStorageKey), duration)
    else:
        levels = []
    for unit in units:
        unit.energy = mean(_levels_in_range(levels, unit.startMs, unit.endMs)) if levels else 50.0
    # Drop silent padding between ideas; keep at least one unit when the whole clip is quiet.
    voiced = [unit for unit in units if unit.energy >= 5]
    units = voiced or units

    if request.sceneChangesMs is not None:
        scenes = sorted(_clamp(float(t), 0, duration) for t in request.sceneChangesMs)
    elif request.storageKey:
        scenes = [
            t
            for t in detect_scene_changes(
                _resolve_media_path(request.storageKey),
                settings.clip_scene_threshold,
                settings.clip_analysis_timeout_seconds,
            )
            if 0 <= t <= duration
        ]
    else:
        scenes = []

    candidates: dict[tuple[int, int], DetectedClip] = {}
    for i in range(len(units)):
        for j in range(i + 1, min(len(units), i + 200) + 1):
            start_ms = units[i].startMs
            end_ms = units[j - 1].endMs
            span = end_ms - start_ms
            if span < min_ms:
                continue
            if span > max_ms:
                break
            candidate_units = units[i:j]
            signals = score_candidate(
                units, start_ms, end_ms, scenes, levels, weights, target_ms, units[0].startMs
            )
            score = round(
                sum(signals[name] * weight for name, weight in weights.items())
                / sum(weights.values()),
                1,
            )
            window_text = " ".join(unit.text for unit in candidate_units)
            hook_unit = max(
                candidate_units,
                key=lambda unit: score_candidate(
                    units,
                    unit.startMs,
                    unit.endMs,
                    scenes,
                    levels,
                    weights,
                    target_ms,
                    units[0].startMs,
                )["hookStrength"],
            )
            hook_ms = min(max(hook_unit.startMs, start_ms), end_ms)
            top_signals = sorted(signals.items(), key=lambda item: item[1], reverse=True)[:3]
            reasons = [f"{SIGNAL_LABELS[name]} {value:.0f}/100" for name, value in top_signals]
            scenes_in_range = [t for t in scenes if start_ms <= t <= end_ms]
            speaker_changes = sum(
                1
                for a, b in zip(candidate_units, candidate_units[1:], strict=False)
                if a.speaker and b.speaker and a.speaker != b.speaker
            )
            explanation = (
                f"{', '.join(reasons)}. {len(scenes_in_range)} scene change(s) and "
                f"{speaker_changes} speaker change(s) inside this window. {DISCLAIMER}"
            )
            title = _first_sentence(window_text)
            clip = DetectedClip(
                candidateId=f"clip-{start_ms}-{end_ms}",
                startMs=start_ms,
                endMs=end_ms,
                durationMs=span,
                hookMs=hook_ms,
                transcript=window_text,
                suggestedTitle=title,
                description=_description(units, start_ms, end_ms),
                engagementScore=score,
                explanation=explanation,
                signals=ClipSignalScores(**signals),
                subtitleConfig=SuggestedSubtitleConfig(
                    highlightKeywords=_highlight_keywords(window_text[:400])
                ),
            )
            key = (start_ms, end_ms)
            previous = candidates.get(key)
            if previous is None or clip.engagementScore > previous.engagementScore:
                candidates[key] = clip

    ranked = sorted(
        candidates.values(),
        key=lambda clip: (-clip.engagementScore, clip.startMs, clip.endMs),
    )
    selected: list[DetectedClip] = []
    overlapping = 0
    duplicates = 0
    for clip in ranked:
        if any(_overlap_ratio(clip, chosen) > 0.4 for chosen in selected):
            overlapping += 1
            continue
        if any(_text_similarity(clip.transcript, chosen.transcript) > 0.9 for chosen in selected):
            duplicates += 1
            continue
        selected.append(clip)
        if len(selected) >= max_clips:
            break

    # Final boundary validation: every timestamp must fit the actual source duration.
    for clip in selected:
        clip.startMs = max(0, min(duration, clip.startMs))
        clip.endMs = max(clip.startMs, min(duration, clip.endMs))
        clip.hookMs = max(clip.startMs, min(clip.endMs, clip.hookMs))
        clip.durationMs = clip.endMs - clip.startMs

    return DetectClipsResponse(
        analysisKey=uuid4().hex[:16],
        model="heuristic-signal-scorer-v1",
        sourceDurationMs=duration,
        candidatesGenerated=len(candidates),
        overlappingSkipped=overlapping,
        duplicateSkipped=duplicates,
        weights=ClipSignalScores(**weights),
        disclaimer=DISCLAIMER,
        clips=selected,
    )
