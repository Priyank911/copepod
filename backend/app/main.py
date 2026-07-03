"""
Copepod Backend — FastAPI application factory.

Brings together all routers, middleware, and startup logic.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.database import create_tables
from app.services.cognee_service import setup_cognee_env

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifecycle: startup and shutdown."""
    # Configure Cognee environment before any imports
    setup_cognee_env()

    # Create database tables
    await create_tables()

    logger.info("🦐 Copepod backend started")
    yield
    logger.info("🦐 Copepod backend shutting down")


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title="Copepod",
        description="Institutional memory layer for GitHub repositories",
        version="0.1.0",
        lifespan=lifespan,
    )

    # CORS for Studio
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            settings.FRONTEND_URL,
            "http://localhost:3000",
            "http://localhost:3001",
        ],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Register routers
    from app.routers import auth, repos, chat, webhooks

    app.include_router(auth.router)
    app.include_router(repos.router)
    app.include_router(chat.router)
    app.include_router(webhooks.router)

    @app.get("/health")
    async def health():
        return {"status": "ok", "service": "copepod"}

    return app


app = create_app()
