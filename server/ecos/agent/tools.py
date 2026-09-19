"""连接器工具 → AgentScope FunctionTool 桥。

读工具：直接执行 + read 级审计（失败也落审计）。
写工具：绝不直接执行，只创建一步待审批任务，交由任务引擎的审批闸门放行。
"""

from __future__ import annotations

from typing import Any

from agentscope.permission import PermissionBehavior, PermissionDecision
from agentscope.tool import FunctionTool

from ..connectors.adapters import call_adapter
from ..connectors.catalog import ToolDecl
from ..connectors.service import ConnectorService
from ..errors import ConnectorValidationError
from ..tasks.engine import TaskEngine, spec_from_tool


def _arg_contract_error(tool_name: str, decl: ToolDecl, args: dict[str, Any]):
    errors = decl.arg_errors(args)
    if errors:
        return ConnectorValidationError(
            f"{tool_name} 参数不符合目录契约: {'；'.join(errors)}"
        )
    return None


def build_connector_tools(
    *, user_id: str, connectors: ConnectorService, engine: TaskEngine
) -> list[FunctionTool]:
    tools: list[FunctionTool] = []
    for instance in connectors.list_instances(user_id):
        if instance.status != "active":
            continue
        entry = connectors.catalog.get(instance.kind)
        if entry is None:
            continue
        for decl in entry.tools:
            tools.append(
                _make_tool(
                    user_id=user_id,
                    kind=instance.kind,
                    entry_name=entry.name,
                    decl=decl,
                    connectors=connectors,
                    engine=engine,
                )
            )
    return tools


def _make_tool(
    *,
    user_id: str,
    kind: str,
    entry_name: str,
    decl: ToolDecl,
    connectors: ConnectorService,
    engine: TaskEngine,
) -> FunctionTool:
    tool_name = f"{kind}__{decl.name}"
    audit = connectors.audit

    if decl.scope.value == "read":

        async def _read(**kwargs: Any) -> dict[str, Any]:
            instance = None
            try:
                instance, resolved = connectors.resolve_tool(
                    user_id, kind, decl.name
                )
                contract_error = _arg_contract_error(tool_name, resolved, kwargs)
                if contract_error is not None:
                    raise contract_error
                output = call_adapter(kind, decl.name, kwargs)
            except Exception as exc:  # noqa: BLE001 失败调用同样必须留痕
                audit.log(
                    user_id=user_id,
                    actor="agent",
                    action=f"tool.{decl.name}",
                    target_type="connector_instance",
                    target_id=instance.id if instance is not None else "",
                    level="read",
                    result="failed",
                    detail={
                        "tool": tool_name,
                        "args": kwargs,
                        "error": str(exc),
                    },
                )
                raise
            audit.log(
                user_id=user_id,
                actor="agent",
                action=f"tool.{decl.name}",
                target_type="connector_instance",
                target_id=instance.id,
                level="read",
                detail={"tool": tool_name, "args": kwargs},
            )
            return output

        return FunctionTool(
            _read,
            name=tool_name,
            description=decl.description or tool_name,
            input_schema=decl.input_schema,
            is_read_only=True,
            permission=PermissionDecision(
                behavior=PermissionBehavior.ALLOW,
                message="只读工具，自动放行",
            ),
        )

    async def _write(**kwargs: Any) -> dict[str, Any]:
        contract_error = _arg_contract_error(tool_name, decl, kwargs)
        if contract_error is not None:
            raise contract_error
        task = engine.create_task(
            user_id=user_id,
            type="connector_write",
            title=f"{entry_name}：{decl.description or decl.name}",
            steps=[
                spec_from_tool(
                    name=decl.name,
                    tool_ref=f"{kind}:{decl.name}",
                    decl=decl,
                    args=kwargs,
                )
            ],
        )
        engine.submit(task, requested_by="agent")
        audit.log(
            user_id=user_id,
            actor="agent",
            action=f"tool.{decl.name}",
            target_type="task",
            target_id=task.id,
            level="write",
            detail={"tool": tool_name, "args": kwargs, "status": task.status},
        )
        return {
            "status": task.status,
            "task_id": task.id,
            "approval_required": True,
            "message": f"写操作已创建待审批任务 {task.id}，审批通过后由任务引擎执行",
        }

    return FunctionTool(
        _write,
        name=tool_name,
        description=f"{decl.description or tool_name}（需审批：写操作不会直接执行）",
        input_schema=decl.input_schema,
        is_concurrency_safe=False,
        is_read_only=False,
        permission=PermissionDecision(
            behavior=PermissionBehavior.ASK,
            message="写操作将提交审批，需用户确认发起",
        ),
    )
