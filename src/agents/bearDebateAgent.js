/**
 * src/agents/bearDebateAgent.js — NEW 2026-09-27 (Alan's approved Phase 2
 * plan, item 1). Dedicated skeptic for the debate stage. Its ONLY job is
 * to find genuine reasons NOT to take the specific candidate trade the raw
 * weighted vote already proposed — it does not hunt for its own setups
 * (that's bearAgent.js's job, unchanged, still voting independently).
 *
 * 2026-09-27 (Alan's explicit instruction: "use deepseek for bear") —
 * originally ran on local Ollama/Hermes for the same reason
 * aitradingagent2's bearAgent.js does, but that connection was unreachable
 * in practice. Swapped to DeepSeek.
 *
 * 2026-09-27 (later same day) — swapped again, off DeepSeek. Confirmed
 * live via trading-orchestrator's own logs that EVERY SINGLE candidate for
 * over 20 minutes straight was being vetoed with the exact same reason:
 * DeepSeek's direct API returned HTTP 402 (Payment Required — this
 * machine's DeepSeek account has no balance), and pulled OpenRouter's
 * current model list directly (openrouter.ai/api/v1/models) which
 * confirmed there is no longer ANY free-tier DeepSeek model at all
 * (`deepseek/deepseek-r1:free` 404s because it no longer exists — every
 * DeepSeek model on OpenRouter is now paid). So DeepSeek was a 100% dead
 * end with no free option, not an occasional flake — it was hard-vetoing
 * every trade the whole time it ran. Now uses the SAME free-model
 * rotation pool + local-Ollama fallback (openrouterFreeAgent.js's
 * callFreeModelRaw) that bullDebateAgent.js already relies on
 * successfully — no new provider to maintain, and it's the pool the rest
 * of the bot already depends on for real (non-simulated) signals.
 *
 * Fails SAFE: if the whole free pool + local Ollama is unreachable, it
 * vetoes by default rather than silently letting the trade through with
 * one fewer check — matching the standing rule to never loosen a safety
 * check on a failure.
 */
'use strict';
const logger = require('../utils/logger');
const { callFreeModelRaw } = require('./openrouterFreeAgent');

const { parseLenient } = require('../utils/lenientJson');

// 2026-09-29: lenient parse + one "JSON only" retry — a malformed reply used
// to become an automatic veto ("defaulting to caution") on every such pair.
// A genuine failure still defaults to caution below; this only stops
// formatting noise from masquerading as a veto.
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
  const prompt = `You are the BEAR agent (dedicated skeptic) in a live crypto/forex trading consensus system for ${symbol}. The system's other agents have proposed a ${direction} trade right now with a raw weighted confidence of ${(candidate.rawConfidence * 100).toFixed(0)}%. Your ONLY job is to find genuine reasons NOT to take THIS specific trade — overextension, weak momentum, poor risk/reward, or lack of confirmation. Do not manufacture a reason if there genuinely isn't one.

Current price: ${price}
Pattern observations and shared scored evidence (context only): ${JSON.stringify({ patterns: marketData.patternAdvice, learning: marketData.learningContext })}
RSI(14): ${ind.rsi14 ?? 'n/a'} | EMA20: ${ind.ema20 ?? 'n/a'} | EMA50: ${ind.ema50 ?? 'n/a'}
24h change: ${marketData?.price?.change24h ?? 'n/a'}%
Proposer's stated reason: ${candidate.reason || 'n/a'}

Reply with ONLY a JSON object: {"veto": true or false, "confidence": 0.0-1.0, "reason": "one sentence"}. "veto": true means you believe this ${direction} entry should be blocked right now.`;

  try {
    const { parsed, model } = await askJson(prompt, 'veto');
    return {
      agent: 'bear_debate',
      veto: parsed.veto === true || String(parsed.veto).toLowerCase() === 'true', // "false" string must not count as a veto
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
      reason: String(parsed.reason || '').slice(0, 300),
      model,
    };
  } catch (err) {
    logger.warn(`[BearDebate] unavailable for ${symbol}, defaulting to caution: ${err.message}`);
    return { agent: 'bear_debate', veto: true, confidence: 0.5, reason: `Bear debate agent (OpenRouter free pool) unavailable, defaulting to caution: ${err.message}`, error: true };
  }
}

module.exports = { debate };
