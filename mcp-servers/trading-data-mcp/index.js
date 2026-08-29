/**
 * MCP Trading Data Server
 * ========================
 * Provides live market data as MCP tools to all AiTradingAgent AI agents.
 *
 * Tools exposed:
 *   get_ohlcv          - Candle data from exchange via CCXT
 *   get_indicators     - RSI, MACD, BB, EMA calculated from candles
 *   get_fear_greed     - Crypto Fear & Greed Index
 *   get_funding_rates  - Funding rates across exchanges
 *   get_orderbook      - Top-of-book bid/ask spread
 *   get_cmc_data       - CoinMarketCap price + market cap data
 *   get_coingecko_data - CoinGecko fundamentals + community data
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import axios from "axios";
import * as ccxt from "ccxt";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const CMC_API_KEY = process.env.CMC_API_KEY;
const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY || "";

// ─── Server Setup ──────────────────────────────────────────────────────────────
const server = new McpServer({
  name: "trading-data-server",
  version: "1.0.0",
});

// ─── Helper: Simple RSI calculation ────────────────────────────────────────────
function calculateRSI(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff >= 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return parseFloat((100 - 100 / (1 + rs)).toFixed(2));
}

// ─── Helper: EMA calculation ───────────────────────────────────────────────────
function calculateEMA(closes, period) {
  if (closes.length < period) return null;
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
  }
  return parseFloat(ema.toFixed(2));
}

// ─── TOOL: get_ohlcv ──────────────────────────────────────────────────────────
server.tool(
  "get_ohlcv",
  "Fetch OHLCV candle data for a trading pair from Binance via CCXT",
  {
    symbol: z.string().describe("Trading pair e.g. BTC/USDT"),
    timeframe: z.enum(["1m", "5m", "15m", "1h", "4h", "1d"]).describe("Candle timeframe"),
    limit: z.number().default(100).describe("Number of candles (max 500)"),
  },
  async ({ symbol, timeframe, limit }) => {
    try {
      const exchange = new ccxt.binance({ enableRateLimit: true });
      const ohlcv = await exchange.fetchOHLCV(symbol, timeframe, undefined, Math.min(limit, 500));
      const formatted = ohlcv.map(([ts, o, h, l, c, v]) => ({
        timestamp: new Date(ts).toISOString(),
        open: o, high: h, low: l, close: c, volume: v,
      }));
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            symbol, timeframe, candles: formatted,
            latest_price: formatted[formatted.length - 1]?.close,
            fetched_at: new Date().toISOString(),
          }),
        }],
      };
    } catch (err) {
      return { content: [{ type: "text", text: JSON.stringify({ error: err.message }) }] };
    }
  }
);

// ─── TOOL: get_indicators ────────────────────────────────────────────────────
server.tool(
  "get_indicators",
  "Calculate RSI, EMA20/50/200, and MACD signal from recent candle data",
  {
    symbol: z.string().describe("Trading pair e.g. BTC/USDT"),
    timeframe: z.enum(["5m", "15m", "1h", "4h", "1d"]).describe("Candle timeframe"),
  },
  async ({ symbol, timeframe }) => {
    try {
      const exchange = new ccxt.binance({ enableRateLimit: true });
      const ohlcv = await exchange.fetchOHLCV(symbol, timeframe, undefined, 220);
      const closes = ohlcv.map(c => c[4]);
      const volumes = ohlcv.map(c => c[5]);

      const rsi14 = calculateRSI(closes, 14);
      const ema20 = calculateEMA(closes, 20);
      const ema50 = calculateEMA(closes, 50);
      const ema200 = calculateEMA(closes, 200);

      // Simple MACD (12,26,9)
      const ema12 = calculateEMA(closes, 12);
      const ema26 = calculateEMA(closes, 26);
      const macdLine = ema12 && ema26 ? parseFloat((ema12 - ema26).toFixed(2)) : null;

      const currentPrice = closes[closes.length - 1];
      const avgVolume20 = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
      const currentVolume = volumes[volumes.length - 1];
      const volumeRatio = parseFloat((currentVolume / avgVolume20).toFixed(2));

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            symbol, timeframe,
            current_price: parseFloat(currentPrice.toFixed(4)),
            indicators: {
              RSI_14: rsi14,
              EMA_20: ema20,
              EMA_50: ema50,
              EMA_200: ema200,
              MACD_line: macdLine,
              price_vs_EMA50: currentPrice > ema50 ? "above" : "below",
              price_vs_EMA200: currentPrice > ema200 ? "above" : "below",
              volume_ratio_vs_20avg: volumeRatio,
              volume_signal: volumeRatio > 1.5 ? "high_volume" : volumeRatio < 0.6 ? "low_volume" : "normal",
            },
            calculated_at: new Date().toISOString(),
          }),
        }],
      };
    } catch (err) {
      return { content: [{ type: "text", text: JSON.stringify({ error: err.message }) }] };
    }
  }
);

// ─── TOOL: get_fear_greed ────────────────────────────────────────────────────
server.tool(
  "get_fear_greed",
  "Get the current Crypto Fear and Greed Index value and classification",
  {},
  async () => {
    try {
      const res = await axios.get("https://api.alternative.me/fng/?limit=2");
      const data = res.data.data;
      const current = data[0];
      const previous = data[1];
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            current_value: parseInt(current.value),
            current_classification: current.value_classification,
            previous_value: parseInt(previous.value),
            previous_classification: previous.value_classification,
            trend: parseInt(current.value) > parseInt(previous.value) ? "rising" : "falling",
            trading_signal: parseInt(current.value) < 20 ? "extreme_fear_contrarian_buy"
              : parseInt(current.value) > 80 ? "extreme_greed_caution"
              : "neutral",
            fetched_at: new Date().toISOString(),
          }),
        }],
      };
    } catch (err) {
      return { content: [{ type: "text", text: JSON.stringify({ error: err.message }) }] };
    }
  }
);

// ─── TOOL: get_funding_rates ─────────────────────────────────────────────────
server.tool(
  "get_funding_rates",
  "Get current funding rates for a perpetual futures contract from Binance",
  {
    symbol: z.string().describe("Trading pair e.g. BTC/USDT"),
  },
  async ({ symbol }) => {
    try {
      const exchange = new ccxt.binance({
        options: { defaultType: "future" },
        enableRateLimit: true,
      });
      const fundingRate = await exchange.fetchFundingRate(symbol);
      const rate = fundingRate.fundingRate;
      const annualised = parseFloat((rate * 3 * 365 * 100).toFixed(2));

      let bias = "neutral";
      if (rate > 0.001) bias = "long_heavy";
      else if (rate < -0.0005) bias = "short_heavy";

      let signal = "neutral";
      if (rate > 0.001) signal = "longs_paying_premim_watch_for_flush";
      if (rate > 0.002) signal = "high_long_leverage_sell_consideration";
      if (rate < -0.0005) signal = "short_squeeze_potential_buy_consideration";

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            symbol,
            funding_rate: rate,
            funding_rate_pct: parseFloat((rate * 100).toFixed(4)),
            annualised_pct: annualised,
            next_funding_time: fundingRate.nextFundingDatetime,
            bias,
            trading_signal: signal,
            fetched_at: new Date().toISOString(),
          }),
        }],
      };
    } catch (err) {
      return { content: [{ type: "text", text: JSON.stringify({ error: err.message }) }] };
    }
  }
);

// ─── TOOL: get_orderbook ─────────────────────────────────────────────────────
server.tool(
  "get_orderbook",
  "Get top-of-book bid/ask and spread for a symbol to detect order book imbalance",
  {
    symbol: z.string().describe("Trading pair e.g. BTC/USDT"),
    depth: z.number().default(10).describe("Number of levels each side"),
  },
  async ({ symbol, depth }) => {
    try {
      const exchange = new ccxt.binance({ enableRateLimit: true });
      const ob = await exchange.fetchOrderBook(symbol, depth);
      const topBid = ob.bids[0][0];
      const topAsk = ob.asks[0][0];
      const spread = parseFloat((topAsk - topBid).toFixed(4));
      const spreadPct = parseFloat(((spread / topBid) * 100).toFixed(4));

      const bidVolume = ob.bids.slice(0, depth).reduce((s, [, v]) => s + v, 0);
      const askVolume = ob.asks.slice(0, depth).reduce((s, [, v]) => s + v, 0);
      const imbalanceRatio = parseFloat((bidVolume / (bidVolume + askVolume)).toFixed(3));

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            symbol,
            best_bid: topBid,
            best_ask: topAsk,
            spread,
            spread_pct: spreadPct,
            bid_volume_10levels: parseFloat(bidVolume.toFixed(4)),
            ask_volume_10levels: parseFloat(askVolume.toFixed(4)),
            imbalance_ratio: imbalanceRatio,
            imbalance_signal: imbalanceRatio > 0.6 ? "bid_heavy_bullish"
              : imbalanceRatio < 0.4 ? "ask_heavy_bearish" : "balanced",
            fetched_at: new Date().toISOString(),
          }),
        }],
      };
    } catch (err) {
      return { content: [{ type: "text", text: JSON.stringify({ error: err.message }) }] };
    }
  }
);

// ─── TOOL: get_cmc_data ──────────────────────────────────────────────────────
server.tool(
  "get_cmc_data",
  "Get CoinMarketCap price, market cap, volume, and rank for a coin",
  {
    symbol: z.string().describe("Coin symbol e.g. BTC, ETH, CRO"),
  },
  async ({ symbol }) => {
    try {
      if (!CMC_API_KEY) throw new Error("CMC_API_KEY not set in .env");
      const res = await axios.get(
        "https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest",
        {
          headers: { "X-CMC_PRO_API_KEY": CMC_API_KEY },
          params: { symbol: symbol.toUpperCase(), convert: "USD" },
        }
      );
      const coin = res.data.data[symbol.toUpperCase()];
      const q = coin.quote.USD;
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            symbol: symbol.toUpperCase(),
            name: coin.name,
            price_usd: q.price,
            market_cap_usd: q.market_cap,
            volume_24h_usd: q.volume_24h,
            percent_change_1h: q.percent_change_1h,
            percent_change_24h: q.percent_change_24h,
            percent_change_7d: q.percent_change_7d,
            market_cap_rank: coin.cmc_rank,
            circulating_supply: coin.circulating_supply,
            max_supply: coin.max_supply,
            fetched_at: new Date().toISOString(),
          }),
        }],
      };
    } catch (err) {
      return { content: [{ type: "text", text: JSON.stringify({ error: err.message }) }] };
    }
  }
);

// ─── TOOL: get_coingecko_data ────────────────────────────────────────────────
server.tool(
  "get_coingecko_data",
  "Get CoinGecko fundamentals including developer activity, community data, and liquidity",
  {
    coin_id: z.string().describe("CoinGecko ID e.g. bitcoin, ethereum, crypto-com-chain"),
  },
  async ({ coin_id }) => {
    try {
      const res = await axios.get(
        `https://api.coingecko.com/api/v3/coins/${coin_id}`,
        {
          params: {
            localization: false,
            tickers: false,
            market_data: true,
            community_data: true,
            developer_data: true,
          },
          headers: COINGECKO_API_KEY ? { "x-cg-pro-api-key": COINGECKO_API_KEY } : {},
        }
      );
      const d = res.data;
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            id: d.id,
            name: d.name,
            symbol: d.symbol,
            market_cap_rank: d.market_cap_rank,
            price_usd: d.market_data?.current_price?.usd,
            ath_usd: d.market_data?.ath?.usd,
            ath_change_pct: d.market_data?.ath_change_percentage?.usd,
            total_volume_usd: d.market_data?.total_volume?.usd,
            community: {
              twitter_followers: d.community_data?.twitter_followers,
              reddit_subscribers: d.community_data?.reddit_subscribers,
            },
            developer: {
              github_stars: d.developer_data?.stars,
              github_forks: d.developer_data?.forks,
              commit_count_4weeks: d.developer_data?.commit_count_4_weeks,
              pull_requests_merged: d.developer_data?.pull_request_contributors,
            },
            categories: d.categories,
            fetched_at: new Date().toISOString(),
          }),
        }],
      };
    } catch (err) {
      return { content: [{ type: "text", text: JSON.stringify({ error: err.message }) }] };
    }
  }
);

// ─── Start server ─────────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[MCP Trading Data Server] Running on stdio transport");
