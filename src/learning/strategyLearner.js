import fs from "fs";
import path from "path";
import axios from "axios";
import { logger } from "../utils/logger.js";
import { loadStrategyMemory, appendTradeRecord } from "../strategy/strategyMemoryLoader.js";

/**
 * StrategyLearner — Self-Learning Module v3 (RAU Edition)
 * =========================================================
 * Called after every paper/live trade closes. Updates:
 *   1. strategy_memory.json  — win rate, avg win/loss, symbol stats
 *   2. agent_accuracy        — which agents voted correctly
 *   3. channel_credibility   — YouTube channel weights updated ONLY on outcome
 *   4. Kelly position sizing — recalculated from rolling win/loss data
 *   5. Learning memory decay — entries > 30 days halved, > 60 days pruned
 *   6. Win rate gate check   — alerts when 80%/20-trade gate is met
 *   7. Telegram notification — sends outcome + gate status
 *
 * RAU fix: channel credibility is NEVER updated at ingest time.
 * It is updated here, and ONLY here, once a real trade outcome is known.
 */

const MEMORY_PATH         = path.resolve("src/strategy/strategy_memory.json");
const CREDIBILITY_PATH    = path.resolve("src/sentiment/channel_credibility.json");
const LEARNING_MEMORY_PATH = path.resolve("data/learning_memory.json");
const WIN_RATE_GATE       = parseFloat(process.env.WIN_RATE_GATE   || "0.80");
const MIN_TRADES_GATE     = 20;
const TELEGRAM_TOKEN      = process.env.TELEGRAM_BOT_TOKEN         || "";
const TELEGRAM_CHAT       = process.env.TELEGRAM_CHAT_ID            || "";
const TELEGRAM_ON         = (process.env.TELEGRAM_ALERTS_ENABLED   || "false").toLowerCase() === "true";

// Memory decay thresholds
const DECAY_HALF_DAYS  = 30;  // entries older than 30 days → confidence halved
const DECAY_PRUNE_DAYS = 60;  // entries older than 60 days → removed

export class StrategyLearner {
  constructor() {
    this.memory = loadStrategyMemory();
    logger.info(`StrategyLearner ready. Trades so far: ${this.memory.tradeHistory?.length || 0}`);
  }

  // ── Main entry — call after every trade closes ──────────────────────────

  async recordOutcome({
    symbol, side, entryPrice, exitPrice,
    sizeUsdt, pnlUsdt, pnlPct,
    agentVotes = {}, youtubeChannels = [], exchange = "bitget",
  }) {
    const isWin = pnlUsdt > 0;
    logger.info(`Recording: ${symbol} ${side} | ${isWin ? "WIN" : "LOSS"} | $${pnlUsdt.toFixed(2)} (${(pnlPct*100).toFixed(2)}%)`);

    const record = { symbol, side, entryPrice, exitPrice, sizeUsdt, pnlUsdt, pnlPct, isWin, exchange, agentVotes, youtubeChannels };
    this.memory = appendTradeRecord(this.memory, record);

    this.#updateStats(pnlUsdt, pnlPct, symbol, isWin);
    this.#updateAgentAccuracy(agentVotes, isWin);
    this.#updateChannelCredibility(youtubeChannels, isWin); // outcome-only, never at ingest
    this.#decayLearningMemory();                            // prune/decay stale learned content

    const kelly      = this.#recalcKelly();
    const gateStatus = this.#checkGate();

    this.#saveMemory();
    await this.#sendTelegram({ symbol, pnlUsdt, pnlPct, isWin, gateStatus, kelly });

    logger.info(`Update done. Win rate: ${(gateStatus.winRate*100).toFixed(1)}% | Kelly: ${(kelly*100).toFixed(2)}%`);
    return { isWin, gateStatus, kelly, totalTrades: this.memory.tradeHistory.length };
  }

  // ── Rolling statistics ───────────────────────────────────────────────────

  #updateStats(pnlUsdt, pnlPct, symbol, isWin) {
    const m = this.memory;
    if (!m.stats) m.stats = { wins:0, losses:0, totalPnl:0, winAmounts:[], lossAmounts:[], symbolStats:{} };

