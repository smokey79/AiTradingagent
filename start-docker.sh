#!/usr/bin/env bash
# start-docker.sh - Quick start script for AiTradingAgent Docker

set -e

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "========================================="
echo "🚀 AiTradingAgent Docker Startup"
echo "========================================="

# Check if .env exists
if [ ! -f "$PROJECT_DIR/.env" ]; then
    echo "⚠️  .env not found. Creating from .env.example..."
    cp "$PROJECT_DIR/.env.example" "$PROJECT_DIR/.env"
    echo "📝 Edit .env with your API keys before running!"
    exit 1
fi

# Check Docker
if ! command -v docker &> /dev/null; then
    echo "❌ Docker not found. Install Docker Desktop and try again."
    exit 1
fi

echo "✅ Pulling latest images..."
cd "$PROJECT_DIR/docker"
docker compose --pull always pull

echo "📦 Building multi-LLM trading agent image..."
docker compose build --no-cache

echo "🔥 Starting services..."
docker compose up --detach

echo ""
echo "========================================="
echo "✨ AiTradingAgent Running!"
echo "========================================="
echo ""
echo "📊 Dashboard:      http://localhost:3002"
echo "🛡️  Risk Gate:      http://localhost:3001"
echo "📡 Signal Engine:   http://localhost:3003"
echo "💼 Portfolio:       http://localhost:3004"
echo ""
echo "View logs:"
echo "  docker compose logs -f dashboard"
echo ""
echo "Stop all services:"
echo "  docker compose down"
echo ""
