const { executeTrade } = require("./tradeExecutor.js");
const { BitgetExecutor } = require("./bitgetExecutor.js");
const { CryptoComExecutor } = require("./cryptoComExecutor.js");

module.exports = {
  executeTrade,
  BitgetExecutor,
  CryptoComExecutor,
};
