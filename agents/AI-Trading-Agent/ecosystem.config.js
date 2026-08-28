module.exports = {
  apps: [
    {
      name: "ai-trading-bot",
      script: "webhook_engine.py",
      interpreter: "python",
      cwd: "F:\\AI-Trading-Agent",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      env: {
        PYTHONUNBUFFERED: "1"
      },
      error_file: "F:\\AI-Trading-Agent\\logs\\pm2_error.log",
      out_file: "F:\\AI-Trading-Agent\\logs\\pm2_out.log",
      time: true
    }
  ]
};
