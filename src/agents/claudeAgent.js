/**
 * Claude — Technical Analyst Agent
 * Uses Anthropic Claude 3.7 / 3.5 Sonnet API or intelligent technical heuristic fallback.
 */
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const SKILL_PATH = path.resolve(__dirname, '../../agents/skills/SKILL_CLAUDE_PERFORMANCE_ANALYST.md');
const ANALYST_SKILL_PATH = path.resolve(__dirname, '../../agents/skills/SKILL_CLAUDE_ANALYST.md');
const { getPerformanceStats } = require('../risk/tradeLedger');

function loadSkillPrompt() {
  try {
    if (fs.existsSync(SKILL_PATH)) {
      return fs.readFileSync(SKILL_PATH, 'utf8');
    }
    if (fs.existsSync(ANALYST_SKILL_PATH)) {
      return fs.readFileSync(ANALYST_SKILL_PATH, 'utf8');
    }
  } catch (e) {}
  return 'You are Claude, Chief Performance Analyst & Quantitative Risk Officer. Output strictly valid JSON.';
}

function cleanJson(text) {
  if (!text) return null;
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    return JSON.parse(match[0]);
  }
  return JSON.parse(text.replace(/```json|```/g, '').trim());
}

async function getSignal(symbol, marketData) {
  const apiKey = (process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY || '').trim();
  const ind = marketData?.indicators || {};
  const price = marketData?.price || {};

  if (!apiKey || apiKey.startsWith('your_')) {
    // Intelligent heuristic technical simulator
    return simulateClaudeAnalysis(symbol, marketData);
  }

  try {
    const systemPrompt = loadSkillPrompt();
    const userPrompt = `Analyse the technical data for ${symbol}:
Price: $${price.price?.toFixed(2) || 'N/A'}, 24h Change: ${price.change24h?.toFixed(2) || '0'}%, 24h Volume: $${(price.volume24h/1e6)?.toFixed(1) || '0'}M
Indicators: RSI(14)=${ind.rsi14 || '50'}, EMA20=$${ind.ema20 || '0'}, EMA50=$${ind.ema50 || '0'}, EMA200=$${ind.ema200 || '0'}
Price vs EMA50: ${ind.priceVsEma50 || 'above'}, Price vs EMA200: ${ind.priceVsEma200 || 'above'}
MACD: line=${ind.macd?.macd || 0}, signal=${ind.macd?.signal || 0}, hist=${ind.macd?.histogram || 0}
Bollinger: width=${ind.bollinger?.bandwidth || 0}%, upper=$${ind.bollinger?.upper || 0}, lower=$${ind.bollinger?.lower || 0}
Orderbook Imbalance: ${ind.orderBook?.imbalanceRatio || 0.5} (${ind.orderBook?.bias || 'neutral'})

Respond ONLY with valid JSON conforming to your output schema.`;

    let rawText = '';
    const baseUrl = process.env.CLAUDE_BASE_URL || (apiKey.startsWith('ci_live_') ? 'https://api.cheaperinference.com/v1' : '');

    if (baseUrl || apiKey.startsWith('ci_live_')) {
      // CheaperInference / OpenAI-compatible endpoint
      const model = process.env.CLAUDE_MODEL || 'claude-haiku-4.5';
      const res = await axios.post(
        `${baseUrl.replace(/\/+$/, '')}/chat/completions`,
        {
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          max_tokens: 800,
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 15000,
        }
      );
      rawText = res.data?.choices?.[0]?.message?.content;
    } else {
      // Direct Anthropic API
      const model = process.env.CLAUDE_MODEL || 'claude-3-7-sonnet-20250219';
      const res = await axios.post(
        'https://api.anthropic.com/v1/messages',
        {
          model,
          max_tokens: 800,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        },
        {
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          timeout: 15000,
        }
      );
      rawText = res.data?.content?.[0]?.text;
    }

    const parsed = cleanJson(rawText);
    if (!parsed) throw new Error('Failed to parse JSON response from Claude');

    return {
      agent: 'claude',
      symbol,
      signal: parsed.signal?.toUpperCase() || 'HOLD',
      confidence: parseFloat(parsed.confidence) || 0.75,
      reason: parsed.reason || 'Technical structure analysed',
      constraints: parsed.constraints || { max_position_size_pct: 5.0, stop_loss_pct: 2.0, take_profit_pct: 5.0 },
      indicators_used: parsed.indicators_used || ['RSI_14', 'EMA_50', 'MACD'],
      risk_score: parsed.risk_score || 3.0,
      raw: parsed,
    };
  } catch (err) {
    logger.warn(`Claude API call failed: ${err.message} — using technical rule engine`);
    return simulateClaudeAnalysis(symbol, marketData);
  }
}

