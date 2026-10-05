'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readMasterEnv, getApiValue, loadApiDefaults } = require('../src/utils/privateEnv');
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'private-env-test-'));
const masterPath = path.join(folder, 'inventory.env');
const names = ['FIRECRAWL_API_KEY', 'OPENROUTER_API_KEY', 'BITGET_API_KEY', 'GEMINI_API_KEY', 'TRADING_MODE', 'NEXO_PRIVATE_KEY'];
const saved = Object.fromEntries(names.map(name => [name, process.env[name]]));
try {
  names.forEach(name => delete process.env[name]);
  fs.writeFileSync(masterPath, [
    'FIRECRAWL_API_KEY=synthetic-current-value-12345',
    'OPENROUTER_API_KEY=synthetic-router-value-12345',
    'OPENROUTER_API_KEY_2_HISTORICAL=synthetic-old-value-12345',
    'GEMINI_API_KEY=disabled_for_cost',
    'BITGET_API_KEY=synthetic-exchange-value-12345',
    'NEXO_PRIVATE_KEY=synthetic-private-value-12345',
    'TRADING_MODE=live',
  ].join('\n'));
  fs.writeFileSync(path.join(folder, '.env'), 'OPENROUTER_API_KEY=disabled_for_cost\nBITGET_API_KEY=\n');
  const master = readMasterEnv(masterPath);
  assert(!('OPENROUTER_API_KEY_2_HISTORICAL' in master));
  assert(!('GEMINI_API_KEY' in master));
  assert(!('NEXO_PRIVATE_KEY' in master));
  assert(!('TRADING_MODE' in master));
  const options = { masterPath, projectRoot: folder };
  assert.strictEqual(getApiValue('OPENROUTER_API_KEY', options), undefined);
  assert.strictEqual(getApiValue('FIRECRAWL_API_KEY', options), 'synthetic-current-value-12345');
  process.env.FIRECRAWL_API_KEY = 'synthetic-process-value-12345';
  assert.strictEqual(getApiValue('FIRECRAWL_API_KEY', options), 'synthetic-process-value-12345');
  delete process.env.FIRECRAWL_API_KEY;
  assert.deepStrictEqual(loadApiDefaults(options), ['FIRECRAWL_API_KEY']);
  assert.strictEqual(process.env.TRADING_MODE, undefined);
  assert.strictEqual(process.env.BITGET_API_KEY, undefined);
  console.log('Private API lookup: history, private material, settings precedence and trading-mode exclusion passed.');
} finally {
  for (const name of names) if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name];
  fs.rmSync(folder, { recursive: true, force: true });
}
