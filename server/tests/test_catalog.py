import pytest

from ecos.connectors.catalog import (
    AuthKind,
    McpMode,
    Risk,
    Scope,
    default_catalog,
    load_catalog,
)


def test_shipped_demo_shop_entry_loads():
    entry = default_catalog()["demo-shop"]
    assert entry.auth_kind is AuthKind.personal_token
    assert entry.mcp_mode is McpMode.gateway
    assert entry.credential_fields == ("access_token",)
    assert {t.name for t in entry.tools} >= {
        "list_products",
        "create_product",
        "update_price",
    }


def test_scope_and_risk_declared_per_tool():
    entry = default_catalog()["demo-shop"]
    assert entry.tool("list_products").scope is Scope.read
    assert entry.tool("list_products").risk is Risk.low
    assert entry.tool("create_product").scope is Scope.write
    assert entry.tool("update_price").risk is Risk.high


def test_write_tools_require_approval():
    entry = default_catalog()["demo-shop"]
    assert entry.tool("create_product").requires_approval is True
    assert entry.tool("list_products").requires_approval is False
    assert {t.name for t in entry.write_tools} == {"create_product", "update_price"}


def test_missing_required_fields_rejected(tmp_path):
    (tmp_path / "bad.yaml").write_text("kind: bad\nname: Bad\n", encoding="utf-8")
    with pytest.raises(ValueError):
        load_catalog(tmp_path)


def test_duplicate_kind_rejected(tmp_path):
    content = "kind: dup\nname: D\nauth_kind: personal_token\nmcp_mode: gateway\n"
    (tmp_path / "a.yaml").write_text(content, encoding="utf-8")
    (tmp_path / "b.yaml").write_text(content, encoding="utf-8")
    with pytest.raises(ValueError):
        load_catalog(tmp_path)


def test_remote_mode_requires_mcp_url(tmp_path):
    (tmp_path / "r.yaml").write_text(
        "kind: r\nname: R\nauth_kind: api_key\nmcp_mode: remote\n",
        encoding="utf-8",
    )
    with pytest.raises(ValueError):
        load_catalog(tmp_path)


def test_tool_decl_arg_errors_checks_contract():
    from ecos.connectors.catalog import ToolDecl

    decl = ToolDecl(
        name="create_product",
        scope=Scope.write,
        risk=Risk.medium,
        params={"sku": {"type": "string"}, "price": {"type": "number"}},
        required=("sku", "price"),
    )
    assert decl.arg_errors({"sku": "S", "price": 1.0}) == []
    assert "缺少参数: price" in decl.arg_errors({"sku": "S"})
    assert any(
        "未声明参数: stock" in item
        for item in decl.arg_errors({"sku": "S", "price": 1.0, "stock": 3})
    )
    assert any(
        "参数不能为空: sku" in item
        for item in decl.arg_errors({"sku": "  ", "price": 1.0})
    )
