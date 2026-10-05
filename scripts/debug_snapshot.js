/**
 * Read-only debugging snapshot for AiTradingAgent.
 *
 * This intentionally avoids loading .env and never prints credential values.
 * It reads current state files, recent logs, and package metadata so a broken
 * local run has one quick first stop before deeper debugging.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const LOG_DIR = path.join(ROOT, 'logs');

const REQUIRED_STATE_FILES = [
  'agent_health.json',
  'system_health.json',
  'latest_agent_votes.json',
  'tradingkit_signals.json',
  'hermes_deep_analysis.json',
  'portfolio_state.json',
  'trade_ledger.json',
];

const WATCHED_ENV_KEYS = [
  'TRADING_MODE',
  'PAPER_TRADING',
  'PAPER_TRADE',
  'PAPER_TRADE_MODE',
  'LIVE_TRADING',
  'MARKET_DATA_EXCHANGE',
  'OLLAMA_MODEL',
  'HERMES_MODEL',
  'TRADINGKIT_ANALYST_INTERVAL_S',
  'DEBATE_INTERVAL_S',
  'LOG_LEVEL',
];

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    return fallback;
  }
}

function statInfo(filePath) {
  try {
    const s = fs.statSync(filePath);
    return { exists: true, mtime: s.mtime, size: s.size };
  } catch (err) {
    return { exists: false, mtime: null, size: 0 };
  }
}

function ageText(date) {
  if (!date) return 'missing';
  const ms = Date.now() - date.getTime();
  if (ms < 0) return 'future timestamp';
  const minutes = Math.round(ms / 60000);
  if (minutes < 90) return `${minutes}m old`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h old`;
  return `${Math.round(hours / 24)}d old`;
}

function run(command, args, timeoutMs = 3000) {
  try {
    const isWin = process.platform === 'win32';
    const actualCommand = isWin ? 'cmd.exe' : command;
    const actualArgs = isWin ? ['/d', '/s', '/c', [command, ...args].join(' ')] : args;
    return childProcess.execFileSync(actualCommand, actualArgs, {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: timeoutMs,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (err) {
    const msg = err.stderr || err.stdout || err.message;
    return `unavailable: ${String(msg).split(/\r?\n/)[0]}`;
  }
}

function section(title) {
  console.log(`\n== ${title} ==`);
}

function line(label, value) {
  console.log(`${String(label).padEnd(28)} ${value}`);
}

function summarizeHealth() {
  const healthPath = path.join(DATA_DIR, 'agent_health.json');
  const health = readJson(healthPath, {});
  const entries = Object.entries(health || {});
  if (!entries.length) {
    line('agent health', 'no entries');
    return;
  }

  const rows = entries.map(([name, v]) => {
    const status = v.status || v.state || (v.excluded ? 'EXCLUDED' : 'UNKNOWN');
    const fails = v.consecutiveFails ?? v.fails ?? v.totalErrors ?? 0;
    const err = v.lastError || v.lastErr || v.error || '';
    return { name, status, fails, err };
  });

  const bad = rows.filter((r) => r.err || /fail|dead|down|error|exclud/i.test(String(r.status)));
  line('agents tracked', rows.length);
  line('agents needing attention', bad.length);

  bad.slice(0, 8).forEach((r) => {
    const suffix = r.err ? ` - ${String(r.err).slice(0, 120)}` : '';
    console.log(`  ${r.name}: ${r.status}, fails=${r.fails}${suffix}`);
  });
}

function summarizeLatestDecision() {
  const files = [
    path.join(ROOT, 'latest_decision.json'),
    path.join(DATA_DIR, 'latest_decision.json'),
  ];
  const existing = files.find((f) => fs.existsSync(f));
  if (!existing) {
    line('latest decision', 'missing');
    return;
  }

  const data = readJson(existing, {});
  const signal = data.signal || data.action || data.decision || data.finalSignal || 'unknown';
  const pair = data.pair || data.symbol || data.asset || 'unknown';
  const confidence = data.confidence ?? data.consensusConfidence ?? data.score ?? 'unknown';
  const reason = data.reason || data.veto_reason || data.error || '';
  line('latest decision file', path.relative(ROOT, existing));
  line('latest decision', `${pair} ${signal} confidence=${confidence}`);
  if (reason) line('decision note', String(reason).slice(0, 160));
}

function summarizeStateFiles() {
  REQUIRED_STATE_FILES.forEach((name) => {
    const filePath = path.join(DATA_DIR, name);
    const info = statInfo(filePath);
    const size = info.exists ? `${info.size} bytes` : 'missing';
    line(name, `${ageText(info.mtime)} (${size})`);
  });
}

function summarizeLogs() {
  const candidates = [
    path.join(DATA_DIR, 'aitradingagent.log'),
    path.join(LOG_DIR, 'tests_sandbox_latest.txt'),
  ];

  candidates.forEach((filePath) => {
    const info = statInfo(filePath);
    if (!info.exists) {
      line(path.relative(ROOT, filePath), 'missing');
      return;
    }

    const lines = fs.readFileSync(filePath, 'utf8')
      .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
      .split(/\r?\n/)
      .filter(Boolean);
    const issues = lines.filter((l) => /fail|fatal|error|exception|traceback|rejected|refusing/i.test(l));
    line(path.relative(ROOT, filePath), `${ageText(info.mtime)}, ${issues.length} issue line(s)`);
    issues.slice(-5).forEach((l) => console.log(`  ${l.slice(0, 180)}`));
  });
}

function readEnvFileKeys() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return new Set();

  const keys = new Set();
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const raw of lines) {
    const lineText = raw.trim();
    if (!lineText || lineText.startsWith('#')) continue;
    const match = lineText.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (match) keys.add(match[1]);
  }
  return keys;
}

function summarizePackage() {
  const pkg = readJson(path.join(ROOT, 'package.json'), {});
  line('package', `${pkg.name || 'unknown'} ${pkg.version || ''}`.trim());
  line('node', process.version);
  line('npm', run('npm', ['--version']));
  line('pm2', run('pm2', ['--version'], 2000));
}

function summarizeEnvShape() {
  const envFileKeys = readEnvFileKeys();
  WATCHED_ENV_KEYS.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(process.env, key)) {
      const value = String(process.env[key] || '');
      const safeValue = /KEY|SECRET|TOKEN|PASSWORD|PASSPHRASE/i.test(key) ? '[set]' : value;
      const envFileNote = envFileKeys.has(key) ? ', also in .env' : '';
      line(key, `${safeValue || '(empty)'}${envFileNote}`);
    } else if (envFileKeys.has(key)) {
      line(key, '[set in .env, not loaded into current shell]');
    } else {
      line(key, '(not set in current shell)');
    }
  });
}

function summarizeGit() {
  const status = run('git', ['status', '--short'], 4000);
  if (status.startsWith('unavailable:')) {
    line('git status', status);
    return;
  }
  const lines = status ? status.split(/\r?\n/) : [];
  const modified = lines.filter((l) => /^ ?M/.test(l)).length;
  const added = lines.filter((l) => /^A/.test(l)).length;
  const deleted = lines.filter((l) => /^ ?D/.test(l)).length;
  const untracked = lines.filter((l) => /^\?\?/.test(l)).length;
  line('git changed files', lines.length);
  line('git breakdown', `M=${modified} A=${added} D=${deleted} untracked=${untracked}`);
}

function main() {
  console.log('AiTradingAgent debug snapshot');
  console.log(`root: ${ROOT}`);
  console.log(`time: ${new Date().toISOString()}`);
  console.log(`host: ${os.hostname()} ${os.platform()} ${os.release()}`);

  section('Runtime');
  summarizePackage();

  section('Environment Shape');
  summarizeEnvShape();

  section('State Files');
  summarizeStateFiles();
  summarizeLatestDecision();

  section('Agent Health');
  summarizeHealth();

  section('Recent Issues');
  summarizeLogs();

  section('Working Tree');
  summarizeGit();

  console.log('\nTip: run `npm test` for the sandboxed test suite. The full test log is written to logs/tests_sandbox_latest.txt.');
}

main();
