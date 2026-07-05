from __future__ import annotations

import logging
from app.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


def analyze_pr_diff(pr_number: int, pr_title: str, patches: list[dict[str, str]]) -> str | None:
    """
    Analyze the diff patches of a PR using Gemini to extract the technical rationale.
    Runs synchronously (or inside a thread pool) to fit ingestion workers.
    """
    if not patches:
        return None

    # Construct the diff text block
    diff_text = ""
    for p in patches:
        diff_text += f"\nFile: {p['filename']}\nPatch:\n{p['patch']}\n"

    # Limit total size of the diff text to avoid token bloat
    if len(diff_text) > 25000:
        diff_text = diff_text[:25000] + "\n... [Diff truncated due to size limit] ...\n"

    system_instruction = (
        "You are a senior software architect. Analyze the provided git diff for a Pull Request. "
        "Identify the specific classes, functions, and lines modified. "
        "1. Describe WHAT was changed. "
        "2. Infer the TECHNICAL Rationale/Intent behind the changes (e.g., bug fix, feature addition, refactoring). "
        "Be extremely concise, under 150 words. Do not repeat standard comments."
    )

    user_prompt = (
        f"Pull Request #{pr_number} titled '{pr_title}':\n"
        f"Diff Patches:\n{diff_text}\n"
    )

    try:
        from app.utils.gemini_fallback import generate_content_with_fallback
        response = generate_content_with_fallback(
            contents=user_prompt,
            config={
                "system_instruction": system_instruction,
                "temperature": 0.2,
                "max_output_tokens": 512,
            },
        )
        return response.text.strip() if response.text else None
    except Exception as e:
        logger.error("Failed to analyze PR diff for #%d with Gemini: %s", pr_number, e)
        return None
