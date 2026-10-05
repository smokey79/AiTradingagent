# data_sources package
from data_sources.coinmarketcap_feed import CoinMarketCapFeed
from data_sources.coingecko_feed import CoinGeckoFeed
from data_sources.ccxt_feed import CCXTFeed
from data_sources.sosovalue_feed import SoSoValueFeed
from data_sources.bitget_exchange import BitgetExchange
from data_sources.telegram_notifier import TelegramNotifier
from data_sources.unified_data_loader import UnifiedDataLoader
from data_sources.elitesignal_feed import EliteSignalFeed  # Elite Signal Substack (equities/macro)
from data_sources.bigdata_feed import BigdataFeed  # Bigdata.com news sentiment (crypto + macro)

__all__ = [
    "CoinMarketCapFeed",
    "CoinGeckoFeed",
    "CCXTFeed",
    "SoSoValueFeed",
    "BitgetExchange",
    "TelegramNotifier",
    "UnifiedDataLoader",
    "EliteSignalFeed",
    "BigdataFeed",
]
