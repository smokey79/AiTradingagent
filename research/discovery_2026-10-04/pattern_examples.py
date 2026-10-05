"""Historical candle diagrams selected by chronological occurrence."""
from pathlib import Path
import json,html
from data_lab import load_data
from strategies_lab import features
import pandas as pd
ROOT=Path(__file__).resolve().parent
f=features(load_data(60)['BTC']);masks={'Bullish engulfing':f.engulf_up,'Bearish engulfing':f.engulf_down,'Lower-wick rejection':(f.lower_wick>.5)&(f.close>f.open),'Inside-bar upside break':f.inside.shift(1,fill_value=False)&(f.close>f.high.shift(1)),'Three-bar upside reversal':(f.close.shift(2)<f.open.shift(2))&(f.body_ratio.shift(1)<.3)&(f.close>f.high.shift(2))};examples=[]
svg=['<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="1540" viewBox="0 0 1100 1540"><rect width="1100" height="1540" fill="#101721"/><g font-family="sans-serif" fill="#e5edf5"><text x="30" y="35" font-size="24">Recurring candle forms — historical BTC / USDT, 1h</text><text x="30" y="61" font-size="14">Chronological examples after indicator warm-up. Shaded bar is the completed pattern; later bars show outcomes.</text>']
for panel,(name,mask) in enumerate(masks.items()):
    indices=f.index[mask&(f.index>=250)];i=int(indices[0]);window=f.iloc[i-12:i+5];start=105+panel*280;lo=window.low.min();hi=window.high.max();span=hi-lo
    def y(price):return start+225-(float(price)-lo)/span*175
    stamp=pd.to_datetime(int(f.timestamp.iloc[i]),unit='ms',utc=True).isoformat();svg.append(f'<text x="30" y="{start}" font-size="20">{html.escape(name)} · {stamp}</text>')
    for j in range(5):
        price=lo+span*j/4;yy=y(price);svg.append(f'<line x1="100" x2="1050" y1="{yy:.2f}" y2="{yy:.2f}" stroke="#28384b"/><text x="20" y="{yy+4:.2f}" font-size="12">{price:.0f}</text>')
    svg.append(f'<rect x="{120+12*53-19}" y="{start+40}" width="38" height="190" fill="#344c74" opacity=".7"/>')
    for j,(_,r) in enumerate(window.iterrows()):
        x=120+j*53;color='#40d4ae' if r.close>=r.open else '#f1857d';top=min(y(r.open),y(r.close));height=max(2,abs(y(r.open)-y(r.close)));svg.append(f'<line x1="{x}" x2="{x}" y1="{y(r.high):.2f}" y2="{y(r.low):.2f}" stroke="{color}"/><rect x="{x-12}" y="{top:.2f}" width="24" height="{height:.2f}" fill="{color}"/>')
    nextmove=float(f.close.iloc[i+3]/f.open.iloc[i+1]-1)*100;svg.append(f'<text x="100" y="{start+253}" font-size="14">Next-open to third future close: {nextmove:+.3f}% gross, before costs</text>');examples.append({'pattern':name,'pattern_timestamp_ms':int(f.timestamp.iloc[i]),'utc':stamp,'gross_next_open_to_third_close_pct':nextmove,'selection':'first chronological occurrence after250-bar warm-up'})
svg.append('</g></svg>');(ROOT/'candle_pattern_examples.svg').write_text(''.join(svg),encoding='utf-8');(ROOT/'candle_pattern_examples.json').write_text(json.dumps(examples,indent=2));print(json.dumps({'examples':len(examples)}))
