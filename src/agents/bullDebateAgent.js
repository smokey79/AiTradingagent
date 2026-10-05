/**
 * src/agents/bullDebateAgent.js — NEW 2026-09-27 (Alan's approved Phase 2
 * plan, item 1: "1 bull/bear build configure impliment").
 *
 * Unlike bullAgent.js (an independent EMA/SMC pattern-hunter that casts
 * its own raw vote in the 12-agent weighted consensus), this agent does
 * NOT hunt for its own setups. It is handed the SPECIFIC candidate trade
 * (symbol + direction + the raw weighted vote's confidence) that the
 * existing consensus already produced, and argues the honest case FOR
 * taking THAT trade right now, or admits there isn't one. This is the
 * genuine "Bull" half of the debate structure, ported conceptually from
 * F:\aitradingagent2\src\agents\bullAgent.js (see
 * claude/session-2026-09-27-strategyresearcher-live-and-merge-plan.md).
 *
 * Runs on OpenRouter's free-model pool via openrouterFreeAgent's
 * callFreeModelRaw() (added alongside this file) — same rotation/fallback
 * chain the rest of the bot already relies on, just with a debate-specific
 * prompt instead of the standalone signal-hunting one.
 */
'use strict';
const logger = require('../utils/logger');
const { callFreeModelRaw } = require('./openrouterFreeAgent');

const { parseLenient } = require('../utils/lenientJson');

// 2026-09-29: lenient parse + one "JSON only" retry — free models often put
// prose ("We need to...") before the JSON or cut it off, which was losing
// the Bull vote on most pairs.
async function askJson(prompt, requiredKey) {
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    const p = attempt === 0 ? prompt
      : `${prompt}\n\nIMPORTANT: your previous reply was not valid JSON. Output ONLY the JSON object on one line — no thinking, no other words.`;
    try {
      const { text, model } = await callFreeModelRaw(p);
      return { parsed: parseLenient(text, requiredKey), model };
    } catch (err) { lastErr = err; }
  }
  throw lastErr;
}

async function debate(symbol, marketData, candidate) {
  const ind = marketData?.indicators || {};
  const price = marketData?.price?.price;
  const direction = candidate.direction === 'SELL' ? 'SHORT (SELL)' : 'LONG (BUY)';
  const prompt = `You are the BULL agent in a live multi-agent crypto/forex trading consensus system. Your role is to argue FOR taking trades only when there is a genuine case — not to always be optimistic. The system's other agents have already proposed a ${direction} trade on ${symbol} right now, with a raw weighted confidence of ${(candidate.rawConfidence * 100).toFixed(0)}%. Your job is to make the strongest honest case FOR entering THIS specific trade, or admit there isn't one.

Current price: ${price}
RSI(14): ${ind.rsi14 ?? 'n/a'} | EMA20: ${ind.ema20 ?? 'n/a'} | EMA50: ${ind.ema50 ?? 'n/a'}
24h change: ${marketData?.price?.change24h ?? 'n/a'}%
Proposer's stated reason: ${candidate.reason || 'n/a'}
Pattern observations and shared scored evidence (context only): ${JSON.stringify({ patterns: marketData.patternAdvice, learning: marketData.learningContext })}

Reply with ONLY a JSON object: {"signal": "ENTER" or "HOLD", "confidence": 0.0-1.0, "reason": "one sentence"}. Do not say ENTER unless there is a genuine, specific reason grounded in the data above — do not default to optimism.`;

  try {
    const { parsed, model } = await askJson(prompt, 'signal');
    return {
      agent: 'bull_debate',
      signal: String(parsed.signal).toUpperCase() === 'ENTER' ? 'ENTER' : 'HOLD',
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
      reason: String(parsed.reason || '').slice(0, 300),
      model,
    };
  } catch (err) {
    logger.warn(`[BullDebate] unavailable for ${symbol}: ${err.message}`);
    return { agent: 'bull_debate', signal: 'HOLD', confidence: 0, reason: `Bull debate agent unavailable: ${err.message}`, error: true };
  }
}

module.exports = { debate };
