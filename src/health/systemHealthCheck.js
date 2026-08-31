/**
 * System Health Check — Master Orchestrator
 * ==========================================
 * Runs on a configurable interval (default every 60s) and checks:
 *   1. Agent liveness (are all 9 agents responding?)
 *   2. Data feed connectivity (CCXT, CoinGecko, SoSoValue, Ollama)
 *   3. Exchange connectivity (Bitget API ping)
 *   4. Disk / memory pressure
 *   5. Win-rate gate status (is system performing above 72%?)
 *   6. Trade loop heartbeat (is autoTrader still cycling?)
 *
 * When a check fails it calls selfHealer.healAgent() automatically.
 * Results are persisted to data/system_health.json and exposed via /api/health.
 */

'use strict';

const fs     = require('fs');
const path   = require('path');
const axios  = require('axios');
const os     = require('os');
const logger = require('../utils/logger');
const monitor = require('./agentHealthMonitor');
const healer  = require('./selfHealer');

const HEALTH_STATE_PATH = path.resolve(__dirname, '../../data/system_health.json');
const TRADE_LEDGER_PATH = path.resolve(__dirname, '../../data/trade_ledger.json');

// Check intervals
const CHECK_INTERVAL_MS     = parseInt(process.env.HEALTH_CHECK_INTERVAL_MS || '60000', 10);
const HEARTBEAT_TIMEOUT_MS  = 5 * 60 * 1000; // 5 min without a cycle = unhealthy

let healthCheckInterval  = null;
let lastSystemHealth     = null;
let lastCycleTimestamp   = null; // updated externally by autoTrader

// ── Individual subsystem checks ──────────────────────────────────────────────

async function checkOllama() {
  const host = process.env.OLLAMA_HOST || 'http://localhost:11434';
  try {
    const { data } = await axios.get(`${host}/api/tags`, { timeout: 4000 });
    const models = data?.models?.map(m => m.name) || [];
    return { ok: true, detail: `${models.length} models available`, models };
  } catch (e) {
    return { ok: false, detail: e.message };
  }
}

async function checkExchangeApi() {
  const key = process.env.BITGET_API_KEY;
  if (!key || key.includes('your_')) {
    return { ok: false, detail: 'Bitget API key not configured' };
  }
  try {
    const { data } = await axios.get('https://api.bitget.com/api/v2/public/time', { timeout: 5000 });
    return { ok: true, detail: `Bitget API reachable. Server time: ${data?.data?.serverTime}` };
  } catch (e) {
    return { ok: false, detail: `Bitget ping failed: ${e.message}` };
  }
}

async function checkCoinGecko() {
  try {
    const { data } = await axios.get('https://api.coingecko.com/api/v3/ping', { timeout: 5000 });
    return { ok: data?.gecko_says === '(V3) To the Moon!', detail: 'CoinGecko reachable' };
  } catch (e) {
    return { ok: false, detail: `CoinGecko unreachable: ${e.message}` };
  }
}

async function checkCCXT() {
  try {
    // Quick check — can we import ccxt and see Bitget listed?
    const ccxt = require('ccxt');
    const hasBitget = 'bitget' in ccxt;
    return { ok: hasBitget, detail: hasBitget ? `ccxt OK (${Object.keys(ccxt).length} exchanges)` : 'Bitget missing from ccxt' };
  } catch (e) {
    return { ok: false, detail: `ccxt import failed: ${e.message}` };
  }
}

function checkDisk() {
  try {
    const dataDir  = path.resolve(__dirname, '../../data');
    const logPath  = path.resolve(__dirname, '../../data/aitradingagent.log');
    const logSize  = fs.existsSync(logPath) ? fs.statSync(logPath).size : 0;
    const logMb    = (logSize / 1024 / 1024).toFixed(1);
    const warnLog  = logSize > 50 * 1024 * 1024; // warn if log > 50 MB
    return {
      ok:      !warnLog,
      detail:  `Log file: ${logMb} MB${warnLog ? ' — consider rotating' : ''}`,
      logMb:   parseFloat(logMb),
    };
  } catch (e) {
    return { ok: true, detail: 'Disk check skipped' };
  }
}

function checkMemory() {
  const totalMb  = Math.round(os.totalmem() / 1024 / 1024);
  const freeMb   = Math.round(os.freemem()  / 1024 / 1024);
  const usedPct  = parseFloat(((1 - freeMb / totalMb) * 100).toFixed(1));
  const ok       = usedPct < 90;
  return {
    ok,
    detail:  `RAM: ${freeMb} MB free / ${totalMb} MB total (${usedPct}% used)`,
    usedPct,
    freeMb,
    totalMb,
  };
}

function checkWinRateGate() {
  try {
    if (!fs.existsSync(TRADE_LEDGER_PATH)) {
      return { ok: true, detail: 'No trades yet', hitRate: null, totalTrades: 0 };
    }
    const trades = JSON.parse(fs.readFileSync(TRADE_LEDGER_PATH, 'utf8'));
    const wins   = trades.filter(t => (t.pnlUsd || 0) > 0).length;
    const n      = trades.length;
    const rate   = n > 0 ? wins / n : 0;
    const gate72 = rate >= 0.72 || n < 20; // pass if < 20 trades (warming up)
    return {
      ok:          gate72,
      detail:      `${(rate * 100).toFixed(1)}% hit rate over ${n} trades`,
      hitRate:     parseFloat((rate * 100).toFixed(2)),
      totalTrades: n,
      gate72Met:   rate >= 0.72 && n >= 20,
    };
  } catch (e) {
    return { ok: true, detail: 'Could not read trade ledger' };
  }
}

