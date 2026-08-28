/**
 * copilotAgent.js
 * AiTradingAgent — Copilot Meta-Agent
 * 
 * Purpose:
 *  - Synthesise signals from MCP servers + sentiment + strategy memory
 *  - Apply risk-gate constraints
 *  - Produce a unified JSON trading signal
 * 
 * Output format (required by orchestrator):
 * {
 *   signal: "LONG" | "SHORT" | "HOLD",
 *   confidence: Number,
 *   reason: String,
 *   constraints: { ... }
 * }
 */

import fs from "fs";
import path from "path";
import { TradingDataClient } from "../utils/tradingDataClient.js";
import { RiskGateClient } from "../utils/riskGateClient.js";
import { SentimentClient } from "../sentiment/sentimentClient.js";

const STRATEGY_MEMORY_PATH = path.join(process.cwd(), "strategy_memory.json");

export default class CopilotAgent {
    constructor() {
        this.name = "CopilotAgent";
        this.tradingData = new TradingDataClient();
        this.riskGate = new RiskGateClient();
        this.sentiment = new SentimentClient();
    }

    loadStrategyMemory() {
        try {
            const raw = fs.readFileSync(STRATEGY_MEMORY_PATH, "utf8");
            return JSON.parse(raw);
        } catch (err) {
            return { lastSignals: [], performance: {}, notes: "No strategy memory found." };
        }
    }

    async run() {
        try {
            // --- 1. Load strategy memory ---
            const memory = this.loadStrategyMemory();

            // --- 2. Get live market data ---
            const market = await this.tradingData.getLiveMarket();
            const price = market?.price || null;
            const trend = market?.trend || "unknown";

            // --- 3. Sentiment analysis ---
            const sentimentScore = await this.sentiment.getGlobalSentiment();
            const sentimentLabel =
                sentimentScore > 0.2 ? "bullish" :
                sentimentScore < -0.2 ? "bearish" :
                "neutral";

            // --- 4. Risk gate check ---
            const risk = await this.riskGate.evaluate({
                price,
                trend,
                sentiment: sentimentLabel,
                memory
            });

            if (!risk.allowed) {
                return {
                    signal: "HOLD",
                    confidence: 0.0,
                    reason: `Risk gate blocked trade: ${risk.reason}`,
                    constraints: risk.constraints || {}
                };
            }

            // --- 5. Copilot meta-synthesis logic ---
            let signal = "HOLD";
            let confidence = 0.5;
            let reason = "Neutral conditions.";

            if (trend === "up" && sentimentLabel === "bullish") {
                signal = "LONG";
                confidence = 0.78;
                reason = "Uptrend + bullish sentiment.";
            }

            if (trend === "down" && sentimentLabel === "bearish") {
                signal = "SHORT";
                confidence = 0.74;
                reason = "Downtrend + bearish sentiment.";
            }

            // Avoid low-odds trades (your preference)
            if (confidence < 0.65) {
                signal = "HOLD";
                reason = "Confidence below threshold; avoiding low-odds trade.";
            }

            // Auto-convert profits to BTC (your preference)
            const constraints = {
                autoConvertProfitsToBTC: true,
                riskGate: risk.constraints || {},
                meta: {
                    trend,
                    sentiment: sentimentLabel,
                    strategyMemoryUsed: true
                }
            };

            return {
                signal,
                confidence,
                reason,
                constraints
            };

        } catch (err) {
            return {
                signal: "HOLD",
                confidence: 0.0,
                reason: `CopilotAgent error: ${err.message}`,
                constraints: {}
            };
        }
    }
}
