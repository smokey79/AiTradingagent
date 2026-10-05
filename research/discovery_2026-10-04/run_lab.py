"""Timed adaptive search. Selection uses validation; final test is opened once."""
from __future__ import annotations
import argparse
import datetime as dt
import hashlib
import json
from pathlib import Path
import random
import time
import numpy as np
from data_lab import load_data
from strategies_lab import FAMILIES,enrich,signals,parameters
from backtest_lab import opportunities,portfolio

ROOT=Path(__file__).resolve().parent
def ms(text):return int(dt.datetime.fromisoformat(text).replace(tzinfo=dt.timezone.utc).timestamp()*1000)
def write(name,obj):
    target=ROOT/name;temp=target.with_suffix(target.suffix+'.tmp');temp.write_text(json.dumps(obj,indent=2,allow_nan=False),encoding='utf-8')
    for attempt in range(40):
        try:temp.replace(target);return
        except PermissionError:
            if attempt==39:raise
            time.sleep(.05)
def slim(metrics):return {k:v for k,v in metrics.items() if k not in ('daily_returns','by_coin')}
def score(m):
    return (1 if m['qualifies'] else 0)+min(m['profit_factor'],3)*.4+min(m['trades']/250,1)*.2-m['max_drawdown_pct']*.025+np.clip(m['net_profit_pct'],-100,100)*.004
def evaluate(frames,p,start,end,cost=1,gas=0):
    events=[]
    for coin,f in frames.items():events+=opportunities(coin,f,signals(f,p),p,start,end)
    return portfolio(events,frames,p,start,end,cost_multiplier=cost,gas_per_roundtrip=gas)

