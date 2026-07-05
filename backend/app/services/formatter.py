"""
Sentence formatter — the most critical engineering decision in Copepod.

Cognee's entity extraction quality depends entirely on what it receives.
Raw JSON blobs produce garbage graphs. Structured English sentences
produce structured, queryable graphs.

Every piece of GitHub data is converted into plain English relationships
before being fed to cognee.remember().
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any


def format_pr(
    number: int,
    title: str,
    body: str | None,
    author: str,
    merged_at: datetime | None,
    files: list[str],
    reviews: list[dict[str, Any]] | None = None,
    diff_analysis: str | None = None,
) -> str:
    """Convert a merged PR into a structured sentence for Cognee ingestion."""
    linked = _extract_linked_issues(body or "")
    
    clean_body = (body or "").strip()
    if not clean_body or len(clean_body) < 30:
        if diff_analysis:
            rationale = diff_analysis
        else:
            rationale = "No detailed description provided by author."
    else:
        rationale = _truncate(clean_body, 400)
        if diff_analysis:
            rationale += f" Technical Changes: {diff_analysis}"
            
    date_str = merged_at.strftime("%Y-%m-%d") if merged_at else "unknown date"

    review_text = ""
    if reviews:
        review_text = f" Review feedback: {_summarize_reviews(reviews)}."

    main_sentence = (
        f"Pull Request #{number} titled '{title}' was merged on {date_str} "
        f"by {author}. "
        f"Decision rationale: {rationale}. "
        f"Resolves issues: {', '.join(linked) or 'none'}."
        f"{review_text}"
    )

    file_sentences = [f"Pull Request #{number} modified the file '{f}'." for f in files[:100]]

    return main_sentence + " " + " ".join(file_sentences)


def format_issue(
    number: int,
    title: str,
    body: str | None,
    labels: list[str],
    closed_at: datetime | None,
    author: str,
) -> str:
    """Convert a closed issue into a structured sentence."""
    label_text = ", ".join(labels) if labels else "unlabeled"
    desc = _truncate(body or "No description", 300)
    date_str = closed_at.strftime("%Y-%m-%d") if closed_at else "unknown date"

    return (
        f"Issue #{number} titled '{title}' ({label_text}) "
        f"was reported by {author} and closed on {date_str}. "
        f"Description: {desc}."
    )


def format_commit(
    sha: str,
    message: str,
    author: str,
    date: datetime | None,
    files: list[str],
) -> str:
    """Convert a commit into a structured sentence."""
    file_list = ", ".join(files[:5]) if files else "unknown files"
    date_str = date.strftime("%Y-%m-%d") if date else "unknown date"
    msg = _truncate(message, 200)

    return (
        f"Commit {sha[:8]} by {author} on {date_str}: "
        f"'{msg}'. Files changed: {file_list}."
    )


def format_function(
    name: str,
    file_path: str,
    lineno: int,
    docstring: str | None,
    calls: list[str],
    is_async: bool = False,
) -> str:
    """Convert a code function into a structured sentence."""
    prefix = "Async function" if is_async else "Function"
    doc = docstring or "undocumented"
    call_list = ", ".join(calls[:5]) if calls else "none"

    return (
        f"File '{file_path}' contains function '{name}'. "
        f"{prefix} '{name}' is defined in file '{file_path}' at line {lineno}. "
        f"{prefix} '{name}' calls: {call_list}. "
        f"{prefix} '{name}' description: {doc}."
    )


def format_class(
    name: str,
    file_path: str,
    methods: list[str],
    bases: list[str],
    docstring: str | None,
) -> str:
    """Convert a class into a structured sentence."""
    doc = docstring or "undocumented"
    method_list = ", ".join(methods[:10]) if methods else "none"
    base_list = ", ".join(bases) if bases else "object"

    return (
        f"File '{file_path}' contains class '{name}'. "
        f"Class '{name}' is defined in file '{file_path}'. "
        f"Class '{name}' inherits from {base_list}. "
        f"Class '{name}' has methods: {method_list}. "
        f"Class '{name}' purpose: {doc}."
    )


def format_review_comment(
    pr_number: int,
    reviewer: str,
    body: str,
    file_path: str | None = None,
) -> str:
    """Convert a PR review comment into a structured sentence."""
    file_ctx = f" on file {file_path}" if file_path else ""
    comment = _truncate(body, 300)

    return (
        f"Reviewer {reviewer} commented on PR #{pr_number}{file_ctx}: "
        f"'{comment}'."
    )


def format_improve_entry(
    pr_number: int,
    context_used: str,
    outcome: str,
) -> str:
    """Format a validated outcome for the improve memory operation."""
    return (
        f"PR #{pr_number} was merged using Copepod context: '{context_used}'. "
        f"Outcome: {outcome}. This context has been validated as accurate."
    )


# ── Internal helpers ─────────────────────────────────────────────────

def _extract_linked_issues(body: str) -> list[str]:
    """Extract issue references from PR body (e.g., 'Fixes #42', 'Closes #7')."""
    patterns = [
        r"(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)",
        r"#(\d+)",
    ]
    issues: set[str] = set()
    for pattern in patterns:
        for match in re.finditer(pattern, body, re.IGNORECASE):
            issues.add(f"#{match.group(1)}")
    return sorted(issues)


def _summarize_reviews(reviews: list[dict[str, Any]]) -> str:
    """Summarize review states into a short sentence."""
    states: dict[str, int] = {}
    for r in reviews:
        state = r.get("state", "COMMENTED")
        states[state] = states.get(state, 0) + 1

    parts = []
    if states.get("APPROVED"):
        parts.append(f"{states['APPROVED']} approval(s)")
    if states.get("CHANGES_REQUESTED"):
        parts.append(f"{states['CHANGES_REQUESTED']} changes requested")
    if states.get("COMMENTED"):
        parts.append(f"{states['COMMENTED']} comment(s)")

    return ", ".join(parts) if parts else "no reviews"


def _truncate(text: str, max_len: int) -> str:
    """Truncate text to max_len, cleaning whitespace."""
    text = " ".join(text.split())  # collapse whitespace
    if len(text) <= max_len:
        return text
    return text[: max_len - 3] + "..."
