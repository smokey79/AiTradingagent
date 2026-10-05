"""Explain repeated candle patterns and prediction diagnostics after testing."""
import json,time
from pathlib import Path
import pandas as pd
ROOT=Path(__file__).resolve().parent
def main():
    while not (ROOT/'funding_audited_rankings.json').exists() or not (ROOT/'candle_pattern_occurrences.csv').exists():time.sleep(5)
    predictions=json.loads((ROOT/'prediction_results.json').read_text());patterns=pd.read_csv(ROOT/'candle_pattern_occurrences.csv');audits=json.loads((ROOT/'funding_audited_rankings.json').read_text())
    lines=['# Candle patterns and next-candle predictions','', 'The models use completed hourly candles. They predict next-open to future-close changes. Mean/scale and ridge coefficients use only the training period; thresholds were selected on validation and frozen before the final period. Forecast events overlap and do not constitute portfolio trades.','', '|Horizon|All final observations|Direction accuracy|Always-up baseline|Filtered events|Filtered accuracy|Mean net bps, overlapping events|','|---:|---:|---:|---:|---:|---:|---:|']
    for row in predictions:
        m=row['test'];v=m['filtered_mean_net_return_bps'];lines.append(f'|{row["horizon_candles"]} candles|{m["observations"]}|{m["direction_accuracy_pct"]:.2f}%|{m["always_up_accuracy_pct"]:.2f}%|{m["filtered_observations"]}|{m["filtered_accuracy_pct"] if m["filtered_accuracy_pct"] is not None else "n/a"}|{v if v is not None else "n/a"}|')
    lines+=['', 'Filtering can improve a selected sample while reducing opportunities. These are descriptive final diagnostics, not validated portfolio PF/drawdown. Costs in this diagnostic are fixed16bps BTC/ETH and20bps other markets; funding, position overlap and stops are handled in the separate strategy simulator.','', '## Repeating candle forms','', 'Counts below aggregate the final exploratory period across tested coins, all regimes and one-candle horizon. The same forms recur often; a high count does not establish predictive power. Conditional results by market, aligned trend/range and1/2/3-candle horizon are in candle_pattern_occurrences.csv. These exploratory readings never change frozen strategy rules.','', '|Pattern|Occurrences|Weighted direction hit rate|Mean signed gross bps|Mean after cost bps|','|---|---:|---:|---:|---:|']
    subset=patterns[(patterns.phase=='final_exploratory')&(patterns.regime=='all')&(patterns.horizon==1)]
    for name,g in subset.groupby('pattern'):
        n=g.occurrences.sum();weight=g.occurrences/n if n else g.occurrences
        lines.append(f'|{name}|{n}|{(g.direction_hit_rate_pct*weight).sum():.2f}%|{(g.mean_signed_return_bps*weight).sum():.3f}|{(g.mean_after_assumed_cost_bps*weight).sum():.3f}|')
    lines+=['', '## Patterns within selected strategy trades','', 'This compares overlapping attributes of final-test trades from the primary audit, including historical funding and known weekly market-cap eligibility. It describes association within selected rules; it is not a newly qualified strategy or an independent causal effect.','', '|Attribute|Trade observations|Win rate|Net USD|','|---|---:|---:|---:|']
    pooled=[]
    for row in audits[:15]:
        path=ROOT/f'funding_trades_{row["id"]}.json'
        if path.exists():pooled+=json.loads(path.read_text())
    for name,predicate in [('engulfing',lambda t:t['pattern'].get('engulfing')),('inside',lambda t:t['pattern'].get('inside')),('rejection_wick_above_50pct',lambda t:t['pattern'].get('wick',0)>.5),('volume_above_1.5x',lambda t:t['pattern'].get('volume_ratio',0)>1.5)]:
        selected=[t for t in pooled if predicate(t)];n=len(selected);wins=sum(t['net_pnl']>0 for t in selected);net=sum(t['net_pnl'] for t in selected);lines.append(f'|{name}|{n}|{100*wins/max(1,n):.2f}%|{net:.2f}|')
    lines+=['', 'Different strategies can trade the same event, so pooled observations are correlated and duplicated across families. Cell-level Wilson intervals assume independence and are optimistic. Robust candidate uncertainty is estimated separately by seven-day blocks of exit-day PnL. None of these pattern findings justifies closing and reopening a live trade on its own.']
    (ROOT/'CANDLE_AND_PREDICTION_FINDINGS.md').write_text('\n'.join(lines),encoding='utf-8')
    pilot=json.loads((ROOT/'orderbook_pilot_results.json').read_text());booklines=['# Live order-book observational pilot','', f'Actual recorded public depth sample rows: {pilot.get("sample_rows",0)}. Fifty levels per side, sampled once per second. Executed buy/sell flow is recorded separately from resting depth.','', '|Market|Nonoverlapping5s predictions|Direction accuracy|Gross signed bps|After assumed costs bps|','|---|---:|---:|---:|---:|']
    for m in pilot.get('markets',[]):booklines.append(f'|{m["symbol"]}|{m["nonoverlapping_test_predictions"]}|{m["direction_accuracy_pct"]:.2f}%|{m["mean_gross_signed_bps"]:.4f}|{m["mean_after_assumed_roundtrip_cost_bps"]:.4f}|')
    booklines+=['', 'The first60% fits a small linear model of depth imbalance, best-quote order-flow imbalance and executed trade imbalance; the later40% evaluates nonoverlapping approximate five-second moves. This short local sample does not establish a persistent edge, execution fills, stop behaviour, portfolio drawdown or a deployable strategy. Resting orders can be cancelled; venue-specific imbalance can conflict with other venues. Historical candles cannot reconstruct historical depth. The browser heatmap connects to a fresh public feed and places no orders.']
    (ROOT/'ORDERBOOK_FINDINGS.md').write_text('\n'.join(booklines),encoding='utf-8');(ROOT/'findings_complete.json').write_text(json.dumps({'status':'complete','pattern_and_prediction_report':True,'orderbook_report':True}))
    print(json.dumps({'findings':'complete'}))
if __name__=='__main__':main()
