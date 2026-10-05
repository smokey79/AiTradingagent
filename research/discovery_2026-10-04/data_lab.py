"""Public market-data preparation. No credentials, orders, or bot startup."""
from __future__ import annotations
import concurrent.futures
import datetime as dt
import hashlib
import json
from pathlib import Path
import time
import numpy as np
import pandas as pd
import requests

ROOT=Path(__file__).resolve().parent
CACHE=Path('F:/aitradingagent/data/ohlcv')
COINS=['BTC','ETH','SOL','AVAX','ARB','OP','CRO','LTC','TRX','ZEC','SUI','ICP','AAVE','ATOM','POL','FLR']
START=int(dt.datetime(2024,1,1,tzinfo=dt.timezone.utc).timestamp()*1000)

def get(url,params=None):
    for attempt in range(3):
        try:
            response=requests.get(url,params=params,timeout=20)
            response.raise_for_status()
            return response.json()
        except requests.RequestException:
            if attempt==2: raise
            time.sleep(1+attempt)

def universe():
    target=ROOT/'universe.json'
    if target.exists(): return json.loads(target.read_text())
    try:
        rows=get('https://api.coingecko.com/api/v3/coins/markets',{'vs_currency':'usd','order':'market_cap_desc','per_page':100,'page':1})
        if not isinstance(rows,list) or len(rows)<80: raise ValueError('Incomplete market-cap universe')
        data={'retrieved_utc':dt.datetime.now(dt.timezone.utc).isoformat(),'source':'CoinGecko public coins/markets','coins':[{'symbol':r['symbol'].upper(),'name':r['name'],'rank':r.get('market_cap_rank'),'id':r['id']} for r in rows]}
    except Exception as exc:
        data={'retrieved_utc':dt.datetime.now(dt.timezone.utc).isoformat(),'source':'unavailable','error_type':type(exc).__name__,'coins':[]}
    target.write_text(json.dumps(data,indent=2))
    return data

def prepare_coin(coin):
    destination=ROOT/'datasets'/f'{coin}.csv'
    destination.parent.mkdir(exist_ok=True)
    sources=[CACHE/f'pyb_bybit_{coin}_15m.csv',CACHE/f'pyb_binance_{coin}_15m.csv']
    source=next((p for p in sources if p.exists()),None)
    if source is None: return {'coin':coin,'error':'no_cached_candles'}
    frame=pd.read_csv(source)
    source_name='bybit_linear' if 'bybit' in source.name else 'binance_spot'
    frame=frame[frame.timestamp>=START].copy()
    refresh='not_attempted'
    if source_name=='bybit_linear':
        try:
            cursor=int(frame.timestamp.max())+900_000
            end=int(time.time()*1000)
            more=[]
            for page in range(8):
                result=get('https://api.bybit.com/v5/market/kline',{'category':'linear','symbol':coin+'USDT','interval':'15','start':cursor,'end':end,'limit':1000})
                if result.get('retCode')!=0: raise ValueError('Public kline request rejected')
                rows=result['result']['list']
                if not rows: break
                more.extend([[int(r[0]),*map(float,r[1:6])] for r in rows])
                end=min(int(r[0]) for r in rows)-1
                if end<cursor: break
                time.sleep(.15)
            if more:
                frame=pd.concat([frame,pd.DataFrame(more,columns=['timestamp','open','high','low','close','volume'])],ignore_index=True)
            refresh='public_refresh_succeeded'
        except Exception as exc: refresh='cached_only_'+type(exc).__name__
    frame=frame.sort_values('timestamp').drop_duplicates('timestamp')
    now=int(time.time()*1000)
    good=(frame.timestamp+900_000<=now)&(frame.low>0)&(frame.high>=frame[['open','close','low']].max(axis=1))&(frame.low<=frame[['open','close']].min(axis=1))&(frame.volume>=0)
    frame=frame[good]
    frame.to_csv(destination,index=False)
    gaps=int((frame.timestamp.diff().dropna()!=900_000).sum())
    return {'coin':coin,'source':source_name,'source_file':str(source),'rows':len(frame),'first_ms':int(frame.timestamp.min()),'last_ms':int(frame.timestamp.max()),'gaps':gaps,'refresh':refresh,'sha256':hashlib.sha256(destination.read_bytes()).hexdigest()}

def prepare():
    caps=universe()
    eligible={r['symbol'] for r in caps['coins']}
    coins=[coin for coin in COINS if coin in eligible] if eligible else COINS
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        records=list(pool.map(prepare_coin,coins))
    manifest={'created_utc':dt.datetime.now(dt.timezone.utc).isoformat(),'market_cap_verified':bool(eligible),'universe_warning':'Current top-100 selection is survivorship-biased for historical tests; historical market-cap membership is not reconstructed.','datasets':records,'splits':{'train_end':'2025-07-01','validation_end':'2026-02-01','test_start':'2026-02-01'}}
    (ROOT/'data_manifest.json').write_text(json.dumps(manifest,indent=2))
    print(json.dumps({'prepared':len(records),'market_cap_verified':bool(eligible),'rows':sum(r.get('rows',0) for r in records)}),flush=True)
    return manifest

def load_data(minutes=60):
    manifest=json.loads((ROOT/'data_manifest.json').read_text())
    result={}
    for record in manifest['datasets']:
        if 'error' in record or record.get('source')!='bybit_linear': continue
        frame=pd.read_csv(ROOT/'datasets'/f"{record['coin']}.csv")
        frame.index=pd.to_datetime(frame.timestamp,unit='ms',utc=True)
        size=minutes//15
        agg=frame.resample(f'{minutes}min',label='left',closed='left').agg({'open':'first','high':'max','low':'min','close':'last','volume':'sum','timestamp':'count'})
        agg=agg[agg.timestamp==size].dropna()
        agg['timestamp']=agg.index.astype('int64')//1_000_000
        result[record['coin']]=agg.reset_index(drop=True)
    return result

if __name__=='__main__': prepare()
