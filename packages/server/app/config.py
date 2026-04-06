from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    app_name: str = "Collaborative Document Editor"
    app_origin: str = "http://localhost:5173"
    api_port: int = 8000
    jwt_secret: str = Field(default="replace-this-secret", min_length=16)
    jwt_algorithm: str = "HS256"
    access_token_ttl_minutes: int = 20
    refresh_token_ttl_days: int = 7
    refresh_cookie_name: str = "collab_refresh_token"
    secure_cookies: bool = False
    data_file: Path = REPO_ROOT / "packages/server/data/app-data.json"

    model_config = SettingsConfigDict(
        env_file=str(REPO_ROOT / ".env"),
        env_file_encoding="utf-8",
        extra="ignore"
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
