module.exports = {
  apps: [
    {
      name: "risk-gate",
      cwd: "F:/aitradingagent/mcp-servers/risk-gate-mcp",
      script: "index.js",
      interpreter: "node",
      watch: false
    },
    {
      name: "trading-data",
      cwd: "F:/aitradingagent/mcp-servers/trading-data-mcp",
      script: "index.js",
      interpreter: "node",
      watch: false
    },
    {
      name: "trading-api",
      cwd: "F:/aitradingagent",
      script: "trading_api.py",
      interpreter: "F:/aitradingagent/venv/Scripts/python.exe",
      watch: false
    },
    {
      name: "autonomous-matrix",
      cwd: "F:/aitradingagent",
      script: "agents/AI-Trading-Agent/autonomous_engine.py",
      interpreter: "F:/aitradingagent/venv/Scripts/python.exe",
      watch: false
    },
    {
      name: "flask-dashboard",
      cwd: "F:/aitradingagent",
      script: "wsgi.py",
      interpreter: "F:/aitradingagent/venv/Scripts/python.exe",
      watch: false
    }
  ]
};
