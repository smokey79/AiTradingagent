"""Precommitted per-family selection from validation only; no final-file access."""
import json,time,datetime as dt
from pathlib import Path
from run_lab import write
ROOT=Path(__file__).resolve().parent
POLICY='Prioritise validation qualification, then at least250 trades, then validation score; below250 trades prioritise count before score. Never read final-test results.'
def key(row):
    m=row['validation'];n=m['trades'];return (m['qualifies'],n>=250,row['rank_score'] if n>=250 else n/250,row['rank_score'])
def main():
    while not all((ROOT/p).exists() for p in ['frozen_candidates.json','adaptive_frozen.json','supplementary_frozen.json']):time.sleep(3)
    rows=[]
    for name in ['validation_results.json','adaptive_validation_results.json','supplementary_validation_results.json']:
        for attempt in range(20):
            try:rows+=json.loads((ROOT/name).read_text());break
            except (OSError,json.JSONDecodeError):time.sleep(.2)
    selected={}
    for row in rows:
        fam=row['parameters']['family']
        if fam=='prior_ema_baseline':continue
        if fam not in selected or key(row)>key(selected[fam]):selected[fam]=row
    write('PRIMARY_FROZEN.json',{'frozen_utc':dt.datetime.now(dt.timezone.utc).isoformat(),'selection_policy':POLICY,'nominal_trials_considered':len(rows),'candidates':list(selected.values()),'final_results_read':False})
    print(json.dumps({'primary_families':len(selected),'validation_qualified_families':sum(r['validation']['qualifies'] for r in selected.values())}))
if __name__=='__main__':main()
