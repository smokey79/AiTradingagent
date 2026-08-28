import { google } from "googleapis";
import axios from "axios";
import fs from "fs";
import path from "path";
import { logger } from "../utils/logger.js";

const CREDIBILITY_FILE = path.resolve("src/sentiment/channel_credibility.json");

/**
 * Pulls recent uploads from the channels Alan is actually subscribed to
 * (via OAuth), scores each video's transcript/description sentiment with
 * a local Hermes/Ollama model, and maintains a self-learning credibility
 * weight per channel — channels whose past calls correlated with price
 * moves get weighted up over time.
 *
 * Requires YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET / YOUTUBE_REFRESH_TOKEN.
 * Run setup-youtube-auth.js once to generate the refresh token.
 */
export class YoutubeSentimentAgent {
  constructor() {
    this.oauth2Client = new google.auth.OAuth2(
      process.env.YOUTUBE_CLIENT_ID,
      process.env.YOUTUBE_CLIENT_SECRET
    );
    this.oauth2Client.setCredentials({
      refresh_token: process.env.YOUTUBE_REFRESH_TOKEN,
    });
    this.youtube = google.youtube({ version: "v3", auth: this.oauth2Client });
    this.credibility = this.#loadCredibility();
  }

  #loadCredibility() {
    try {
      return JSON.parse(fs.readFileSync(CREDIBILITY_FILE, "utf-8"));
    } catch {
      return {}; // no history yet — starts neutral (weight 1.0 per channel)
    }
  }

  #saveCredibility() {
    fs.writeFileSync(CREDIBILITY_FILE, JSON.stringify(this.credibility, null, 2));
  }

  /** Get the channels Alan is subscribed to on the authenticated account. */
  async getSubscriptions() {
    const { data } = await this.youtube.subscriptions.list({
      part: "snippet",
      mine: true,
      maxResults: 50,
    });
    return data.items.map((i) => ({
      channelId: i.snippet.resourceId.channelId,
      title: i.snippet.title,
    }));
  }

  /** Recent uploads for a channel, last 48h. */
  async getRecentUploads(channelId) {
    const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const { data } = await this.youtube.search.list({
      part: "snippet",
      channelId,
      order: "date",
      publishedAfter: since,
      maxResults: 5,
      type: "video",
    });
    return data.items;
  }

  /** Score a video's title+description with local Hermes for sentiment. */
  async scoreSentiment(video) {
    const host = process.env.OLLAMA_HOST || "http://localhost:11434";
    const model = process.env.HERMES_MODEL_NAME || "hermes3";
    const text = `${video.snippet.title}. ${video.snippet.description}`;
    const prompt = `Score the crypto-market sentiment of this YouTube video as JSON:
{"asset": "BTC|ETH|...|general", "sentiment": "bullish"|"bearish"|"neutral",
"confidence": 0.0-1.0}. Content: ${text}`;

    try {
      const { data } = await axios.post(`${host}/api/generate`, {
        model,
        prompt,
        stream: false,
        format: "json",
      });
      return JSON.parse(data.response);
    } catch (err) {
      logger.error("YouTube sentiment scoring failed", { error: err.message });
      return { asset: "general", sentiment: "neutral", confidence: 0 };
    }
  }

  /** Update a channel's credibility weight after a trade outcome is known. */
  updateCredibility(channelId, wasCorrect) {
    const current = this.credibility[channelId] ?? 1.0;
    // simple exponential nudge, bounded [0.2, 2.0]
    const delta = wasCorrect ? 0.05 : -0.05;
    this.credibility[channelId] = Math.min(2.0, Math.max(0.2, current + delta));
    this.#saveCredibility();
  }

  /** Full pass: subscriptions -> recent uploads -> weighted sentiment score. */
  async run() {
    const channels = await this.getSubscriptions();
    const results = [];
    for (const channel of channels) {
      const uploads = await this.getRecentUploads(channel.channelId);
      for (const video of uploads) {
        const sentiment = await this.scoreSentiment(video);
        const weight = this.credibility[channel.channelId] ?? 1.0;
        results.push({ channel: channel.title, ...sentiment, weight });
      }
    }
    return results;
  }
}
