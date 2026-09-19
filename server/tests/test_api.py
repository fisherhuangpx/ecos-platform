import json

import pytest
from fastapi.testclient import TestClient

from ecos.connectors.adapters import demo_shop
from ecos.main import create_app
from ecos.models import Task


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
        json={"kind": "demo-shop", "credentials": {"access_token": "tok-123"}},
    )
    assert r.status_code == 200, r.text
    return r.json()["instance"]


def test_healthz(client):
    assert client.get("/healthz").json() == {"status": "ok"}


def test_catalog_endpoint_exposes_scope_and_risk(client):
    data = client.get("/api/connectors/catalog").json()
    entry = next(c for c in data["connectors"] if c["kind"] == "demo-shop")
    tools = {t["name"]: t for t in entry["tools"]}
    assert tools["create_product"]["scope"] == "write"
    assert tools["create_product"]["requires_approval"] is True
    assert tools["update_price"]["risk"] == "high"


def test_install_never_returns_plaintext_credential(client):
    inst = _install(client)
    assert inst["status"] == "active"
    assert "tok-123" not in json.dumps(inst)
    assert inst["mcp_server_name"].startswith("demo-shop__")
    listed = client.get("/api/connectors/instances").json()["instances"]
    # 种子会预装 5 个平台沙箱实例：按 kind 过滤后仍只允许一个 demo-shop
    assert [i["id"] for i in listed if i["kind"] == "demo-shop"] == [inst["id"]]


def test_install_unknown_kind_is_400(client):
    r = client.post(
        "/api/connectors/install",
        json={"kind": "nope", "credentials": {}},
    )
    assert r.status_code == 400


def test_duplicate_active_install_is_400(client):
    _install(client)
    r = client.post(
        "/api/connectors/install",
        json={"kind": "demo-shop", "credentials": {"access_token": "again"}},
    )
    assert r.status_code == 400


def test_create_task_rejects_unknown_tool(client):
    _install(client)
    r = client.post(
        "/api/tasks",
        json={
            "type": "publish",
            "title": "t",
            "steps": [{"name": "n", "tool": "demo-shop:not_exists"}],
        },
    )
    assert r.status_code == 400


def test_full_gated_loop_over_api(client):
    _install(client)
    r = client.post(
        "/api/tasks",
        json={
            "type": "publish",
            "title": "上架新品",
            "steps": [
                {"name": "查看商品", "tool": "demo-shop:list_products"},
                {
                    "name": "创建商品",
                    "tool": "demo-shop:create_product",
                    "args": {"sku": "SKU-1", "title": "新品", "price": 99.0},
                    "requires_approval": False,
                },
            ],
        },
    )
    assert r.status_code == 200, r.text
    task = r.json()["task"]
    assert task["status"] == "pending_approval"
    assert task["steps"][1]["requires_approval"] is True
    approval_id = task["approval"]["id"]

    blocked = client.post(f"/api/tasks/{task['id']}/run")
    assert blocked.status_code == 409

    decision = client.post(
        f"/api/approvals/{approval_id}/decide",
        json={"approver": "林芳", "decision": "approve"},
    )
    assert decision.status_code == 200, decision.text

    done = client.post(f"/api/tasks/{task['id']}/run")
    assert done.status_code == 200, done.text
    assert done.json()["task"]["status"] == "succeeded"

    entries = client.get("/api/audit").json()["entries"]
    chronological = list(reversed([e["action"] for e in entries]))
    assert chronological.index("approval.approve") < chronological.index("task.started")
    levels = {e["level"] for e in entries}
    assert {"read", "write", "system"} <= levels


