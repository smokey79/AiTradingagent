import { logger } from "../utils/logger.js";

/**
 * Hard-veto risk gate. This is the last checkpoint before ANY live order —
 * it does not get bypassed by a single confident agent. Tune thresholds
 * via .env, not by editing this logic inline.
 */
export function passesRiskGate(synthesis) {
  const minAgreement = Number(process.env.MIN_AGENT_AGREEMENT ?? 3);
  const minConfidence = Number(process.env.CONFIDENCE_THRESHOLD_LIVE ?? 0.7);

  const checks = {
    hasSignal: synthesis.finalSignal !== "hold",
    enoughAgreement: synthesis.agreementCount >= minAgreement,
    enoughConfidence: synthesis.avgConfidence >= minConfidence,
  };

  const passed = Object.values(checks).every(Boolean);

  logger.info("Risk gate evaluation", { passed, checks, synthesis: synthesis.finalSignal });
  return { passed, checks };
}

/** Backtest-level gate applied to a strategy before it's allowed to run live at all. */
export function passesBacktestGate(backtestResult) {
  const minWinRate = Number(process.env.BACKTEST_MIN_WIN_RATE ?? 0.7);
  const minProfitFactor = Number(process.env.BACKTEST_MIN_PROFIT_FACTOR ?? 1.5);

  return (
    backtestResult.winRate >= minWinRate &&
    backtestResult.profitFactor >= minProfitFactor
  );
}
