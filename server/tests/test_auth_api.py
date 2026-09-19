"""REST 认证与 RBAC 强制执行：401/403、拒绝留痕、auth/admin 端点。"""

import pytest
from fastapi.testclient import TestClient

from ecos.config import Settings
from ecos.main import create_app


@pytest.fixture()
def auth_settings(settings):
    settings.env = "dev"
    settings.auth_enabled = True
    settings.auth_mode = "local"
    return settings


@pytest.fixture()
def auth_client(auth_settings):
    app = create_app(auth_settings)
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def client(settings):
    app = create_app(settings)
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def seed_people(auth_client):
    """建三个用户：operator-1（operator）、approver-1（approver）、viewer-1（viewer）。"""
    with auth_client.app.state.session_factory() as s:
        from ecos.auth.rbac import ensure_user, grant_role

        ensure_user(s, "operator-1", display_name="运营")
        grant_role(s, "operator-1", "operator")
        ensure_user(s, "approver-1", display_name="审批")
        grant_role(s, "approver-1", "approver")
        ensure_user(s, "viewer-1", display_name="旁观")
        grant_role(s, "viewer-1", "viewer")
        s.commit()


def token_for(client, user_id: str) -> str:
    r = client.post("/api/auth/token", json={"user_id": user_id})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def _all_audit(client) -> list:
    """拒绝留痕分散在各主体名下，测试直接读全量审计。"""
    from ecos.tasks.audit import AuditService

    with client.app.state.session_factory() as s:
        return AuditService(s).list(limit=500)


def test_dev_mode_needs_no_token(client):
    r = client.get("/api/connectors/catalog")
    assert r.status_code == 200


def test_missing_token_is_401(auth_client, seed_people):
    r = auth_client.get("/api/connectors/catalog")
    assert r.status_code == 401
    denied = [e for e in _all_audit(auth_client) if e.action == "auth.denied"]
    assert denied and denied[0].result == "denied"


def _admin_hdr(client) -> dict:
    # dev-user 在 create_app 时自动获得 admin 角色（非生产种子）
    return {"Authorization": f"Bearer {token_for(client, client.app.state.settings.default_user_id)}"}


def test_garbage_token_is_401(auth_client, seed_people):
    r = auth_client.get(
        "/api/connectors/catalog", headers={"Authorization": "Bearer not-a-jwt"}
    )
    assert r.status_code == 401


def test_token_endpoint_rejected_in_oidc_mode(auth_settings):
    auth_settings.auth_mode = "oidc"
    auth_settings.oidc_issuer = "https://idp.test"
    with TestClient(create_app(auth_settings)) as c:
        r = c.post("/api/auth/token", json={"user_id": "operator-1"})
        assert r.status_code == 400


def test_me_returns_identity_and_permissions(auth_client, seed_people):
    token = token_for(auth_client, "operator-1")
    r = auth_client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    data = r.json()["principal"]
    assert data["user_id"] == "operator-1"
    assert "operator" in data["roles"]
    assert "task.approve" not in data["permissions"]


def test_operator_can_install_and_create_run_tasks(auth_client, seed_people):
    h = {"Authorization": f"Bearer {token_for(auth_client, 'operator-1')}"}
    assert auth_client.get("/api/connectors/catalog", headers=h).status_code == 200
    r = auth_client.post(
        "/api/connectors/install",
        headers=h,
        json={"kind": "demo-shop", "credentials": {"access_token": "t"}},
    )
    assert r.status_code == 200, r.text
    r = auth_client.post(
        "/api/tasks",
        headers=h,
        json={
            "type": "research",
            "title": "看商品",
            "steps": [{"name": "看", "tool": "demo-shop:list_products", "args": {}}],
        },
    )
    assert r.status_code == 200, r.text
    task_id = r.json()["task"]["id"]
    assert auth_client.post(f"/api/tasks/{task_id}/run", headers=h).status_code == 200


