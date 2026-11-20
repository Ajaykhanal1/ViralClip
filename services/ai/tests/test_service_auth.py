from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app


def test_health_endpoints_are_public_without_a_token() -> None:
    client = TestClient(app)
    assert client.get("/health").status_code == 200
    assert client.get("/api/v1/health").status_code == 200


def test_analysis_requires_the_service_token(monkeypatch) -> None:
    monkeypatch.setattr(settings, "service_token", "shared-secret")
    client = TestClient(app)
    payload = {"sourceDurationMs": 1000, "segments": []}

    assert client.post("/api/v1/detect-clips", json=payload).status_code == 401
    response = client.post(
        "/api/v1/detect-clips",
        json=payload,
        headers={"x-ai-service-token": "wrong"},
    )
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "UNAUTHORIZED"

    authorized = client.post(
        "/api/v1/detect-clips",
        json=payload,
        headers={"x-ai-service-token": "shared-secret"},
    )
    assert authorized.status_code == 422  # authorized, but the empty transcript is invalid


def test_invalid_timestamps_are_rejected(monkeypatch) -> None:
    monkeypatch.setattr(settings, "service_token", "")
    client = TestClient(app)
    response = client.post(
        "/api/v1/detect-clips",
        json={
            "sourceDurationMs": 10000,
            "segments": [{"startMs": 5000, "endMs": 1000, "text": "backwards"}],
        },
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"

    negative = client.post(
        "/api/v1/detect-clips",
        json={
            "sourceDurationMs": 10000,
            "segments": [{"startMs": -1, "endMs": 1000, "text": "negative"}],
        },
    )
    assert negative.status_code == 422
