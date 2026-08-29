import "dotenv/config";
import { logger } from "../utils/logger.js";

import { getClaudeSignal } from "../agents/claudeAgent.js";
import { getGpt4oSignal } from "../agents/gpt4oAgent.js";
import { getGrokSignal } from "../agents/grokAgent.js";
import { getGeminiSignal } from "../agents/geminiAgent.js";
import { getPerplexitySignal } from "../agents/perplexityAgent.js";
import { getHermesRuling } from "../agents/hermesAgent.js";
import { synthesize } from "../agents/copilotSynthesisAgent.js";

import { GlassnodeClient } from "../data/glassnodeClient.js";
import { CoinMarketCapClient } from "../data/coinMarketCapClient.js";
import { YoutubeSentimentAgent } from "../sentiment/youtubeSentimentAgent.js";
import { XSentimentAgent } from "../sentiment/xSentimentAgent.js";

import { passesRiskGate } from "../risk/riskGate.js";
import { loadStrategyMemory, appendTradeRecord } from "../strategy/strategyMemoryLoader.js";
import { BitgetExecutor } from "../execution/bitgetExecutor.js";
import { CryptoComExecutor } from "../execution/cryptoComExecutor.js";

const UNIVERSE = ["BTC", "ETH", "CRO", "SOL", "AVAX", "ARB", "OP"];

async function buildMarketContext(asset) {
  const context = { asset, timestamp: new Date().toISOString() };

  // Each data source is optional — a missing key degrades gracefully rather
  // than crashing the whole cycle, since not every key may be filled yet.
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

  // 5 specialist agents run in parallel
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
  appendTradeRecord(memory, {
    asset,
    synthesis,
    riskGate: { passed, checks },
  });

  if (!passed) {
    logger.info(`${asset}: risk gate blocked trade`, { finalSignal: synthesis.finalSignal });
    return { asset, executed: false, synthesis };
  }

  if (synthesis.finalSignal === "hold") {
    return { asset, executed: false, synthesis };
  }

  // Execute — Bitget as primary, Crypto.com as secondary/backup venue.
  const bitget = new BitgetExecutor();
  const order = await bitget.placeOrder({
    symbol: `${asset}USDT`,
    side: synthesis.finalSignal,
    size: "0", // TODO: wire in real position sizing from account balance + risk %
  });

  return { asset, executed: true, order, synthesis };
}

async function main() {
  logger.info("=== AiTradingAgent cycle starting ===", {
    mode: process.env.TRADING_MODE || "paper",
  });

  // YouTube sentiment is fetched once per cycle (shared across all assets)
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

main();

export { evaluateConsensus, runCycleForAsset, buildMarketContext };

