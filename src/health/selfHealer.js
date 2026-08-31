/**
 * Self-Healer — Automated Recovery Actions
 * =========================================
 * Triggered by systemHealthCheck.js when an agent enters FAILING or DEAD state.
 * Each heal action is logged, rate-limited (no more than 3 heals per agent per hour),
 * and reported to Telegram + WebSocket dashboard.
 *
 * Heal strategies (in escalating order):
 *   1. SOFT_RESET    — clear agent's cached state, retry immediately
 *   2. KEY_ROTATION  — rotate to next available API key for that provider
 *   3. MODEL_FALLBACK — swap to cheaper/free model for that provider
 *   4. EXCLUDE       — remove agent from consensus pool, redistribute weight
 *   5. ALERT_ONLY    — for DEAD agents: alert + exclude, log for human review
 */

'use strict';

const fs     = require('fs');
const path   = require('path');
const axios  = require('axios');
const logger = require('../utils/logger');
const monitor = require('./agentHealthMonitor');

const HEAL_LOG_PATH   = path.resolve(__dirname, '../../data/heal_log.json');
const MAX_HEALS_HOUR  = 3;   // max heal attempts per agent per hour
const HEAL_COOLDOWN_MS = 5 * 60 * 1000; // 5 min between heals for same agent

// Model fallback chains — when primary model is unavailable, use next in list
const FALLBACK_CHAINS = {
  deepseek:       ['deepseek/deepseek-r1:free', 'deepseek/deepseek-chat:free', 'meta-llama/llama-3.3-70b-instruct:free'],
  claude:         ['claude-3-5-haiku-20241022', 'claude-3-haiku-20240307'],
  gpt4o:          ['gpt-4o-mini', 'gpt-3.5-turbo'],
  gemini:         ['gemini-1.5-flash', 'gemini-1.5-flash-8b'],
  openrouter_free:['meta-llama/llama-3.3-70b-instruct:free', 'qwen/qwen-2.5-72b-instruct:free'],
  grok:           ['grok-2-1212', 'grok-beta'],
  perplexity:     ['llama-3.1-sonar-small-128k-online', 'llama-3.1-sonar-large-128k-online'],
  hermes:         ['hermes3', 'llama3.2'],
  sentiment:      [], // local Ollama — no fallback key, just retry
};

// Runtime state — excluded agents redistributed weight in consensus
const excludedAgents = new Set();
let healLog = [];

function loadHealLog() {
  try {
    if (fs.existsSync(HEAL_LOG_PATH)) {
      healLog = JSON.parse(fs.readFileSync(HEAL_LOG_PATH, 'utf8'));
    }
  } catch (_) { healLog = []; }
}

function saveHealLog() {
  try {
    // Keep last 200 heal events
    if (healLog.length > 200) healLog = healLog.slice(-200);
    fs.writeFileSync(HEAL_LOG_PATH, JSON.stringify(healLog, null, 2));
  } catch (e) {
    logger.warn(`[SelfHealer] Failed to save heal log: ${e.message}`);
  }
}

function logHealEvent(agentName, action, success, detail = '') {
  const event = {
    timestamp:  new Date().toISOString(),
    agent:      agentName,
    action,
    success,
    detail,
  };
  healLog.push(event);
  saveHealLog();
  logger.info(`[SelfHealer] ${agentName} → ${action} | ${success ? '✅ OK' : '❌ FAILED'} | ${detail}`);
  return event;
}

function recentHealCount(agentName) {
  const hourAgo = Date.now() - 3600000;
  return healLog.filter(
    e => e.agent === agentName && new Date(e.timestamp).getTime() > hourAgo
  ).length;
}

function lastHealAge(agentName) {
  const events = healLog.filter(e => e.agent === agentName);
  if (!events.length) return Infinity;
  return Date.now() - new Date(events[events.length - 1].timestamp).getTime();
}

// ── Heal actions ─────────────────────────────────────────────────────────────

/**
 * Attempt soft reset — clear any in-memory cache the agent might hold.
 * For JS agents loaded via require(), we can bust the module cache.
 */
async function softReset(agentName) {
  try {
    const agentPath = path.resolve(__dirname, `../agents/${agentName}Agent.js`);
    if (require.cache[require.resolve(agentPath)]) {
      delete require.cache[require.resolve(agentPath)];
      logger.info(`[SelfHealer] Module cache cleared for ${agentName}`);
    }
    monitor.markHealed(agentName);
    return logHealEvent(agentName, 'SOFT_RESET', true, 'Module cache cleared and agent marked RECOVERED');
  } catch (e) {
    return logHealEvent(agentName, 'SOFT_RESET', false, e.message);
  }
}

/**
 * Rotate API key — try next key in sequence for providers that support multiple keys.
 */
async function rotateApiKey(agentName) {
  const keyMap = {
    openrouter_free: ['OPENROUTER_API_KEY', 'OPENROUTER_API_KEY_2', 'OPENROUTER_API_KEY_3'],
    deepseek:        ['DEEPSEEK_API_KEY'],
    claude:          ['ANTHROPIC_API_KEY'],
    gpt4o:           ['OPENAI_API_KEY'],
    gemini:          ['GEMINI_API_KEY'],
    grok:            ['GROK_API_KEY', 'XAI_API_KEY'],
    perplexity:      ['PERPLEXITY_API_KEY'],
  };

  const keys = keyMap[agentName];
  if (!keys || keys.length < 2) {
    return logHealEvent(agentName, 'KEY_ROTATION', false, 'No alternate keys configured');
  }

  // Find the next non-empty key and swap it into primary position
  const currentKey = process.env[keys[0]];
  for (let i = 1; i < keys.length; i++) {
    const alt = process.env[keys[i]];
    if (alt && alt !== currentKey && !alt.includes('your_')) {
      process.env[keys[0]] = alt;
      logger.info(`[SelfHealer] ${agentName}: rotated to alternate key slot ${i}`);
      monitor.markHealed(agentName);
      return logHealEvent(agentName, 'KEY_ROTATION', true, `Rotated to key slot ${i}`);
    }
  }
  return logHealEvent(agentName, 'KEY_ROTATION', false, 'No valid alternate keys available');
}