    m.stats.wins     = (m.stats.wins   || 0) + (isWin ? 1 : 0);
    m.stats.losses   = (m.stats.losses || 0) + (isWin ? 0 : 1);
    m.stats.totalPnl = parseFloat(((m.stats.totalPnl || 0) + pnlUsdt).toFixed(4));

    if (isWin) {
      m.stats.winAmounts  = [...(m.stats.winAmounts  || []), Math.abs(pnlPct)].slice(-50);
    } else {
      m.stats.lossAmounts = [...(m.stats.lossAmounts || []), Math.abs(pnlPct)].slice(-50);
    }

    if (symbol) {
      if (!m.stats.symbolStats[symbol]) m.stats.symbolStats[symbol] = { trades:0, wins:0, pnl:0 };
      m.stats.symbolStats[symbol].trades += 1;
      m.stats.symbolStats[symbol].wins   += isWin ? 1 : 0;
      m.stats.symbolStats[symbol].pnl     = parseFloat((m.stats.symbolStats[symbol].pnl + pnlUsdt).toFixed(4));
      m.stats.symbolStats[symbol].winRate = parseFloat((m.stats.symbolStats[symbol].wins / m.stats.symbolStats[symbol].trades).toFixed(4));
    }

    const total     = m.stats.wins + m.stats.losses;
    m.stats.winRate = total > 0 ? parseFloat((m.stats.wins / total).toFixed(4)) : 0;
    m.stats.avgWin  = m.stats.winAmounts.length  > 0
      ? parseFloat((m.stats.winAmounts.reduce((a,b)=>a+b,0)  / m.stats.winAmounts.length).toFixed(4))  : 0.04;
    m.stats.avgLoss = m.stats.lossAmounts.length > 0
      ? parseFloat((m.stats.lossAmounts.reduce((a,b)=>a+b,0) / m.stats.lossAmounts.length).toFixed(4)) : 0.02;

