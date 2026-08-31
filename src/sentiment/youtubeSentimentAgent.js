import { google } from "googleapis";
import axios from "axios";
import fs from "fs";
import path from "path";
import { logger } from "../utils/logger.js";
import { scoreRAU, channelRelevanceAvg } from "../learning/rauScorer.js";

const CREDIBILITY_FILE   = path.resolve("src/sentiment/channel_credibility.json");
const MIN_CHANNEL_RELEVANCE = 0.30; // Skip channels whose recent videos avg below this

/**
 * YoutubeSentimentAgent — Enhanced v2
 * ====================================
 * Uses Alan's YouTube OAuth subscription list to pull recent uploads,
 * scores sentiment via local Hermes/Ollama (no API cost),
 * and maintains a self-learning credibility weight per channel.
 *
 * Self-learning loop:
 *   - Each channel starts at weight 1.0
 *   - After each closed trade, call updateCredibility(channelId, wasCorrect)
 *   - Channels whose calls match trade outcomes get weighted UP (+0.05)
 *   - Wrong channels get weighted DOWN (-0.05), bounded [0.2, 2.0]
 *   - Weights are persisted in channel_credibility.json
 *
 * Requires in master.env:
 *   YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN
 *   OLLAMA_HOST, HERMES_MODEL_NAME
 *
 * Run setup-youtube-auth.js once to generate YOUTUBE_REFRESH_TOKEN.
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

    // Our 7 target tokens for symbol detection
    this.TARGET_SYMBOLS = ["BTC", "ETH", "CRO", "SOL", "AVAX", "ARB", "OP"];

    // Fallback keyword scoring (used when Hermes is offline)
    this.BULLISH_KW = [
      "moon","bull","breakout","accumulate","buy","surge","rally","ath",
      "pump","uptrend","golden cross","undervalued","institutional","inflow","long",
    ];
    this.BEARISH_KW = [
      "crash","bear","dump","sell","panic","collapse","liquidation","atl",
      "downtrend","death cross","overvalued","ban","hack","outflow","short",
    ];
  }

  // ── Credibility persistence ─────────────────────────────────────────────

  #loadCredibility() {
    try {
      return JSON.parse(fs.readFileSync(CREDIBILITY_FILE, "utf-8"));
    } catch {
      return {};
    }
  }

  #saveCredibility() {
    fs.writeFileSync(CREDIBILITY_FILE, JSON.stringify(this.credibility, null, 2));
  }

  // ── YouTube API calls ───────────────────────────────────────────────────

  /** Get channels Alan is subscribed to on the authenticated account. */
  async getSubscriptions() {
    try {
      const { data } = await this.youtube.subscriptions.list({
        part: "snippet",
        mine: true,
        maxResults: 50,
      });
      return data.items.map((i) => ({
        channelId: i.snippet.resourceId.channelId,
        title: i.snippet.title,
      }));
    } catch (err) {
      logger.error("YouTube subscriptions fetch failed", { error: err.message });
      return [];
    }
  }

  /** Recent uploads for a channel, last 48 hours. */
  async getRecentUploads(channelId) {
    const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    try {
      const { data } = await this.youtube.search.list({
        part: "snippet",
        channelId,
        order: "date",
        publishedAfter: since,
        maxResults: 5,
        type: "video",
      });
      return data.items || [];
    } catch (err) {
      logger.warn(`YouTube upload fetch failed for ${channelId}`, { error: err.message });
      return [];
    }
  }

  // ── Sentiment scoring ───────────────────────────────────────────────────

  /**
   * Score a video using local Hermes/Ollama (free, no API cost).
   * Falls back to keyword scoring if Hermes is offline.
   */
  async scoreSentiment(video) {
    const title = video.snippet?.title || "";
    const desc  = (video.snippet?.description || "").slice(0, 500);
    const text  = `${title}. ${desc}`;

    // Detect which of our 7 tokens are mentioned
    const detectedSymbols = this.TARGET_SYMBOLS.filter(sym =>
      text.toUpperCase().includes(sym)
    );

    // Try Hermes first
    try {
      const host  = process.env.OLLAMA_HOST  || "http://localhost:11434";
      const model = process.env.HERMES_MODEL_NAME || "hermes3";

      const prompt = `You are a crypto trading sentiment analyser. 
Analyse this YouTube video title and description and return ONLY valid JSON.
Detected tokens: ${detectedSymbols.join(", ") || "general crypto"}.

Return format:
{"asset": "BTC|ETH|CRO|SOL|AVAX|ARB|OP|general", "sentiment": "bullish|bearish|neutral", "confidence": 0.0-1.0, "reason": "one sentence"}

Content: ${text}`;

      const { data } = await axios.post(`${host}/api/generate`, {
        model,
        prompt,
        stream: false,
        format: "json",
      }, { timeout: 8000 });

      const parsed = JSON.parse(data.response);
      return {
        ...parsed,
        detectedSymbols,
        scoredBy: "hermes",
      };
    } catch (err) {
      // Hermes offline — fall back to keyword scoring
      logger.warn("Hermes offline, using keyword fallback for sentiment");
      return this.#keywordScore(text, detectedSymbols);
    }
  }

  /** Keyword-based fallback sentiment (no AI needed). */
  #keywordScore(text, detectedSymbols) {
    const lower    = text.toLowerCase();
    const bullHits = this.BULLISH_KW.filter(kw => lower.includes(kw)).length;
    const bearHits = this.BEARISH_KW.filter(kw => lower.includes(kw)).length;
    const total    = bullHits + bearHits || 1;
    const score    = (bullHits - bearHits) / total;

    return {
      asset:           detectedSymbols[0] || "general",
      sentiment:       score > 0.1 ? "bullish" : score < -0.1 ? "bearish" : "neutral",
      confidence:      Math.min(Math.abs(score) * 1.5, 0.85),
      reason:          `Keyword analysis: ${bullHits} bullish, ${bearHits} bearish signals`,
      detectedSymbols,
      scoredBy:        "keywords",
    };
  }

  // ── Self-learning credibility ───────────────────────────────────────────

  /**
   * Update a channel's credibility weight after a trade outcome is known.
   * Call this from strategy_learner.js when a trade closes.
   *
   * @param {string}  channelId   - YouTube channel ID
   * @param {boolean} wasCorrect  - true if channel's signal matched trade outcome
   */
  updateCredibility(channelId, wasCorrect) {
    const current = this.credibility[channelId]?.weight ?? 1.0;
    const delta   = wasCorrect ? 0.05 : -0.05;
    const newWeight = Math.min(2.0, Math.max(0.2, current + delta));

    this.credibility[channelId] = {
      weight:      newWeight,
      correct:     (this.credibility[channelId]?.correct || 0) + (wasCorrect ? 1 : 0),
      total:       (this.credibility[channelId]?.total   || 0) + 1,
      lastUpdated: new Date().toISOString(),
    };

    this.#saveCredibility();
    logger.info(`Credibility updated: ${channelId} → weight ${newWeight.toFixed(3)}`);
    return newWeight;
  }

  // ── Main run method ─────────────────────────────────────────────────────

  /**
   * Full pass: subscriptions → recent uploads → weighted sentiment scores.
   * Returns structured signal ready for the consensus engine.
   */
  async run() {
    logger.info("YouTubeSentimentAgent: starting scan with RAU-weighted filtering...");
    const allChannels = await this.getSubscriptions();

    if (allChannels.length === 0) {
      logger.warn("No YouTube subscriptions found — check OAuth credentials in master.env");
      return this.#emptyResult();
    }

    // ── Step 1: Filter out non-trading channels ────────────────────────────
    const tradingChannels = [];
    const skippedChannels = [];

    for (const channel of allChannels) {
      const uploads     = await this.getRecentUploads(channel.channelId);
      const recentTitles = uploads.map(v => v.snippet?.title || "");
      const avgRelevance = channelRelevanceAvg(recentTitles, channel.tag || "");

      if (avgRelevance >= MIN_CHANNEL_RELEVANCE) {
        tradingChannels.push({ ...channel, uploads, avgRelevance });
      } else {
        skippedChannels.push(channel.title);
      }
    }

    if (skippedChannels.length) {
      logger.info(`[YouTube] Skipped ${skippedChannels.length} non-trading channels: ${skippedChannels.slice(0,5).join(', ')}...`);
    }
    logger.info(`[YouTube] Scanning ${tradingChannels.length}/${allChannels.length} relevant channels`);

    // ── Step 2: Score each video with RAU + credibility composite weight ───
    const rawResults = [];
    for (const channel of tradingChannels) {
      for (const video of channel.uploads) {
        const title       = video.snippet?.title       || "";
        const description = (video.snippet?.description || "").slice(0, 500);
        const credRecord  = this.credibility[channel.channelId] || {};

        // RAU score for this specific video
        const rauResult = scoreRAU({
          title,
          description,
          channelTag:  channel.tag || "",
          credibility: credRecord,
        });

        // Skip videos that don't pass the RAU gate
        if (!rauResult.accept) {
          logger.debug(`[YouTube] RAU REJECT (${rauResult.rau.toFixed(3)}): "${title}"`);
          continue;
        }

        const sentiment   = await this.scoreSentiment(video);
        const credWeight  = credRecord.weight ?? 1.0;

        // Composite weight = RAU score × channel credibility weight
        const compositeWeight = parseFloat((rauResult.rau * credWeight).toFixed(4));

        rawResults.push({
          channelId:        channel.channelId,
          channelTitle:     channel.title,
          videoTitle:       title,
          published:        video.snippet?.publishedAt || "",
          credWeight,
          rauScore:         rauResult.rau,
          rauTier:          rauResult.tier,
          compositeWeight,
          ...sentiment,
          // RAU-adjusted confidence replaces raw sentiment confidence
          weightedConfidence: sentiment.confidence * compositeWeight,
        });
      }
    }

    // ── Step 3: Aggregate ─────────────────────────────────────────────────
    const symbolSignals = this.#aggregateBySymbol(rawResults);
    const overall       = this.#overallSignal(rawResults);
    const highTierCount = rawResults.filter(r => r.rauTier === 'HIGH').length;

    logger.info(
      `[YouTube] Scan complete. ${rawResults.length} videos passed RAU gate from ` +
      `${tradingChannels.length} channels. HIGH-tier: ${highTierCount}. ` +
      `Overall: ${overall.sentiment.toUpperCase()} (conf=${overall.confidence.toFixed(3)})`
    );

    return {
      signal:           overall.sentiment,
      confidence:       overall.confidence,
      reason:           overall.reason,
      symbolSignals,
      rawResults,
      videosAnalysed:   rawResults.length,
      channelsChecked:  tradingChannels.length,
      channelsSkipped:  skippedChannels.length,
      highTierVideos:   highTierCount,
      timestamp:        new Date().toISOString(),
      agentOutput: {
        signal:     overall.sentiment === "bullish" ? "BUY" : overall.sentiment === "bearish" ? "SELL" : "HOLD",
        confidence: overall.confidence,
        reason:     `RAU-weighted YouTube (${rawResults.length} videos, ${tradingChannels.length} channels, ${highTierCount} HIGH-tier): ${overall.reason}`,
        constraints: {},
      },
    };
  }

  #aggregateBySymbol(results) {
    const bySymbol = {};
    for (const r of results) {
      const syms = r.detectedSymbols?.length ? r.detectedSymbols : ["general"];
      for (const sym of syms) {
        if (!bySymbol[sym]) bySymbol[sym] = { scores: [], weights: [], videos: [] };
        // Use compositeWeight (RAU × credibility) as the weighting factor
        const w     = r.compositeWeight ?? r.weightedConfidence ?? 1.0;
        const score = r.sentiment === "bullish" ?  r.weightedConfidence
                    : r.sentiment === "bearish" ? -r.weightedConfidence : 0;
        bySymbol[sym].scores.push(score);
        bySymbol[sym].weights.push(w);
        bySymbol[sym].videos.push(`[${r.rauTier||'?'}] ${r.videoTitle}`);
      }
    }
    const out = {};
    for (const [sym, data] of Object.entries(bySymbol)) {
      // Weighted average using compositeWeight
      const totalW = data.weights.reduce((a, b) => a + b, 0) || 1;
      const wavg   = data.scores.reduce((s, sc, i) => s + sc * data.weights[i], 0) / totalW;
      out[sym] = {
        signal:     wavg > 0.05 ? "bullish" : wavg < -0.05 ? "bearish" : "neutral",
        avgScore:   parseFloat(wavg.toFixed(3)),
        videoCount: data.scores.length,
        topVideos:  data.videos.slice(0, 3),
      };
    }
    return out;
  }

  #overallSignal(results) {
    if (!results.length) return { sentiment: "neutral", confidence: 0, reason: "no videos" };
    const scores = results.map(r =>
      (r.sentiment === "bullish" ? 1 : r.sentiment === "bearish" ? -1 : 0) * r.weightedConfidence
    );
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    return {
      sentiment:  avg > 0.05 ? "bullish" : avg < -0.05 ? "bearish" : "neutral",
      confidence: Math.min(Math.abs(avg) * 1.5, 0.95),
      reason:     `Weighted average across ${results.length} videos: score ${avg.toFixed(3)}`,
    };
  }

  #emptyResult() {
    return {
      signal: "neutral", confidence: 0,
      reason: "No YouTube data — check YOUTUBE_CLIENT_ID/SECRET/REFRESH_TOKEN in master.env",
      symbolSignals: {}, rawResults: [], videosAnalysed: 0, channelsChecked: 0,
      timestamp: new Date().toISOString(),
      agentOutput: { signal: "HOLD", confidence: 0, reason: "YouTube agent: no data", constraints: {} },
    };
  }
}
