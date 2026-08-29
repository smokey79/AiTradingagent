/**
 * MCP Risk Gate Server
 * ====================
 * Hard-veto safety layer for AiTradingAgent.
 * This server MUST be consulted before any trade is executed.
 *
 * Tools exposed:
 *   evaluate_trade_risk   - Score a proposed trade 0-10 risk
 *   check_portfolio_state - Validate current exposure vs limits
 *   log_trade_result      - Record trade outcome for win rate tracking
 *   get_win_rate          - Get rolling win rate stats
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: "../../.env" });

const LOG_FILE = path.resolve("../../data/trade_log.json");
const RISK_LIMITS = {
  max_portfolio_exposure_pct: 40,
  max_single_position_pct: 10,
  max_daily_drawdown_pct: 12,
  max_session_loss_pct: 8,
  min_consensus_confidence: 0.72,
  min_agents_agreeing: 3,
  max_risk_score: 7.5,
  min_win_rate_gate: 0.80,
  min_sample_size_for_gate: 20,
};

// ─── Server Setup ──────────────────────────────────────────────────────────────
const server = new McpServer({
  name: "risk-gate-server",
  version: "1.0.0",
});

// ─── Helper: Load trade log ───────────────────────────────────────────────────
function loadTradeLog() {
  try {
    if (!fs.existsSync(LOG_FILE)) return [];
    return JSON.parse(fs.readFileSync(LOG_FILE, "utf8"));
  } catch {
    return [];
  }
}

// ─── Helper: Save trade log ───────────────────────────────────────────────────
function saveTradeLog(log) {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 2));
}

// ─── TOOL: evaluate_trade_risk ────────────────────────────────────────────────
server.tool(
  "evaluate_trade_risk",
  "Evaluate risk score (0-10) for a proposed trade and return APPROVE or VETO decision",
  {
    symbol: z.string(),
    signal: z.enum(["BUY", "SELL", "HOLD"]),
    consensus_confidence: z.number().min(0).max(1),
    agents_agreeing: z.number().min(0).max(5),
    position_size_pct: z.number(),
    stop_loss_pct: z.number(),
    current_portfolio_exposure_pct: z.number(),
    session_drawdown_pct: z.number().default(0),
    veto_flags: z.array(z.string()).default([]),
  },
  async ({
    symbol, signal, consensus_confidence, agents_agreeing,
    position_size_pct, stop_loss_pct, current_portfolio_exposure_pct,
    session_drawdown_pct, veto_flags,
  }) => {
    const vetoes = [];
    let riskScore = 0;

    // Hard veto checks
    if (veto_flags.length > 0) {
      vetoes.push(`Hard veto flags raised: ${veto_flags.join(", ")}`);
    }
    if (consensus_confidence < RISK_LIMITS.min_consensus_confidence) {
      vetoes.push(`Confidence ${consensus_confidence} below minimum ${RISK_LIMITS.min_consensus_confidence}`);
    }
    if (agents_agreeing < RISK_LIMITS.min_agents_agreeing) {
      vetoes.push(`Only ${agents_agreeing} agents agree (minimum ${RISK_LIMITS.min_agents_agreeing})`);
    }
    if (position_size_pct > RISK_LIMITS.max_single_position_pct) {
      vetoes.push(`Position size ${position_size_pct}% exceeds max ${RISK_LIMITS.max_single_position_pct}%`);
    }
    if (current_portfolio_exposure_pct + position_size_pct > RISK_LIMITS.max_portfolio_exposure_pct) {
      vetoes.push(`Total exposure would exceed ${RISK_LIMITS.max_portfolio_exposure_pct}%`);
    }
    if (session_drawdown_pct >= RISK_LIMITS.max_session_loss_pct) {
      vetoes.push(`Session drawdown ${session_drawdown_pct}% at/above max ${RISK_LIMITS.max_session_loss_pct}%`);
    }
    if (signal === "HOLD") {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            decision: "HOLD",
            risk_score: 0,
            approved: false,
            reason: "Signal is HOLD — no trade execution needed",
            vetoes: [],
          }),
        }],
      };
    }

    // Risk scoring (additive)
    if (consensus_confidence < 0.80) riskScore += 1.5;
    if (agents_agreeing < 4) riskScore += 1;
    if (position_size_pct > 7) riskScore += 1.5;
    if (stop_loss_pct < 1.5) riskScore += 1.5;
    if (current_portfolio_exposure_pct > 25) riskScore += 1;
    if (session_drawdown_pct > 4) riskScore += 2;
    if (veto_flags.length > 0) riskScore += 5;

    riskScore = Math.min(10, parseFloat(riskScore.toFixed(2)));

    const approved = vetoes.length === 0 && riskScore <= RISK_LIMITS.max_risk_score;

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          symbol,
          signal,
          decision: approved ? "APPROVED" : "VETOED",
          approved,
          risk_score: riskScore,
          max_risk_threshold: RISK_LIMITS.max_risk_score,
          vetoes,
          risk_breakdown: {
            confidence_penalty: consensus_confidence < 0.80 ? 1.5 : 0,
            agent_agreement_penalty: agents_agreeing < 4 ? 1 : 0,
            position_size_penalty: position_size_pct > 7 ? 1.5 : 0,
            stop_loss_penalty: stop_loss_pct < 1.5 ? 1.5 : 0,
            exposure_penalty: current_portfolio_exposure_pct > 25 ? 1 : 0,
            drawdown_penalty: session_drawdown_pct > 4 ? 2 : 0,
            veto_flag_penalty: veto_flags.length > 0 ? 5 : 0,
          },
          evaluated_at: new Date().toISOString(),
        }),
      }],
    };
  }
);

// ─── TOOL: check_portfolio_state ─────────────────────────────────────────────
server.tool(
  "check_portfolio_state",
  "Check current portfolio exposure against risk limits and return status",
  {
    open_positions: z.array(z.object({
      symbol: z.string(),
      size_pct: z.number(),
      pnl_pct: z.number(),
      direction: z.enum(["long", "short"]),
    })),
    total_portfolio_value_usd: z.number(),
  },
  async ({ open_positions, total_portfolio_value_usd }) => {
    const totalExposure = open_positions.reduce((s, p) => s + p.size_pct, 0);
    const unrealisedPnl = open_positions.reduce((s, p) => s + p.pnl_pct * (p.size_pct / 100), 0);
    const highRiskPositions = open_positions.filter(p => p.pnl_pct < -3);

    const alerts = [];
    if (totalExposure > RISK_LIMITS.max_portfolio_exposure_pct) {
      alerts.push(`OVER EXPOSURE: ${totalExposure.toFixed(1)}% vs max ${RISK_LIMITS.max_portfolio_exposure_pct}%`);
    }
    if (unrealisedPnl < -RISK_LIMITS.max_session_loss_pct) {
      alerts.push(`SESSION LOSS LIMIT HIT: ${unrealisedPnl.toFixed(2)}%`);
    }
    highRiskPositions.forEach(p => {
      alerts.push(`POSITION AT RISK: ${p.symbol} down ${Math.abs(p.pnl_pct).toFixed(2)}%`);
    });

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          portfolio_value_usd: total_portfolio_value_usd,
          total_exposure_pct: parseFloat(totalExposure.toFixed(2)),
          exposure_limit_pct: RISK_LIMITS.max_portfolio_exposure_pct,
          exposure_headroom_pct: parseFloat((RISK_LIMITS.max_portfolio_exposure_pct - totalExposure).toFixed(2)),
          unrealised_pnl_pct: parseFloat(unrealisedPnl.toFixed(4)),
          open_position_count: open_positions.length,
          high_risk_positions: highRiskPositions.length,
          alerts,
          status: alerts.length === 0 ? "HEALTHY" : "ALERT",
          checked_at: new Date().toISOString(),
        }),
      }],
    };
  }
);

// ─── TOOL: log_trade_result ───────────────────────────────────────────────────
server.tool(
  "log_trade_result",
  "Record a completed trade result for win rate tracking and strategy validation",
  {
    symbol: z.string(),
    direction: z.enum(["BUY", "SELL"]),
    entry_price: z.number(),
    exit_price: z.number(),
    position_size_pct: z.number(),
    outcome: z.enum(["WIN", "LOSS", "BREAKEVEN"]),
    pnl_pct: z.number(),
    agents_confidence: z.number(),
    strategy_tag: z.string().default("default"),
  },
  async (trade) => {
    const log = loadTradeLog();
    const entry = {
      ...trade,
      trade_id: `T${Date.now()}`,
      logged_at: new Date().toISOString(),
    };
    log.push(entry);
    saveTradeLog(log);

    const recent = log.slice(-20);
    const wins = recent.filter(t => t.outcome === "WIN").length;
    const winRate = recent.length > 0 ? parseFloat((wins / recent.length).toFixed(3)) : 0;

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          logged: true,
          trade_id: entry.trade_id,
          total_trades_logged: log.length,
          rolling_win_rate_20: winRate,
          profitability_gate_status: winRate >= RISK_LIMITS.min_win_rate_gate ? "PASSING" : "FAILING",
          message: `Trade logged. Rolling win rate (last 20): ${(winRate * 100).toFixed(1)}%`,
        }),
      }],
    };
  }
);

// ─── TOOL: get_win_rate ───────────────────────────────────────────────────────
server.tool(
  "get_win_rate",
  "Get rolling win rate statistics for strategy validation",
  {
    last_n_trades: z.number().default(20),
    strategy_tag: z.string().optional(),
  },
  async ({ last_n_trades, strategy_tag }) => {
    const log = loadTradeLog();
    let filtered = strategy_tag
      ? log.filter(t => t.strategy_tag === strategy_tag)
      : log;
    const recent = filtered.slice(-last_n_trades);
    const wins = recent.filter(t => t.outcome === "WIN").length;
    const losses = recent.filter(t => t.outcome === "LOSS").length;
    const be = recent.filter(t => t.outcome === "BREAKEVEN").length;
    const winRate = recent.length > 0 ? parseFloat((wins / recent.length).toFixed(3)) : 0;
    const avgPnl = recent.length > 0
      ? parseFloat((recent.reduce((s, t) => s + t.pnl_pct, 0) / recent.length).toFixed(3))
      : 0;

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          strategy_tag: strategy_tag || "all",
          sample_size: recent.length,
          wins, losses, breakeven: be,
          win_rate: winRate,
          win_rate_pct: `${(winRate * 100).toFixed(1)}%`,
          average_pnl_pct: avgPnl,
          profitability_gate: winRate >= RISK_LIMITS.min_win_rate_gate ? "PASSING" : "FAILING",
          gate_threshold: `${(RISK_LIMITS.min_win_rate_gate * 100).toFixed(0)}%`,
          sufficient_sample: recent.length >= RISK_LIMITS.min_sample_size_for_gate,
          total_trades_ever: log.length,
          checked_at: new Date().toISOString(),
        }),
      }],
    };
  }
);

// ─── Start ────────────────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[MCP Risk Gate Server] Running on stdio transport");
