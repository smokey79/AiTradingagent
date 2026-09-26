/**
 * AiTradingAgent — Telegram Signal Listener (MTProto)
 * =====================================================
 * Connects as YOUR Telegram account to passively read
 * trading indicator channels and feed signals into the
 * orchestrator consensus pipeline in real-time.
 *
 * Credentials (already in .env):
 *   TELEGRAM_API_ID=33055993
 *   TELEGRAM_API_HASH=cf771225a0a24187d87fb00ce4e3fed3
 *
 * Run once to generate session:
 *   node src/notifications/setupTelegram.js
 *
 * Then starts automatically with:
 *   npm run dev  OR  npm run telegram:listen
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const { TelegramClient } = require('telegram');
const { StringSession }  = require('telegram/sessions');
const { NewMessage }     = require('telegram/events');
const fs   = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const { ingestTelegramMessage, sendTelegramMessage } = require('./telegramNotifier');

const API_ID      = parseInt(process.env.TELEGRAM_API_ID  || '33055993');
const API_HASH    = process.env.TELEGRAM_API_HASH          || 'cf771225a0a24187d87fb00ce4e3fed3';
const SESSION_STR = process.env.TELEGRAM_SESSION           || '';

// ── Channels to monitor ──────────────────────────────────────────────────────
// Add any channel title fragments here — case-insensitive substring match
const WATCHED_CHANNELS = [
  'intelligent_trading_signals',
  'intelligent trading',
  'trading signals',
  'crypto signals',
  'lux algo',
  'warrior trading',
  'indicator',
  'alert',
];

// ── Signal parser ─────────────────────────────────────────────────────────────
// Extracts structured trade signals from raw Telegram text
function parseSignal(text) {
  const t = text.toUpperCase();

  // Detect direction
  const isBuy  = /\b(BUY|LONG|BULL|ENTRY|CALL|🟢|📈)\b/.test(t);
  const isSell = /\b(SELL|SHORT|BEAR|EXIT|PUT|🔴|📉)\b/.test(t);
  if (!isBuy && !isSell) return null;

  // Extract symbol  e.g. BTC/USDT  BTC-USDT  BTCUSDT  $BTC
  const symMatch = text.match(
    /\$?([A-Z]{2,10})[\/\-]?(USDT|USD|BTC|ETH|BUSD)?\b/i
  );
  const symbol = symMatch
    ? `${symMatch[1].toUpperCase()}/USDT`
    : null;

  // Extract price  e.g. @ 42000  entry: 42,000  price 42000.50
  const priceMatch = text.match(
    /(?:@|entry|price|at)[:\s]*\$?([\d,]+\.?\d*)/i
  );
  const price = priceMatch
    ? parseFloat(priceMatch[1].replace(/,/g, ''))
    : null;

  // Extract targets
  const tpMatch = text.match(
    /(?:tp|target|take.?profit)[:\s1-3]*\$?([\d,]+\.?\d*)/i
  );
  const slMatch = text.match(
    /(?:sl|stop.?loss|stop)[:\s]*\$?([\d,]+\.?\d*)/i
  );

  // Confidence from text e.g. "confidence 85%" or "85% confident"
  const confMatch = text.match(/(\d{2,3})\s*%/);
  const confidence = confMatch ? parseInt(confMatch[1]) / 100 : 0.75;

  return {
    action:     isBuy ? 'BUY' : 'SELL',
    symbol,
    price,
    takeProfit: tpMatch ? parseFloat(tpMatch[1].replace(/,/g, '')) : null,
    stopLoss:   slMatch ? parseFloat(slMatch[1].replace(/,/g, '')) : null,
    confidence,
    raw:        text,
    source:     'telegram_channel',
    timestamp:  new Date().toISOString(),
  };
}

// ── Signal file (orchestrator reads this each cycle) ─────────────────────────
const DATA_DIR   = path.resolve(__dirname, '../../data');
const SIGNAL_FILE = path.join(DATA_DIR, 'telegram_signals.json');

function persistSignal(signal) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    let existing = [];
    if (fs.existsSync(SIGNAL_FILE)) {
      existing = JSON.parse(fs.readFileSync(SIGNAL_FILE, 'utf8'));
    }
    existing.unshift(signal);
    if (existing.length > 100) existing = existing.slice(0, 100);
    fs.writeFileSync(SIGNAL_FILE, JSON.stringify(existing, null, 2));
  } catch (e) {
    logger.warn(`[TgListener] Could not persist signal: ${e.message}`);
  }
}

// Expose latest signal so orchestrator can pull it synchronously
function getLatestSignals(limit = 10) {
  try {
    if (fs.existsSync(SIGNAL_FILE)) {
      return JSON.parse(fs.readFileSync(SIGNAL_FILE, 'utf8')).slice(0, limit);
    }
  } catch (_) {}
  return [];
}

// ── Main listener ─────────────────────────────────────────────────────────────
async function startTelegramListener() {
  if (!API_ID || !API_HASH) {
    logger.warn('⚠️  Telegram Listener: API_ID or API_HASH missing — skipping');
    return;
  }

  if (!SESSION_STR) {
    logger.warn('⚠️  Telegram Listener: No SESSION string yet.');
    logger.info('   Run:  node src/notifications/setupTelegram.js');
    logger.info('   API_ID=33055993  API_HASH=cf771225a0a24187d87fb00ce4e3fed3  ← already set ✅');
    return;
  }

  const session = new StringSession(SESSION_STR);
  const client  = new TelegramClient(session, API_ID, API_HASH, {
    connectionRetries: 5,
    retryDelay: 3000,
  });

  try {
    logger.info('📡 Connecting to Telegram MTProto...');
    await client.connect();
    const me = await client.getMe();
    logger.info(`✅ Telegram Listener connected as @${me.username || me.firstName}`);

    // Send startup confirmation to bot channel
    await sendTelegramMessage(
      `📡 <b>Telegram Signal Listener ONLINE</b>\n` +
      `👤 Connected as: ${me.username || me.firstName}\n` +
      `📺 Watching: ${WATCHED_CHANNELS.slice(0,3).join(', ')}…\n` +
      `⏰ ${new Date().toLocaleString()}`
    ).catch(() => {});

  } catch (err) {
    logger.error(`❌ Telegram MTProto connect failed: ${err.message}`);
    logger.info('   Session may be expired — run setupTelegram.js again');
    return;
  }

  // ── Event handler ─────────────────────────────────────────────────────────
  client.addEventHandler(async (event) => {
    try {
      const message = event.message;
      if (!message) return;

      const chat     = await message.getChat();
      const chatTitle = (chat.title || chat.username || '').toLowerCase();
      const text      = message.message || '';
      if (!text) return;

      // Check if from a watched channel
      const isWatched = WATCHED_CHANNELS.some(w => chatTitle.includes(w.toLowerCase()));
      if (!isWatched) return;

      logger.info(`🚨 [TgListener] Signal from: ${chat.title || chat.username}`);
      logger.info(`   Text: ${text.substring(0, 120)}`);

      // Always ingest raw message
      ingestTelegramMessage(text, chat.title || chat.username || 'Telegram');

      // Try to parse structured signal
      const signal = parseSignal(text);
      if (signal) {
        logger.info(`   Parsed: ${signal.action} ${signal.symbol || '?'} conf=${Math.round(signal.confidence*100)}%`);
        persistSignal({ ...signal, channel: chat.title || chat.username });

        // Broadcast to dashboard WebSocket immediately
        if (global.broadcastDashboardEvent) {
          global.broadcastDashboardEvent({
            type:   'telegram_signal',
            signal: { ...signal, channel: chat.title || chat.username },
          });
        }

        // Forward structured signal to orchestrator for next consensus round
        const { recordSignalFromTelegram } = require('../orchestrator/signalBridge');
        if (typeof recordSignalFromTelegram === 'function') {
          recordSignalFromTelegram(signal);
        }
      }
    } catch (err) {
      logger.error(`[TgListener] Event handler error: ${err.message}`);
    }
  }, new NewMessage({}));

  logger.info('👂 Telegram Listener active — watching for signals...');
}

if (require.main === module) {
  startTelegramListener().catch(err => {
    logger.error(`Telegram Listener fatal: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { startTelegramListener, getLatestSignals, parseSignal };
