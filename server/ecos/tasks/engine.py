"""确定性任务引擎：步骤执行、部分失败、单步重试；写操作强制走审批闸门。"""

from __future__ import annotations

import threading
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Any, Mapping, Protocol, Sequence

from ..connectors.catalog import ToolDecl
from ..errors import ApprovalRequired, TaskStateError
from ..models import Task, TaskStep
from .approval import ApprovalService
from .audit import AuditService

DONE_STATES = ("succeeded", "partial_failed", "failed")

# 引擎按请求装配，互斥必须落在进程级注册表上；条目随 task 走，只增不减
# （移除条目会引入"释放与新建锁"竞态，内部工具场景体量可接受）
_TASK_LOCKS: dict[str, threading.Lock] = {}
_TASK_LOCKS_GUARD = threading.Lock()


def _task_lock(task_id: str) -> threading.Lock:
    with _TASK_LOCKS_GUARD:
        return _TASK_LOCKS.setdefault(task_id, threading.Lock())


@dataclass
class StepSpec:
    name: str
    tool: str | None = None
    args: dict[str, Any] = field(default_factory=dict)
    scope: str = "read"
    risk: str = "low"
    requires_approval: bool = False


def spec_from_tool(
    *,
    name: str,
    tool_ref: str,
    decl: ToolDecl,
    args: Mapping[str, Any] | None = None,
) -> StepSpec:
    """由目录声明生成步骤：requires_approval 一律由 scope 推导，调用方不可关闭。"""
    return StepSpec(
        name=name,
        tool=tool_ref,
        args=dict(args or {}),
        scope=decl.scope.value,
        risk=decl.risk.value,
        requires_approval=decl.requires_approval,
    )


class StepExecutor(Protocol):
    def run_step(self, task: Task, step: TaskStep) -> dict[str, Any]: ...


