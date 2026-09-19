"""任务 / 任务步骤 / 审批表。"""

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin, new_id


class Task(Base, TimestampMixin):
    __tablename__ = "tasks"

    id: Mapped[str] = mapped_column(
        primary_key=True, default=lambda: new_id("task")
    )
    user_id: Mapped[str] = mapped_column(index=True)
    type: Mapped[str]
    title: Mapped[str]
    status: Mapped[str] = mapped_column(default="created")
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    result: Mapped[dict[str, Any] | None] = mapped_column(JSON, default=None)

    steps: Mapped[list["TaskStep"]] = relationship(
        back_populates="task",
        order_by="TaskStep.seq",
        cascade="all, delete-orphan",
        lazy="selectin",
    )


class TaskStep(Base, TimestampMixin):
    __tablename__ = "task_steps"

    id: Mapped[str] = mapped_column(
        primary_key=True, default=lambda: new_id("step")
    )
    task_id: Mapped[str] = mapped_column(ForeignKey("tasks.id"), index=True)
    seq: Mapped[int]
    name: Mapped[str]
    tool: Mapped[str | None] = mapped_column(default=None)
    args: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    scope: Mapped[str] = mapped_column(default="read")
    risk: Mapped[str] = mapped_column(default="low")
    requires_approval: Mapped[bool] = mapped_column(default=False)
    status: Mapped[str] = mapped_column(default="pending")
    attempt: Mapped[int] = mapped_column(default=0)
    output: Mapped[dict[str, Any] | None] = mapped_column(JSON, default=None)
    error: Mapped[str | None] = mapped_column(default=None)

    task: Mapped[Task] = relationship(back_populates="steps")


class Approval(Base, TimestampMixin):
    __tablename__ = "approvals"

    id: Mapped[str] = mapped_column(
        primary_key=True, default=lambda: new_id("appv")
    )
    task_id: Mapped[str] = mapped_column(ForeignKey("tasks.id"), index=True)
    status: Mapped[str] = mapped_column(default="pending")
    requested_by: Mapped[str] = mapped_column(default="system")
    decided_by: Mapped[str | None] = mapped_column(default=None)
    note: Mapped[str | None] = mapped_column(default=None)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime, default=None)
