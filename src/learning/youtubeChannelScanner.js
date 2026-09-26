/**
 * YouTube Channel Alpha Scanner & Automated Continuous Learning Engine
 * =====================================================================
 * Monitors curated, high-credibility crypto alpha channels via public RSS feeds,
 * discovers new video releases, and passes them through the RAU Quality Gate (>= 0.35)
 * into learning_memory.json to drive live agent consensus sentiment.
 */

'use strict';

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const { learnFromYouTubeUrl } = require('./youtubeLearner');

const DATA_DIR = path.resolve(__dirname, '../../data');
const CHANNEL_STATE_PATH = path.join(DATA_DIR, 'youtube_channel_state.json');

// Curated Registry of Institutional & High-Alpha Crypto YouTube Channels
const CURATED_CHANNELS = [
  {
    id: 'UCqK_GSMbpiV8spgD3ZGloSw', // Coin Bureau
    name: 'Coin Bureau',
    tag: 'macro_defi',
    weight: 0.95,
    focus: 'Fundamentals, Layer-1/2 ecosystems, Regulatory analysis',
  },
  {
    id: 'UCRvqjQPSeaWn-uEx-w0XOIg', // Benjamin Cowen (Into The Cryptoverse)
    name: 'Benjamin Cowen',
    tag: 'quantitative_macro',
    weight: 0.92,
    focus: 'Risk metrics, logarithmic regression, cycle peaks & troughs',
  },
  {
    id: 'UCN9Nj4TJGsyQITifgLSj0wg', // Crypto Banter
    name: 'Crypto Banter',
    tag: 'altcoin_momentum',
    weight: 0.85,
    focus: 'DeFi rotations, on-chain narratives, momentum breakout plays',
  },
  {
    id: 'UCxvlhG1X9cO5jA_L1x3dJ2Q', // Miles Deutscher
    name: 'Miles Deutscher',
    tag: 'defi_narratives',
    weight: 0.88,
    focus: 'DeFi yield protocols, Base/Arbitrum ecosystem, tokenomics',
  },
  {
    id: 'UC0rxGgGqgI8YnFzF1N5v_bg', // Michael van de Poppe
    name: 'Michael van de Poppe',
    tag: 'technical_analysis',
    weight: 0.86,
    focus: 'Support/resistance flips, 50-EMA tests, altcoin swing setups',
  },
  {
    id: 'UCbLhGKVY-bLCEttAMET365A', // Altcoin Daily
    name: 'Altcoin Daily',
    tag: 'market_news',
    weight: 0.80,
    focus: 'Industry developments, institutional inflows, spot ETF volume',
  },
];

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readChannelState() {
  ensureDataDir();
  try {
    if (fs.existsSync(CHANNEL_STATE_PATH)) {
      return JSON.parse(fs.readFileSync(CHANNEL_STATE_PATH, 'utf8'));
    }
  } catch (_) {}
  return { lastScanTime: null, scannedVideos: {}, channelMeta: {} };
}

function saveChannelState(state) {
  ensureDataDir();
  fs.writeFileSync(CHANNEL_STATE_PATH, JSON.stringify(state, null, 2));
}

/**
 * Parses simple YouTube XML RSS feed without heavy dependencies.
 */
function parseYouTubeXmlFeed(xmlText) {
  const entries = [];
  const entryMatches = xmlText.match(/<entry[\s\S]*?<\/entry>/g) || [];

  for (const entryXml of entryMatches) {
    const idMatch = entryXml.match(/<yt:videoId>(.*?)<\/yt:videoId>/);
    const titleMatch = entryXml.match(/<title>(.*?)<\/title>/);
    const pubMatch = entryXml.match(/<published>(.*?)<\/published>/);
    const authorMatch = entryXml.match(/<author>[\s\S]*?<name>(.*?)<\/name>/);

    if (idMatch && idMatch[1]) {
      entries.push({
        videoId: idMatch[1].trim(),
        title: titleMatch ? titleMatch[1].replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1').trim() : '',
        published: pubMatch ? pubMatch[1].trim() : new Date().toISOString(),
        author: authorMatch ? authorMatch[1].trim() : '',
        url: `https://www.youtube.com/watch?v=${idMatch[1].trim()}`,
      });
    }
  }
  return entries;
}

