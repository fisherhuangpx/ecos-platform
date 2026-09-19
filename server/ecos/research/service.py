"""研究服务：run 预建与排队、缓存命中、独立会话审计、源健康；取数打分在规则层 pipeline。"""

from __future__ import annotations

import threading
import time
from datetime import timedelta
from typing import Any, Callable

from sqlalchemy import select

from ..api.serializers import research_run_out
from ..config import Settings
from ..errors import NotFoundError
from ..models.base import utcnow
from ..models.research import ResearchCandidate, ResearchRun, ResearchStep
from ..tasks.audit import AuditService
from .base import ResearchSource
from .pipeline import execute_rule_pipeline
from .snapshot import fresh_payload

CACHE_WINDOW_SECONDS = 1800

# 同用户同品类只允许一个在途 run；条目随 run 终结清除（风格照抄 tasks/engine.py）
# 键含服务实例 id：不同 app/测试互不串台
_INFLIGHT: dict[tuple[int, str, str], str] = {}
_INFLIGHT_GUARD = threading.Lock()

# 后台线程与 blocking 路径可能撞进同一 run：按 run 互斥 + 状态幂等
_RUN_LOCKS: dict[str, threading.Lock] = {}
_RUN_LOCKS_GUARD = threading.Lock()


def _run_lock(run_id: str) -> threading.Lock:
    with _RUN_LOCKS_GUARD:
        return _RUN_LOCKS.setdefault(run_id, threading.Lock())


def _spawn_thread(fn: Callable[[], None]) -> None:
    threading.Thread(target=fn, daemon=True).start()


