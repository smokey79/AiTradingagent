/**
 * Agent Health Monitor
 * ====================
 * Tracks per-agent liveness, response latency, error rates, and consecutive
 * failure counts across every consensus cycle.
 *
 * Each agent entry:
 *   { status, latencyMs, errorRate, consecutiveFails, lastSeen, totalCalls, totalErrors }
 *
 * Status levels:
 *   HEALTHY   — responding within SLA, error rate < 20%
 *   DEGRADED  — high latency or error rate 20–50%, still usable
 *   FAILING   — error rate > 50% or 3+ consecutive fails → triggers self-heal
 *   DEAD      — 5+ consecutive fails → excluded from consensus, critical alert
 *   RECOVERED — was FAILING/DEAD, now responding again
 */

'use strict';

const fs     = require('fs');
const path   = require('path');
const logger = require('../utils/logger');

const HEALTH_LOG_PATH = path.resolve(__dirname, '../../data/agent_health.json');
const ROLLING_WINDOW  = 20;   // rolling window for error rate calc
const SLA_LATENCY_MS  = 12000; // agent SLA response time

// Thresholds
const DEGRADE_ERROR_RATE    = 0.20;
const FAILING_ERROR_RATE    = 0.50;
const FAILING_CONSEC_FAILS  = 3;
const DEAD_CONSEC_FAILS     = 5;

// All known agents in the consensus pipeline
const KNOWN_AGENTS = [
  'deepseek', 'claude', 'gpt4o', 'gemini',
  'grok', 'openrouter_free', 'perplexity', 'hermes', 'sentiment',
];

class AgentHealthMonitor {
  constructor() {
    this.health = this.#load();
    this.#ensureAllAgents();
  }

  // ── Private: persistence ──────────────────────────────────────────────────

