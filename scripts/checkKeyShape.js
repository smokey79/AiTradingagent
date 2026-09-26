/**
 * scripts/checkKeyShape.js — is a key a REAL Google API key or a placeholder?
 * Reports shape only. Never prints the value.
 *
 * A genuine Google API key (YouTube Data v3, Gemini, Maps...) is 39 chars and
 * begins "AIza". Anything else is either a different credential type or a
 * leftover placeholder.
 *
 * Run: node scripts/checkKeyShape.js
 */
'use strict';
const fs = require('fs');

const TARGETS = [
  ['F:\\aitradingagent\\config\\.env', 'YOUTUBE_API_KEY'],
  ['F:\\aitradingagent\\config\\.env', 'GOOGLE_API_KEY'],
  ['F:\\aitradingagent\\config\\.env', 'GOOGLE_GEMINI_API_KEY'],
  ['F:\\aitradingagent2\\.env', 'GEMINI_API_KEY'],
];

const PLACEHOLDER_RE = /(your|here|paste|xxx|placeholder|changeme|todo|insert|<|>)/i;

function readKey(file, key) {
  if (!fs.existsSync(file)) return null;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    if (line.slice(0, line.indexOf('=')).trim() !== key) continue;
    return line.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '');
  }
  return null;
}

console.log('\nKey shape check — values are never printed\n');
for (const [file, key] of TARGETS) {
  const v = readKey(file, key);
  const where = `${file.replace('F:\\\\', '')} :: ${key}`;
  if (v === null) { console.log(`  ${key.padEnd(24)} NOT PRESENT in ${file}`); continue; }
  if (!v.length) { console.log(`  ${key.padEnd(24)} EMPTY`); continue; }

  const looksPlaceholder = PLACEHOLDER_RE.test(v);
  const startsAIza = v.startsWith('AIza');
  const rightLength = v.length === 39;
  const verdict = looksPlaceholder
    ? 'PLACEHOLDER — not a real key'
    : (startsAIza && rightLength)
      ? 'looks like a REAL Google API key'
      : startsAIza
        ? `starts AIza but length ${v.length} (expected 39) — suspicious`
        : `not a Google API key shape (length ${v.length}, no AIza prefix)`;

  console.log(`  ${key.padEnd(24)} len=${String(v.length).padStart(3)}  AIza=${startsAIza ? 'yes' : 'no '}  placeholder-words=${looksPlaceholder ? 'YES' : 'no '}  -> ${verdict}`);
}
console.log('');