class ResearchService:
    def __init__(
        self,
        settings: Settings,
        session_factory,
        sources: list[ResearchSource],
        audit: AuditService | None = None,
        *,
        runner: Callable[[Callable[[], None]], None] = _spawn_thread,
    ) -> None:
        self.settings = settings
        self.factory = session_factory
        self.sources = list(sources)
        self._source_by_id = {s.id: s for s in self.sources}
        self._runner = runner

    # ---------- 审计：每次自开会话，跨线程不复用 ----------

    def _audit(
        self,
        user_id: str,
        action: str,
        *,
        result: str = "ok",
        target_id: str = "",
        detail: dict[str, Any] | None = None,
    ) -> None:
        with self.factory() as s:
            AuditService(s).log(
                user_id=user_id,
                actor=user_id,
                action=action,
                target_type="research_run",
                target_id=target_id,
                level="system",
                result=result,
                detail=detail,
            )
            s.commit()

    # ---------- 创建与排队 ----------

    def create(
        self, user_id: str, category: str, boards: list[str] | None = None
    ) -> tuple[str, bool]:
        """返回 (run_id, cached)：cached=True 表示未触发新抓取。"""
        category = (category or "").strip()
        if not category:
            raise ValueError("品类不能为空")
        if not self.settings.research_enabled:
            raise ValueError("研究功能已关闭")

        key = (id(self), user_id, category)
        with _INFLIGHT_GUARD:
            if key in _INFLIGHT:
                return _INFLIGHT[key], True

        cached = self._cached_run(user_id, category)
        if cached is not None:
            return cached, True

        with self.factory() as s:
            run = ResearchRun(
                user_id=user_id,
                category=category,
                boards=list(boards or []),
                status="running",
                started_at=utcnow(),
            )
            s.add(run)
            s.commit()
            run_id = run.id

        self._audit(
            user_id,
            "research.create",
            target_id=run_id,
            detail={"category": category, "boards": list(boards or [])},
        )
        with _INFLIGHT_GUARD:
            winner = _INFLIGHT.setdefault(key, run_id)
        if winner != run_id:
            return winner, True
        self._runner(lambda: self._run_guarded(run_id, user_id, category))
        return run_id, False

    def _run_guarded(self, run_id: str, user_id: str, category: str) -> None:
        key = (id(self), user_id, category)
        try:
            self.run_now(run_id)
        finally:
            with _INFLIGHT_GUARD:
                if _INFLIGHT.get(key) == run_id:
                    del _INFLIGHT[key]

    def _ttl_for(self, source_id: str) -> int:
        src = self._source_by_id.get(source_id)
        return getattr(src, "ttl_seconds", 0) or self.settings.research_source_ttl

    def _cached_run(self, user_id: str, category: str) -> str | None:
        """近 30 分钟 succeeded/partial 且该 run 成功源的快照仍新鲜 → 直接回旧 run。"""
        with self.factory() as s:
            rows = s.execute(
                select(ResearchRun)
                .where(
                    ResearchRun.user_id == user_id,
                    ResearchRun.category == category,
                    ResearchRun.status.in_(("succeeded", "partial")),
                    ResearchRun.finished_at
                    >= utcnow() - timedelta(seconds=CACHE_WINDOW_SECONDS),
                )
                .order_by(ResearchRun.finished_at.desc())
            ).scalars().all()
            for run in rows:
                ok_ids = s.execute(
                    select(ResearchStep.source_id).where(
                        ResearchStep.run_id == run.id,
                        ResearchStep.kind == "fetch",
                        ResearchStep.status == "ok",
                    )
                ).scalars().all()
                args = {"category": category}
                if ok_ids and all(
                    fresh_payload(s, sid, args, self._ttl_for(sid)) is not None
                    for sid in ok_ids
                ):
                    return run.id
        return None

    # ---------- 执行 ----------

    def run_now(self, run_id: str) -> None:
        """blocking 执行一条 running run；重复调用/并发调用幂等。"""
        with _run_lock(run_id):
            with self.factory() as s:
                run = s.get(ResearchRun, run_id)
                if run is None:
                    raise NotFoundError("研究记录不存在")
                if run.status != "running":
                    return
                user_id = run.user_id
                category = run.category
                boards = list(run.boards or [])
                s.commit()

            deadline = time.monotonic() + self.settings.research_run_budget
            try:
                execute_rule_pipeline(
                    self.factory,
                    self.settings,
                    self.sources,
                    user_id=user_id,
                    category=category,
                    boards=boards,
                    deadline=deadline,
                    run_id=run_id,
                )
            except Exception as exc:  # 后台线程兜底：异常必须落成 failed
                with self.factory() as s:
                    run = s.get(ResearchRun, run_id)
                    run.status = "failed"
                    run.error = str(exc)[:200]
                    run.finished_at = utcnow()
                    s.commit()
                self._audit(
                    user_id,
                    "research.finish",
                    result="failed",
                    target_id=run_id,
                    detail={"category": category, "error": str(exc)[:200]},
                )
                return

            with self.factory() as s:
                run = s.get(ResearchRun, run_id)
                status, signals = run.status, run.signal_count
            self._audit(
                user_id,
                "research.finish",
                result="failed" if status == "failed" else "ok",
                target_id=run_id,
                detail={"category": category, "signals": signals, "mode": "rule"},
            )

        if status in ("succeeded", "partial"):
            self._augment_with_agent(run_id, user_id, category)

    def _augment_with_agent(self, run_id: str, user_id: str, category: str) -> None:
        """模型配置齐备时叠加 agent 叙述；任何失败不影响规则层结果。"""
        if not (self.settings.model_name and self.settings.model_api_key):
            return
        try:
            from ..agent.runtime import build_model
            from .agent import run_rule_then_agent

            with self.factory() as s:
                run = s.get(ResearchRun, run_id)
                if run is None or run.narrative:
                    return
                run.mode = "agent"
                s.commit()
            run_rule_then_agent(
                self.settings,
                self.factory,
                self.sources,
                user_id=user_id,
                run_id=run_id,
                category=category,
                model=build_model(self.settings),
            )
        except Exception:
            pass

    # ---------- 查询 ----------

    def get_run(self, user_id: str, run_id: str) -> dict[str, Any]:
        with self.factory() as s:
            run = s.get(ResearchRun, run_id)
            if run is None or run.user_id != user_id:
                raise NotFoundError("研究记录不存在")
            steps = s.execute(
                select(ResearchStep)
                .where(ResearchStep.run_id == run_id)
                .order_by(ResearchStep.seq)
            ).scalars().all()
            cands = s.execute(
                select(ResearchCandidate)
                .where(ResearchCandidate.run_id == run_id)
                .order_by(ResearchCandidate.rank)
            ).scalars().all()
            return research_run_out(run, list(steps), list(cands))

    def list_runs(self, user_id: str, *, limit: int = 20) -> list[dict[str, Any]]:
        with self.factory() as s:
            rows = s.execute(
                select(ResearchRun)
                .where(ResearchRun.user_id == user_id)
                .order_by(ResearchRun.created_at.desc())
                .limit(limit)
            ).scalars().all()
            return [research_run_out(r) for r in rows]

    def sources_health(self, user_id: str) -> list[dict[str, Any]]:
        disabled = {
            x.strip()
            for x in (self.settings.research_disabled_sources or "").split(",")
            if x.strip()
        }
        rows: list[dict[str, Any]] = []
        for src in self.sources:
            if src.id in disabled:
                health = "disabled"
            elif hasattr(src, "health"):
                health = src.health()
            else:
                health = "online"
            rows.append({
                "id": src.id,
                "name": src.name,
                "board": src.board,
                "tier": src.tier,
                "health": health,
                "ttl_seconds": src.ttl_seconds,
                "capabilities": src.capabilities(),
            })
        return rows
