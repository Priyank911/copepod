# Copepod MCP Server Dockerfile
FROM python:3.12-slim

WORKDIR /app

COPY pyproject.toml .
RUN pip install --no-cache-dir -e . 2>/dev/null || pip install --no-cache-dir \
    "fastmcp>=2.0.0" \
    "httpx>=0.27.0"

COPY copepod_mcp/ copepod_mcp/

EXPOSE 8080

CMD ["copepod-mcp"]
