from functools import lru_cache
from pathlib import Path
from typing import Literal

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
    ai_provider: Literal["local", "openai", "gemini"] = "local"
    ai_max_context_chars: int = 2000
    ai_outline_heading_limit: int = 5
    ai_daily_quota_owner: int = 25
    ai_daily_quota_editor: int = 15
    ai_daily_quota_viewer: int = 0
    openai_base_url: str = "https://api.openai.com/v1"
    openai_api_key: str | None = None
    openai_model: str = "gpt-4.1-mini"
    openai_input_cost_per_1k_tokens: float = 0.0
    openai_output_cost_per_1k_tokens: float = 0.0
    gemini_base_url: str = "https://generativelanguage.googleapis.com/v1beta"
    gemini_api_key: str | None = None
    gemini_model: str = "gemini-2.5-flash-lite"
    gemini_input_cost_per_1k_tokens: float = 0.0
    gemini_output_cost_per_1k_tokens: float = 0.0

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


@lru_cache
def get_settings() -> Settings:
    return Settings()
