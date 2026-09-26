require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const axios = require('axios');
const TK_KEY = process.env.TRADINGKIT_API_KEY;
const URL = `https://mcp.trader.dev/mcp?key=${TK_KEY}`;

function parseSSE(raw) {
  if (typeof raw !== 'string') return raw;
  const m = /data: (.*)/.exec(raw);
  return m ? JSON.parse(m[1]) : raw;
}

(async () => {
  const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' };
  const init = await axios.post(URL, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } } }, { headers });
  const sessionId = init.headers['mcp-session-id'];
  console.log('session:', sessionId);
  headers['Mcp-Session-Id'] = sessionId;
  await axios.post(URL, { jsonrpc: '2.0', method: 'notifications/initialized', params: {} }, { headers });
  const r = await axios.post(URL, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'plan_backtest_window', arguments: { symbol: 'ETHUSDT', timeframe: '720', from: Date.now() - 86400000*400, to: Date.now() } } }, { headers });
  console.log(JSON.stringify(parseSSE(r.data), null, 2));
})().catch(e => console.log('ERR', e.response ? JSON.stringify(e.response.data) : e.message));
