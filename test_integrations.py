#!/usr/bin/env python3
"""
test_integrations.py
====================
Test all integrations: Telegram, CoinGecko, Bitget, SoSoValue Macro, and Pipeline.
Run: python test_integrations.py
"""

from dotenv import load_dotenv
load_dotenv()


import os
import asyncio
import sys
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent))

import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(name)s] %(message)s")
log = logging.getLogger("IntegrationTest")


async def test_telegram():
    """Test Telegram integration."""
    log.info("=" * 70)
    log.info("TESTING TELEGRAM INTEGRATION")
    log.info("=" * 70)

    try:
        from data_sources.telegram_notifier import TelegramNotifier

        notifier = TelegramNotifier()

        if not notifier.enabled:
            log.warning("⚠️  Telegram not configured (missing credentials)")
            log.info("   Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env")
            return None

        log.info("✅ Telegram initialized")
        log.info(f"   Bot token: {notifier.bot_token[:20]}...")
        log.info(f"   Chat ID: {notifier.chat_id}")

        # Send test message
        result = await notifier.send_alert(
            title="Integration Test",
            description="✅ AiTradingAgent Telegram integration is working!",
            alert_type="SUCCESS",
        )

        if result:
            log.info("✅ Test message sent successfully")
            return True
        else:
            log.warning("⚠️  Failed to send test message")
            return False

    except Exception as e:
        log.error(f"❌ Telegram test error: {e}")
        return False


def test_coingecko():
    """Test CoinGecko integration."""
    log.info("=" * 70)
    log.info("TESTING COINGECKO INTEGRATION")
    log.info("=" * 70)

    try:
        from data_sources.coingecko_feed import CoinGeckoFeed

        cg = CoinGeckoFeed()
        log.info("✅ CoinGecko initialized")

        # Test 1: Get BTC price
        btc_price = cg.get_price("bitcoin")
        if btc_price:
            btc_usd = btc_price.get("bitcoin", {}).get("usd", 0)
            log.info(f"✅ BTC Price: ${btc_usd:,.2f}")
        else:
            log.warning("⚠️  Failed to fetch BTC price")
            return False

        # Test 2: Get trending tokens
        trending = cg.get_trending(3)
        if trending:
            log.info(f"✅ Top 3 Trending Tokens:")
            for i, token in enumerate(trending[:3], 1):
                name = token["item"]["name"]
                rank = token["item"]["market_cap_rank"]
                log.info(f"   {i}. {name} (Rank: {rank})")
        else:
            log.warning("⚠️  Failed to fetch trending tokens")
            return False

        # Test 3: Get global data
        global_data = cg.get_global_data()
        if global_data:
            market_cap = global_data.get("total_market_cap", {}).get("usd", 0)
            btc_dom = global_data.get("btc_market_cap_percentage", {}).get("btc", 0)
            log.info(f"✅ Global Market Data:")
            log.info(f"   Total Market Cap: ${market_cap:,.0f}")
            log.info(f"   BTC Dominance: {btc_dom:.2f}%")
        else:
            log.warning("⚠️  Failed to fetch global data")
            return False

        return True

    except Exception as e:
        log.error(f"❌ CoinGecko test error: {e}")
        return False


def test_coinmarketcap():
    """Test CoinMarketCap integration."""
    log.info("=" * 70)
    log.info("TESTING COINMARKETCAP INTEGRATION")
    log.info("=" * 70)

    try:
        from data_sources.coinmarketcap_feed import CoinMarketCapFeed

        cmc = CoinMarketCapFeed()
        log.info("✅ CoinMarketCap feed initialized")

        if not cmc.is_configured:
            log.warning("ℹ️  CoinMarketCap not configured (missing API key)")
            log.info("   Set CMC_API_KEY or COINMARKETCAP_API_KEY in .env")
            return None

        # Test 1: Get multi-token quotes
        quotes = cmc.get_quotes(["BTC", "ETH", "SOL"])
        if quotes and "BTC" in quotes:
            btc_price = quotes["BTC"].get("price", 0)
            log.info(f"✅ CMC Quotes retrieved | BTC Price: ${btc_price:,.2f}")
            for sym, q in quotes.items():
                log.info(f"   {sym:4s}: ${q.get('price', 0):,.2f} (Rank #{q.get('cmc_rank')})")
        else:
            log.warning("⚠️  Failed to fetch CMC quotes")
            return False

        # Test 2: Get global metrics
        global_data = cmc.get_global_metrics()
        if global_data:
            mcap = global_data.get("total_market_cap", 0)
            btc_dom = global_data.get("btc_dominance", 0)
            log.info(f"✅ CMC Global Metrics: Total MCap=${mcap:,.0f} | BTC Dom={btc_dom:.2f}%")
        else:
            log.warning("⚠️  Failed to fetch CMC global metrics")
            return False

        return True

    except Exception as e:
        log.error(f"❌ CoinMarketCap test error: {e}")
        return False


