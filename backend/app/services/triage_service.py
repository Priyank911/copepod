"""
Auto issue triage service.

When a new issue opens on a watched repo (via webhook), this service:
1. Recalls related context from Cognee
2. Formats a helpful comment with related PRs, affected files, regression check
3. Posts the comment on the GitHub issue via PyGithub

This delivers value without the user asking for it.
"""

from __future__ import annotations

import logging
from typing import Any

from app.models.models import Repo
from app.services import cognee_service, github_service
from app.utils.crypto import decrypt_token

logger = logging.getLogger(__name__)


async def triage_issue(
    repo: Repo,
    issue_payload: dict[str, Any],
    encrypted_token: str,
) -> None:
    """
    Auto-triage a newly opened issue using Cognee's knowledge graph.
    """
    issue = issue_payload.get("issue", {})
    title = issue.get("title", "")
    body = issue.get("body", "") or ""
    number = issue.get("number", 0)

    # Build a query from the issue content
    query = f"{title}. {body[:500]}"

    # Recall related context
    results = await cognee_service.recall(query, repo.dataset_name)

    if not results:
        logger.info("No related context found for issue #%d on %s", number, repo.full_name)
        return

    # Format the triage comment
    comment = _format_triage_comment(results, title)

    if not comment:
        return

    # Post to GitHub
    token = decrypt_token(encrypted_token)
    github_service.post_issue_comment(
        token=token,
        full_name=repo.full_name,
        issue_number=number,
        body=comment,
    )


def _format_triage_comment(results: list, issue_title: str) -> str | None:
    """Format recall results into a helpful GitHub comment."""
    if not results:
        return None

    lines = [
        "🦐 **Copepod Auto-Triage**\n",
        f"Based on this repository's history, here's what I found related to \"{issue_title}\":\n",
        "---\n",
    ]

    # Extract relevant information from results
    for i, result in enumerate(results[:5]):
        result_text = str(result)
        if len(result_text) > 300:
            result_text = result_text[:300] + "..."
        lines.append(f"**Related context {i + 1}:** {result_text}\n")

    lines.extend([
        "---\n",
        "*This analysis was generated automatically by [Copepod](https://github.com/copepod) "
        "using the repository's institutional memory.*",
    ])

    return "\n".join(lines)
