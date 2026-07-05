"""
GitHub API service using PyGithub.

Handles:
- Fetching PRs, issues, code files from repositories
- Webhook CRUD (create/delete)
- User profile fetching
"""

from __future__ import annotations

import logging
from typing import Any

from github import Github, Auth, GithubException
from github.Repository import Repository as GHRepo

logger = logging.getLogger(__name__)


def _get_client(token: str) -> Github:
    """Create an authenticated PyGithub client."""
    return Github(auth=Auth.Token(token))


# ── Repository data fetching ─────────────────────────────────────────

def get_repo(token: str, full_name: str) -> GHRepo:
    """Get a GitHub repository object."""
    g = _get_client(token)
    return g.get_repo(full_name)


def fetch_merged_prs(token: str, full_name: str, limit: int = 100) -> list[dict[str, Any]]:
    """Fetch merged pull requests with files and reviews."""
    g = _get_client(token)
    repo = g.get_repo(full_name)
    prs = []

    for pr in repo.get_pulls(state="closed", sort="updated", direction="desc"):
        if not pr.merged:
            continue
        if len(prs) >= limit:
            break

        try:
            files = [f.filename for f in pr.get_files()]
        except GithubException:
            files = []

        try:
            reviews = [
                {"state": r.state, "user": r.user.login if r.user else "unknown", "body": r.body or ""}
                for r in pr.get_reviews()
            ]
        except GithubException:
            reviews = []

        prs.append({
            "number": pr.number,
            "title": pr.title,
            "body": pr.body,
            "author": pr.user.login if pr.user else "unknown",
            "merged_at": pr.merged_at,
            "files": files,
            "reviews": reviews,
        })

    g.close()
    logger.info("Fetched %d merged PRs from %s", len(prs), full_name)
    return prs


def fetch_closed_issues(token: str, full_name: str, limit: int = 100) -> list[dict[str, Any]]:
    """Fetch closed issues (not PRs)."""
    g = _get_client(token)
    repo = g.get_repo(full_name)
    issues = []

    for issue in repo.get_issues(state="closed", sort="updated", direction="desc"):
        if issue.pull_request:
            continue
        if len(issues) >= limit:
            break

        issues.append({
            "number": issue.number,
            "title": issue.title,
            "body": issue.body,
            "author": issue.user.login if issue.user else "unknown",
            "labels": [lbl.name for lbl in issue.labels],
            "closed_at": issue.closed_at,
        })

    g.close()
    logger.info("Fetched %d closed issues from %s", len(issues), full_name)
    return issues


def fetch_source_files(
    token: str, full_name: str,
    extensions: tuple[str, ...] = (".py", ".js", ".ts", ".go"),
    max_files: int = 50,
) -> list[dict[str, str]]:
    """Fetch source code files from the repository."""
    g = _get_client(token)
    repo = g.get_repo(full_name)
    files = []

    try:
        contents = repo.get_contents("")
        queue = list(contents) if isinstance(contents, list) else [contents]

        while queue and len(files) < max_files:
            item = queue.pop(0)
            if item.type == "dir":
                try:
                    sub = repo.get_contents(item.path)
                    queue.extend(sub if isinstance(sub, list) else [sub])
                except GithubException:
                    pass
            elif any(item.path.endswith(ext) for ext in extensions):
                try:
                    content = item.decoded_content.decode("utf-8", errors="replace")
                    if len(content) < 50000:  # Skip very large files
                        files.append({"path": item.path, "content": content})
                except Exception:
                    pass
    except GithubException:
        logger.warning("Could not list contents for %s", full_name)

    g.close()
    logger.info("Fetched %d source files from %s", len(files), full_name)
    return files


# ── Webhook management ───────────────────────────────────────────────

def create_webhook(
    token: str, full_name: str, webhook_url: str, secret: str,
) -> int | None:
    """Create a webhook on a repository. Returns the webhook ID."""
    g = _get_client(token)
    repo = g.get_repo(full_name)

    config = {
        "url": webhook_url,
        "content_type": "json",
        "secret": secret,
    }
    events = ["pull_request", "issues", "push"]

    try:
        hook = repo.create_hook("web", config, events=events, active=True)
        g.close()
        logger.info("Created webhook %d on %s", hook.id, full_name)
        return hook.id
    except GithubException as e:
        logger.error("Failed to create webhook on %s: %s", full_name, e)
        g.close()
        return None


def delete_webhook(token: str, full_name: str, hook_id: int) -> bool:
    """Delete a webhook from a repository."""
    g = _get_client(token)
    repo = g.get_repo(full_name)

    try:
        hook = repo.get_hook(hook_id)
        hook.delete()
        g.close()
        logger.info("Deleted webhook %d from %s", hook_id, full_name)
        return True
    except GithubException as e:
        logger.error("Failed to delete webhook %d from %s: %s", hook_id, full_name, e)
        g.close()
        return False


def get_repo_info(token: str, full_name: str) -> dict[str, Any]:
    """Get basic repo info for the Repo model."""
    g = _get_client(token)
    repo = g.get_repo(full_name)
    info = {
        "id": repo.id,
        "full_name": repo.full_name,
        "default_branch": repo.default_branch,
        "private": repo.private,
        "description": repo.description,
    }
    g.close()
    return info


def post_issue_comment(token: str, full_name: str, issue_number: int, body: str) -> bool:
    """Post a comment on a GitHub issue (used for auto-triage)."""
    g = _get_client(token)
    repo = g.get_repo(full_name)

    try:
        issue = repo.get_issue(issue_number)
        issue.create_comment(body)
        g.close()
        logger.info("Posted triage comment on %s#%d", full_name, issue_number)
        return True
    except GithubException as e:
        logger.error("Failed to post comment on %s#%d: %s", full_name, issue_number, e)
        g.close()
        return False


def fetch_pr_patches(
    token: str,
    full_name: str,
    pr_number: int,
    max_files: int = 5,
    extensions: tuple[str, ...] = (".py", ".js", ".ts", ".go", ".rs", ".cpp", ".h", ".cs", ".java"),
) -> list[dict[str, str]]:
    """Fetch diff patches for code files in a PR to minimize LLM token bloat."""
    g = _get_client(token)
    patches = []
    try:
        repo = g.get_repo(full_name)
        pr = repo.get_pull(pr_number)
        
        file_count = 0
        for f in pr.get_files():
            if file_count >= max_files:
                break
            
            # Only include files matching extensions and having valid patches
            if any(f.filename.endswith(ext) for ext in extensions) and f.patch:
                patches.append({
                    "filename": f.filename,
                    "patch": f.patch,
                })
                file_count += 1
    except Exception as e:
        logger.error("Failed to fetch PR patches for %s#%d: %s", full_name, pr_number, e)
    finally:
        g.close()
    return patches
