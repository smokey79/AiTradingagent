// show_claude_redirect_2026-10-03.js -- READ-ONLY. Where does the "Claude" agent really send its calls? Prints the model name and the base URL's host/path only (no credentials, no key).
'use strict';
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
let u = process.env.CLAUDE_BASE_URL || '';
try { const x = new URL(u); u = `${x.protocol}//${x.host}${x.pathname}`; } catch (_) { u = u ? '(set, not a URL)' : '(not set)'; }
console.log('CLAUDE_MODEL    =', process.env.CLAUDE_MODEL || '(not set)');
console.log('CLAUDE_BASE_URL =', u);
console.log('key name used   =', process.env.CLAUDE_API_KEY ? 'CLAUDE_API_KEY' : 'ANTHROPIC_API_KEY', '| key starts like Anthropic (sk-ant-):', /^sk-ant-/.test((process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY || '').trim()));
