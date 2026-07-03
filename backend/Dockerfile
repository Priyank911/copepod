# Copepod Backend Dockerfile
FROM python:3.12-slim

WORKDIR /app

# System deps for cryptography + sqlite
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY pyproject.toml .
RUN pip install --no-cache-dir -e . 2>/dev/null || pip install --no-cache-dir \
    "fastapi>=0.115.0" \
    "uvicorn[standard]>=0.30.0" \
    "sqlalchemy[asyncio]>=2.0.0" \
    "aiosqlite>=0.20.0" \
    "cognee[fastembed]>=0.1.0" \
    "fastembed>=0.3.0" \
    "PyGithub>=2.3.0" \
    "httpx>=0.27.0" \
    "python-jose[cryptography]>=3.3.0" \
    "cryptography>=42.0.0" \
    "pydantic-settings>=2.3.0" \
    "sse-starlette>=2.0.0" \
    "google-genai>=1.0.0" \
    "python-multipart>=0.0.9"

# Copy application code
COPY app/ app/

# Expose port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD python -c "import httpx; httpx.get('http://localhost:8000/health').raise_for_status()" || exit 1

# Run
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