    this.memory = m;
  }

  // ── Agent accuracy ───────────────────────────────────────────────────────

  #updateAgentAccuracy(agentVotes, isWin) {
    if (!agentVotes || !Object.keys(agentVotes).length) return;
    if (!this.memory.agentAccuracy) this.memory.agentAccuracy = {};

    for (const [agent, vote] of Object.entries(agentVotes)) {
      const correct = (["BUY","LONG"].includes(vote) && isWin) || (["SELL","SHORT"].includes(vote) && !isWin);
      if (!this.memory.agentAccuracy[agent]) this.memory.agentAccuracy[agent] = { correct:0, total:0 };
      this.memory.agentAccuracy[agent].total   += 1;
      this.memory.agentAccuracy[agent].correct += correct ? 1 : 0;
      this.memory.agentAccuracy[agent].accuracy = parseFloat(
        (this.memory.agentAccuracy[agent].correct / this.memory.agentAccuracy[agent].total).toFixed(4)
      );
    }
    logger.info("Agent accuracy:", JSON.stringify(this.memory.agentAccuracy));
  }

  // ── YouTube channel credibility (outcome-only — never at ingest) ─────────

  #updateChannelCredibility(channelIds, isWin) {
    if (!channelIds || !channelIds.length) return;
    try {
      let creds = fs.existsSync(CREDIBILITY_PATH)
        ? JSON.parse(fs.readFileSync(CREDIBILITY_PATH, "utf-8")) : {};

      for (const chId of channelIds) {
        const current   = creds[chId]?.weight ?? 1.0;
        // Asymmetric update: reward correct calls more than penalising wrong ones
        // to prevent a single bad call from nuking a proven channel.
        const delta     = isWin ? 0.06 : -0.04;
        const newWeight = Math.min(2.0, Math.max(0.2, current + delta));
        creds[chId] = {
          weight:       newWeight,
          correct:      (creds[chId]?.correct || 0) + (isWin ? 1 : 0),
          total:        (creds[chId]?.total   || 0) + 1,
          accuracy:     parseFloat(((((creds[chId]?.correct || 0) + (isWin ? 1 : 0)) /
                          ((creds[chId]?.total || 0) + 1))).toFixed(4)),
          lastUpdated:  new Date().toISOString(),
          // RAU note: weight is only updated here, NEVER at video ingest time.
        };
      }
      fs.writeFileSync(CREDIBILITY_PATH, JSON.stringify(creds, null, 2));
      logger.info(`Channel credibility updated (outcome-based) for ${channelIds.length} channels | isWin=${isWin}`);
    } catch (err) {
      logger.error("Channel credibility update failed", { error: err.message });
    }
  }

  // ── Learning memory decay ─────────────────────────────────────────────────

  #decayLearningMemory() {
    if (!fs.existsSync(LEARNING_MEMORY_PATH)) return;
    try {
      const memory = JSON.parse(fs.readFileSync(LEARNING_MEMORY_PATH, 'utf8'));
      const now    = Date.now();
      const pruneMs = DECAY_PRUNE_DAYS * 86400000;
      const halfMs  = DECAY_HALF_DAYS  * 86400000;

      const updated = memory
        .filter(m => {
          const age = now - new Date(m.timestamp).getTime();
          return age < pruneMs; // remove entries older than 60 days
        })
        .map(m => {
          const age = now - new Date(m.timestamp).getTime();
          if (age > halfMs && m.confidence > 0.05) {
            // Halve confidence for entries between 30–60 days old
            return { ...m, confidence: parseFloat((m.confidence * 0.5).toFixed(4)), _decayed: true };
          }
          return m;
        });

      const pruned  = memory.length - updated.length;
      const decayed = updated.filter(m => m._decayed).length;
      if (pruned > 0 || decayed > 0) {
        fs.writeFileSync(LEARNING_MEMORY_PATH, JSON.stringify(updated, null, 2));
        logger.info(`Learning memory: pruned=${pruned} stale entries, decayed=${decayed} entries (30d halflife)`);
      }
    } catch (err) {
      logger.warn('Learning memory decay failed', { error: err.message });
    }
  }

  // ── Kelly recalculation ──────────────────────────────────────────────────

  #recalcKelly() {
    const s       = this.memory.stats || {};
    const winRate = s.winRate || 0.55;
    const avgWin  = s.avgWin  || 0.04;
    const avgLoss = s.avgLoss || 0.02;
    const b       = avgWin / avgLoss;
    const full    = Math.max(0, (winRate * b - (1 - winRate)) / b);
    const kelly   = parseFloat((full * 0.25).toFixed(4));

    if (!this.memory.stats) this.memory.stats = {};
    this.memory.stats.kelly          = kelly;
    this.memory.stats.fullKelly      = parseFloat(full.toFixed(4));
    this.memory.stats.recommendedPct = parseFloat((kelly * 100).toFixed(2));

    logger.info(`Kelly: full=${(full*100).toFixed(2)}% | recommended=${(kelly*100).toFixed(2)}%`);
    return kelly;
  }

  // ── Win rate gate ────────────────────────────────────────────────────────

  #checkGate() {
    const s       = this.memory.stats || {};
    const total   = (s.wins || 0) + (s.losses || 0);
    const winRate = s.winRate || 0;
    const gateMet = total >= MIN_TRADES_GATE && winRate >= WIN_RATE_GATE;

    const status = {
      gateMet, winRate, totalTrades: total,
      requiredRate: WIN_RATE_GATE,
      tradesNeeded: Math.max(0, MIN_TRADES_GATE - total),
      message: gateMet
        ? `WIN RATE GATE MET! ${(winRate*100).toFixed(1)}% over ${total} trades — ready for live funds!`
        : `Paper: ${(winRate*100).toFixed(1)}% win rate | ${total}/${MIN_TRADES_GATE} trades | Need ${(WIN_RATE_GATE*100).toFixed(0)}% to go live`,
    };

    if (gateMet) logger.info(status.message);
    else         logger.info(status.message);
    return status;
  }

  // ── Telegram ─────────────────────────────────────────────────────────────

  async #sendTelegram({ symbol, pnlUsdt, pnlPct, isWin, gateStatus, kelly }) {
    if (!TELEGRAM_ON || !TELEGRAM_TOKEN || TELEGRAM_TOKEN.includes("PASTE")) return;
    const msg =
