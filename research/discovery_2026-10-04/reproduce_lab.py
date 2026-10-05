"""Reproduce a frozen candidate using saved public data and fixed rules."""
import argparse,json
from pathlib import Path
from data_lab import load_data
from strategies_lab import enrich
from run_lab import evaluate,ms
from backtest_lab import portfolio,opportunities
from strategies_lab import signals
from supplementary_lab import NEW_FAMILIES,evaluate_new,funding_signal
from marketcap_lab import eligible,filter_frames_for_rank
ROOT=Path(__file__).resolve().parent
p=argparse.ArgumentParser();p.add_argument('candidate_id');p.add_argument('--phase',choices=['train','validation','test'],default='test');p.add_argument('--cost',type=float,default=1);p.add_argument('--gas',type=float,default=0);p.add_argument('--historical-funding',action='store_true');a=p.parse_args()
rows=json.loads((ROOT/'ranked_strategies.json').read_text())+json.loads((ROOT/'PRIMARY_FROZEN.json').read_text())['candidates'];row=next(r for r in rows if r['id']==a.candidate_id);settings=row['parameters'];ff=enrich(load_data(settings['minutes']),settings['minutes'])
end=min(int(f.timestamp.max())+7_200_000 for f in load_data(120).values());ranges={'train':(ms('2024-01-01'),ms('2025-07-01')),'validation':(ms('2025-07-01'),ms('2026-02-01')),'test':(ms('2026-02-01'),end)}
metrics,trades,equity=(evaluate_new if settings['family'] in NEW_FAMILIES else evaluate)(ff,settings,*ranges[a.phase],cost=a.cost,gas=a.gas)
if a.historical_funding:
    ff=filter_frames_for_rank(ff,settings['minutes'])
    events=[]
    for coin,f in ff.items():events+=opportunities(coin,f,funding_signal(f,settings,coin) if settings['family'] in NEW_FAMILIES else signals(f,settings),settings,*ranges[a.phase])
    events=[e for e in events if eligible(e['coin'],e['entry_ms'])]
    funding={coin:json.loads((ROOT/'funding'/f'{coin}.json').read_text()) for coin in ff if (ROOT/'funding'/f'{coin}.json').exists()}
    metrics,trades,equity=portfolio(events,ff,settings,*ranges[a.phase],cost_multiplier=a.cost,gas_per_roundtrip=a.gas,funding_data=funding)
print(json.dumps(metrics,indent=2))
