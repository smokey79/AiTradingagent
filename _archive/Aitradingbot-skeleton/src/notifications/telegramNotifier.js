/**
 * Telegram Notifications & Data Feeds Module
 * Broadcasts trade executions, profit harvesting, and emergency margin alerts.
 * Supports ingesting alpha messages from Telegram channels into sentiment memory.
 */
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const DATA_DIR = path.resolve(__dirname, '../../data');
const TELEGRAM_INGEST_PATH = path.join(DATA_DIR, 'telegram_alpha.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function getTelegramConfig() {
  return {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    chatId: process.env.TELEGRAM_CHAT_ID || '',
    alertsEnabled: process.env.TELEGRAM_ALERTS_ENABLED !== 'false',
    ingestEnabled: process.env.TELEGRAM_DATA_INGEST_ENABLED !== 'false',
  };
}

async function sendTelegramMessage(text, options = {}) {
  const { botToken, chatId, alertsEnabled } = getTelegramConfig();

  if (!alertsEnabled) {
    logger.debug('Telegram alerts disabled in configuration.');
    return { success: false, reason: 'disabled' };
  }

  if (!botToken || !chatId || chatId.includes('your_telegram')) {
    logger.info(`[Telegram Notification Simulated] ${text.replace(/<[^>]*>?/gm, '')}`);
    return { success: true, simulated: true, message: text };
  }

  try {
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const response = await axios.post(url, {
      chat_id: chatId,
      text,
      parse_mode: options.parse_mode || 'HTML',
      disable_web_page_preview: options.disable_preview || false,
    }, { timeout: 8000 });

    logger.info(`Telegram message sent successfully to chat ${chatId}`);
    return { success: true, simulated: false, data: response.data };
  } catch (err) {
    logger.warn(`Telegram send failed: ${err.message}`);
    return { success: false, error: err.message };
  }
}

async function sendTradeAlert(trade) {
  const isWin = trade.outcome === 'WIN' || (trade.pnlUsd || 0) > 0;
  const emoji = trade.side === 'BUY' ? '🟢' : '🔴';
  const outcomeEmoji = isWin ? '🏆' : '⚠️';
  const mode = trade.paper ? '[PAPER]' : '[LIVE]';

  const message = `
<b>${emoji} ${mode} TRADE EXECUTED: ${trade.pair || trade.symbol}</b>
━━━━━━━━━━━━━━━━━━
<b>Side:</b> ${trade.side}
<b>Price:</b> $${Number(trade.price).toLocaleString()}
<b>Position Size:</b> $${Number(trade.positionSizeUsd || 0).toFixed(2)} (${trade.amount ? Number(trade.amount).toFixed(6) : '-'})
<b>Confidence:</b> ${((trade.confidence || 0.85) * 100).toFixed(0)}%
<b>PnL:</b> ${isWin ? '+' : ''}$${Number(trade.pnlUsd || 0).toFixed(2)} (${Number(trade.pnlPct || 0).toFixed(2)}%) ${outcomeEmoji}
<b>Reason:</b> <i>${trade.reason || 'Consensus consensus passed risk gate'}</i>
━━━━━━━━━━━━━━━━━━
⏰ ${new Date().toLocaleTimeString()}
`.trim();

  return sendTelegramMessage(message);
}

async function sendMarginAlert(balance, threshold = 30.0) {
  const message = `
🚨 <b>CRITICAL MARGIN SENTINEL ALERT</b> 🚨
━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ <b>Trading Margin Low:</b> $${Number(balance).toFixed(2)}
🛑 <b>Threshold:</b> $${Number(threshold).toFixed(2)}
🔒 <b>Action Taken:</b> New position openings HALTED immediately.
💡 <i>Please deposit funds or reduce exposure to resume automated execution.</i>
━━━━━━━━━━━━━━━━━━━━━━━━━━
⏰ ${new Date().toISOString()}
`.trim();

  logger.warn(`🚨 Margin Alert Triggered: Balance $${balance} < $${threshold}`);
  return sendTelegramMessage(message);
}

async function sendProfitHarvestAlert(profitUsd, btcAmount, vaultUsd) {
  const message = `
💰 <b>PROFIT WATERFALL HARVEST</b>
━━━━━━━━━━━━━━━━━━
<b>Total Profit Harvested:</b> +$${Number(profitUsd).toFixed(2)}
⚡ <b>40% Reinvested in Trading:</b> +$${(profitUsd * 0.4).toFixed(2)}
🟠 <b>50% Saved in Bitcoin:</b> +$${(profitUsd * 0.5).toFixed(2)} (${Number(btcAmount || 0).toFixed(8)} BTC)
🔐 <b>10% Long-Term Cold Vault:</b> +$${(profitUsd * 0.1).toFixed(2)}
━━━━━━━━━━━━━━━━━━
`.trim();

  return sendTelegramMessage(message);
}

function ingestTelegramMessage(text, sender = 'Telegram Channel') {
  ensureDataDir();
  let entries = [];
  try {
    if (fs.existsSync(TELEGRAM_INGEST_PATH)) {
      entries = JSON.parse(fs.readFileSync(TELEGRAM_INGEST_PATH, 'utf8'));
    }
  } catch (e) {}

  const entry = {
    id: `TG_${Date.now()}`,
    timestamp: new Date().toISOString(),
    sender,
    text,
    length: text.length,
  };

  entries.unshift(entry);
  if (entries.length > 200) entries = entries.slice(0, 200);
  fs.writeFileSync(TELEGRAM_INGEST_PATH, JSON.stringify(entries, null, 2));

  logger.info(`Ingested Telegram alpha message from ${sender} (${text.substring(0, 40)}...)`);
  return entry;
}

function getIngestedTelegramMessages(limit = 20) {
  ensureDataDir();
  try {
    if (fs.existsSync(TELEGRAM_INGEST_PATH)) {
      const data = JSON.parse(fs.readFileSync(TELEGRAM_INGEST_PATH, 'utf8'));
      return data.slice(0, limit);
    }
  } catch (e) {}
  return [];
}

module.exports = {
  sendTelegramMessage,
  sendTradeAlert,
  sendMarginAlert,
  sendProfitHarvestAlert,
  ingestTelegramMessage,
  getIngestedTelegramMessages,
  getTelegramConfig,
};