`${isWin ? "✅" : "❌"} *Trade Closed* — ${symbol}
P&L: \`$${pnlUsdt.toFixed(2)}\` (${(pnlPct*100).toFixed(2)}%)

${gateStatus.gateMet ? "🚀" : "📊"} *Win Rate Gate*
Rate: \`${(gateStatus.winRate*100).toFixed(1)}%\` | Trades: \`${gateStatus.totalTrades}/${MIN_TRADES_GATE}\`
Kelly size: \`${(kelly*100).toFixed(2)}%\`
${gateStatus.message}`;

    try {
      await axios.post(
        `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`,
        { chat_id: TELEGRAM_CHAT, text: msg, parse_mode: "Markdown" },
        { timeout: 10000 }
      );
      logger.info("Telegram notification sent");
    } catch (err) {
      logger.warn("Telegram send failed", { error: err.message });
    }
  }

  // ── Persist ──────────────────────────────────────────────────────────────

  #saveMemory() {
    this.memory.lastUpdated = new Date().toISOString();
    fs.writeFileSync(MEMORY_PATH, JSON.stringify(this.memory, null, 2));
  }

  // ── Status for dashboard ─────────────────────────────────────────────────

  getStatus() {
    const s = this.memory.stats || {};
    const totalTrades = (s.wins || 0) + (s.losses || 0);
    const hitRatePct  = totalTrades > 0
      ? parseFloat(((s.wins || 0) / totalTrades * 100).toFixed(2))
      : 0;

    // RAU source quality summary from learning memory
    let rauSummary = { high: 0, normal: 0, low: 0, rejected: 0, totalEntries: 0 };
    try {
      if (fs.existsSync(LEARNING_MEMORY_PATH)) {
        const mem = JSON.parse(fs.readFileSync(LEARNING_MEMORY_PATH, 'utf8'));
        rauSummary.totalEntries = mem.length;
        for (const m of mem) {
          const tier = (m.rau?.tier || 'NORMAL').toUpperCase();
          if (tier === 'HIGH')   rauSummary.high++;
          else if (tier === 'LOW')    rauSummary.low++;
          else                        rauSummary.normal++;
        }
      }
    } catch (_) { /* ignore */ }

    // Per-source feed weights from data_sourcer skill
    const feedWeights = {
      ccxt_orderbook:    { weight: 0.30, description: 'Market Structure & OHLCV' },
      sosovalue_etf:     { weight: 0.20, description: 'Institutional ETF Flows' },
      onchain_sopr_mvrv: { weight: 0.15, description: 'On-Chain Cycle Valuation' },
      relative_strength: { weight: 0.15, description: 'Cross-Asset Momentum' },
      volatility_regime: { weight: 0.10, description: 'ATR / Volatility Regime' },
      youtube_sentiment: { weight: 0.10, description: 'RAU-Weighted YouTube Alpha' },
    };

    return {
      totalTrades,
      wins:            s.wins    || 0,
      losses:          s.losses  || 0,
      winRate:         s.winRate || 0,
      hitRatePct,                           // human-readable %
      totalPnl:        s.totalPnl || 0,
      avgWin:          s.avgWin   || 0.04,
      avgLoss:         s.avgLoss  || 0.02,
      profitFactor:    s.avgLoss > 0
        ? parseFloat(((s.avgWin || 0.04) / (s.avgLoss || 0.02)).toFixed(3))
        : null,
      kelly:           s.kelly    || 0,
      recommendedPct:  s.recommendedPct || 0,
      gateMet:         totalTrades >= MIN_TRADES_GATE && (s.winRate || 0) >= WIN_RATE_GATE,
      agentAccuracy:   this.memory.agentAccuracy || {},
      symbolStats:     s.symbolStats || {},
      rauLearningStats: rauSummary,         // RAU quality breakdown
      feedWeights,                          // weighted data sources
    };
  }
}
