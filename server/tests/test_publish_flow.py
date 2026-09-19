"""发布任务化 E2E：drafts/{id}/publish → 审批 → 执行 → 部分失败 → 修正重发。"""

import pytest
from fastapi.testclient import TestClient

from ecos.connectors.adapters import platforms
from ecos.main import create_app

KINDS = {"taobao-shop", "tmall-shop", "douyin-shop", "pdd-shop", "jd-shop"}


@pytest.fixture(autouse=True)
def _reset_ledger():
    platforms.reset()
    yield
    platforms.reset()


@pytest.fixture()
def client(settings):
    app = create_app(settings)
    with TestClient(app) as c:
        yield c


def _make_draft(client, title="新品支架", price=9.9):
    r = client.post(
        "/api/commerce/drafts",
        json={"title": title, "price": price, "selling_points": ["稳"], "image_label": "主图A", "source": "主图工坊"},
    )
    return r.json()["draft"]


def _publish(client, title="新品支架", price=9.9, targets=("taobao-shop", "douyin-shop")):
    draft = _make_draft(client, title=title, price=price)
    return client.post(f"/api/commerce/drafts/{draft['id']}/publish", json={"platforms": list(targets)})


def _approve_and_run(client, task):
    appr = task["approval"]["id"]
    r = client.post(f"/api/approvals/{appr}/decide", json={"approver": "林芳", "decision": "approve"})
    assert r.status_code == 200, r.text
    return client.post(f"/api/tasks/{task['id']}/run", json={}).json()["task"]


def test_platform_sandbox_instances_seeded(client):
    kinds = {i["kind"] for i in client.get("/api/connectors/instances").json()["instances"]}
    assert KINDS <= kinds
    assert all(i["status"] == "active" for i in client.get("/api/connectors/instances").json()["instances"] if i["kind"] in KINDS)


def test_publish_end_to_end(client):
    r = _publish(client)
    assert r.status_code == 200, r.text
    task = r.json()["task"]
    assert task["status"] == "pending_approval" and len(task["steps"]) == 2
    done = _approve_and_run(client, task)
    assert done["status"] == "succeeded"
    assert platforms.ledger("taobao-shop")["published"], "淘宝沙箱应收到上架写入"
    assert platforms.ledger("douyin-shop")["published"], "抖音沙箱应收到上架写入"
    acts = [e["action"] for e in client.get("/api/audit", params={"limit": 300}).json()["entries"]]
    assert "commerce.publish" in acts


def test_draft_status_advances(client):
    draft = _make_draft(client)
    r = client.post(f"/api/commerce/drafts/{draft['id']}/publish", json={"platforms": ["taobao-shop"]})
    assert r.status_code == 200
    after = {d["id"]: d for d in client.get("/api/commerce/drafts").json()["drafts"]}[draft["id"]]
    assert after["status"] == "已提交"


def test_partial_failure_deterministic_then_fix_and_republish(client):
    r = _publish(client, title="高价钻石", price=99999, targets=("taobao-shop", "douyin-shop"))
    task = r.json()["task"]
    done = _approve_and_run(client, task)
    assert done["status"] == "partial_failed"
    douyin_step = next(s for s in done["steps"] if "抖音" in s["name"])
    assert douyin_step["status"] == "failed" and "合规打回" in (douyin_step["error"] or "")
    # 重试同样确定性打回（守卫不是偶发故障）
    retried = client.post(f"/api/tasks/{task['id']}/retry", json={}).json()["task"]
    assert retried["status"] == "partial_failed"
    # 修正草稿价格 → 重新发布 → 完整闭环成功
    r2 = _publish(client, title="高价钻石", price=99, targets=("taobao-shop", "douyin-shop"))
    done2 = _approve_and_run(client, r2.json()["task"])
    assert done2["status"] == "succeeded"


def test_banned_title_rejected(client):
    assert _publish(client, title="全网最好的支架").status_code == 400


def test_empty_or_unknown_platform_rejected(client):
    assert _publish(client, targets=()).status_code == 400
    assert _publish(client, targets=("amazon",)).status_code == 400


def test_publish_requires_installed_active_connector(client):
    # 撤销 pdd-shop 实例后发布到 pdd → 400（外部写前置校验，不落任务）
    inst = next(i for i in client.get("/api/connectors/instances").json()["instances"] if i["kind"] == "pdd-shop")
    assert client.post(f"/api/connectors/instances/{inst['id']}/revoke").status_code == 200
    r = _publish(client, targets=("pdd-shop",))
    assert r.status_code == 400
    assert client.get("/api/tasks").json()["tasks"] == []
