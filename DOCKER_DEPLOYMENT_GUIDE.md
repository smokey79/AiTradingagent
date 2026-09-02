# Docker Deployment - Complete Setup Guide

## Overview

Deploy your entire AI trading agent stack using Docker with Open WebUI, trading services, databases, and caching.

**Components:**
- 🌐 **Open WebUI** — Unified interface for all LLMs (Claude, GPT-4, Gemini, Ollama)
- 📊 **Trading API** — REST API for trading operations
- 🤖 **Ollama** — Local LLM support
- 💾 **PostgreSQL** — Data persistence
- 🔴 **Redis** — Caching & sessions
- 📈 **Dashboard** — Trading visualization

---

## Quick Start

### Prerequisites

**Windows/Mac:**
1. Install Docker Desktop: https://www.docker.com/products/docker-desktop
2. Start Docker Desktop
3. Verify: `docker --version`

**Linux:**
```bash
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
```

### Start All Services

**Windows:**
```cmd
docker-stack-launch.bat
```

**Mac/Linux:**
```bash
chmod +x docker-stack-launch.sh
./docker-stack-launch.sh
```

Or manually:
```bash
docker-compose up -d
```

### Access Services

```
Open WebUI:       http://localhost:3000
Trading Controls: http://localhost:3003/static/trading_controls.html
Dashboard:        http://localhost:3001
Ollama:          http://localhost:11434
Database:        localhost:5432
Cache:           localhost:6379
```

---

## Architecture

```
┌─────────────────────────────────────────────┐
│         Open WebUI (Port 3000)              │
│    Unified LLM Interface (Claude, GPT-4)   │
└──────────────┬──────────────────────────────┘
               │
               ├─→ Ollama (11434)
               │   Local LLM models
               │
               ├─→ Trading API (3003)
               │   ├─ Signal generation
               │   ├─ Trade execution
               │   └─ Mode control
               │
               ├─→ Dashboard (3001)
               │   Real-time analytics
               │
               └─→ Data Layer
                   ├─ PostgreSQL (5432)
                   │  Market data, trades, history
                   │
                   └─ Redis (6379)
                      Caching, sessions
```

---

## docker-compose.yml

Services defined:

1. **open-webui** — Main LLM interface
2. **ollama** — Local model support
3. **trading-api** — Trading operations
4. **postgres** — Data storage
5. **redis** — Caching
6. **dashboard** — Visualization

---

## Configuration

### .env File

Create `.env` with your API keys:

```env
# API Keys
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=...

# Trading Configuration
TRADING_MODE=manual              # automation/manual/hybrid
PAPER_TRADING=true               # false for live
MAX_TRADE_SIZE_USDT=100

# Exchange APIs
BINANCE_API_KEY=...
BINANCE_SECRET=...
BITGET_API_KEY=...
BITGET_SECRET=...
BITGET_API_PASSPHRASE=...

# Database
DB_PASSWORD=secure_password_here

# Optional: Telegram
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
```

---

## Services Explained

### Open WebUI

**What:** Unified web interface for all LLMs

**Features:**
- Access Claude, GPT-4, Gemini from one UI
- Local Ollama models
- Chat history
- API key management
- Model switching

**Access:** http://localhost:3000

**First run:**
1. Open http://localhost:3000
2. Create admin account
3. Add API keys in settings
4. Start chatting

### Trading API

**What:** REST API for all trading operations

**Endpoints:**
- `/api/status` — System status
- `/api/mode/set` — Change trading mode
- `/api/trade/buy` — Execute buy
- `/api/trade/sell` — Execute sell
- `/api/trades` — Trade history

**Access:** http://localhost:3003

**UI:** http://localhost:3003/static/trading_controls.html

### Ollama

**What:** Local LLM support (no API key needed)

**Models:**
- llama2
- mistral
- neural-chat
- dolphin-mixtral

**Usage:**
```bash
# Pull a model
docker exec ollama ollama pull mistral

# Test
curl http://localhost:11434/api/generate -d '{
  "model": "mistral",
  "prompt": "Why is AI awesome?"
}'
```

### PostgreSQL

**What:** Data persistence for trades, history, etc.

**Connection:**
- Host: localhost
- Port: 5432
- Database: trading_db
- User: trader
- Password: (from .env)

**Access:**
```bash
docker exec -it postgres-trading psql -U trader -d trading_db

# List tables
\dt

# Exit
\q
```

### Redis

**What:** Caching and session management

**Access:**
```bash
docker exec -it redis-trading redis-cli

# Check keys
KEYS *

# View cache stats
INFO stats
```

---

## Common Commands

### View logs

```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f open-webui
docker-compose logs -f trading-api

# Last 50 lines
docker-compose logs --tail 50
```

### Stop/Start services

```bash
# Stop all
docker-compose down

# Stop specific service
docker-compose stop open-webui

# Start specific service
docker-compose start trading-api

# Restart
docker-compose restart
```

