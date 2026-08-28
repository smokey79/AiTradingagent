FROM node:24-alpine AS node-builder
WORKDIR /app
RUN apk add --no-cache python3 py3-pip build-base curl

# Copy Node dependencies
COPY package*.json ./
RUN npm ci --production 2>/dev/null || true

# Build Python stage with all LLM and trading dependencies
FROM python:3.11-slim AS python-runtime
WORKDIR /app

# Install system dependencies for TA-Lib and other native packages
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Final production stage
FROM python:3.11-slim
WORKDIR /app

# Install runtime dependencies only
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy Node runtime and modules from builder (for MCP servers)
COPY --from=node-builder /usr/local/bin/node /usr/local/bin/
COPY --from=node-builder /app/node_modules ./node_modules
COPY --from=node-builder /app/package*.json ./

# Copy Python dependencies from builder
COPY --from=python-runtime /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages

# Copy application code
COPY . .

# Environment variables
ENV NODE_ENV=production \
    PYTHONUNBUFFERED=1 \
    PORT=3002 \
    DASHBOARD_PORT=3002 \
    WAITRESS_THREADS=8

# Expose service ports
EXPOSE 3001 3002 3003 5000

# Health check for main dashboard service
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:3002/health || exit 1

# Default command - run web dashboard
CMD ["python", "wsgi.py"]
