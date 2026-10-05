/**
 * paperBook.js — pure, testable paper-trading book for the duel (tests/paperBook.test.js).
 * No network, no files. Leveraged positions: margin = notional / leverage.
 * Costs (2026-10-03): the shared realism settings, 0.06% fee + 0.02% slippage per side
 * (CEX/OANDA/Alpaca). Meme DEX swaps: 1.0% per side (swap fee + slippage).
 */
'use strict';

const realism = require('../utils/realism');
const SHARED = realism.costFractionPerSide();
const COST_PER_SIDE = { crypto: SHARED, oanda: SHARED, alpaca: SHARED, meme: 0.01 };
const MAX_LEV = { crypto: 5, oanda: 5, alpaca: 2, meme: 1 };

function newBook(startUsd) {
  return { startUsd, cash: startUsd, positions: [], closed: [], halted: false, haltReason: null, nextId: 1 };
}

function unrealized(p, price) {
  const dir = p.side === 'LONG' ? 1 : -1;
  return p.notional * ((price - p.entry) / p.entry) * dir;
}

function equity(b, prices = {}) {
  let e = b.cash;
  for (const p of b.positions) e += p.margin + unrealized(p, prices[p.key] ?? p.lastPrice ?? p.entry);
  return e;
}

/** Validate + open. Returns { ok, reason, position }. */
function open(b, { key, market, side, notional, leverage, stopLossPct, takeProfitPct, reason }, price, rules) {
  const { maxOpen = 6, maxMarginFrac = 0.25, minNotional = 5 } = rules || {};
  if (b.halted) return { ok: false, reason: `halted: ${b.haltReason}` };
  if (!(price > 0)) return { ok: false, reason: 'no live price' };
  if (!COST_PER_SIDE[market]) return { ok: false, reason: `unknown market ${market}` };
  if (side !== 'LONG' && side !== 'SHORT') return { ok: false, reason: 'side must be LONG or SHORT' };
  if (market === 'meme' && side === 'SHORT') return { ok: false, reason: 'meme coins are DEX spot: LONG only' };
  if (b.positions.some(p => p.key === key)) return { ok: false, reason: 'already have a position on this instrument' };
  if (b.positions.length >= maxOpen) return { ok: false, reason: `max ${maxOpen} open positions` };
  const lev = Math.max(1, Math.min(Number(leverage) || 1, MAX_LEV[market]));
  notional = Number(notional);
  if (!(notional >= minNotional)) return { ok: false, reason: `notional below $${minNotional}` };
  const sl = Number(stopLossPct), tp = Number(takeProfitPct);
  if (!(sl >= 0.2 && sl <= 25)) return { ok: false, reason: 'stopLossPct must be 0.2-25' };
  if (!(tp > 0 && tp <= 100)) return { ok: false, reason: 'takeProfitPct must be >0' };
  if (sl * lev >= 90) return { ok: false, reason: 'stop is beyond liquidation at this leverage' };
  const margin = notional / lev;
  const fee = notional * COST_PER_SIDE[market];
  const eq = equity(b);
  if (margin > eq * maxMarginFrac) return { ok: false, reason: `margin $${margin.toFixed(2)} > ${maxMarginFrac * 100}% of equity` };
  if (margin + fee > b.cash) return { ok: false, reason: 'not enough free cash' };
  const dir = side === 'LONG' ? 1 : -1;
  const p = {
    id: b.nextId++, key, market, side, leverage: lev, notional, margin, entry: price, lastPrice: price,
    stopPrice: price * (1 - dir * sl / 100), takePrice: price * (1 + dir * tp / 100),
    stopLossPct: sl, takeProfitPct: tp, entryFee: fee, openedAt: new Date().toISOString(), reason: String(reason || '').slice(0, 300),
  };
  b.cash -= margin + fee;
  b.positions.push(p);
  return { ok: true, position: p };
}

function close(b, id, price, why) {
  const i = b.positions.findIndex(p => p.id === id);
  if (i < 0) return null;
  const p = b.positions[i];
  const gross = unrealized(p, price);
  const exitFee = p.notional * COST_PER_SIDE[p.market];
  // A leveraged position can never lose more than its margin (liquidation).
  const pnlAfterExit = Math.max(-p.margin, gross - exitFee);
  b.cash += p.margin + pnlAfterExit;
  const netPnl = pnlAfterExit - p.entryFee;
  const rec = {
    ...p, exit: price, closedAt: new Date().toISOString(), closeReason: why,
    grossPnl: +gross.toFixed(4), fees: +(p.entryFee + exitFee).toFixed(4), netPnl: +netPnl.toFixed(4),
    outcome: netPnl > 0 ? 'WIN' : 'LOSS',
  };
  b.positions.splice(i, 1);
  b.closed.push(rec);
  return rec;
}

/** Apply SL / TP / liquidation for every position that has a fresh price. Returns closed records. */
function mark(b, prices) {
  const out = [];
  for (const p of [...b.positions]) {
    const px = prices[p.key];
    if (!(px > 0)) continue;
    p.lastPrice = px;
    const long = p.side === 'LONG';
    if (unrealized(p, px) <= -0.9 * p.margin) out.push(close(b, p.id, px, 'LIQUIDATED'));
    else if (long ? px <= p.stopPrice : px >= p.stopPrice) out.push(close(b, p.id, px, 'STOP_LOSS'));
    else if (long ? px >= p.takePrice : px <= p.takePrice) out.push(close(b, p.id, px, 'TAKE_PROFIT'));
  }
  return out;
}

/** $30 floor: if equity <= floor, close everything and halt. */
function enforceFloor(b, prices, floorUsd) {
  const eq = equity(b, prices);
  if (b.halted || eq > floorUsd) return [];
  const out = [];
  for (const p of [...b.positions]) out.push(close(b, p.id, prices[p.key] ?? p.lastPrice, 'FLOOR_HIT'));
  b.halted = true;
  b.haltReason = `equity $${eq.toFixed(2)} hit the $${floorUsd} floor`;
  return out;
}

module.exports = { newBook, open, close, mark, equity, unrealized, enforceFloor, COST_PER_SIDE, MAX_LEV };
