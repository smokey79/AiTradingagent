class TradeCostBot:
    """Calculates Net Profit after DEX slippage, gas, and CEX exchange fees."""
    def __init__(self, bitget_taker_fee=0.0006, cryptocom_taker_fee=0.00075, est_gas_usd=1.50):
        self.bitget_taker_fee = bitget_taker_fee
        self.cryptocom_taker_fee = cryptocom_taker_fee
        self.est_gas_usd = est_gas_usd

    def evaluate_spread(self, buy_price: float, sell_price: float, trade_size_usd: float = 1000.0) -> dict:
        gross_spread_pct = ((sell_price - buy_price) / buy_price) * 100.0
        gross_profit_usd = (sell_price - buy_price) * (trade_size_usd / buy_price)
        
        cex_fee_usd = trade_size_usd * (self.bitget_taker_fee + self.cryptocom_taker_fee)
        total_costs_usd = cex_fee_usd + self.est_gas_usd
        net_profit_usd = gross_profit_usd - total_costs_usd
        net_profit_pct = (net_profit_usd / trade_size_usd) * 100.0

        return {
            "gross_spread_pct": round(gross_spread_pct, 2),
            "gross_profit_usd": round(gross_profit_usd, 2),
            "total_fees_usd": round(total_costs_usd, 2),
            "net_profit_usd": round(net_profit_usd, 2),
            "net_profit_pct": round(net_profit_pct, 2),
            "is_profitable": net_profit_usd > 0 and net_profit_pct >= 0.50
        }
