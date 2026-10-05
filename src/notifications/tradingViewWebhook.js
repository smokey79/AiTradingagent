/**
 * AiTradingAgent — TradingView Webhook Signal Receiver
 * =====================================================
 * Receives alert JSON POSTed by TradingView at /api/tradingview/webhook
 * (see server.js), validates a shared secret embedded IN the JSON body
 * (TradingView's FREE tier can only send a raw body — no custom headers —
 * so the secret must travel inside the JSON, not in a header), normalizes
 * the payload into the same shape the Telegram-channel signals use, and
 * persists it to data/tradingview_signals.json so the orchestrator can
 * inject it into consensus next cycle. Mirrors
 * src/notifications/telegramListener.js's file-store pattern.
 *
 * ── Alert message template (paste into TradingView's alert "Message" box) ──
 * {
 *   "secret": "PASTE_TRADINGVIEW_WEBHOOK_SECRET_HERE",
 *   "symbol": "BTC/USDT",
 *   "action": "{{strategy.order.action}}",
 *   "price": {{close}},
 *   "timeframe": "{{interval}}",
 *   "confidence": 0.75
 * }
 *
 * "symbol" MUST match one of your TRADING_PAIRS exactly (e.g. BTC/USDT,
 * EUR/USD, XAU/USD) — set it by hand per alert. TradingView's own
 * {{ticker}} (e.g. "BTCUSDT" or "OANDA:EURUSD") doesn't reliably map to
 * your internal pair naming, so this module only falls back to guessing
 * from {{ticker}} when "symbol" is missing — don't rely on that fallback.
 */
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const DATA_DIR = path.resolve(__dirname, '../../data');
const SIGNAL_FILE = path.join(DATA_DIR, 'tradingview_signals.json');

function getWebhookSecret() {
  return process.env.TRADINGVIEW_WEBHOOK_SECRET || '';
}

// Best-effort normalizer for common TradingView ticker shapes, used only
// when the alert didn't set an explicit "symbol" field.
function normalizeTicker(raw) {
  if (!raw) return null;
  let t = String(raw).toUpperCase().replace(/^[A-Z]+:/, ''); // strip EXCHANGE:
  const quotes = ['USDT', 'USDC', 'BUSD', 'USD'];
  for (const q of quotes) {
    if (t.endsWith(q) && t.length > q.length) {
      return `${t.slice(0, -q.length)}/${q}`;
    }
  }
  return t;
}

function normalizeAction(raw) {
  const a = String(raw || '').toUpperCase();
  if (['BUY', 'LONG', 'BULLISH'].includes(a)) return 'BUY';
  if (['SELL', 'SHORT', 'BEARISH'].includes(a)) return 'SELL';
  return 'HOLD';
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function persistSignal(signal) {
  ensureDataDir();
  let existing = [];
  try {
    if (fs.existsSync(SIGNAL_FILE)) {
      existing = JSON.parse(fs.readFileSync(SIGNAL_FILE, 'utf8'));
    }
  } catch (_) {}
  existing.unshift(signal);
  if (existing.length > 100) existing = existing.slice(0, 100);
  fs.writeFileSync(SIGNAL_FILE, JSON.stringify(existing, null, 2));
}

/**
 * Validates + normalizes a raw TradingView alert body.
 * Returns { ok: true, signal } or { ok: false, error }.
 */
function handleTradingViewAlert(body) {
  const configuredSecret = getWebhookSecret();
  if (!configuredSecret) {
    return { ok: false, error: 'TRADINGVIEW_WEBHOOK_SECRET not configured on server' };
  }
  if (!body || body.secret !== configuredSecret) {
    return { ok: false, error: 'Invalid or missing secret' };
  }

  const symbol = body.symbol ? String(body.symbol).toUpperCase() : normalizeTicker(body.ticker);
  if (!symbol) {
    return { ok: false, error: 'No symbol/ticker in alert payload' };
  }

  const signal = {
    action: normalizeAction(body.action || body.side || body.signal),
    symbol,
    price: body.price != null ? parseFloat(body.price) : null,
    confidence: body.confidence != null ? Math.max(0, Math.min(1, parseFloat(body.confidence))) : 0.72,
    strategy: body.strategy || body.indicator || 'tradingview_alert',
    timeframe: body.timeframe || null,
    raw: JSON.stringify(body).slice(0, 300),
    source: 'tradingview_webhook',
    timestamp: new Date().toISOString(),
  };

  persistSignal(signal);

  if (global.broadcastDashboardEvent) {
    try {
      global.broadcastDashboardEvent({ type: 'tradingview_signal', signal });
    } catch (_) {}
  }

  logger.info(`📺 [TradingView] ${signal.action} ${signal.symbol} @ ${signal.price ?? '?'} (${signal.strategy}, conf=${Math.round(signal.confidence * 100)}%)`);
  return { ok: true, signal };
}

// Expose latest signals so the orchestrator can pull them synchronously
// each cycle, same pattern as telegramListener.js's getLatestSignals().
function getLatestTradingViewSignals(limit = 20) {
  try {
    if (fs.existsSync(SIGNAL_FILE)) {
      return JSON.parse(fs.readFileSync(SIGNAL_FILE, 'utf8')).slice(0, limit);
    }
  } catch (_) {}
  return [];
}

module.exports = {
  handleTradingViewAlert,
  getLatestTradingViewSignals,
  normalizeTicker,
  normalizeAction,
};
