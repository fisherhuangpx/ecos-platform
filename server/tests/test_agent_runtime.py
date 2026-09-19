import pytest
from agentscope.agent import Agent
from agentscope.message import Msg, TextBlock, ToolCallBlock
from agentscope.model import OpenAIChatModel

from ecos.agent.runtime import build_agent, build_model, scripted_model
from ecos.agent.tools import build_connector_tools
from ecos.connectors.adapters import demo_shop
from ecos.connectors.catalog import default_catalog
from ecos.connectors.executor import ConnectorStepExecutor
from ecos.connectors.service import ConnectorService
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
    return {
        "tools": build_connector_tools(user_id="u1", connectors=svc, engine=engine),
        "audit": audit,
    }


def test_build_model_requires_api_key(settings):
    with pytest.raises(ValueError):
        build_model(settings)


def test_build_model_configures_openai_compatible_client(settings):
    settings.model_api_key = "sk-test"
    settings.model_name = "qwen-max"
    settings.model_base_url = "https://example.invalid/v1"
    model = build_model(settings)
    assert isinstance(model, OpenAIChatModel)
    assert model.model == "qwen-max"
    assert model.credential.base_url == "https://example.invalid/v1"
    assert model.stream is False


def test_build_agent_registers_connector_tools(env):
    agent = build_agent(
        name="ecos",
        system_prompt="你是电商运营助手。",
        model=scripted_model([]),
        tools=env["tools"],
    )
    assert isinstance(agent, Agent)
    names = {
        tool.name
        for group in agent.toolkit.tool_groups
        for tool in group.tools
    }
    assert "demo-shop__list_products" in names
    assert "demo-shop__create_product" in names


async def test_scripted_model_drives_full_agent_loop(env):
    model = scripted_model(
        [
            [
                ToolCallBlock(
                    id="call_1",
                    name="demo-shop__list_products",
                    input="{}",
                )
            ],
            [TextBlock(text="已查看商品列表")],
        ]
    )
    agent = build_agent(
        name="ecos",
        system_prompt="你是电商运营助手。",
        model=model,
        tools=env["tools"],
    )
    reply = await agent.reply(
        Msg(name="user", content=[TextBlock(text="看看有哪些商品")], role="user")
    )
    assert "已查看商品列表" in reply.get_text_content()
    assert len(model.calls) == 2
    assert any(
        r.action == "tool.list_products" and r.level == "read"
        for r in env["audit"].list(user_id="u1")
    )
