#!/bin/bash
# paper-trading-launch.sh
# Launch JEDAI trading agent in paper (simulated) mode

set -e

echo "=================================================="
echo "JEDAI Trading Agent - Paper Trading Mode"
echo "=================================================="
echo ""
echo "Starting Docker environment for paper trading..."
echo "This will run simulated trades using historical data."
echo ""

# Load paper trading env
if [ ! -f .env.paper ]; then
    echo "ERROR: .env.paper not found. Run from F:\aitradingagent"
    exit 1
fi

# Copy to .env for docker-compose
cp .env.paper .env

echo "✓ Configuration loaded"
echo ""
echo "Starting services..."
docker compose up --pull always -d

echo ""
echo "Waiting for services to initialize (30s)..."
sleep 30

# Check status
echo ""
echo "=================================================="
echo "Service Status"
echo "=================================================="
docker compose ps

echo ""
echo "=================================================="
echo "Paper Trading Started"
echo "=================================================="
echo ""
echo "Access points:"
echo "  • Trading API:      http://localhost:3003"
echo "  • Dashboard:        http://localhost:3001"
echo "  • Open WebUI:       http://localhost:3000"
echo "  • Database:         postgres://trader@localhost:5432/trading_db"
echo ""
echo "Logs:"
echo "  • All services:     docker compose logs -f"
echo "  • Trading API only: docker compose logs -f trading-api"
echo ""
echo "To stop:"
echo "  docker compose down"
echo ""
echo "Full 3-month backtest summary:"
cat backtest_simple_result.json | jq '.summary'
echo ""
