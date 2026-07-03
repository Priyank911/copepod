"""
Cognee integration service — the memory engine behind Copepod.

Users never interact with Cognee directly. This service wraps all four
memory operations (remember, recall, improve, forget) with dataset
isolation per user/repo.

Cognee config: Groq LLM (free) + fastembed (local) + KuzuDB + LanceDB = $0
"""

from __future__ import annotations

import logging
import os
from typing import Any

logger = logging.getLogger(__name__)


def setup_cognee_env() -> None:
    """
    Configure Cognee environment variables at process startup.
    Must be called before any cognee import that triggers config loading.
    """
    from app.config import get_settings
    s = get_settings()

    os.environ.setdefault("LLM_PROVIDER", "litellm")
    os.environ.setdefault("LLM_MODEL", s.COGNEE_LLM_MODEL)
    os.environ.setdefault("LLM_API_KEY", s.GROQ_API_KEY)
    os.environ.setdefault("EMBEDDING_PROVIDER", s.COGNEE_EMBEDDING_PROVIDER)
    os.environ.setdefault("EMBEDDING_MODEL", s.COGNEE_EMBEDDING_MODEL)
    os.environ.setdefault("GRAPH_DATABASE_PROVIDER", s.COGNEE_GRAPH_DB)
    os.environ.setdefault("VECTOR_DB_PROVIDER", s.COGNEE_VECTOR_DB)

    logger.info(
        "Cognee configured: LLM=%s, Embedding=%s, Graph=%s, Vector=%s",
        s.COGNEE_LLM_MODEL, s.COGNEE_EMBEDDING_MODEL,
        s.COGNEE_GRAPH_DB, s.COGNEE_VECTOR_DB,
    )


async def remember(sentences: list[str], dataset_name: str) -> None:
    """
    Ingest formatted sentences into a repo's isolated Cognee dataset.

    This is called during:
    - Initial full repository ingestion
    - Delta updates from webhook events (PR merged, issue closed)
    """
    import cognee

    if not sentences:
        logger.warning("No sentences to remember for dataset %s", dataset_name)
        return

    text_block = "\n\n".join(sentences)
    logger.info(
        "Remembering %d sentences into dataset '%s' (%d chars)",
        len(sentences), dataset_name, len(text_block),
    )

    try:
        await cognee.remember(text_block, dataset_name=dataset_name)
        logger.info("Successfully remembered data into '%s'", dataset_name)
    except Exception:
        logger.exception("Failed to remember data into '%s'", dataset_name)
        raise


async def recall(query: str, dataset_name: str) -> list[Any]:
    """
    Query a repo's knowledge graph via Cognee.

    This is called from:
    - Studio chat endpoint
    - MCP ask() tool
    - VS Code file context
    - Auto issue triage
    """
    import cognee

    logger.info("Recalling from '%s': %s", dataset_name, query[:100])

    try:
        results = await cognee.recall(
            query_text=query,
            dataset_name=dataset_name,
        )
        logger.info("Recall returned %d results from '%s'", len(results) if results else 0, dataset_name)
        return results or []
    except Exception:
        logger.exception("Failed to recall from '%s'", dataset_name)
        return []


async def improve(dataset_name: str) -> None:
    """
    Enrich the graph after validated outcomes.

    Called when a PR that used Copepod's recalled context gets merged.
    This reinforces the graph's accuracy by confirming that the context
    was used and produced a successful outcome.
    """
    import cognee

    logger.info("Improving dataset '%s'", dataset_name)

    try:
        await cognee.improve(dataset_name=dataset_name)
        logger.info("Successfully improved '%s'", dataset_name)
    except Exception:
        logger.exception("Failed to improve '%s'", dataset_name)


async def forget_dataset(dataset_name: str) -> None:
    """
    Remove an entire repo's data from Cognee.

    Called when:
    - A user removes a repo from Copepod
    - A repo needs to be re-ingested from scratch
    """
    import cognee

    logger.info("Forgetting dataset '%s'", dataset_name)

    try:
        await cognee.forget(dataset_name=dataset_name)
        logger.info("Successfully forgot '%s'", dataset_name)
    except Exception:
        logger.exception("Failed to forget '%s'", dataset_name)
