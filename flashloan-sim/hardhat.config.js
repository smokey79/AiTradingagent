// hardhat.config.js — Stage 1 flash-loan simulator. The "hardhat" network is a local COPY of Arbitrum
// (mainnet fork): real pools and prices, fake ETH, nothing is ever broadcast. No private keys configured.
require('@nomicfoundation/hardhat-ethers');
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });

module.exports = {
  solidity: { version: '0.8.24', settings: { optimizer: { enabled: true, runs: 200 } } },
  networks: {
    hardhat: {
      chainId: 42161,
      forking: { url: process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc' },
    },
  },
};