function checkTradeLoopHeartbeat() {
  if (!lastCycleTimestamp) {
    return { ok: true, detail: 'Not started yet', staleSec: null };
  }
  const staleSec = Math.round((Date.now() - new Date(lastCycleTimestamp).getTime()) / 1000);
  const ok       = staleSec < HEARTBEAT_TIMEOUT_MS / 1000;
  return {
    ok,
    detail:   ok ? `Last cycle ${staleSec}s ago` : `⚠️ No cycle for ${staleSec}s — trade loop may be stuck`,
    staleSec,
    lastCycle: lastCycleTimestamp,
  };
}

// ── Master health check run ───────────────────────────────────────────────────

async function runHealthCheck() {
  logger.info('[HealthCheck] Running system health check...');

  const [ollamaCheck, exchangeCheck, coingeckoCheck, ccxtCheck] = await Promise.all([
    checkOllama(),
    checkExchangeApi(),
    checkCoinGecko(),
    checkCCXT(),
  ]);

  const diskCheck      = checkDisk();
  const memCheck       = checkMemory();
  const winRateCheck   = checkWinRateGate();
  const heartbeatCheck = checkTradeLoopHeartbeat();
  const agentSummary   = monitor.getSystemSummary();

  // ── Trigger self-heal for any FAILING/DEAD agents ─────────────────────────
  const unhealthy = monitor.getUnhealthyAgents();
  const healEvents = [];
  for (const agent of unhealthy) {
    const event = await healer.healAgent(agent.name, agent.status);
    if (event) healEvents.push(event);
  }

  // ── Compute overall system status ─────────────────────────────────────────
  const checks = {
    agents:     { ok: agentSummary.consensusAble, detail: `${agentSummary.agents.healthy} healthy, ${agentSummary.agents.failing} failing, ${agentSummary.agents.dead} dead` },
    ollama:     ollamaCheck,
    exchange:   exchangeCheck,
    coingecko:  coingeckoCheck,
    ccxt:       ccxtCheck,
    disk:       diskCheck,
    memory:     memCheck,
    win_rate:   winRateCheck,
    heartbeat:  heartbeatCheck,
  };

  const failedChecks  = Object.entries(checks).filter(([, v]) => !v.ok).map(([k]) => k);
  const criticalFails = ['agents', 'exchange', 'heartbeat'].filter(k => !checks[k].ok);

  let overallStatus = 'HEALTHY';
  if (criticalFails.length >= 2) overallStatus = 'CRITICAL';
  else if (criticalFails.length === 1 || failedChecks.length >= 3) overallStatus = 'DEGRADED';
  else if (failedChecks.length >= 1) overallStatus = 'WARNING';

  const result = {
    overallStatus,
    timestamp:    new Date().toISOString(),
    checks,
    agents:       agentSummary,
    failedChecks,
    criticalFails,
    healEvents:   healEvents.length > 0 ? healEvents : undefined,
    excludedAgents: healer.getExcludedAgents(),
    uptime:       Math.round(process.uptime()),
  };

  // Persist
  try {
    fs.writeFileSync(HEALTH_STATE_PATH, JSON.stringify(result, null, 2));
  } catch (_) {}

  lastSystemHealth = result;

  // Broadcast to dashboard
  if (global.broadcastDashboardEvent) {
    global.broadcastDashboardEvent({ type: 'health_check', health: result });
  }

  const statusEmoji = { HEALTHY: '✅', WARNING: '⚠️', DEGRADED: '🟠', CRITICAL: '🔴' }[overallStatus] || '❓';
  logger.info(
    `[HealthCheck] ${statusEmoji} ${overallStatus} | ` +
    `Agents: ${agentSummary.agents.healthy}/${agentSummary.agents.total} healthy | ` +
    `Failed checks: ${failedChecks.join(', ') || 'none'}`
  );

  return result;
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

function startHealthChecks(intervalMs = CHECK_INTERVAL_MS) {
  if (healthCheckInterval) return;
  logger.info(`[HealthCheck] 🩺 Starting health monitor (every ${intervalMs / 1000}s)`);

  // Run immediately, then on interval
  runHealthCheck().catch(e => logger.error(`[HealthCheck] Initial check error: ${e.message}`));

  healthCheckInterval = setInterval(() => {
    runHealthCheck().catch(e => logger.error(`[HealthCheck] Interval check error: ${e.message}`));
  }, intervalMs);
}

function stopHealthChecks() {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
    logger.info('[HealthCheck] 🛑 Health monitor stopped');
  }
}

/** Called by autoTrader.js each cycle to update the heartbeat */
function updateHeartbeat() {
  lastCycleTimestamp = new Date().toISOString();
}

function getLastHealth() {
  if (lastSystemHealth) return lastSystemHealth;
  // Try to load from disk if not in memory
  try {
    if (fs.existsSync(HEALTH_STATE_PATH)) {
      return JSON.parse(fs.readFileSync(HEALTH_STATE_PATH, 'utf8'));
    }
  } catch (_) {}
  return null;
}

module.exports = {
  runHealthCheck,
  startHealthChecks,
  stopHealthChecks,
  updateHeartbeat,
  getLastHealth,
};
