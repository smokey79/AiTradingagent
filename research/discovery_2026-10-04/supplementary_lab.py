"""New research hypotheses using funding history and cost-filtered reversal."""
import datetime as dt,hashlib,json,random,time
from pathlib import Path
import numpy as np
from data_lab import load_data
from strategies_lab import enrich,parameters
from backtest_lab import opportunities,portfolio
from run_lab import ms,score,write,slim
ROOT=Path(__file__).resolve().parent
NEW_FAMILIES=['funding_crowd_fade','funding_settlement_breakout','sign_reversal_costfilter']
_rates={}
def funding_signal(f,p,coin):
    family=p['family'];c,o=f.close.to_numpy(),f.open.to_numpy()
    if family!='sign_reversal_costfilter':
        if coin not in _rates:_rates[coin]=np.array(json.loads((ROOT/'funding'/f'{coin}.json').read_text()),dtype=float)
        history=_rates[coin]
        # A full hour of publication latency is assumed; settled future rates are never features.
        available=f.timestamp.to_numpy()+p['minutes']*60_000-3_600_000
        idx=np.searchsorted(history[:,0],available,side='right')-1;known=idx>=0
        rate=np.where(known,history[np.maximum(idx,0),1],np.nan);settle=np.where(known,history[np.maximum(idx,0),0],np.nan)
    up=((f.regime_ema21>f.regime_ema55)&(f.confirm_close>f.confirm_ema21)).to_numpy()
    down=((f.regime_ema21<f.regime_ema55)&(f.confirm_close<f.confirm_ema21)).to_numpy()
    if family=='funding_crowd_fade':
        lu=(rate<-p['funding_threshold'])&(f.rsi14.to_numpy()<40)&(c>o)&(~down)&(f.regime_adx.to_numpy()<25)
        sd=(rate>p['funding_threshold'])&(f.rsi14.to_numpy()>60)&(c<o)&(~up)&(f.regime_adx.to_numpy()<25)
    elif family=='funding_settlement_breakout':
        since=(f.timestamp.to_numpy()+p['minutes']*60_000-settle)/60_000
        window=(since>=60)&(since<=p['event_window_minutes'])
        lu=window&up&(c>f.high10.to_numpy())&(f.vol_ratio.to_numpy()>p['volume'])
        sd=window&down&(c<f.low10.to_numpy())&(f.vol_ratio.to_numpy()>p['volume'])
    elif family=='sign_reversal_costfilter':
        r=f.return1.to_numpy();large=np.abs(r)>=p['minimum_move'];regime=np.ones(len(f),bool) if p['regime_filter']=='all' else f.regime_adx.to_numpy()<20
        lu=large&regime&(r<0);sd=large&regime&(r>0)
    else:raise ValueError('Not a supplementary family')
    if p['direction']=='long':sd[:]=False
    if p['direction']=='short':lu[:]=False
    good=(f.atr_pct.between(.001,.08)&(f.volume>0)&f.regime_ema55.notna()).to_numpy()
    return np.where(lu&good,1,np.where(sd&good,-1,0)).astype(np.int8)
def evaluate_new(frames,p,start,end,cost=1,gas=0):
    events=[]
    for coin,f in frames.items():events+=opportunities(coin,f,funding_signal(f,p,coin),p,start,end)
    return portfolio(events,frames,p,start,end,cost_multiplier=cost,gas_per_roundtrip=gas)
def main():
    started=time.time();rng=random.Random(181);frames={m:enrich(load_data(m),m) for m in [15,30,60]};rows=[];best={};tested=set();n=0
    journal=(ROOT/'supplementary_journal.jsonl').open('a',encoding='utf-8')
    while True:
        marker=ROOT/'frozen_candidates.json'
        if marker.exists() and marker.stat().st_mtime>=started:break
        fam=NEW_FAMILIES[n%3];p=parameters(fam,0,rng.choice([15,30,60]));p.update({'variant':'new_research','atr_stop':rng.choice([1.25,1.75,2.25,2.75]),'reward_risk':rng.choice([1.25,1.75,2.5,3.25]),'max_hold_hours':rng.choice([4,12,24,48]),'direction':rng.choice(['both','long','short']),'funding_threshold':rng.choice([.00005,.0001,.0002,.0004]),'event_window_minutes':rng.choice([120,180,240]),'minimum_move':rng.choice([0,.002,.004,.008,.012]),'regime_filter':rng.choice(['all','range']),'volume':rng.choice([1,1.25,1.5])});n+=1
        from effective_lab import effective_settings
        key=hashlib.sha256(json.dumps(effective_settings(p),sort_keys=True).encode()).hexdigest()[:12]
        if key in tested:continue
        tested.add(key);val,_,_=evaluate_new(frames[p['minutes']],p,ms('2025-07-01'),ms('2026-02-01'))
        row={'id':key,'parameters':p,'validation':val,'rank_score':float(score(val)),'round':n,'utc':dt.datetime.now(dt.timezone.utc).isoformat(),'research_basis':'2026 short-horizon reversal preprint; periodicity study; perpetual funding mechanism papers; directional translations are hypotheses'};rows.append(row)
        if fam not in best or row['rank_score']>best[fam]['rank_score']:best[fam]=row
        journal.write(json.dumps({'family':fam,'id':key,'settings':effective_settings(p),'validation':slim(val),'critique':'Detectable direction need not exceed fees; funding level is not a proven directional predictor; one-hour publication latency protects feature causality','next_hypothesis':'Test larger prior moves, wider ATR stops, slower intervals or range restrictions on validation only'})+'\n');journal.flush()
        if len(rows)%10==0:write('supplementary_validation_results.json',rows);write('supplementary_progress.json',{'status':'validation_research','trials':len(rows),'families':len(best),'qualifiers':sum(r['validation']['qualifies'] for r in rows)})
    write('supplementary_validation_results.json',rows);write('supplementary_frozen.json',{'frozen_utc':dt.datetime.now(dt.timezone.utc).isoformat(),'trial_count':len(rows),'candidates':list(best.values())});finals=[]
    end=min(int(f.timestamp.max())+7_200_000 for f in load_data(120).values())
    for row in best.values():
        p=row['parameters'];ff=frames[p['minutes']];base,trades,path=evaluate_new(ff,p,ms('2026-02-01'),end);stress,_,_=evaluate_new(ff,p,ms('2026-02-01'),end,cost=2);gas,_,_=evaluate_new(ff,p,ms('2026-02-01'),end,cost=2,gas=1);train,_,_=evaluate_new(ff,p,ms('2024-01-01'),ms('2025-07-01'))
        final={**row,'test':base,'train':train,'cost_stress':stress,'gas_stress':gas,'robustness':{'positive_validation_and_test':row['validation']['net_profit_usd']>0 and base['net_profit_usd']>0,'positive_double_cost':stress['net_profit_usd']>0,'profitable_markets':sum(v['net']>0 for v in base['by_coin'].values()),'tested_markets':len(base['by_coin'])}};finals.append(final);write(f'trades_{row["id"]}.json',trades);write(f'equity_{row["id"]}.json',path);write('supplementary_final_results.json',finals)
    journal.close();write('supplementary_progress.json',{'status':'complete','trials':len(rows),'families':len(best),'elapsed_minutes':(time.time()-started)/60});print(json.dumps({'supplementary_trials':len(rows)}))
if __name__=='__main__':main()
