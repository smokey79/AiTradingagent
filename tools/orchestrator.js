import { getPreferredProvider } from "./utils/provider.js";
import { benchmarkProviders } from "./utils/providerBenchmark.js";
import { getHermesRuling } from "./agents/hermesAgent.js";
import { claudeAgent } from "./agents/claude.js";
import { gptAgent } from "./agents/gpt.js";
import { grokAgent } from "./agents/grok.js";
import { geminiAgent } from "./agents/gemini.js";
import { perplexityAgent } from "./agents/perplexity.js";
import fs from "fs";

export async function runTradingOrchestrator(marketData) {
  // 1. Read provider health
  const providerHealth = getPreferredProvider();

  // 2. Run benchmark periodically
  let benchmark = {};
  try {
    benchmark = await benchmarkProviders();
  } catch {
    benchmark = { ollama: { ok: false }, openrouter: { ok: false } };
  }

  // 3. Decide provider
  let provider = providerHealth.provider;

  if (benchmark.ollama.ok && benchmark.openrouter.ok) {
    provider =
      benchmark.ollama.latency < benchmark.openrouter.latency
        ? "ollama"
        : "openrouter";
  }

  // 4. Run specialist agents
  const signals = {
    claude: await claudeAgent(marketData, provider),
    gpt4o: await gptAgent(marketData, provider),
    grok: await grokAgent(marketData, provider),
    gemini: await geminiAgent(marketData, provider),
    perplexity: await perplexityAgent(marketData, provider),
  };

  // 5. Hermes consensus validator
  const ruling = await getHermesRuling(signals);

  // 6. Save full context
  fs.writeFileSync(
    "./last_orchestration.json",
    JSON.stringify({ provider, signals, ruling }, null, 2)
  );

  return ruling;
}
