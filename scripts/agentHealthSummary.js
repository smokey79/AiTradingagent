/**
 * scripts/agentHealthSummary.js — which agents are actually answering, and
 * which are silently failing? Reads data/agent_health.json (written by the
 * running bot) and summarises per agent.
 *
 * Run: node scripts/agentHealthSummary.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const f = path.join(__dirname, '..', 'data', 'agent_health.json');
if (!fs.existsSync(f)) { console.log('agent_health.json not found'); process.exit(0); }

const h = JSON.parse(fs.readFileSync(f, 'utf8'));
console.log(`\nagent_health.json — last modified ${fs.statSync(f).mtime.toISOString().slice(0, 16).replace('T', ' ')}\n`);

const rows = [];
for (const [name, v] of Object.entries(h)) {
  if (!v || typeof v !== 'object') continue;
  rows.push({
    name,
    status: v.status || v.state || (v.excluded ? 'EXCLUDED' : ''),
    fails: v.consecutiveFailures ?? v.failures ?? v.failCount ?? '',
    lastOk: v.lastSuccessAt || v.lastSuccess || v.lastOk || '',
    lastErr: String(v.lastError || v.error || '').slice(0, 110),
  });
}

if (!rows.length) {
  console.log('  (unexpected shape — dumping top-level keys)');
  console.log('  ' + Object.keys(h).join(', '));
  process.exit(0);
}

rows.forEach((r) => {
  console.log(`  ${r.name.padEnd(18)} status=${String(r.status).padEnd(12)} fails=${String(r.fails).padStart(3)}`);
  if (r.lastOk) console.log(`      last success: ${String(r.lastOk).slice(0, 19)}`);
  if (r.lastErr) console.log(`      last error  : ${r.lastErr}`);
});

const broken = rows.filter((r) => r.lastErr || /fail|exclud|down|error/i.test(String(r.status)));
console.log(`\n  ${rows.length} agents tracked, ${broken.length} showing errors or exclusion.\n`);
