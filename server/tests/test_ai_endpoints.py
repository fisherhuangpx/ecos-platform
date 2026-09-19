"""AI 端点：Simulated 快照确定性、triage 流转、审计与装配。"""

import pytest
from fastapi.testclient import TestClient

from ecos.ai.adapter import LiveAdapter, SimulatedAdapter, build_adapter
from ecos.main import create_app


@pytest.fixture()
def client(settings):
    app = create_app(settings)
    with TestClient(app) as c:
        yield c


def _actions(client):
    return [e["action"] for e in client.get("/api/audit", params={"limit": 300}).json()["entries"]]


def test_research_snapshot_deterministic(client):
    a = client.post("/api/ai/research", json={"category": "车载支架"}).json()["candidates"]
    b = client.post("/api/ai/research", json={"category": "车载支架"}).json()["candidates"]
    assert a == b and len(a) == 5
    for c in a:
        assert {"id", "name", "platform", "monthly_sales", "price", "keywords", "heat"} <= set(c)
        assert c["name"].startswith("车载支架")
        assert isinstance(c["heat"], int) and isinstance(c["keywords"], list)


def test_research_different_category_rotates(client):
    a = client.post("/api/ai/research", json={"category": "车载支架"}).json()["candidates"]
    b = client.post("/api/ai/research", json={"category": "果汁杯"}).json()["candidates"]
    assert [c["id"] for c in a] != [c["id"] for c in b]


def test_research_audited(client):
    client.post("/api/ai/research", json={"category": "冰袖"})
    assert "ai.research" in _actions(client)


def test_research_requires_category(client):
    assert client.post("/api/ai/research", json={"category": ""}).status_code == 400


def test_insight_narrative(client):
    sid = client.get("/api/commerce/stores").json()["stores"][0]["id"]
    r1 = client.get("/api/ai/insight", params={"store_id": sid})
    assert r1.status_code == 200
    n1 = r1.json()["narrative"]
    assert n1 and n1 == client.get("/api/ai/insight", params={"store_id": sid}).json()["narrative"]
    assert "ai.insight" in _actions(client)


def test_triage_flows_pending_tickets(client):
    tickets = client.get("/api/commerce/tickets").json()["tickets"]
    assert tickets and all(t["status"] == "待分析" for t in tickets)
    r = client.post("/api/ai/tickets/triage")
    assert r.status_code == 200
    assert r.json()["triaged"] == len(tickets)
    after = client.get("/api/commerce/tickets").json()["tickets"]
    for t in after:
        assert t["status"] == "待审批"
        assert t["attribution"] in ("物流", "质量", "尺码", "错发", "其他")
        assert 0 < t["confidence"] <= 100
        assert t["reply_draft"]
    assert "ai.triage" in _actions(client)


def test_triage_idempotent(client):
    assert client.post("/api/ai/tickets/triage").json()["triaged"] == 2
    assert client.post("/api/ai/tickets/triage").json()["triaged"] == 0


def test_simulated_keyword_mapping():
    ad = SimulatedAdapter()
    cases = {
        "快递三天了还没到": "物流",
        "充电线磁吸端松动，吸不住": "质量",
        "买的大码感觉偏小，戴着勒": "尺码",
        "收到的是白色，我明明下单黑色": "错发",
        "就是想退货": "其他",
    }
    for complaint, expected in cases.items():
        out = ad.triage_ticket(complaint)
        assert out["attribution"] == expected, complaint
        assert out["suggestion"] and out["reply_draft"]


def test_build_adapter(settings):
    settings.model_name = ""
    assert isinstance(build_adapter(settings), SimulatedAdapter)
    settings.model_name = "gpt-test"
    settings.model_api_key = "sk-test"
    settings.model_base_url = "http://localhost:9/v1"
    assert isinstance(build_adapter(settings), LiveAdapter)
