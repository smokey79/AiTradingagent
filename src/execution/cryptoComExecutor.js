const axios = require("axios");
const crypto = require("crypto");
const logger = require("../utils/logger.js");

const BASE_URL = "https://api.crypto.com/exchange/v1";

/** Minimal Crypto.com Exchange order executor (HMAC-SHA256 signed). */
class CryptoComExecutor {
  constructor() {
    this.apiKey = process.env.CRYPTOCOM_API_KEY;
    this.apiSecret = process.env.CRYPTOCOM_API_SECRET;
  }

  #sign(params) {
    const paramString = Object.keys(params)
      .sort()
      .map((k) => `${k}${params[k]}`)
      .join("");
    return crypto.createHmac("sha256", this.apiSecret).update(paramString).digest("hex");
  }

  async placeOrder({ symbol, side, quantity }) {
    const isLive = process.env.TRADING_MODE === "live" && process.env.NO_TRADES !== "true";
    if (!isLive) {
      logger.info("[PAPER MODE] Simulated Crypto.com order", { symbol, side, quantity });
      return { simulated: true, symbol, side, quantity };
    }

    const params = {
      instrument_name: symbol,
      side: side.toUpperCase(),
      type: "MARKET",
      quantity,
      nonce: Date.now(),
    };
    const sig = this.#sign(params);

    try {
      const { data } = await axios.post(`${BASE_URL}/private/create-order`, {
        ...params,
        api_key: this.apiKey,
        sig,
      });
      logger.info("Crypto.com live order placed", { symbol, side, quantity });
      return data;
    } catch (err) {
      logger.error("Crypto.com order failed", { error: err.message });
      throw err;
    }
  }
}

module.exports = { CryptoComExecutor };
