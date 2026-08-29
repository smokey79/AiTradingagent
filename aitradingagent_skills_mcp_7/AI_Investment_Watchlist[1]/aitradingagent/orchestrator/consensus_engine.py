"""
AiTradingAgent Consensus Engine
================================
Orchestrates all 6 AI agents and produces a final approved trade decision.

AGENTS:
  1. Claude (Anthropic API)     - Technical analysis
  2. GPT-4o (OpenAI API)        - Sentiment + macro
  3. Grok (xAI via OpenRouter)  - Real-time news
  4. Gemini (Google API)        - Cross-validation
  5. Perplexity (Perplexity API)- Deep research
  6. Copilot (Orchestrator)     - Meta-synthesis via Claude API

HOW TO RUN:
  python orchestrator/consensus_engine.py --symbol BTC/USDT

REQUIREMENTS:
  pip install anthropic openai httpx python-dotenv requests --break-system-packages
"""

import os
import json
import asyncio
import logging
import argparse
from datetime import datetime
from pathlib import Path

import httpx
from dotenv import load_dotenv

# ── Load .env ──────────────────────────────────────────────────────────────────
load_dotenv(Path(__file__).parent.parent / ".env")

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")
OPENAI_API_KEY    = os.getenv("OPENAI_API_KEY")
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")   # for Grok
GEMINI_API_KEY    = os.getenv("GEMINI_API_KEY")
PERPLEXITY_API_KEY = os.getenv("PERPLEXITY_API_KEY")

# ── Logging ────────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
    handlers=[
        logging.FileHandler("data/consensus_engine.log"),
        logging.StreamHandler(),
    ],
)
log = logging.getLogger("ConsensusEngine")

# ── Load skill files ──────────────────────────────────────────────────────────
SKILLS_DIR = Path(__file__).parent.parent / "agents" / "skills"

def load_skill(filename: str) -> str:
    """Load agent skill markdown as system prompt."""
    skill_path = SKILLS_DIR / filename
    if skill_path.exists():
        return skill_path.read_text(encoding="utf-8")
    log.warning(f"Skill file not found: {filename}")
    return "You are a trading analyst. Respond only in valid JSON."


# ══════════════════════════════════════════════════════════════════════════════
# AGENT CALLERS
# ══════════════════════════════════════════════════════════════════════════════

async def call_claude(market_data: dict) -> dict:
    """
    Claude — Technical Analyst
    Uses: Anthropic API (claude-sonnet-4-20250514)
    Skill: SKILL_CLAUDE_ANALYST.md
    """
    system_prompt = load_skill("SKILL_CLAUDE_ANALYST.md")
    user_message  = f"Analyse this market data and return your JSON signal:\n{json.dumps(market_data, indent=2)}"

    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": ANTHROPIC_API_KEY,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": "claude-sonnet-4-20250514",
                "max_tokens": 1024,
                "system": system_prompt,
                "messages": [{"role": "user", "content": user_message}],
            },
        )
        response.raise_for_status()
        raw = response.json()["content"][0]["text"]
        return json.loads(raw.strip())


async def call_gpt4o(market_data: dict) -> dict:
    """
    GPT-4o — Sentiment & Macro
    Uses: OpenAI API
    Skill: SKILL_GPT4O_SENTIMENT.md
    """
    system_prompt = load_skill("SKILL_GPT4O_SENTIMENT.md")
    user_message  = f"Analyse this data and return your JSON signal:\n{json.dumps(market_data, indent=2)}"

    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(
            "https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {OPENAI_API_KEY}"},
            json={
                "model": "gpt-4o",
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_message},
                ],
                "response_format": {"type": "json_object"},
                "max_tokens": 1024,
            },
        )
        response.raise_for_status()
        raw = response.json()["choices"][0]["message"]["content"]
        return json.loads(raw)


async def call_grok(market_data: dict) -> dict:
    """
    Grok — Real-Time News & Social
    Uses: xAI via OpenRouter
    Skill: SKILL_GROK_REALTIME.md
    """
    system_prompt = load_skill("SKILL_GROK_REALTIME.md")
    user_message  = f"Analyse real-time signals and return JSON:\n{json.dumps(market_data, indent=2)}"

    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={"Authorization": f"Bearer {OPENROUTER_API_KEY}"},
            json={
                "model": "x-ai/grok-3",
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_message},
                ],
                "max_tokens": 1024,
            },
        )
        response.raise_for_status()
        raw = response.json()["choices"][0]["message"]["content"]
        return json.loads(raw.strip())


