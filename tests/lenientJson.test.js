// tests/lenientJson.test.js — run: node tests\lenientJson.test.js
// Cases are the real failure shapes seen in trading-orchestrator-out.log on 2026-09-29.
const assert = require('assert');
const { parseLenient } = require('../src/utils/lenientJson');
let pass = 0;
function t(name, fn) { try { fn(); pass++; console.log('PASS', name); } catch (e) { console.log('FAIL', name, '-', e.message); process.exitCode = 1; } }

t('plain json', () => assert.deepStrictEqual(parseLenient('{"veto":false,"confidence":0.6,"reason":"ok"}', 'veto').veto, false));
t('prose before json', () => assert.strictEqual(parseLenient('We need to check RSI first. {"signal":"ENTER","confidence":0.8,"reason":"x"}', 'signal').signal, 'ENTER'));
t('think block', () => assert.strictEqual(parseLenient('<think>{"signal":"ENTER"}</think>{"signal":"HOLD","confidence":0.4}', 'signal').signal, 'HOLD'));
t('code fence', () => assert.strictEqual(parseLenient('```json\n{"veto": true, "confidence": 0.7}\n```', 'veto').veto, true));
t('bare word value', () => { const o = parseLenient('{"veto": false, "confidence": something, "reason": "weak"}', 'veto'); assert.strictEqual(o.veto, false); });
t('truncated string', () => { const o = parseLenient('{"signal": "HOLD", "confidence": 0.55, "reason": "RSI is neutral and mom', 'signal'); assert.strictEqual(o.signal, 'HOLD'); assert.strictEqual(o.confidence, 0.55); });
t('trailing comma', () => assert.strictEqual(parseLenient('{"veto": true, "confidence": 0.9,}', 'veto').veto, true));
t('no json at all throws', () => assert.throws(() => parseLenient('We need to think about this carefully.', 'signal')));
t('missing required key throws', () => assert.throws(() => parseLenient('{"confidence":0.9}', 'veto')));
console.log(`${pass} passed`);
