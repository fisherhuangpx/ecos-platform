"""平台沙箱适配器：五个电商平台的确定性模拟（demo_shop 同族，供交易域任务 E2E）。

账本按 kind 隔离；douyin 的 publish_product 价格 >=9999 触发合规打回（部分失败演示）。
"""

import copy
from typing import Any

from ...errors import AdapterError
from .registry import call_adapter, register  # noqa: F401  re-export call_adapter

PLATFORM_KINDS = ("taobao-shop", "tmall-shop", "douyin-shop", "pdd-shop", "jd-shop")

_LEDGER: dict[str, dict[str, Any]] = {}

_ORDERS = [
    {"order_id": "ORD-20260901-001", "sku": "SKU-A", "qty": 2, "status": "已发货"},
    {"order_id": "ORD-20260901-002", "sku": "SKU-B", "qty": 1, "status": "待发货"},
    {"order_id": "ORD-20260901-003", "sku": "SKU-A", "qty": 3, "status": "已完成"},
]


def reset() -> None:
    _LEDGER.clear()


def ledger(kind: str) -> dict[str, Any]:
    return _bucket(kind)


def _bucket(kind: str) -> dict[str, Any]:
    return _LEDGER.setdefault(kind, {"published": {}, "replies": [], "refunds": []})


def _make(kind: str) -> dict[str, Any]:
    def publish_product(sku: str, title: str, price: float) -> dict[str, Any]:
        if kind == "douyin-shop" and float(price) >= 9999:
            raise AdapterError("平台合规打回：价格异常")
        bucket = _bucket(kind)
        bucket["published"][sku] = {"sku": sku, "title": title, "price": float(price)}
        return {"status": "published", "sku": sku, "platform": kind}

    def update_price(sku: str, price: float) -> dict[str, Any]:
        bucket = _bucket(kind)
        if sku not in bucket["published"]:
            raise AdapterError(f"商品不存在: {sku}")
        bucket["published"][sku]["price"] = float(price)
        return {"status": "updated", "sku": sku, "price": float(price)}

    def push_reply(order_ref: str, body: str) -> dict[str, Any]:
        _bucket(kind)["replies"].append({"order_ref": order_ref, "body": body})
        return {"status": "sent", "order_ref": order_ref}

    def grant_refund(order_ref: str, amount: float) -> dict[str, Any]:
        _bucket(kind)["refunds"].append({"order_ref": order_ref, "amount": float(amount)})
        return {"status": "refunded", "order_ref": order_ref, "amount": float(amount)}

    def list_orders() -> dict[str, Any]:
        return {"orders": copy.deepcopy(_ORDERS)}

    return {
        "publish_product": publish_product,
        "update_price": update_price,
        "push_reply": push_reply,
        "grant_refund": grant_refund,
        "list_orders": list_orders,
    }


for _kind in PLATFORM_KINDS:
    register(_kind, _make(_kind))
