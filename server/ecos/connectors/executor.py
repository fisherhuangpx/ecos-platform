"""任务步骤执行器：把 kind:tool 步骤桥接到适配器，并做第二道闸门校验。"""

from __future__ import annotations

from typing import Any

from ..errors import AdapterError, ConnectorValidationError
from ..models import Task, TaskStep
from .adapters import call_adapter
from .service import ConnectorService


class ConnectorStepExecutor:
    def __init__(self, connectors: ConnectorService) -> None:
        self._connectors = connectors

    def run_step(self, task: Task, step: TaskStep) -> dict[str, Any]:
        kind, _, tool_name = (step.tool or "").partition(":")
        if not kind or not tool_name:
            raise AdapterError(f"步骤缺少合法的 tool 引用: {step.tool!r}")
        _instance, decl = self._connectors.resolve_tool(
            task.user_id, kind, tool_name
        )
        if decl.requires_approval and not step.requires_approval:
            self._connectors.audit.log(
                user_id=task.user_id,
                actor="system",
                action="connector.step.refused",
                target_type="task_step",
                target_id=step.id,
                level="high_risk" if decl.risk.value == "high" else "write",
                result="denied",
                detail={
                    "tool": tool_name,
                    "reason": "步骤标记与目录声明不一致（疑似伪造）",
                },
            )
            raise AdapterError(f"写操作步骤必须经过审批闸门: {tool_name}")
        errors = decl.arg_errors(dict(step.args or {}))
        if errors:
            raise ConnectorValidationError(
                f"{tool_name} 参数不符合目录契约: {'；'.join(errors)}"
            )
        return call_adapter(kind, tool_name, dict(step.args or {}))
