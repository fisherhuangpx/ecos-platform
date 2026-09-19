"""平台沙箱连接器：目录契约 + 确定性适配器行为。"""

import pytest

from ecos.connectors.adapters import platforms
from ecos.connectors.catalog import Scope, default_catalog
from ecos.errors import AdapterError


@pytest.fixture(autouse=True)
def _reset_ledger():
    platforms.reset()
    yield
    platforms.reset()


KINDS = {"taobao-shop", "tmall-shop", "douyin-shop", "pdd-shop", "jd-shop"}


def test_five_platform_kinds_in_catalog():
    cat = default_catalog()
    assert KINDS <= set(cat)


def test_tool_contract_declared_per_platform():
    cat = default_catalog()
    for kind in KINDS:
        entry = cat[kind]
        tools = {t.name: t for t in entry.tools}
        assert set(tools) == {"publish_product", "update_price", "push_reply", "grant_refund", "list_orders"}
        assert tools["publish_product"].scope is Scope.write
        assert tools["publish_product"].requires_approval is True
        assert tools["list_orders"].scope is Scope.read
        assert tools["list_orders"].requires_approval is False


def test_douyin_price_guard_is_deterministic():
    ok = platforms.call_adapter("douyin-shop", "publish_product", {"sku": "S1", "title": "t", "price": 9.9})
    assert ok["status"] == "published"
    with pytest.raises(AdapterError, match="合规打回"):
        platforms.call_adapter("douyin-shop", "publish_product", {"sku": "S2", "title": "t", "price": 9999})


def test_other_platforms_accept_high_price():
    for kind in KINDS - {"douyin-shop"}:
        ok = platforms.call_adapter(kind, "publish_product", {"sku": "S9", "title": "t", "price": 9999})
        assert ok["status"] == "published"


def test_write_tools_update_ledger():
    platforms.call_adapter("taobao-shop", "publish_product", {"sku": "A1", "title": "支架", "price": 39.0})
    platforms.call_adapter("taobao-shop", "update_price", {"sku": "A1", "price": 35.0})
    r = platforms.call_adapter("taobao-shop", "push_reply", {"order_ref": "DD1", "body": "已催促物流"})
    assert r["status"] == "sent"
    r = platforms.call_adapter("taobao-shop", "grant_refund", {"order_ref": "DD1", "amount": 59})
    assert r["status"] == "refunded" and r["amount"] == 59.0
    ledger = platforms.ledger("taobao-shop")
    assert ledger["published"]["A1"]["price"] == 35.0


def test_update_price_unknown_sku_fails():
    with pytest.raises(AdapterError, match="不存在"):
        platforms.call_adapter("pdd-shop", "update_price", {"sku": "NOPE", "price": 1.0})


def test_list_orders_returns_fixed_three():
    out = platforms.call_adapter("jd-shop", "list_orders", {})
    assert len(out["orders"]) == 3


def test_ledger_isolated_per_kind():
    platforms.call_adapter("tmall-shop", "publish_product", {"sku": "X", "title": "t", "price": 1.0})
    assert "X" in platforms.ledger("tmall-shop")["published"]
    assert platforms.ledger("pdd-shop")["published"] == {}
