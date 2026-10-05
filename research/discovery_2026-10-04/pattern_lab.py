"""Enumerate repeat candle patterns and later moves; no backtest retuning."""
import json,datetime as dt
from pathlib import Path
import numpy as np
import pandas as pd
from data_lab import load_data
from strategies_lab import enrich
ROOT=Path(__file__).resolve().parent
def wilson(w,n):
    if not n:return [None,None]
    z=1.96;p=w/n;d=1+z*z/n;centre=(p+z*z/(2*n))/d;half=z*np.sqrt(p*(1-p)/n+z*z/(4*n*n))/d
    return [float(100*(centre-half)),float(100*(centre+half))]
def main():
    frames=enrich(load_data(60),60);records=[]
    split=int(dt.datetime(2026,2,1,tzinfo=dt.timezone.utc).timestamp()*1000)
    for coin,f in frames.items():
        up=(f.regime_ema21>f.regime_ema55)&(f.regime_adx>20)
        down=(f.regime_ema21<f.regime_ema55)&(f.regime_adx>20)
        quiet=f.regime_adx<20
        patterns={'bullish_engulfing':(f.engulf_up,1),'bearish_engulfing':(f.engulf_down,-1),'lower_wick_rejection':((f.lower_wick>.5)&(f.close>f.open),1),'upper_wick_rejection':((f.upper_wick>.5)&(f.close<f.open),-1),'inside_bar_up_break':(f.inside.shift(1,fill_value=False)&(f.close>f.high.shift(1)),1),'inside_bar_down_break':(f.inside.shift(1,fill_value=False)&(f.close<f.low.shift(1)),-1),'three_bar_up_reversal':((f.close.shift(2)<f.open.shift(2))&(f.body_ratio.shift(1)<.3)&(f.close>f.high.shift(2)),1),'three_bar_down_reversal':((f.close.shift(2)>f.open.shift(2))&(f.body_ratio.shift(1)<.3)&(f.close<f.low.shift(2)),-1),'doji_follow_previous_direction':(f.doji,np.sign(f.return1).fillna(0).to_numpy())}
        for name,(pattern,side) in patterns.items():
            aligned=(up if side==1 else down) if np.isscalar(side) else ((up&(side>0))|(down&(side<0)))
            for regime,mask in [('all',np.ones(len(f),bool)),('trend_aligned',aligned),('range',quiet)]:
                for phase,phase_mask in [('development',f.timestamp<split),('final_exploratory',f.timestamp>=split)]:
                    for horizon in [1,2,3]:
                        move=f.close.shift(-horizon)/f.open.shift(-1)-1
                        contiguous=f.timestamp.shift(-horizon)-f.timestamp==horizon*3_600_000
                        use=pattern&mask&phase_mask&contiguous&move.notna()
                        signed=np.asarray(move*side)[use];n=len(signed);wins=int((signed>0).sum())
                        baseline=np.asarray(move*side)[np.asarray(mask&phase_mask&contiguous&move.notna())]
                        costs=.0016 if coin in ('BTC','ETH') else .002
                        records.append({'coin':coin,'pattern':name,'regime':regime,'phase':phase,'horizon':horizon,'occurrences':n,'direction_hit_rate_pct':100*wins/n if n else None,'wilson_interval_independence_only':wilson(wins,n),'baseline_hit_rate_pct':float(100*np.mean(baseline>0)) if len(baseline) else None,'mean_signed_return_bps':float(10000*np.mean(signed)) if n else None,'mean_after_assumed_cost_bps':float(10000*(np.mean(signed)-costs)) if n else None})
    pd.DataFrame(records).to_csv(ROOT/'candle_pattern_occurrences.csv',index=False)
    (ROOT/'pattern_cautions.json').write_text(json.dumps({'status':'exploratory','multiple_hypotheses':len(records),'notes':['Patterns repeat, but repetition alone does not show an exploitable edge.','Events overlap; Wilson intervals assume independence and are optimistic.','Final exploratory patterns do not change the frozen strategy rules.','Different market regimes and horizons may reverse the apparent association.']} ,indent=2))
    print(json.dumps({'pattern_cells':len(records)}))
if __name__=='__main__':main()