/**
 * Scans a specific YouTube channel for newly published videos.
 *
 * @param {object} channel - { id, name, tag, weight }
 * @param {number} limit - Maximum recent videos to evaluate
 * @returns {Array} List of processed insights
 */
async function scanChannel(channel, limit = 2) {
  const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channel.id}`;
  const state = readChannelState();
  const processed = [];

  logger.info(`[YouTubeScanner] Checking channel: ${channel.name} (${channel.id})`);

  try {
    const res = await axios.get(feedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)',
        'Accept': 'application/xml,text/xml,*/*',
      },
      timeout: 8000,
    });

    const videos = parseYouTubeXmlFeed(res.data).slice(0, limit);

    for (const v of videos) {
      if (state.scannedVideos[v.videoId]) {
        continue; // Already processed
      }

      logger.info(`[YouTubeScanner] Ingesting new video from ${channel.name}: "${v.title}"`);
      const insight = await learnFromYouTubeUrl(v.url, channel.name, channel.tag, channel.id);

      state.scannedVideos[v.videoId] = {
        title: v.title,
        channelId: channel.id,
        channelName: channel.name,
        published: v.published,
        scannedAt: new Date().toISOString(),
        accepted: !insight.rejected,
        rau: insight.rau?.score || 0,
        signal: insight.signal || 'HOLD',
      };

      processed.push(insight);
    }
  } catch (err) {
    logger.warn(`[YouTubeScanner] Feed fetch failed for ${channel.name}: ${err.message}`);
  }

  saveChannelState(state);
  return processed;
}

/**
 * Scans all curated crypto YouTube alpha channels.
 *
 * @param {object} options - { limitPerChannel = 2, minRau = 0.35 }
 * @returns {object} Scan summary
 */
async function scanAllChannels(options = {}) {
  const limitPerChannel = options.limitPerChannel || 2;
  const startTime = Date.now();
  const allInsights = [];
  let acceptedCount = 0;
  let rejectedCount = 0;

  logger.info(`[YouTubeScanner] 🎬 Starting automated multi-channel alpha sweep across ${CURATED_CHANNELS.length} channels...`);

  for (const channel of CURATED_CHANNELS) {
    try {
      const insights = await scanChannel(channel, limitPerChannel);
      for (const ins of insights) {
        allInsights.push(ins);
        if (ins.rejected) rejectedCount++;
        else acceptedCount++;
      }
      // Modest pause between feeds to avoid network bursts
      await new Promise(r => setTimeout(r, 400));
    } catch (e) {
      logger.error(`[YouTubeScanner] Channel scan error on ${channel.name}: ${e.message}`);
    }
  }

  const state = readChannelState();
  state.lastScanTime = new Date().toISOString();
  saveChannelState(state);

  const durationMs = Date.now() - startTime;
  logger.info(
    `[YouTubeScanner] ✅ Alpha sweep complete: ${allInsights.length} evaluated, ` +
    `${acceptedCount} accepted (RAU>=0.35), ${rejectedCount} rejected (${durationMs}ms)`
  );

  return {
    success: true,
    channelsScanned: CURATED_CHANNELS.length,
    totalEvaluated: allInsights.length,
    accepted: acceptedCount,
    rejected: rejectedCount,
    durationMs,
    insights: allInsights,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Returns tracked channel registry with status and weights.
 */
function getTrackedChannels() {
  const state = readChannelState();
  return CURATED_CHANNELS.map(ch => ({
    ...ch,
    scannedVideosCount: Object.values(state.scannedVideos || {}).filter(v => v.channelId === ch.id).length,
    lastScanned: state.lastScanTime,
  }));
}

module.exports = {
  CURATED_CHANNELS,
  scanChannel,
  scanAllChannels,
  getTrackedChannels,
  parseYouTubeXmlFeed,
};
