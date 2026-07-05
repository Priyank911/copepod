"""
Ingestion pipeline — orchestrates full and delta repository ingestion.

Full ingest: runs two parallel tracks
  1. GitHub metadata (PRs, issues, commits) → formatted sentences
  2. Source code (Python AST) → formatted sentences

Both tracks feed into cognee.remember() for the same dataset.

Delta ingest: processes a single PR or issue from a webhook event.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import IngestionJob, IngestionStatus, IngestionKind, Repo, User
from app.services import formatter, code_parser, cognee_service, github_service, diff_analyzer
from app.utils.crypto import decrypt_token

logger = logging.getLogger(__name__)

# In-memory progress tracking for SSE
_progress: dict[int, dict] = {}


def get_progress(job_id: int) -> dict | None:
    return _progress.get(job_id)


async def _update_progress(
    db: AsyncSession, job: IngestionJob, progress: int, message: str,
) -> None:
    """Update job progress in both DB and in-memory cache."""
    job.progress = progress
    job.message = message
    _progress[job.id] = {
        "job_id": job.id,
        "status": job.status.value,
        "progress": progress,
        "message": message,
    }
    await db.commit()


async def run_full_ingest(
    db: AsyncSession,
    repo: Repo,
    github_token_encrypted: str,
) -> None:
    """
    Full repository ingestion — called when a user adds a new repo.

    Two parallel tracks:
    1. GitHub metadata (PRs, issues)
    2. Source code structure (Python AST)
    """
    token = decrypt_token(github_token_encrypted)

    # Create job record
    job = IngestionJob(
        repo_id=repo.id,
        kind=IngestionKind.FULL,
        status=IngestionStatus.RUNNING,
        started_at=datetime.now(timezone.utc),
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)

    try:
        all_sentences: list[str] = []

        # ── Track 1: GitHub Metadata ──────────────────────────────────
        await _update_progress(db, job, 10, "Fetching merged pull requests...")

        prs = await asyncio.to_thread(
            github_service.fetch_merged_prs, token, repo.full_name, limit=100
        )
        for idx, pr in enumerate(prs):
            diff_analysis = None
            clean_body = (pr["body"] or "").strip()
            is_recent = idx < 5
            is_low_quality = not clean_body or len(clean_body) < 30
            
            # Fetch and analyze patches only if recent or human rationale is poor/missing
            if is_recent or is_low_quality:
                patches = await asyncio.to_thread(
                    github_service.fetch_pr_patches, token, repo.full_name, pr["number"]
                )
                if patches:
                    diff_analysis = await asyncio.to_thread(
                        diff_analyzer.analyze_pr_diff, pr["number"], pr["title"], patches
                    )
            
            all_sentences.append(formatter.format_pr(
                number=pr["number"],
                title=pr["title"],
                body=pr["body"],
                author=pr["author"],
                merged_at=pr["merged_at"],
                files=pr["files"],
                reviews=pr.get("reviews"),
                diff_analysis=diff_analysis,
            ))

        await _update_progress(db, job, 30, f"Processed {len(prs)} PRs. Fetching issues...")

        issues = await asyncio.to_thread(
            github_service.fetch_closed_issues, token, repo.full_name, limit=100
        )
        for issue in issues:
            all_sentences.append(formatter.format_issue(
                number=issue["number"],
                title=issue["title"],
                body=issue["body"],
                labels=issue["labels"],
                closed_at=issue["closed_at"],
                author=issue["author"],
            ))

        await _update_progress(db, job, 50, f"Processed {len(issues)} issues. Fetching source code...")

        # ── Track 2: Source Code Structure ────────────────────────────
        source_files = await asyncio.to_thread(
            github_service.fetch_source_files, token, repo.full_name
        )
        code_count = 0
        for f in source_files:
            sentences = code_parser.parse_source_file(f["path"], f["content"])
            all_sentences.extend(sentences)
            code_count += len(sentences)

        await _update_progress(
            db, job, 70,
            f"Extracted {code_count} code entities. Ingesting into Cognee..."
        )

        # ── Feed into Cognee ──────────────────────────────────────────
        if all_sentences:
            # Batch into chunks of 50 sentences
            batch_size = 50
            for i in range(0, len(all_sentences), batch_size):
                batch = all_sentences[i : i + batch_size]
                await cognee_service.remember(batch, repo.dataset_name)

                pct = 70 + int(30 * (i + len(batch)) / len(all_sentences))
                await _update_progress(
                    db, job, min(pct, 99),
                    f"Ingested {i + len(batch)}/{len(all_sentences)} sentences..."
                )

        # ── Done ──────────────────────────────────────────────────────
        job.status = IngestionStatus.COMPLETED
        job.progress = 100
        job.message = (
            f"Ingested {len(prs)} PRs, {len(issues)} issues, "
            f"{code_count} code entities ({len(all_sentences)} total sentences)"
        )
        job.completed_at = datetime.now(timezone.utc)
        repo.is_ingested = True
        await db.commit()

        _progress[job.id] = {
            "job_id": job.id,
            "status": "completed",
            "progress": 100,
            "message": job.message,
        }

        logger.info("Full ingest completed for %s: %s", repo.full_name, job.message)

    except Exception as e:
        logger.exception("Full ingest failed for %s", repo.full_name)
        job.status = IngestionStatus.FAILED
        job.error = str(e)
        job.completed_at = datetime.now(timezone.utc)
        await db.commit()

        _progress[job.id] = {
            "job_id": job.id,
            "status": "failed",
            "progress": job.progress,
            "message": f"Failed: {e}",
            "error": str(e),
        }


async def delta_ingest_pr(
    db: AsyncSession,
    repo: Repo,
    pr_data: dict,
) -> None:
    """Delta ingest a single merged PR from a webhook event."""
    job = IngestionJob(
        repo_id=repo.id,
        kind=IngestionKind.DELTA,
        status=IngestionStatus.RUNNING,
        started_at=datetime.now(timezone.utc),
    )
    db.add(job)
    await db.commit()

    try:
        pr = pr_data["pull_request"]
        
        # Resolve token and analyze diff
        user = await db.get(User, repo.user_id)
        token = decrypt_token(user.encrypted_token) if user else None
        
        diff_analysis = None
        if token:
            patches = await asyncio.to_thread(
                github_service.fetch_pr_patches, token, repo.full_name, pr["number"]
            )
            if patches:
                diff_analysis = await asyncio.to_thread(
                    diff_analyzer.analyze_pr_diff, pr["number"], pr["title"], patches
                )

        sentences = [formatter.format_pr(
            number=pr["number"],
            title=pr["title"],
            body=pr.get("body"),
            author=pr["user"]["login"],
            merged_at=datetime.fromisoformat(pr["merged_at"].replace("Z", "+00:00")) if pr.get("merged_at") else None,
            files=[f["filename"] for f in pr.get("files", [])],
            diff_analysis=diff_analysis,
        )]

        await cognee_service.remember(sentences, repo.dataset_name)

        job.status = IngestionStatus.COMPLETED
        job.progress = 100
        job.message = f"Delta ingested PR #{pr['number']}"
        job.completed_at = datetime.now(timezone.utc)
        await db.commit()

        logger.info("Delta ingested PR #%d for %s", pr["number"], repo.full_name)

    except Exception as e:
        logger.exception("Delta ingest failed for PR in %s", repo.full_name)
        job.status = IngestionStatus.FAILED
        job.error = str(e)
        await db.commit()


async def delta_ingest_issue(
    db: AsyncSession,
    repo: Repo,
    issue_data: dict,
) -> None:
    """Delta ingest a single closed issue from a webhook event."""
    try:
        issue = issue_data["issue"]
        closed_at = None
        if issue.get("closed_at"):
            closed_at = datetime.fromisoformat(issue["closed_at"].replace("Z", "+00:00"))

        sentences = [formatter.format_issue(
            number=issue["number"],
            title=issue["title"],
            body=issue.get("body"),
            labels=[lbl["name"] for lbl in issue.get("labels", [])],
            closed_at=closed_at,
            author=issue["user"]["login"],
        )]

        await cognee_service.remember(sentences, repo.dataset_name)
        logger.info("Delta ingested issue #%d for %s", issue["number"], repo.full_name)

    except Exception:
        logger.exception("Delta ingest failed for issue in %s", repo.full_name)