def test_bitget():
    """Test Bitget integration."""
    log.info("=" * 70)
    log.info("TESTING BITGET INTEGRATION")
    log.info("=" * 70)

    try:
        from data_sources.bitget_exchange import BitgetExchange

        bitget = BitgetExchange(sandbox=os.getenv('BITGET_TESTNET', 'false').lower() == 'true')
        log.info("✅ Bitget initialized (sandbox mode)")

        if not bitget.is_connected():
            log.warning("ℹ️  Bitget not authenticated (missing API credentials)")
            log.info("   Set BITGET_API_KEY, BITGET_SECRET, BITGET_API_PASSPHRASE in .env")
            return None

        # Test 1: Get balance
        balance = bitget.get_balance()
        if balance:
            usdt_balance = balance.get("USDT", {}).get("free", 0)
            log.info(f"✅ Account Balance:")
            log.info(f"   USDT: ${usdt_balance:,.2f}")
        else:
            log.warning("⚠️  Failed to fetch balance")
            return False

        # Test 2: Get BTC ticker
        ticker = bitget.get_ticker("BTC/USDT")
        if ticker:
            log.info(f"✅ BTC/USDT Ticker:")
            log.info(f"   Last Price: ${ticker['last']:,.2f}")
            log.info(f"   Bid: ${ticker['bid']:,.2f}")
            log.info(f"   Ask: ${ticker['ask']:,.2f}")
        else:
            log.warning("⚠️  Failed to fetch ticker")
            return False

        # Test 3: Get open orders
        orders = bitget.get_open_orders()
        if orders is not None:
            log.info(f"✅ Open Orders: {len(orders)}")
        else:
            log.warning("⚠️  Failed to fetch open orders")
            return False

        return True

    except Exception as e:
        log.error(f"❌ Bitget test error: {e}")
        return False


async def test_integrated_pipeline():
    """Test integrated pipeline with all sources."""
    log.info("=" * 70)
    log.info("TESTING INTEGRATED PIPELINE")
    log.info("=" * 70)

    try:
        from integrated_data_pipeline import IntegratedDataPipeline

        log.info("Initializing integrated pipeline...")
        pipeline = IntegratedDataPipeline(
            use_telegram=True,
            use_coingecko=True,
            use_coinmarketcap=True,
            use_bitget=True,
            use_external_data=False,  # Skip external data for quick test
        )

        log.info("✅ Pipeline initialized")
        log.info("Running pipeline cycle...")

        package = await pipeline.run(
            symbol="BTC/USDT",
            send_notifications=False,  # Don't spam Telegram during test
        )

        sources = list(package.get("sources", {}).keys())
        log.info(f"✅ Pipeline cycle complete")
        log.info(f"   Data sources: {', '.join(sources)}")
        log.info(f"   Notifications sent: {len(package.get('notifications_sent', []))}")

        return True

    except Exception as e:
        log.error(f"❌ Pipeline test error: {e}")
        return False


async def main():
    """Run all integration tests."""
    log.info("")
    log.info("╔" + "=" * 68 + "╗")
    log.info("║" + " " * 68 + "║")
    log.info("║" + "  AITRADINGAGENT INTEGRATION TEST SUITE".center(68) + "║")
    log.info("║" + " " * 68 + "║")
    log.info("╚" + "=" * 68 + "╝")
    log.info("")

    results = {
        "CoinMarketCap": test_coinmarketcap(),
        "CoinGecko": test_coingecko(),
        "Bitget": test_bitget(),
        "Telegram": await test_telegram(),
        "Integrated Pipeline": await test_integrated_pipeline(),
    }

    # Summary
    log.info("")
    log.info("=" * 70)
    log.info("TEST SUMMARY")
    log.info("=" * 70)

    passed = 0
    skipped = 0
    failed = 0

    for test_name, result in results.items():
        if result is True:
            status = "✅ PASS"
            passed += 1
        elif result is None:
            status = "ℹ️  OPTIONAL (Needs Key in .env)"
            skipped += 1
        else:
            status = "❌ FAIL"
            failed += 1
        log.info(f"{test_name:25s} {status}")

    log.info("=" * 70)
    log.info(f"Results: {passed} passed, {skipped} optional/skipped, {failed} failed")
    log.info("=" * 70)
    log.info("")

    if failed == 0:
        log.info("🎉 Integration suite verified! Core pipeline & feeds working.")
        log.info("")
        log.info("Next steps:")
        log.info("1. To activate live CoinMarketCap / Telegram / Bitget feeds, set keys in .env")
        log.info("2. Run: python integrated_data_pipeline.py")
        log.info("3. Deploy with: LAUNCH_SIMPLE.bat or launch-full-stack.bat")
        log.info("")
    else:
        log.warning(f"⚠️  {failed} test(s) failed. Check configuration.")


if __name__ == "__main__":
    asyncio.run(main())
