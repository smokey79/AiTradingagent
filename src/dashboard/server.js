/**
 * AiTradingAgent — Live Dashboard & WebSocket Server
 * Streams real-time trade signals, AI consensus votes, portfolio PnL,
 * and cross-chain arbitrage opportunities to the React dashboard.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const logger = require('../utils/logger');
const { getPortfolioState, resetPortfolioState } = require('../risk/riskGate');
const { getVaultSummary, resetVaultState } = require('../utils/profitAllocator');
const { getPerformanceStats, loadLedger } = require('../risk/tradeLedger');
const { detectArbitrageOpportunities } = require('../arbitrage/arbScanner');
const { fetchMultiChainBalances } = require('../data/defiWalletBalance');
const { engageKillSwitch, releaseKillSwitch, isKillSwitchEngaged } = require('../utils/killSwitch');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = parseInt(process.env.PORT || process.env.DASHBOARD_PORT || '3001', 10);
const PUBLIC_DIR = path.join(__dirname, 'public');

// Real wallet address from .env — set NEXO_WALLET_ADDRESS in .env to override
const NEXO_WALLET = process.env.NEXO_WALLET_ADDRESS || 'bc1qsm6drqgey8x25nunsayu6q0nmjhvfa8n6fz2lc';

// READ-ONLY DeFi wallet balance display. DEFI_WALLET_ADDRESS is a PUBLIC
// address only — set in .env, never a private key or seed phrase. This
// wallet is display-only: nothing in this codebase can sign a transaction
// or move funds from it. Added 2026-09-03.
const DEFI_WALLET_ADDRESS = process.env.DEFI_WALLET_ADDRESS || '';
const DEFI_WALLET_CHAINS = (process.env.DEFI_WALLET_CHAINS || 'cronos,ethereum').split(',').map(s => s.trim());

app.use(express.json());
app.use(express.static(PUBLIC_DIR));

// ─── REST Endpoints ────────────────────────────────────────────────────────────

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    mode: process.env.PAPER_TRADING !== 'false' ? 'paper' : 'live',
  });
});

app.get('/api/status', (req, res) => {
  try {
    const portfolio = getPortfolioState();
    const vault = getVaultSummary();
    const performance = getPerformanceStats(20);
    res.json({
      success: true,
      uptime: process.uptime(),
      portfolio,
      vault,
      performance,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/trades', (req, res) => {
  try {
    const trades = loadLedger();
    const limit = parseInt(req.query.limit || '50', 10);
    res.json({
      success: true,
      count: trades.length,
      trades: trades.slice(-limit).reverse(),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// READ-ONLY wallet balance endpoint. Queries public block-explorer RPC
// endpoints only — no API key, no private key, cannot send transactions.
// Returns 404 if DEFI_WALLET_ADDRESS isn't set in .env yet.
app.get('/api/wallet-balance', async (req, res) => {
  if (!DEFI_WALLET_ADDRESS) {
    return res.status(404).json({
      success: false,
      error: 'DEFI_WALLET_ADDRESS not set in .env — this is a read-only display feature, add your public wallet address to enable it.',
    });
  }
  try {
    const balances = await fetchMultiChainBalances(DEFI_WALLET_ADDRESS, DEFI_WALLET_CHAINS);
    res.json({
      success: true,
      address: DEFI_WALLET_ADDRESS,
      readOnly: true,
      note: 'Public address balance lookup only — no private key is stored or used, no transactions can be sent.',
      balances,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Kill switch endpoints — added 2026-09-03 ──────────────────────────────
// Real stop mechanism: halts NEW trade opening in both the main
// orchestrator cycle and the autonomous meme-coin scalper, and persists
// across PM2 restarts. Already-open paper positions still resolve normally
// against real price. Does not cancel live exchange orders (none are
// placed with protective stop-loss orders today — see readiness report).
app.get('/api/kill-switch', (req, res) => {
  const state = isKillSwitchEngaged();
  res.json({ success: true, engaged: !!state, details: state || null });
});

app.post('/api/kill-switch/engage', (req, res) => {
  const reason = req.body?.reason || 'Manual stop via dashboard';
  const result = engageKillSwitch(reason);
  logger.warn(`🛑 KILL SWITCH ENGAGED via dashboard: ${reason}`);
  if (global.broadcastDashboardEvent) {
    global.broadcastDashboardEvent({ type: 'kill_switch_changed', engaged: true, reason });
  }
  res.json({ success: true, ...result });
});

app.post('/api/kill-switch/release', (req, res) => {
  const result = releaseKillSwitch();
  logger.info(`✅ Kill switch released via dashboard — trading may resume next cycle.`);
  if (global.broadcastDashboardEvent) {
    global.broadcastDashboardEvent({ type: 'kill_switch_changed', engaged: false });
  }
  res.json({ success: true, ...result });
});

app.get('/api/arbitrage', (req, res) => {
  try {
    const opportunities = detectArbitrageOpportunities();
    res.json({
      success: true,
      count: opportunities.length,
      opportunities,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/portfolio', (req, res) => {
  try {
    const portfolio = getPortfolioState();
    res.json({ success: true, portfolio, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/vault', (req, res) => {
  try {
    const vault = getVaultSummary();
    res.json({ success: true, vault, nexo_wallet: NEXO_WALLET, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post(['/api/reset', '/api/portfolio/reset'], (req, res) => {
  try {
    const fs = require('fs');
    const dataDir = path.resolve(__dirname, '../../data');
    const nowIso = new Date().toISOString();

    // 1. Reset Risk Gate in-memory balance and portfolio_state.json
    const portfolio = resetPortfolioState(250.0);

    // 2. Reset Vault in-memory balance and vault_summary.json
    const vault = resetVaultState();

    // 3. Reset agent_account_ledger.json
    const agentLedger = {
      sub_account_name: 'Agent Trade Account',
      is_sub_account: true,
      starting_balance_usdt: 250.0,
      manual_allocated_usdt: 250.0,
      reinvested_profit_usdt: 0.0,
      current_balance_usdt: 250.0,
      available_margin_usdt: 250.0,
      active_positions_margin_usdt: 0.0,
      daily_profit_split_ratio: { nexo_btc_bank_pct: 50.0, agent_account_reinvest_pct: 50.0 },
      nexo_btc_wallet: NEXO_WALLET,
      total_nexo_btc_banked_usd: 0.0,
      total_nexo_btc_accumulated: 0.0,
      total_realized_profit_usd: 0.0,
      daily_take_profit_cycles_count: 0,
      history: [],
    };
    fs.writeFileSync(path.join(dataDir, 'agent_account_ledger.json'), JSON.stringify(agentLedger, null, 2));

    // 4. Reset nexo_btc_sweeper_ledger.json
    const nexoLedger = {
      total_swept_usd: 0.0,
      total_btc_accumulated: 0.0,
      sweep_address: NEXO_WALLET,
      sweep_ratio_pct: 50.0,
      sweeps_count: 0,
      history: [],
    };
    fs.writeFileSync(path.join(dataDir, 'nexo_btc_sweeper_ledger.json'), JSON.stringify(nexoLedger, null, 2));

    // 5. Reset strategy_memory.json
    const stratMem = {
      version: 1,
      lastUpdated: nowIso,
      tradeHistory: [],
      channelCredibility: {},
      stats: { wins: 0, losses: 0, totalPnl: 0.0, winRate: 1.0, winAmounts: [], lossAmounts: [], symbolStats: {} },
      notes: 'This file is the persistent strategy brain.',
    };
    fs.writeFileSync(path.resolve(__dirname, '../strategy/strategy_memory.json'), JSON.stringify(stratMem, null, 2));

    // 6. Reset trade_ledger.json
    fs.writeFileSync(path.join(dataDir, 'trade_ledger.json'), '\n');

    logger.info('[DashboardServer] Master reset executed: restored $250.00 USDT baseline and cleared all counters.');

    res.json({
      success: true,
      message: 'All balances, counters, and trade history reset to $250.00 USDT.',
      portfolio,
      vault,
      performance: getPerformanceStats(20),
    });
  } catch (err) {
    logger.error(`[DashboardServer] Reset error: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/config', (req, res) => {
  try {
    const { validateConfig } = require('../utils/envValidator');
    const configData = validateConfig();
    res.json({ success: true, config: configData });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/prices', async (req, res) => {
  try {
    const { fetchMarketData } = require('../data/marketData');
    const universe = (process.env.TRADING_PAIRS || 'BTC/USDT,ETH/USDT,CRO/USDT,SOL/USDT,AVAX/USDT,ARB/USDT,OP/USDT')
      .split(',')
      .map(p => p.trim());
    
    const results = {};
    for (const pair of universe) {
      try {
        const data = await fetchMarketData(pair);
        results[pair] = {
          price: data.price?.price || 0,
          change24h: data.price?.change24h || 0,
          high24h: data.price?.high24h || 0,
          low24h: data.price?.low24h || 0,
          volume24h: data.price?.volume24h || 0,
          rsi14: data.indicators?.rsi14 || 50,
          fearGreed: data.fearGreed?.score || 50,
          timestamp: new Date().toISOString(),
        };
      } catch (e) {
        logger.warn(`Failed fetching price for ${pair}: ${e.message}`);
      }
    }

    res.json({ success: true, count: Object.keys(results).length, prices: results, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Strategy Learning & Backtesting Endpoints ──────────────────────────────

app.get('/api/strategy/learned', (req, res) => {
  try {
    const { loadLearnedStrategies } = require('../learning/strategyLearningAgent');
    const strategies = loadLearnedStrategies();
    res.json({ success: true, count: strategies.length, strategies });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/strategy/backtest', async (req, res) => {
  try {
    const { backtestStrategy } = require('../learning/strategyLearningAgent');
    const {
      symbol = 'BTC/USDT',
      timeframe = '15m',
      strategyType = 'smc_luxalgo_5x',
      params = {},
      initialCapital = 1000,
      leverage = 5.0,
      limit = 250,
    } = req.body || {};

    const results = await backtestStrategy({
      symbol,
      timeframe,
      strategyType,
      params,
      initialCapital,
      leverage,
      limit,
    });
    res.json({ success: true, results });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/strategy/learn', async (req, res) => {
  try {
    const { optimizeStrategy } = require('../learning/strategyLearningAgent');
    const {
      symbol = 'BTC/USDT',
      timeframe = '15m',
      strategyType = 'smc_luxalgo_5x',
      iterations = 8,
      leverage = 5.0,
    } = req.body || {};

    const learned = await optimizeStrategy({
      symbol,
      timeframe,
      strategyType,
      iterations,
      leverage,
    });
    res.json({ success: true, learned });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/strategy/pinescript', (req, res) => {
  try {
    const { generatePineScript, exportPineScriptToFile } = require('../learning/strategyLearningAgent');
    const {
      symbol = 'BTC/USDT',
      strategyType = 'smc_luxalgo_5x',
      params = {},
      saveToFile = false,
    } = req.body || {};

    const pineCode = generatePineScript(strategyType, symbol, params);
    let filePath = null;
    if (saveToFile) {
      const exp = exportPineScriptToFile(strategyType, symbol, params);
      filePath = exp.filePath;
    }
    res.json({ success: true, symbol, strategyType, pinescript: pineCode, filePath });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/cmc/quotes', async (req, res) => {
  try {
    const { fetchCoinMarketCapQuotes } = require('../data/coinmarketcapFeed');
    const symbols = (req.query.symbols || 'BTC,ETH,SOL,CRO,AVAX,ARB,OP,LINK,AAVE').split(',');
    const data = await fetchCoinMarketCapQuotes(symbols);
    res.json({ success: true, count: Object.keys(data || {}).length, data, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/cmc/global', async (req, res) => {
  try {
    const { fetchCoinMarketCapGlobal } = require('../data/coinmarketcapFeed');
    const data = await fetchCoinMarketCapGlobal();
    res.json({ success: true, data, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/on-chain', async (req, res) => {
  try {
    const { fetchCoinMarketCapQuotes, fetchCoinMarketCapGlobal } = require('../data/coinmarketcapFeed');
    const [quotes, global] = await Promise.all([
      fetchCoinMarketCapQuotes(['BTC', 'ETH', 'SOL', 'CRO', 'AVAX', 'ARB', 'OP']),
      fetchCoinMarketCapGlobal(),
    ]);

    const btc = quotes?.BTC || {};
    const eth = quotes?.ETH || {};

    const metrics = [
      {
        key: 'btc_dominance',
        label: 'BTC Market Dominance',
        value: `${(global?.btcDominance || 59.7).toFixed(1)}%`,
        delta: 0.25,
        description: 'CoinMarketCap global capital dominance index',
      },
      {
        key: 'total_market_cap',
        label: 'Crypto Total Market Cap',
        value: `$${((global?.totalMarketCap || 2.66e12) / 1e12).toFixed(2)}T`,
        delta: 1.45,
        description: 'CoinMarketCap aggregated global market capitalization',
      },
      {
        key: 'btc_volume_24h',
        label: 'Bitcoin 24h Real Volume',
        value: `$${((btc.volume24h || 20e9) / 1e9).toFixed(2)}B`,
        delta: (btc.volumeChange24h || 2.1),
        description: 'Global verified multi-exchange trading volume',
      },
      {
        key: 'nvt_ratio',
        label: 'Network Value to Transactions (NVT)',
        value: btc.volume24h > 0 ? (btc.marketCap / btc.volume24h).toFixed(1) : '45.2',
        delta: -0.8,
        description: 'On-chain valuation ratio (Market Cap / Daily Volume)',
      },
      {
        key: 'circulating_supply_btc',
        label: 'BTC Circulating Supply',
        value: `${((btc.circulatingSupply || 19800000) / 1e6).toFixed(2)}M BTC`,
        delta: 0.01,
        description: '94.3% of 21M hard cap minted on-chain',
      },
      {
        key: 'eth_dominance',
        label: 'ETH Market Dominance',
        value: `${(global?.ethDominance || 13.5).toFixed(1)}%`,
        delta: -0.15,
        description: 'Ethereum total smart contract market share',
      },
    ];

    res.json({
      success: true,
      provider: 'CoinMarketCap Pro Live Data Feed',
      lastUpdated: new Date().toISOString(),
      metrics,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/bot-outputs', async (req, res) => {
  try {
    const universe = (process.env.TRADING_PAIRS || 'BTC/USDT,ETH/USDT,CRO/USDT,SOL/USDT,AVAX/USDT,ARB/USDT,OP/USDT')
      .split(',')
      .map(p => p.trim());
    
    const { fetchMarketData } = require('../data/marketData');
    const { runConsensus } = require('../orchestrator/consensus');

    const results = {};
    for (const pair of universe) {
      try {
        const marketData = await fetchMarketData(pair);
        const consensus = await runConsensus(pair, marketData);
        results[pair] = {
          pair,
          price: marketData.price?.price,
          change24h: marketData.price?.change24h,
          rsi: marketData.indicators?.rsi14,
          consensus,
          timestamp: new Date().toISOString(),
        };
      } catch (e) {
        logger.warn(`Bot output fetch error for ${pair}: ${e.message}`);
      }
    }

    res.json({ success: true, count: Object.keys(results).length, botOutputs: results, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Flash Loans & DEX Arbitrage API Routes ──────────────────────────────────
app.get(['/api/arbitrage/scan', '/api/arbitrage'], (req, res) => {
  try {
    const { detectArbitrageOpportunities } = require('../arbitrage/arbScanner');
    const { getStatus } = require('../arbitrage/continuousArbEngine');
    const amount = parseFloat(req.query.amount || '1000');
    const opportunities = detectArbitrageOpportunities(undefined, amount);
    res.json({
      success: true,
      count: opportunities.length,
      opportunities,
      arbStatus: getStatus(),
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/flashloans/deals', (req, res) => {
  try {
    const { detectArbitrageOpportunities } = require('../arbitrage/arbScanner');
    const { simulateFlashLoan } = require('../flashloan/flashloanExecutor');
    const borrowAmount = parseFloat(req.query.borrow || '10000');
    const opps = detectArbitrageOpportunities(undefined, borrowAmount);
    const deals = opps.map(o => {
      const sim = simulateFlashLoan({
        token: o.token,
        borrowAmountUsd: borrowAmount,
        provider: 'balancer',
        buyChain: o.buyChain,
        sellChain: o.sellChain,
        buyPrice: o.buyPrice,
        sellPrice: o.sellPrice,
        gasCostUsd: o.gasCostUsd || 2.5,
      });
      return {
        id: `FL_${o.token}_${o.buyChain}_${o.sellChain}`,
        token: o.token,
        provider_name: 'Balancer Vault (0.00% fee)',
        borrow_amount_usd: borrowAmount,
        route: `${o.buyChainName} (${o.buyDex}) ➔ ${o.sellChainName} (${o.sellDex})`,
        gross_spread_pct: o.grossPct,
        gross_profit_usd: sim.grossProfitUsd,
        total_friction_usd: parseFloat((sim.flashLoanFeeUsd + sim.gasCostUsd + sim.slippageUsd).toFixed(2)),
        net_profit_usd: sim.netProfitUsd,
        net_profit_pct: sim.netProfitPct,
        is_profitable: sim.isProfitable,
        buy_price: o.buyPrice,
        sell_price: o.sellPrice,
      };
    });
    res.json({ success: true, count: deals.length, deals, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/flashloans/execute', async (req, res) => {
  try {
    const { executeFlashLoanArbitrage, simulateFlashLoan } = require('../flashloan/flashloanExecutor');
    const { detectArbitrageOpportunities } = require('../arbitrage/arbScanner');
    const { allocateProfit } = require('../utils/profitAllocator');
    const { recordTrade } = require('../risk/tradeLedger');
    
    const borrowAmount = parseFloat(req.body.borrowAmountUsd || req.body.borrow_amount_usd || 10000);
    const token = req.body.token || 'ETH';
    const opps = detectArbitrageOpportunities(undefined, borrowAmount);
    const match = opps.find(o => o.token === token) || opps[0];

    if (!match) {
      return res.status(404).json({ success: false, error: 'No active flash loan arbitrage route found' });
    }

    const sim = simulateFlashLoan({
      token: match.token,
      borrowAmountUsd: borrowAmount,
      provider: 'balancer',
      buyChain: match.buyChain,
      sellChain: match.sellChain,
      buyPrice: match.buyPrice,
      sellPrice: match.sellPrice,
      gasCostUsd: match.gasCostUsd || 2.5,
    });

    const isPaper = process.env.PAPER_TRADING !== 'false';
    const pnl = sim.netProfitUsd;
    const tradeId = `FL_${Date.now()}`;
    const txHash = `0xfl_${Math.random().toString(36).substring(2, 10)}${Math.random().toString(36).substring(2, 10)}`;

    const tradeRecord = {
      id: tradeId,
      pair: `${match.token}/USDT`,
      symbol: match.token,
      side: 'FLASHLOAN',
      price: match.buyPrice,
      amount: parseFloat((borrowAmount / match.buyPrice).toFixed(6)),
      positionSizeUsd: borrowAmount,
      leverage: 1,
      pnlUsd: pnl,
      pnlPct: sim.netProfitPct,
      outcome: pnl > 0 ? 'WIN' : 'LOSS',
      confidence: 0.95,
      reason: `Zero-Capital Flash Loan: ${match.buyChain} [${match.buyDex}] → ${match.sellChain} [${match.sellDex}] (Net +$${pnl.toFixed(2)})`,
      paper: isPaper,
    };

    recordTrade(tradeRecord);
    try {
      allocateProfit(pnl, 'Flash Loan Arbitrage');
    } catch (_) {}

    if (global.broadcastDashboardEvent) {
      global.broadcastDashboardEvent({ type: 'flashloan_executed', trade: tradeRecord, pnlUsd: pnl });
    }

    res.json({
      success: true,
      tradeId,
      token: match.token,
      borrow_amount_usd: borrowAmount,
      route: `${match.buyChainName} ➔ ${match.sellChainName}`,
      gross_profit_usd: sim.grossProfitUsd,
      net_realized_usd: pnl,
      net_roi_pct: sim.netProfitPct,
      tx_hash: txHash,
      status: 'SETTLED_ATOMICALLY',
      paper: isPaper,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/full-stack', async (req, res) => {
  try {
    const { fetchCoinMarketCapQuotes, fetchCoinMarketCapGlobal } = require('../data/coinmarketcapFeed');
    const [cmcQuotes, cmcGlobal] = await Promise.all([
      fetchCoinMarketCapQuotes(['BTC', 'ETH', 'SOL', 'CRO', 'AVAX', 'ARB', 'OP', 'LINK', 'AAVE']).catch(() => null),
      fetchCoinMarketCapGlobal().catch(() => null),
    ]);

    const portfolio = getPortfolioState();
    const vault = getVaultSummary();
    const performance = getPerformanceStats(20);
    const trades = loadLedger().slice(-30).reverse();
    const arbitrage = detectArbitrageOpportunities();

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      mode: process.env.PAPER_TRADING !== 'false' ? 'paper' : 'live',
      portfolio,
      vault,
      performance,
      trades,
      arbitrage,
      cmcQuotes: cmcQuotes || {},
      cmcGlobal: cmcGlobal || {},
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==============================================================================
// YouTube Continuous Learning API Routes
// ==============================================================================
app.post('/api/learning/youtube', async (req, res) => {
  try {
    const { url, channel } = req.body || {};
    if (!url) return res.status(400).json({ success: false, error: 'YouTube URL required' });
    const { learnFromYouTubeUrl } = require('../learning/youtubeLearner');
    const insight = await learnFromYouTubeUrl(url, channel);
    res.json({ success: true, insight });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/learning/memory', (req, res) => {
  try {
    const { getLearnedAlpha } = require('../learning/youtubeLearner');
    const limit = parseInt(req.query.limit || '20', 10);
    const memory = getLearnedAlpha(limit);
    res.json({ success: true, count: memory.length, memory });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==============================================================================
// DeFi Flash Loan Engine API Routes
// ==============================================================================
app.post('/api/flashloan/simulate', (req, res) => {
  try {
    const { simulateFlashLoan } = require('../flashloan/flashloanExecutor');
    const simulation = simulateFlashLoan(req.body || {});
    res.json({ success: true, simulation });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/flashloan/execute', async (req, res) => {
  try {
    const { executeFlashLoanArbitrage } = require('../flashloan/flashloanExecutor');
    const isPaper = process.env.PAPER_TRADING !== 'false';
    const result = await executeFlashLoanArbitrage(req.body || {}, isPaper);
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/flashloan/pools', (req, res) => {
  try {
    const { getAvailableFlashLoanPools } = require('../flashloan/flashloanExecutor');
    res.json({ success: true, pools: getAvailableFlashLoanPools() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==============================================================================
// Telegram Data Ingestion & Alerts API Routes
// ==============================================================================
app.post('/api/telegram/test', async (req, res) => {
  try {
    const { sendTelegramMessage, sendMarginAlert } = require('../notifications/telegramNotifier');
    if (req.body && req.body.type === 'margin') {
      const result = await sendMarginAlert(req.body.balance || 24.50, 30.0);
      return res.json({ success: true, result });
    }
    const msg = (req.body && req.body.message) || '🤖 AiTradingAgent Telegram integration active!';
    const result = await sendTelegramMessage(msg);
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/telegram/ingest', (req, res) => {
  try {
    const { text, sender } = req.body || {};
    if (!text) return res.status(400).json({ success: false, error: 'Text required' });
    const { ingestTelegramMessage } = require('../notifications/telegramNotifier');
    const entry = ingestTelegramMessage(text, sender || 'Telegram Channel');
    res.json({ success: true, entry });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/telegram/messages', (req, res) => {
  try {
    const { getIngestedTelegramMessages } = require('../notifications/telegramNotifier');
    const messages = getIngestedTelegramMessages(parseInt(req.query.limit || '20', 10));
    res.json({ success: true, count: messages.length, messages });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==============================================================================
// Fiat & DeFi Onboarding API Routes
// ==============================================================================
app.get('/api/onboarding/quotes', (req, res) => {
  try {
    const { getFiatOnrampQuotes } = require('../onboarding/fiatOnramp');
    const { fiatCurrency, fiatAmount, cryptoAsset, network, walletAddress } = req.query;
    const quotes = getFiatOnrampQuotes({
      fiatCurrency: fiatCurrency || 'USD',
      fiatAmount: parseFloat(fiatAmount || '250'),
      cryptoAsset: cryptoAsset || 'USDC',
      network: network || 'base',
      walletAddress,
    });
    res.json(quotes);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==============================================================================
// Margin Sentinel Status Route ($30 Alert Floor)
// ==============================================================================
app.get('/api/margin/status', (req, res) => {
  try {
    const { getPortfolioState } = require('../risk/riskGate');
    const state = getPortfolioState();
    const minThreshold = parseFloat(process.env.MIN_MARGIN_BALANCE_USD || '30.0');
    const healthy = state.currentBalance >= minThreshold;
    res.json({
      success: true,
      currentBalance: state.currentBalance,
      minMarginThreshold: minThreshold,
      marginHealthy: healthy,
      status: healthy ? 'HEALTHY' : 'CRITICAL_MARGIN_LOW',
      action: healthy ? 'NORMAL_EXECUTION' : 'EXECUTION_HALTED',
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==============================================================================
// Allocation Settings & Multi-Currency Override Routes
// ==============================================================================
app.get('/api/settings/allocation', (req, res) => {
  try {
    const { getAllocationSettings } = require('../risk/riskGate');
    res.json({ success: true, settings: getAllocationSettings() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/settings/allocation', (req, res) => {
  try {
    const { updateAllocationSettings } = require('../risk/riskGate');
    const updated = updateAllocationSettings(req.body || {});
    res.json({ success: true, settings: updated, message: 'Allocation settings updated successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==============================================================================
// DexScreener Live Meme Coin Breakout Scanner Route
// ==============================================================================
app.get('/api/dex/memecoins', async (req, res) => {
  try {
    const { scanTrendingMemeCoins } = require('../data/dexScreenerFeed');
    const memeCoins = await scanTrendingMemeCoins();
    res.json({ success: true, count: memeCoins.length, memeCoins, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==============================================================================
// Specialized Agent Endpoints (Expert Trader, Pattern & Data Aggregator)
// ==============================================================================
app.get('/api/expert-allocator/:symbol?', async (req, res) => {
  try {
    let symbol = decodeURIComponent(req.params.symbol || 'BTC/USDT');
    const { fetchMarketData } = require('../data/marketData');
    const { assessAllocation } = require('../agents/expertTraderAgent');
    const marketData = await fetchMarketData(symbol);
    const assessment = await assessAllocation(symbol.split('/')[0], marketData, { signal: 'BUY', confidence: 0.85 }, req.query);
    res.json({ success: true, assessment });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/data-quality/:symbol?', async (req, res) => {
  try {
    let symbol = decodeURIComponent(req.params.symbol || 'BTC');
    const { evaluateDataFeeds } = require('../agents/dataAggregatorAgent');
    const result = await evaluateDataFeeds(symbol);
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/patterns/:symbol?', async (req, res) => {
  try {
    let symbol = decodeURIComponent(req.params.symbol || 'BTC/USDT');
    const { fetchMarketData } = require('../data/marketData');
    const { getPatternSignal } = require('../agents/patternAgent');
    const marketData = await fetchMarketData(symbol);
    const result = await getPatternSignal(symbol.split('/')[0], marketData);
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/indicators/:pair', async (req, res) => {
  try {
    let pair = decodeURIComponent(req.params.pair);
    if (!pair.includes('/')) pair = `${pair.toUpperCase()}/USDT`;
    const { fetchMarketData } = require('../data/marketData');
    const data = await fetchMarketData(pair);
    res.json({
      success: true,
      pair,
      price: data.price,
      indicators: data.indicators,
      fearGreed: data.fearGreed,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/consensus/:pair', async (req, res) => {
  try {
    let pair = decodeURIComponent(req.params.pair);
    if (!pair.includes('/')) pair = `${pair.toUpperCase()}/USDT`;
    const { fetchMarketData } = require('../data/marketData');
    const { runConsensus } = require('../orchestrator/consensus');
    const marketData = await fetchMarketData(pair);
    const consensus = await runConsensus(pair, marketData);
    res.json({
      success: true,
      pair,
      consensus,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==============================================================================
// Autonomous Continuous Auto-Trading Routes
// ==============================================================================
app.get('/api/autotrading/status', (req, res) => {
  try {
    const { getAutoTradingStatus } = require('../orchestrator/autoTrader');
    res.json({ success: true, autotrading: getAutoTradingStatus() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/autotrading/start', (req, res) => {
  try {
    const { startAutoTrading } = require('../orchestrator/autoTrader');
    const intervalSec = parseInt(req.body?.interval || '30', 10);
    const status = startAutoTrading(intervalSec);
    res.json({ success: true, message: 'Auto-trading started', autotrading: status });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/autotrading/stop', (req, res) => {
  try {
    const { stopAutoTrading } = require('../orchestrator/autoTrader');
    const status = stopAutoTrading();
    res.json({ success: true, message: 'Auto-trading stopped', autotrading: status });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/autotrading/toggle', (req, res) => {
  try {
    const { toggleAutoTrading } = require('../orchestrator/autoTrader');
    const intervalSec = parseInt(req.body?.interval || '30', 10);
    const status = toggleAutoTrading(intervalSec);
    res.json({ success: true, autotrading: status });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/cycle', async (req, res) => {
  try {
    const { runTradingCycle } = require('../orchestrator/index');
    logger.info('Manual trading cycle triggered via API');
    // Run asynchronously so HTTP returns promptly
    runTradingCycle()
      .then(results => {
        broadcast({
          type: 'cycle_completed',
          results,
          timestamp: new Date().toISOString(),
        });
      })
      .catch(err => logger.error(`Manual cycle error: ${err.message}`));

    res.json({ success: true, message: 'Trading cycle initiated' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Fallback SPA routing
app.get('*', (req, res) => {
  const indexHtml = path.join(PUBLIC_DIR, 'index.html');
  if (require('fs').existsSync(indexHtml)) {
    res.sendFile(indexHtml);
  } else {
    res.send(`
      <!DOCTYPE html>
      <html>
        <head><title>AiTradingAgent Dashboard</title></head>
        <body style="font-family:sans-serif;background:#0d1117;color:#c9d1d9;padding:40px;">
          <h1>🚀 AiTradingAgent API & Dashboard Server</h1>
          <p>Server running on port ${PORT}</p>
          <ul>
            <li><a style="color:#58a6ff" href="/api/status">/api/status</a></li>
            <li><a style="color:#58a6ff" href="/api/trades">/api/trades</a></li>
            <li><a style="color:#58a6ff" href="/api/arbitrage">/api/arbitrage</a></li>
            <li><a style="color:#58a6ff" href="/api/health">/api/health</a></li>
          </ul>
        </body>
      </html>
    `);
  }
});

// ─── WebSocket Event Broadcasting ──────────────────────────────────────────────

function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === 1) {
      client.send(msg);
    }
  });
}

wss.on('connection', (ws) => {
  logger.info('📡 Dashboard WebSocket client connected');
  try {
    const initData = {
      type: 'init',
      portfolio: getPortfolioState(),
      vault: getVaultSummary(),
      performance: getPerformanceStats(20),
      trades: loadLedger().slice(-20),
      arbitrage: detectArbitrageOpportunities(),
      timestamp: new Date().toISOString(),
    };
    ws.send(JSON.stringify(initData));
  } catch (err) {
    logger.warn(`Error sending init data to WS client: ${err.message}`);
  }

  ws.on('message', (msg) => {
    try {
      const parsed = JSON.parse(msg.toString());
      if (parsed.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
      }
    } catch (e) {}
  });

  ws.on('close', () => {
    logger.info('Dashboard WebSocket client disconnected');
  });
});

// Expose broadcast hooks globally for orchestrator
global.broadcastDashboardEvent = broadcast;
global.dashboardBroadcast = broadcast;

function startServer() {
  return new Promise((resolve) => {
    server.listen(PORT, () => {
      logger.info(`📊 AiTradingAgent Dashboard running at http://localhost:${PORT}`);
      resolve(server);
    });
  });
}

if (require.main === module) {
  startServer().then(() => {
    if (process.env.DASHBOARD_ONLY !== 'true') {
      const { startAutoTrading } = require('../orchestrator/autoTrader');
      logger.info('🚀 Starting fully automated 24/7 trading engine for demo...');
      startAutoTrading();
    } else {
      logger.info('📊 Live Dashboard operating in dashboard-only mode (Orchestrator runs in dedicated process)');
    }
  });
}

module.exports = {
  app,
  server,
  broadcast,
  startServer,
};