def test_viewer_is_forbidden_from_write_endpoints(auth_client, seed_people):
    h = {"Authorization": f"Bearer {token_for(auth_client, 'viewer-1')}"}
    assert auth_client.get("/api/connectors/catalog", headers=h).status_code == 200
    r = auth_client.post(
        "/api/connectors/install",
        headers=h,
        json={"kind": "demo-shop", "credentials": {"access_token": "t"}},
    )
    assert r.status_code == 403
    assert auth_client.get("/api/audit", headers=h).status_code == 403
    rows = _all_audit(auth_client)
    rbac_denied = [e for e in rows if e.action == "rbac.denied"]
    assert rbac_denied and rbac_denied[0].result == "denied"
    assert rbac_denied[0].user_id == "viewer-1"


def _create_write_task_as(client, headers) -> dict:
    client.post(
        "/api/connectors/install",
        headers=headers,
        json={"kind": "demo-shop", "credentials": {"access_token": "t"}},
    )
    r = client.post(
        "/api/tasks",
        headers=headers,
        json={
            "type": "publish",
            "title": "上架",
            "steps": [
                {
                    "name": "建",
                    "tool": "demo-shop:create_product",
                    "args": {"sku": "SKU-S", "title": "t", "price": 1.0},
                }
            ],
        },
    )
    assert r.status_code == 200, r.text
    return r.json()["task"]


