"""
Chat and file context router — the query endpoints consumed by all three surfaces.

POST /repos/{id}/chat       → recall from Cognee + format via Gemini
GET  /repos/{id}/file-context → file PR history with satisfaction scores
GET  /repos/{id}/pr-history  → structured PR tree for VS Code
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.models.models import Repo, User
from app.schemas.schemas import ChatRequest, ChatResponse, SourceCitation
from app.services import cognee_service
from app.utils.auth import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/repos", tags=["chat"])
settings = get_settings()


@router.post("/{repo_id}/chat", response_model=ChatResponse)
async def chat(
    repo_id: int,
    body: ChatRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Query the repository's institutional memory.

    1. Recall context from Cognee knowledge graph
    2. Format the answer via Gemini LLM with source citations
    3. Return structured response with PR/issue references
    """
    repo = await db.get(Repo, repo_id)
    if not repo or repo.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Repo not found")

    if not repo.is_ingested:
        raise HTTPException(status.HTTP_425_TOO_EARLY, "Repo is still being ingested")

    # 1. Recall from Cognee
    raw_results = await cognee_service.recall(body.query, repo.dataset_name)

    if not raw_results:
        return ChatResponse(
            answer="I don't have enough context about this repository to answer that question. "
                   "Try a different question or wait for the ingestion to complete.",
            sources=[],
            dataset=repo.dataset_name,
            query=body.query,
        )

    # 2. Format context for LLM
    context = "\n\n".join(str(r) for r in raw_results[:10])

    # 3. Generate answer via Gemini
    try:
        from google import genai

        client = genai.Client(api_key=settings.GEMINI_API_KEY)

        system_prompt = (
            "You are a code repository expert. Answer concisely using ONLY "
            "the context provided. Always cite PR numbers as [PR-123] and "
            "issue numbers as [#45]. If context is insufficient, say so. "
            "Focus on decision rationale and why things were done a certain way."
        )

        user_prompt = f"Context from repository '{repo.full_name}':\n{context}\n\nQuestion: {body.query}"

        response = client.models.generate_content(
            model="gemini-3.5-flash",
            contents=user_prompt,
            config={
                "system_instruction": system_prompt,
                "temperature": 0.3,
                "max_output_tokens": 1024,
            },
        )

        answer = response.text or "Unable to generate answer."

    except Exception as e:
        logger.exception("Gemini API error: %s", e)
        # Fallback: return raw context if LLM fails
        answer = f"Context found but answer formatting failed. Here's what I found:\n\n{context[:1000]}"

    # 4. Extract source citations from raw results
    sources = _extract_sources(raw_results)

    return ChatResponse(
        answer=answer,
        sources=sources,
        dataset=repo.dataset_name,
        query=body.query,
    )


@router.get("/{repo_id}/file-context")
async def file_context(
    repo_id: int,
    path: str = Query(..., description="Repo-relative file path"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Get full decision history for a specific file.

    Used by MCP file_context tool and VS Code sidebar.
    Returns PR history with satisfaction scores.
    """
    repo = await db.get(Repo, repo_id)
    if not repo or repo.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Repo not found")

    # Recall file-specific context from Cognee
    query = f"What changes have been made to the file {path}? Include PR numbers, decision rationale, and related issues."
    results = await cognee_service.recall(query, repo.dataset_name)

    context_parts = []
    for r in (results or []):
        context_parts.append(str(r))

    context = "\n\n".join(context_parts) if context_parts else f"No history found for {path}"

    return {
        "path": path,
        "repo": repo.full_name,
        "context": context,
        "raw_results_count": len(results) if results else 0,
    }


@router.get("/{repo_id}/pr-history")
async def pr_history(
    repo_id: int,
    path: str = Query(..., description="Repo-relative file path"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Structured PR tree for VS Code visualization.

    Returns PRs that touched the specified file, with satisfaction scores
    and linked issues — used by the VS Code webview to render the SVG tree.
    """
    repo = await db.get(Repo, repo_id)
    if not repo or repo.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Repo not found")

    query = f"List all pull requests that modified {path}, their rationale, and linked issues."
    results = await cognee_service.recall(query, repo.dataset_name)

    # Structure results for VS Code consumption
    pr_entries = []
    for r in (results or []):
        pr_entries.append({
            "context": str(r),
        })

    return {
        "path": path,
        "repo": repo.full_name,
        "entries": pr_entries,
    }


def _extract_sources(results: list) -> list[SourceCitation]:
    """Extract PR/issue citations from Cognee results."""
    import re
    sources: list[SourceCitation] = []
    seen: set[str] = set()

    for r in results:
        text = str(r)

        # Find PR references
        for match in re.finditer(r"(?:PR|Pull Request)\s*#?(\d+)", text, re.IGNORECASE):
            key = f"pr-{match.group(1)}"
            if key not in seen:
                seen.add(key)
                sources.append(SourceCitation(
                    type="pr",
                    title=f"PR #{match.group(1)}",
                    relevance=0.8,
                ))

        # Find issue references
        for match in re.finditer(r"Issue\s*#?(\d+)", text, re.IGNORECASE):
            key = f"issue-{match.group(1)}"
            if key not in seen:
                seen.add(key)
                sources.append(SourceCitation(
                    type="issue",
                    title=f"Issue #{match.group(1)}",
                    relevance=0.7,
                ))

    return sources[:10]  # Cap at 10 sources
