"""
Pydantic request / response schemas for every API surface.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


# ── User ──────────────────────────────────────────────────────────────

class UserOut(BaseModel):
    id: int
    github_id: int
    github_login: str
    github_name: str | None = None
    avatar_url: str | None = None
    api_key: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Repo ──────────────────────────────────────────────────────────────

class RepoCreate(BaseModel):
    full_name: str = Field(..., examples=["octocat/hello-world"], description="owner/repo")


class RepoOut(BaseModel):
    id: int
    github_repo_id: int
    full_name: str
    default_branch: str
    webhook_active: bool
    dataset_name: str
    is_ingested: bool
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Ingestion Job ────────────────────────────────────────────────────

class IngestionJobOut(BaseModel):
    id: int
    repo_id: int
    kind: str
    status: str
    progress: int
    message: str | None = None
    error: str | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Chat ──────────────────────────────────────────────────────────────

class ChatRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=4096)
    include_code: bool = Field(default=True, description="Include code structure in recall")


class SourceCitation(BaseModel):
    type: str = Field(..., description="pr, issue, commit, code")
    title: str
    url: str | None = None
    relevance: float = Field(default=1.0, ge=0, le=1)


class ChatResponse(BaseModel):
    answer: str
    sources: list[SourceCitation] = []
    dataset: str
    query: str


# ── File Context ──────────────────────────────────────────────────────

class FileContextRequest(BaseModel):
    path: str = Field(..., description="Repo-relative file path")


class PRSummary(BaseModel):
    pr_number: int
    title: str
    author: str
    merged_at: datetime | None = None
    satisfaction_score: float = Field(default=0.0, ge=0.0, le=1.0)
    review_comments: int = 0
    changes_requested: int = 0
    approvals: int = 0


class FileContextOut(BaseModel):
    path: str
    total_prs: int
    avg_satisfaction: float
    prs: list[PRSummary]


# ── PR History Tree (VS Code) ────────────────────────────────────────

class PRHistoryNode(BaseModel):
    pr_number: int
    title: str
    author: str
    merged_at: datetime | None = None
    files_changed: list[str] = []
    children: list["PRHistoryNode"] = []


# ── Progress SSE ──────────────────────────────────────────────────────

class ProgressEvent(BaseModel):
    job_id: int
    status: str
    progress: int
    message: str | None = None
    error: str | None = None


# ── Webhook Payload (internal) ────────────────────────────────────────

class WebhookPayload(BaseModel):
    event: str
    action: str | None = None
    payload: dict[str, Any] = {}
