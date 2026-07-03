"""
PR satisfaction score calculator.

Combines recency, code stability, and regression detection into a single
0-1 score that tells a developer how much to trust existing code context.

Used by the VS Code extension to color-code PR entries:
  🟢 > 0.75  — Fresh, stable, no regressions
  🟡 0.4-0.75 — Aging or some churn  
  🔴 < 0.4   — Stale, heavily modified, or regressed
"""

from __future__ import annotations

from datetime import datetime, timezone


def satisfaction_score(
    merged_at: datetime,
    commits_since: int = 0,
    issue_recurred: bool = False,
) -> float:
    """
    Compute how trustworthy a PR's context still is.

    Args:
        merged_at: When the PR was merged
        commits_since: Number of commits touching the same files since merge
        issue_recurred: Whether a similar issue has been opened since the fix

    Returns:
        Float 0.0 to 1.0 where higher = more trustworthy
    """
    now = datetime.now(timezone.utc)

    # Ensure merged_at is timezone-aware
    if merged_at.tzinfo is None:
        merged_at = merged_at.replace(tzinfo=timezone.utc)

    days = (now - merged_at).days

    # Recency: decays linearly over 1 year
    recency = max(0.0, 1.0 - days / 365.0)

    # Stability: drops with code churn (20+ commits = 0)
    stability = max(0.0, 1.0 - commits_since / 20.0)

    # Penalty for regression
    penalty = 0.25 if issue_recurred else 0.0

    score = 0.4 * recency + 0.6 * stability - penalty
    return round(max(0.0, min(1.0, score)), 2)


def score_color(score: float) -> str:
    """Return a color category for a satisfaction score."""
    if score >= 0.75:
        return "green"
    elif score >= 0.4:
        return "yellow"
    else:
        return "red"


def score_label(score: float) -> str:
    """Return a human-readable label for a satisfaction score."""
    if score >= 0.75:
        return "Fresh"
    elif score >= 0.4:
        return "Aging"
    else:
        return "Stale"
