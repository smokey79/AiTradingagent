/**
 * scripts/fetch_trendo_history.js
 * Reads the recent message history from the @TrendoFxbot chat using YOUR existing Telegram
 * session (TELEGRAM_API_ID / TELEGRAM_API_HASH / TELEGRAM_SESSION in .env - never printed).
 * Saves it to data/trendo_history.json so the signal format can be parsed and backtested.
 *
 * Usage (from F:\aitradingagent):  node scripts/fetch_trendo_history.js [limit]
 * Read-only: sends nothing to the bot.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');

const BOT = process.env.TRENDO_BOT_USERNAME || 'TrendoFxbot';
const LIMIT = parseInt(process.argv[2] || '200', 10);
const OUT = path.resolve(__dirname, '../data/trendo_history.json');

(async () => {
  const id = parseInt(process.env.TELEGRAM_API_ID || '', 10);
  const hash = process.env.TELEGRAM_API_HASH || '';
  const sess = process.env.TELEGRAM_SESSION || '';
  if (!id || !hash || !sess) { console.log('Missing TELEGRAM_API_ID / TELEGRAM_API_HASH / TELEGRAM_SESSION in .env'); process.exit(1); }
  const client = new TelegramClient(new StringSession(sess), id, hash, { connectionRetries: 3 });
  client.setLogLevel('error');
  await client.connect();
  const msgs = await client.getMessages(BOT, { limit: LIMIT });
  const rows = msgs.filter(m => m.message).map(m => ({
    id: m.id, date: new Date(m.date * 1000).toISOString(), fromBot: !m.out, text: m.message,
  }));
  fs.writeFileSync(OUT, JSON.stringify(rows, null, 2));
  const fromBot = rows.filter(r => r.fromBot);
  console.log(`Saved ${rows.length} messages (${fromBot.length} from the bot) to data/trendo_history.json`);
  if (fromBot.length) {
    console.log(`Oldest: ${fromBot[fromBot.length - 1].date} | Newest: ${fromBot[0].date}`);
    console.log('--- 3 most recent bot messages (first 400 chars) ---');
    for (const r of fromBot.slice(0, 3)) console.log(`[${r.date}]\n${r.text.slice(0, 400)}\n`);
  }
  await client.disconnect();
  process.exit(0);
})().catch(e => { console.log('ERROR', e.message); process.exit(1); });
