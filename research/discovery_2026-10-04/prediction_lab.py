"""Simple cost-aware next-candle predictor; training uses only past rows."""
import argparse,json,datetime as dt
from pathlib import Path
import numpy as np
from data_lab import load_data
from strategies_lab import enrich

ROOT=Path(__file__).resolve().parent
COLS=['return1','return6','return24','rsi14','atr_pct','adx','efficiency','vol_ratio','body_ratio','lower_wick','upper_wick','strength_rank']
def ms(s):return int(dt.datetime.fromisoformat(s).replace(tzinfo=dt.timezone.utc).timestamp()*1000)
def rows(frames,horizon):
    xx=[];yy=[];tt=[];coins=[]
    for coin,f in frames.items():
        x=f[COLS].to_numpy(float)
        # Forecast the tradeable next-open to future-close move, not an inaccessible prior-close fill.
        y=(f.close.shift(-horizon)/f.open.shift(-1)-1).to_numpy()
        t=f.timestamp.to_numpy(np.int64)+3_600_000
        good=np.isfinite(x).all(axis=1)&np.isfinite(y)&(f.timestamp.shift(-horizon)-f.timestamp==horizon*3_600_000).to_numpy()
        xx.append(x[good]);yy.append(y[good]);tt.append(t[good]);coins.extend([coin]*int(good.sum()))
    return np.concatenate(xx),np.concatenate(yy),np.concatenate(tt),np.array(coins)
def fit(x,y,alpha):
    mean=x.mean(axis=0);scale=x.std(axis=0);scale[scale<1e-9]=1
    z=np.column_stack([np.ones(len(x)),np.clip((x-mean)/scale,-10,10)])
    penalty=np.eye(z.shape[1])*alpha*len(z);penalty[0,0]=0
    coef=np.linalg.solve(z.T@z+penalty,z.T@y)
    return {'mean':mean.tolist(),'scale':scale.tolist(),'coef':coef.tolist(),'alpha':alpha,'feature_names':COLS}
def predict(x,model):return np.column_stack([np.ones(len(x)),np.clip((x-np.array(model['mean']))/np.array(model['scale']),-10,10)])@np.array(model['coef'])
def summary(y,forecast,threshold,coins):
    side=np.sign(forecast);use=np.abs(forecast)>threshold
    # Independent opportunities: deliberately not a qualified portfolio or uncorrelated trades.
    costs=np.where(np.isin(coins,['BTC','ETH']),.0016,.0020)
    net=side*y-costs
    yy=net[use];gp=yy[yy>0].sum();gl=-yy[yy<0].sum()
    return {'observations':len(y),'direction_accuracy_pct':float(100*np.mean(side==np.sign(y))),'always_up_accuracy_pct':float(100*np.mean(y>0)),'mean_absolute_error':float(np.mean(np.abs(forecast-y))),'filtered_observations':int(use.sum()),'filtered_accuracy_pct':float(100*np.mean(side[use]==np.sign(y[use]))) if use.any() else None,'filtered_mean_net_return_bps':float(10000*yy.mean()) if len(yy) else None,'overlapping_opportunity_profit_factor':float(gp/gl) if gl else None,'status':'forecast diagnostic only; overlapping events cannot satisfy 250 independent trades or portfolio drawdown'}
def main(final=False):
    frames=enrich(load_data(60),60);out=[]
    frozen_path=ROOT/'prediction_frozen.json'
    frozen=json.loads(frozen_path.read_text()) if final else []
    for horizon in [1,2,3]:
        x,y,t,coin=rows(frames,horizon)
        train=(t<ms('2025-07-01')-horizon*3_600_000);val=(t>=ms('2025-07-01'))&(t<ms('2026-02-01')-horizon*3_600_000)
        if not final:
            candidates=[]
            for alpha in [.001,.01,.1,1.]:
                model=fit(x[train],y[train],alpha);forecast=predict(x[val],model)
                for threshold in [.002,.003,.005,.008]:
                    result=summary(y[val],forecast,threshold,coin[val]);n=result['filtered_observations']
                    score=(result['filtered_mean_net_return_bps'] or -1000) if n>=250 else -1000
                    candidates.append({'horizon_candles':horizon,'model':model,'threshold':threshold,'validation':result,'selection_score':score})
            best=max(candidates,key=lambda z:z['selection_score']);out.append(best)
        else:
            row=next(r for r in frozen if r['horizon_candles']==horizon);test=t>=ms('2026-02-01');forecast=predict(x[test],row['model'])
            out.append({**row,'test':summary(y[test],forecast,row['threshold'],coin[test])})
    (ROOT/('prediction_results.json' if final else 'prediction_frozen.json')).write_text(json.dumps(out,indent=2,allow_nan=False))
    print(json.dumps({'phase':'final' if final else 'validation_frozen','horizons':len(out)}))
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--final',action='store_true');a=p.parse_args();main(a.final)
