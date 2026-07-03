"""
Authentication helpers: JWT creation/verification and FastAPI dependencies
that support both JWT (web sessions) and API-key (MCP / VS Code) auth.
"""

from __future__ import annotations

import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import Depends, Header, HTTPException, Request, status
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.models.models import User

logger = logging.getLogger(__name__)
settings = get_settings()


# ── JWT helpers ───────────────────────────────────────────────────────

def create_jwt(user_id: int, github_login: str) -> str:
    """Issue a short-lived JWT for browser sessions."""
    expire = datetime.now(timezone.utc) + timedelta(hours=settings.JWT_EXPIRY_HOURS)
    payload = {
        "sub": str(user_id),
        "login": github_login,
        "exp": expire,
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def decode_jwt(token: str) -> dict:
    """Decode & verify a JWT. Raises on expiry or tampering."""
    return jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])


# ── API key generation ────────────────────────────────────────────────

def generate_api_key() -> str:
    """Generate a cryptographically secure API key (cpd_ prefix)."""
    return f"cpd_{secrets.token_urlsafe(32)}"


# ── FastAPI dependencies ──────────────────────────────────────────────

async def _resolve_user(
    db: AsyncSession,
    *,
    jwt_token: str | None = None,
    api_key: str | None = None,
) -> User:
    """Resolve a User from either a JWT or an API key."""
    if jwt_token:
        try:
            payload = decode_jwt(jwt_token)
            user_id = int(payload["sub"])
        except (JWTError, KeyError, ValueError) as exc:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token") from exc
        user = await db.get(User, user_id)
        if not user:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User not found")
        return user

    if api_key:
        stmt = select(User).where(User.api_key == api_key)
        result = await db.execute(stmt)
        user = result.scalar_one_or_none()
        if not user:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid API key")
        return user

    raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Missing credentials")


async def get_current_user(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    authorization: str | None = Header(default=None),
    x_api_key: str | None = Header(default=None, alias="X-API-Key"),
) -> User:
    """
    Dual-mode auth dependency.

    • Browser sessions  → Authorization: Bearer <jwt>
    • MCP / VS Code     → X-API-Key: cpd_xxxxx
    """
    jwt_token: str | None = None

    if authorization and authorization.lower().startswith("bearer "):
        jwt_token = authorization[7:]

    # Also check cookies for web sessions
    if not jwt_token:
        jwt_token = request.cookies.get("access_token")

    return await _resolve_user(db, jwt_token=jwt_token, api_key=x_api_key)
