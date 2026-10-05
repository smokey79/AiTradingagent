"""Causal strategy families; all signals are evaluated after a candle closes."""
from __future__ import annotations
import numpy as np
import pandas as pd

FAMILIES=['mtf_pullback','compression_breakout','range_reclaim','anchored_vwap','exhaustion_reversal','inside_bar','engulfing_pullback','three_bar_reversal','obv_divergence','channel_retest','trendline_break','relative_strength','btc_lead_lag','rsi2_trend','efficiency_momentum','volatility_drift','session_breakout','range_zscore','volume_climax','prior_ema_baseline']

def shift(values,steps=1): return pd.Series(values).shift(steps).to_numpy()
def ema(series,n): return series.ewm(span=n,adjust=False,min_periods=n).mean()

def features(frame):
    f=frame.copy()
    c,h,l,o,v=[f[x] for x in ['close','high','low','open','volume']]
    prev=c.shift(1)
    tr=pd.concat([h-l,(h-prev).abs(),(l-prev).abs()],axis=1).max(axis=1)
    f['atr']=tr.ewm(alpha=1/14,adjust=False,min_periods=14).mean()
    f['atr_pct']=f.atr/c
    for n in [8,13,21,34,55,89,100,144,200]: f[f'ema{n}']=ema(c,n)
    delta=c.diff()
    for n in [2,14]:
        up=delta.clip(lower=0).ewm(alpha=1/n,adjust=False,min_periods=n).mean()
        dn=(-delta.clip(upper=0)).ewm(alpha=1/n,adjust=False,min_periods=n).mean()
        f[f'rsi{n}']=100-100/(1+up/dn.replace(0,np.nan))
        f.loc[(dn==0)&(up>0),f'rsi{n}']=100
    up=h.diff();down=-l.diff()
    pdm=up.where((up>down)&(up>0),0).ewm(alpha=1/14,adjust=False,min_periods=14).mean()
    mdm=down.where((down>up)&(down>0),0).ewm(alpha=1/14,adjust=False,min_periods=14).mean()
    plus=100*pdm/f.atr;minus=100*mdm/f.atr
    f['adx']=(100*(plus-minus).abs()/(plus+minus).replace(0,np.nan)).ewm(alpha=1/14,adjust=False,min_periods=14).mean()
    f['vol_ratio']=v/v.shift(1).rolling(30,min_periods=20).mean().replace(0,np.nan)
    f['return1']=c.pct_change()
    f['return6']=c.pct_change(6)
    f['return24']=c.pct_change(24)
    f['return72']=c.pct_change(72)
    f['rv']=np.log(c/prev).rolling(24,min_periods=20).std()
    f['rv_baseline']=f.rv.shift(1).rolling(100,min_periods=70).median()
    f['efficiency']=(c-c.shift(20)).abs()/c.diff().abs().rolling(20).sum().replace(0,np.nan)
    f['zscore']=(c-c.rolling(30).mean())/c.rolling(30).std().replace(0,np.nan)
    for n in [10,20,40,60]:
        f[f'high{n}']=h.shift(1).rolling(n).max()
        f[f'low{n}']=l.shift(1).rolling(n).min()
    width=(h-l).replace(0,np.nan)
    body=(c-o).abs()
    f['body_ratio']=body/width
    f['close_location']=(c-l)/width
    f['lower_wick']=(pd.concat([o,c],axis=1).min(axis=1)-l)/width
    f['upper_wick']=(h-pd.concat([o,c],axis=1).max(axis=1))/width
    f['engulf_up']=(c>o)&(prev<o.shift(1))&(c>=o.shift(1))&(o<=prev)
    f['engulf_down']=(c<o)&(prev>o.shift(1))&(c<=o.shift(1))&(o>=prev)
    f['inside']=(h<h.shift(1))&(l>l.shift(1))
    f['doji']=body/width<.12
    f['obv']=(np.sign(c.diff()).fillna(0)*v).cumsum()
    f['obv_delta']=f.obv.diff(10)/(v.rolling(10).sum().replace(0,np.nan))
    f['vwap_roll']=(c*v).rolling(24).sum()/v.rolling(24).sum().replace(0,np.nan)
    day=f.timestamp//86_400_000
    f['vwap_session']=(c*v).groupby(day).cumsum()/v.groupby(day).cumsum().replace(0,np.nan)
    # A pivot at i-3 is only known at i. No unconfirmed zigzag pivots are used.
    f['confirmed_high']=(h.shift(3)==h.rolling(7).max()).where(h.rolling(7).count()==7,False)
    f['confirmed_low']=(l.shift(3)==l.rolling(7).min()).where(l.rolling(7).count()==7,False)
    cp=(c*v).cumsum().to_numpy();cv=v.cumsum().to_numpy()
    avwap=np.full(len(f),np.nan);anchor=0
    for i in range(len(f)):
        if bool(f.confirmed_low.iloc[i]) or bool(f.confirmed_high.iloc[i]):anchor=max(0,i-3)
        base_p=cp[anchor-1] if anchor else 0;base_v=cv[anchor-1] if anchor else 0
        if cv[i]>base_v:avwap[i]=(cp[i]-base_p)/(cv[i]-base_v)
    f['anchored_vwap']=avwap
    # Confirmed descending/ascending trendlines need two past pivots.
    upper=np.full(len(f),np.nan);lower=np.full(len(f),np.nan)
    highs=[];lows=[]
    for i in range(len(f)):
        if bool(f.confirmed_high.iloc[i]): highs.append((i-3,float(h.iloc[i-3])))
        if bool(f.confirmed_low.iloc[i]): lows.append((i-3,float(l.iloc[i-3])))
        if len(highs)>1:
            a,b=highs[-2:]
            if b[1]<a[1] and i-b[0]<=60:upper[i]=b[1]+(b[1]-a[1])/(b[0]-a[0])*(i-b[0])
        if len(lows)>1:
            a,b=lows[-2:]
            if b[1]>a[1] and i-b[0]<=60:lower[i]=b[1]+(b[1]-a[1])/(b[0]-a[0])*(i-b[0])
    f['descending_line']=upper;f['ascending_line']=lower
    return f

