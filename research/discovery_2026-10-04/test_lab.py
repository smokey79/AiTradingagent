import unittest
import numpy as np
import pandas as pd
from strategies_lab import enrich,signals,parameters
from backtest_lab import opportunities,portfolio

def candles(n=1000):
    rng=np.random.default_rng(17);c=100*np.exp(np.cumsum(rng.normal(0,.006,n)));o=np.r_[100,c[:-1]]
    return pd.DataFrame({'timestamp':1704067200000+np.arange(n)*3_600_000,'open':o,'high':np.maximum(o,c)*1.003,'low':np.minimum(o,c)*.997,'close':c,'volume':np.full(n,100000.)})

class LabTest(unittest.TestCase):
    def test_prefix_invariance_and_closed_higher_timeframe(self):
        full=enrich({'BTC':candles()},60)['BTC'];prefix=enrich({'BTC':candles().iloc[:800]},60)['BTC']
        for column in ['regime_ema21','confirm_close','descending_line','anchored_vwap','atr','strength_rank']:
            np.testing.assert_allclose(full[column].iloc[:800].to_numpy(),prefix[column].to_numpy(),equal_nan=True)
        from strategies_lab import FAMILIES
        for family in FAMILIES:
            np.testing.assert_array_equal(signals(full,parameters(family))[:800],signals(prefix,parameters(family)))
    def test_next_open_and_ambiguous_bar_stop_first(self):
        f=enrich({'BTC':candles()},60)['BTC'];i=850
        f.loc[i,'open']=100.;f.loc[i,'high']=120.;f.loc[i,'low']=80.;f.loc[i,'close']=110.
        f.loc[i-1,'atr']=1.
        s=np.zeros(len(f),np.int8);s[i-1]=1
        p=parameters('inside_bar');p['atr_stop']=2.;p['reward_risk']=2.;p['max_hold_hours']=24
        tt=opportunities('BTC',f,s,p,int(f.timestamp.iloc[800]),int(f.timestamp.iloc[-1])+3_600_000)
        self.assertEqual(tt[0]['entry'],100.)
        self.assertEqual(tt[0]['exit'],98.)
        self.assertEqual(tt[0]['reason'],'stop')
        self.assertEqual(tt[0]['entry_ms'],int(f.timestamp.iloc[i]))
    def test_costs_reduce_net_and_open_positions_are_counted(self):
        f=enrich({'BTC':candles()},60)['BTC'];i=850;now=int(f.timestamp.iloc[i]);step=3_600_000
        base={'coin':'BTC','side':1,'entry_ms':now,'exit_ms':now+step,'entry':100.,'exit':102.,'stop_distance':2.,'stop':98.,'target':104.,'entry_volume_usd':1e9,'exit_volume_usd':1e9,'reason':'time_limit','bars_held':1,'pattern':{},'regime_adx':25.,'priority':1.}
        p=parameters('inside_bar')
        a,tt,_=portfolio([base],{'BTC':f},p,now-step,now+step*3)
        b,_,_=portfolio([base],{'BTC':f},p,now-step,now+step*3,cost_multiplier=2,gas_per_roundtrip=1.)
        self.assertEqual(a['trades'],1)
        self.assertLess(b['net_profit_usd'],a['net_profit_usd'])
        self.assertAlmostEqual(a['net_profit_usd'],tt[0]['net_pnl'])
        self.assertFalse(a['qualifies'])
    def test_signed_funding_only_during_position(self):
        f=enrich({'BTC':candles()},60)['BTC'];i=850;now=int(f.timestamp.iloc[i]);step=3_600_000
        f.loc[i-1:i,'close']=100.
        base={'coin':'BTC','side':1,'entry_ms':now,'exit_ms':now+step,'entry':100.,'exit':100.,'stop_distance':2.,'stop':98.,'target':104.,'entry_volume_usd':1e9,'exit_volume_usd':1e9,'reason':'time_limit','bars_held':1,'pattern':{},'regime_adx':25.,'priority':1.}
        rates={'BTC':[(now,.99),(now+step,.01),(now+step*2,.99)]};p=parameters('inside_bar')
        _,long,_=portfolio([base],{'BTC':f},p,now-step,now+step*3,funding_data=rates)
        _,short,_=portfolio([{**base,'side':-1,'stop':102.,'target':96.}],{'BTC':f},p,now-step,now+step*3,funding_data=rates)
        self.assertAlmostEqual(long[0]['funding'],long[0]['qty']*100*.01)
        self.assertAlmostEqual(short[0]['funding'],-short[0]['qty']*100*.01)
        self.assertGreater(short[0]['net_pnl'],long[0]['net_pnl'])
        ambiguous={**base,'side':-1,'reason':'target','exit_bar_start_ms':now,'stop':102.,'target':96.}
        _,uncertain,_=portfolio([ambiguous],{'BTC':f},p,now-step,now+step*3,funding_data=rates)
        self.assertEqual(uncertain[0]['funding'],0.)
    def test_exit_bar_close_cannot_create_phantom_equity_peak(self):
        f=enrich({'BTC':candles()},60)['BTC'];i=850;now=int(f.timestamp.iloc[i]);step=3_600_000
        f.loc[:,'close']=100.;f.loc[:,'low']=100.;f.loc[:,'high']=100.
        f.loc[i,'close']=110.;f.loc[i,'high']=110.
        trade={'coin':'BTC','side':1,'entry_ms':now,'exit_ms':now+step,'entry':100.,'exit':104.,'stop_distance':2.,'stop':98.,'target':104.,'entry_volume_usd':1e9,'exit_volume_usd':1e9,'reason':'target','bars_held':1,'pattern':{},'regime_adx':25.,'priority':1.}
        metrics,_,_=portfolio([trade],{'BTC':f},parameters('inside_bar'),now-step,now+step*3)
        self.assertLess(metrics['max_drawdown_pct'],1.5)
    def test_funding_signal_publication_delay_and_future_invariance(self):
        import supplementary_lab as s
        f=enrich({'BTC':candles()},60)['BTC'];step=3_600_000;settle=int(f.timestamp.iloc[500])+step
        f.loc[:,'regime_ema21']=1.;f.loc[:,'regime_ema55']=1.;f.loc[:,'regime_adx']=10.;f.loc[:,'rsi14']=30.;f.loc[:,'atr_pct']=.01;f.loc[:,'open']=99.;f.loc[:,'close']=100.
        s._rates['BTC']=np.array([[int(f.timestamp.iloc[0]),-.00001],[settle,-.01],[int(f.timestamp.iloc[920]),.99]])
        p=parameters('funding_crowd_fade');p['funding_threshold']=.0001
        before=s.funding_signal(f,p,'BTC')
        self.assertEqual(before[500],0);self.assertEqual(before[501],1)
        s._rates['BTC'][-1,1]=-.99
        after=s.funding_signal(f,p,'BTC');np.testing.assert_array_equal(before[:800],after[:800])
    def test_historical_marketcap_delay_staleness_and_future_invariance(self):
        import marketcap_lab as cap
        day=86_400_000;t=1704153600000
        cap._history=[{'available_ms':t,'top100':{'BTC'}},{'available_ms':t+28*day,'top100':{'ETH'}}]
        times=np.array([t-1,t,t+10*day,t+10*day+1,t+20*day])
        before=cap.eligibility_mask('BTC',times)
        np.testing.assert_array_equal(before,[False,True,True,False,False])
        cap._history[1]['top100']={'BTC','ETH'}
        np.testing.assert_array_equal(before,cap.eligibility_mask('BTC',times))
    def test_new_position_starts_at_fill_not_previous_close(self):
        f=enrich({'BTC':candles()},60)['BTC'];i=850;now=int(f.timestamp.iloc[i]);step=3_600_000
        f.loc[:,'close']=100.;f.loc[:,'low']=100.;f.loc[:,'high']=100.
        f.loc[i,'close']=120.;f.loc[i,'low']=120.;f.loc[i,'high']=120.
        trade={'coin':'BTC','side':1,'entry_ms':now,'exit_ms':now+step,'entry':120.,'exit':120.,'stop_distance':2.,'stop':118.,'target':124.,'entry_volume_usd':1e9,'exit_volume_usd':1e9,'reason':'time_limit','bars_held':1,'pattern':{},'regime_adx':25.,'priority':1.}
        _,closed,path=portfolio([trade],{'BTC':f},parameters('inside_bar'),now,now+step*3)
        self.assertAlmostEqual(path[0][1],250-closed[0]['entry_cost'])

if __name__=='__main__':unittest.main()
