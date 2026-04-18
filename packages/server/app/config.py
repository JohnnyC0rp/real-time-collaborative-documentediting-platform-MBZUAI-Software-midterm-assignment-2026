from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    app_name: str = "Collaborative Document Editor"
    app_origin: str = "http://localhost:5173"
    api_port: int = 8000
    jwt_secret: str = Field(default="replace-this-secret-with-32-bytes", min_length=32)
    jwt_algorithm: str = "HS256"
    access_token_ttl_minutes: int = 20
    refresh_token_ttl_days: int = 7
    refresh_cookie_name: str = "collab_refresh_token"
    secure_cookies: bool = False
    data_file: Path = REPO_ROOT / "packages/server/data/app-data.json"
    ai_provider: str = "mock"
    ai_model: str = "mock-local"
    ai_base_url: str = "http://localhost:1234/v1"
    ai_api_key: str | None = None
    ai_prompt_file: Path = REPO_ROOT / "packages/server/app/ai_prompts.json"
    ai_max_source_chars: int = 2400
    ai_max_context_chars: int = 800

    model_config = SettingsConfigDict(
        env_file=str(REPO_ROOT / ".env"),
        env_file_encoding="utf-8",
        extra="ignore"
    )

    @field_validator("data_file", mode="before")
    @classmethod
    def resolve_data_file(cls, value: str | Path) -> Path:
        candidate = Path(value)
        if candidate.is_absolute():
            return candidate

        return REPO_ROOT / candidate

    @field_validator("ai_prompt_file", mode="before")
    @classmethod
    def resolve_ai_prompt_file(cls, value: str | Path) -> Path:
        candidate = Path(value)
        if candidate.is_absolute():
            return candidate

        return REPO_ROOT / candidate


@lru_cache
def get_settings() -> Settings:
    return Settings()