def enrich(frames,minutes):
    out={coin:features(f) for coin,f in frames.items()}
    for coin,f in out.items():
        f['close_ms']=f.timestamp+minutes*60_000
        for multiplier,label in [(2,'confirm'),(4,'regime')]:
            source=frames[coin].copy()
            source.index=pd.to_datetime(source.timestamp,unit='ms',utc=True)
            h=source.resample(f'{minutes*multiplier}min',label='left',closed='left').agg({'open':'first','high':'max','low':'min','close':'last','volume':'sum','timestamp':'count'})
            h=h[h.timestamp==multiplier].dropna()
            h['timestamp']=h.index.astype('int64')//1_000_000
            hf=features(h.reset_index(drop=True))
            hf['close_ms']=hf.timestamp+minutes*multiplier*60_000
            columns=['close_ms','close','ema21','ema55','ema100','adx','efficiency','return6']
            joined=pd.merge_asof(f[['close_ms']].sort_values('close_ms'),hf[columns].sort_values('close_ms'),on='close_ms',direction='backward')
            for col in columns[1:]:f[label+'_'+col]=joined[col].to_numpy()
    returns=pd.DataFrame({coin:pd.Series(f.return24.to_numpy(),index=f.timestamp.to_numpy()) for coin,f in out.items()})
    ranks=returns.rank(axis=1,pct=True)
    for coin,f in out.items():
        f['strength_rank']=ranks[coin].reindex(f.timestamp).to_numpy()
        if 'BTC' in out:
            btc=out['BTC'].set_index('timestamp')
            f['btc_return1']=btc.return1.reindex(f.timestamp).to_numpy()
            f['btc_return6']=btc.return6.reindex(f.timestamp).to_numpy()
    return out

