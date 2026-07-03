"""
Cognee integration service — the memory engine behind Copepod.

Users never interact with Cognee directly. This service wraps all four
memory operations (remember, recall, improve, forget) with dataset
isolation per user/repo.

Cognee config: Gemini LLM + fastembed (local) + KuzuDB + LanceDB = $0
"""

from __future__ import annotations

import os
import sys

# Sanitize Windows PATH to avoid cygwin/msys2/git-usr DLL conflicts at startup
if sys.platform == "win32":
    path = os.environ.get("PATH", "")
    parts = path.split(os.pathsep)
    clean_parts = []
    for part in parts:
        lower_part = part.lower()
        if "git\\usr" in lower_part or "git/usr" in lower_part:
            continue
        if "msys" in lower_part or "cygwin" in lower_part:
            continue
        clean_parts.append(part)
    os.environ["PATH"] = os.pathsep.join(clean_parts)

import logging
from typing import Any

logger = logging.getLogger(__name__)


def setup_cognee_env() -> None:
    """
    Configure Cognee's LLM, embedding, graph, and vector backends.

    Cognee v1.2.2 valid LLM providers: openai, ollama, anthropic, custom,
    gemini, mistral, azure, bedrock, llama_cpp.

    We use 'gemini' — a first-class Cognee provider that routes through
    litellm's native Gemini support. No custom endpoint hacks needed.
    """
    import cognee
    from app.config import get_settings
    s = get_settings()

    # LLM: Google Gemini via AI Studio
    cognee.config.set_llm_provider("gemini")
    cognee.config.set_llm_model(s.COGNEE_LLM_MODEL)
    cognee.config.set_llm_api_key(s.GEMINI_API_KEY)
    cognee.config.set_llm_endpoint("https://generativelanguage.googleapis.com/")

    # Embeddings: local fastembed (free, no API key needed)
    cognee.config.set_embedding_provider(s.COGNEE_EMBEDDING_PROVIDER)
    cognee.config.set_embedding_model(s.COGNEE_EMBEDDING_MODEL)

    # Graph DB: embedded KuzuDB
    cognee.config.set_graph_database_provider(s.COGNEE_GRAPH_DB)

    # Vector DB: embedded LanceDB
    cognee.config.set_vector_db_provider(s.COGNEE_VECTOR_DB)

    # Disable multi-tenant auth inside Cognee (we handle auth ourselves)
    os.environ.setdefault("ENABLE_BACKEND_ACCESS_CONTROL", "false")

    # Skip Cognee's 30s LLM connection test at startup — it can timeout
    # on some providers and block the entire startup sequence.
    os.environ.setdefault("COGNEE_SKIP_CONNECTION_TEST", "true")

    logger.info(
        "Cognee configured: LLM=gemini(%s), Embedding=%s, Graph=%s, Vector=%s",
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
            datasets=[dataset_name],
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
        await cognee.improve(dataset=dataset_name)
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
        await cognee.forget(dataset=dataset_name)
        logger.info("Successfully forgot '%s'", dataset_name)
    except Exception:
        logger.exception("Failed to forget '%s'", dataset_name)
