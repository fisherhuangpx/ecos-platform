import json

import pytest

from ecos.agent.tools import build_connector_tools
from ecos.connectors.adapters import call_adapter, demo_shop
from ecos.connectors.catalog import default_catalog
from ecos.connectors.executor import ConnectorStepExecutor
from ecos.connectors.service import ConnectorService
from ecos.errors import ConnectorValidationError
from ecos.models import Task
from ecos.security.vault import CredentialVault
from ecos.tasks.approval import ApprovalService
from ecos.tasks.audit import AuditService
from ecos.tasks.engine import TaskEngine


@pytest.fixture(autouse=True)
def _reset_store():
    demo_shop.reset()
    yield
    demo_shop.reset()


@pytest.fixture()
def env(session, settings):
    audit = AuditService(session)
    svc = ConnectorService(
        session=session,
        catalog=default_catalog(),
        vault=CredentialVault(settings.secret_key),
        gateway_base_url=settings.gateway_base_url,
        audit=audit,
    )
    approvals = ApprovalService(session, audit)
    engine = TaskEngine(
        session=session,
        executor=ConnectorStepExecutor(svc),
        audit=audit,
        approvals=approvals,
    )
    svc.install(user_id="u1", kind="demo-shop", credentials={"access_token": "t"})
    tools = build_connector_tools(user_id="u1", connectors=svc, engine=engine)
    return {
        "tools": tools,
        "svc": svc,
        "engine": engine,
        "approvals": approvals,
        "audit": audit,
        "session": session,
    }


def _tool(tools, name):
    return next(t for t in tools if t.name == name)


def _skus() -> list[str]:
    return [
        p["sku"]
        for p in call_adapter("demo-shop", "list_products", {})["products"]
    ]


def _text(chunk) -> str:
    return chunk.content[0].text


def test_toolkit_shape_maps_read_and_write(env):
    names = {t.name for t in env["tools"]}
    assert names == {
        "demo-shop__list_products",
        "demo-shop__get_orders",
        "demo-shop__create_product",
        "demo-shop__update_price",
    }
    read = _tool(env["tools"], "demo-shop__list_products")
    write = _tool(env["tools"], "demo-shop__create_product")
    assert read.is_read_only is True
    assert write.is_read_only is False
    assert "需审批" in write.description


async def test_read_tool_executes_directly_and_audits(env):
    chunk = await _tool(env["tools"], "demo-shop__list_products").call()
    data = json.loads(_text(chunk))
    assert isinstance(data["products"], list)
    rows = env["audit"].list(user_id="u1")
    assert any(r.level == "read" and r.action == "tool.list_products" for r in rows)


async def test_write_tool_creates_pending_task_and_never_executes(env):
    chunk = await _tool(env["tools"], "demo-shop__create_product").call(
        sku="SKU-1", title="新品", price=99.0
    )
    data = json.loads(_text(chunk))
    assert data["status"] == "pending_approval"
    assert "SKU-1" not in _skus()

    task = env["session"].get(Task, data["task_id"])
    assert task.status == "pending_approval"
    assert task.steps[0].requires_approval is True

    approval = env["approvals"].for_task(task)
    env["approvals"].decide(approval.id, approver="林芳", decision="approve")
    env["engine"].run(task)
    assert task.status == "succeeded"
    assert "SKU-1" in _skus()


async def test_read_tool_rejects_undeclared_args_and_audits_failure(env):
    with pytest.raises(ConnectorValidationError):
        await _tool(env["tools"], "demo-shop__list_products").call(bogus=1)
    rows = [
        r
        for r in env["audit"].list(user_id="u1")
        if r.action == "tool.list_products"
    ]
    assert rows and rows[0].result == "failed"


async def test_write_tool_rejects_args_outside_contract(env):
    with pytest.raises(ConnectorValidationError):
        await _tool(env["tools"], "demo-shop__create_product").call(
            sku="SKU-1", title="缺价格"
        )
    assert env["session"].query(Task).count() == 0