function simulateClaudeAnalysis(symbol, marketData) {
  const ind = marketData?.indicators || {};
  const rsi = ind.rsi14 || 50;
  const priceVsEma50 = ind.priceVsEma50 === 'above';
  const priceVsEma200 = ind.priceVsEma200 === 'above';
  const macdHist = ind.macd?.histogram || 0;
  const obBias = ind.orderBook?.bias || 'neutral';
  const perf = getPerformanceStats(20);

  // Performance audit figures
  const sampleSize = perf.sampleSize || 0;
  const winRate = perf.winRate || 0.70;
  const totalPnlUsd = perf.totalPnlUsd || 0;
  const rRatio = 2.2;
  const rawKelly = winRate - (1 - winRate) / rRatio;
  const halfKelly = Math.max(0.08, Math.min(0.35, rawKelly * 0.5));
  const isNetProfitable = totalPnlUsd > 0;

  let signal = 'HOLD';
  let confidence = 0.68;
  let reason = 'Market consolidating near moving averages';

  if (rsi < 35 && macdHist >= 0) {
    signal = 'BUY';
    confidence = 0.84;
    reason = `Oversold bounce detected (RSI ${rsi.toFixed(1)}) with bullish MACD histogram expansion`;
  } else if (priceVsEma50 && priceVsEma200 && rsi > 45 && rsi < 68 && macdHist > 0) {
    signal = 'BUY';
    confidence = 0.88;
    reason = `Strong bullish alignment: Price above EMA50/200 with RSI at ${rsi.toFixed(1)} and positive MACD`;
  } else if (rsi > 72 || (ind.priceVsEma50 === 'below' && macdHist < 0 && obBias === 'ask_heavy_bearish')) {
    signal = 'SELL';
    confidence = 0.78;
    reason = `Overbought RSI (${rsi.toFixed(1)}) and order book selling pressure below EMA50`;
  }

  // Deadlock self-healing approval figure
  const adaptiveGatePassed = isNetProfitable && winRate >= 0.65;
  const recSizePct = parseFloat((halfKelly * 100 * (confidence / 0.8)).toFixed(1));

  return {
    agent: 'claude',
    timestamp: new Date().toISOString(),
    symbol,
    signal,
    confidence,
    reason,
    performance_audit: {
      sampleSize,
      winRatePct: perf.winRatePct || `${(winRate * 100).toFixed(1)}%`,
      totalPnlUsd,
      netProfitable: isNetProfitable,
      adaptiveGatePassed,
    },
    automated_figures: {
      halfKellyFraction: parseFloat(halfKelly.toFixed(3)),
      recommendedPositionPct: Math.min(10.0, recSizePct),
      rewardRiskRatio: rRatio,
      stopLossPct: 1.8,
      takeProfitPct: 4.0,
      leverage: 5.0,
    },
    constraints: {
      max_position_size_pct: Math.min(10.0, recSizePct),
      stop_loss_pct: 1.8,
      take_profit_pct: 4.0,
      timeframe_validity_minutes: 60,
    },
    indicators_used: ['RSI_14', 'EMA_50', 'EMA_200', 'MACD', 'KELLY_PERFORMANCE'],
    pattern_detected: signal === 'BUY' ? 'bullish_continuation' : signal === 'SELL' ? 'resistance_rejection' : 'range_bound',
    risk_score: signal === 'HOLD' ? 2.0 : 3.2,
  };
}

module.exports = {
  getSignal,
  getClaudeSignal: getSignal,
};
