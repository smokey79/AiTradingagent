const axios = require("axios");
const logger = require("../utils/logger.js");

const BASE_URL = "https://pro-api.coinmarketcap.com/v1";

class CoinMarketCapClient {
  constructor(apiKey = process.env.COINMARKETCAP_API_KEY) {
    if (!apiKey) {
      throw new Error("COINMARKETCAP_API_KEY missing from environment");
    }
    this.apiKey = apiKey;
  }

  async getQuotes(symbols = ["BTC", "ETH", "CRO", "SOL", "AVAX", "ARB", "OP"]) {
    try {
      const { data } = await axios.get(`${BASE_URL}/cryptocurrency/quotes/latest`, {
        headers: { "X-CMC_PRO_API_KEY": this.apiKey },
        params: { symbol: symbols.join(",") },
      });
      return data.data;
    } catch (err) {
      logger.error("CoinMarketCap request failed", { error: err.message });
      throw err;
    }
  }
}

module.exports = { CoinMarketCapClient };
