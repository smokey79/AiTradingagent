F:\AiTradingAgent\mcp-servers\copilot-mcp\index.mjs

package.js

import { Server } from "@modelcontextprotocol/sdk/server.js";
import { z } from "@modelcontextprotocol/sdk/zod.js";
import fs from "fs";
import path from "path";

const STRATEGY_MEMORY_PATH = path.join(process.cwd(), "..", "..", "strategy_memory.json");

function loadStrategyMemory() {
    try {
        const raw = fs.readFileSync(STRATEGY_MEMORY_PATH, "utf8");
        return JSON.parse(raw);
    } catch {
        return { lastSignals: [], performance: {}, notes: "No strategy memory found." };
    }
}

const server = new Server({
    name: "copilot-mcp",
    version: "1.0.0"
});

server.tool(
    "get_copilot_signal",
    {
        description: "Return a unified Copilot trading signal based on strategy memory.",
        inputSchema: z.object({}),
        outputSchema: z.object({
            signal: z.string(),
            confidence: z.number(),
            reason: z.string(),
            constraints: z.record(z.any())
        })
    },
    async () => {
        const memory = loadStrategyMemory();

        // Minimal example: HOLD unless we have strong positive history
        const winRate = memory?.performance?.winRate ?? 0;
        let signal = "HOLD";
        let confidence = 0.5;
        let reason = "Default HOLD from Copilot MCP.";

        if (winRate > 0.6) {
            signal = "LONG";
            confidence = 0.72;
            reason = "Historical win rate > 60%, biasing LONG.";
        }

        return {
            signal,
            confidence,
            reason,
            constraints: {
                strategyMemoryUsed: true,
                winRate
            }
        };
    }
);

server.start();
