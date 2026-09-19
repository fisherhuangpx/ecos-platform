from ecos.connectors.builder import build_mcp_spec, internal_mcp_url
from ecos.connectors.catalog import AuthKind, ConnectorEntry, McpMode
from ecos.models import ConnectorInstance


def make_entry(**overrides) -> ConnectorEntry:
    base = dict(
        kind="demo-shop",
        name="Demo",
        category="电商平台",
        auth_kind=AuthKind.personal_token,
        mcp_mode=McpMode.gateway,
    )
    base.update(overrides)
    return ConnectorEntry(**base)


def test_remote_spec_carries_vendor_url_and_token():
    entry = make_entry(
        kind="taobao",
        mcp_mode=McpMode.remote,
        mcp_url="https://mcp.example.com/taobao",
    )
    inst = ConnectorInstance(id="con_1", user_id="u", kind="taobao")
    spec = build_mcp_spec(
        entry,
        inst,
        credential="tok-abc",
        gateway_base_url="http://gw",
        gateway_token="gwt",
    )
    assert spec.url == "https://mcp.example.com/taobao"
    assert spec.headers == {"Authorization": "Bearer tok-abc"}
    assert spec.name == "taobao__con_1"
    assert spec.transport == "http"


def test_gateway_spec_routes_through_internal_gateway():
    entry = make_entry()
    inst = ConnectorInstance(id="con_2", user_id="u", kind="demo-shop")
    spec = build_mcp_spec(
        entry,
        inst,
        credential="tok",
        gateway_base_url="http://gw/",
        gateway_token="gwt",
    )
    assert spec.url == "http://gw/api/internal/mcp/demo-shop/con_2?token=gwt"
    assert spec.headers == {}
    assert spec.name == "demo-shop__con_2"


def test_internal_mcp_url_trims_trailing_slash():
    assert (
        internal_mcp_url("http://gw/", "k", "i")
        == "http://gw/api/internal/mcp/k/i"
    )
