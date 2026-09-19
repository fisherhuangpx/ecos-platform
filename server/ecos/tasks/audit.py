"""审计服务：所有读写与审批动作的落库面。"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select

from ..models import AuditLog

LEVELS = ("read", "write", "high_risk", "system")
RESULTS = ("ok", "denied", "failed")


class AuditService:
    def __init__(self, session) -> None:
        self._session = session

    def log(
        self,
        *,
        user_id: str,
        actor: str,
        action: str,
        target_type: str,
        target_id: str,
        level: str = "system",
        result: str = "ok",
        detail: dict[str, Any] | None = None,
    ) -> AuditLog:
        if level not in LEVELS:
            raise ValueError(f"非法审计级别: {level}")
        if result not in RESULTS:
            raise ValueError(f"非法审计结果: {result}")
        row = AuditLog(
            user_id=user_id,
            actor=actor,
            action=action,
            target_type=target_type,
            target_id=target_id,
            level=level,
            result=result,
            detail=detail,
        )
        self._session.add(row)
        self._session.flush()
        return row

    def list(
        self, *, user_id: str | None = None, limit: int = 100
    ) -> list[AuditLog]:
        stmt = (
            select(AuditLog)
            .order_by(AuditLog.at.desc(), AuditLog.id.desc())
            .limit(limit)
        )
        if user_id is not None:
            stmt = stmt.where(AuditLog.user_id == user_id)
        return list(self._session.execute(stmt).scalars().all())
