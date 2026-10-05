"""Independent ledger and one-candidate reproduction checks after all audits."""
import json,time,hashlib,subprocess,sys,datetime as dt
from pathlib import Path
ROOT=Path(__file__).resolve().parent
def read(name):return json.loads((ROOT/name).read_text())
def main():
    required=['funding_audited_rankings.json','findings_complete.json','timeframe_audit_complete.json','MARKET_CONDITIONS.md','trial_uniqueness.json']
    while not all((ROOT/name).exists() for name in required):time.sleep(5)
    session=read('session.json');assert session['status']=='complete' and session['actual_elapsed_minutes']>=90
    frozen=read('PRIMARY_FROZEN.json');rows=read('funding_audited_rankings.json');assert len(rows)==22 and not frozen['final_results_read']
    selected={r['id'] for r in frozen['candidates']};checks=[]
    for row in rows:
        assert row['id'] in selected
        m=row['actual_funding_test'];tt=read(f'funding_trades_{row["id"]}.json');net=sum(t['net_pnl'] for t in tt);gain=sum(max(t['net_pnl'],0) for t in tt);loss=sum(max(-t['net_pnl'],0) for t in tt)
        assert len(tt)==m['trades'] and abs(net-m['net_profit_usd'])<1e-7
        if loss:assert abs(gain/loss-m['profit_factor'])<1e-8
        qualifies=net>0 and len(tt)>=250 and m['profit_factor']>1.12 and m['return_profit_factor']>1.12 and m['max_drawdown_pct']<=20 and row['fully_covered']
        assert row['qualifies']==qualifies
        checks.append({'id':row['id'],'ledger_matches':True,'qualification_matches':True})
    best=next((r for r in rows if r['qualifies']),rows[0])
    result=subprocess.run([sys.executable,str(ROOT/'reproduce_lab.py'),best['id'],'--phase','test','--historical-funding'],cwd=ROOT,capture_output=True,text=True,check=True)
    reproduced=json.loads(result.stdout);expected=best['actual_funding_test']
    for name in ['trades','net_profit_usd','profit_factor','return_profit_factor','max_drawdown_pct']:
        assert abs(reproduced[name]-expected[name])<1e-7,(name,reproduced[name],expected[name])
    inputs=[ROOT/'data_manifest.json',ROOT/'funding_manifest.json',ROOT/'marketcap_history.json',ROOT/'instrument_filters.json',ROOT/'PRIMARY_FROZEN.json']+list(ROOT.glob('*.py'))+list((ROOT/'funding').glob('*.json'))
    windows=set();repeated_audits=0
    for line in (ROOT/'research_journal.jsonl').open(encoding='utf-8'):
        entry=json.loads(line)
        if 'robustness_audit' in entry:
            repeated_audits+=1;windows.add((entry['candidate'],entry['start_ms'],entry['end_ms'],entry['cost_multiplier']))
    with (ROOT/'TRIAL_COUNTS.md').open('a',encoding='utf-8') as report:
        report.write(f'\n\nThe final timed worker logged {repeated_audits:,} locked-rule checks across {len(windows)} distinct candidate/quarter/cost combinations. Repeated checks are not new strategies or independent experiments and are excluded from candidate counts.\n')
    record={'status':'passed','verified_utc':dt.datetime.now(dt.timezone.utc).isoformat(),'actual_research_minutes':session['actual_elapsed_minutes'],'ranked_families':len(rows),'qualifying_families':sum(r['qualifies'] for r in rows),'ledger_checks':checks,'reproduced_candidate':best['id'],'reproduced_metrics_match':True,'locked_robustness_check_runs':repeated_audits,'distinct_locked_robustness_combinations':len(windows),'input_sha256':{str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in inputs}}
    (ROOT/'FINAL_VERIFICATION.json').write_text(json.dumps(record,indent=2));print(json.dumps({k:v for k,v in record.items() if k not in ['input_sha256','ledger_checks']}))
if __name__=='__main__':main()
