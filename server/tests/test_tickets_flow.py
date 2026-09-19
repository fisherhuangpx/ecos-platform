"""售后工单审批流：review approve → push_reply(±grant_refund) 写任务；reject 仅本地。"""

import pytest
from fastapi.testclient import TestClient

from ecos.connectors.adapters import platforms
from ecos.main import create_app
from ecos.models import Ticket


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


def _first_ticket(client) -> dict:
    return client.get("/api/commerce/tickets").json()["tickets"][0]


def _approve(client, ticket_id: str):
    return client.patch(
        f"/api/commerce/tickets/{ticket_id}/review",
        json={"decision": "approve"},
    )


def _all_tasks(client) -> list[dict]:
    return client.get("/api/tasks").json()["tasks"]


def test_approve_creates_pending_write_task(client):
    t = _first_ticket(client)
    r = _approve(client, t["id"])
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ticket"]["status"] == "已转执行"
    task = body["task"]
    assert task["status"] == "pending_approval"
    assert task["steps"][0]["tool"].endswith(":push_reply")
    assert "push_reply" in task["steps"][0]["tool"]
    acts = [e["action"] for e in client.get("/api/audit", params={"limit": 300}).json()["entries"]]
    assert "ticket.approve" in acts


def test_approve_with_refund_appends_grant_refund_step(client):
    tickets = client.get("/api/commerce/tickets").json()["tickets"]
    with client.app.state.session_factory() as s:
        row = s.get(Ticket, tickets[0]["id"])
        row.refund_amount = 59.0
        s.commit()
    task = _approve(client, tickets[0]["id"]).json()["task"]
    tools = [st["tool"] for st in task["steps"]]
    assert tools == ["taobao-shop:push_reply", "taobao-shop:grant_refund"]
    assert task["steps"][1]["args"]["amount"] == 59.0


def test_executed_task_writes_platform_ledger(client):
    t = _first_ticket(client)
    task = _approve(client, t["id"]).json()["task"]
    # 红线：未审批直接 run → 409
    assert client.post(f"/api/tasks/{task['id']}/run", json={}).status_code == 409
    decided = client.post(
        f"/api/approvals/{task['approval']['id']}/decide",
        json={"approver": "林芳", "decision": "approve"},
    )
    assert decided.status_code == 200, decided.text
    done = client.post(f"/api/tasks/{task['id']}/run", json={}).json()["task"]
    assert done["status"] == "succeeded"
    assert platforms.ledger("taobao-shop")["replies"]


def test_reject_is_local_only(client):
    t = _first_ticket(client)
    r = client.patch(
        f"/api/commerce/tickets/{t['id']}/review",
        json={"decision": "reject", "reason": "需先确认库存", "feedback": "应先查库存再给方案"},
    )
    assert r.status_code == 200
    ticket = r.json()["ticket"]
    assert ticket["status"] == "已驳回"
    assert ticket["reject_reason"] == "需先确认库存"
    assert ticket["reject_feedback"] == "应先查库存再给方案"
    assert _all_tasks(client) == []
    acts = [e["action"] for e in client.get("/api/audit", params={"limit": 300}).json()["entries"]]
    assert "ticket.reject" in acts


def test_bad_decision_rejected(client):
    t = _first_ticket(client)
    r = client.patch(f"/api/commerce/tickets/{t['id']}/review", json={"decision": "whatever"})
    assert r.status_code == 400


def test_cross_tenant_404(client):
    with client.app.state.session_factory() as s:
        other = Ticket(user_id="someone-else", order_ref="X1", customer="赵**", platform="taobao",
                       product_name="p", complaint="c", status="待审批")
        s.add(other)
        s.commit()
        oid = other.id
    assert _approve(client, oid).status_code == 404
    ids = [t["id"] for t in client.get("/api/commerce/tickets").json()["tickets"]]
    assert oid not in ids
