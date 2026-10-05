'use strict';
const fs = require('fs');
const path = require('path');

function readPrivateEnv(file, options = {}) {
  if (!file || !fs.existsSync(file)) return {};
  const bytes = fs.readFileSync(file);
  const text = bytes[0] === 0xff && bytes[1] === 0xfe ? bytes.subarray(2).toString('utf16le') : bytes.toString('utf8').replace(/^\uFEFF/, '');
  const parsed = require('dotenv').parse(text);
  const routerKeys = text.match(/sk-or-v1-[A-Za-z0-9_-]{20,}/g) || [];
  if (options.extractLooseRouterKeys !== false && routerKeys.length) parsed.OPENROUTER_KEYS = [...new Set(routerKeys)].join(',');
  return parsed;
}

const API_PREFIXES = 'ALPACA APCA ANTHROPIC CLAUDE BIGDATA BINANCE BITGET BROWSERBASE BYBIT CEREBRAS CMC COINMARKETCAP COINGECKO CRYPTOCOM CRYPTO_COM DEEPSEEK EXA FAL FIRECRAWL FIREWORKS GEMINI GITHUB GLASSNODE GOOGLE GOOGLECLOUD GROK GROQ HERMES HF HUGGINGFACE INFURA KIMI KUCOIN LANGFUSE META5 MT5 MINIMAX MISTRAL NEWS NEWSAPI NEXO NOVITA NVIDIA OANDA OKX OLLAMA OPENAI OPENROUTER OPEN_ROUTER PERPLEXITY PPLX SOSOVALUE TELEGRAM TRADING212 TRADINGKIT TRADINGVIEW WAKA WAKATIME XAI YOUTUBE'.split(' ');
const API_NAME = new RegExp(`^(?:${API_PREFIXES.join('|')})_[A-Z0-9_]*(?:KEYS?|SECRET|TOKEN|PASSWORD|PASSPHRASE|URL|ENDPOINT|ACCOUNT_ID|CLIENT_ID|TENANT_ID|PROJECT_ID|ADDRESS|LOGIN)(?:_[A-Z0-9_]+)?$`);
function usableApiEntry(name, value) {
  return API_NAME.test(name) && !/HISTORICAL|ARCHIVE|DEPRECATED|PRIVATE_KEY|MNEMONIC|SEED/i.test(name)
    && typeof value === 'string' && value.trim() !== ''
    && !/placeholder|example|dummy|your[_ -]|change[_-]?me|disabled|\$\{|\.\.\./i.test(value);
}
function readMasterEnv(file = process.env.API_MASTER_PATH || 'F:/aitrader/.env.master') {
  return Object.fromEntries(Object.entries(readPrivateEnv(file, { extractLooseRouterKeys: false }))
    .filter(([name, value]) => usableApiEntry(name, value)));
}
function getApiValue(name, options = {}) {
  if (!API_NAME.test(name) || /HISTORICAL|PRIVATE_KEY|MNEMONIC|SEED/i.test(name)) return undefined;
  const root = options.projectRoot || path.resolve(__dirname, '../..');
  const sources = [process.env, readPrivateEnv(path.join(root, '.env'), { extractLooseRouterKeys: false }), readMasterEnv(options.masterPath)];
  for (const source of sources) if (Object.prototype.hasOwnProperty.call(source, name)) {
    return usableApiEntry(name, source[name]) ? source[name] : undefined;
  }
  return undefined;
}
function loadApiDefaults(options = {}) {
  const root = options.projectRoot || path.resolve(__dirname, '../..');
  const local = readPrivateEnv(path.join(root, '.env'), { extractLooseRouterKeys: false });
  const loaded = [];
  for (const [name, value] of Object.entries(readMasterEnv(options.masterPath))) {
    if (name.includes('__') || Object.prototype.hasOwnProperty.call(process.env, name)
      || Object.prototype.hasOwnProperty.call(local, name)) continue;
    process.env[name] = value;
    loaded.push(name);
  }
  return loaded;
}

function openRouterKeys() {
  const root = path.resolve(__dirname, '../..');
  const sources = [process.env, readPrivateEnv(path.join(root, '.env')),
    readPrivateEnv(process.env.DATA1_ENV_PATH || 'D:/Data1.env'),
    readPrivateEnv('C:/Users/barcl/profile.env'), readMasterEnv()];
  const keys = [];
  for (const source of sources) for (const [name, value] of Object.entries(source)) {
    if (!/^OPENROUTER_(?:API_KEY(?:_[A-Z0-9_]+)?|KEYS)$/.test(name) || /HISTORICAL|ARCHIVE|DEPRECATED/.test(name)) continue;
    for (const key of String(value || '').split(',').map(s => s.trim())) if (key.startsWith('sk-or-') && !keys.includes(key)) keys.push(key);
  }
  return keys;
}

module.exports = { readPrivateEnv, readMasterEnv, getApiValue, loadApiDefaults, openRouterKeys };
