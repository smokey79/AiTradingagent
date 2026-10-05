"""Conservative next-open fills and a shared, fully collateralised portfolio."""
from __future__ import annotations
import heapq
import math
import json
from pathlib import Path
import numpy as np

FILTER_FILE=Path(__file__).with_name('instrument_filters.json')
LOT_FILTERS=json.loads(FILTER_FILE.read_text()) if FILTER_FILE.exists() else {}

def opportunities(coin,f,signal,p,start_ms,end_ms):
    t=f.timestamp.to_numpy(np.int64);o=f.open.to_numpy();h=f.high.to_numpy();l=f.low.to_numpy();c=f.close.to_numpy();v=f.volume.to_numpy();atr=f.atr.to_numpy()
    step=p['minutes']*60_000;limit=max(1,int(p['max_hold_hours']*60/p['minutes']))
    trades=[];i=max(1,int(np.searchsorted(t,start_ms)))
    last=int(np.searchsorted(t,end_ms,side='left'))
    while i<last-1:
        side=int(signal[i-1]);entry_t=int(t[i])
        if not side or not np.isfinite(atr[i-1]) or entry_t+limit*step>=end_ms or t[i]-t[i-1]!=step:
            i+=1;continue
        entry=float(o[i]);distance=max(atr[i-1]*p['atr_stop'],entry*.002)
        stop=entry-side*distance;target=entry+side*distance*p['reward_risk']
        exit_px=None;reason=None;exit_i=min(i+limit-1,last-1)
        for j in range(i,exit_i+1):
            if j>i and t[j]-t[j-1]!=step:
                # The missing interval is not fabricated. Gap exposure is repriced at the next observed open.
                exit_px=float(o[j]);reason='data_gap';exit_i=j;break
            if j>i and signal[j-1]==-side:
                exit_px=float(o[j]);reason='opposite_signal';exit_i=j;break
            stop_hit=l[j]<=stop if side==1 else h[j]>=stop
            target_hit=h[j]>=target if side==1 else l[j]<=target
            if stop_hit:
                exit_px=float(min(o[j],stop) if side==1 else max(o[j],stop));reason='stop';exit_i=j;break
            if target_hit:
                exit_px=float(target);reason='target';exit_i=j;break
        if exit_px is None:exit_px=float(c[exit_i]);reason='time_limit'
        event={'coin':coin,'side':side,'entry_ms':entry_t,'exit_ms':int(t[exit_i]+step),'entry':entry,'exit':exit_px,'stop_distance':float(distance),'stop':float(stop),'target':float(target),
               'entry_volume_usd':float(v[i-1]*c[i-1]),'exit_volume_usd':float(v[max(i-1,exit_i-1)]*c[max(i-1,exit_i-1)]),'reason':reason,'bars_held':exit_i-i+1,
               'pattern':{'engulfing':bool(f.engulf_up.iloc[i-1] if side==1 else f.engulf_down.iloc[i-1]),'wick':float(f.lower_wick.iloc[i-1] if side==1 else f.upper_wick.iloc[i-1]),'inside':bool(f.inside.iloc[i-1]),'volume_ratio':float(f.vol_ratio.iloc[i-1])},
               'regime_adx':float(f.regime_adx.iloc[i-1]),'priority':float(abs(f.rsi14.iloc[i-1]-50)),'exit_bar_start_ms':int(t[exit_i])}
        trades.append(event);i=exit_i+1
    return trades