/**
 * Fallback model swap — downgrade to a cheaper/free model for the agent.
 */
async function swapToFallbackModel(agentName) {
  const chain = FALLBACK_CHAINS[agentName] || [];
  if (!chain.length) {
    return logHealEvent(agentName, 'MODEL_FALLBACK', false, 'No fallback chain defined');
  }

  // Set an env var that each agent checks as its override model
  const fallbackEnvKey = `${agentName.toUpperCase()}_FALLBACK_MODEL`;
  const currentFallback = process.env[fallbackEnvKey];
  const currentIdx = chain.indexOf(currentFallback);
  const nextModel = chain[currentIdx + 1] || chain[0];

  process.env[fallbackEnvKey] = nextModel;
  logger.info(`[SelfHealer] ${agentName}: model → ${nextModel}`);
  monitor.markHealed(agentName);
  return logHealEvent(agentName, 'MODEL_FALLBACK', true, `Switched to ${nextModel}`);
}

/**
 * Exclude agent from consensus — removes it from active pool.
 * Consensus engine checks excludedAgents set before calling each agent.
 */
function excludeAgent(agentName) {
  excludedAgents.add(agentName);
  return logHealEvent(agentName, 'EXCLUDE', true, 'Agent excluded from consensus pool');
}

/**
 * Re-include a previously excluded agent.
 */
function includeAgent(agentName) {
  excludedAgents.delete(agentName);
  monitor.markHealed(agentName);
  return logHealEvent(agentName, 'INCLUDE', true, 'Agent re-included in consensus pool');
}

/**
 * Send Telegram alert for critical heal event.
 */
async function sendTelegramAlert(agentName, status, action, detail) {
  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId || token.includes('PASTE')) return;

  const emoji = status === 'DEAD' ? '💀' : status === 'FAILING' ? '⚠️' : '🔧';
  const msg =
`${emoji} *Agent Health Alert*
Agent: \`${agentName}\`
Status: \`${status}\`
Action: \`${action}\`
${detail ? `Detail: ${detail}` : ''}
Time: \`${new Date().toLocaleTimeString('en-GB')}\``;

  try {
    await axios.post(
      `https://api.telegram.org/bot${token}/sendMessage`,
      { chat_id: chatId, text: msg, parse_mode: 'Markdown' },
      { timeout: 8000 }
    );
  } catch (e) {
    logger.warn(`[SelfHealer] Telegram alert failed: ${e.message}`);
  }
}

/**
 * Broadcast heal event to the WebSocket dashboard.
 */
function broadcastHealEvent(event) {
  if (global.broadcastDashboardEvent) {
    global.broadcastDashboardEvent({
      type:  'agent_heal_event',
      event,
    });
  }
}

// ── Master heal orchestrator ──────────────────────────────────────────────────

/**
 * Run the full heal sequence for a failing agent.
 * Escalates through: SOFT_RESET → KEY_ROTATION → MODEL_FALLBACK → EXCLUDE
 *
 * Rate-limited: max MAX_HEALS_HOUR per agent per hour.
 *
 * @param {string} agentName
 * @param {string} currentStatus - 'FAILING' | 'DEAD'
 */
async function healAgent(agentName, currentStatus) {
  // Rate limiting
  if (recentHealCount(agentName) >= MAX_HEALS_HOUR) {
    logger.warn(`[SelfHealer] ${agentName} rate-limited: ${MAX_HEALS_HOUR} heals this hour`);
    return null;
  }
  if (lastHealAge(agentName) < HEAL_COOLDOWN_MS) {
    logger.warn(`[SelfHealer] ${agentName} cooldown: last heal was < 5 min ago`);
    return null;
  }

  logger.info(`[SelfHealer] 🔧 Starting heal sequence for ${agentName} (status: ${currentStatus})`);

  let event = null;

  if (currentStatus === 'FAILING') {
    // Try soft reset first
    event = await softReset(agentName);
    if (!event.success) {
      // Try key rotation
      event = await rotateApiKey(agentName);
    }
    if (!event.success) {
      // Try model fallback
      event = await swapToFallbackModel(agentName);
    }
  }

  if (currentStatus === 'DEAD' || (event && !event.success)) {
    // Exclude from consensus and alert
    event = excludeAgent(agentName);
    await sendTelegramAlert(agentName, currentStatus, 'EXCLUDE', 'Agent excluded after exhausting heal options');
  }

  if (event) broadcastHealEvent({ ...event, agentStatus: currentStatus });

  return event;
}

// ── Public API ────────────────────────────────────────────────────────────────

loadHealLog();

module.exports = {
  healAgent,
  softReset,
  rotateApiKey,
  swapToFallbackModel,
  excludeAgent,
  includeAgent,
  isExcluded: (name) => excludedAgents.has(name),
  getExcludedAgents: () => [...excludedAgents],
  getHealLog: (limit = 50) => healLog.slice(-limit),
  sendTelegramAlert,
};
