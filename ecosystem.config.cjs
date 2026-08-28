module.exports = {
  apps: [
    {
      name: "risk-gate",
      cwd: "F:/aitradingagent/mcp-servers/risk-gate-mcp",
      script: "index.js",
      watch: false
    },
    {
      name: "signal-engine-mock",
      cwd: "F:/aitradingagent",
      script: "mcp-servers/signal-engine-mcp/index.js",
      interpreter: "node",
      watch: false
    },
    {
      name: "portfolio-mock",
      cwd: "F:/aitradingagent",
      script: "mcp-servers/portfolio-mcp/index.js",
      interpreter: "node",
      watch: false
    },
    {
      name: "flask-dashboard",
      cwd: "F:/aitradingagent",
      script: "wsgi.py",
      interpreter: "py",
      watch: false
    }
  ]
}
