/**
 * src/utils/ollamaQueue.js -- NEW 2026-09-27, extended 2026-10-03 (Ollama on demand).
 *
 * Root-cause fix for the Bull/Bear debate stage's local-Ollama calls all
 * timing out together on live hardware: this box has no dedicated GPU
 * (Radeon iGPU, per Alan's hardware notes), so local Ollama serves ONE
 * inference request at a time in practice. When a trading cycle produces
 * several BUY/SELL candidates at once, each one's Bear debate call
 * (hermesAgent.js's callHermesRaw) and any Bull-debate Ollama fallback
 * (openrouterFreeAgent.js's callFreeModelRaw) fire within the same
 * second -- Ollama queues them internally, so most never get a response
 * before even a generous client-side timeout elapses, and the debate
 * stage fails safe (vetoes) far more than it should.
 *
 * This is a tiny process-wide FIFO: every caller awaits its turn before
 * issuing its request, so at most one local-Ollama call is ever in
 * flight -- calls take longer to start under load, but they actually
 * complete instead of timing out. Never blocks more than the queue ahead
 * of it; a failed call still releases the queue for the next one.
 *
 * 2026-10-03 -- ON DEMAND: before a queued call runs, make sure the Ollama server is up. If it is not,
 * start `ollama serve` (hidden, detached) and wait for it. If THIS process started it, stop it again after
 * OLLAMA_IDLE_STOP_MIN minutes (default 10) without a call, which frees the RAM the loaded model uses.
 * A server that was already running (e.g. the Ollama tray app) is never stopped by this code.
 * Env: OLLAMA_HOST (default http://127.0.0.1:11434), OLLAMA_EXE (default "ollama"),
 *      OLLAMA_ON_DEMAND=false to switch this behaviour off.
 */
'use strict';

const { spawn, spawnSync } = require('child_process');

let queue = Promise.resolve();
let startedChild = null;
let idleTimer = null;

const host = () => (process.env.OLLAMA_HOST || 'http://127.0.0.1:11434').replace(/\/api\/.*$/, '').replace(/\/+$/, '');
const onDemand = () => String(process.env.OLLAMA_ON_DEMAND || 'true').toLowerCase() !== 'false';
const idleMs = () => Math.max(1, Number(process.env.OLLAMA_IDLE_STOP_MIN || 10)) * 60 * 1000;

async function isUp() {
  try {
    const res = await fetch(`${host()}/api/tags`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch (_) { return false; }
}

async function ensureOllama() {
  if (!onDemand()) return false;
  if (await isUp()) return true;
  try {
    startedChild = spawn(process.env.OLLAMA_EXE || 'ollama', ['serve'], { detached: true, stdio: 'ignore', windowsHide: true });
    startedChild.on('error', () => { startedChild = null; });
    startedChild.unref();
  } catch (_) { startedChild = null; return false; }
  for (let i = 0; i < 20; i++) {          // up to ~20 s for the server to come up
    await new Promise((r) => setTimeout(r, 1000));
    if (await isUp()) return true;
  }
  return false;
}

function armIdleStop() {
  if (!startedChild) return;               // never stop a server we did not start
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    try {
      if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(startedChild.pid), '/T', '/F'], { windowsHide: true });
      else startedChild.kill('SIGTERM');
    } catch (_) { /* best effort */ }
    startedChild = null;
  }, idleMs());
  if (idleTimer.unref) idleTimer.unref();
}

function enqueueOllama(fn) {
  const wrapped = async () => {
    try { await ensureOllama(); } catch (_) { /* the call itself will fail and callers already have fallbacks */ }
    try { return await fn(); } finally { armIdleStop(); }
  };
  const run = queue.then(wrapped, wrapped);
  queue = run.then(() => {}, () => {});
  return run;
}

module.exports = { enqueueOllama, ensureOllama, isUp };