  #load() {
    try {
      if (fs.existsSync(HEALTH_LOG_PATH)) {
        return JSON.parse(fs.readFileSync(HEALTH_LOG_PATH, 'utf8'));
      }
    } catch (_) {}
    return {};
  }

  #save() {
    try {
      fs.writeFileSync(HEALTH_LOG_PATH, JSON.stringify(this.health, null, 2));
    } catch (e) {
      logger.warn(`[HealthMonitor] Failed to save health log: ${e.message}`);
    }
  }

  #ensureAllAgents() {
    for (const name of KNOWN_AGENTS) {
      if (!this.health[name]) {
        this.health[name] = this.#defaultEntry(name);
      }
    }
  }

  #defaultEntry(name) {
    return {
      agent:            name,
      status:           'UNKNOWN',
      latencyMs:        null,
      avgLatencyMs:     null,
      errorRate:        0,
      consecutiveFails: 0,
      totalCalls:       0,
      totalErrors:      0,
      recentResults:    [], // ring buffer of last N 'ok'|'error'
      lastSeen:         null,
      lastError:        null,
      lastHealed:       null,
      healCount:        0,
    };
  }

  // ── Public: record a cycle result for one agent ──────────────────────────

  /**
   * Record the outcome of an agent's response in a consensus cycle.
   * Call this from consensus.js after each parallel agent call settles.
   *
   * @param {string} agentName  - e.g. 'deepseek'
   * @param {boolean} succeeded - true if agent returned a valid signal
   * @param {number}  latencyMs - round-trip time in ms
   * @param {string}  [error]   - error message if failed
   */
  record(agentName, succeeded, latencyMs = 0, error = null) {
    if (!this.health[agentName]) {
      this.health[agentName] = this.#defaultEntry(agentName);
    }
    const h = this.health[agentName];

    h.totalCalls++;
    if (!succeeded) h.totalErrors++;

    // Rolling window
    h.recentResults.push(succeeded ? 'ok' : 'error');
    if (h.recentResults.length > ROLLING_WINDOW) h.recentResults.shift();

    // Error rate over rolling window
    const errors = h.recentResults.filter(r => r === 'error').length;
    h.errorRate = parseFloat((errors / h.recentResults.length).toFixed(4));

    // Latency tracking
    if (succeeded && latencyMs > 0) {
      h.latencyMs = latencyMs;
      const prevAvg = h.avgLatencyMs || latencyMs;
      h.avgLatencyMs = Math.round((prevAvg * 0.8) + (latencyMs * 0.2)); // EMA
    }

    // Consecutive failures
    if (!succeeded) {
      h.consecutiveFails = (h.consecutiveFails || 0) + 1;
      h.lastError = error || 'Unknown error';
    } else {
      h.consecutiveFails = 0;
      h.lastSeen = new Date().toISOString();
    }

    // Derive status
    const prevStatus = h.status;
    h.status = this.#deriveStatus(h);

    if (h.status !== prevStatus) {
      logger.warn(`[HealthMonitor] ${agentName}: ${prevStatus} → ${h.status} (errorRate=${(h.errorRate * 100).toFixed(0)}% consecutiveFails=${h.consecutiveFails})`);
    }

    this.#save();
    return h;
  }

  #deriveStatus(h) {
    if (h.consecutiveFails >= DEAD_CONSEC_FAILS)            return 'DEAD';
    if (h.consecutiveFails >= FAILING_CONSEC_FAILS)         return 'FAILING';
    if (h.errorRate >= FAILING_ERROR_RATE)                  return 'FAILING';
    if (h.errorRate >= DEGRADE_ERROR_RATE)                  return 'DEGRADED';
    if (h.latencyMs !== null && h.latencyMs > SLA_LATENCY_MS) return 'DEGRADED';
    if (h.recentResults.length > 0 && h.recentResults[h.recentResults.length - 1] === 'ok') {
      return h.status === 'FAILING' || h.status === 'DEAD' ? 'RECOVERED' : 'HEALTHY';
    }
    return 'UNKNOWN';
  }

  // ── Public: getters ────────────────────────────────────────────────────────

  /** Get health record for a single agent */
  getAgent(name) {
    return this.health[name] || this.#defaultEntry(name);
  }

  /** Get all agent health records */
  getAll() {
    return this.health;
  }

  /** Get overall system health summary */
  getSystemSummary() {
    const agents    = Object.values(this.health);
    const healthy   = agents.filter(a => a.status === 'HEALTHY' || a.status === 'RECOVERED').length;
    const degraded  = agents.filter(a => a.status === 'DEGRADED').length;
    const failing   = agents.filter(a => a.status === 'FAILING').length;
    const dead      = agents.filter(a => a.status === 'DEAD').length;
    const total     = agents.length;

    let overallStatus = 'HEALTHY';
    if (dead >= 2)               overallStatus = 'CRITICAL';
    else if (dead >= 1 || failing >= 2) overallStatus = 'DEGRADED';
    else if (failing >= 1 || degraded >= 3) overallStatus = 'WARNING';

    return {
      overallStatus,
      agents: { total, healthy, degraded, failing, dead },
      activeAgents:  healthy + degraded,
      consensusAble: (healthy + degraded) >= 7, // need at least 7 to run consensus
      details:       this.health,
      timestamp:     new Date().toISOString(),
    };
  }

  /** Mark an agent as healed (reset consecutive fails) */
  markHealed(agentName) {
    if (!this.health[agentName]) return;
    const h = this.health[agentName];
    h.consecutiveFails = 0;
    h.lastHealed = new Date().toISOString();
    h.healCount  = (h.healCount || 0) + 1;
    h.status     = 'RECOVERED';
    this.#save();
    logger.info(`[HealthMonitor] ${agentName} marked RECOVERED after heal`);
  }

  /** Get agents that need healing (FAILING or DEAD) */
  getUnhealthyAgents() {
    return Object.entries(this.health)
      .filter(([, h]) => h.status === 'FAILING' || h.status === 'DEAD')
      .map(([name, h]) => ({ name, ...h }));
  }
}

// Singleton
const monitor = new AgentHealthMonitor();
module.exports = monitor;