def signals(f,p):
    family=p['family'];fast=p.get('fast',21);slow=p.get('slow',55)
    c,o,h,l=f.close,f.open,f.high,f.low
    up=(f.regime_ema21>f.regime_ema55)&(f.confirm_close>f.confirm_ema21)
    down=(f.regime_ema21<f.regime_ema55)&(f.confirm_close<f.confirm_ema21)
    trend=f.regime_adx>p.get('adx',18)
    ef=f[f'ema{fast}'];es=f[f'ema{slow}']
    lu=pd.Series(False,index=f.index);sd=lu.copy()
    if family=='mtf_pullback':
        lu=up&trend&(l<ef)&(c>ef)&(c>o)&(f.rsi14.between(42,68))
        sd=down&trend&(h>ef)&(c<ef)&(c<o)&(f.rsi14.between(32,58))
    elif family=='compression_breakout':
        tight=f.rv.shift(1)<f.rv_baseline.shift(1)*p.get('compression',.8)
        lu=up&tight&(c>f.high20)&(f.vol_ratio>p.get('volume',1.2))
        sd=down&tight&(c<f.low20)&(f.vol_ratio>p.get('volume',1.2))
    elif family=='range_reclaim':
        lu=(l<f.low20)&(c>f.low20)&(f.lower_wick>.4)&(~down)
        sd=(h>f.high20)&(c<f.high20)&(f.upper_wick>.4)&(~up)
    elif family=='anchored_vwap':
        lu=up&(c>f.anchored_vwap)&(c.shift(1)<=f.anchored_vwap.shift(1))&(f.vol_ratio>.8)
        sd=down&(c<f.anchored_vwap)&(c.shift(1)>=f.anchored_vwap.shift(1))&(f.vol_ratio>.8)
    elif family=='exhaustion_reversal':
        lu=(f.rsi14<35)&(f.lower_wick>.5)&(f.vol_ratio>1.6)&(f.regime_adx<25)
        sd=(f.rsi14>65)&(f.upper_wick>.5)&(f.vol_ratio>1.6)&(f.regime_adx<25)
    elif family=='inside_bar':
        lu=up&f.inside.shift(1,fill_value=False)&(c>h.shift(1))&(f.body_ratio>.5)
        sd=down&f.inside.shift(1,fill_value=False)&(c<l.shift(1))&(f.body_ratio>.5)
    elif family=='engulfing_pullback':
        lu=up&f.engulf_up&(l<ef)&(f.rsi14<65)
        sd=down&f.engulf_down&(h>ef)&(f.rsi14>35)
    elif family=='three_bar_reversal':
        lu=up&(c.shift(2)<o.shift(2))&(f.body_ratio.shift(1)<.3)&(c>h.shift(2))&(c>o)
        sd=down&(c.shift(2)>o.shift(2))&(f.body_ratio.shift(1)<.3)&(c<l.shift(2))&(c<o)
    elif family=='obv_divergence':
        lu=(l<f.low10)&(f.obv_delta>.15)&(c>o)&(~down)
        sd=(h>f.high10)&(f.obv_delta<-.15)&(c<o)&(~up)
    elif family=='channel_retest':
        lu=up&(c.shift(1)>f.high20.shift(1))&(l<=f.high20.shift(1))&(c>f.high20.shift(1))
        sd=down&(c.shift(1)<f.low20.shift(1))&(h>=f.low20.shift(1))&(c<f.low20.shift(1))
    elif family=='trendline_break':
        lu=(c>f.descending_line)&(c.shift(1)<=f.descending_line.shift(1))&(~down)&(f.vol_ratio>1)
        sd=(c<f.ascending_line)&(c.shift(1)>=f.ascending_line.shift(1))&(~up)&(f.vol_ratio>1)
    elif family=='relative_strength':
        lu=up&(f.strength_rank>p.get('rank',.7))&(c>ef)&(c.shift(1)<=ef.shift(1))
        sd=down&(f.strength_rank<1-p.get('rank',.7))&(c<ef)&(c.shift(1)>=ef.shift(1))
    elif family=='btc_lead_lag':
        if 'btc_return6' in f:
            lu=(f.btc_return6>p.get('btc_move',.007))&(f.return6<f.btc_return6*.5)&up&(c>o)
            sd=(f.btc_return6<-p.get('btc_move',.007))&(f.return6>f.btc_return6*.5)&down&(c<o)
    elif family=='rsi2_trend':
        lu=up&(f.rsi2<p.get('rsi',15))&(c>es)
        sd=down&(f.rsi2>100-p.get('rsi',15))&(c<es)
    elif family=='efficiency_momentum':
        lu=up&(f.efficiency>p.get('efficiency',.35))&(c>f.high10)&(f.vol_ratio>1)
        sd=down&(f.efficiency>p.get('efficiency',.35))&(c<f.low10)&(f.vol_ratio>1)
    elif family=='volatility_drift':
        lu=up&(f.rv<f.rv_baseline*.8)&(c>ef)&(ef>es)&(f.return6>0)&(f.return6.shift(1)<=0)
        sd=down&(f.rv<f.rv_baseline*.8)&(c<ef)&(ef<es)&(f.return6<0)&(f.return6.shift(1)>=0)
    elif family=='session_breakout':
        hour=(f.timestamp//3_600_000)%24
        lu=up&hour.between(7,16)&(c>f.high20)&(f.vol_ratio>1.5)
        sd=down&hour.between(7,16)&(c<f.low20)&(f.vol_ratio>1.5)
    elif family=='range_zscore':
        quiet=(f.regime_adx<p.get('adx',20))&(f.efficiency<.3)
        lu=quiet&(f.zscore<-p.get('z',2))&(c>o)
        sd=quiet&(f.zscore>p.get('z',2))&(c<o)
    elif family=='volume_climax':
        lu=(f.vol_ratio>2.5)&(f.lower_wick>.45)&(l<f.low10)&(c>o)&(~down)
        sd=(f.vol_ratio>2.5)&(f.upper_wick>.45)&(h>f.high10)&(c<o)&(~up)
    elif family=='prior_ema_baseline':
        lu=(ef>es)&(ef.shift(1)<=es.shift(1))&(c>f.vwap_session)
        sd=(ef<es)&(ef.shift(1)>=es.shift(1))&(c<f.vwap_session)
    else: raise ValueError('Unknown strategy family')
    mode=p.get('direction','both')
    if mode=='long':sd&=False
    if mode=='short':lu&=False
    usable=(f.atr_pct.between(.001,.08))&(f.volume>0)&f.regime_ema55.notna()
    signal=np.where(lu&usable,1,np.where(sd&usable,-1,0)).astype(np.int8)
    return signal

def parameters(family,variant=0,minutes=60):
    return {'family':family,'minutes':minutes,'fast':[13,21,34][variant%3],'slow':[55,89,100][(variant//3)%3],
            'atr_stop':[1.5,2.,2.5][variant%3],'reward_risk':[1.5,2.,3.][(variant//3)%3],
            'adx':[15,20,25][(variant//9)%3],'max_hold_hours':min(120,[24,48,96][(variant//3)%3]),
            'direction':['both','long','short'][(variant//27)%3], 'variant':variant,
            'compression':[.7,.85,1.][variant%3],'volume':[1,1.2,1.5][variant%3],
            'rank':[.6,.7,.8][variant%3],'efficiency':[.25,.35,.45][variant%3],'rsi':[10,15,20][variant%3],
            'z':[1.5,2.,2.5][variant%3],'btc_move':[.005,.007,.01][variant%3]}
