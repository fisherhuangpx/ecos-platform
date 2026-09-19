"""审计日志表。"""

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, new_id, utcnow


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[str] = mapped_column(primary_key=True, default=lambda: new_id("aud"))
    at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    user_id: Mapped[str] = mapped_column(index=True)
    actor: Mapped[str]
    action: Mapped[str]
    target_type: Mapped[str]
    target_id: Mapped[str]
    level: Mapped[str] = mapped_column(default="system")
    result: Mapped[str] = mapped_column(default="ok")
    detail: Mapped[dict[str, Any] | None] = mapped_column(JSON, default=None)
