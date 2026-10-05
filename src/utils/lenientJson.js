/**
 * lenientJson.js — 2026-09-29
 * Robust extraction of a small JSON object from free-model LLM replies.
 * Live logs showed Bull/Bear debate votes being lost to replies like:
 *   "We need to consider... {"signal":"HOLD",...}"      (prose before JSON)
 *   {"confidence": something, ...}                      (invalid literal)
 *   {"reason": "RSI is neutral and mom                  (cut off mid-string)
 * Strategy: strip <think> blocks and code fences, try every balanced {...}
 * block (last first), then light repairs, then a field-by-field regex
 * fallback. Throws if the REQUIRED key can't be recovered, so callers
 * never act on an invented value.
 */
'use strict';

function balancedBlocks(s) {
  const out = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '{') continue;
    let depth = 0, inStr = false, esc = false;
    for (let j = i; j < s.length; j++) {
      const c = s[j];
      if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) { out.push(s.slice(i, j + 1)); break; } }
    }
  }
  return out;
}

function repair(block) {
  return block
    .replace(/,\s*([}\]])/g, '$1')                       // trailing commas
    .replace(/:\s*(?!true|false|null)([A-Za-z_][\w ]*)\s*([,}])/g, ':null$2'); // bare words -> null
}

/**
 * parseLenient(text, requiredKey)
 *   requiredKey: 'signal' | 'veto' — the field the caller cannot do without.
 * Returns a plain object containing at least requiredKey, else throws.
 */
function parseLenient(text, requiredKey) {
  if (!text) throw new Error('empty response');
  const clean = String(text)
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/```(?:json)?/gi, '');

  const blocks = balancedBlocks(clean).reverse();
  for (const b of blocks) {
    for (const candidate of [b, repair(b)]) {
      try {
        const obj = JSON.parse(candidate);
        if (obj && Object.prototype.hasOwnProperty.call(obj, requiredKey) && obj[requiredKey] !== null) return obj;
      } catch (_) { /* try next */ }
    }
  }

  // Field-by-field fallback (handles truncated JSON)
  const obj = {};
  const sig = clean.match(/"signal"\s*:\s*"?(ENTER|HOLD|BUY|SELL)"?/i);
  if (sig) obj.signal = sig[1].toUpperCase();
  const veto = clean.match(/"veto"\s*:\s*"?(true|false)"?/i);
  if (veto) obj.veto = veto[1].toLowerCase() === 'true';
  const conf = clean.match(/"confidence"\s*:\s*"?([0-9]*\.?[0-9]+)/i);
  if (conf) obj.confidence = parseFloat(conf[1]);
  const reason = clean.match(/"reason"\s*:\s*"([^"]*)/i);
  if (reason) obj.reason = reason[1];
  if (Object.prototype.hasOwnProperty.call(obj, requiredKey)) return obj;

  throw new Error(`no usable "${requiredKey}" in reply: ${clean.trim().slice(0, 60)}`);
}

module.exports = { parseLenient };
