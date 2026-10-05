"""Audit locked final-test candidates under observed funding settlements."""
import json,time,html
from pathlib import Path
from data_lab import load_data
from strategies_lab import enrich,signals
from backtest_lab import opportunities,portfolio
from run_lab import ms,write
from finalize_lab import bootstrap
from effective_lab import effective_settings
from supplementary_lab import NEW_FAMILIES,funding_signal
from finalize_lab import RULES
from marketcap_lab import eligible,filter_frames_for_rank
ROOT=Path(__file__).resolve().parent
def main():
    while not (ROOT/'PRIMARY_FROZEN.json').exists() or not (ROOT/'FINDINGS.md').exists() or not (ROOT/'marketcap_history.json').exists():time.sleep(5)
    manifest=json.loads((ROOT/'funding_manifest.json').read_text());complete={r['coin'] for r in manifest['markets'] if r['complete_to_start_or_listing'] and not r['error']}
    funding={coin:json.loads((ROOT/'funding'/f'{coin}.json').read_text()) for coin in complete}
    primary_selection=json.loads((ROOT/'PRIMARY_FROZEN.json').read_text());ranked=primary_selection['candidates'];frames={m:filter_frames_for_rank(enrich(load_data(m),m),m) for m in {r['parameters']['minutes'] for r in ranked}};audits=[]
    common_end=min(int(f.timestamp.max())+7_200_000 for f in load_data(120).values())
    for row in ranked:
        p=row['parameters'];ff=frames[p['minutes']];start=ms('2026-02-01');end=common_end;events=[]
        for coin,f in ff.items():events+=opportunities(coin,f,funding_signal(f,p,coin) if p['family'] in NEW_FAMILIES else signals(f,p),p,start,end)
        unfiltered_count=len(events);events=[e for e in events if eligible(e['coin'],e['entry_ms'])]
        baseline,_,_=portfolio(events,ff,p,start,end)
        actual,trades,equity=portfolio(events,ff,p,start,end,funding_data=funding);stress,_,_=portfolio(events,ff,p,start,end,cost_multiplier=2,funding_data=funding)
        gas,_,_=portfolio(events,ff,p,start,end,cost_multiplier=2,gas_per_roundtrip=1,funding_data=funding)
        write('funding_trades_'+row['id']+'.json',trades);write('funding_equity_'+row['id']+'.json',equity)
        train_events=[]
        for coin,f in ff.items():train_events+=opportunities(coin,f,funding_signal(f,p,coin) if p['family'] in NEW_FAMILIES else signals(f,p),p,ms('2024-01-01'),ms('2025-07-01'))
        train_events=[e for e in train_events if eligible(e['coin'],e['entry_ms'])]
        train,_,_=portfolio(train_events,ff,p,ms('2024-01-01'),ms('2025-07-01'),funding_data=funding)
        actual['observed_losing_trades']=sum(t['net_pnl']<0 for t in trades);actual['observed_winning_trades']=sum(t['net_pnl']>0 for t in trades)
        audit={'id':row['id'],'family':p['family'],'actual_funding_test':actual,'actual_funding_double_cost':stress,'actual_funding_gas_stress':gas,'bootstrap':bootstrap(trades),'fully_covered':all(c in complete for c in ff),'parameters':p,'rules':RULES[p['family']],'base_assumed_funding_test':baseline,'validation':row['validation'],'train':train,'timeframes_minutes':{'entry':p['minutes'],'confirmation':p['minutes']*2,'direction':p['minutes']*4},'test_start_ms':start,'test_end_ms':end}
        audit['qualifies']=actual['qualifies'] and audit['fully_covered'];audits.append(audit);write('funding_audit_results.json',audits);write('funding_audit_progress.json',{'status':'auditing','completed':len(audits),'candidates':len(ranked)})
        audit['effective_settings']=effective_settings(p)
        audit['historical_top100_entry_filter']={'enabled':True,'rejected_opportunities':unfiltered_count-len(events),'publication_delay_days_assumed':2,'maximum_snapshot_age_days':10,'basket_selection_survivorship_bias_remains':True}
    def score(r):
        m=r['actual_funding_test'];breadth=sum(v['net']>0 for v in m['by_coin'].values())/max(1,len(m['by_coin']))
        return (r['qualifies'],r['validation']['net_profit_usd']>0 and m['net_profit_usd']>0,r['actual_funding_double_cost']['net_profit_usd']>0,r['bootstrap']['net_profit_95pct_interval_usd'][0]>0,breadth,min(r['train']['profit_factor'],r['validation']['profit_factor'],m['profit_factor']),-m['max_drawdown_pct'],m['trades'],m['net_profit_usd'])
    audits.sort(key=score,reverse=True)
    for i,r in enumerate(audits):r['rank']=i+1
    write('funding_audited_rankings.json',audits)
    primary=['# Funding-audited findings','',f'**{sum(r["qualifies"] for r in audits)} of {len(audits)} locked strategy families meet the final-test screen with observed funding rates.** Public funding coverage: {len(complete)} markets. The assumptions-based search and its90-minute session remain recorded in BASE_FINDINGS.md.','', 'Rates use actual published settlement timestamps and signed rates. Payment notional uses quantity times the nearest preceding candle close, rather than an unavailable historical mark-price snapshot. Possible funding debits in uncertain exit candles are charged; ambiguous credits are excluded. Exchange quantity specifications are current, not historically reconstructed.','', '|Rank|Strategy|Entry/confirm/direction min|Trades|Net USD|Net %|PF|Drawdown|Win %|Double-cost net USD|Gas-stress net USD|Qualifies|','|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|']
    for r in audits[:15]:
        m=r['actual_funding_test'];tf=r['parameters']['minutes'];pf=f'{m["profit_factor"]:.3f}' if m['observed_losing_trades'] else 'not estimable';primary.append(f'|{r["rank"]}|{r["family"]}|{tf}/{tf*2}/{tf*4}|{m["trades"]}|{m["net_profit_usd"]:.2f}|{m["net_profit_pct"]:.2f}%|{pf}|{m["max_drawdown_pct"]:.2f}%|{m["win_rate_pct"]:.1f}%|{r["actual_funding_double_cost"]["net_profit_usd"]:.2f}|{r["actual_funding_gas_stress"]["net_profit_usd"]:.2f}|{"YES" if r["qualifies"] else "NO"}|')
    primary+=['','Ranking prioritises qualification, validation/final positivity, doubled trading-cost survival, block-bootstrap lower bound, cross-market breadth, worst historical PF, drawdown, count and net profit. Primary parameters were frozen from validation only, prioritising qualification and sufficient trade count before validation score. Below250 validation trades, count precedes score. PRIMARY_FROZEN.json records that policy and excludes final-result access. No final-period optimisation is performed. A loss-free tiny sample has no estimable PF; internal finite caps are not reported as a statistical estimate.','', 'Entry eligibility uses the latest [dated CoinMarketCap weekly snapshot](https://coinmarketcap.com/historical/) only after an assumed2-day publication lag, and expires it after10days. A coin must have ranked in the top100 then. Relative-strength ranks exclude ineligible observed coins. This removes future weekly membership from entry eligibility, but the14-market data basket is still a currently selected subset; it is not a survivorship-free whole-market study. The selection search used the wider fixed basket; the locked primary audit adds this predeclared historical eligibility restriction.','']
    for r in audits[:15]:
        p=r['parameters'];effective=r['effective_settings'];entry_ema=', '.join(f'{key}EMA={effective[key]} bars' for key in ['fast','slow'] if key in effective);specific=', '.join(f'{key}={value}' for key,value in effective.items() if key not in ['family','minutes','atr_stop','reward_risk','max_hold_hours','direction','risk_fraction','fast','slow'])
        primary += [f'## {r["rank"]}. {r["family"]} — {r["id"]}','',r['rules'],'',f'Entry/confirmation/direction: {p["minutes"]}/{p["minutes"]*2}/{p["minutes"]*4}min. Higher directional context uses EMA21/55; confirmation uses EMA21, wherever those conditions are named in the rules. ATR stop: {p["atr_stop"]}. Reward/risk: {p["reward_risk"]}. Holding limit: {p["max_hold_hours"]}h. Direction: {p["direction"]}. Risk per trade: {p.get("risk_fraction",.005)*100:.2f}%. '+(f'Entry EMA settings: {entry_ema}. ' if entry_ema else '')+(f'Family-specific settings: {specific}. ' if specific else '')+'Exact effective settings, full parameter records and metrics are in funding_audited_rankings.json.','']
    primary += ['## Repeated patterns, predictors and order-book findings','', 'Detailed pattern and prediction findings: CANDLE_AND_PREDICTION_FINDINGS.md. Real depth observations: ORDERBOOK_FINDINGS.md and the live orderbook_heatmap.html. Adjacent timeframes: TIMEFRAME_FINDINGS.md. Research sources and critiques: RESEARCH_CRITIQUE.md and RESEARCH_UPDATES.md. Source hashes, dataset dates, elapsed time and variant count: reproduction_manifest.json. Candidate-run versus distinct-settings counts: TRIAL_COUNTS.md. Reproduction of these audited figures uses reproduce_lab.py ID --phase test --historical-funding. Audited trade/equity ledgers are funding_trades_ID.json / funding_equity_ID.json.','', 'CEX fees/slippage assumptions, fully collateralised sizing, stops, gas stress, bias disclosures and complete base settings are in BASE_FINDINGS.md. Gas stress doubles trading costs and adds$1 per round trip; it does not reconstruct DEX pool fees, routes, MEV or execution. Earlier local research used parts of the2026 history, so this is a final period excluded from parameter selection in this run, not a globally unseen historical sample. A fresh forward paper review remains necessary. A passed screen is not evidence of guaranteed accuracy or future profits. Strategies failing any requirement remain research candidates. Bots remain stopped.']
    source=(ROOT/'FINDINGS.md').read_text(encoding='utf-8');(ROOT/'BASE_FINDINGS.md').write_text(source,encoding='utf-8');content='\n'.join(primary);(ROOT/'FINDINGS.md').write_text(content,encoding='utf-8');(ROOT/'strategy_report.html').write_text('<!doctype html><meta charset="utf-8"><title>Funding-audited strategy findings</title><style>body{font:15px system-ui;margin:32px;background:#101721;color:#e8edf3}pre{font:inherit;line-height:1.6;white-space:pre-wrap}</style><pre>'+html.escape(content)+'</pre>',encoding='utf-8')
    qualified=[r for r in audits if r['qualifies']];write('best_strategy_memory.json',{'status':'research_only','qualification_count':len(qualified),'best_qualified':qualified[0] if qualified else None,'best_research_candidate':audits[0] if audits else None,'no_live_deployment':True,'funding_audited':True});write('funding_audit_progress.json',{'status':'complete','candidates':len(audits),'qualified':len(qualified)})
    print(json.dumps({'funding_audit':'complete','qualified':len(qualified)}))
if __name__=='__main__':main()
