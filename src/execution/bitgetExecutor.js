const axios = require("axios");
const crypto = require("crypto");
const logger = require("../utils/logger.js");

const BASE_URL = "https://api.bitget.com";

/**
 * Minimal Bitget spot order executor. Signing per Bitget's HMAC-SHA256 spec.
 * Only fires real orders when process.env.TRADING_MODE === "live" and NO_TRADES !== "true".
 */
class BitgetExecutor {
  constructor() {
    this.apiKey = process.env.BITGET_API_KEY;
    this.apiSecret = process.env.BITGET_API_SECRET;
    this.passphrase = process.env.BITGET_API_PASSPHRASE;
  }

  #sign(timestamp, method, requestPath, body = "") {
    const message = timestamp + method + requestPath + body;
    return crypto.createHmac("sha256", this.apiSecret).update(message).digest("base64");
  }

  async placeOrder({ symbol, side, size, orderType = "market" }) {
    const isLive = process.env.TRADING_MODE === "live" && process.env.NO_TRADES !== "true";
    if (!isLive) {
      logger.info("[PAPER MODE] Simulated Bitget order", { symbol, side, size, orderType });
      return { simulated: true, symbol, side, size, orderType };
    }

    const requestPath = "/api/v2/spot/trade/place-order";
    const timestamp = Date.now().toString();
    const body = JSON.stringify({ symbol, side, orderType, size, force: "gtc" });
    const sign = this.#sign(timestamp, "POST", requestPath, body);

    try {
      const { data } = await axios.post(`${BASE_URL}${requestPath}`, body, {
        headers: {
          "ACCESS-KEY": this.apiKey,
          "ACCESS-SIGN": sign,
          "ACCESS-TIMESTAMP": timestamp,
          "ACCESS-PASSPHRASE": this.passphrase,
          "Content-Type": "application/json",
        },
      });
      logger.info("Bitget live order placed", { symbol, side, size });
      return data;
    } catch (err) {
      logger.error("Bitget order failed", { error: err.message });
      throw err;
    }
  }
}

module.exports = { BitgetExecutor };
