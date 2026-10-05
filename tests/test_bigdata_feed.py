"""Offline tests for data_sources/bigdata_feed.py (no API key or network needed)."""
import importlib
from unittest import mock


def _feed(tmp_path, monkeypatch, key="test-key"):
    monkeypatch.setenv("BIGDATA_OUT_DIR", str(tmp_path))
    monkeypatch.setenv("BIGDATA_API_KEY", key)
    import data_sources.bigdata_feed as bf
    importlib.reload(bf)
    return bf, bf.BigdataFeed()


def _resp(sentiments):
    r = mock.Mock(status_code=200)
    r.json.return_value = {"results": [{
        "headline": f"h{i}", "url": f"u{i}", "source": {"name": "src"}, "timestamp": "t",
        "chunks": [{"cnum": 1, "text": "x", "relevance": 1.0, "sentiment": s}],
    } for i, s in enumerate(sentiments)]}
    return r


def test_no_key_abstains(tmp_path, monkeypatch):
    bf, feed = _feed(tmp_path, monkeypatch, key="")
    v = feed.get_consensus_input("BTC")
    assert v["signal"] == "HOLD" and v["confidence"] == 0.0 and "ignore_source" in v["constraints"]


def test_bullish_news_votes_buy(tmp_path, monkeypatch):
    bf, feed = _feed(tmp_path, monkeypatch)
    with mock.patch.object(feed.session, "post", return_value=_resp([0.6] * 10)):
        v = feed.get_consensus_input("BTC")
    assert v["signal"] == "BUY" and 0 < v["confidence"] <= bf.WEIGHT


def test_small_sample_abstains(tmp_path, monkeypatch):
    bf, feed = _feed(tmp_path, monkeypatch)
    with mock.patch.object(feed.session, "post", return_value=_resp([0.9] * 3)):
        v = feed.get_consensus_input("ETH")
    assert v["signal"] == "HOLD" and "sample too small" in v["reason"]


def test_bad_key_uses_no_fake_data(tmp_path, monkeypatch):
    bf, feed = _feed(tmp_path, monkeypatch)
    with mock.patch.object(feed.session, "post", return_value=mock.Mock(status_code=401)):
        v = feed.get_consensus_input("BTC")
    assert v["signal"] == "HOLD" and v["confidence"] == 0.0