async def call_gemini(market_data: dict, agent_outputs: list) -> dict:
    """
    Gemini — Cross-Validator
    Uses: Google Gemini API
    Skill: SKILL_GEMINI_CROSSVALIDATOR.md
    Receives all other agent outputs for cross-validation
    """
    system_prompt = load_skill("SKILL_GEMINI_CROSSVALIDATOR.md")
    user_message = (
        f"Market data:\n{json.dumps(market_data, indent=2)}\n\n"
        f"Other agent outputs for validation:\n{json.dumps(agent_outputs, indent=2)}\n\n"
        "Cross-validate and return your JSON signal."
    )

    async with httpx.AsyncClient(timeout=45) as client:
        response = await client.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={GEMINI_API_KEY}",
            json={
                "systemInstruction": {"parts": [{"text": system_prompt}]},
                "contents": [{"parts": [{"text": user_message}]}],
                "generationConfig": {"responseMimeType": "application/json", "maxOutputTokens": 1024},
            },
        )
        response.raise_for_status()
        raw = response.json()["candidates"][0]["content"]["parts"][0]["text"]
        return json.loads(raw)


async def call_perplexity(symbol: str) -> dict:
    """
    Perplexity — Deep Research & Fundamentals
    Uses: Perplexity API
    Skill: SKILL_PERPLEXITY_RESEARCHER.md
    """
    system_prompt = load_skill("SKILL_PERPLEXITY_RESEARCHER.md")
    coin_name = symbol.split("/")[0]
    user_message = (
        f"Research the fundamental health, recent developments, token unlocks, "
        f"developer activity, and TVL trends for {coin_name}. "
        f"Return only the JSON signal schema."
    )

    async with httpx.AsyncClient(timeout=45) as client:
        response = await client.post(
            "https://api.perplexity.ai/chat/completions",
            headers={"Authorization": f"Bearer {PERPLEXITY_API_KEY}"},
            json={
                "model": "llama-3.1-sonar-large-128k-online",
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_message},
                ],
                "max_tokens": 1024,
            },
        )
        response.raise_for_status()
        raw = response.json()["choices"][0]["message"]["content"]
        # Strip potential markdown fences
        raw = raw.strip().lstrip("```json").rstrip("```").strip()
        return json.loads(raw)


async def call_copilot_orchestrator(symbol: str, all_agent_outputs: list) -> dict:
    """
    Copilot — Meta-Orchestrator
    Uses: Anthropic Claude API (claude-sonnet-4-20250514)
    Skill: SKILL_COPILOT_ORCHESTRATOR.md
    This is the FINAL decision maker — synthesises all 5 agent signals.
    """
    system_prompt = load_skill("SKILL_COPILOT_ORCHESTRATOR.md")
    user_message = (
        f"Symbol: {symbol}\n"
        f"All 5 agent signals:\n{json.dumps(all_agent_outputs, indent=2)}\n\n"
        "Apply consensus logic and return the final orchestrator JSON decision."
    )

    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": ANTHROPIC_API_KEY,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": "claude-sonnet-4-20250514",
                "max_tokens": 1024,
                "system": system_prompt,
                "messages": [{"role": "user", "content": user_message}],
            },
        )
        response.raise_for_status()
        raw = response.json()["content"][0]["text"]
        return json.loads(raw.strip())


# ══════════════════════════════════════════════════════════════════════════════
# CONSENSUS ENGINE
# ══════════════════════════════════════════════════════════════════════════════