def test_partial_failure_and_retry_over_api(client):
    _install(client)
    r = client.post(
        "/api/tasks",
        json={
            "type": "publish",
            "title": "批量上架",
            "steps": [
                {
                    "name": "创建限流品",
                    "tool": "demo-shop:create_product",
                    "args": {"sku": "SKU-FLAKY", "title": "限流品", "price": 5.0},
                },
                {
                    "name": "创建正常品",
                    "tool": "demo-shop:create_product",
                    "args": {"sku": "SKU-2", "title": "正常品", "price": 6.0},
                },
            ],
        },
    )
    task = r.json()["task"]
    approval_id = task["approval"]["id"]
    client.post(
        f"/api/approvals/{approval_id}/decide",
        json={"approver": "林芳", "decision": "approve"},
    )
    run = client.post(f"/api/tasks/{task['id']}/run")
    assert run.json()["task"]["status"] == "partial_failed"

    retry = client.post(f"/api/tasks/{task['id']}/retry")
    assert retry.status_code == 200, retry.text
    assert retry.json()["task"]["status"] == "succeeded"

    failed = [
        e for e in client.get("/api/audit").json()["entries"]
        if e["action"] == "task.step.failed"
    ]
    assert failed and "限流" in json.dumps(failed[0]["detail"], ensure_ascii=False)


def test_run_unknown_task_is_404(client):
    assert client.post("/api/tasks/task_missing/run").status_code == 404


def test_denied_run_attempt_is_audited_over_http(client):
    _install(client)
    r = client.post(
        "/api/tasks",
        json={
            "type": "publish",
            "title": "上架新品",
            "steps": [
                {
                    "name": "创建",
                    "tool": "demo-shop:create_product",
                    "args": {"sku": "SKU-1", "title": "新品", "price": 9.0},
                }
            ],
        },
    )
    task = r.json()["task"]
    assert client.post(f"/api/tasks/{task['id']}/run").status_code == 409
    entries = client.get("/api/audit").json()["entries"]
    blocked = [e for e in entries if e["action"] == "task.approval_blocked"]
    assert blocked and blocked[0]["result"] == "denied"
    assert blocked[0]["target_id"] == task["id"]


def test_task_args_validated_against_catalog(client):
    _install(client)
    missing = client.post(
        "/api/tasks",
        json={
            "type": "publish",
            "title": "缺参数",
            "steps": [
                {
                    "name": "创建",
                    "tool": "demo-shop:create_product",
                    "args": {"sku": "SKU-1"},
                }
            ],
        },
    )
    assert missing.status_code == 400
    extra = client.post(
        "/api/tasks",
        json={
            "type": "publish",
            "title": "越权参数",
            "steps": [
                {
                    "name": "创建",
                    "tool": "demo-shop:create_product",
                    "args": {
                        "sku": "SKU-1",
                        "title": "新品",
                        "price": 1.0,
                        "stock": 9,
                    },
                }
            ],
        },
    )
    assert extra.status_code == 400


def test_commit_failure_surfaces_as_error_not_success(settings, monkeypatch):
    from sqlalchemy.orm import Session as OrmSession

    with TestClient(create_app(settings), raise_server_exceptions=False) as safe:
        _install(safe)

        def boom(self):
            raise RuntimeError("commit failed")

        monkeypatch.setattr(OrmSession, "commit", boom)
        r = safe.post(
            "/api/tasks",
            json={
                "type": "research",
                "title": "看商品",
                "steps": [{"name": "查看", "tool": "demo-shop:list_products"}],
            },
        )
        assert r.status_code == 500


def _create_write_task(client) -> dict:
    r = client.post(
        "/api/tasks",
        json={
            "type": "publish",
            "title": "上架新品",
            "steps": [
                {
                    "name": "创建",
                    "tool": "demo-shop:create_product",
                    "args": {"sku": "SKU-1", "title": "新品", "price": 9.0},
                }
            ],
        },
    )
    return r.json()["task"]


def test_cross_user_task_is_not_executable(client):
    _install(client)
    task = _create_write_task(client)
    _reassign_task(client, task["id"], "someone-else")
    assert client.post(f"/api/tasks/{task['id']}/run").status_code == 404
    assert client.post(f"/api/tasks/{task['id']}/retry").status_code == 404


def test_cross_user_approval_is_not_decidable(client):
    _install(client)
    task = _create_write_task(client)
    _reassign_task(client, task["id"], "someone-else")
    r = client.post(
        f"/api/approvals/{task['approval']['id']}/decide",
        json={"approver": "林芳", "decision": "approve"},
    )
    assert r.status_code == 404


def _reassign_task(client, task_id: str, new_user_id: str) -> None:
    """把任务改到他人名下（模拟多租户越权访问）。"""
    app = client.app
    with app.state.session_factory() as s:
        s.get(Task, task_id).user_id = new_user_id
        s.commit()
