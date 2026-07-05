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
from app.models.models import Repo, User, ChatMessage
from app.schemas.schemas import ChatRequest, ChatResponse, SourceCitation, ChatMessageOut
from app.services import cognee_service
from app.utils.auth import get_current_user

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/repos", tags=["chat"])
settings = get_settings()


from sqlalchemy import select

async def _get_repo(db: AsyncSession, repo_id_or_name: str, user_id: int) -> Repo | None:
    """Resolve repository by database ID or owner/name string."""
    logger.info("Resolving repo: repo_id_or_name=%s, user_id=%s", repo_id_or_name, user_id)
    try:
        if repo_id_or_name.isdigit():
            repo = await db.get(Repo, int(repo_id_or_name))
            if repo and repo.user_id == user_id:
                logger.info("Resolved repo by ID: %s", repo.full_name)
                return repo
            logger.info("Repo not found by ID: %s", repo_id_or_name)
            return None

        # Resolve by full name (string)
        stmt = select(Repo).where(
            Repo.user_id == user_id,
            Repo.full_name == repo_id_or_name.strip("/")
        )
        result = await db.execute(stmt)
        repo = result.scalar_one_or_none()
        if repo:
            logger.info("Resolved repo by name: %s", repo.full_name)
        else:
            logger.info("Repo not found by name: %s", repo_id_or_name)
        return repo
    except Exception as e:
        logger.exception("Error in _get_repo: %s", e)
        return None


