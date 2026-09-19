"""垂直切片演示：安装连接器 → 读工具直连 → 写工具被审批闸门拦住 → 审批 → 执行 → 审计。

运行： .venv/Scripts/python.exe demo/run_slice.py
全部为内存态（SQLite :memory: + demo-shop 模拟平台），不访问网络、不落盘。
"""

from __future__ import annotations

import asyncio
import json
import sys

from agentscope.message import Msg, TextBlock, ToolCallBlock

from ecos.agent.runtime import build_agent, scripted_model
from ecos.agent.tools import build_connector_tools
from ecos.config import Settings
from ecos.connectors.adapters import call_adapter, demo_shop
from ecos.connectors.catalog import default_catalog
from ecos.connectors.executor import ConnectorStepExecutor
from ecos.connectors.service import ConnectorService
from ecos.db import init_db, make_engine, make_session_factory
from ecos.errors import ApprovalRequired
from ecos.models import Task
from ecos.security.vault import CredentialVault
from ecos.tasks.approval import ApprovalService
from ecos.tasks.audit import AuditService
from ecos.tasks.engine import TaskEngine


def banner(title: str) -> None:
    print(f"\n{'=' * 4} {title} {'=' * 4}")


async def main() -> None:
    demo_shop.reset()
    settings = Settings(
        database_url="sqlite://",
        secret_key="demo-secret",
        gateway_base_url="http://localhost:8000",
    )
    engine = make_engine(settings.database_url)
    init_db(engine)
    session = make_session_factory(engine)()
    user_id = settings.default_user_id

    audit = AuditService(session)
    connectors = ConnectorService(
        session=session,
        catalog=default_catalog(),
        vault=CredentialVault(settings.secret_key),
        gateway_base_url=settings.gateway_base_url,
        audit=audit,
    )
    approvals = ApprovalService(session, audit)
    tasks = TaskEngine(
        session=session,
        executor=ConnectorStepExecutor(connectors),
        audit=audit,
        approvals=approvals,
    )

    banner("1. 安装连接器：凭据加密入库，生成 Octop 风格 mcp_server_name")
    instance = connectors.install(
        user_id=user_id, kind="demo-shop", credentials={"access_token": "demo-token"}
    )
    session.commit()
    print(f"实例 {instance.id}  status={instance.status}  {instance.mcp_server_name}")
    print(f"凭据密文前缀: {instance.credential_blob[:24]}…（明文不落库）")

    banner("2. 生成 MCP 接入 spec（gateway 模式：内部端点 + 派生短时令牌）")
    spec = connectors.mcp_spec(instance)
    print(
        json.dumps(
            {"name": spec.name, "transport": spec.transport, "url": spec.url},
            ensure_ascii=False,
            indent=2,
        )
    )

    tools = build_connector_tools(user_id=user_id, connectors=connectors, engine=tasks)
    print(f"已装配工具: {[t.name for t in tools]}")

    banner("3. 读工具：Agent 直接执行，落 read 级审计")
    agent = build_agent(
        name="ecos",
        system_prompt="你是电商运营助手。",
        model=scripted_model(
            [
                [
                    ToolCallBlock(
                        id="call_1", name="demo-shop__list_products", input="{}"
                    )
                ],
                [TextBlock(text="已获取商品列表")],
            ]
        ),
        tools=tools,
    )
    reply = await agent.reply(
        Msg(name="user", content=[TextBlock(text="看看有哪些商品")], role="user")
    )
    session.commit()
    print(f"Agent 回复: {reply.get_text_content()}")

    banner("4. 写工具：只创建待审批任务，绝不直接执行")
    write_tool = next(t for t in tools if t.name == "demo-shop__create_product")
    chunk = await write_tool.call(sku="SKU-DEMO", title="演示新品", price=88.0)
    session.commit()
    result = json.loads(chunk.content[0].text)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    task = session.get(Task, result["task_id"])
    approval = approvals.for_task(task)
    print(f"任务 {task.id}  status={task.status}  审批单 {approval.id}（{approval.status}）")
    print(f"此刻店铺商品: {[p['sku'] for p in call_adapter('demo-shop', 'list_products', {})['products']]}")

    banner("5. 审批前执行：被闸门拦截")
    try:
        tasks.run(task)
    except ApprovalRequired as exc:
        print(f"已拦截 → {exc}")

    banner("6. 人工审批通过 → 任务引擎执行 → 商品真正上架")
    approvals.decide(approval.id, approver="林芳", decision="approve")
    session.commit()
    tasks.run(task)
    session.commit()
    print(f"任务 status={task.status}")
    print(f"店铺商品: {[p['sku'] for p in call_adapter('demo-shop', 'list_products', {})['products']]}")

    banner("7. 审计流水（时间正序）")
    for row in reversed(audit.list(user_id=user_id)):
        print(f"{row.level:>8} | {row.actor:<10} | {row.action:<28} | {row.result}")

    session.close()
    engine.dispose()


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    asyncio.run(main())
