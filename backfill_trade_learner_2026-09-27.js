'use strict';
// One-off backfill: feed every historical trade in trade_ledger.json into the
// loss/win learner. The incremental watermark (learning_agent_state.json)
// only ever looks at trades AFTER its last-saved point, so it never processed
// anything that closed before this script's first run — this fixes exactly
// that backlog, once, without changing the live incremental behavior.
//
// Safe to run once: after it finishes, runBatchReview() itself advances the
// watermark to "now", so the live trading-orchestrator's regular 12h review
// will not reprocess anything this script already handled.

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.resolve(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'learning_agent_state.json');
const BACKUP_FILE = path.join(DATA_DIR, `learning_agent_state.backup-${Date.now()}.json`);
const LOSS_FILE = path.join(DATA_DIR, 'lost_trades_memory.json');
const WIN_FILE = path.join(DATA_DIR, 'won_trades_memory.json');

function countRecords(file) {
  try {
    const arr = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(arr) ? arr.length : 0;
  } catch (e) {
    return 0;
  }
}

// 1. Back up the current watermark before touching it.
if (fs.existsSync(STATE_FILE)) {
  fs.copyFileSync(STATE_FILE, BACKUP_FILE);
  console.log(`Backed up current watermark to ${BACKUP_FILE}`);
}

const beforeLoss = countRecords(LOSS_FILE);
const beforeWin = countRecords(WIN_FILE);
console.log(`Before backfill: ${beforeLoss} loss records, ${beforeWin} win records in memory.`);

// 2. Rewind the watermark to before any trade in the ledger so the next
//    review pass treats every closed trade as unseen.
fs.writeFileSync(STATE_FILE, JSON.stringify({ lastReviewTimestamp: 0 }, null, 2), 'utf8');

// 3. Fresh require picks up the rewound watermark, then run the existing,
//    already-correct batch review logic (no code changes needed).
const { runBatchReview } = require('./src/agents/learningAgent');

runBatchReview().then(() => {
  const afterLoss = countRecords(LOSS_FILE);
  const afterWin = countRecords(WIN_FILE);
  console.log(`After backfill: ${afterLoss} loss records (+${afterLoss - beforeLoss}), ${afterWin} win records (+${afterWin - beforeWin}).`);
  console.log('Backfill complete. Watermark has been advanced to now by runBatchReview() itself.');
  process.exit(0);
}).catch(err => {
  console.error('Backfill failed:', err.message);
  process.exit(1);
});