def portfolio(trades,frames,p,start_ms,end_ms,cost_multiplier=1.,gas_per_roundtrip=0.,funding_bps_8h=1.,priority_reverse=False,funding_data=None):
    initial=float(p.get('initial_equity',250));cash=initial;peak=initial;maxdd=0.;equity_path=[];closed=[];active={};open_heap=[];serial=0
    risk=float(p.get('risk_fraction',.005));cap=.25;max_exposure=.60;max_positions=3
    fee=.0006*cost_multiplier
    candles={coin:(f.timestamp.to_numpy(np.int64)+p['minutes']*60_000,f.close.to_numpy(),f.low.to_numpy(),f.high.to_numpy()) for coin,f in frames.items()}
    sorted_trades=sorted(trades,key=lambda z:(z['entry_ms'],-z['priority'],z['coin']),reverse=False)
    if priority_reverse:sorted_trades=sorted(trades,key=lambda z:(z['entry_ms'],z['priority'],z['coin']))
    timeline=sorted(set(int(x) for coin,(ts,*_) in candles.items() for x in ts[(ts>=start_ms)&(ts<end_ms)]))
    next_trade=0;rejected={'capacity':0,'minimum_order':0,'liquidity':0};fees_total=0.;funding_total=0.;gas_total=0.
    def mark(now,extreme=False):
        eq=cash
        for pos in active.values():
            trade=pos['trade'];ts,close,low,high=candles[trade['coin']]
            j=int(np.searchsorted(ts,now,side='right'))-1
            if j<0 or now<=trade['entry_ms']:price=trade['entry']
            elif extreme=='favourable':
                price=float(high[j] if trade['side']==1 else low[j])
                price=min(price,trade['target']) if trade['side']==1 else max(price,trade['target'])
            elif extreme:
                price=float(low[j] if trade['side']==1 else high[j])
                if trade['side']==1:price=max(price,min(trade['stop'],trade['exit']))
                else:price=min(price,max(trade['stop'],trade['exit']))
            else:price=trade['exit'] if now>=trade['exit_ms'] else float(close[j])
            eq+=trade['side']*(price-trade['entry'])*pos['qty']
        return eq
    def close_due(now):
        nonlocal cash,fees_total,funding_total,gas_total
        while open_heap and open_heap[0][0]<=now:
            _,ident=heapq.heappop(open_heap);pos=active.pop(ident)
            trade=pos['trade'];qty=pos['qty'];notional=pos['notional']
            exit_fee=qty*trade['exit']*fee
            impact=(.0002 if trade['coin'] in ('BTC','ETH') else .0004)*cost_multiplier
            impact+=.0002*math.sqrt(notional/max(trade['exit_volume_usd'],1))*cost_multiplier
            exit_slip=qty*trade['exit']*impact
            funding=notional*funding_bps_8h/10000*max(0.,(trade['exit_ms']-trade['entry_ms'])/28_800_000)
            if funding_data is not None and trade['coin'] in funding_data:
                history=funding_data[trade['coin']];funding=0.
                bar_start=trade.get('exit_bar_start_ms',trade['exit_ms'])
                precise_open_exit=trade['reason'] in ('opposite_signal','data_gap')
                funding_end=bar_start if precise_open_exit else trade['exit_ms']
                for settle,rate in history:
                    if trade['entry_ms']<settle<=funding_end:
                        # An intrabar exit may precede settlement. Never grant ambiguous credits;
                        # charging possible debits is the conservative direction of approximation.
                        if trade['side']*rate<0 and trade['reason']!='time_limit' and settle>=bar_start:continue
                        ts,prices,_,_=candles[trade['coin']];j=int(np.searchsorted(ts,settle,side='right'))-1
                        settle_price=float(prices[j]) if j>=0 else trade['entry']
                        funding+=trade['side']*qty*settle_price*rate
            # Conservative funding is a debit on both sides. Actual funding is reported separately when available.
            pnl=trade['side']*(trade['exit']-trade['entry'])*qty-pos['entry_cost']-exit_fee-exit_slip-funding-gas_per_roundtrip
            cash+=pnl+pos['entry_cost']
            row={**trade,'qty':qty,'notional':notional,'net_pnl':pnl,'net_return':pnl/notional,'net_r':pnl/max(pos['risk_usd'],1e-12),'cost':pos['entry_cost']+exit_fee+exit_slip+funding+gas_per_roundtrip,'entry_cost':pos['entry_cost'],'exit_cost':exit_fee+exit_slip,'funding':funding,'gas':gas_per_roundtrip}
            closed.append(row);fees_total+=exit_fee+exit_slip;funding_total+=funding;gas_total+=gas_per_roundtrip
    for now in timeline:
        # Prices available at a candle close mark positions before exits release collateral.
        worst=mark(now,True);current=mark(now);favourable=mark(now,'favourable')
        peak=max(peak,current,favourable);maxdd=max(maxdd,(peak-worst)/max(peak,1e-12))
        close_due(now)
        while next_trade<len(sorted_trades) and sorted_trades[next_trade]['entry_ms']<=now:
            trade=sorted_trades[next_trade];next_trade+=1
            # Entry at now's open is evaluated after the preceding closed bar. We never use that entry bar's OHLC.
            close_due(trade['entry_ms'])
            eq=mark(trade['entry_ms']);allocated=sum(pos['notional'] for pos in active.values())
            if len(active)>=max_positions or any(pos['trade']['coin']==trade['coin'] for pos in active.values()):rejected['capacity']+=1;continue
            available=min(max(0.,cash-allocated),max(0.,eq*max_exposure-allocated))
            slip=(.0002 if trade['coin'] in ('BTC','ETH') else .0004)*cost_multiplier
            est_cost=2*(fee+slip)*trade['entry']
            qty=min(eq*risk/max(trade['stop_distance']+est_cost,1e-12),eq*cap/trade['entry'],available/trade['entry'])
            lot=LOT_FILTERS.get(trade['coin'],{})
            qty_step=float(lot.get('qtyStep',0))
            if qty_step:qty=math.floor(qty/qty_step+1e-10)*qty_step
            notional=qty*trade['entry']
            if qty<float(lot.get('minOrderQty',0)) or notional<float(lot.get('minNotionalValue',5)):rejected['minimum_order']+=1;continue
            if notional/max(trade['entry_volume_usd'],1)>.001:rejected['liquidity']+=1;continue
            impact=slip+.0002*math.sqrt(notional/max(trade['entry_volume_usd'],1))*cost_multiplier
            entry_cost=notional*(fee+impact)
            serial+=1;active[serial]={'trade':trade,'qty':qty,'notional':notional,'entry_cost':entry_cost,'risk_usd':qty*(trade['stop_distance']+est_cost)}
            cash-=entry_cost;fees_total+=entry_cost
            heapq.heappush(open_heap,(trade['exit_ms'],serial))
        equity_path.append([now,mark(now)])
    close_due(end_ms)
    maxdd=max(maxdd,(peak-cash)/max(peak,1e-12))
    wins=[t['net_pnl'] for t in closed if t['net_pnl']>0];losses=[t['net_pnl'] for t in closed if t['net_pnl']<0]
    rs=[t['net_return'] for t in closed]
    gp=sum(wins);gl=-sum(losses)
    pf=gp/gl if gl else (1000. if gp else 0.)
    pctpf=sum(x for x in rs if x>0)/max(1e-12,-sum(x for x in rs if x<0)) if any(x<0 for x in rs) else (1000. if gp else 0.)
    by_coin={}
    for coin in frames:
        tt=[t for t in closed if t['coin']==coin];g=sum(max(t['net_pnl'],0) for t in tt);loss=-sum(min(t['net_pnl'],0) for t in tt)
        by_coin[coin]={'trades':len(tt),'net':sum(t['net_pnl'] for t in tt),'pf':g/loss if loss else (1000. if g else 0.)}
    daily={}
    for t in closed:daily.setdefault(str(t['exit_ms']//86_400_000),0);daily[str(t['exit_ms']//86_400_000)]+=t['net_pnl']/initial
    metrics={'trades':len(closed),'net_profit_usd':cash-initial,'net_profit_pct':100*(cash/initial-1),'profit_factor':pf,'return_profit_factor':pctpf,'max_drawdown_pct':100*max(0,maxdd),'win_rate_pct':100*len(wins)/max(1,len(closed)),
             'total_cost_usd':fees_total+funding_total+gas_total,'funding_usd':funding_total,'gas_usd':gas_total,'initial_equity':initial,'final_equity':cash,'rejected':rejected,'by_coin':by_coin,'daily_returns':daily,
             'qualifies':cash>initial and len(closed)>=250 and pf>1.12 and pctpf>1.12 and maxdd<=.20,'cost_multiplier':cost_multiplier,'gas_per_roundtrip':gas_per_roundtrip,
             'assumptions':{'fee_per_side':fee,'funding_debit_bps_per_8h':funding_bps_8h,'funding_model':'historical_signed_rates_prior_close_notional; ambiguous_exit_bar_credits_excluded_and_possible_debits_charged' if funding_data is not None else 'continuous_debit_allowance_both_sides','risk_fraction':risk,'max_positions':3,'max_notional_fraction':cap,'max_total_exposure':max_exposure,'order_filters':'current_public_Bybit_qty_step_minimum_and_notional; historical_filters_not_reconstructed','gas_applicable_to_cex':False}}
    return metrics,closed,equity_path
