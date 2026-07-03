"""
GitHub webhook receiver.

Handles three event types:
  pull_request (merged) → REMEMBER (delta ingest) + IMPROVE (if context was used)
  issues (closed)       → REMEMBER (delta ingest)
  issues (opened)       → AUTO-TRIAGE (recall + comment)
  push                  → FORGET (deleted files pruning)

HMAC-SHA256 signature verification on every request.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Header, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import async_session_factory
from app.models.models import Repo
from app.services import cognee_service, ingestion_service, triage_service
from app.services.formatter import format_improve_entry

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/webhooks", tags=["webhooks"])
settings = get_settings()


def _verify_signature(payload: bytes, signature: str | None) -> bool:
    """Verify GitHub HMAC-SHA256 signature."""
    if not signature:
        return False
    try:
        hash_type, sig = signature.split("=", 1)
    except ValueError:
        return False
    if hash_type != "sha256":
        return False

    mac = hmac.new(
        settings.WEBHOOK_SECRET.encode(),
        msg=payload,
        digestmod=hashlib.sha256,
    )
    return hmac.compare_digest(mac.hexdigest(), sig)


async def _get_repo_by_full_name(full_name: str) -> tuple[Repo | None, AsyncSession]:
    """Look up a repo by its full_name. Returns (repo, db_session).

    IMPORTANT: Caller must close the returned session.
    """
    db: AsyncSession = async_session_factory()
    stmt = select(Repo).where(Repo.full_name == full_name)
    result = await db.execute(stmt)
    repo = result.scalar_one_or_none()
    return repo, db


@router.post("/github")
async def github_webhook(
    request: Request,
    background_tasks: BackgroundTasks,
    x_hub_signature_256: str | None = Header(default=None),
    x_github_event: str | None = Header(default=None),
):
    """
    Receive and process GitHub webhook events.

    This is where REMEMBER, IMPROVE, and FORGET happen naturally
    as part of the normal event flow — not as artificial features.
    """
    # 1. Read raw body for signature verification
    raw_body = await request.body()

    # 2. Verify HMAC signature
    if not _verify_signature(raw_body, x_hub_signature_256):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid webhook signature")

    # 3. Parse payload
    payload = await request.json()
    event = x_github_event
    repo_full_name = payload.get("repository", {}).get("full_name")

    if not repo_full_name:
        return {"status": "ignored", "reason": "no repository"}

    # 4. Look up repo
    repo, db = await _get_repo_by_full_name(repo_full_name)
    if not repo:
        await db.close()
        return {"status": "ignored", "reason": "repo not tracked"}

    try:
        # ── PR Merged → REMEMBER + IMPROVE ────────────────────────────
        if event == "pull_request" and payload.get("action") == "closed":
            if payload["pull_request"].get("merged"):
                logger.info("PR #%d merged on %s", payload["pull_request"]["number"], repo_full_name)

                # REMEMBER: Delta ingest the merged PR
                background_tasks.add_task(
                    _delta_ingest_pr_task, repo.id, payload
                )

                # IMPROVE: If the PR body references Copepod context
                pr_body = payload["pull_request"].get("body", "") or ""
                if "copepod" in pr_body.lower() or "[pr-" in pr_body.lower():
                    background_tasks.add_task(
                        _improve_task, repo.dataset_name, payload["pull_request"]["number"], pr_body
                    )

        # ── Issue Closed → REMEMBER ───────────────────────────────────
        elif event == "issues" and payload.get("action") == "closed":
            logger.info("Issue #%d closed on %s", payload["issue"]["number"], repo_full_name)
            background_tasks.add_task(
                _delta_ingest_issue_task, repo.id, payload
            )

        # ── Issue Opened → AUTO-TRIAGE (RECALL) ──────────────────────
        elif event == "issues" and payload.get("action") == "opened":
            if repo.is_ingested:
                logger.info("New issue #%d on %s — running auto-triage", payload["issue"]["number"], repo_full_name)
                background_tasks.add_task(
                    _triage_task, repo.id, payload
                )

        # ── Push → FORGET (deleted files) ─────────────────────────────
        elif event == "push":
            deleted_files: list[str] = []
            for commit in payload.get("commits", []):
                deleted_files.extend(commit.get("removed", []))

            if deleted_files:
                logger.info("Files deleted on %s: %s", repo_full_name, deleted_files)
                # Forget related nodes for deleted files
                # For now, we log it — full prune requires Cognee's granular forget
                # which operates at dataset level. Individual node pruning is a stretch goal.

    finally:
        await db.close()

    return {"status": "ok"}


# ── Background tasks ─────────────────────────────────────────────────

async def _delta_ingest_pr_task(repo_id: int, payload: dict) -> None:
    async with async_session_factory() as db:
        repo = await db.get(Repo, repo_id)
        if repo:
            await ingestion_service.delta_ingest_pr(db, repo, payload)


async def _delta_ingest_issue_task(repo_id: int, payload: dict) -> None:
    async with async_session_factory() as db:
        repo = await db.get(Repo, repo_id)
        if repo:
            await ingestion_service.delta_ingest_issue(db, repo, payload)


async def _improve_task(dataset_name: str, pr_number: int, pr_body: str) -> None:
    """Write a validated outcome back into the graph."""
    improve_sentence = format_improve_entry(
        pr_number=pr_number,
        context_used="Referenced Copepod context in PR description",
        outcome=f"PR #{pr_number} was merged successfully",
    )
    await cognee_service.remember([improve_sentence], dataset_name)
    await cognee_service.improve(dataset_name)


async def _triage_task(repo_id: int, payload: dict) -> None:
    async with async_session_factory() as db:
        repo = await db.get(Repo, repo_id)
        if repo:
            from app.models.models import User
            user = await db.get(User, repo.user_id)
            if user:
                await triage_service.triage_issue(repo, payload, user.encrypted_token)
