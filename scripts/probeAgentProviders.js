/**
 * scripts/probeAgentProviders.js — one real call per provider endpoint the
 * degraded agents actually use, so we fix causes not symptoms.
 * Prints PASS/FAIL and HTTP status only. NEVER prints a key.
 * Run: node scripts/probeAgentProviders.js
 */
'use strict';
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const out = [];
const rec = (agent, target, ok, note) => out.push({ agent, target, ok, note });

async function post(url, headers, body, ms = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: ctrl.signal });
    const txt = await res.text();
    return { status: res.status, ok: res.ok, msg: txt.slice(0, 110) };
  } catch (e) {
    return { status: 0, ok: false, msg: e.name === 'AbortError' ? `TIMEOUT after ${ms}ms` : e.message.slice(0, 110) };
  } finally { clearTimeout(t); }
}

const oaiBody = (model) => ({ model, messages: [{ role: 'user', content: 'ok' }], max_tokens: 5 });

(async () => {
  // claude + gpt4o both route via CLAUDE_BASE_URL / OPENAI_BASE_URL
  const claudeBase = process.env.CLAUDE_BASE_URL;
  if (process.env.CLAUDE_API_KEY && claudeBase) {
    const r = await post(`${claudeBase.replace(/\/$/, '')}/chat/completions`,
      { Authorization: `Bearer ${process.env.CLAUDE_API_KEY}`, 'Content-Type': 'application/json' },
      oaiBody(process.env.CLAUDE_MODEL || 'claude-3-5-sonnet'));
    rec('claude', claudeBase, r.ok, `HTTP ${r.status} ${r.msg}`);
  } else rec('claude', 'CLAUDE_BASE_URL', false, 'not configured');

  const oaiBase = process.env.OPENAI_BASE_URL;
  if (process.env.OPENAI_API_KEY && oaiBase) {
    const r = await post(`${oaiBase.replace(/\/$/, '')}/chat/completions`,
      { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      oaiBody(process.env.OPENAI_MODEL || 'gpt-4o-mini'));
    rec('gpt4o', oaiBase, r.ok, `HTTP ${r.status} ${r.msg}`);
  } else rec('gpt4o', 'OPENAI_BASE_URL', false, 'not configured');

  // direct Anthropic, if that key is real
  if (process.env.ANTHROPIC_API_KEY) {
    const r = await post('https://api.anthropic.com/v1/messages',
      { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      { model: 'claude-3-5-haiku-20241022', max_tokens: 5, messages: [{ role: 'user', content: 'ok' }] });
    rec('claude (direct)', 'api.anthropic.com', r.ok, `HTTP ${r.status} ${r.msg}`);
  }

  // grok / xAI
  const xai = process.env.XAI_API_KEY || process.env.GROK_API_KEY;
  if (xai && !/^your_/i.test(xai)) {
    const r = await post('https://api.x.ai/v1/chat/completions',
      { Authorization: `Bearer ${xai}`, 'Content-Type': 'application/json' }, oaiBody('grok-2-latest'));
    rec('grok', 'api.x.ai', r.ok, `HTTP ${r.status} ${r.msg}`);
  } else rec('grok', 'api.x.ai', false, 'no usable XAI/GROK key in root .env');

  // deepseek
  if (process.env.DEEPSEEK_API_KEY) {
    const r = await post('https://api.deepseek.com/chat/completions',
      { Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`, 'Content-Type': 'application/json' }, oaiBody('deepseek-chat'));
    rec('deepseek', 'api.deepseek.com', r.ok, `HTTP ${r.status} ${r.msg}`);
  } else rec('deepseek', 'api.deepseek.com', false, 'DEEPSEEK_API_KEY EMPTY in root .env (a real one sits unused in config/.env)');

  // the fallback everything shares
  if (process.env.OPENROUTER_API_KEY) {
    const r = await post('https://openrouter.ai/api/v1/chat/completions',
      { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
      oaiBody(process.env.OPENROUTER_PAID_FALLBACK_MODEL || 'openai/gpt-4o-mini'));
    rec('OpenRouter (shared fallback)', 'openrouter.ai', r.ok, `HTTP ${r.status} ${r.msg}`);
  }

  // ollama / hermes
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 30000);
    const t0 = Date.now();
    const res = await fetch(`${process.env.OLLAMA_URL || 'http://127.0.0.1:11434'}/api/generate`, {
      method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: process.env.HERMES_MODEL || 'llama3.2', prompt: 'ok', stream: false, options: { num_predict: 5 } }),
    });
    clearTimeout(t);
    rec('hermes (ollama)', process.env.HERMES_MODEL || 'llama3.2', res.ok, `HTTP ${res.status} in ${Date.now() - t0}ms`);
  } catch (e) {
    rec('hermes (ollama)', process.env.HERMES_MODEL || 'llama3.2', false, e.name === 'AbortError' ? 'TIMEOUT after 30s (model reload under RAM pressure)' : e.message.slice(0, 90));
  }

  console.log('\n  AGENT PROVIDER PROBE — one real call each\n');
  for (const r of out) {
    console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.agent.padEnd(28)} ${r.target}`);
    console.log(`        ${r.note}`);
  }
  console.log('');
})();
