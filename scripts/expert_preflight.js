'use strict';
// Read-only provider checks. Never prints private values or provider response bodies.
const { openRouterKeys, readPrivateEnv } = require('../src/utils/privateEnv');
const gateway = require('../src/utils/openrouterGateway');
(async () => {
  const keys = openRouterKeys();
  console.log(JSON.stringify({ data1Present: require('fs').existsSync(process.env.DATA1_ENV_PATH || 'D:/Data1.env'), openRouterKeysFound: keys.length,
    data1ProviderNames: Object.keys(readPrivateEnv('D:/Data1.env')).filter(n => /API|KEY/.test(n) && !/SECRET|PRIVATE|PASSWORD/.test(n)) }));
  const status = [];
  for (let i = 0; i < keys.length; i++) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/key', { headers: { Authorization: `Bearer ${keys[i]}` }, signal: AbortSignal.timeout(8000) });
      const data = res.ok ? (await res.json()).data : {};
      status.push({ keyIndex: i + 1, status: res.status, isFreeTier: data.is_free_tier ?? null, remainingKeyLimit: data.limit_remaining ?? null });
    } catch (_) { status.push({ keyIndex: i + 1, status: 'unreachable' }); }
  }
  console.log(JSON.stringify({ openRouter: status, eligibleModelCount: (await gateway.models()).length }));
})().catch(() => { console.error('Preflight unavailable; no private details logged.'); process.exitCode = 1; });
