"""Read-only public depth recorder. Never imports trading or credentials code."""
import asyncio,json,time,datetime as dt,argparse
from pathlib import Path
import websockets

ROOT=Path(__file__).resolve().parent
class Book:
    def __init__(self):self.b={};self.a={};self.ready=False;self.seq=0;self.last=0;self.buy=0.;self.sell=0.;self.ofi=0.;self.previous=None
    def apply(self,message):
        data=message['data']
        if message.get('type')=='snapshot' or data.get('u')==1:
            self.b={};self.a={};self.ready=True;self.previous=None;self.ofi=0;self.seq=0
        if not self.ready:return
        seq=data.get('seq',0)
        if seq and self.seq and seq<self.seq:return
        self.seq=seq
        for key,side in [('b',self.b),('a',self.a)]:
            for price,qty in data.get(key,[]):
                price=float(price);qty=float(qty)
                if qty==0:side.pop(price,None)
                else:side[price]=qty
        self.last=time.time()
        if self.b and self.a:
            bid=max(self.b);ask=min(self.a);state=(bid,self.b[bid],ask,self.a[ask])
            if bid>=ask:self.ready=False;return
            if self.previous:
                bp,bq,ap,aq=self.previous
                self.ofi+=(state[1] if bid>=bp else 0)-(bq if bid<=bp else 0)-(state[3] if ask<=ap else 0)+(aq if ask>=ap else 0)
            self.previous=state
    def sample(self,symbol):
        if not self.ready or not self.b or not self.a:return None
        bids=sorted(self.b.items(),reverse=True)[:50];asks=sorted(self.a.items())[:50]
        bid,bq=bids[0];ask,aq=asks[0];mid=(bid+ask)/2
        bsum=sum(q for p,q in bids);asum=sum(q for p,q in asks)
        row={'utc_ms':int(time.time()*1000),'symbol':symbol,'mid':mid,'spread_bps':(ask-bid)/mid*10000,'depth_imbalance':(bsum-asum)/(bsum+asum),'microprice':(ask*bq+bid*aq)/(bq+aq),'ofi':self.ofi,'buy_qty':self.buy,'sell_qty':self.sell,'age_seconds':time.time()-self.last,'bids':bids,'asks':asks,'seq':self.seq}
        self.ofi=0.;self.buy=0.;self.sell=0.
        return row

async def main(minutes):
    books={s:Book() for s in ['BTCUSDT','ETHUSDT','SOLUSDT']};end=time.monotonic()+minutes*60;rows=0;reconnects=0
    target=(ROOT/'orderbook_samples.jsonl').open('a',encoding='utf-8')
    async def receive():
        nonlocal reconnects
        while time.monotonic()<end:
            try:
                async with websockets.connect('wss://stream.bybit.com/v5/public/linear',ping_interval=20,ping_timeout=20,max_size=4_000_000) as ws:
                    for b in books.values():b.ready=False;b.seq=0
                    await ws.send(json.dumps({'op':'subscribe','args':[topic+'.'+s for s in books for topic in ['orderbook.50','publicTrade']]}))
                    async for raw in ws:
                        if time.monotonic()>=end:return
                        message=json.loads(raw);topic=message.get('topic','')
                        if topic.startswith('orderbook.'):
                            symbol=topic.split('.')[-1]
                            if symbol in books:books[symbol].apply(message)
                        elif topic.startswith('publicTrade.'):
                            symbol=topic.split('.')[-1]
                            if symbol in books:
                                for trade in message.get('data',[]):
                                    if trade['S']=='Buy':books[symbol].buy+=float(trade['v'])
                                    else:books[symbol].sell+=float(trade['v'])
            except Exception as exc:
                reconnects+=1
                (ROOT/'orderbook_status.json').write_text(json.dumps({'status':'reconnecting','error_type':type(exc).__name__,'reconnects':reconnects}))
                await asyncio.sleep(3)
    task=asyncio.create_task(receive())
    while time.monotonic()<end:
        await asyncio.sleep(1)
        latest=[]
        for symbol,b in books.items():
            row=b.sample(symbol)
            if row and row['age_seconds']<5:target.write(json.dumps(row)+'\n');rows+=1;latest.append(row)
        target.flush()
        (ROOT/'orderbook_status.json').write_text(json.dumps({'status':'collecting','rows':rows,'markets':len(latest),'reconnects':reconnects,'latest_utc':dt.datetime.now(dt.timezone.utc).isoformat()}))
    task.cancel();target.close()
    (ROOT/'orderbook_status.json').write_text(json.dumps({'status':'complete','rows':rows,'reconnects':reconnects,'finished_utc':dt.datetime.now(dt.timezone.utc).isoformat()}))
    print(json.dumps({'rows':rows,'reconnects':reconnects}))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--minutes',type=float,default=90);a=p.parse_args();asyncio.run(main(a.minutes))
