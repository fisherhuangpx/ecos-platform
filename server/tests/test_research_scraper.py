"""抓取基座：blocked/empty/unreachable 分类、参数契约前置校验、TTL 缓存命中/过期。"""

import pytest

import ecos.research.scraper as scraper_mod
from ecos.research.base import FetchError, make_signal
from ecos.research.scraper import ScraperSource, fetch_http_text
from ecos.research.snapshot import fresh_payload, query_key, store_payload

BLOCKED_PAGE = "<html>请输入验证码 captcha</html>"


class TinySource(ScraperSource):
    id = "tiny"
    name = "微型源"
    board = "shelf"
    url_template = "https://example.com/hot?cat={category}"
    params = {"category": {"type": "string"}}
    required = ("category",)
    min_interval_seconds = 0.0  # 测试免限频

    def parse(self, text):
        if "支架" in text:
            return [make_signal(self.id, "京东", "手机支架", "heat", 9, "7d", "https://e")]
        return []


def test_fetch_rejects_invalid_args():
    with pytest.raises(ValueError):
        TinySource().fetch({})


def test_fetch_blocked_and_empty_classification(monkeypatch):
    monkeypatch.setattr(scraper_mod, "fetch_http_text", lambda url, **kw: BLOCKED_PAGE)
    with pytest.raises(FetchError) as e:
        TinySource().fetch({"category": "支架"})
    assert e.value.kind == "blocked"

    monkeypatch.setattr(scraper_mod, "fetch_http_text", lambda url, **kw: "无相关数据")
    with pytest.raises(FetchError) as e2:
        TinySource().fetch({"category": "支架"})
    assert e2.value.kind == "empty"


def test_fetch_success_returns_signals(monkeypatch):
    monkeypatch.setattr(scraper_mod, "fetch_http_text", lambda url, **kw: "支架热销")
    calls = {}

    def fake(url, **kw):
        calls["url"] = url
        return "支架热销"

    monkeypatch.setattr(scraper_mod, "fetch_http_text", fake)
    signals = TinySource().fetch({"category": "支架"})
    assert signals[0]["metric"] == "heat"
    assert calls["url"] == "https://example.com/hot?cat=支架"


def test_proxy_required_but_missing_is_unreachable(monkeypatch):
    monkeypatch.setattr(scraper_mod, "fetch_http_text", lambda url, **kw: "支架")
    src = TinySource()
    src.use_proxy = True
    src.proxy_url = ""
    with pytest.raises(FetchError) as e:
        src.fetch({"category": "x"})
    assert e.value.kind == "unreachable"


def test_http_error_maps_to_blocked(monkeypatch):
    import httpx

    def boom(url, **kw):
        raise httpx.ConnectError("refused")

    monkeypatch.setattr(scraper_mod, "fetch_http_text", boom)
    with pytest.raises(FetchError) as e:
        TinySource().fetch({"category": "支架"})
    assert e.value.kind == "blocked"


def test_snapshot_ttl(session):
    from ecos.models.base import utcnow

    args = {"category": "支架"}
    payload = [make_signal("tiny", "京东", "手机支架", "heat", 9, "7d", "https://e")]
    assert fresh_payload(session, "tiny", args, ttl=600) is None
    store_payload(session, "tiny", args, payload)
    session.commit()
    assert query_key("tiny", args) == query_key("tiny", dict(args))
    got = fresh_payload(session, "tiny", args, ttl=600)
    assert got and got[0]["keyword"] == "手机支架"
    assert fresh_payload(session, "tiny", args, ttl=-1) is None  # 视为已过期
    store_payload(session, "tiny", args, payload)  # upsert 不撞唯一约束
    session.commit()
    assert fresh_payload(session, "tiny", args, ttl=600) is not None
