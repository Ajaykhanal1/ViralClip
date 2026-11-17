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

    @property
    def allowed_origins(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


settings = Settings()