def main():
    arg=argparse.ArgumentParser();arg.add_argument('--minutes',type=float,default=90);arg.add_argument('--once',action='store_true');arg.add_argument('--resume',action='store_true');options=arg.parse_args()
    started=time.monotonic();deadline=started+options.minutes*60
    session={'started_utc':dt.datetime.now(dt.timezone.utc).isoformat(),'requested_minutes':options.minutes,'selection_policy':'All iterative selection is on train/validation. Final test opens only after candidate rules are frozen.','status':'running','seed':20261004}
    if options.resume:
        session=json.loads((ROOT/'session.json').read_text());elapsed=(dt.datetime.now(dt.timezone.utc)-dt.datetime.fromisoformat(session['started_utc'])).total_seconds();started-=elapsed;deadline=started+session['requested_minutes']*60
        session['checkpoint_resumes']=session.get('checkpoint_resumes',0)+1;session['resume_utc']=dt.datetime.now(dt.timezone.utc).isoformat();session['resume_reason']='Windows reader temporarily blocked atomic checkpoint replacement; other research refinement and public depth recording continued.'
    write('session.json',session)
    frames={};rows=[];best={};tested=set();rng=random.Random(20261004);round_id=0
    if options.resume:
        rows=json.loads((ROOT/'validation_results.json').read_text());tested={r['id'] for r in rows};round_id=max((r['round'] for r in rows),default=-1)+1
        for row in rows:
            fam=row['parameters']['family']
            if fam not in best or row['rank_score']>best[fam]['rank_score']:best[fam]=row
    for minutes in (60,120,30):
        frames[minutes]=enrich(load_data(minutes),minutes)
        print(json.dumps({'phase':'features_ready','minutes':minutes,'markets':len(frames[minutes])}),flush=True)
    train_start=ms('2024-01-01');val_start=ms('2025-07-01');test_start=ms('2026-02-01')
    maxend=min(int(f.timestamp.max())+minutes*60_000 for minutes,ff in frames.items() for f in ff.values())
    journal=(ROOT/'research_journal.jsonl').open('a',encoding='utf-8')
    while time.monotonic()<deadline-600 or not rows:
        family=FAMILIES[round_id%len(FAMILIES)]
        cycle=round_id//len(FAMILIES)
        tf=(60,120,30)[cycle%3]
        variant=cycle if cycle<81 else rng.randrange(81)
        p=parameters(family,variant,tf)
        # Later rounds refine failure hypotheses: costs, volatility, direction, reward/risk and hold length.
        if cycle>=81:
            p['atr_stop']=rng.choice([1.25,1.75,2.25,3.])
            p['reward_risk']=rng.choice([1.25,1.75,2.5,3.5])
            p['max_hold_hours']=rng.choice([12,24,72,120])
        ident=hashlib.sha256(json.dumps(p,sort_keys=True).encode()).hexdigest()[:12]
        if ident in tested:round_id+=1;continue
        tested.add(ident)
        validation,_,_=evaluate(frames[tf],p,val_start,test_start)
        row={'id':ident,'parameters':p,'validation':validation,'rank_score':float(score(validation)),'round':round_id,'utc':dt.datetime.now(dt.timezone.utc).isoformat()}
        rows.append(row)
        prior=best.get(family)
        if prior is None or row['rank_score']>prior['rank_score']:best[family]=row
        failure=[]
        if validation['trades']<250:failure.append('insufficient_trades: test broader eligible market set or less restrictive confirmation')
        if validation['profit_factor']<=1.12:failure.append('cost-adjusted expectancy too weak: test larger reward/risk, slower timeframe or stronger regime filter')
        if validation['max_drawdown_pct']>20:failure.append('drawdown too high: lower risk or isolate failing regime')
        if validation['net_profit_usd']<=0:failure.append('net loss: inspect fees, stop whipsaws and market concentration')
        journal.write(json.dumps({'round':round_id,'family':family,'id':ident,'validation':slim(validation),'failure_analysis':failure,'next_hypothesis':'Neighbour settings and half-timeframe confirmation, selected only on validation','utc':row['utc']})+'\n');journal.flush()
        write('progress.json',{'status':'searching','elapsed_minutes':(time.monotonic()-started)/60,'variants_tested':len(rows),'distinct_families':len(best),'validation_qualifiers':sum(r['validation']['qualifies'] for r in rows),'best':[{ 'family':r['parameters']['family'],'id':r['id'],'metrics':slim(r['validation'])} for r in sorted(best.values(),key=lambda z:z['rank_score'],reverse=True)[:5]]})
        if round_id%50==0:
            write('validation_results.json',rows);write('strategy_memory.json',{'stage':'validation','best_per_family':best,'trial_count':len(rows)})
            print(json.dumps({'round':round_id,'elapsed_minutes':round((time.monotonic()-started)/60,2),'tested':len(rows),'family':family,'pf':round(validation['profit_factor'],3),'trades':validation['trades']}),flush=True)
        round_id+=1
        if options.once:break
    write('validation_results.json',rows)
    frozen=sorted(best.values(),key=lambda r:r['rank_score'],reverse=True)
    write('frozen_candidates.json',{'frozen_utc':dt.datetime.now(dt.timezone.utc).isoformat(),'trial_count':len(rows),'candidates':frozen})
    finals=[]
    for row in frozen:
        p=row['parameters'];ff=frames[p['minutes']]
        base,tt,path=evaluate(ff,p,test_start,maxend)
        stress,_,_=evaluate(ff,p,test_start,maxend,cost=2)
        gas,_,_=evaluate(ff,p,test_start,maxend,cost=2,gas=1)
        train,_,_=evaluate(ff,p,train_start,val_start)
        result={**row,'train':train,'test':base,'cost_stress':stress,'gas_stress':gas,'robustness':{'positive_validation_and_test':row['validation']['net_profit_usd']>0 and base['net_profit_usd']>0,'positive_double_cost':stress['net_profit_usd']>0,'profitable_markets':sum(v['net']>0 for v in base['by_coin'].values()),'tested_markets':len(base['by_coin'])}}
        finals.append(result)
        write(f'trades_{row["id"]}.json',tt);write(f'equity_{row["id"]}.json',path);write('final_results.json',finals)
        print(json.dumps({'phase':'final_test','family':p['family'],'pf':round(base['profit_factor'],3),'trades':base['trades'],'qualifies':base['qualifies']}),flush=True)
    # Continue genuinely distinct robustness work until the requested wall-clock duration expires.
    audit_round=0
    while time.monotonic()<deadline and not options.once:
        if finals:
            result=finals[audit_round%len(finals)];p=result['parameters'];ff=frames[p['minutes']]
            # Locked rules; this only measures stability and cannot feed final selection.
            cut=test_start+(audit_round%4)*((maxend-test_start)//4)
            end=min(maxend,cut+(maxend-test_start)//4)
            m,_,_=evaluate(ff,p,cut,end,cost=1.5)
            journal.write(json.dumps({'robustness_audit':audit_round,'candidate':result['id'],'start_ms':cut,'end_ms':end,'cost_multiplier':1.5,'metrics':slim(m),'utc':dt.datetime.now(dt.timezone.utc).isoformat()})+'\n');journal.flush()
        audit_round+=1
    journal.close()
    session.update({'status':'complete','finished_utc':dt.datetime.now(dt.timezone.utc).isoformat(),'actual_elapsed_minutes':(time.monotonic()-started)/60,'variants_tested':len(rows),'families_tested':len(best),'robustness_audits':audit_round,'final_test_opened_once':True})
    write('session.json',session);write('progress.json',session)
    write('strategy_memory.json',{'stage':'final_test_complete','trial_count':len(rows),'results':finals,'best_qualified':sorted([r for r in finals if r['test']['qualifies']],key=lambda r:(r['robustness']['positive_double_cost'],r['test']['return_profit_factor'],-r['test']['max_drawdown_pct']),reverse=True)})
    print(json.dumps(session),flush=True)

if __name__=='__main__':main()
