"""Public dated ranks, available with a conservative two-day publication delay."""
import concurrent.futures,datetime as dt,json,re,time
from pathlib import Path
import requests
import numpy as np
ROOT=Path(__file__).resolve().parent
def fetch(day):
    target=ROOT/'marketcap_snapshots'/f'{day:%Y%m%d}.json';target.parent.mkdir(exist_ok=True)
    if target.exists():return json.loads(target.read_text())
    url=f'https://coinmarketcap.com/historical/{day:%Y%m%d}/'
    for attempt in range(3):
        try:
            response=requests.get(url,timeout=25)
            if response.status_code==429:time.sleep(min(30,int(response.headers.get('Retry-After','10'))));continue
            response.raise_for_status();m=re.search(r'<script[^>]*id="__NEXT_DATA__"[^>]*>(.*?)</script>',response.text,re.S)
            if not m:raise ValueError('No historical JSON')
            data=json.loads(m.group(1));state=data['props']['initialState'];state=json.loads(state) if isinstance(state,str) else state
            items=state['cryptocurrency']['listingHistorical']['data'];rows=[{'symbol':x['symbol'],'name':x['name'],'id':x['id'],'rank':int(x.get('cmcRank',x.get('rank',10000)))} for x in items]
            if len(rows)<100:raise ValueError('Incomplete snapshot')
            page_date=data['props']['pageProps'].get('dateWithHyphens')
            if page_date!=day.isoformat():raise ValueError('Snapshot date mismatch')
            result={'snapshot_date':day.isoformat(),'available_ms':int(dt.datetime.combine(day+dt.timedelta(days=2),dt.time(),tzinfo=dt.timezone.utc).timestamp()*1000),'source':url,'ranks':rows,'publication_delay_days_assumed':2}
            target.write_text(json.dumps(result));return result
        except Exception as exc:
            if attempt==2:return {'snapshot_date':day.isoformat(),'error':type(exc).__name__}
            time.sleep(1+attempt)
    return {'snapshot_date':day.isoformat(),'error':'RateLimited'}
_history=None
def eligibility_mask(coin,entry_times):
    global _history
    if _history is None:
        records=json.loads((ROOT/'marketcap_history.json').read_text())['snapshots'];_history=sorted([x for x in records if 'error' not in x],key=lambda x:x['available_ms'])
        for row in _history:row['top100']={x['symbol'] for x in row['ranks'] if 0<x['rank']<=100}
    times=np.array([r['available_ms'] for r in _history],dtype=np.int64);entry_times=np.asarray(entry_times,dtype=np.int64)
    if not len(times):return np.zeros(len(entry_times),bool)
    idx=np.searchsorted(times,entry_times,side='right')-1;valid=idx>=0;safe=np.maximum(idx,0);membership=np.array([coin in r['top100'] for r in _history],bool)
    return valid&(entry_times-times[safe]<=10*86_400_000)&membership[safe]
def eligible(coin,entry_ms):return bool(eligibility_mask(coin,[entry_ms])[0])
def filter_frames_for_rank(frames,minutes):
    import pandas as pd
    returns=pd.DataFrame({coin:pd.Series(f.return24.to_numpy(),index=f.timestamp.to_numpy()) for coin,f in frames.items()})
    for coin in returns:returns.loc[~eligibility_mask(coin,returns.index.to_numpy()+minutes*60_000),coin]=np.nan
    ranks=returns.rank(axis=1,pct=True)
    for coin,f in frames.items():f['strength_rank']=ranks[coin].reindex(f.timestamp).to_numpy()
    return frames
def main():
    start=dt.date(2023,12,24);end=dt.datetime.now(dt.timezone.utc).date();days=[]
    while start<=end:days.append(start);start+=dt.timedelta(days=7)
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:records=list(pool.map(fetch,days))
    result={'source':'CoinMarketCap dated weekly historical snapshots','created_utc':dt.datetime.now(dt.timezone.utc).isoformat(),'snapshot_count':len(records),'valid_count':sum('error' not in r for r in records),'policy':'Use latest snapshot only after a2-day publication delay; exclude entry when snapshot age exceeds10days; current14-market basket remains a selected subset, not a survivorship-free whole-market panel.','snapshots':records}
    (ROOT/'marketcap_history.json').write_text(json.dumps(result));(ROOT/'marketcap_status.json').write_text(json.dumps({k:v for k,v in result.items() if k!='snapshots'},indent=2));print(json.dumps({'snapshot_count':len(records),'valid_count':result['valid_count']}))
if __name__=='__main__':main()
