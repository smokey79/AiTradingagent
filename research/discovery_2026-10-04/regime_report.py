"""Describe frozen strategy outcomes by observed entry regime; never select rules."""
import json,time
from pathlib import Path
ROOT=Path(__file__).resolve().parent
def main():
    while not (ROOT/'funding_audited_rankings.json').exists():time.sleep(5)
    rows=json.loads((ROOT/'funding_audited_rankings.json').read_text());out=[]
    lines=['# Market-condition diagnostics','', 'Entry ADX14 below20 is labelled weak trend,20–25 transitional, and25 or above stronger trend. These are descriptive labels, not definitive market states. Identical frozen rules are used throughout; no final-period tuning or automatic switching follows from these results.','', '|Strategy|Entry regime|Trades|Net USD|PF|','|---|---|---:|---:|---:|']
    for r in rows[:15]:
        trades=json.loads((ROOT/f'funding_trades_{r["id"]}.json').read_text())
        for name,lo,hi in [('weak trend',0,20),('transitional',20,25),('stronger trend',25,float('inf'))]:
            tt=[t for t in trades if lo<=t.get('regime_adx',float('nan'))<hi];gain=sum(max(t['net_pnl'],0) for t in tt);loss=sum(max(-t['net_pnl'],0) for t in tt);pf=gain/loss if loss else None;net=gain-loss
            out.append({'id':r['id'],'family':r['family'],'regime':name,'trades':len(tt),'net_usd':net,'profit_factor':pf})
            lines.append(f'|{r["family"]}|{name}|{len(tt)}|{net:.2f}|{pf if pf is not None else "not estimable"}|')
    lines+=['', 'Subgroups can be small and different families can trade the same events. This breakdown does not qualify a subgroup independently. The disabled strategy_switch_policy.json requires a fresh paper review and sustained deterioration before changing a live strategy. Portfolio results, capacity, historical funding and market-cap eligibility remain in FINDINGS.md.']
    (ROOT/'MARKET_CONDITIONS.md').write_text('\n'.join(lines),encoding='utf-8');(ROOT/'regime_diagnostics.json').write_text(json.dumps(out));print(json.dumps({'regime_report':'complete','cells':len(out)}))
if __name__=='__main__':main()
