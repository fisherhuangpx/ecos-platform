"""交易域查询与本地写端点：种子可见、状态流转、租户过滤、审计、/api/meta。"""

import pytest
from fastapi.testclient import TestClient

from ecos.config import Settings
from ecos.main import create_app
from ecos.models import Store


@pytest.fixture()
def client(settings):
    app = create_app(settings)
    with TestClient(app) as c:
        yield c


def _actions(client, limit: int = 200) -> list[str]:
    entries = client.get("/api/audit", params={"limit": limit}).json()["entries"]
    return [e["action"] for e in entries]


def test_stores_seed_visible(client):
    stores = client.get("/api/commerce/stores").json()["stores"]
    assert len(stores) == 5
    assert {s["platform"] for s in stores} == {"taobao", "tmall", "douyin", "pdd", "jd"}
    assert sum(1 for s in stores if s["status"] == "connected") == 4


def test_kpis_aggregate_seed(client):
    k = client.get("/api/commerce/kpis").json()["kpis"]
    assert k["stores_connected"] == 4 and k["products"] >= 12
    assert k["orders_7d"] > 0 and k["gmv_7d"] > 0


def test_products_and_orders_scoped_by_store(client):
    sid = client.get("/api/commerce/stores").json()["stores"][0]["id"]
    prods = client.get("/api/commerce/products", params={"store_id": sid}).json()["products"]
    assert prods and all(p["store_id"] == sid for p in prods)
    orders = client.get("/api/commerce/orders", params={"store_id": sid, "limit": 10}).json()["orders"]
    assert 0 < len(orders) <= 10


def test_analytics_series_14_buckets(client):
    sid = client.get("/api/commerce/stores").json()["stores"][0]["id"]
    series = client.get("/api/commerce/analytics/series", params={"store_id": sid}).json()["series"]
    assert len(series) == 14
    assert all("date" in s and "amount" in s and "orders" in s for s in series)


def test_store_create_patch_delete_audited(client):
    r = client.post("/api/commerce/stores", json={"platform": "taobao"})
    assert r.status_code == 200, r.text
    sid = r.json()["store"]["id"]
    assert client.patch(f"/api/commerce/stores/{sid}", json={"status": "expired"}).status_code == 200
    assert client.delete(f"/api/commerce/stores/{sid}").status_code == 200
    acts = _actions(client)
    assert {"commerce.store_create", "commerce.store_update", "commerce.store_delete"} <= set(acts)
    assert sid not in [s["id"] for s in client.get("/api/commerce/stores").json()["stores"]]


def test_store_platform_whitelist_400(client):
    assert client.post("/api/commerce/stores", json={"platform": "amazon"}).status_code == 400
    assert client.patch("/api/commerce/stores/st-x", json={"status": "broken"}).status_code in (400, 404)


def test_favorites_roundtrip(client):
    fv = client.post(
        "/api/commerce/favorites",
        json={"ref_id": "rc-1", "name": "磁吸支架 爆款", "source": "抖音", "heat": 88, "price": 39},
    ).json()["favorite"]
    assert client.get("/api/commerce/favorites").json()["favorites"][0]["id"] == fv["id"]
    assert client.delete(f"/api/commerce/favorites/{fv['id']}").status_code == 200
    assert client.get("/api/commerce/favorites").json()["favorites"] == []


def test_asset_create_and_version_append(client):
    a = client.post("/api/commerce/assets", json={"name": "主图 A", "type": "main", "tags": ["3C"]}).json()["asset"]
    assert [v["v"] for v in a["versions"]] == ["v1"] and a["versions"][0]["note"] == "上传"
    r = client.post(f"/api/commerce/assets/{a['id']}/versions", json={"by": "林芳", "note": "复审"}).json()["asset"]
    assert [v["v"] for v in r["versions"]] == ["v2", "v1"]
    assert "commerce.asset_version_add" in _actions(client)


def test_seed_assets_have_versions(client):
    assets = client.get("/api/commerce/assets").json()["assets"]
    assert len(assets) == 3 and all(a["versions"] for a in assets)


def test_draft_crud(client):
    d = client.post(
        "/api/commerce/drafts",
        json={"title": "新品支架", "price": 9.9, "selling_points": ["稳"], "image_label": "主图A", "source": "主图工坊"},
    ).json()["draft"]
    assert d["status"] == "待完善"
    patched = client.patch(f"/api/commerce/drafts/{d['id']}", json={"title": "改名"}).json()["draft"]
    assert patched["title"] == "改名" and patched["price"] == 9.9
    assert client.delete(f"/api/commerce/drafts/{d['id']}").status_code == 200
    assert client.get("/api/commerce/drafts").json()["drafts"] == []


def test_foreign_tenant_row_invisible_and_404(client):
    with client.app.state.session_factory() as s:
        other = Store(user_id="someone-else", platform="taobao", name="别人的店", status="connected")
        s.add(other)
        s.commit()
        oid = other.id
    ids = [x["id"] for x in client.get("/api/commerce/stores").json()["stores"]]
    assert oid not in ids
    assert client.patch(f"/api/commerce/stores/{oid}", json={"status": "expired"}).status_code == 404
    assert client.delete(f"/api/commerce/stores/{oid}").status_code == 404


def test_tickets_seed_visible(client):
    tickets = client.get("/api/commerce/tickets").json()["tickets"]
    assert len(tickets) == 2 and all(t["status"] == "待分析" for t in tickets)


def test_meta_public_in_auth_mode():
    st = Settings(
        database_url="sqlite://",
        secret_key="test-secret",
        auth_enabled=True,
        auth_mode="local",
    )
    app = create_app(st)
    with TestClient(app) as c:
        r = c.get("/api/meta")
        assert r.status_code == 200
        body = r.json()
        assert body["auth_enabled"] is True and body["auth_mode"] == "local"
        assert "app_version" in body
        # 未登录访问受保护端点仍是 401（meta 不是认证旁路）
        assert c.get("/api/commerce/stores").status_code == 401
