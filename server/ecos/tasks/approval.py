"""任务级审批服务：审批闸门的决策面（写操作不可跳过）。"""

from __future__ import annotations

from sqlalchemy import select

from ..errors import ApprovalForbidden, NotFoundError, TaskStateError
from ..models import Approval, Task, utcnow
from .audit import AuditService

DECISIONS = ("approve", "reject")


class ApprovalService:
    def __init__(self, session, audit: AuditService) -> None:
        self._session = session
        self._audit = audit

    def request(self, task: Task, *, requested_by: str = "system") -> Approval:
        approval = Approval(task_id=task.id, requested_by=requested_by)
        self._session.add(approval)
        task.status = "pending_approval"
        self._session.flush()
        self._audit.log(
            user_id=task.user_id,
            actor=requested_by,
            action="approval.request",
            target_type="approval",
            target_id=approval.id,
            level="system",
            detail={"task_id": task.id, "title": task.title},
        )
        return approval

    def get(self, approval_id: str) -> Approval:
        approval = self._session.get(Approval, approval_id)
        if approval is None:
            raise NotFoundError(f"审批单不存在: {approval_id}")
        return approval

    def for_task(self, task: Task) -> Approval | None:
        return (
            self._session.execute(
                select(Approval)
                .where(Approval.task_id == task.id)
                .order_by(Approval.created_at.desc())
            )
            .scalars()
            .first()
        )

    def decide(
        self,
        approval_id: str,
        *,
        approver: str,
        decision: str,
        note: str | None = None,
    ) -> Approval:
        if decision not in DECISIONS:
            raise ValueError(f"非法审批决定: {decision}")
        if not approver or not approver.strip():
            raise ValueError("必须提供审批人")
        approval = self.get(approval_id)
        task = self._session.get(Task, approval.task_id)
        identity = approver.strip()
        owner = task.user_id if task is not None else ""
        if identity and identity in (owner, approval.requested_by):
            # 职责分离：属主/发起人审批自己的写操作 = 红线违规，留痕并拒绝
            self._audit.log(
                user_id=owner,
                actor=f"user:{identity}",
                action="approval.forbidden",
                target_type="approval",
                target_id=approval.id,
                level="system",
                result="denied",
                detail={
                    "reason": "职责分离：审批人不得是任务属主或发起人",
                    "task_id": approval.task_id,
                    "owner": owner,
                    "requested_by": approval.requested_by,
                },
            )
            raise ApprovalForbidden("职责分离：任务属主/发起人不能审批自己的写操作")
        if approval.status != "pending":
            raise TaskStateError(f"审批单已处理，不能重复决策: {approval.id}")

        approval.status = "approved" if decision == "approve" else "rejected"
        approval.decided_by = approver.strip()
        approval.decided_at = utcnow()
        approval.note = note
        if task is not None:
            task.status = "approved" if decision == "approve" else "rejected"
        self._audit.log(
            user_id=task.user_id if task is not None else "",
            actor=f"user:{approver.strip()}",
            action=f"approval.{decision}",
            target_type="approval",
            target_id=approval.id,
            level="system",
            detail={"task_id": approval.task_id, "note": note},
        )
        return approval
