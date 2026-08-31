/**
 * Strategy Learning Agent Adapter
 * Exposes the Strategy Learning Agent interface in src/agents/ for multi-agent consensus and orchestrator.
 */

'use strict';

const {
  getSignal,
  optimizeStrategy,
  backtestStrategy,
  generatePineScript,
  exportPineScriptToFile,
  loadLearnedStrategies,
  saveLearnedStrategy,
  STRATEGY_PRESETS,
} = require('../learning/strategyLearningAgent');

module.exports = {
  getSignal,
  optimizeStrategy,
  backtestStrategy,
  generatePineScript,
  exportPineScriptToFile,
  loadLearnedStrategies,
  saveLearnedStrategy,
  STRATEGY_PRESETS,
};
