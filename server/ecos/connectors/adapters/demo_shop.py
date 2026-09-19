"""demo-shop 模拟平台适配器：内存态商品库 + 可复现故障（供重试演示）。"""

import copy
from typing import Any

from ...errors import AdapterError
from .registry import register

_PRODUCTS: dict[str, dict[str, Any]] = {}
_FLAKY_FAILED: set[str] = set()

_SEED = [
    {"sku": "SKU-1001", "title": "示例商品 A", "price": 59.0, "stock": 120},
    {"sku": "SKU-1002", "title": "示例商品 B", "price": 128.0, "stock": 45},
]

_ORDERS = [
    {"order_id": "ORD-20260918-001", "sku": "SKU-1001", "qty": 2, "status": "已发货"},
    {"order_id": "ORD-20260918-002", "sku": "SKU-1002", "qty": 1, "status": "待发货"},
]


def reset() -> None:
    _PRODUCTS.clear()
    _FLAKY_FAILED.clear()
    for product in _SEED:
        _PRODUCTS[product["sku"]] = dict(product)


def list_products() -> dict[str, Any]:
    return {"products": copy.deepcopy(list(_PRODUCTS.values()))}


def get_orders() -> dict[str, Any]:
    return {"orders": copy.deepcopy(_ORDERS)}


def create_product(sku: str, title: str, price: float) -> dict[str, Any]:
    if sku == "SKU-FLAKY" and sku not in _FLAKY_FAILED:
        _FLAKY_FAILED.add(sku)
        raise AdapterError("平台限流：请稍后重试（模拟一次性故障）")
    if sku in _PRODUCTS:
        raise AdapterError(f"商品已存在: {sku}")
    _PRODUCTS[sku] = {"sku": sku, "title": title, "price": float(price), "stock": 0}
    return {"status": "created", "sku": sku}


def update_price(sku: str, price: float) -> dict[str, Any]:
    if sku not in _PRODUCTS:
        raise AdapterError(f"商品不存在: {sku}")
    _PRODUCTS[sku]["price"] = float(price)
    return {"status": "updated", "sku": sku, "price": float(price)}


register(
    "demo-shop",
    {
        "list_products": list_products,
        "get_orders": get_orders,
        "create_product": create_product,
        "update_price": update_price,
    },
)

reset()
