/**
 * Emergency Kill Switch
 * ======================
 * A real stop mechanism for the trading bot — the gap flagged in
 * claude/real-trading-readiness-report.md ("No kill switch found anywhere
 * in the codebase"). This does something a plain `pm2 stop` does NOT do:
 * it sets a persistent flag file that orchestrator/index.js checks at the
 * START of every cycle, so even if PM2 restarts the process, it will NOT
 * resume opening new trades until the switch is explicitly released.
 *
 * Scope: this halts new position-opening. It does NOT cancel live exchange
 * orders already placed, because — per the readiness report — no
 * exchange-side stop-loss/take-profit orders are placed at all today.
 * Already-open paper positions still resolve normally against real price
 * via riskGate.resolveAllOpenPositions() each cycle, they just won't have
 * new positions opened alongside them while the switch is engaged.
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.resolve(__dirname, '../../data');
const KILL_SWITCH_FILE = path.join(DATA_DIR, 'KILL_SWITCH_ENGAGED');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function engageKillSwitch(reason = 'Manual stop') {
  ensureDataDir();
  fs.writeFileSync(
    KILL_SWITCH_FILE,
    JSON.stringify({ engagedAt: new Date().toISOString(), reason }, null, 2)
  );
  return { engaged: true, reason };
}

function releaseKillSwitch() {
  if (fs.existsSync(KILL_SWITCH_FILE)) {
    fs.unlinkSync(KILL_SWITCH_FILE);
  }
  return { engaged: false };
}

function isKillSwitchEngaged() {
  if (!fs.existsSync(KILL_SWITCH_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(KILL_SWITCH_FILE, 'utf8'));
  } catch (e) {
    return { engagedAt: null, reason: 'Unknown (file unreadable)' };
  }
}

module.exports = {
  engageKillSwitch,
  releaseKillSwitch,
  isKillSwitchEngaged,
};
