/**
 * scripts/repairAgentKeys.js — repairs the root .env so the degraded LLM
 * agents can actually reach a working provider. Backs up first. Reports by
 * VARIABLE NAME only and NEVER prints or logs a key value.
 *
 * Run:  node scripts/repairAgentKeys.js          (dry run — shows the plan)
 *       node scripts/repairAgentKeys.js --apply  (writes, after backing up)
 *
 * WHAT IT FIXES, and why (all measured by scripts/probeAgentProviders.js):
 *  - claude + gpt4o both pointed at api.cheaperinference.com, which returns
 *    401 "Invalid API key" — that proxy subscription is dead. Direct Anthropic
 *    returns 400 "credit balance is too low". OpenRouter returns 200 and has
 *    credit, so both agents are repointed there. OpenRouter is OpenAI-API
 *    compatible, so this needs no code change — only a base URL, key and model.
 *  - deepseek had DEEPSEEK_API_KEY EMPTY in the root .env while a real key sat
 *    unused in config/.env, which the running bot never loads (server.js:6
 *    loads only ../../.env).
 *  - openrouterFreeAgent.js rotates across OPENROUTER_API_KEY_1..3 to multiply
 *    the free daily quota, but those were empty in root while three real keys
 *    sat unused in config/.env. Moving them over multiplies the free tier.
 *  - grok's xAI key authenticates but /v1/models returns 403, so the account
 *    has no model access. Clearing it lets grokAgent fall straight through to
 *    its existing OpenRouter path instead of burning a 12s timeout first.
 *
 * Cheap models are chosen deliberately: these agents fire on every pair every
 * cycle. Set them higher yourself if you want, but check the spend first.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ROOT_ENV = path.join(ROOT, '.env');
const CFG_ENV = path.join(ROOT, 'config', '.env');
const APPLY = process.argv.includes('--apply');

const readEnv = (p) => {
  const map = new Map();
  if (!fs.existsSync(p)) return map;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=(.*)$/);
    if (m) map.set(m[1], m[2].split('#')[0].trim());
  }
  return map;
};

const rootMap = readEnv(ROOT_ENV);
const cfgMap = readEnv(CFG_ENV);
const usable = (v) => v && v.length > 8 && !/^your_|placeholder|CHANGEME|^sk-xxx/i.test(v);

const orKey = rootMap.get('OPENROUTER_API_KEY');
if (!usable(orKey)) {
  console.error('ABORT: no usable OPENROUTER_API_KEY in the root .env — that is the provider everything is being repointed to.');
  process.exit(1);
}

// desired = value to set. Marked source so we can report without printing.
const plan = [];
const set = (key, value, why, source) => plan.push({ key, value, why, source });

// 1. claude + gpt4o -> OpenRouter. GATED BEHIND --paid AND DELIBERATELY OFF.
//    Measured 2026-09-16: the orchestrator is running ~194 consensus
//    evaluations PER MINUTE (278,784/day) because of overlapping cycle loops.
//    Repointing two agents at paid models at that rate is ~557,000 paid calls
//    a day — it would drain a $10 balance in roughly two hours. Fix the loop
//    duplication FIRST, then reconsider. Until then these agents stay off
//    rather than either lying about which model voted or emptying the wallet.
if (process.argv.includes('--paid')) {
  set('CLAUDE_BASE_URL', 'https://openrouter.ai/api/v1', 'cheaperinference 401 / Anthropic out of credit', 'literal');
  set('CLAUDE_API_KEY', orKey, 'reuse the working OpenRouter key', 'OPENROUTER_API_KEY');
  set('CLAUDE_MODEL', 'anthropic/claude-3.5-haiku', 'cheapest Claude on OpenRouter', 'literal');
  set('OPENAI_BASE_URL', 'https://openrouter.ai/api/v1', 'cheaperinference 401', 'literal');
  set('OPENAI_API_KEY', orKey, 'reuse the working OpenRouter key', 'OPENROUTER_API_KEY');
  set('OPENAI_MODEL', 'openai/gpt-4o-mini', 'cheap and fast', 'literal');
}

// 2. deepseek — real key is stranded in config/.env
if (usable(cfgMap.get('DEEPSEEK_API_KEY')) && !usable(rootMap.get('DEEPSEEK_API_KEY'))) {
  set('DEEPSEEK_API_KEY', cfgMap.get('DEEPSEEK_API_KEY'), 'real key stranded in config/.env, which the bot never loads', 'config/.env');
}

// 3. OpenRouter key rotation — multiplies the free daily quota
for (const [dst, src] of [['OPENROUTER_API_KEY_1', 'OPENROUTER_API_KEY_2'],
                          ['OPENROUTER_API_KEY_2', 'OPENROUTER_API_KEY_3'],
                          ['OPENROUTER_API_KEY_3', 'OPENROUTER_API_KEY_4']]) {
  const v = cfgMap.get(src);
  if (usable(v) && !usable(rootMap.get(dst))) {
    set(dst, v, `extra OpenRouter key from config/.env (${src}) — more free daily quota`, 'config/.env');
  }
}

// 4. grok — key authenticates but has no model access (403 on /v1/models)
if (usable(rootMap.get('XAI_API_KEY'))) {
  set('XAI_API_KEY', '', 'xAI account returns 403 on /v1/models; clearing lets grokAgent use its OpenRouter path without a 12s stall', 'cleared');
}
if (usable(rootMap.get('GROK_API_KEY'))) {
  set('GROK_API_KEY', '', 'same xAI account', 'cleared');
}

// 5. give the local Ollama call real headroom (paired with the hermesAgent fix)
if (!rootMap.has('OLLAMA_TIMEOUT_MS')) {
  set('OLLAMA_TIMEOUT_MS', '12000', 'cold model load on a RAM-tight box needs more than 2.5s', 'literal');
}

console.log(`\n  AGENT KEY REPAIR — ${APPLY ? 'APPLYING' : 'DRY RUN (pass --apply to write)'}\n`);
for (const p of plan) {
  const shown = p.source === 'literal' ? p.value : (p.value === '' ? '<cleared>' : `<from ${p.source}, ${p.value.length} chars, not shown>`);
  console.log(`  ${p.key.padEnd(24)} = ${shown}`);
  console.log(`        ${p.why}`);
}

if (!APPLY) {
  console.log('\n  Nothing written. Re-run with --apply to commit these.\n');
  process.exit(0);
}

// Apply: rewrite matching lines in place, append any that are missing.
let txt = fs.readFileSync(ROOT_ENV, 'utf8');
const backup = path.join(ROOT, `.env.backup-${new Date().toISOString().replace(/[:.]/g, '-')}`);
fs.writeFileSync(backup, txt);

for (const p of plan) {
  const re = new RegExp(`^(\\s*${p.key}\\s*=).*$`, 'm');
  if (re.test(txt)) txt = txt.replace(re, `$1${p.value}`);
  else txt += `${txt.endsWith('\n') ? '' : '\n'}${p.key}=${p.value}\n`;
}
fs.writeFileSync(ROOT_ENV, txt);
console.log(`\n  Written. Backup saved to ${path.basename(backup)}`);
console.log('  Restart the bot for these to take effect.\n');
