import { Server } from "@modelcontextprotocol/sdk/server";
import { log } from "../../core/logger.js";
import { validatePosition } from "../../core/schema.js";

const server = new Server({
  name: "risk-gate",
  version: "1.0.0",
});

server.addTool("riskCheck", async ({ position }) => {
  validatePosition(position);

  const risk = position.size > 1000 ? "HIGH" : "LOW";

  log("Risk check executed:", position);

  return {
    risk,
    reason:
      risk === "HIGH"
        ? "Position size exceeds threshold"
        : "Position size within safe limits",
  };
});

server.start();
