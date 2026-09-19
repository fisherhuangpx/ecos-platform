"""研究子域 ORM：调研运行 / 步骤 / 候选 / 源快照缓存。"""

from datetime import datetime

from sqlalchemy import DateTime, Float, JSON, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin, new_id, utcnow


class ResearchRun(Base, TimestampMixin):
    __tablename__ = "research_runs"

    id: Mapped[str] = mapped_column(primary_key=True, default=lambda: new_id("rsr"))
    user_id: Mapped[str] = mapped_column(index=True)
    category: Mapped[str]
    boards: Mapped[list] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(default="running")  # running|succeeded|partial|failed
    mode: Mapped[str] = mapped_column(default="rule")  # rule|agent
    signal_count: Mapped[int] = mapped_column(default=0)
    error: Mapped[str | None] = mapped_column(default=None)
    narrative: Mapped[str | None] = mapped_column(default=None)
    tokens_in: Mapped[int] = mapped_column(default=0)
    tokens_out: Mapped[int] = mapped_column(default=0)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, default=None)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, default=None)


class ResearchStep(Base, TimestampMixin):
    __tablename__ = "research_steps"

    id: Mapped[str] = mapped_column(primary_key=True, default=lambda: new_id("rst"))
    run_id: Mapped[str] = mapped_column(index=True)
    seq: Mapped[int]
    kind: Mapped[str]  # plan|fetch|cross|synthesize|agent
    source_id: Mapped[str] = mapped_column(default="")
    args_digest: Mapped[str] = mapped_column(default="")
    summary: Mapped[str] = mapped_column(default="")
    status: Mapped[str] = mapped_column(default="ok")  # ok|failed|skipped
    seconds: Mapped[float] = mapped_column(Float, default=0.0)
    error: Mapped[str | None] = mapped_column(default=None)


class ResearchCandidate(Base, TimestampMixin):
    __tablename__ = "research_candidates"

    id: Mapped[str] = mapped_column(primary_key=True, default=lambda: new_id("rcd"))
    run_id: Mapped[str] = mapped_column(index=True)
    rank: Mapped[int]
    name: Mapped[str]
    platform: Mapped[str] = mapped_column(default="")
    board: Mapped[str] = mapped_column(default="")
    price: Mapped[str] = mapped_column(default="")
    sales_signal: Mapped[str] = mapped_column(default="")
    heat: Mapped[int] = mapped_column(default=0)
    keywords: Mapped[list] = mapped_column(JSON, default=list)
    score: Mapped[float] = mapped_column(Float, default=0.0)
    score_basis: Mapped[dict] = mapped_column(JSON, default=dict)
    evidence: Mapped[list] = mapped_column(JSON, default=list)


class SourceSnapshot(Base, TimestampMixin):
    __tablename__ = "research_snapshots"
    __table_args__ = (UniqueConstraint("source_id", "query_key", name="uq_snapshot_key"),)

    id: Mapped[str] = mapped_column(primary_key=True, default=lambda: new_id("rsc"))
    source_id: Mapped[str] = mapped_column(index=True)
    query_key: Mapped[str]
    payload: Mapped[list] = mapped_column(JSON, default=list)
    captured_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
