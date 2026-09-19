"""/api/research：注入假源后全链路；租户隔离；RBAC；缓存命中。"""

import pytest
from fastapi.testclient import TestClient

from ecos.config import Settings
from ecos.main import create_app
from tests.helpers_research import FakeSource, sig

FAKE_SOURCES = [
    FakeSource("s_a", "shelf", [sig("s_a", "京东", "手机支架", "heat", 500),
                                 sig("s_a", "京东", "手机支架", "price_band", 39.9)]),
    FakeSource("s_b", "content", [sig("s_b", "抖音", "磁吸支架", "heat", 900)]),
    FakeSource("s_c", "crossborder", [], fail="blocked"),
]


@pytest.fixture()
def app_factory(monkeypatch):
    def make(settings: Settings):
        import ecos.main as main_mod
        monkeypatch.setattr(
            main_mod, "default_research_sources", lambda settings, vault_lookup=None: FAKE_SOURCES
        )
        return create_app(settings)
    return make


@pytest.fixture()
def client(app_factory):
    settings = Settings(database_url="sqlite://", secret_key="test-secret",
                        gateway_base_url="http://testserver")
    app = app_factory(settings)
    with TestClient(app) as c:
        yield c


def _run_blocking(client, category="手机支架"):
    r = client.post("/api/research", json={"category": category, "blocking": True})
    assert r.status_code == 200, r.text
    return r.json()["run_id"]


def test_research_full_chain(client):
    run_id = _run_blocking(client)
    body = client.get(f"/api/research/runs/{run_id}").json()
    assert body["run"]["status"] == "partial"          # s_c 失败
    kinds = [s["kind"] for s in body["steps"]]
    assert kinds[0] == "plan" and kinds[-2:] == ["cross", "synthesize"]
    top = body["candidates"][0]
    assert top["name"] and top["evidence"] and top["heat"] > 0
    assert client.get("/api/research/sources").json()["sources"]  # 假源也在健康表


def test_research_validation_and_audit(client):
    assert client.post("/api/research", json={"category": "  "}).status_code == 400
    _run_blocking(client, "冰袖")
    actions = [a["action"] for a in client.get("/api/audit").json()["entries"]]
    assert "research.create" in actions and "research.finish" in actions


def test_research_tenant_404_and_rbac(app_factory):
    settings = Settings(database_url="sqlite://", secret_key="test-secret",
                        gateway_base_url="http://testserver",
                        auth_enabled=True, auth_mode="local")
    app = app_factory(settings)
    with TestClient(app) as c:
        with c.app.state.session_factory() as s:
            from ecos.auth.rbac import ensure_user, grant_role
            ensure_user(s, "operator-9"); grant_role(s, "operator-9", "operator")
            ensure_user(s, "operator-8"); grant_role(s, "operator-8", "operator")
            ensure_user(s, "approver-9"); grant_role(s, "approver-9", "approver")
            s.commit()
        tok_o = c.post("/api/auth/token", json={"user_id": "operator-9"}).json()["access_token"]
        tok_p = c.post("/api/auth/token", json={"user_id": "operator-8"}).json()["access_token"]
        tok_a = c.post("/api/auth/token", json={"user_id": "approver-9"}).json()["access_token"]
        c.headers.update({"Authorization": f"Bearer {tok_o}"})
        rid = c.post("/api/research", json={"category": "手机支架", "blocking": True}).json()["run_id"]
        assert c.get(f"/api/research/runs/{rid}").status_code == 200
        # 有 research.run 的他人 → 404（租户隔离不泄漏存在性）
        c.headers["Authorization"] = f"Bearer {tok_p}"
        assert c.get(f"/api/research/runs/{rid}").status_code == 404
        # 无权限 → 403（权限判定先于租户判定）
        c.headers["Authorization"] = f"Bearer {tok_a}"
        assert c.get(f"/api/research/runs/{rid}").status_code == 403
        assert c.post("/api/research", json={"category": "x"}).status_code == 403  # 无 research.run
        assert "rbac.denied" in [a["action"] for a in c.get("/api/audit").json()["entries"]]


def test_cached_second_request_reuses_run(client):
    a = _run_blocking(client, "车载支架")
    r = client.post("/api/research", json={"category": "车载支架", "blocking": True})
    assert r.json()["run_id"] == a and r.json()["cached"] is True
