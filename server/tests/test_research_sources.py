"""live 源解析：fixture 纯函数断言（零网络）；fixture 结构来自真实抓取校准。"""

import json
from pathlib import Path

import pytest

from ecos.research.base import BOARDS, METRICS, TIERS, FetchError
from ecos.research.sources.amazon_bestsellers import AmazonBestSellers
from ecos.research.sources.douyin_hot import DouyinHot
from ecos.research.sources.google_trends import GoogleTrends

FIXTURES = Path(__file__).parent / "fixtures" / "research"


def _load(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


def _assert_signals(signals):
    assert signals
    for s in signals:
        assert s["metric"] in METRICS and s["url"].startswith("http") and s["keyword"]


def test_douyin_hot_parse_real_shape():
    # 真实结构：顶层 word_list[]，元素 {word, hot_value, label}
    signals = DouyinHot().parse(_load("douyin_hot.json"))
    assert len(signals) >= 2
    assert signals[0]["metric"] == "heat"
    assert signals[0]["platform"] == "抖音"
    assert signals[0]["value"] > 0
    _assert_signals(signals)


def test_douyin_hot_parse_layout_on_non_json():
    with pytest.raises(FetchError) as e:
        DouyinHot().parse("<html>blocked</html>")
    assert e.value.kind == "layout"


def test_google_trends_parse_strips_jsonp_prefix():
    raw = ")]}',\n" + _load("google_trends.json")
    signals = GoogleTrends().parse(raw)
    assert signals and signals[0]["metric"] == "trend"
    assert signals[0]["value"] == pytest.approx(100000)  # "100K+" → 100000
    assert any(s["keyword"] == "车载磁吸支架" for s in signals)  # relatedQueries 也在池内
    _assert_signals(signals)


def test_amazon_bestsellers_parse_rank_price_real_shape():
    html = _load("amazon_bestsellers.html")
    signals = AmazonBestSellers().parse(html)
    ranks = [s for s in signals if s["metric"] == "rank"]
    prices = [s for s in signals if s["metric"] == "price_band"]
    assert [s["value"] for s in ranks] == [1, 2]
    assert prices[0]["value"] == pytest.approx(80.32)  # CNY 本地化价也要能解析
    assert ranks[0]["platform"] == "Amazon"
    _assert_signals(signals)


def test_registry_contract_live():
    from ecos.research.sources import default_sources

    srcs = default_sources()
    assert {s.id for s in srcs} >= {
        "douyin_hot",
        "google_trends",
        "amazon_bestsellers",
        "jd_rank",
        "ali1688_hot",
        "baidu_index",
        "juliang_trend",
    }
    for src in srcs:
        assert src.board in BOARDS and src.tier in TIERS
        assert src.capabilities()["input_schema"]["type"] == "object"


def test_registry_disabled_pull():
    from ecos.research.sources import default_sources

    srcs = default_sources(disabled=frozenset({"douyin_hot"}))
    assert "douyin_hot" not in {s.id for s in srcs}


def test_jd_rank_parse():
    from ecos.research.sources.jd_rank import JdRank

    signals = JdRank().parse(_load("jd_rank.html"))
    sales = [s for s in signals if s["metric"] == "sales_proxy"]
    prices = [s for s in signals if s["metric"] == "price_band"]
    assert [s["value"] for s in sales][:2] == [20000, 5000]  # 2万+ / 5000+
    assert prices[0]["value"] == pytest.approx(39.90)
    assert any(s["keyword"] == "磁吸 手机支架 车载" for s in signals)  # span 标签已清洗
    _assert_signals(signals)


def test_ali1688_hot_parse():
    from ecos.research.sources.ali1688_hot import Ali1688Hot

    signals = Ali1688Hot().parse(_load("ali1688_hot.json"))
    assert signals and signals[0]["platform"] == "1688" and signals[0]["metric"] == "heat"
    assert signals[0]["value"] == pytest.approx(12345)
    _assert_signals(signals)


def test_baidu_index_degrades_on_non_json():
    from ecos.research.sources.baidu_index import BaiduIndex

    with pytest.raises(FetchError) as e:
        BaiduIndex().parse("<html>403</html>")
    assert e.value.kind == "blocked"


def test_baidu_index_parse():
    from ecos.research.sources.baidu_index import BaiduIndex

    signals = BaiduIndex().parse(_load("baidu_index.json"))
    assert signals[0]["metric"] == "trend"
    assert signals[0]["value"] == pytest.approx(45678)
    _assert_signals(signals)


def test_juliang_trend_parse():
    from ecos.research.sources.juliang_trend import JuliangTrend

    signals = JuliangTrend().parse(_load("juliang_trend.json"))
    assert signals and signals[0]["metric"] == "trend"
    assert signals[0]["platform"] == "抖音"
    _assert_signals(signals)


def test_shells_report_health_by_credential_presence():
    from ecos.research.sources.shells import Chanmama, TaobaoOpen

    t = TaobaoOpen(credential_lookup=lambda kind: None)
    c = Chanmama(credential_lookup=lambda kind: {"app_key": "k", "app_secret": "s"})
    assert t.health() == "awaiting_credentials"
    assert c.health() == "configured"
    with pytest.raises(FetchError) as e:
        t.fetch({"category": "支架"})
    assert e.value.kind == "unconfigured"


def test_registry_now_nine_sources():
    from ecos.research.sources import default_sources

    srcs = default_sources()
    assert len(srcs) == 9
    assert {s.tier for s in srcs} == {"live", "official", "licensed"}
