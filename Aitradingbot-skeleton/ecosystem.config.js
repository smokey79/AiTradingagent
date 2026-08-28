module.exports = {
  apps: [
    {
      name: 'trading-dashboard',
      script: 'src/dashboard/server.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        DASHBOARD_PORT: process.env.DASHBOARD_PORT || 3002,
      },
    },
    {
      name: 'trading-orchestrator',
      script: 'src/orchestrator/index.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        PAPER_TRADING: 'true',
      },
    },
  ],
};