class TaskEngine:
    def __init__(
        self,
        *,
        session,
        executor: StepExecutor,
        audit: AuditService,
        approvals: ApprovalService,
    ) -> None:
        self._session = session
        self._executor = executor
        self._audit = audit
        self._approvals = approvals

    def create_task(
        self,
        *,
        user_id: str,
        type: str,
        title: str,
        steps: Sequence[StepSpec],
        payload: Mapping[str, Any] | None = None,
    ) -> Task:
        task = Task(user_id=user_id, type=type, title=title, payload=dict(payload or {}))
        for seq, spec in enumerate(steps, start=1):
            task.steps.append(
                TaskStep(
                    seq=seq,
                    name=spec.name,
                    tool=spec.tool,
                    args=dict(spec.args),
                    scope=spec.scope,
                    risk=spec.risk,
                    requires_approval=spec.requires_approval,
                )
            )
        self._session.add(task)
        self._session.flush()
        self._audit.log(
            user_id=user_id,
            actor="system",
            action="task.created",
            target_type="task",
            target_id=task.id,
            level="system",
            detail={"type": type, "title": title, "steps": len(steps)},
        )
        return task

    def submit(self, task: Task, *, requested_by: str = "system") -> Task:
        if task.status != "created":
            raise TaskStateError(f"任务状态不允许提交: {task.status}")
        if any(step.requires_approval for step in task.steps):
            self._approvals.request(task, requested_by=requested_by)
        self._audit.log(
            user_id=task.user_id,
            actor=requested_by,
            action="task.submitted",
            target_type="task",
            target_id=task.id,
            level="system",
            detail={"status": task.status},
        )
        return task

    def run(self, task: Task) -> Task:
        with self._exclusive(task.id):
            if task.status in DONE_STATES:
                raise TaskStateError(f"任务已结束，不能重复执行: {task.status}")
            self._guard_approval(task)
            self._start(task, action="task.started")
            self._execute(task, only_failed=False)
        return task

    def retry_failed(self, task: Task) -> Task:
        # 先占互斥锁再过审批闸门：对已驳回任务的重试尝试同样是审批拒绝，必须留痕
        with self._exclusive(task.id):
            self._guard_approval(task)
            if task.status not in ("partial_failed", "failed"):
                raise TaskStateError(f"任务状态不允许重试: {task.status}")
            self._start(task, action="task.retry")
            self._execute(task, only_failed=True)
        return task

    @contextmanager
    def _exclusive(self, task_id: str):
        lock = _task_lock(task_id)
        if not lock.acquire(blocking=False):
            raise TaskStateError(f"任务正在执行中，拒绝并发触发: {task_id}")
        try:
            yield
        finally:
            lock.release()

    def _guard_approval(self, task: Task) -> None:
        if task.status == "rejected":
            self._audit.log(
                user_id=task.user_id,
                actor="system",
                action="task.approval_blocked",
                target_type="task",
                target_id=task.id,
                level="system",
                result="denied",
                detail={"status": task.status},
            )
            raise TaskStateError("任务已被驳回，不能执行")
        if any(step.requires_approval for step in task.steps):
            approval = self._approvals.for_task(task)
            if approval is None or approval.status != "approved":
                self._audit.log(
                    user_id=task.user_id,
                    actor="system",
                    action="task.approval_blocked",
                    target_type="task",
                    target_id=task.id,
                    level="system",
                    result="denied",
                    detail={
                        "approval_id": approval.id if approval else None,
                        "approval_status": approval.status if approval else None,
                    },
                )
                raise ApprovalRequired(
                    f"任务含写操作，需先完成审批才能执行: {task.id}"
                )

    def _start(self, task: Task, *, action: str) -> None:
        task.status = "running"
        self._audit.log(
            user_id=task.user_id,
            actor="system",
            action=action,
            target_type="task",
            target_id=task.id,
            level="system",
        )

    def _execute(self, task: Task, *, only_failed: bool) -> None:
        for step in task.steps:
            if only_failed:
                if step.status != "failed":
                    continue
            elif step.status == "succeeded":
                continue
            self._run_one(task, step)
        task.status = self._final_status(task)
        task.result = {
            "steps": [
                {
                    "id": step.id,
                    "name": step.name,
                    "status": step.status,
                    "attempt": step.attempt,
                }
                for step in task.steps
            ]
        }
        self._audit.log(
            user_id=task.user_id,
            actor="system",
            action="task.finished",
            target_type="task",
            target_id=task.id,
            level="system",
            result="ok" if task.status == "succeeded" else "failed",
            detail={"status": task.status},
        )

    def _run_one(self, task: Task, step: TaskStep) -> None:
        step.status = "running"
        step.attempt += 1
        level = self._audit_level(step)
        try:
            output = self._executor.run_step(task, step)
        except Exception as exc:  # noqa: BLE001 步骤失败按部分失败处理
            step.status = "failed"
            step.error = str(exc) or type(exc).__name__
            self._audit.log(
                user_id=task.user_id,
                actor="system",
                action="task.step.failed",
                target_type="task_step",
                target_id=step.id,
                level=level,
                result="failed",
                detail={"name": step.name, "tool": step.tool, "error": step.error},
            )
            return
        step.status = "succeeded"
        step.output = output
        self._audit.log(
            user_id=task.user_id,
            actor="system",
            action="task.step.succeeded",
            target_type="task_step",
            target_id=step.id,
            level=level,
            detail={"name": step.name, "tool": step.tool, "output": output},
        )

    @staticmethod
    def _audit_level(step: TaskStep) -> str:
        if step.scope == "write":
            return "high_risk" if step.risk == "high" else "write"
        return "read"

    @staticmethod
    def _final_status(task: Task) -> str:
        statuses = [step.status for step in task.steps]
        if statuses and all(status == "succeeded" for status in statuses):
            return "succeeded"
        if any(status == "succeeded" for status in statuses):
            return "partial_failed"
        return "failed"
