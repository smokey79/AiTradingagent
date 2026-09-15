const { BitgetExecutor } = require("./bitgetExecutor.js");
const { CryptoComExecutor } = require("./cryptoComExecutor.js");
const logger = require("../utils/logger.js");

const bitgetClient = new BitgetExecutor();
const cryptoComClient = new CryptoComExecutor();

/**
 * Parses action string like 'BUY_BTC', 'SELL_ETH', 'BUY', 'LONG' into side and symbol.
 * @param {string} action
 * @param {string} defaultSymbol
 * @returns {{ side: string, symbol: string }}
 */
function parseAction(action, defaultSymbol = "BTC/USDT") {
  if (!action) return { side: "BUY", symbol: defaultSymbol };
  const upper = String(action).toUpperCase();
  let side = "BUY";
  let symbol = defaultSymbol;

  if (upper.startsWith("SELL") || upper.startsWith("SHORT")) {
    side = "SELL";
  } else if (upper.startsWith("BUY") || upper.startsWith("LONG")) {
    side = "BUY";
  }

  if (upper.includes("_")) {
    const parts = upper.split("_");
    if (parts.length > 1 && parts[1]) {
      const asset = parts[1];
      symbol = asset.includes("/") ? asset : `${asset}/USDT`;
    }
  }

  return { side, symbol };
}

/**
 * Sleep helper for retry backoff.
 * @param {number} ms
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Executes trade based on multi-agent consensus decision.
 * Routes to Bitget with automatic fallback to Crypto.com, with retry logic and error logging.
 *
 * @param {object} consensusDecision - { approved: boolean, action: string, allocation?: string, exchange?: string, confidence?: number, sizeUsd?: number }
 * @param {object} [options] - Optional execution options (market price, max retries)
 * @returns {Promise<{ executed: boolean, exchange?: string, orderId?: string, error?: string }>}
 */
async function executeTrade(consensusDecision, options = {}) {
  if (!consensusDecision || !consensusDecision.approved) {
    logger.warn("Trade execution skipped: consensus decision not approved", {
      reason: consensusDecision?.reason || "Consensus threshold not met",
    });
    return { executed: false, reason: consensusDecision?.reason || "Not approved" };
  }

  const { side, symbol } = parseAction(consensusDecision.action, consensusDecision.symbol || "BTC/USDT");
  const targetExchange = (consensusDecision.exchange || "BITGET").toUpperCase();
  const maxRetries = options.maxRetries || 3;
  const isLive = process.env.TRADING_MODE === "live";

  const sizeUsd = consensusDecision.sizeUsd || 25.0;
  const allocation = consensusDecision.allocation || "40%";

  logger.info(`⚡ Preparing trade execution: ${side} ${symbol} (${allocation} allocation / $${sizeUsd} USD) on target ${targetExchange}`, {
    isLive,
    targetExchange,
  });

  // Attempt Primary Exchange (Bitget) or Target
  let primaryError = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (targetExchange === "BITGET" || !targetExchange) {
        logger.info(`[Attempt ${attempt}/${maxRetries}] Executing order on Bitget: ${side} ${symbol}`);
        const result = await bitgetClient.placeOrder({
          symbol: symbol.replace("/", ""),
          side: side.toLowerCase(),
          size: (sizeUsd / (options.price || 68000)).toFixed(6),
          orderType: "market",
        });

        logger.info(`✅ Trade executed on Bitget: ${side} ${symbol}`, { result });
        return {
          executed: true,
          exchange: "BITGET",
          side,
          symbol,
          allocation,
          result,
        };
      } else if (targetExchange === "CRYPTOCOM") {
        logger.info(`[Attempt ${attempt}/${maxRetries}] Executing order on Crypto.com: ${side} ${symbol}`);
        const result = await cryptoComClient.placeOrder({
          symbol: symbol.replace("/", "_"),
          side: side.toLowerCase(),
          quantity: (sizeUsd / (options.price || 68000)).toFixed(6),
        });

        logger.info(`✅ Trade executed on Crypto.com: ${side} ${symbol}`, { result });
        return {
          executed: true,
          exchange: "CRYPTOCOM",
          side,
          symbol,
          allocation,
          result,
        };
      }
    } catch (err) {
      primaryError = err;
      logger.warn(`⚠️ Error on ${targetExchange} (Attempt ${attempt}/${maxRetries}): ${err.message}`);
      if (attempt < maxRetries) {
        const backoffMs = attempt * 1000;
        logger.info(`Backing off for ${backoffMs}ms before retry...`);
        await sleep(backoffMs);
      }
    }
  }

  // Fallback Routing to Secondary Exchange (Crypto.com) if Bitget failed
  if (targetExchange === "BITGET") {
    logger.warn(`Primary exchange (Bitget) failed after ${maxRetries} attempts. Engaging Crypto.com routing fallback...`, {
      primaryError: primaryError?.message,
    });

    for (let fallbackAttempt = 1; fallbackAttempt <= maxRetries; fallbackAttempt++) {
      try {
        logger.info(`[Fallback Attempt ${fallbackAttempt}/${maxRetries}] Executing order on Crypto.com: ${side} ${symbol}`);
        const fallbackResult = await cryptoComClient.placeOrder({
          symbol: symbol.replace("/", "_"),
          side: side.toLowerCase(),
          quantity: (sizeUsd / (options.price || 68000)).toFixed(6),
        });

        logger.info(`✅ Trade executed on Crypto.com via fallback router: ${side} ${symbol}`, { fallbackResult });
        return {
          executed: true,
          exchange: "CRYPTOCOM_FALLBACK",
          side,
          symbol,
          allocation,
          result: fallbackResult,
        };
      } catch (fallbackErr) {
        logger.error(`Crypto.com fallback failed (Attempt ${fallbackAttempt}/${maxRetries}): ${fallbackErr.message}`);
        if (fallbackAttempt < maxRetries) {
          await sleep(fallbackAttempt * 1000);
        }
      }
    }
  }

  // Complete Failure Reporting
  const finalError = `Trade execution failed across all configured venues (Bitget and Crypto.com): ${primaryError?.message || "Unknown error"}`;
  logger.error(finalError, {
    consensusDecision,
    primaryError: primaryError?.message,
  });

  return {
    executed: false,
    error: finalError,
    primaryError: primaryError?.message,
  };
}

module.exports = {
  executeTrade,
  parseAction,
};
