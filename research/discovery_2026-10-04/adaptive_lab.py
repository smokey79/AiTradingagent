"""Failure-directed validation refinement alongside the timed discovery search."""
import json,time,datetime as dt,hashlib,random
from pathlib import Path
from data_lab import load_data
from strategies_lab import enrich,parameters
from run_lab import evaluate,score,write,ms,slim
ROOT=Path(__file__).resolve().parent
def main():
    started=time.time();rng=random.Random(317);frames={m:enrich(load_data(m),m) for m in [30,60,120]};tested=set();rows=[];best={};n=0
    log=(ROOT/'adaptive_journal.jsonl').open('a',encoding='utf-8')
    end=min(int(f.timestamp.max())+m*60_000 for m,ff in frames.items() for f in ff.values())
    while True:
        marker=ROOT/'frozen_candidates.json'
        if marker.exists() and marker.stat().st_mtime>=started:break
        source=ROOT/'validation_results.json'
        try:base=json.loads(source.read_text())
        except (OSError,json.JSONDecodeError):time.sleep(2);continue
        candidates={}
        for row in base+rows:
            fam=row['parameters']['family']
            if fam not in candidates or row['rank_score']>candidates[fam]['rank_score']:candidates[fam]=row
        if not candidates:time.sleep(2);continue
        fam=sorted(candidates)[n%len(candidates)];prior=candidates[fam];p=dict(prior['parameters']);m=prior['validation']
        # Different failure diagnoses produce different refinement rules. Validation alone informs this.
        if m['max_drawdown_pct']>20:
            diagnosis='drawdown breach';p['risk_fraction']=rng.choice([.0025,.0035,.004]);p['adx']=rng.choice([20,25,30])
        elif m['total_cost_usd']>max(abs(m['net_profit_usd']),1):
            diagnosis='cost drag large relative to net expectancy';p['minutes']=rng.choice([60,120]);p['reward_risk']=rng.choice([2.,2.5,3.,3.5]);p['atr_stop']=rng.choice([1.75,2.25,2.75,3.])
        elif m['trades']<250:
            diagnosis='insufficient independent portfolio trades';p['minutes']=rng.choice([30,60]);p['adx']=rng.choice([12,15,18]);p['max_hold_hours']=rng.choice([12,24,48]);p['direction']='both'
        else:
            diagnosis='check neighbouring risk/reward and EMA stability';p['reward_risk']=rng.choice([1.25,1.75,2.25,2.75,3.25]);p['atr_stop']=rng.choice([1.25,1.75,2.25,2.75])
        p['fast']=rng.choice([13,21,34]);p['slow']=rng.choice([55,89,100]);p['volume']=rng.choice([1.,1.25,1.5]);p['efficiency']=rng.choice([.2,.3,.4]);p['rank']=rng.choice([.6,.7,.8]);p['variant']='failure_directed'
        ident=hashlib.sha256(json.dumps(p,sort_keys=True).encode()).hexdigest()[:12]
        n+=1
        if ident in tested:continue
        tested.add(ident)
        val,_,_=evaluate(frames[p['minutes']],p,ms('2025-07-01'),ms('2026-02-01'))
        row={'id':ident,'parameters':p,'validation':val,'rank_score':float(score(val)),'round':n,'utc':dt.datetime.now(dt.timezone.utc).isoformat(),'parent_id':prior['id'],'diagnosis':diagnosis,'research_basis':'2026 cost-aware BTC forecasting preprint and chronological forecasting validation; adaptation tests hypotheses rather than accepting paper profitability'}
        rows.append(row)
        if fam not in best or row['rank_score']>best[fam]['rank_score']:best[fam]=row
        log.write(json.dumps({'parent_id':prior['id'],'candidate':ident,'family':fam,'diagnosis':diagnosis,'changes':{k:v for k,v in p.items() if v!=prior['parameters'].get(k)},'result':slim(val),'improved_validation_score':row['rank_score']>prior['rank_score'],'utc':row['utc']})+'\n');log.flush()
        if n%25==0:write('adaptive_validation_results.json',rows);write('adaptive_progress.json',{'variants_tested':len(rows),'families':len(best),'qualifiers':sum(r['validation']['qualifies'] for r in rows),'status':'validation_refinement'})
    write('adaptive_validation_results.json',rows);write('adaptive_frozen.json',{'frozen_utc':dt.datetime.now(dt.timezone.utc).isoformat(),'trial_count':len(rows),'candidates':list(best.values())})
    finals=[]
    for row in best.values():
        p=row['parameters'];ff=frames[p['minutes']]
        test,trades,path=evaluate(ff,p,ms('2026-02-01'),end);stress,_,_=evaluate(ff,p,ms('2026-02-01'),end,cost=2);gas,_,_=evaluate(ff,p,ms('2026-02-01'),end,cost=2,gas=1);train,_,_=evaluate(ff,p,ms('2024-01-01'),ms('2025-07-01'))
        result={**row,'train':train,'test':test,'cost_stress':stress,'gas_stress':gas,'robustness':{'positive_validation_and_test':row['validation']['net_profit_usd']>0 and test['net_profit_usd']>0,'positive_double_cost':stress['net_profit_usd']>0,'profitable_markets':sum(v['net']>0 for v in test['by_coin'].values()),'tested_markets':len(test['by_coin'])}}
        finals.append(result);write(f'trades_{row["id"]}.json',trades);write(f'equity_{row["id"]}.json',path);write('adaptive_final_results.json',finals)
    log.close();write('adaptive_progress.json',{'status':'complete','variants_tested':len(rows),'families':len(best),'elapsed_minutes':(time.time()-started)/60})
    print(json.dumps({'status':'complete','variants':len(rows)}))
if __name__=='__main__':main()