@router.post("/{repo_id}/chat", response_model=ChatResponse)
async def chat(
    repo_id: str,
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
    repo = await _get_repo(db, repo_id, user.id)
    if not repo:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Repo not found")

    if not repo.is_ingested:
        raise HTTPException(status.HTTP_425_TOO_EARLY, "Repo is still being ingested")

    reasoning_steps = [
        f"Query initiated: '{body.query}'",
        f"Step 1: Routed dataset target to isolated environment '{repo.dataset_name}'",
        f"        Graph DB target: '/app/.cognee/databases/isolated_graphs/{repo.dataset_name}.db'",
        f"        Vector DB target: '/app/.cognee/databases/isolated_vectors/{repo.dataset_name}'"
    ]

    # 1. Recall from Cognee
    raw_results = await cognee_service.recall(body.query, repo.dataset_name)

    if not raw_results:
        reasoning_steps.append("Step 2: Triplets search resolved on empty context.")
        answer = "I don't have enough context about this repository to answer that question. Try a different question or wait for the ingestion to complete."
        
        user_msg = ChatMessage(
            user_id=user.id,
            repo_id=repo.id,
            role="user",
            content=body.query,
        )
        db.add(user_msg)
        
        bot_msg = ChatMessage(
            user_id=user.id,
            repo_id=repo.id,
            role="assistant",
            content=answer,
            sources=[],
            reasoning_steps=reasoning_steps,
        )
        db.add(bot_msg)
        await db.commit()

        return ChatResponse(
            answer=answer,
            sources=[],
            dataset=repo.dataset_name,
            query=body.query,
            reasoning_steps=reasoning_steps,
            raw_contexts=[],
        )

    reasoning_steps.append(
        f"Step 2: Retrieved {len(raw_results)} entity/edge triplets from isolated Kuzu graph."
    )
    for idx, r in enumerate(raw_results[:6]):
        text_val = str(r).strip()
        if len(text_val) > 180:
            snippet = text_val[:177] + "..."
        else:
            snippet = text_val
        reasoning_steps.append(f"        └─ Traversed: {snippet}")

    # 2. Format context for LLM
    context_items = []
    raw_contexts = []
    for r in raw_results[:10]:
        text_val = str(r)
        context_items.append(text_val)
        raw_contexts.append(text_val)

    context = "\n\n".join(context_items)
    reasoning_steps.append(f"Step 3: Compiled {len(context_items)} context chunks for LLM instruction.")

    # 3. Generate answer via Gemini
    try:
        from app.utils.gemini_fallback import generate_content_with_fallback

        system_prompt = (
            "You are a code repository expert. Answer concisely using ONLY "
            "the context provided. Always cite PR numbers as [PR-123] and "
            "issue numbers as [#45]. If context is insufficient, say so. "
            "Focus on decision rationale and why things were done a certain way."
        )

        user_prompt = f"Context from repository '{repo.full_name}':\n{context}\n\nQuestion: {body.query}"

        reasoning_steps.append("Step 4: Executing LLM generation via Gemini fallback layer...")
        response = generate_content_with_fallback(
            contents=user_prompt,
            config={
                "system_instruction": system_prompt,
                "temperature": 0.3,
                "max_output_tokens": 1024,
            },
        )

        answer = response.text or "Unable to generate answer."
        reasoning_steps.append("Step 5: Completion generated successfully.")

    except Exception as e:
        logger.exception("Gemini API error: %s", e)
        reasoning_steps.append(f"Step 4/5: Gemini API execution failed with error: {str(e)[:100]}. Triggering raw fallback formatting.")
        # Fallback: return raw context if LLM fails
        answer = f"Context found but answer formatting failed. Here's what I found:\n\n{context[:1000]}"

    # 4. Extract source citations from raw results
    sources = _extract_sources(raw_results)

    # Save user message to database
    user_msg = ChatMessage(
        user_id=user.id,
        repo_id=repo.id,
        role="user",
        content=body.query,
    )
    db.add(user_msg)

    # Save bot response to database
    sources_dict_list = [s.model_dump() for s in sources]
    bot_msg = ChatMessage(
        user_id=user.id,
        repo_id=repo.id,
        role="assistant",
        content=answer,
        sources=sources_dict_list,
        reasoning_steps=reasoning_steps,
    )
    db.add(bot_msg)
    await db.commit()

    return ChatResponse(
        answer=answer,
        sources=sources,
        dataset=repo.dataset_name,
        query=body.query,
        reasoning_steps=reasoning_steps,
        raw_contexts=raw_contexts,
    )


@router.get("/{repo_id}/chat/history", response_model=list[ChatMessageOut])
async def get_chat_history(
    repo_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Get chat history for a specific repository.
    Fetches the last 100 messages for the current user and repository.
    """
    repo = await _get_repo(db, repo_id, user.id)
    if not repo:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Repo not found")

    stmt = (
        select(ChatMessage)
        .where(ChatMessage.user_id == user.id, ChatMessage.repo_id == repo.id)
        .order_by(ChatMessage.created_at.desc())
        .limit(100)
    )
    result = await db.execute(stmt)
    messages = result.scalars().all()
    # Reverse so they are chronological in the response
    return list(reversed(messages))


@router.delete("/{repo_id}/chat/history")
async def clear_chat_history(
    repo_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Clear all chat messages for a repository.
    """
    from sqlalchemy import delete

    repo = await _get_repo(db, repo_id, user.id)
    if not repo:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Repo not found")

    stmt = delete(ChatMessage).where(
        ChatMessage.user_id == user.id,
        ChatMessage.repo_id == repo.id,
    )
    await db.execute(stmt)
    await db.commit()

    return {"status": "success", "message": "Chat history cleared successfully."}


@router.get("/{repo_id}/file-context")
async def file_context(
    repo_id: str,
    path: str = Query(..., description="Repo-relative file path"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Get full decision history for a specific file.

    Used by MCP file_context tool and VS Code sidebar.
    Returns PR history with satisfaction scores.
    """
    repo = await _get_repo(db, repo_id, user.id)
    if not repo:
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
    repo_id: str,
    path: str = Query(..., description="Repo-relative file path"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Structured PR tree for VS Code visualization.

    Returns PRs that touched the specified file, with satisfaction scores
    and linked issues — used by the VS Code webview to render the SVG tree.
    """
    repo = await _get_repo(db, repo_id, user.id)
    if not repo:
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
                    context_snippet=text[:350] + "..." if len(text) > 350 else text,
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
                    context_snippet=text[:350] + "..." if len(text) > 350 else text,
                ))

    return sources[:10]  # Cap at 10 sources
