/**
 * AiTradingAgent — Environment & System Configuration Validator
 * Validates environment variables, API key formatting, numeric thresholds,
 * and portfolio constraints before trading execution.
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

function validateConfig() {
  const issues = [];
  const warnings = [];
  const info = [];

  // 1. System Mode Checks
  const nodeEnv = process.env.NODE_ENV || 'development';
  const paper = process.env.PAPER_TRADING !== 'false';
  const port = parseInt(process.env.DASHBOARD_PORT || '3001', 10);
  if (isNaN(port) || port <= 0 || port > 65535) {
    issues.push(`Invalid DASHBOARD_PORT: "${process.env.DASHBOARD_PORT}". Must be between 1 and 65535.`);
  } else {
    info.push(`Dashboard Port: ${port}`);
  }
  info.push(`Mode: ${paper ? '📄 PAPER TRADING (Safe Simulation)' : '🔴 LIVE TRADING'}`);

  // 2. Trading Universe
  const rawPairs = process.env.TRADING_PAIRS || 'BTC/USDT,ETH/USDT,SOL/USDT,CRO/USDT,AVAX/USDT,ARB/USDT';
  const pairs = rawPairs.split(',').map(p => p.trim()).filter(Boolean);
  if (pairs.length === 0) {
    issues.push('TRADING_PAIRS cannot be empty.');
  } else {
    info.push(`Active Universe: ${pairs.join(', ')} (${pairs.length} pairs)`);
  }

  // 3. Deposit & Limits
  const deposit = parseFloat(process.env.INITIAL_DEPOSIT || '250');
  if (isNaN(deposit) || deposit <= 0) {
    issues.push(`INITIAL_DEPOSIT must be a positive number. Got: ${process.env.INITIAL_DEPOSIT}`);
  } else {
    info.push(`Initial Capital: $${deposit.toFixed(2)} USD`);
  }

  const minConfidence = parseFloat(process.env.MIN_CONFIDENCE || '0.72');
  if (isNaN(minConfidence) || minConfidence <= 0 || minConfidence > 1) {
    issues.push(`MIN_CONFIDENCE must be between 0.0 and 1.0. Got: ${process.env.MIN_CONFIDENCE}`);
  } else {
    info.push(`Consensus Confidence Gate: ${(minConfidence * 100).toFixed(0)}% minimum`);
  }

  const maxLeverage = parseFloat(process.env.LEVERAGE_MAX || '1.0');
  if (isNaN(maxLeverage) || maxLeverage < 1 || maxLeverage > 10) {
    warnings.push(`LEVERAGE_MAX is set to ${maxLeverage}x (Recommended: 1.0x spot).`);
  }

  // 4. Multi-Agent AI API Keys
  const agentKeys = {
    Anthropic: process.env.ANTHROPIC_API_KEY,
    OpenAI: process.env.OPENAI_API_KEY,
    OpenRouter: process.env.OPENROUTER_API_KEY,
    Gemini: process.env.GEMINI_API_KEY,
    Perplexity: process.env.PERPLEXITY_API_KEY,
  };

  const configuredAgents = [];
  const simulatedAgents = [];

  for (const [agent, key] of Object.entries(agentKeys)) {
    if (key && !key.startsWith('your_') && key.trim().length > 5) {
      configuredAgents.push(agent);
    } else {
      simulatedAgents.push(agent);
    }
  }

  if (configuredAgents.length > 0) {
    info.push(`Live LLM Keys Detected: ${configuredAgents.join(', ')}`);
  }
  if (simulatedAgents.length > 0) {
    info.push(`Simulated Fallback Agents: ${simulatedAgents.join(', ')} (Intelligent rule engines active)`);
  }

  const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
  const hermesModel = process.env.HERMES_MODEL || 'hermes3';
  info.push(`Hermes Local Validator: Ollama @ ${ollamaUrl} (Model: ${hermesModel}) | Cloud Fallback: ${process.env.OPENROUTER_HERMES_MODEL || 'nousresearch/hermes-3-llama-3.1-8b'}`);

  // 5. Profit Allocation Rules
  const reinvestPct = parseFloat(process.env.PROFIT_REINVEST_PCT || '0.40');
  const btcPct = parseFloat(process.env.PROFIT_BTC_PCT || '0.50');
  const longtermPct = parseFloat(process.env.PROFIT_LONGTERM_PCT || '0.10');
  const totalAllocation = reinvestPct + btcPct + longtermPct;

  if (Math.abs(totalAllocation - 1.0) > 0.001) {
    issues.push(
      `Profit allocation sum must equal 1.00 (100%). Currently: ${(totalAllocation * 100).toFixed(1)}% ` +
      `(Reinvest: ${reinvestPct}, BTC: ${btcPct}, Longterm: ${longtermPct})`
    );
  } else {
    info.push(
      `Profit Waterfall: ${(reinvestPct * 100).toFixed(0)}% Reinvest | ` +
      `${(btcPct * 100).toFixed(0)}% BTC Savings | ` +
      `${(longtermPct * 100).toFixed(0)}% Long-Term Vault`
    );
  }

  // 6. Risk Gate Hard Constraints
  const maxExposure = parseFloat(process.env.RISK_MAX_PORTFOLIO_EXPOSURE_PCT || '40');
  const maxSingle = parseFloat(process.env.RISK_MAX_SINGLE_POSITION_PCT || '10');
  const maxSessionLoss = parseFloat(process.env.RISK_MAX_SESSION_LOSS_PCT || '8');
  const minWinRate = parseFloat(process.env.RISK_MIN_WIN_RATE_GATE || '0.80');

  if (maxSingle > maxExposure) {
    warnings.push(`Max single position (${maxSingle}%) exceeds total portfolio exposure (${maxExposure}%).`);
  }

  info.push(
    `Risk Gates: Max Exposure ${maxExposure}% | Max Single ${maxSingle}% | ` +
    `Session Stop-Loss ${maxSessionLoss}% | Min Win Rate Gate ${(minWinRate * 100).toFixed(0)}%`
  );

  const isValid = issues.length === 0;

  return {
    valid: isValid,
    nodeEnv,
    paperTrading: paper,
    pairs,
    initialDeposit: deposit,
    minConfidence,
    configuredAgents,
    simulatedAgents,
    issues,
    warnings,
    info,
  };
}

function printValidationReport() {
  const result = validateConfig();
  console.log('\n══════════════════════════════════════════════════════════════════════');
  console.log('🔍 AITRADINGAGENT SYSTEM CONFIGURATION VALIDATION REPORT');
  console.log('══════════════════════════════════════════════════════════════════════\n');

  result.info.forEach(item => console.log(`  ℹ️  ${item}`));

  if (result.warnings.length > 0) {
    console.log('\n  ⚠️  WARNINGS:');
    result.warnings.forEach(w => console.log(`     • ${w}`));
  }

  if (result.issues.length > 0) {
    console.log('\n  ❌ CRITICAL CONFIGURATION ISSUES:');
    result.issues.forEach(err => console.log(`     • ${err}`));
    console.log('\n══════════════════════════════════════════════════════════════════════');
    console.log('🛑 VALIDATION FAILED — Fix .env configuration errors before live trading.');
    console.log('══════════════════════════════════════════════════════════════════════\n');
    return false;
  }

  console.log('\n══════════════════════════════════════════════════════════════════════');
  console.log('✅ VALIDATION PASSED — System is ready for autonomous execution.');
  console.log('══════════════════════════════════════════════════════════════════════\n');
  return true;
}

if (require.main === module) {
  const ok = printValidationReport();
  if (!ok) process.exit(1);
}

module.exports = { validateConfig, printValidationReport };
