const axios = require("axios");
const logger = require("../utils/logger.js");

const SEARCH_URL = "https://api.x.com/2/tweets/search/recent";

/**
 * Pulls recent posts mentioning a given asset/ticker via the X API v2
 * recent-search endpoint, then scores sentiment locally with Hermes.
 * Requires X_BEARER_TOKEN in .env (X Developer Portal, Elevated/Basic tier).
 */
class XSentimentAgent {
  async fetchRecentPosts(query, maxResults = 25) {
    try {
      const { data } = await axios.get(SEARCH_URL, {
        headers: { Authorization: `Bearer ${process.env.X_BEARER_TOKEN}` },
        params: {
          query: `${query} -is:retweet lang:en`,
          max_results: Math.min(maxResults, 100),
          "tweet.fields": "created_at,public_metrics",
        },
      });
      return data.data || [];
    } catch (err) {
      logger.error("X search failed", { error: err.message });
      return [];
    }
  }

  async scoreSentiment(posts, asset) {
    if (!posts.length) return { asset, sentiment: "neutral", confidence: 0 };
    const host = process.env.OLLAMA_HOST || "http://localhost:11434";
    const model = process.env.HERMES_MODEL_NAME || "hermes3";
    const combinedText = posts.map((p) => p.text).join("\n---\n").slice(0, 4000);
    const prompt = `Score the aggregate crypto-market sentiment of these X posts about
${asset} as JSON: {"asset": "${asset}", "sentiment": "bullish"|"bearish"|"neutral",
"confidence": 0.0-1.0}. Posts:\n${combinedText}`;

    try {
      const { data } = await axios.post(`${host}/api/generate`, {
        model,
        prompt,
        stream: false,
        format: "json",
      });
      return JSON.parse(data.response);
    } catch (err) {
      logger.error("X sentiment scoring failed", { error: err.message });
      return { asset, sentiment: "neutral", confidence: 0 };
    }
  }

  async run(asset = "BTC") {
    const posts = await this.fetchRecentPosts(`$${asset} OR #${asset}`);
    return this.scoreSentiment(posts, asset);
  }
}

module.exports = { XSentimentAgent };
