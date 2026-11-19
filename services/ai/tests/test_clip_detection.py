from fastapi.testclient import TestClient

from app.main import app
from app.services.clip_detection import DetectClipsRequest, detect_clips

client = TestClient(app)

SEGMENTS = [
    {
        "startMs": 0,
        "endMs": 6000,
        "text": "Did you know? Most people get this wrong.",
        "speaker": "A",
    },
    {
        "startMs": 6000,
        "endMs": 12000,
        "text": "Here is the truth: the answer is simple, but surprising.",
        "speaker": "A",
    },
    {
        "startMs": 12000,
        "endMs": 18000,
        "text": "Watch this. The result will shock you!",
        "speaker": "B",
    },
    {"startMs": 18000, "endMs": 24000, "text": "That is why it works.", "speaker": "B"},
]


def _request(**overrides: object) -> DetectClipsRequest:
    payload: dict[str, object] = {
        "sourceDurationMs": 24000,
        "segments": SEGMENTS,
        "minDurationSeconds": 15,
        "maxDurationSeconds": 30,
        "sceneChangesMs": [3000, 9000, 15000, 21000],
        "audioLevels": [
            70,
            80,
            65,
            90,
            75,
            60,
            85,
            70,
            55,
            80,
            65,
            75,
            60,
            70,
            80,
            65,
            70,
            60,
            75,
            65,
            70,
            60,
            55,
            50,
        ],
    }
    payload.update(overrides)
    return DetectClipsRequest.model_validate(payload)


def test_detects_ranked_clips_with_required_fields() -> None:
    result = detect_clips(_request())

    assert result.clips
    assert result.candidatesGenerated >= len(result.clips)
    first = result.clips[0]
    assert first.candidateId
    assert 0 <= first.startMs < first.endMs <= result.sourceDurationMs
    assert first.startMs <= first.hookMs <= first.endMs
    assert first.durationMs == first.endMs - first.startMs
    assert first.suggestedTitle and first.description and first.transcript
    assert 0 <= first.engagementScore <= 100
    assert first.subtitleConfig.position == "bottom"
    assert set(first.signals.model_dump()) == {
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
    }


def test_timestamps_are_clamped_to_actual_duration() -> None:
    result = detect_clips(_request(sourceDurationMs=20000))

    assert result.clips
    assert all(clip.endMs <= 20000 for clip in result.clips)
    assert all(0 <= clip.startMs < clip.endMs for clip in result.clips)


def test_overlapping_candidates_are_skipped() -> None:
    result = detect_clips(_request(maxDurationSeconds=40))

    assert result.overlappingSkipped > 0
    for index, clip in enumerate(result.clips):
        for other in result.clips[index + 1 :]:
            overlap = min(clip.endMs, other.endMs) - max(clip.startMs, other.startMs)
            assert overlap <= 0.4 * min(clip.durationMs, other.durationMs)


def test_weights_are_configurable_and_score_is_not_a_virality_guarantee() -> None:
    result = detect_clips(
        _request(
            weights={
                "hookStrength": 10,
                **{name: 0 for name in result_weights() if name != "hookStrength"},
            }
        )
    )

    assert result.weights.hookStrength == 10
    for clip in result.clips:
        assert clip.engagementScore == round(clip.signals.hookStrength, 1)
        assert "do not predict guaranteed virality" in clip.explanation
    assert "do not predict guaranteed virality" in result.disclaimer


def result_weights() -> tuple[str, ...]:
    from app.services.clip_detection import SIGNAL_NAMES

    return SIGNAL_NAMES


def test_endpoint_returns_validated_envelope() -> None:
    response = client.post(
        "/api/v1/detect-clips",
        json={
            "sourceDurationMs": 18000,
            "segments": SEGMENTS,
            "minDurationSeconds": 15,
            "maxDurationSeconds": 30,
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["success"] is True
    assert body["data"]["sourceDurationMs"] == 18000
    assert isinstance(body["data"]["clips"], list)


def test_endpoint_rejects_missing_transcript() -> None:
    response = client.post(
        "/api/v1/detect-clips",
        json={"sourceDurationMs": 18000, "segments": []},
    )

    assert response.status_code == 422
    assert response.json()["success"] is False
