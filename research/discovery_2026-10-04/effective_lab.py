"""Distinguish nominal trial records from effective rule/settings combinations."""
import json,hashlib,time,collections
from pathlib import Path
ROOT=Path(__file__).resolve().parent
SPEC={'mtf_pullback':['fast','adx'],'compression_breakout':['compression','volume'],'engulfing_pullback':['fast'],'relative_strength':['fast','rank'],'btc_lead_lag':['btc_move'],'rsi2_trend':['slow','rsi'],'efficiency_momentum':['efficiency'],'volatility_drift':['fast','slow'],'range_zscore':['adx','z'],'prior_ema_baseline':['fast','slow']}
SPEC.update({'funding_crowd_fade':['funding_threshold'],'funding_settlement_breakout':['event_window_minutes','volume'],'sign_reversal_costfilter':['minimum_move','regime_filter']})
def effective_settings(p):
    keys=['family','minutes','atr_stop','reward_risk','max_hold_hours','direction']+SPEC.get(p['family'],[])
    values={k:p[k] for k in keys};values['risk_fraction']=p.get('risk_fraction',.005);return values
def main():
    while True:
        try:
            if json.loads((ROOT/'session.json').read_text()).get('status')=='complete' and json.loads((ROOT/'adaptive_progress.json').read_text()).get('status')=='complete' and json.loads((ROOT/'supplementary_progress.json').read_text()).get('status')=='complete':break
        except (OSError,json.JSONDecodeError):pass
        time.sleep(5)
    allrows=json.loads((ROOT/'validation_results.json').read_text())+json.loads((ROOT/'adaptive_validation_results.json').read_text())+json.loads((ROOT/'supplementary_validation_results.json').read_text());unique={};nominal=collections.Counter();counts=collections.Counter()
    for row in allrows:
        p=effective_settings(row['parameters']);key=hashlib.sha256(json.dumps(p,sort_keys=True).encode()).hexdigest();nominal[p['family']]+=1
        if key not in unique:unique[key]=p;counts[p['family']]+=1
    result={'nominal_candidate_runs':len(allrows),'distinct_effective_settings':len(unique),'repeated_effective_settings_runs':len(allrows)-len(unique),'by_family':{family:{'candidate_runs':n,'distinct_effective_settings':counts[family]} for family,n in nominal.items()},'caution':'Distinct settings are still correlated trials, not statistically independent experiments. Duplicate parameter outcomes are not new strategy families.'}
    (ROOT/'trial_uniqueness.json').write_text(json.dumps(result,indent=2));lines=['# Trial counts and effective settings','',f'{len(allrows):,} candidate runs contain {len(unique):,} distinct effective settings; {len(allrows)-len(unique):,} runs repeat an effective combination. Distinct settings remain correlated. The final selection retains one validation-chosen representative per family, so repeated combinations cannot populate the15 ranks.','', '|Family|Candidate runs|Distinct effective settings|','|---|---:|---:|']
    for family,n in sorted(nominal.items()):lines.append(f'|{family}|{n}|{counts[family]}|')
    lines+=['', 'Unused parameters are excluded from this audit. For example, the session-breakout rule uses a fixed07–16 UTC window and fixed1.5× volume filter; changing fast EMA does not change its entry condition. Stops, target ratios, holding limits, side restrictions, timeframe and sizing still change its effective strategy. This audit does not claim an effective number of independent trials or a formal selection-adjusted significance level.']
    (ROOT/'TRIAL_COUNTS.md').write_text('\n'.join(lines),encoding='utf-8');print(json.dumps(result)[:300])
if __name__=='__main__':main()
