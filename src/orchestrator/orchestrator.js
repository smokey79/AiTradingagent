/**
 * AiTradingAgent — Multi-LLM Orchestrator (CommonJS)
 * Runs a consensus cycle across 5 specialist AI agents for each asset
 * in the trading universe, applies risk gating, and executes via Bitget.
 */
require("dotenv/config");
const { logger } = require("../utils/logger.js");

const { getClaudeSignal } = require("../agents/claudeAgent.js");
const { getGpt4oSignal } = require("../agents/gpt4oAgent.js");
const { getGrokSignal } = require("../agents/grokAgent.js");
const { getGeminiSignal } = require("../agents/geminiAgent.js");
const { getPerplexitySignal } = require("../agents/perplexityAgent.js");
const { getHermesRuling } = require("../agents/hermesAgent.js");
const { synthesize } = require("../agents/copilotSynthesisAgent.js");

const { GlassnodeClient } = require("../data/glassnodeClient.js");
const { CoinMarketCapClient } = require("../data/coinMarketCapClient.js");
const { YoutubeSentimentAgent } = require("../sentiment/youtubeSentimentAgent.js");
const { XSentimentAgent } = require("../sentiment/xSentimentAgent.js");

const { passesRiskGate } = require("../risk/riskGate.js");
const { loadStrategyMemory, appendTradeRecord } = require("../strategy/strategyMemoryLoader.js");
const { BitgetExecutor } = require("../execution/bitgetExecutor.js");

const UNIVERSE = ["BTC", "ETH", "CRO", "SOL", "AVAX", "ARB", "OP"];

async function buildMarketContext(asset) {
  const context = { asset, timestamp: new Date().toISOString() };

  try {
    const cmc = new CoinMarketCapClient();
    context.priceData = await cmc.getQuotes([asset]);
  } catch (err) {
    logger.warn("Skipping CoinMarketCap data", { error: err.message });
  }

  try {
    const glassnode = new GlassnodeClient();
    context.sopr = await glassnode.getSOPR(asset);
    context.mvrv = await glassnode.getMVRV(asset);
  } catch (err) {
    logger.warn("Skipping Glassnode data", { error: err.message });
  }

  try {
    const x = new XSentimentAgent();
    context.xSentiment = await x.run(asset);
  } catch (err) {
    logger.warn("Skipping X sentiment", { error: err.message });
  }

  return context;
}

async function runCycleForAsset(asset, youtubeSentiment) {
  logger.info(`--- Cycle start: ${asset} ---`);
  const marketContext = await buildMarketContext(asset);
  marketContext.youtubeSentiment = youtubeSentiment;

  const [claude, gpt4o, grok, gemini, perplexity] = await Promise.all([
    getClaudeSignal(marketContext),
    getGpt4oSignal(marketContext),
    getGrokSignal(marketContext),
    getGeminiSignal(marketContext),
    getPerplexitySignal(marketContext),
  ]);

  const agentSignals = { claude, gpt4o, grok, gemini, perplexity };
  const hermesRuling = await getHermesRuling(agentSignals);
  const synthesis = synthesize(agentSignals, hermesRuling);
  const { passed, checks } = passesRiskGate(synthesis);

  const memory = loadStrategyMemory();
  appendTradeRecord(memory, { asset, synthesis, riskGate: { passed, checks } });

  if (!passed) {
    logger.info(`${asset}: risk gate blocked trade`, { finalSignal: synthesis.finalSignal });
    return { asset, executed: false, synthesis };
  }

  if (synthesis.finalSignal === "hold") {
    return { asset, executed: false, synthesis };
  }

  const bitget = new BitgetExecutor();
  const order = await bitget.placeOrder({
    symbol: `${asset}USDT`,
    side: synthesis.finalSignal,
    size: "0",
  });

  return { asset, executed: true, order, synthesis };
}

async function main() {
  logger.info("=== AiTradingAgent cycle starting ===", {
    mode: process.env.TRADING_MODE || "paper",
  });

  let youtubeSentiment = [];
  try {
    const yt = new YoutubeSentimentAgent();
    youtubeSentiment = await yt.run();
  } catch (err) {
    logger.warn("Skipping YouTube sentiment this cycle", { error: err.message });
  }

  const results = [];
  for (const asset of UNIVERSE) {
    try {
      const result = await runCycleForAsset(asset, youtubeSentiment);
      results.push(result);
    } catch (err) {
      logger.error(`Cycle failed for ${asset}`, { error: err.message });
    }
  }

  logger.info("=== Cycle complete ===", {
    executed: results.filter((r) => r.executed).length,
    total: results.length,
  });
}

if (require.main === module) {
  main();
}

module.exports = { runCycleForAsset, buildMarketContext };
