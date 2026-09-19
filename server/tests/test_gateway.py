"""内部 MCP 网关：过期签名令牌 + JSON-RPC 子集端点。"""

import json

import pytest
from fastapi.testclient import TestClient

from ecos.connectors.adapters import demo_shop
from ecos.main import create_app
from ecos.security.vault import CredentialVault


@pytest.fixture(autouse=True)
def _reset_store():
    demo_shop.reset()
    yield
    demo_shop.reset()


@pytest.fixture()
def client(settings):
    app = create_app(settings)
    with TestClient(app) as c:
        yield c


def _install(client) -> dict:
    r = client.post(
        "/api/connectors/install",
        json={"kind": "demo-shop", "credentials": {"access_token": "tok"}},
    )
    assert r.status_code == 200
    return r.json()["instance"]


def _token_from_url(url: str) -> str:
    return url.split("token=")[1]


# ---------- vault 令牌 ----------

def test_gateway_token_roundtrip_and_expiry():
    vault = CredentialVault("s3cret")
    token = vault.issue_gateway_token("inst-1", ttl_seconds=60)
    assert vault.verify_gateway_token("inst-1", token)
    assert not vault.verify_gateway_token("inst-2", token)
    assert not vault.verify_gateway_token("inst-1", token[:-2] + "zz")
    expired = vault.issue_gateway_token("inst-1", ttl_seconds=-5)
    assert not vault.verify_gateway_token("inst-1", expired)


def test_mcp_spec_url_carries_verifiable_token(client):
    inst = _install(client)
    r = client.get(f"/api/connectors/instances/{inst['id']}/mcp-spec")
    assert r.status_code == 200
    data = r.json()["spec"]
    token = _token_from_url(data["url"])
    vault = client.app.state.vault
    assert vault.verify_gateway_token(inst["id"], token)


# ---------- 端点 ----------

def _rpc(client, inst, token, method, params=None, req_id=1):
    url = f"/api/internal/mcp/{inst['kind']}/{inst['id']}?token={token}"
    body = {"jsonrpc": "2.0", "id": req_id, "method": method}
    if params is not None:
        body["params"] = params
    return client.post(url, json=body)


def _gateway_ctx(client):
    inst = _install(client)
    r = client.get(f"/api/connectors/instances/{inst['id']}/mcp-spec")
    token = _token_from_url(r.json()["spec"]["url"])
    return inst, token


def test_initialize_handshake(client):
    inst, token = _gateway_ctx(client)
    r = _rpc(client, inst, token, "initialize", {"protocolVersion": "2024-11-05", "capabilities": {}})
    assert r.status_code == 200
    result = r.json()["result"]
    assert result["serverInfo"]["name"] == inst["mcp_server_name"]
    assert "tools" in result["capabilities"]


def test_tools_list_exposes_declared_contract(client):
    inst, token = _gateway_ctx(client)
    r = _rpc(client, inst, token, "tools/list")
    tools = {t["name"]: t for t in r.json()["result"]["tools"]}
    assert set(tools) >= {"list_products", "create_product", "update_price"}
    cp = tools["create_product"]
    assert cp["inputSchema"]["required"] == ["sku", "title", "price"]
    assert cp["risk"] == "medium" and cp["requiresApproval"] is True


def test_tools_call_read_executes_directly_and_audits(client):
    inst, token = _gateway_ctx(client)
    r = _rpc(client, inst, token, "tools/call", {"name": "list_products", "arguments": {}})
    payload = json.loads(r.json()["result"]["content"][0]["text"])
    assert any(p["sku"] == "SKU-1001" for p in payload["products"])
    from ecos.tasks.audit import AuditService

    with client.app.state.session_factory() as s:
        rows = AuditService(s).list(user_id="dev-user")
    hit = [e for e in rows if e.action == "tool.list_products" and e.actor == "mcp-gateway"]
    assert hit and hit[0].level == "read" and hit[0].result == "ok"


def test_tools_call_write_only_creates_pending_task(client):
    inst, token = _gateway_ctx(client)
    r = _rpc(
        client,
        inst,
        token,
        "tools/call",
        {"name": "create_product", "arguments": {"sku": "SKU-G", "title": "网关品", "price": 8.0}},
    )
    body = r.json()["result"]
    assert body["isError"] is False
    payload = json.loads(body["content"][0]["text"])
    assert payload["approval_required"] is True
    assert payload["status"] == "pending_approval"
    assert "SKU-G" not in [p["sku"] for p in demo_shop.list_products()["products"]]


def test_tools_call_respects_arg_contract(client):
    inst, token = _gateway_ctx(client)
    r = _rpc(
        client,
        inst,
        token,
        "tools/call",
        {"name": "create_product", "arguments": {"sku": "SKU-G", "stock": 3}},
    )
    err = r.json()["error"]
    assert err["code"] == -32602
    assert "契约" in err["message"]


def test_invalid_or_expired_token_is_401_and_audited(client):
    inst, _ = _gateway_ctx(client)
    r = _rpc(client, inst, "garbage.token", "initialize")
    assert r.status_code == 401
    vault = client.app.state.vault
    expired = vault.issue_gateway_token(inst["id"], ttl_seconds=-5)
    assert _rpc(client, inst, expired, "initialize").status_code == 401
    from ecos.tasks.audit import AuditService

    with client.app.state.session_factory() as s:
        rows = AuditService(s).list(user_id="dev-user")
    denied = [e for e in rows if e.action == "connector.gateway.denied"]
    assert len(denied) >= 2 and all(e.result == "denied" for e in denied)


def test_revoked_or_foreign_instance_is_404(client):
    inst, token = _gateway_ctx(client)
    r = client.post(f"/api/connectors/instances/{inst['id']}/revoke", json={})
    assert r.status_code == 200
    assert _rpc(client, inst, token, "initialize").status_code == 404
    assert _rpc(client, {"kind": "demo-shop", "id": "nope"}, token, "initialize").status_code == 404


def test_unknown_method_is_jsonrpc_error(client):
    inst, token = _gateway_ctx(client)
    r = _rpc(client, inst, token, "tools/launch-missiles")
    assert r.status_code == 200
    assert r.json()["error"]["code"] == -32601


def test_body_not_json_returns_parse_error(client):
    inst, token = _gateway_ctx(client)
    url = f"/api/internal/mcp/{inst['kind']}/{inst['id']}?token={token}"
    r = client.post(url, content=b"not-json", headers={"content-type": "application/json"})
    assert r.status_code == 200
    assert r.json()["error"]["code"] == -32700
