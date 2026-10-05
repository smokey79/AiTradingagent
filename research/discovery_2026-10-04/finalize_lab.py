"""Build honest rankings and reproduction artifacts after the timed run ends."""
import json,time,datetime as dt,subprocess,sys,html,hashlib
from pathlib import Path
import numpy as np
import pandas as pd
ROOT=Path(__file__).resolve().parent
RULES={
'mtf_pullback':'Higher trend EMA21/55 and confirmation close/EMA21 aligned; regime ADX above setting; candle crosses selected fast EMA with directional close; RSI14 42–68 long / 32–58 short.',
'compression_breakout':'Prior 24-bar realised volatility below prior 100-bar median times compression setting; aligned higher direction; close breaks prior 20-bar high/low; volume above multiplier of prior 30-bar mean.',
'range_reclaim':'Sweep prior 20-bar low/high then close back within range; rejection wick exceeds 40% of candle range; disallow opposite aligned higher direction.',
'anchored_vwap':'Cross VWAP anchored at most recently confirmed seven-bar pivot, with higher direction aligned; volume ratio above 0.8. Pivot is confirmed three bars late.',
'exhaustion_reversal':'RSI14 below35/above65, rejection wick above50%, volume ratio above1.6 and higher ADX below25.',
'inside_bar':'Previous candle is inside its predecessor; current close breaks previous high/low, body exceeds50% of range and higher direction aligns.',
'engulfing_pullback':'Bullish/bearish body engulfing at selected fast EMA, higher direction aligned, RSI14 below65 for long / above35 for short.',
'three_bar_reversal':'Two-bars-ago candle opposes entry direction, previous body below30% of range, current close breaks two-bars-ago high/low and aligns higher direction.',
'obv_divergence':'New prior10-bar price low/high with positive/negative normalised10-bar OBV change above0.15 magnitude, directional candle, no opposite higher alignment.',
'channel_retest':'Previous close breaks its prior20-bar channel; current candle retests that frozen breakout boundary and closes on breakout side, with higher direction aligned.',
'trendline_break':'Close crosses projected line from last two confirmed descending highs/ascending lows; line age at most60 bars; volume ratio above1; no opposite higher alignment.',
'relative_strength':'Higher direction aligned; selected fast EMA recross; own24-bar return rank above rank setting / below 1-rank across simultaneous eligible markets.',
'btc_lead_lag':'BTC six-bar return exceeds movement setting; asset move less than half BTC move in that direction; own higher trend and current candle align.',
'rsi2_trend':'Aligned higher direction; RSI2 below setting / above100-setting; close on trend side of selected slow EMA.',
'efficiency_momentum':'Aligned higher direction; 20-bar efficiency exceeds setting; close breaks prior10-bar high/low; volume ratio above1.',
'volatility_drift':'Aligned higher direction and fast/slow EMAs; realised volatility below0.8 times prior median; six-bar return turns positive/negative.',
'session_breakout':'Aligned higher direction; UTC candle start hour07–16 inclusive; close breaks prior20-bar high/low; volume ratio above1.5.',
'range_zscore':'Higher ADX below setting and20-bar efficiency below0.3; 30-bar close z-score outside setting; candle closes toward mean.',
'volume_climax':'Volume ratio above2.5, rejection wick above45%, new prior10-bar extreme, directional close; disallow opposite higher alignment.',
'prior_ema_baseline':'Comparison only: selected fast/slow EMA crossover and close on corresponding side of UTC session VWAP.'}
RULES.update({'funding_crowd_fade':'Latest published settled funding rate, delayed by one full hour, exceeds positive/negative threshold; RSI14 above60/below40; directional reversal candle; higher ADX below25 and no opposing higher alignment. This is a crowding hypothesis, not delta-neutral arbitrage.','funding_settlement_breakout':'One-hour publication lag on known past funding settlements; candle close1h to event-window setting after last eligible settlement; prior10-bar breakout; volume above selected ratio; higher direction aligned.','sign_reversal_costfilter':'Fade sign of the just-completed close-to-close return only when magnitude exceeds minimum-move setting; optionally require higher ADX below20 for range regime. No historical taker-flow filter is fabricated.'})
def read(name):return json.loads((ROOT/name).read_text())
def bootstrap(trades,seed=91):
    if not trades:return {'net_profit_95pct_interval_usd':[0,0],'profit_factor_95pct_interval':[0,0]}
    df=pd.DataFrame(trades);df['day']=df.exit_ms//86_400_000;df['gain']=df.net_pnl.clip(lower=0);df['loss']=-df.net_pnl.clip(upper=0)
    daily=df.groupby('day')[['gain','loss']].sum();daily=daily.reindex(range(int(daily.index.min()),int(daily.index.max())+1),fill_value=0).to_numpy();n=len(daily);rng=np.random.default_rng(seed)
    sums=[]
    for _ in range(1000):
        starts=rng.integers(0,n,size=(n+6)//7);idx=np.concatenate([(s+np.arange(7))%n for s in starts])[:n];gp,gl=daily[idx].sum(axis=0);sums.append([gp-gl,gp/max(gl,1e-9)])
    a=np.array(sums)
    return {'method':'1000 circular seven-day block resamples of realised exit-day PnL; correlated coins grouped per day; not selection adjusted','net_profit_95pct_interval_usd':np.quantile(a[:,0],[.025,.975]).tolist(),'profit_factor_95pct_interval':np.quantile(a[:,1],[.025,.975]).tolist()}
def book_audit():
    target=ROOT/'orderbook_samples.jsonl';rows=[]
    if not target.exists():return {'status':'no_samples'}
    with target.open() as f:
        for line in f:
            try:
                r=json.loads(line);b=r.pop('bids');a=r.pop('asks');r['ofi_scaled']=r['ofi']/max(b[0][1]+a[0][1],1e-9);r['trade_imbalance']=(r['buy_qty']-r['sell_qty'])/max(r['buy_qty']+r['sell_qty'],1e-9);rows.append(r)
            except (ValueError,KeyError,IndexError):pass
    out=[]
    if not rows:return {'status':'no_fresh_samples'}
    df=pd.DataFrame(rows)
    for symbol,g in df.groupby('symbol'):
        g=g.sort_values('utc_ms').reset_index(drop=True);y=g.mid.shift(-5)/g.mid-1
        good=y.notna()&((g.utc_ms.shift(-5)-g.utc_ms).between(4000,7000))
        x=g[['depth_imbalance','ofi_scaled','trade_imbalance']].clip(-10,10).to_numpy();x=np.column_stack([np.ones(len(x)),x]);cut=int(len(g)*.6);train=np.flatnonzero(good&(g.index<cut-5));test=np.flatnonzero(good&(g.index>=cut))[::5]
        if len(train)<100 or len(test)<50:continue
        coef=np.linalg.solve(x[train].T@x[train]+np.eye(4)*1e-4,x[train].T@y.iloc[train].to_numpy());pred=x[test]@coef;actual=y.iloc[test].to_numpy();side=np.sign(pred);cost=.0016 if symbol in ('BTCUSDT','ETHUSDT') else .002
        out.append({'symbol':symbol,'samples':len(g),'nonoverlapping_test_predictions':len(test),'horizon_seconds_approx':5,'direction_accuracy_pct':float(100*np.mean(side==np.sign(actual))),'mean_gross_signed_bps':float(10000*np.mean(side*actual)),'mean_after_assumed_roundtrip_cost_bps':float(10000*(np.mean(side*actual)-cost)),'cost_bps':cost*10000,'qualifies':False,'reason':'Short observational sample, no execution/queue model, no stop/portfolio backtest; research adviser only'})
    return {'sample_rows':len(rows),'markets':out,'status':'observational_pilot'}
def main():
    while True:
        try:
            session=read('session.json');adaptive=read('adaptive_progress.json');book=read('orderbook_status.json');supplement=read('supplementary_progress.json')
            if session.get('status')=='complete' and session.get('actual_elapsed_minutes',0)>=90 and adaptive.get('status')=='complete' and book.get('status')=='complete' and supplement.get('status')=='complete':break
        except (OSError,json.JSONDecodeError):pass
        time.sleep(5)
    subprocess.run([sys.executable,str(ROOT/'prediction_lab.py'),'--final'],cwd=ROOT,check=True)
    subprocess.run([sys.executable,str(ROOT/'pattern_lab.py')],cwd=ROOT,check=True)
    # Choose the main/adaptive representative of each family by validation score ONLY.
    selected={}
    for row in read('final_results.json')+read('adaptive_final_results.json')+read('supplementary_final_results.json'):
        fam=row['parameters']['family']
        if fam not in selected or row['rank_score']>selected[fam]['rank_score']:selected[fam]=row
    for row in selected.values():
        row['bootstrap']=bootstrap(read('trades_'+row['id']+'.json'));row['rules']=RULES[row['parameters']['family']]
        row['timeframes_minutes']={'entry':row['parameters']['minutes'],'confirmation':row['parameters']['minutes']*2,'direction':row['parameters']['minutes']*4}
        row['qualification_failures']=[label for okay,label in [(row['test']['net_profit_usd']>0,'net loss'),(row['test']['trades']>=250,'fewer than250 trades'),(row['test']['profit_factor']>1.12 and row['test']['return_profit_factor']>1.12,'profit factor threshold'),(row['test']['max_drawdown_pct']<=20,'drawdown threshold')] if not okay]
    def key(r):
        robust=r['robustness'];m=r['test'];breadth=robust['profitable_markets']/max(1,robust['tested_markets']);stable=min(r['train']['profit_factor'],r['validation']['profit_factor'],m['profit_factor'])
        return (m['qualifies'],robust['positive_validation_and_test'],robust['positive_double_cost'],r['bootstrap']['net_profit_95pct_interval_usd'][0]>0,breadth,stable,-m['max_drawdown_pct'],m['trades'],m['net_profit_usd'])
    ranked=sorted([r for fam,r in selected.items() if fam!='prior_ema_baseline'],key=key,reverse=True)
    for i,r in enumerate(ranked):r['rank']=i+1
    (ROOT/'ranked_strategies.json').write_text(json.dumps(ranked,indent=2,allow_nan=False));(ROOT/'orderbook_pilot_results.json').write_text(json.dumps(book_audit(),indent=2))
    variants=session['variants_tested']+adaptive['variants_tested']+supplement['trials'];qualified=[r for r in ranked if r['test']['qualifies']]
    manifest=read('data_manifest.json');markets=[r['coin'] for r in manifest['datasets'] if r.get('source')=='bybit_linear']
    lines=['# Crypto strategy discovery — 4 October 2026','',f'Actual timed run: **{session["actual_elapsed_minutes"]:.2f} minutes**. {variants:,} parameter trials across {session["families_tested"]} main families, plus failure-directed refinements. Trading bots stayed stopped.','',f'**{len(qualified)} of {len(ranked)} distinct research families qualify on the final test.** Fifteen ranked candidates are provided below; failed candidates are labelled, never promoted as profitable strategies.','',f'Markets: {", ".join(markets)} USDT perpetuals selected from the current top100 with available history. This is a14-market screen, not all100.','', 'Training: Jan2024–Jun2025. Validation: Jul2025–Jan2026. Reserved final test: Feb2026–latest common complete data on4Oct2026. POL begins later. Current market-cap selection and instrument filters introduce survivorship/historical-specification limits.','', 'Qualification: positive net profit, at least250 completed portfolio trades, dollar and notional-return PF>1.12, maximum drawdown≤20%. These screening rules do not establish future profitability.','', '|Rank|Strategy|Entry / confirm / direction|Trades|Net USD / %|PF|Max DD|Win %|Double-cost net USD|Pass|','|---:|---|---|---:|---:|---:|---:|---:|---:|---|']
    for r in ranked[:15]:
        p=r['parameters'];m=r['test'];tf=p['minutes'];lines.append(f'|{r["rank"]}|{p["family"]}|{tf}/{tf*2}/{tf*4} min|{m["trades"]}|{m["net_profit_usd"]:.2f} / {m["net_profit_pct"]:.2f}%|{m["profit_factor"]:.3f}|{m["max_drawdown_pct"]:.2f}%|{m["win_rate_pct"]:.1f}%|{r["cost_stress"]["net_profit_usd"]:.2f}|{"YES" if m["qualifies"] else "NO"}|')
    lines+=['','Rank prioritises qualification, positive validation/test, doubled-cost survival, block-bootstrap lower bound, profitable market breadth, worst train/validation/test PF, drawdown, trade count and net profit. The per-family representative was chosen using validation score only. The rank itself describes final-test results and must not be used to retune that period.','', '## Reproducible rules and settings','', 'Every family uses only completed candles, next-open entry, ATR14, fixed ATR stop, fixed reward/risk target, opposite-signal next-open exit and holding limit. Higher direction uses4× entry timeframe EMA21/55; confirmation uses2× entry close relative toEMA21. Stop fills take adverse gaps; ambiguous stop/target bars stop first. EMA uses pandas recursive exponential weighting, not Pine SMA-seeded EMA. ATR/RSI/ADX use recursive Wilder smoothing. Default account$250, risk0.5%, max3 positions, per-market25%, total60%, no leverage. Current exchange quantity increments and minimums apply. Fees0.06% per side; spread/slippage2bps BTC/ETH or4bps others plus participation impact; funding1bp per8h debit; gas0 for CEX. Stress doubles trading fees/slippage; separate gas stress adds$1 per round trip. These are cost assumptions, not an account-specific fee quotation.','']
    for r in ranked[:15]:
        p=r['parameters'];tf=p['minutes'];lines += [f'### {r["rank"]}. {p["family"]} — {r["id"]}','',r['rules'],'',f'Settings: entry{tf}min; EMA{p["fast"]}/{p["slow"]} ({p["fast"]*tf/60:.1f}/{p["slow"]*tf/60:.1f} hours); ATR stop{p["atr_stop"]}; reward/risk{p["reward_risk"]}; ADX{p["adx"]}; max hold{p["max_hold_hours"]}h; direction{p["direction"]}; risk{p.get("risk_fraction",.005)*100:.2f}%. Other settings: compression{p["compression"]}, volume{p["volume"]}, rank{p["rank"]}, efficiency{p["efficiency"]}, RSI2 threshold{p["rsi"]}, z-score{p["z"]}, BTC movement{p["btc_move"]}. Some parameters only apply to their named family; exact effective rules are above and in strategies_lab.py.','',f'Status: {"passes base final-test screening" if r["test"]["qualifies"] else "; ".join(r["qualification_failures"])}. Seven-day block-bootstrap95% net interval: ${r["bootstrap"]["net_profit_95pct_interval_usd"][0]:.2f} to${r["bootstrap"]["net_profit_95pct_interval_usd"][1]:.2f}. This interval is not adjusted for variant selection.','']
    lines+=['## Prediction, patterns and live depth','', 'prediction_results.json reports next1/2/3-candle diagnostics from training-only ridge models, thresholds selected on validation and then frozen. Overlapping prediction observations are not completed portfolio trades. candle_pattern_occurrences.csv records repeated engulfing, inside-bar, wick, doji and three-bar patterns by market, regime and horizon. Final-period pattern findings are exploratory and never retune frozen strategy rules. Intervals assuming independence are explicitly labelled; overlapping candles reduce effective sample size.','', 'orderbook_heatmap.html connects directly to the public feed when opened in a browser. orderbook_samples.jsonl contains actual recorded50-level depth and executed trade quantities. orderbook_pilot_results.json assesses a short observational5-second predictor; it cannot qualify a deployable strategy. Candle volume is never represented as historical order-book depth.','', '## Reproduce','', 'Use the saved datasets and instrument_filters.json; do not refresh them before reproducing. From this directory run the existing research Python environment with reproduce_lab.py CANDIDATE_ID --phase test. Add --cost2 for doubled fees/slippage, or --cost2 --gas1 for the gas scenario. Package versions and hashes are recorded in reproduction_manifest.json. See RESEARCH_CRITIQUE.md for linked academic papers, the legal free forecasting textbook, credentialed practitioner interviews and transferability critiques.','', '## Strategy switching','', 'A single losing trade is not a switching trigger. Keep a precommitted regime map, reserve a new forward paper-trading sample, and monitor rolling cost-adjusted expectancy, spread/liquidity and drawdown. Suspend entries on invalid/stale data or breached risk limits. Change to another qualified strategy only after that strategy passes a separate regime-specific forward review; never choose hindsight winners from the same losing window. No live bot or wallet transfer was started.']
    text='\n'.join(lines);(ROOT/'FINDINGS.md').write_text(text,encoding='utf-8')
    body='<pre style="white-space:pre-wrap">'+html.escape(text)+'</pre>';(ROOT/'strategy_report.html').write_text('<!doctype html><meta charset="utf-8"><title>Strategy discovery findings</title><style>body{font:15px system-ui;margin:32px;background:#101721;color:#e8edf3}pre{font:inherit;line-height:1.6}</style>'+body,encoding='utf-8')
    hashes={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in ROOT.glob('*.py')};(ROOT/'reproduction_manifest.json').write_text(json.dumps({'created_utc':dt.datetime.now(dt.timezone.utc).isoformat(),'python':sys.version,'numpy':np.__version__,'pandas':pd.__version__,'source_hashes':hashes,'data_manifest':'data_manifest.json','seed':20261004,'session':session,'adaptive':adaptive,'total_parameter_trials':variants},indent=2))
    (ROOT/'best_strategy_memory.json').write_text(json.dumps({'status':'research_only','qualification_count':len(qualified),'best_qualified':qualified[0] if qualified else None,'best_research_candidate':ranked[0] if ranked else None,'no_live_deployment':True,'selection_bias_caution':'Many validation variants searched; final screen is not proof of future edge.'},indent=2))
    print(json.dumps({'status':'reports_complete','qualified_families':len(qualified),'ranked_families':len(ranked),'trial_count':variants}))
if __name__=='__main__':main()
