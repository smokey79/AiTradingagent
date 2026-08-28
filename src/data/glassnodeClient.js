import axios from "axios";
import { logger } from "../utils/logger.js";

const BASE_URL = "https://api.glassnode.com/v1/metrics";

/**
 * Thin wrapper around the Glassnode API for the on-chain features
 * referenced across the strategy: SOPR, MVRV, peer-rotation signals.
 * Requires GLASSNODE_API_KEY in .env.
 */
export class GlassnodeClient {
  constructor(apiKey = process.env.GLASSNODE_API_KEY) {
    if (!apiKey) {
      throw new Error("GLASSNODE_API_KEY missing from environment");
    }
    this.apiKey = apiKey;
  }

  async #get(path, params = {}) {
    try {
      const { data } = await axios.get(`${BASE_URL}${path}`, {
        params: { ...params, api_key: this.apiKey },
      });
      return data;
    } catch (err) {
      logger.error("Glassnode request failed", { path, error: err.message });
      throw err;
    }
  }

  /** Spent Output Profit Ratio — used as a market-cycle top/bottom signal. */
  getSOPR(asset = "BTC", since) {
    return this.#get("/indicators/sopr", { a: asset, s: since });
  }

  /** Market Value to Realized Value — overvaluation/undervaluation signal. */
  getMVRV(asset = "BTC", since) {
    return this.#get("/market/mvrv", { a: asset, s: since });
  }

  /** Generic passthrough for any Glassnode endpoint not wrapped above. */
  getMetric(endpointPath, asset, params = {}) {
    return this.#get(endpointPath, { a: asset, ...params });
  }
}