async def run_consensus(symbol: str, market_data: dict) -> dict:
    """
    Full consensus pipeline:
    Step 1: Run Claude, GPT-4o, Grok, Perplexity in PARALLEL
    Step 2: Feed all outputs to Gemini for cross-validation
    Step 3: Feed everything to Copilot for final decision
    Step 4: Log result
    """
    log.info(f"=== CONSENSUS CYCLE START | {symbol} ===")

    # ── Step 1: Parallel agent calls ─────────────────────────────────────────
    log.info("Step 1: Calling Claude, GPT-4o, Grok, Perplexity in parallel...")
    results = await asyncio.gather(
        call_claude(market_data),
        call_gpt4o(market_data),
        call_grok(market_data),
        call_perplexity(symbol),
        return_exceptions=True,
    )

    agent_names = ["claude", "gpt4o", "grok", "perplexity"]
    agent_outputs = []
    for name, result in zip(agent_names, results):
        if isinstance(result, Exception):
            log.error(f"  {name} FAILED: {result}")
            agent_outputs.append({"agent": name, "error": str(result), "signal": "HOLD", "confidence": 0})
        else:
            log.info(f"  {name}: signal={result.get('signal')} confidence={result.get('confidence')}")
            agent_outputs.append(result)

    # ── Step 2: Gemini cross-validation ──────────────────────────────────────
    log.info("Step 2: Gemini cross-validation...")
    try:
        gemini_output = await call_gemini(market_data, agent_outputs)
        log.info(f"  gemini: signal={gemini_output.get('signal')} validation={gemini_output.get('validation_result')}")
        agent_outputs.append(gemini_output)
    except Exception as e:
        log.error(f"  Gemini FAILED: {e}")
        agent_outputs.append({"agent": "gemini", "error": str(e), "signal": "HOLD", "confidence": 0})

    # ── Step 3: Copilot final decision ────────────────────────────────────────
    log.info("Step 3: Copilot meta-orchestration...")
    try:
        final_decision = await call_copilot_orchestrator(symbol, agent_outputs)
        log.info(f"  FINAL: signal={final_decision.get('final_signal')} "
                 f"approved={final_decision.get('approved_for_execution')} "
                 f"confidence={final_decision.get('consensus_confidence')}")
    except Exception as e:
        log.error(f"  Copilot FAILED: {e}")
        final_decision = {
            "orchestrator": "copilot",
            "timestamp": datetime.utcnow().isoformat(),
            "symbol": symbol,
            "final_signal": "HOLD",
            "consensus_confidence": 0,
            "consensus_reached": False,
            "approved_for_execution": False,
            "veto_triggered": True,
            "veto_reason": f"Orchestrator error: {e}",
            "reasoning": "System error — defaulting to HOLD for safety",
        }

    # ── Step 4: Package and log ────────────────────────────────────────────────
    package = {
        "cycle_id": f"C{int(datetime.utcnow().timestamp())}",
        "symbol": symbol,
        "completed_at": datetime.utcnow().isoformat(),
        "agent_signals": agent_outputs,
        "final_decision": final_decision,
    }

    os.makedirs("data", exist_ok=True)
    log_path = f"data/cycle_{package['cycle_id']}.json"
    with open(log_path, "w") as f:
        json.dump(package, f, indent=2)
    log.info(f"Cycle logged: {log_path}")
    log.info(f"=== CONSENSUS CYCLE END | approved={final_decision.get('approved_for_execution')} ===")

    return package


# ══════════════════════════════════════════════════════════════════════════════
# MAIN ENTRYPOINT
# ══════════════════════════════════════════════════════════════════════════════

async def main():
    parser = argparse.ArgumentParser(description="AiTradingAgent Consensus Engine")
    parser.add_argument("--symbol", default="BTC/USDT", help="Trading pair e.g. BTC/USDT")
    parser.add_argument("--paper", action="store_true", default=True, help="Paper trading mode (default: True)")
    args = parser.parse_args()

    log.info(f"AiTradingAgent Consensus Engine starting | symbol={args.symbol} | paper={args.paper}")

    # Placeholder market data — in production this comes from MCP trading-data-server
    market_data = {
        "symbol": args.symbol,
        "paper_mode": args.paper,
        "timestamp": datetime.utcnow().isoformat(),
        "note": "In production, inject live market_data from MCP trading-data-server tools here",
    }

    result = await run_consensus(args.symbol, market_data)
    print("\n" + "="*60)
    print("FINAL DECISION:")
    print(json.dumps(result["final_decision"], indent=2))
    print("="*60)


if __name__ == "__main__":
    asyncio.run(main())
