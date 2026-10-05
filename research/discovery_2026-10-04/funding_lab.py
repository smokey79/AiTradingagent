"""Collect public historical signed funding rates; no account access."""
import concurrent.futures,json,time,datetime as dt
from pathlib import Path
import requests
ROOT=Path(__file__).resolve().parent;START=1704067200000
def collect(coin):
    cursor=int(time.time()*1000);rows=[];error=None;complete=False
    try:
        for _ in range(80):
            response=requests.get('https://api.bybit.com/v5/market/funding/history',params={'category':'linear','symbol':coin+'USDT','endTime':cursor,'limit':200},timeout=20);response.raise_for_status();d=response.json()
            if d.get('retCode')!=0:raise ValueError('Public history unavailable')
            batch=d.get('result',{}).get('list',[])
            if not batch:complete=True;break
            rows.extend((int(x['fundingRateTimestamp']),float(x['fundingRate'])) for x in batch if int(x['fundingRateTimestamp'])>=START)
            cursor=min(int(x['fundingRateTimestamp']) for x in batch)-1
            if cursor<START:complete=True;break
            time.sleep(.12)
    except Exception as exc:error=type(exc).__name__
    values=sorted(set(rows));(ROOT/'funding').mkdir(exist_ok=True);(ROOT/'funding'/f'{coin}.json').write_text(json.dumps(values))
    return {'coin':coin,'settlements':len(values),'first_ms':values[0][0] if values else None,'last_ms':values[-1][0] if values else None,'complete_to_start_or_listing':complete,'error':error}
manifest=json.loads((ROOT/'data_manifest.json').read_text());coins=[r['coin'] for r in manifest['datasets'] if r.get('source')=='bybit_linear']
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:rows=list(pool.map(collect,coins))
(ROOT/'funding_manifest.json').write_text(json.dumps({'created_utc':dt.datetime.now(dt.timezone.utc).isoformat(),'source':'Bybit public signed funding settlement history','markets':rows},indent=2));print(json.dumps({'markets':len(rows),'complete':sum(x['complete_to_start_or_listing'] for x in rows),'settlements':sum(x['settlements'] for x in rows)}))