def test_approver_role_can_approve_operators_task(auth_client, seed_people):
    oh = {"Authorization": f"Bearer {token_for(auth_client, 'operator-1')}"}
    ph = {"Authorization": f"Bearer {token_for(auth_client, 'approver-1')}"}
    task = _create_write_task_as(auth_client, oh)
    r = auth_client.post(
        f"/api/approvals/{task['approval']['id']}/decide",
        headers=ph,
        json={"approver": "approver-1", "decision": "approve"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["approval"]["decided_by"] == "approver-1"


def test_pending_tasks_visible_in_approver_inbox(auth_client, seed_people):
    """认证模式下待审批任务必须出现在持 task.approve 者的任务列表（审批队列），非审批人不可见。"""
    oh = {"Authorization": f"Bearer {token_for(auth_client, 'operator-1')}"}
    ph = {"Authorization": f"Bearer {token_for(auth_client, 'approver-1')}"}
    vh = {"Authorization": f"Bearer {token_for(auth_client, 'viewer-1')}"}
    task = _create_write_task_as(auth_client, oh)
    inbox = [t["id"] for t in auth_client.get("/api/tasks", headers=ph).json()["tasks"]]
    assert task["id"] in inbox
    # 属主仍只看到自己的任务；viewer 有 task.view 但无 task.approve → 不进队列
    assert auth_client.get("/api/tasks", headers=oh).json()["tasks"][0]["id"] == task["id"]
    assert task["id"] not in [t["id"] for t in auth_client.get("/api/tasks", headers=vh).json()["tasks"]]


def test_approver_can_run_after_own_decision_but_not_before(auth_client, seed_people):
    oh = {"Authorization": f"Bearer {token_for(auth_client, 'operator-1')}"}
    ph = {"Authorization": f"Bearer {token_for(auth_client, 'approver-1')}"}
    task = _create_write_task_as(auth_client, oh)
    run_url = f"/api/tasks/{task['id']}/run"
    # 未批先跑：他人任务对审批人仍是 404（不泄露存在性之外的可操作性）
    assert auth_client.post(run_url, headers=ph).status_code == 404
    r = auth_client.post(
        f"/api/approvals/{task['approval']['id']}/decide",
        headers=ph,
        json={"approver": "approver-1", "decision": "approve"},
    )
    assert r.status_code == 200
    r = auth_client.post(run_url, headers=ph)
    assert r.status_code == 200, r.text
    assert r.json()["task"]["status"] == "succeeded"
    # 属主侧看到执行结果
    listed = auth_client.get("/api/tasks", headers=oh).json()["tasks"]
    assert listed[0]["status"] == "succeeded"


def test_owner_cannot_approve_own_task(auth_client, seed_people):
    ah = _admin_hdr(auth_client)
    task = _create_write_task_as(auth_client, ah)
    approval_url = f"/api/approvals/{task['approval']['id']}/decide"
    # 用别人的名义批 → 400（不允许代批）
    r = auth_client.post(
        approval_url, headers=ah, json={"approver": "林芳", "decision": "approve"}
    )
    assert r.status_code == 400
    # 用自己的身份批自己的任务 → 403 且留 denied 痕
    r = auth_client.post(
        approval_url, headers=ah, json={"approver": "dev-user", "decision": "approve"}
    )
    assert r.status_code == 403
    rows = [e for e in _all_audit(auth_client) if e.action == "approval.forbidden"]
    assert rows and rows[0].result == "denied"
    assert rows[0].target_id == task["approval"]["id"]
    # 审批单仍在待批状态
    listed = auth_client.get("/api/tasks", headers=ah).json()["tasks"]
    assert listed[0]["status"] == "pending_approval"


def test_operator_cannot_approve(auth_client, seed_people):
    oh = {"Authorization": f"Bearer {token_for(auth_client, 'operator-1')}"}
    auth_client.post(
        "/api/connectors/install",
        headers=oh,
        json={"kind": "demo-shop", "credentials": {"access_token": "t"}},
    )
    r = auth_client.post(
        "/api/tasks",
        headers=oh,
        json={
            "type": "publish",
            "title": "上架",
            "steps": [
                {
                    "name": "建",
                    "tool": "demo-shop:create_product",
                    "args": {"sku": "SKU-9", "title": "t", "price": 1.0},
                }
            ],
        },
    )
    approval_id = r.json()["task"]["approval"]["id"]
    r = auth_client.post(
        f"/api/approvals/{approval_id}/decide",
        headers=oh,
        json={"approver": "operator-1", "decision": "approve"},
    )
    assert r.status_code == 403


def test_admin_can_create_user_and_assign_role(auth_client):
    h = _admin_hdr(auth_client)
    r = auth_client.post(
        "/api/admin/users", headers=h, json={"user_id": "newbie", "display_name": "新人"}
    )
    assert r.status_code == 200, r.text
    r = auth_client.post("/api/admin/users/newbie/roles", headers=h, json={"role": "operator"})
    assert r.status_code == 200, r.text
    token = token_for(auth_client, "newbie")
    me = auth_client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"}).json()
    assert "operator" in me["principal"]["roles"]


def test_non_admin_cannot_manage_users(auth_client, seed_people):
    h = {"Authorization": f"Bearer {token_for(auth_client, 'operator-1')}"}
    r = auth_client.post("/api/admin/users", headers=h, json={"user_id": "x"})
    assert r.status_code == 403


def test_roles_listing_visible_to_authenticated(auth_client, seed_people):
    h = {"Authorization": f"Bearer {token_for(auth_client, 'viewer-1')}"}
    r = auth_client.get("/api/auth/roles", headers=h)
    assert r.status_code == 200
    codes = {role["code"] for role in r.json()["roles"]}
    assert {"admin", "operator", "approver", "viewer"} <= codes


def test_task_scoped_to_token_principal(auth_client, seed_people):
    oh = {"Authorization": f"Bearer {token_for(auth_client, 'operator-1')}"}
    vh = {"Authorization": f"Bearer {token_for(auth_client, 'viewer-1')}"}
    auth_client.post(
        "/api/connectors/install",
        headers=oh,
        json={"kind": "demo-shop", "credentials": {"access_token": "t"}},
    )
    r = auth_client.post(
        "/api/tasks",
        headers=oh,
        json={
            "type": "research",
            "title": "看",
            "steps": [{"name": "看", "tool": "demo-shop:list_products", "args": {}}],
        },
    )
    task_id = r.json()["task"]["id"]
    # viewer 连 task.run 权限都没有 → 403（权限判定先于资源归属判定）
    assert auth_client.post(f"/api/tasks/{task_id}/run", headers=vh).status_code == 403
    # admin 有 task.run，但任务属主是 operator-1 → 404（不泄露存在性）
    ah = _admin_hdr(auth_client)
    assert auth_client.post(f"/api/tasks/{task_id}/run", headers=ah).status_code == 404
    assert auth_client.get("/api/tasks", headers=ah).json()["tasks"] == []
    # viewer/operator 的列表互不可见
    assert auth_client.get("/api/tasks", headers=vh).json()["tasks"] == []
    assert auth_client.get("/api/connectors/instances", headers=vh).json()["instances"] == []


# ─── 交易域/AI 权限码矩阵（console 计划 T8） ────────────────────────────


def _commerce_draft(client, h) -> str:
    r = client.post(
        "/api/commerce/drafts",
        headers=h,
        json={"title": "测试品", "price": 19.9, "selling_points": ["稳"], "image_label": "主图A", "source": "主图工坊"},
    )
    assert r.status_code == 200, r.text
    return r.json()["draft"]["id"]


def test_roles_matrix_exposes_new_codes(auth_client):
    h = _admin_hdr(auth_client)
    roles = {r["code"]: set(r["permissions"]) for r in auth_client.get("/api/auth/roles", headers=h).json()["roles"]}
    assert "commerce.view" in roles["viewer"]
    assert {"commerce.view", "commerce.manage", "research.run", "ai.use", "ticket.review"} <= roles["operator"]
    assert {"commerce.view", "ticket.review"} <= roles["approver"]
    assert "commerce.manage" not in roles["approver"]
    assert "ticket.review" not in roles["viewer"]
    for code in ("commerce.view", "commerce.manage", "research.run", "ai.use", "ticket.review"):
        assert code in roles["admin"]


def test_viewer_reads_commerce_but_cannot_write(auth_client, seed_people):
    vh = {"Authorization": f"Bearer {token_for(auth_client, 'viewer-1')}"}
    assert auth_client.get("/api/commerce/stores", headers=vh).status_code == 200
    assert auth_client.post("/api/commerce/stores", headers=vh, json={"platform": "taobao"}).status_code == 403
    assert auth_client.post("/api/ai/research", headers=vh, json={"category": "支架"}).status_code == 403
    assert auth_client.patch("/api/commerce/tickets/tk-x/review", headers=vh, json={"decision": "approve"}).status_code == 403


def test_operator_commerce_ai_ticket_permissions(auth_client, seed_people):
    oh = {"Authorization": f"Bearer {token_for(auth_client, 'operator-1')}"}
    assert auth_client.post("/api/commerce/stores", headers=oh, json={"platform": "taobao"}).status_code == 200
    assert auth_client.post("/api/ai/research", headers=oh, json={"category": "支架"}).status_code == 200
    assert auth_client.post("/api/ai/tickets/triage", headers=oh).status_code == 200
    draft_id = _commerce_draft(auth_client, oh)
    # 未安装平台连接器 → 400（先过权限，再到业务校验）
    r = auth_client.post(f"/api/commerce/drafts/{draft_id}/publish", headers=oh, json={"platforms": ["taobao-shop"]})
    assert r.status_code == 400
    inst = auth_client.post(
        "/api/connectors/install",
        headers=oh,
        json={"kind": "taobao-shop", "credentials": {"access_token": "sandbox"}},
    ).json()["instance"]
    assert inst["status"] == "active"
    r = auth_client.post(f"/api/commerce/drafts/{draft_id}/publish", headers=oh, json={"platforms": ["taobao-shop"]})
    assert r.status_code == 200, r.text
    assert r.json()["task"]["status"] == "pending_approval"


def test_approver_ticket_review_yes_manage_no(auth_client, seed_people):
    ph = {"Authorization": f"Bearer {token_for(auth_client, 'approver-1')}"}
    # ticket.review 有 → 过权限；工单属他人/不存在 → 404（不泄露存在性）
    assert auth_client.patch("/api/commerce/tickets/tk-none/review", headers=ph, json={"decision": "reject"}).status_code == 404
    assert auth_client.post("/api/commerce/stores", headers=ph, json={"platform": "taobao"}).status_code == 403
