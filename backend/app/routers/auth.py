"""
GitHub OAuth authentication router.

Flow:
  GET /auth/github/login      → redirect to GitHub
  GET /auth/github/callback    → exchange code → create user → set JWT cookie
  GET /auth/me                 → return current user info
  POST /auth/api-key/regenerate → generate a new API key for MCP/VS Code
"""

from __future__ import annotations

import logging

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.models.models import User
from app.schemas.schemas import UserOut
from app.utils.auth import create_jwt, generate_api_key, get_current_user
from app.utils.crypto import encrypt_token

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/auth", tags=["auth"])
settings = get_settings()


@router.get("/github/login")
async def github_login():
    """Redirect the user to GitHub's OAuth authorization page."""
    params = (
        f"client_id={settings.GITHUB_CLIENT_ID}"
        f"&redirect_uri={settings.BACKEND_URL}/auth/github/callback"
        f"&scope=repo admin:repo_hook read:user"
    )
    return RedirectResponse(f"https://github.com/login/oauth/authorize?{params}")


@router.get("/github/callback")
async def github_callback(
    code: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Exchange the OAuth code for an access token and create/update the user."""
    # 1. Exchange code for access token
    async with httpx.AsyncClient() as client:
        token_resp = await client.post(
            "https://github.com/login/oauth/access_token",
            json={
                "client_id": settings.GITHUB_CLIENT_ID,
                "client_secret": settings.GITHUB_CLIENT_SECRET,
                "code": code,
            },
            headers={"Accept": "application/json"},
        )

    if token_resp.status_code != 200:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Failed to exchange code for token")

    token_data = token_resp.json()
    if "error" in token_data:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            token_data.get("error_description", token_data["error"]),
        )

    access_token = token_data["access_token"]

    # 2. Fetch user profile from GitHub
    async with httpx.AsyncClient() as client:
        user_resp = await client.get(
            "https://api.github.com/user",
            headers={
                "Authorization": f"Bearer {access_token}",
                "Accept": "application/vnd.github+json",
            },
        )

    if user_resp.status_code != 200:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Failed to fetch GitHub user")

    gh_user = user_resp.json()
    github_id = gh_user["id"]
    github_login = gh_user["login"]

    # 3. Create or update user in DB
    stmt = select(User).where(User.github_id == github_id)
    result = await db.execute(stmt)
    user = result.scalar_one_or_none()

    encrypted = encrypt_token(access_token)

    if user:
        user.encrypted_token = encrypted
        user.github_login = github_login
        user.github_name = gh_user.get("name")
        user.avatar_url = gh_user.get("avatar_url")
    else:
        user = User(
            github_id=github_id,
            github_login=github_login,
            github_name=gh_user.get("name"),
            avatar_url=gh_user.get("avatar_url"),
            encrypted_token=encrypted,
            api_key=generate_api_key(),
        )
        db.add(user)

    await db.commit()
    await db.refresh(user)

    # 4. Issue JWT and redirect to Studio
    jwt_token = create_jwt(user.id, user.github_login)
    response = RedirectResponse(f"{settings.FRONTEND_URL}/studio")
    response.set_cookie(
        "access_token",
        jwt_token,
        httponly=True,
        secure=False,  # True in production with HTTPS
        samesite="lax",
        max_age=settings.JWT_EXPIRY_HOURS * 3600,
    )
    return response


@router.get("/me", response_model=UserOut)
async def get_me(user: User = Depends(get_current_user)):
    """Return the currently authenticated user."""
    return user


@router.post("/api-key/regenerate", response_model=UserOut)
async def regenerate_api_key(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Generate a new API key for MCP and VS Code authentication."""
    user.api_key = generate_api_key()
    await db.commit()
    await db.refresh(user)
    return user
