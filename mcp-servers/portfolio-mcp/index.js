import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const server = new Server(
  {
    name: "portfolio-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler("tools/list", async () => {
  return {
    tools: [
      {
        name: "get_portfolio_summary",
        description: "Get current balances and portfolio metrics",
        inputSchema: {
          type: "object",
          properties: {}
        }
      }
    ]
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);
