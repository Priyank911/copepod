"""
Repository management router.

Handles:
  POST /repos          → Add repo, create webhook, start ingestion
  GET  /repos          → List user's repos with status
  GET  /repos/{id}     → Get single repo details
  DELETE /repos/{id}   → Remove repo, delete webhook, forget dataset
  GET  /repos/{id}/progress → SSE stream of ingestion progress
"""

from __future__ import annotations

import asyncio
import logging
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sse_starlette.sse import EventSourceResponse

from app.config import get_settings
from app.database import get_db
from app.models.models import IngestionJob, Repo, User
from app.schemas.schemas import RepoCreate, RepoOut
from app.services import cognee_service, github_service, ingestion_service
from app.utils.auth import get_current_user
from app.utils.crypto import decrypt_token

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/repos", tags=["repos"])
settings = get_settings()


@router.post("", response_model=RepoOut, status_code=status.HTTP_201_CREATED)
async def add_repo(
    body: RepoCreate,
    background_tasks: BackgroundTasks,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Add a repository, create a webhook, and start ingestion."""
    full_name = body.full_name.strip().strip("/")

    # Check if already connected
    stmt = select(Repo).where(Repo.user_id == user.id, Repo.full_name == full_name)
    existing = (await db.execute(stmt)).scalar_one_or_none()
    if existing:
        raise HTTPException(status.HTTP_409_CONFLICT, f"Repo '{full_name}' is already connected")

    # Get repo info from GitHub
    token = decrypt_token(user.encrypted_token)
    try:
        repo_info = await asyncio.to_thread(github_service.get_repo_info, token, full_name)
    except Exception as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Repository not found: {e}")

    # Create webhook
    webhook_url = f"{settings.BACKEND_URL}/webhooks/github"
    webhook_id = await asyncio.to_thread(
        github_service.create_webhook,
        token, full_name, webhook_url, settings.WEBHOOK_SECRET,
    )

    # Create repo record
    dataset = settings.dataset_name(user.id, *full_name.split("/", 1))
    repo = Repo(
        user_id=user.id,
        github_repo_id=repo_info["id"],
        full_name=full_name,
        default_branch=repo_info.get("default_branch", "main"),
        webhook_id=webhook_id,
        webhook_active=webhook_id is not None,
        dataset_name=dataset,
    )
    db.add(repo)
    await db.commit()
    await db.refresh(repo)

    # Start background ingestion
    background_tasks.add_task(
        _run_ingest_with_new_session,
        repo.id,
        user.encrypted_token,
    )

    return repo


async def _run_ingest_with_new_session(repo_id: int, encrypted_token: str) -> None:
    """Run ingestion in a fresh DB session (background task)."""
    from app.database import async_session_factory

    async with async_session_factory() as db:
        repo = await db.get(Repo, repo_id)
        if repo:
            await ingestion_service.run_full_ingest(db, repo, encrypted_token)


@router.get("", response_model=list[RepoOut])
async def list_repos(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all repos for the current user."""
    stmt = select(Repo).where(Repo.user_id == user.id).order_by(Repo.created_at.desc())
    result = await db.execute(stmt)
    return result.scalars().all()


@router.get("/{repo_id}", response_model=RepoOut)
async def get_repo(
    repo_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get a single repo by ID."""
    repo = await db.get(Repo, repo_id)
    if not repo or repo.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Repo not found")
    return repo


@router.delete("/{repo_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_repo(
    repo_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Remove a repo: delete webhook, forget Cognee dataset, remove DB record."""
    repo = await db.get(Repo, repo_id)
    if not repo or repo.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Repo not found")

    # Delete GitHub webhook
    if repo.webhook_id:
        token = decrypt_token(user.encrypted_token)
        await asyncio.to_thread(
            github_service.delete_webhook, token, repo.full_name, repo.webhook_id
        )

    # Forget Cognee dataset
    await cognee_service.forget_dataset(repo.dataset_name)

    # Remove from DB
    await db.delete(repo)
    await db.commit()

    logger.info("Removed repo %s for user %s", repo.full_name, user.github_login)


@router.get("/{repo_id}/progress")
async def ingestion_progress(
    repo_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """SSE stream of ingestion progress for a repo."""
    repo = await db.get(Repo, repo_id)
    if not repo or repo.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Repo not found")

    # Find the latest job
    stmt = (
        select(IngestionJob)
        .where(IngestionJob.repo_id == repo_id)
        .order_by(IngestionJob.created_at.desc())
        .limit(1)
    )
    result = await db.execute(stmt)
    job = result.scalar_one_or_none()

    if not job:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No ingestion job found")

    async def event_generator():
        import json
        while True:
            progress = ingestion_service.get_progress(job.id)
            if progress:
                yield {"data": json.dumps(progress)}
                if progress.get("status") in ("completed", "failed"):
                    break
            else:
                yield {"data": json.dumps({"job_id": job.id, "status": job.status.value, "progress": job.progress})}
                if job.status.value in ("completed", "failed"):
                    break
            await asyncio.sleep(1)

    return EventSourceResponse(event_generator())
