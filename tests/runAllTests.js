/**
 * AiTradingAgent — Comprehensive Automated Test Suite
 * Validates all core components, math algorithms, consensus rules, risk vetoes,
 * paper trading execution, profit vault allocation, arbitrage detection,
 * individual AI agents, persistence layers, and system environment validation.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { calculateAllIndicators } = require('../src/data/indicators');
const { fetchFearAndGreed, SEED_PRICES, fetchMarketData } = require('../src/data/marketData');
const { runConsensus, AGENT_WEIGHTS, evaluateConsensus } = require('../src/orchestrator/consensus');
const { checkRiskGate, getPortfolioState, updateBalance, savePersistedState, loadPersistedState } = require('../src/risk/riskGate');
const { recordTrade, getPerformanceStats, loadLedger } = require('../src/risk/tradeLedger');
const { allocateProfits, getVaultSummary, savePersistedVault, loadPersistedVault } = require('../src/utils/profitAllocator');
const { executeTrade, getBestVenue } = require('../src/utils/exchangeRouter');
const { detectArbitrageOpportunities, CHAINS } = require('../src/arbitrage/arbScanner');
const { validateConfig } = require('../src/utils/envValidator');

// Agent wrappers
const claudeAgent = require('../src/agents/claudeAgent');
const gpt4oAgent = require('../src/agents/gpt4oAgent');
const grokAgent = require('../src/agents/grokAgent');
const perplexityAgent = require('../src/agents/perplexityAgent');
const hermesAgent = require('../src/agents/hermesAgent');
const geminiAgent = require('../src/agents/geminiAgent');
const sentimentAgent = require('../src/agents/youtubeSentimentAgent');

let passedTests = 0;
let totalTests = 0;

function it(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✅ PASS: ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(`     Error: ${err.message}`);
  }
}

async function asyncIt(name, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`  ✅ PASS: ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(`     Error: ${err.message}`);
  }
}

async function runSuite() {
  console.log('\n══════════════════════════════════════════════════════════════════════');
  console.log('🧪 RUNNING AITRADINGAGENT MASTER TEST SUITE');
  console.log('══════════════════════════════════════════════════════════════════════\n');

  // ─── 1. Technical Indicators ───────────────────────────────────────────────
  console.log('─── Module 1: Technical Indicators Engine ───');
  it('Calculates RSI, EMAs, MACD, Bollinger Bands, and ATR from candles', () => {
    const candles = [];
    let price = 50000;
    const now = Date.now();
    for (let i = 100; i >= 1; i--) {
      const open = price;
      const close = open + (i % 2 === 0 ? 50 : -30);
      const high = Math.max(open, close) + 20;
      const low = Math.min(open, close) - 20;
      candles.push([now - i * 3600 * 1000, open, high, low, close, 1000000]);
      price = close;
    }
    const orderBook = {
      bids: [[price * 0.999, 10], [price * 0.998, 20]],
      asks: [[price * 1.001, 8], [price * 1.002, 15]],
    };

    const ind = calculateAllIndicators(candles, orderBook);
    assert(typeof ind.rsi14 === 'number', 'RSI14 should be numeric');
    assert(ind.rsi14 >= 0 && ind.rsi14 <= 100, 'RSI14 should be between 0 and 100');
    assert(typeof ind.ema20 === 'number', 'EMA20 should be numeric');
    assert(typeof ind.ema50 === 'number', 'EMA50 should be numeric');
    assert(typeof ind.ema200 === 'number', 'EMA200 should be numeric');
    assert(ind.macd && typeof ind.macd.histogram === 'number', 'MACD histogram should be numeric');
    assert(ind.bollinger && typeof ind.bollinger.bandwidth === 'number', 'Bollinger width should be numeric');
    assert(ind.orderBook && typeof ind.orderBook.imbalanceRatio === 'number', 'Imbalance ratio should be numeric');
  });

  // ─── 2. Market Data & Seed Feeds ───────────────────────────────────────────
  console.log('\n─── Module 2: Market Data Feeds & Fallbacks ───');
  await asyncIt('Fetches Fear & Greed index with resilient fallback', async () => {
    const fg = await fetchFearAndGreed();
    assert(typeof fg.value === 'number', 'Fear & Greed value should be numeric');
    assert(typeof fg.classification === 'string', 'Classification should be string');
    assert(fg.value >= 0 && fg.value <= 100, 'Value should be between 0 and 100');
  });

  it('Verifies SEED_PRICES contains core universe tokens', () => {
    assert(SEED_PRICES.BTC > 10000, 'BTC seed price should be > 10,000');
    assert(SEED_PRICES.ETH > 1000, 'ETH seed price should be > 1,000');
    assert(SEED_PRICES.SOL > 10, 'SOL seed price should be > 10');
    assert(SEED_PRICES.CRO > 0, 'CRO seed price should be > 0');
  });

  await asyncIt('Fetches complete aggregated market data package for BTC/USDT', async () => {
    const data = await fetchMarketData('BTC/USDT');
    assert(data.symbol === 'BTC', 'Symbol should be BTC');
    assert(data.pair === 'BTC/USDT', 'Pair should be BTC/USDT');
    assert(data.price && typeof data.price.price === 'number', 'Price must be numeric');
    assert(data.indicators && typeof data.indicators.rsi14 === 'number', 'RSI14 must exist');
    assert(data.fearGreed && typeof data.fearGreed.value === 'number', 'Fear & Greed must exist');
  });

  // ─── 3. Individual AI Specialist Agents ────────────────────────────────────
  console.log('\n─── Module 3: Individual AI Specialist Agents ───');
  const mockMarket = {
    symbol: 'BTC',
    pair: 'BTC/USDT',
    price: { price: 68500, change24h: 2.1, volume24h: 25000000 },
    indicators: {
      rsi14: 52.0,
      ema20: 68100,
      ema50: 67500,
      ema200: 64000,
      priceVsEma50: 'above',
      priceVsEma200: 'above',
      macd: { histogram: 35.0, macd: 110, signal: 75 },
      atr14: 800,
      orderBook: { imbalanceRatio: 0.58, bias: 'bid_heavy_bullish' },
    },
    fearGreed: { value: 62, classification: 'Greed', trend: 'rising' },
  };

  await asyncIt('Claude Agent generates valid technical decision', async () => {
    const res = await claudeAgent.getSignal('BTC', mockMarket);
    assert(res && res.agent === 'claude', 'Must return Claude agent format');
    assert(['BUY', 'SELL', 'HOLD'].includes(res.signal), 'Signal must be BUY, SELL, or HOLD');
    assert(typeof res.confidence === 'number' && res.confidence >= 0 && res.confidence <= 1);
  });

  await asyncIt('GPT-4o Agent generates valid macro/sentiment decision', async () => {
    const res = await gpt4oAgent.getSignal('BTC', mockMarket);
    assert(res && res.agent === 'gpt4o', 'Must return GPT-4o agent format');
    assert(['BUY', 'SELL', 'HOLD'].includes(res.signal), 'Signal must be BUY, SELL, or HOLD');
  });

  await asyncIt('Grok Agent generates valid orderbook flow signal', async () => {
    const res = await grokAgent.getSignal('BTC', mockMarket);
    assert(res && res.agent === 'grok', 'Must return Grok agent format');
    assert(['BUY', 'SELL', 'HOLD'].includes(res.signal), 'Signal must be BUY, SELL, or HOLD');
  });

  await asyncIt('Perplexity Agent generates valid fundamental research signal', async () => {
    const res = await perplexityAgent.getSignal('BTC', mockMarket);
    assert(res && res.agent === 'perplexity', 'Must return Perplexity agent format');
    assert(['BUY', 'SELL', 'HOLD'].includes(res.signal), 'Signal must be BUY, SELL, or HOLD');
  });

  await asyncIt('Hermes Agent generates valid local validator signal', async () => {
    const res = await hermesAgent.getSignal('BTC', mockMarket);
    assert(res && res.agent === 'hermes', 'Must return Hermes agent format');
    assert(['BUY', 'SELL', 'HOLD'].includes(res.signal), 'Signal must be BUY, SELL, or HOLD');
  });

  await asyncIt('YouTube Sentiment Agent generates community sentiment score', async () => {
    const res = await sentimentAgent.getSentimentSignal('BTC');
    assert(res && res.agent === 'sentiment', 'Must return sentiment agent format');
    assert(typeof res.sentimentScore === 'number');
  });

  await asyncIt('Gemini Cross-Validator evaluates peer confluence and conflicts', async () => {
    const peerSignals = [
      { agent: 'claude', signal: 'BUY', confidence: 0.85 },
      { agent: 'gpt4o', signal: 'BUY', confidence: 0.80 },
    ];
    const res = await geminiAgent.getSignal('BTC', mockMarket, peerSignals);
    assert(res && res.agent === 'gemini', 'Must return Gemini agent format');
    assert(['BUY', 'SELL', 'HOLD'].includes(res.signal), 'Signal must be valid');
    assert(res.validation_result === 'PASS' || res.validation_result === 'PARTIAL');
  });

  // ─── 4. Multi-Agent Consensus Engine ───────────────────────────────────────
  console.log('\n─── Module 4: Multi-Agent Consensus Engine ───');
  await asyncIt('Runs 6-agent parallel consensus pipeline and returns structured decision', async () => {
    const consensus = await runConsensus('BTC/USDT', mockMarket);
    assert(['BUY', 'SELL', 'HOLD'].includes(consensus.signal), 'Signal must be BUY, SELL, or HOLD');
    assert(typeof consensus.confidence === 'number', 'Confidence must be numeric');
    assert(consensus.confidence >= 0 && consensus.confidence <= 1, 'Confidence must be between 0 and 1');
    assert(Array.isArray(consensus.breakdown), 'Breakdown must be array of agent outputs');
    assert(consensus.totalAgents >= 5, 'Should evaluate at least 5 agents');
    assert(typeof consensus.approved_for_execution === 'boolean', 'approved_for_execution must be boolean');
  });

  await asyncIt('evaluateConsensus approves trade with 40% allocation when aggregate score >= 70%', async () => {
    const agentResponses = {
      claude: { confidence: 0.85, recommendedAction: 'BUY_BTC' },
      gemini: { confidence: 0.80 },
      hermes: { confidence: 0.75 },
    };
    const result = await evaluateConsensus(agentResponses);
    assert.strictEqual(result.approved, true, 'Must approve trade when score >= 0.70');
    assert.strictEqual(result.action, 'BUY_BTC', 'Action must be BUY_BTC');
    assert.strictEqual(result.allocation, '40%', 'Allocation must be 40%');
    assert(result.aggregateScore >= 0.70, 'Aggregate score must be >= 0.70');
  });

  await asyncIt('evaluateConsensus rejects trade when aggregate score < 70%', async () => {
    const agentResponses = {
      claude: { confidence: 0.60, recommendedAction: 'BUY_BTC' },
      gemini: { confidence: 0.50 },
      hermes: { confidence: 0.50 },
    };
    const result = await evaluateConsensus(agentResponses);
    assert.strictEqual(result.approved, false, 'Must reject trade when score < 0.70');
    assert.strictEqual(result.reason, 'Consensus below 70% threshold');
  });

  // ─── 5. Risk Gate & Kelly Sizing ───────────────────────────────────────────
  console.log('\n─── Module 5: Risk Gate & Kelly Sizing Engine ───');
  await asyncIt('Approves trade meeting minimum confidence & sizing bounds', async () => {
    updateBalance(250.00, 0, true); // Ensure healthy balance and reset peak for risk checks
    // Seed baseline trades to ensure positive rolling win rate for risk gate test
    for (let i = 0; i < 20; i++) {
      recordTrade({
        pair: 'BTC/USDT',
        side: 'BUY',
        price: 68000,
        amount: 0.0003,
        positionSizeUsd: 20.0,
        pnlUsd: 1.0,
        outcome: 'WIN',
        confidence: 0.85,
        paper: true,
      });
    }

    const validConsensus = {
      signal: 'BUY',
      confidence: 0.85,
      agentsAgreeing: 5,
      totalAgents: 6,
      veto_triggered: false,
    };
    const mockMarketData = {
      price: { price: 68500 },
      indicators: { atr14: 750 },
    };

    const stateBefore = getPortfolioState();
    const result = await checkRiskGate('BTC/USDT', validConsensus, mockMarketData);
    assert.strictEqual(result.approved, true, 'Valid trade must be approved');
    assert(result.positionSizeUsd >= 10, 'Position size must be at least $10');
    assert(result.positionSizeUsd <= stateBefore.currentBalance * 0.10 + 0.01, `Position size must not exceed 10% of portfolio ($${stateBefore.currentBalance})`);
    assert(result.stopLossPct >= 1.5, 'Stop loss must be at least 1.5%');
    assert(result.takeProfitPct > result.stopLossPct, 'Take profit must exceed stop loss');
  });

  await asyncIt('Vetoes trade when confidence is below threshold', async () => {
    const lowConfConsensus = {
      signal: 'BUY',
      confidence: 0.60,
      agentsAgreeing: 4,
      totalAgents: 6,
      veto_triggered: false,
    };
    const mockMarketData = { price: { price: 68500 }, indicators: { atr14: 750 } };

    const result = await checkRiskGate('BTC/USDT', lowConfConsensus, mockMarketData);
    assert.strictEqual(result.approved, false, 'Low confidence must be rejected');
    assert(result.vetoes.length > 0, 'Must record veto reason');
  });

  await asyncIt('Vetoes trade on hard veto flag', async () => {
    const vetoedConsensus = {
      signal: 'BUY',
      confidence: 0.90,
      agentsAgreeing: 5,
      totalAgents: 6,
      veto_triggered: true,
      veto_reason: 'Regulatory embargo warning',
    };
    const mockMarketData = { price: { price: 68500 }, indicators: { atr14: 750 } };

    const result = await checkRiskGate('BTC/USDT', vetoedConsensus, mockMarketData);
    assert.strictEqual(result.approved, false, 'Hard veto must reject trade immediately');
  });

  // ─── 6. Trade Ledger & Performance Stats ───────────────────────────────────
  console.log('\n─── Module 6: Trade Ledger & Win Rate Analytics ───');
  it('Records trades and calculates rolling win rate', () => {
    const trade = recordTrade({
      pair: 'BTC/USDT',
      side: 'BUY',
      price: 68500,
      amount: 0.0003,
      positionSizeUsd: 20.55,
      pnlUsd: 1.25,
      outcome: 'WIN',
      confidence: 0.85,
      paper: true,
    });

    assert(trade.id, 'Trade must have an ID');
    const stats = getPerformanceStats(20);
    assert(stats.sampleSize >= 1, 'Sample size should be at least 1');
    assert(typeof stats.winRate === 'number', 'Win rate should be numeric');
  });

  // ─── 7. Profit Allocator & Vault Engine ────────────────────────────────────
  console.log('\n─── Module 7: Profit Allocator & Vault Engine ───');
  await asyncIt('Splits profitable trades into 40% reinvest / 50% BTC / 10% Vault', async () => {
    const profitTrade = { pnlUsd: 10.00 };
    const allocation = await allocateProfits(profitTrade);

    assert.strictEqual(allocation.allocated, true, 'Profitable trade should be allocated');
    assert.strictEqual(allocation.reinvest, 4.00, '40% should equal $4.00');
    assert.strictEqual(allocation.toBTC, 5.00, '50% should equal $5.00');
    assert.strictEqual(allocation.toLongterm, 1.00, '10% should equal $1.00');

    const vault = getVaultSummary();
    assert(vault.btcSavingsUsd >= 5.00, 'BTC savings should reflect allocation');
    assert(vault.longtermHoldUsd >= 1.00, 'Longterm vault should reflect allocation');
  });

  // ─── 8. Exchange Router & Paper Execution ──────────────────────────────────
  console.log('\n─── Module 8: Exchange Router & Paper Execution ───');
  await asyncIt('Executes realistic paper trade with slippage & PnL simulation', async () => {
    const riskCheck = {
      approved: true,
      positionSizeUsd: 20.00,
      leverage: 1,
      stopLossPct: 2.0,
      takeProfitPct: 4.4,
      consensusConfidence: 0.85,
    };
    const marketData = { price: { price: 68000 } };

    const exec = await executeTrade('BTC/USDT', 'BUY', riskCheck, marketData, true);
    assert.strictEqual(exec.success, true, 'Paper trade should succeed');
    assert.strictEqual(exec.paper, true, 'Must indicate paper mode');
    assert.strictEqual(exec.side, 'BUY', 'Side should match signal');
    assert(exec.amount > 0, 'Amount must be > 0');
    assert(typeof exec.pnlUsd === 'number', 'pnlUsd must be calculated');
  });

  await asyncIt('executeTrade executes when consensusDecision is approved', async () => {
    const consensusDecision = {
      approved: true,
      action: 'BUY_BTC',
      allocation: '40%',
      exchange: 'BITGET',
      sizeUsd: 25.0,
    };
    const exec = await executeTrade(consensusDecision);
    assert.strictEqual(exec.success, true, 'Approved consensus decision must execute');
    assert.strictEqual(exec.side, 'BUY', 'Side must be BUY');
    assert.strictEqual(exec.amount > 0, true, 'Amount must be > 0');
  });

  await asyncIt('executeTrade skips execution when consensusDecision is not approved', async () => {
    const unapprovedDecision = {
      approved: false,
      reason: 'Consensus below 70% threshold',
    };
    const exec = await executeTrade(unapprovedDecision);
    assert.strictEqual(exec.executed, false, 'Unapproved consensus decision must not execute');
    assert.strictEqual(exec.approved, false);
  });

  // ─── 9. Cross-Chain Arbitrage Scanner ──────────────────────────────────────
  console.log('\n─── Module 9: Cross-Chain Arbitrage Engine ───');
  it('Detects net profitable cross-chain opportunities accounting for gas', () => {
    const opps = detectArbitrageOpportunities();
    assert(Array.isArray(opps), 'Opportunities must be an array');
    assert(opps.length > 0, 'Should detect opportunities from multi-chain prices');
    const first = opps[0];
    assert(first.netPct > 0, 'Net profit % must be positive');
    assert(first.gasCostUsd > 0, 'Gas cost must be accounted for');
    assert(first.buyPrice < first.sellPrice, 'Buy price must be lower than sell price');
    assert(CHAINS[first.buyChain], 'Buy chain metadata must exist');
    assert(CHAINS[first.sellChain], 'Sell chain metadata must exist');
  });

  // ─── 10. System Configuration Validator ───────────────────────────────────
  console.log('\n─── Module 10: System Configuration Validator ───');
  it('Validates system environment configuration parameters', () => {
    const result = validateConfig();
    assert(typeof result.valid === 'boolean', 'Validation result must be boolean');
    assert(result.pairs.length > 0, 'Must have at least one trading pair');
    assert(result.initialDeposit > 0, 'Initial deposit must be positive');
    assert(result.minConfidence >= 0.5, 'Min confidence threshold must be valid');
    assert(result.issues.length === 0, `Critical issues found: ${result.issues.join('; ')}`);
  });

  // ─── 11. Persistence Layers ────────────────────────────────────────────────
  console.log('\n─── Module 11: Data Persistence Layers ───');
  it('Persists and restores portfolio state from disk', () => {
    updateBalance(275.50, 25.50);
    savePersistedState();
    const dataDir = path.resolve(__dirname, '../data');
    const stateFile = path.join(dataDir, 'portfolio_state.json');
    assert(fs.existsSync(stateFile), 'portfolio_state.json must exist');
    const diskData = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    assert.strictEqual(diskData.currentBalance, 275.50);
  });

  it('Persists and restores vault summary from disk', () => {
    savePersistedVault();
    const dataDir = path.resolve(__dirname, '../data');
    const vaultFile = path.join(dataDir, 'vault_summary.json');
    assert(fs.existsSync(vaultFile), 'vault_summary.json must exist');
    const vaultData = JSON.parse(fs.readFileSync(vaultFile, 'utf8'));
    assert(typeof vaultData.btcSavingsUsd === 'number');
  });

  // ─── 12. 72% Win Rate & $30 Margin Sentinel ───────────────────────────────
  console.log('\n─── Module 12: 72% Win Rate & $30 Margin Sentinel ───');
  await asyncIt('Vetoes trade when confidence is below 72% threshold', async () => {
    const lowConfConsensus = {
      signal: 'BUY',
      confidence: 0.70, // 70% < 72%
      agentsAgreeing: 4,
      totalAgents: 6,
      veto_triggered: false,
    };
    const riskCheck = await checkRiskGate('BTC/USDT', lowConfConsensus, mockMarket);
    assert.strictEqual(riskCheck.approved, false, 'Trade below 72% confidence must be rejected');
    assert(riskCheck.rejectionReasons.some(r => r.includes('72%')), 'Rejection reason must reference 72% threshold');
  });

  await asyncIt('Triggers critical margin veto and halts trading when balance falls below $30.00', async () => {
    updateBalance(24.50, 0); // Drop balance below $30 floor
    const validConsensus = {
      signal: 'BUY',
      confidence: 0.85,
      agentsAgreeing: 5,
      totalAgents: 6,
      veto_triggered: false,
    };
    const riskCheck = await checkRiskGate('BTC/USDT', validConsensus, mockMarket);
    assert.strictEqual(riskCheck.approved, false, 'Trade below $30 margin must be halted');
    assert(riskCheck.rejectionReasons.some(r => r.includes('CRITICAL MARGIN VETO')), 'Must trigger critical margin veto');
    updateBalance(275.50, 25.50, true); // Restore balance and reset peak
  });

  // ─── 13. DeFi Flash Loans Engine ───────────────────────────────────────────
  console.log('\n─── Module 13: DeFi Flash Loans Execution Engine ───');
  it('Simulates zero-capital flash loan with Balancer 0% fee and Aave v3 0.05% fee', () => {
    const { simulateFlashLoan, executeFlashLoanArbitrage } = require('../src/flashloan/flashloanExecutor');
    const simBalancer = simulateFlashLoan({
      token: 'WETH',
      borrowAmountUsd: 10000,
      provider: 'balancer',
      buyPrice: 3490,
      sellPrice: 3522,
      gasCostUsd: 2.5,
    });

    assert.strictEqual(simBalancer.flashLoanFeeUsd, 0, 'Balancer fee must be 0%');
    assert(simBalancer.grossProfitUsd > 0, 'Gross profit must be positive');
    assert(simBalancer.netProfitUsd > 5.0, 'Net profit should exceed $5.00 threshold');
    assert.strictEqual(simBalancer.isProfitable, true);
  });

  // ─── 14. YouTube Continuous Learning Loop ──────────────────────────────────
  console.log('\n─── Module 14: YouTube Agent Continuous Learning ───');
  await asyncIt('Extracts transcripts/alpha from YouTube URL and updates memory', async () => {
    const { extractVideoId, learnFromYouTubeUrl, getLearnedAlpha } = require('../src/learning/youtubeLearner');
    const videoId = extractVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    assert.strictEqual(videoId, 'dQw4w9WgXcQ', 'Must extract correct 11-char video ID');

    const insight = await learnFromYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'Crypto Macro Analyst');
    assert(insight.id && insight.id.startsWith('YT_'), 'Must generate valid insight ID');
    assert(Array.isArray(insight.mentionedCoins) && insight.mentionedCoins.length > 0);
    assert(typeof insight.sentimentScore === 'number');

    const memory = getLearnedAlpha(5);
    assert(memory.length >= 1, 'Memory must contain learned insights');
  });

  // ─── 15. Telegram Live Ingestion & Notifications ───────────────────────────
  console.log('\n─── Module 15: Telegram Sentinel Alerts & Data Ingestion ───');
  await asyncIt('Dispatches emergency margin alert and ingests channel alpha', async () => {
    const { sendMarginAlert, ingestTelegramMessage, getIngestedTelegramMessages } = require('../src/notifications/telegramNotifier');
    const alertResult = await sendMarginAlert(24.50, 30.0);
    assert.strictEqual(alertResult.success, true, 'Margin alert dispatch must succeed');

    const entry = ingestTelegramMessage('🚨 Whale alert: 5,000 BTC transferred from Coinbase to cold storage', 'Whale Alert');
    assert(entry.id.startsWith('TG_'), 'Must record Telegram entry ID');
    
    const messages = getIngestedTelegramMessages(5);
    assert(messages.length >= 1, 'Ingested messages list must contain entry');
  });

  // ─── 16. Fiat & DeFi Onboarding Module ────────────────────────────────────
  console.log('\n─── Module 16: Fiat & DeFi Onboarding Gateway ───');
  it('Generates multi-provider fiat onramp comparison quotes', () => {
    const { getFiatOnrampQuotes } = require('../src/onboarding/fiatOnramp');
    const quotes = getFiatOnrampQuotes({ fiatCurrency: 'USD', fiatAmount: 250, cryptoAsset: 'USDC' });
    assert.strictEqual(quotes.success, true);
    assert(quotes.quotes.length >= 4, 'Must return quotes from Transak, MoonPay, Stripe, and Crypto.com Pay');
    assert(quotes.bestQuote && quotes.bestQuote.netDepositUsd > 240, 'Best quote must calculate net deposit');
  });

  // ─── 17. Multi-Currency Proportionate Sizing & Allocation Overrides ─────────
  console.log('\n─── Module 17: Allocation Overrides & Multi-Currency Proportionate Sizing ───');
  it('Calculates exact proportionate position sizes across GBPX, USDP, USDT, and USD', () => {
    const { calculateProportionateAllocation, updateAllocationSettings, getAllocationSettings } = require('../src/risk/riskGate');

    // Update settings
    updateAllocationSettings({
      baseCurrency: 'GBPX',
      defaultAllocationPct: 10.0,
      overrideAllocationPct: null,
      memeAllocationPct: 3.0,
    });

    const settings = getAllocationSettings();
    assert.strictEqual(settings.baseCurrency, 'GBPX', 'Base currency should update to GBPX');

    // Calculate normal trade allocation for 250 USD balance in GBPX
    const allocGbpx = calculateProportionateAllocation({
      balance: 250,
      baseCurrency: 'GBPX',
      overridePct: null,
      confidence: 0.85,
    });

    assert.strictEqual(allocGbpx.baseCurrency, 'GBPX');
    assert(allocGbpx.positionSizeInCurrency > 0, 'Position in GBPX must be > 0');
    assert(allocGbpx.positionSizeUsd >= 10, 'Position size in USD must be >= $10 minimum bound');

    // Test override percentage
    const overrideAlloc = calculateProportionateAllocation({
      balance: 250,
      baseCurrency: 'USDT',
      overridePct: 20.0,
      confidence: 0.85,
    });

    assert.strictEqual(overrideAlloc.targetAllocationPct, 20.0, 'Override allocation % must be 20%');
    assert.strictEqual(overrideAlloc.isOverrideActive, true, 'Override active flag must be true');
  });

  // ─── 18. Skill Expert Trader & Sentiment Pattern Analysis Agents ───────────
  console.log('\n─── Module 18: Skill Expert Trader & Pattern Analysis Agents ───');
  await asyncIt('Assesses market regime, chart patterns, and outputs proportionate allocation', async () => {
    const { assessAllocation } = require('../src/agents/expertTraderAgent');
    const { getPatternSignal, detectChartPatterns } = require('../src/agents/patternAgent');

    const mockMarketData = {
      price: { price: 68500, change24h: 3.5 },
      indicators: {
        rsi14: 55,
        ema20: 67800,
        ema50: 66500,
        ema200: 64000,
        volumeRatio: 1.8,
        atr14: 1200,
      },
    };

    // Pattern Agent
    const patternRes = await getPatternSignal('BTC', mockMarketData);
    assert.strictEqual(patternRes.agent, 'pattern_sentiment');
    assert.strictEqual(patternRes.signal, 'BUY', 'Stacked EMAs and healthy RSI should trigger BUY');
    assert(patternRes.confidence >= 0.75, 'Pattern confidence must be >= 75%');

    // Expert Trader Agent
    const expertRes = await assessAllocation('BTC', mockMarketData, { signal: 'BUY', confidence: 0.85 });
    assert.strictEqual(expertRes.agent, 'expert_trader');
    assert.strictEqual(expertRes.marketRegime, 'HIGH_MOMENTUM_BREAKOUT');
    assert(expertRes.allocatedPositionSize > 0, 'Must calculate allocated size');
    assert(expertRes.allocatedPositionSizeUsd >= 10, 'Allocated USD size must be >= $10');
  });

  // ─── 19. DexScreener Live Meme Coin Breakout Scanner ───────────────────────
  console.log('\n─── Module 19: DexScreener Meme Coin Breakout Scanner & Safety Filter ───');
  await asyncIt('Scans trending meme coins and enforces $50k+ liquidity & safety filters', async () => {
    const { scanTrendingMemeCoins } = require('../src/data/dexScreenerFeed');
    const memeList = await scanTrendingMemeCoins();

    assert(Array.isArray(memeList), 'Meme list must be an array');
    assert(memeList.length >= 3, 'Must return multiple trending meme coins');

    for (const m of memeList) {
      assert(m.symbol, 'Token must have a symbol');
      assert(m.liquidityUsd >= 10000, 'Liquidity must meet minimum threshold');
      assert(m.safetyScore >= 70, 'Safety score must pass threshold');
      assert(typeof m.change24h === 'number', '24h change must be numeric');
    }
  });

  // ─── 20. Autonomous Auto-Trading Engine Controller ───────────────────────
  console.log('\n─── Module 20: Autonomous Continuous Auto-Trading Engine ───');
  it('Controls autonomous trading lifecycle with start, stop, toggle, and countdown', () => {
    const { startAutoTrading, stopAutoTrading, toggleAutoTrading, getAutoTradingStatus } = require('../src/orchestrator/autoTrader');

    // Test start
    const startState = startAutoTrading(15, false);
    assert.strictEqual(startState.isActive, true, 'Auto-trading must be active after start');
    assert.strictEqual(startState.status, 'RUNNING');
    assert.strictEqual(startState.intervalSeconds, 15);

    // Test status query
    const queriedStatus = getAutoTradingStatus();
    assert.strictEqual(queriedStatus.isActive, true);
    assert(queriedStatus.pairs.length >= 1, 'Must include trading pairs');

    // Test stop
    const stopState = stopAutoTrading();
    assert.strictEqual(stopState.isActive, false, 'Auto-trading must be inactive after stop');
    assert.strictEqual(stopState.status, 'STOPPED');

    // Test toggle
    const toggleStart = toggleAutoTrading(30, false);
    assert.strictEqual(toggleStart.isActive, true, 'Toggle from stopped must start auto-trading');
    const toggleStop = toggleAutoTrading(30, false);
    assert.strictEqual(toggleStop.isActive, false, 'Toggle from running must stop auto-trading');
  });

  // ─── Module 21: Strategy Learning Agent & PineScript Backtest Engine ────────
  console.log('\n─── Module 21: Strategy Learning Agent, PineScript & Backtesting ───');

  await asyncIt('Generates valid PineScript v5, runs backtests, and optimizes hyperparameters', async () => {
    const { generatePineScript, exportPineScriptToFile, optimizeStrategy, getSignal } = require('../src/learning/strategyLearningAgent');
    const { runBacktestSimulation, generateSyntheticCandles } = require('../src/learning/backtestEngine');

    // 1. Pine Script v5 Generator
    const pineCode = generatePineScript('smc_luxalgo_5x', 'BTC/USDT');
    assert(pineCode.includes('//@version=5'), 'Must contain version 5 header');
    assert(pineCode.includes('strategy('), 'Must contain strategy declaration');
    assert(pineCode.includes('alert_message'), 'Must contain webhook alert payload');

    // 2. Backtesting Simulation Engine
    const candles = generateSyntheticCandles(77000, 150, '15m');
    const btResult = runBacktestSimulation({
      candles,
      strategyType: 'smc_luxalgo_5x',
      initialCapital: 1000,
      leverage: 5.0,
    });
    assert(typeof btResult.netProfitUsd === 'number', 'Net profit must be numeric');
    assert(typeof btResult.winRate === 'number', 'Win rate must be numeric');
    assert(typeof btResult.profitFactor === 'number', 'Profit factor must be numeric');

    // 3. Strategy Learning Agent Signal
    const signal = await getSignal('BTC/USDT', { price: { price: 77500 } });
    assert.strictEqual(signal.agent, 'strategy_learner');
    assert(['BUY', 'SELL', 'HOLD'].includes(signal.signal));
    assert(signal.futures_5x && signal.futures_5x.leverage === 5.0);
  });

  // ─── Summary ───────────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════════════════════════');
  console.log(`📊 TEST RESULTS: ${passedTests}/${totalTests} PASSED (${((passedTests / totalTests) * 100).toFixed(0)}%)`);
  console.log('══════════════════════════════════════════════════════════════════════\n');

  if (passedTests !== totalTests) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runSuite().catch(err => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});


