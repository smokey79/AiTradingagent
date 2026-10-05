"""Locked-rule timeframe stability: diagnostics only, never retune final rules."""
import time,json
from pathlib import Path
from data_lab import load_data
from strategies_lab import enrich,signals
from backtest_lab import opportunities,portfolio
from run_lab import ms,write
from supplementary_lab import NEW_FAMILIES,funding_signal
from marketcap_lab import eligible,filter_frames_for_rank
ROOT=Path(__file__).resolve().parent
def main():
    while not (ROOT/'funding_audited_rankings.json').exists():time.sleep(5)
    rows=json.loads((ROOT/'funding_audited_rankings.json').read_text());needed={max(15,r['parameters']['minutes']//2) for r in rows[:15]}|{r['parameters']['minutes']*2 for r in rows[:15]}
    frames={m:filter_frames_for_rank(enrich(load_data(m),m),m) for m in sorted(needed)};funding={p.stem:json.loads(p.read_text()) for p in (ROOT/'funding').glob('*.json')};results=[]
    common_end=min(int(f.timestamp.max())+7_200_000 for f in load_data(120).values())
    for r in rows[:15]:
        original=r['parameters'];base_minutes=original['minutes']
        for m in [max(15,base_minutes//2),base_minutes*2]:
            p={**original,'minutes':m};ff=frames[m];end=min(common_end,min(int(f.timestamp.max())+m*60_000 for f in ff.values()));start=ms('2026-02-01');events=[]
            for coin,f in ff.items():events+=opportunities(coin,f,funding_signal(f,p,coin) if p['family'] in NEW_FAMILIES else signals(f,p),p,start,end)
            events=[e for e in events if eligible(e['coin'],e['entry_ms'])]
            metrics,_,_=portfolio(events,ff,p,start,end,funding_data=funding);results.append({'id':r['id'],'family':r['family'],'original_minutes':base_minutes,'audit_minutes':m,'all_other_settings_locked':True,'metrics':metrics,'selection_policy':'Robustness diagnostic only; these settings do not replace the frozen candidate'})
            write('timeframe_audit_results.json',results)
    lines=['# Timeframe stability audit','', 'The fifteen final-ranked families were run at half and double their entry interval, with the same settings measured in bars and unchanged risk/reward. Confirmation/direction remain2×/4× entry. These are locked-rule robustness diagnostics, not newly selected winners. Changing timeframe also changes the elapsed EMA/channel horizon; the table makes that dependency visible.','', '|Family|Original entry min|Audit entry min|Trades|Net USD|PF|Drawdown|Screen pass|','|---|---:|---:|---:|---:|---:|---:|---|']
    for r in results:
        m=r['metrics'];lines.append(f'|{r["family"]}|{r["original_minutes"]}|{r["audit_minutes"]}|{m["trades"]}|{m["net_profit_usd"]:.2f}|{m["profit_factor"]:.3f}|{m["max_drawdown_pct"]:.2f}%|{"YES" if m["qualifies"] else "NO"}|')
    lines+=['', 'A family profitable only at one precise interval is less convincing than one surviving adjacent intervals. These audits use the already reported final period; future model selection needs a fresh forward sample. Very short intervals incur more cost relative to candle movement. A five-minute historical study would require a separate five-minute dataset; it was not reconstructed from15-minute bars.']
    (ROOT/'TIMEFRAME_FINDINGS.md').write_text('\n'.join(lines),encoding='utf-8');write('timeframe_audit_complete.json',{'status':'complete','audits':len(results)});print(json.dumps({'timeframe_audits':len(results)}))
if __name__=='__main__':main()
