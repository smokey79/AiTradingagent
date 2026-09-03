/**
 * Orchestrator Root Entrypoint Bridge (CommonJS)
 * Proxies to src/orchestrator/index.js
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

console.log("Orchestrator Node Service Initialized (CommonJS)");

module.exports = require('../src/orchestrator/index.js');
