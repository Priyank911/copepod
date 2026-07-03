"""
Configuration loader for Copepod MCP Server.

Reads .copepod/config.json from the project root or from
the COPEPOD_CONFIG environment variable.
"""

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Optional


@dataclass
class CopepodConfig:
    """Configuration for connecting to a Copepod backend instance."""

    api_url: str
    api_key: str
    repo_id: str

    @classmethod
    def load(cls) -> "CopepodConfig":
        """
        Load config from (in order of priority):
        1. COPEPOD_CONFIG env var pointing to a JSON file
        2. .copepod/config.json in the current working directory
        3. Walk up parent directories looking for .copepod/config.json
        """
        config_path = os.environ.get("COPEPOD_CONFIG")

        if config_path:
            path = Path(config_path)
        else:
            # Walk up from cwd looking for .copepod/config.json
            path = cls._find_config_file()

        if path is None or not path.exists():
            raise FileNotFoundError(
                "No .copepod/config.json found. "
                "Create one in your project root or set COPEPOD_CONFIG env var.\n"
                "Expected format:\n"
                '{\n  "api_url": "http://localhost:8000",\n'
                '  "api_key": "your-copepod-api-key",\n'
                '  "repo_id": "your-repo-uuid"\n}'
            )

        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)

        required_keys = ["api_url", "api_key", "repo_id"]
        missing = [k for k in required_keys if k not in data]
        if missing:
            raise ValueError(
                f"Missing required keys in config: {', '.join(missing)}"
            )

        return cls(
            api_url=data["api_url"].rstrip("/"),
            api_key=data["api_key"],
            repo_id=data["repo_id"],
        )

    @staticmethod
    def _find_config_file() -> Optional[Path]:
        """Walk up from cwd looking for .copepod/config.json."""
        current = Path.cwd()
        while True:
            candidate = current / ".copepod" / "config.json"
            if candidate.exists():
                return candidate
            parent = current.parent
            if parent == current:
                break
            current = parent
        return None
