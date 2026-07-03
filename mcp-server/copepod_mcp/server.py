"""
Copepod MCP Server — Two tools for AI coding agents.

This is Copepod's OWN MCP server, distinct from Cognee's generic MCP server.
Cognee's MCP has no concept of users, repos, or dataset isolation.
Copepod's MCP wraps the backend's existing endpoints with proper auth
and repo context injected automatically from .copepod/config.json.

Tools:
  - ask(question) → Query the repository's institutional memory
  - file_context(file_path) → Get PR decision history for a specific file
"""

import sys
import logging

from fastmcp import FastMCP
import httpx

from .config import CopepodConfig

logger = logging.getLogger("copepod-mcp")
logging.basicConfig(stream=sys.stderr, level=logging.INFO)

# Load config once at startup
try:
    config = CopepodConfig.load()
    logger.info("Loaded Copepod config: api_url=%s, repo_id=%s", config.api_url, config.repo_id)
except (FileNotFoundError, ValueError) as e:
    logger.error("Failed to load Copepod config: %s", e)
    sys.exit(1)

mcp = FastMCP(
    "copepod",
    description=(
        "Copepod — Institutional memory for your repository. "
        "Query PR decisions, code rationale, and issue history."
    ),
)


@mcp.tool()
async def ask(question: str) -> str:
    """
    Query the repository's institutional memory.

    Use this BEFORE making changes to understand:
    - Why specific code exists
    - What decisions led to the current architecture
    - Whether a past approach was tried and rejected
    - What issues a piece of code was meant to resolve

    Args:
        question: A natural language question about the repository.

    Returns:
        A contextual answer with source citations (PR numbers, issue numbers).
    """
    async with httpx.AsyncClient(timeout=60.0) as client:
        try:
            response = await client.post(
                f"{config.api_url}/repos/{config.repo_id}/chat",
                json={"query": question},
                headers={
                    "X-API-Key": config.api_key,
                    "Content-Type": "application/json",
                },
            )
            response.raise_for_status()
            data = response.json()
            return data.get("answer", "No answer available.")
        except httpx.HTTPStatusError as e:
            return f"Error querying Copepod: {e.response.status_code} — {e.response.text}"
        except httpx.RequestError as e:
            return f"Connection error: Could not reach Copepod backend at {config.api_url}. Error: {e}"


@mcp.tool()
async def file_context(file_path: str) -> str:
    """
    Get the full PR decision history for a specific file.

    Use this BEFORE editing any file to understand:
    - Which PRs have touched this file and why
    - What issues each change resolved
    - How stable the code has been since each change
    - Whether the existing approach is intentional

    Args:
        file_path: Relative path to the file in the repository (e.g., "src/api/payment.ts").

    Returns:
        Structured decision history with PR numbers, rationale, and trust scores.
    """
    async with httpx.AsyncClient(timeout=60.0) as client:
        try:
            response = await client.get(
                f"{config.api_url}/repos/{config.repo_id}/file-context",
                params={"path": file_path},
                headers={
                    "X-API-Key": config.api_key,
                },
            )
            response.raise_for_status()
            data = response.json()
            return data.get("context", "No context available for this file.")
        except httpx.HTTPStatusError as e:
            return f"Error querying Copepod: {e.response.status_code} — {e.response.text}"
        except httpx.RequestError as e:
            return f"Connection error: Could not reach Copepod backend at {config.api_url}. Error: {e}"


def main():
    """Entry point for the Copepod MCP server."""
    mcp.run()


if __name__ == "__main__":
    main()
