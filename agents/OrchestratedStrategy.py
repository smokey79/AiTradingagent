import logging
import requests
from datetime import datetime
from freqtrade.strategy import IStrategy, IntParameter, DecimalParameter
from pandas import DataFrame
import freqtrade.vendor.qtpylib.indicators as qtpylib
import talib.abstract as ta

logger = logging.getLogger(__name__)

class OrchestratedStrategy(IStrategy):
    """
    Strategy that bridges Freqtrade technicals with Node.js Multi-LLM Consensus.
    """
    INTERFACE_VERSION = 3
    timeframe = '1h'
    can_short = True
    
    # Orchestrator Configuration
    orchestrator_url = "http://localhost:3333/orchestrator/consensus"
    agent_profile = "balanced"  # Can be aggressive, conservative, balanced, etc.

    # Technical Indicators for context
    def populate_indicators(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        dataframe['rsi'] = ta.RSI(dataframe, timeperiod=14)
        dataframe['adx'] = ta.ADX(dataframe)
        bollinger = qtpylib.bollinger_bands(qtpylib.typical_price(dataframe), window=20, stds=2)
        dataframe['bb_lowerband'] = bollinger['lower']
        dataframe['bb_upperband'] = bollinger['upper']
        dataframe['bb_middleband'] = bollinger['mid']
        return dataframe

    def get_orchestrator_consensus(self, pair: str, dataframe: DataFrame):
        """
        Calls the Node.js Orchestrator for a consensus vote.
        """
        last_candle = dataframe.iloc[-1]
        
        # Prepare context for the LLMs
        context_text = (
            f"Symbol: {pair}. "
            f"Current Price: {last_candle['close']:.2f}. "
            f"RSI: {last_candle['rsi']:.1f}. "
            f"ADX: {last_candle['adx']:.1f}. "
            f"BB Lower: {last_candle['bb_lowerband']:.2f}, BB Upper: {last_candle['bb_upperband']:.2f}."
        )

        payload = {
            "text": f"Provide a consensus trade decision for {pair} based on these technicals: {context_text}",
            "agentProfile": self.agent_profile,
            "systemPrompt": "Analyze the technical indicators and return a JSON object with 'action' (BUY/SELL/HOLD), 'confidence' (0.0 to 1.0), and 'reason'."
        }

        try:
            response = requests.post(self.orchestrator_url, json=payload, timeout=20)
            if response.status_code == 200:
                result = response.json()
                # Log the reasoning for transparency
                logger.info(f"Consensus for {pair}: {result.get('action')} (Conf: {result.get('confidence')}) - {result.get('reason')}")
                return result
        except Exception as e:
            logger.error(f"Error connecting to Node.js Orchestrator: {e}")
        
        return None

    def populate_entry_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        # Skip calling LLMs during backtesting (it would be too slow/expensive)
        if self.config['runmode'] not in ('live', 'dry_run'):
            return dataframe

        pair = metadata['pair']
        consensus = self.get_consensus_cached(pair, dataframe)

        if consensus:
            action = consensus.get('action', '').upper()
            confidence = consensus.get('confidence', 0)
            
            # Entry logic based on consensus threshold
            if action == 'BUY' and confidence >= 0.72:
                dataframe.loc[dataframe.index[-1], 'enter_long'] = 1
            
            if action == 'SELL' and confidence >= 0.72:
                dataframe.loc[dataframe.index[-1], 'enter_short'] = 1

        return dataframe

    def populate_exit_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        # You can also use consensus for exits, or stick to technical stops
        return dataframe

    # Simple cache to avoid double-polling in the same candle
    _consensus_cache = {}

    def get_consensus_cached(self, pair: str, dataframe: DataFrame):
        current_ts = dataframe.iloc[-1]['date']
        cache_key = f"{pair}_{current_ts}"
        
        if cache_key not in self._consensus_cache:
            self._consensus_cache[cache_key] = self.get_orchestrator_consensus(pair, dataframe)
            
            # Clear old cache entries to save memory
            if len(self._consensus_cache) > 50:
                self._consensus_cache.clear()
                
        return self._consensus_cache.get(cache_key)