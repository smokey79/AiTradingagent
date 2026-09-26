/** Raw TradingKit calls that print the server's own error text (the feed module hides it). Key read from .env, never printed. */
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const axios = require('axios');
const S = require('./strategies');
const URL = process.env.TRADINGKIT_MCP_URL || `https://mcp.trader.dev/mcp?key=${process.env.TRADINGKIT_API_KEY}`;
let sid = null;
async function rpc(method, params, id) {
  const h = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
  if (sid) h['Mcp-Session-Id'] = sid;
  const r = await axios.post(URL, { jsonrpc: '2.0', id, method, params }, { headers: h, timeout: 120000, validateStatus: () => true });
  if (r.headers['mcp-session-id']) sid = r.headers['mcp-session-id'];
  const d = typeof r.data === 'string' ? (/data: (.*)/.exec(r.data) || [])[1] : null;
  return { status: r.status, body: d ? JSON.parse(d) : r.data };
}
const show = (label, r) => console.log(label, r.status, JSON.stringify(r.body?.result?.content?.map(c => c.text) || r.body).slice(0, 700));
(async () => {
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'aitradingagent-lab', version: '1' } }, 1);
  await rpc('notifications/initialized', {});
  show('whoami:', await rpc('tools/call', { name: 'whoami', arguments: {} }, 2));
  show('credits:', await rpc('tools/call', { name: 'get_credits', arguments: {} }, 3));
  show('quick_backtest:', await rpc('tools/call', { name: 'quick_backtest', arguments: {
    pineSource: S.EMA_VWAP('probe ETH 2h'), symbol: 'ETHUSDT', timeframe: '120',
    from: Date.UTC(2020, 2, 25), to: Date.now(), name: 'MTF_probe_raw', notes: 'multi_tf_lab probe' } }, 4));
  process.exit(0);
})().catch(e => { console.log('ERROR', e.message); process.exit(1); });
