from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# services/ai/app/core/config.py -> repository root
ENV_FILE = Path(__file__).resolve().parents[4] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=ENV_FILE,
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "viralclip-ai-engine"
    node_env: str = "development"
    log_level: str = "info"
    cors_origins: str = "http://localhost:3000"
    local_storage_dir: str = "./storage"
    whisper_model: str = "base"
    whisper_device: str = "cpu"
    whisper_compute_type: str = "int8"
    # Clip detection defaults. Weights can be overridden per request by the worker.
    clip_min_duration_seconds: float = 15.0
    clip_max_duration_seconds: float = 60.0
    clip_target_duration_seconds: float = 35.0
    clip_max_clips: int = 8
    clip_scene_threshold: float = 0.25
    clip_analysis_timeout_seconds: float = 45.0
    clip_weights_json: str = ""

    @property
    def allowed_origins(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


settings = Settings()
