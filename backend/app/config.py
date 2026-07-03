"""
Application configuration via Pydantic Settings.
All secrets and tunables are loaded from environment variables / .env file.
"""

from __future__ import annotations

import secrets
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(Path(__file__).resolve().parent.parent / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # ── GitHub OAuth App ──────────────────────────────────────────────
    GITHUB_CLIENT_ID: str
    GITHUB_CLIENT_SECRET: str

    # ── Google Gemini (AI Studio) ─────────────────────────────────────
    GEMINI_API_KEY: str

    # ── Security ──────────────────────────────────────────────────────
    ENCRYPTION_KEY: str  # 32-byte hex string for AES-256
    JWT_SECRET: str = secrets.token_urlsafe(32)
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRY_HOURS: int = 72

    # ── Webhook ───────────────────────────────────────────────────────
    WEBHOOK_SECRET: str

    # ── Database ──────────────────────────────────────────────────────
    DATABASE_URL: str = "sqlite+aiosqlite:///./copepod.db"

    # ── Cognee ────────────────────────────────────────────────────────
    COGNEE_LLM_MODEL: str = "gemini/gemini-3.5-flash"
    COGNEE_EMBEDDING_PROVIDER: str = "fastembed"
    COGNEE_EMBEDDING_MODEL: str = "BAAI/bge-small-en-v1.5"
    COGNEE_GRAPH_DB: str = "kuzu"
    COGNEE_VECTOR_DB: str = "lancedb"

    # ── Server ────────────────────────────────────────────────────────
    APP_HOST: str = "0.0.0.0"
    APP_PORT: int = 8000
    FRONTEND_URL: str = "http://localhost:3000"
    BACKEND_URL: str = "http://localhost:8000"

    # ── Helpers ───────────────────────────────────────────────────────
    def dataset_name(self, user_id: int, owner: str, repo: str) -> str:
        """Deterministic dataset key used to isolate Cognee data per repo.

        Cognee rejects dataset names containing dots or spaces,
        so we sanitize by replacing all non-alphanumeric characters with underscores.
        """
        import re
        raw = f"copepod_{user_id}_{owner}_{repo}".lower()
        return re.sub(r"[^a-z0-9_]", "_", raw)


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
