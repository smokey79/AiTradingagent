/**
 * src/agents/evidenceCandidates/config.js
 * The 6 coin/timeframe/strategy cells that passed every check in the
 * 2026-09-24 multi-timeframe lab (research/multi_tf_lab_2026-09-24/SUMMARY.md).
 *
 * Status: PAPER ONLY. None was robust across coins AND neighbouring timeframes,
 * so each is treated as a candidate whose live paper record decides its fate
 * (live-funds gate: 70% win rate over 50 trades, plus the evidence gate).
 * Numbers are the lab's measured results (TradingKit, Bybit perps, 0.05% fees):
 *   pf = full-history profit factor from per-trade % returns
 *   oosPf = 2024-01-01 onward only
 */
'use strict';

const STRATEGIES = {
  EMA_VWAP:         { useVwap: true,  useAdx: false, adxTh: 0,  atrMult: 2.0 },
  EMA_VWAP_ADX20:   { useVwap: true,  useAdx: true,  adxTh: 20, atrMult: 2.0 },
  EMA_ADX20_ATR15:  { useVwap: false, useAdx: true,  adxTh: 20, atrMult: 1.5 },
  EMA_ADX20_ATR25:  { useVwap: false, useAdx: true,  adxTh: 20, atrMult: 2.5 },
};

const CANDIDATES = [
  { id: 'MTF_EMA_VWAP_ETH_2h',         coin: 'ETH', timeframe: '2h', strategy: 'EMA_VWAP',        trades: 244, winRatePct: 12.7, pf: 1.268, oosPf: 1.230, oosTrades: 130, dd15Pct: 7.3 },
  { id: 'MTF_EMA_VWAP_ARB_1h',         coin: 'ARB', timeframe: '1h', strategy: 'EMA_VWAP',        trades: 302, winRatePct: 14.2, pf: 1.221, oosPf: 1.298, oosTrades: 225, dd15Pct: 18.4, caution: 'ARB listed 2023: most history is 2024+' },
  { id: 'MTF_EMA_VWAP_ADX20_ARB_1h',   coin: 'ARB', timeframe: '1h', strategy: 'EMA_VWAP_ADX20',  trades: 214, winRatePct: 14.5, pf: 1.414, oosPf: 1.678, oosTrades: 156, dd15Pct: 11.9, caution: 'ARB listed 2023: most history is 2024+' },
  { id: 'MTF_EMA_ADX20_ATR15_ARB_2h',  coin: 'ARB', timeframe: '2h', strategy: 'EMA_ADX20_ATR15', trades: 144, winRatePct: 13.2, pf: 1.437, oosPf: 1.375, oosTrades: 112, dd15Pct: 10.9, caution: 'ARB listed 2023: most history is 2024+' },
  { id: 'MTF_EMA_VWAP_ADX20_CRO_1h',   coin: 'CRO', timeframe: '1h', strategy: 'EMA_VWAP_ADX20',  trades: 360, winRatePct: 10.6, pf: 1.207, oosPf: 1.475, oosTrades: 202, dd15Pct: 15.1, caution: 'in-sample PF was 0.88 (lost before 2024)' },
  { id: 'MTF_EMA_ADX20_ATR15_BTC_4h',  coin: 'BTC', timeframe: '4h', strategy: 'EMA_ADX20_ATR15', trades: 159, winRatePct: 11.9, pf: 1.286, oosPf: 1.129, oosTrades: 64,  dd15Pct: 7.2 },
];

module.exports = { STRATEGIES, CANDIDATES };