### Remove volumes (clean slate)

```bash
# Remove all data
docker-compose down -v

# Remove only specific volume
docker volume rm open-webui-data
```

### Execute commands in container

```bash
# Bash shell
docker exec -it trading-api bash

# Run Python
docker exec trading-api python script.py

# Database query
docker exec postgres-trading psql -U trader -d trading_db -c "SELECT * FROM trades;"
```

---

## Monitoring

### Container status

```bash
docker-compose ps
```

### Resource usage

```bash
docker stats
```

### Health checks

```bash
# Check all health
docker-compose exec open-webui curl -f http://localhost:8080/health

# Check trading API
docker-compose exec trading-api curl -f http://localhost:3003/api/health

# Check database
docker-compose exec postgres-trading pg_isready
```

---

## Troubleshooting

### Docker daemon not running

**Error:** `Cannot connect to Docker daemon`

**Fix:** Start Docker Desktop or docker daemon

### Port already in use

**Error:** `Bind for 0.0.0.0:3000 failed: port is already allocated`

**Fix:**
```bash
# Find process using port 3000
lsof -i :3000

# Kill process
kill -9 <PID>

# Or change port in docker-compose.yml
# ports:
#   - "3001:8080"  # Use 3001 instead
```

### Container won't start

**Error:** Container exits immediately

**Fix:**
```bash
# Check logs
docker-compose logs open-webui

# Rebuild
docker-compose down
docker-compose build --no-cache
docker-compose up -d
```

### Database connection refused

**Error:** `Could not connect to server: Connection refused`

**Fix:**
1. Wait 30 seconds for PostgreSQL to start
2. Check postgres container: `docker-compose logs postgres`
3. Verify password in .env
4. Rebuild database: `docker-compose down -v && docker-compose up -d`

---

## Performance Tips

### CPU Usage

```bash
# Limit CPU
docker-compose down
# Edit docker-compose.yml:
# services:
#   open-webui:
#     cpus: '2'
#     mem_limit: '4g'
docker-compose up -d
```

### Memory

```bash
# Check memory usage
docker stats

# Increase swap
# (macOS) Docker Desktop → Preferences → Resources
# (Windows) Docker Desktop → Settings → Resources
```

### Disk Space

```bash
# Clean up unused images/containers
docker system prune -a

# Check usage
docker system df
```

---

## Production Deployment

### Security

```yaml
# Update docker-compose.yml:
services:
  open-webui:
    environment:
      - ENABLE_SIGNUP=false  # Disable new registrations
      - REQUIRE_API_KEY=true # Require API key
```

### Persistent Storage

```bash
# Use named volumes (already in compose file)
# For backups:
docker run --rm -v open-webui-data:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/open-webui-backup.tar.gz /data
```

### Monitoring & Logging

```bash
# Use docker logging drivers
# Edit docker-compose.yml for ELK, Splunk, etc.
```

### Network

```bash
# Don't expose ports directly in production
# Use reverse proxy (nginx, traefik)
# Add SSL/TLS certificates
```

---

## Update Services

### Update Open WebUI

```bash
docker pull ghcr.io/open-webui/open-webui:main
docker-compose up -d open-webui
```

### Update Trading API

```bash
docker-compose build trading-api
docker-compose up -d trading-api
```

### Update all

```bash
docker-compose pull
docker-compose up -d
```

---

## Backup & Restore

### Backup data

```bash
# Backup Open WebUI data
docker run --rm -v open-webui-data:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/open-webui.tar.gz /data

# Backup database
docker exec postgres-trading pg_dump -U trader trading_db > backup.sql
```

### Restore data

```bash
# Restore Open WebUI
docker run --rm -v open-webui-data:/data \
  -v $(pwd):/backup \
  alpine tar xzf /backup/open-webui.tar.gz -C /

# Restore database
docker exec -i postgres-trading psql -U trader trading_db < backup.sql
```

---

## Integration with Host

### Access from host network

```bash
# Add host.docker.internal
docker-compose.yml already includes:
extra_hosts:
  - "host.docker.internal:host-gateway"

# Use in app:
# http://host.docker.internal:8080
```

### Volume mounts

```yaml
# Share files with host
volumes:
  - ./logs:/app/logs
  - ./data:/app/data
  - ./config:/app/config
```

---

## Next Steps

1. ✅ Install Docker Desktop
2. ✅ Create `.env` file with API keys
3. ✅ Run `docker-stack-launch.bat` (Windows) or `./docker-stack-launch.sh` (Mac/Linux)
4. ✅ Open http://localhost:3000
5. ✅ Configure LLM API keys
6. ✅ Start trading!

---

## Support

**Logs:**
```bash
docker-compose logs -f open-webui
docker-compose logs -f trading-api
```

**Status:**
```bash
docker-compose ps
docker-compose exec open-webui curl http://localhost:8080/health
```

**Rebuild:**
```bash
docker-compose down
docker-compose build --no-cache
docker-compose up -d
```

