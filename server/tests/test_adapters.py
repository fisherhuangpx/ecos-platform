import pytest

from ecos.connectors.adapters import call_adapter, demo_shop
from ecos.errors import AdapterError


@pytest.fixture(autouse=True)
def _reset_store():
    demo_shop.reset()
    yield
    demo_shop.reset()


def test_list_and_create_roundtrip():
    before = call_adapter("demo-shop", "list_products", {})
    assert isinstance(before["products"], list)

    created = call_adapter(
        "demo-shop",
        "create_product",
        {"sku": "SKU-1", "title": "新品", "price": 99.0},
    )
    assert created["status"] == "created"

    after = call_adapter("demo-shop", "list_products", {})
    assert "SKU-1" in [p["sku"] for p in after["products"]]


def test_duplicate_sku_rejected():
    call_adapter(
        "demo-shop",
        "create_product",
        {"sku": "SKU-2", "title": "新品", "price": 1.0},
    )
    with pytest.raises(AdapterError):
        call_adapter(
            "demo-shop",
            "create_product",
            {"sku": "SKU-2", "title": "重复", "price": 2.0},
        )


def test_flaky_sku_fails_first_attempt_then_succeeds():
    with pytest.raises(AdapterError):
        call_adapter(
            "demo-shop",
            "create_product",
            {"sku": "SKU-FLAKY", "title": "限流品", "price": 5.0},
        )
    retried = call_adapter(
        "demo-shop",
        "create_product",
        {"sku": "SKU-FLAKY", "title": "限流品", "price": 5.0},
    )
    assert retried["status"] == "created"


def test_update_price_only_for_existing_sku():
    with pytest.raises(AdapterError):
        call_adapter("demo-shop", "update_price", {"sku": "NOPE", "price": 1.0})
    call_adapter(
        "demo-shop",
        "create_product",
        {"sku": "SKU-3", "title": "改价品", "price": 10.0},
    )
    updated = call_adapter("demo-shop", "update_price", {"sku": "SKU-3", "price": 8.0})
    assert updated["price"] == 8.0


def test_unknown_adapter_or_tool_rejected():
    with pytest.raises(AdapterError):
        call_adapter("no-such-kind", "list_products", {})
    with pytest.raises(AdapterError):
        call_adapter("demo-shop", "drop_table", {})
