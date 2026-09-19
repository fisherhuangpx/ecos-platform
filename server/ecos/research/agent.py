"""agent 层：ReAct 编排 fetch/read/finish 工具做叙述；红线——数字只准引用证据，候选数值不可改写。"""

from __future__ import annotations

import asyncio
import json
import re
from typing import Any, Callable, Sequence

from agentscope.permission import PermissionBehavior, PermissionDecision
from agentscope.tool import FunctionTool
from sqlalchemy import func, select

from ..agent.runtime import build_agent
from ..config import Settings
from ..models.research import ResearchCandidate, ResearchRun, ResearchStep
from .base import FetchError, ResearchSource, Signal

MAX_TOOL_CALLS = 12
NUMBER_RE = re.compile(r"\d+(?:\.\d+)?")

SYSTEM_PROMPT = (
    "你是选品调研分析师。规则层已产出带证据的候选，你只负责编排与叙述："
    "所有数字必须逐字来自工具返回的信号或候选证据，严禁凭记忆补数、估算或改写候选数值。"
    f"可用 read_signals 查看候选与证据，fetch_source 对疑点源补一次真实抓取（总计不超过 {MAX_TOOL_CALLS} 次工具调用），"
    "最后必须调用 finish 提交一段不超过 3 句的中文叙述。"
)


def validate_narrative(
    narrative: str, evidence_numbers: set[str]
) -> tuple[str, list[str]]:
    """按句清洗：含证据外数字的句子整句裁掉。返回 (保留文本, 被裁句列表)。"""
    kept: list[str] = []
    cut: list[str] = []
    for sentence in re.split(r"(?<=[。！？;；\n])", narrative or ""):
        if not sentence:
            continue
        nums = set(NUMBER_RE.findall(sentence))
        if nums and not nums <= evidence_numbers:
            cut.append(sentence)
        else:
            kept.append(sentence)
    return "".join(kept).strip(), cut


def _num_texts(value: Any) -> set[str]:
    """数值的全部文本形态（500 / 500.0 / '500'），与 NUMBER_RE 对齐。"""
    texts: set[str] = set()
    raw = str(value)
    texts.add(raw)
    try:
        f = float(value)
    except (TypeError, ValueError):
        return texts
    texts.add(json.dumps(f, ensure_ascii=False))
    if f == int(f):
        texts.add(str(int(f)))
    return {t for t in texts if t}


class _AgentCtx:
    def __init__(
        self,
        *,
        factory,
        sources: Sequence[ResearchSource],
        user_id: str,
        run_id: str,
        category: str,
    ) -> None:
        self.factory = factory
        self.sources = list(sources)
        self.user_id = user_id
        self.run_id = run_id
        self.category = category
        self.calls = 0
        self.narrative: str | None = None
        self.numbers: set[str] = set()
        self._seed_numbers()

    def _seed_numbers(self) -> None:
        with self.factory() as s:
            run = s.get(ResearchRun, self.run_id)
            self.numbers |= _num_texts(run.signal_count or 0)
            cands = s.execute(
                select(ResearchCandidate).where(ResearchCandidate.run_id == self.run_id)
            ).scalars().all()
            for c in cands:
                self.numbers |= _num_texts(c.rank)
                self.numbers |= _num_texts(c.heat)
                self.numbers |= _num_texts(c.score)
                for ev in c.evidence or []:
                    self.numbers |= _num_texts(ev.get("value"))

    def harvest(self, signals: list[Signal]) -> None:
        for sg in signals:
            self.numbers |= _num_texts(sg.get("value"))

    def add_step(self, tool_name: str, *, status: str = "ok", note: str = "") -> None:
        with self.factory() as s:
            seq = s.execute(
                select(func.max(ResearchStep.seq)).where(ResearchStep.run_id == self.run_id)
            ).scalar() or 0
            s.add(
                ResearchStep(
                    run_id=self.run_id,
                    seq=seq + 1,
                    kind="agent",
                    summary=f"call:{tool_name}",
                    status=status,
                    args_digest=note[:12] if note else "",
                    error=None if status == "ok" else note[:200] or tool_name,
                )
            )
            s.commit()

    def over_budget(self) -> dict[str, str] | None:
        if self.calls >= MAX_TOOL_CALLS:
            return {
                "error": f"工具调用已达上限 {MAX_TOOL_CALLS} 次，请立即调用 finish 提交叙述"
            }
        return None


def build_research_tools(ctx: _AgentCtx) -> list[FunctionTool]:
    by_id = {s.id: s for s in ctx.sources}

    async def fetch_source(source_id: str, category: str) -> dict[str, Any]:
        if (stop := ctx.over_budget()) is not None:
            return stop
        ctx.calls += 1
        src = by_id.get(source_id)
        if src is None:
            ctx.add_step("fetch_source", status="failed", note=f"未知源 {source_id}")
            return {"error": f"未知源: {source_id}"}
        try:
            signals = src.fetch({"category": category})
        except (FetchError, ValueError) as exc:
            kind = getattr(exc, "kind", type(exc).__name__)
            ctx.add_step("fetch_source", status="failed", note=f"{source_id}:{kind}")
            return {"error": f"{source_id} 抓取失败: {kind}"}
        ctx.harvest(signals)
        ctx.add_step("fetch_source", note=source_id)
        return {
            "source_id": source_id,
            "count": len(signals),
            "signals": [
                {k: sg[k] for k in ("platform", "keyword", "metric", "value", "window")}
                for sg in signals[:20]
            ],
        }

    async def read_signals(category: str) -> dict[str, Any]:
        if (stop := ctx.over_budget()) is not None:
            return stop
        ctx.calls += 1
        with ctx.factory() as s:
            cands = s.execute(
                select(ResearchCandidate)
                .where(ResearchCandidate.run_id == ctx.run_id)
                .order_by(ResearchCandidate.rank)
            ).scalars().all()
        payload = [
            {
                "rank": c.rank,
                "name": c.name,
                "platform": c.platform,
                "heat": c.heat,
                "score": c.score,
                "keywords": list(c.keywords or []),
                "evidence": list(c.evidence or []),
            }
            for c in cands
        ]
        ctx.add_step("read_signals", note=f"n={len(payload)}")
        return {"category": category, "candidates": payload}

    async def finish(narrative: str) -> dict[str, Any]:
        ctx.calls += 1
        cleaned, cut = validate_narrative(narrative, ctx.numbers)
        ctx.narrative = cleaned
        ctx.add_step("finish", note=f"cleaned={len(cut)}")
        return {
            "accepted": bool(cleaned),
            "narrative": cleaned,
            "stripped_sentences": cut,
            "note": "含证据外数字的句子已被裁掉；叙述只准引用工具返回过的数字",
        }

    def _tool(fn: Callable, name: str, description: str, schema: dict) -> FunctionTool:
        return FunctionTool(
            fn,
            name=name,
            description=description,
            input_schema=schema,
            is_read_only=True,
            permission=PermissionDecision(
                behavior=PermissionBehavior.ALLOW,
                message="研究工具只读/只写自身叙述，自动放行",
            ),
        )

    return [
        _tool(
            fetch_source,
            "fetch_source",
            "对指定源强制抓一次真实数据（唯一可扩充证据数字集合的途径）",
            {
                "type": "object",
                "properties": {
                    "source_id": {"type": "string"},
                    "category": {"type": "string"},
                },
                "required": ["source_id", "category"],
            },
        ),
        _tool(
            read_signals,
            "read_signals",
            "读取本轮候选、打分与全部证据数字",
            {
                "type": "object",
                "properties": {"category": {"type": "string"}},
                "required": ["category"],
            },
        ),
        _tool(
            finish,
            "finish",
            "提交最终中文叙述（服务端按证据数字清洗后落库）",
            {
                "type": "object",
                "properties": {"narrative": {"type": "string"}},
                "required": ["narrative"],
            },
        ),
    ]


def run_rule_then_agent(
    settings: Settings,
    factory,
    sources: list[ResearchSource],
    *,
    user_id: str,
    run_id: str,
    category: str,
    model: Any | None = None,
) -> None:
    """在已完成规则层的 run 上叠加 agent 叙述；model=None 即纯规则层终态。"""
    if model is None:
        return
    ctx = _AgentCtx(
        factory=factory, sources=sources, user_id=user_id, run_id=run_id, category=category
    )
    try:
        agent = build_agent(
            name="research-agent",
            system_prompt=SYSTEM_PROMPT,
            model=model,
            tools=build_research_tools(ctx),
        )
        from agentscope.message import Msg, TextBlock

        reply = asyncio.run(
            agent.reply(
                Msg(
                    name="user",
                    content=[TextBlock(text=f"品类「{category}」：请基于证据给出选品叙述。")],
                    role="user",
                )
            )
        )
        if ctx.narrative is None:  # 未调用 finish：拿最终回复文本走同一清洗
            text = ""
            try:
                text = reply.get_text_content() or ""
            except Exception:
                text = ""
            cleaned, cut = validate_narrative(text, ctx.numbers)
            ctx.narrative = cleaned
            ctx.add_step("agent:reply", note=f"cleaned={len(cut)}")
    except Exception as exc:  # agent 任何异常都不许伤及规则层结果
        ctx.add_step("agent:error", status="failed", note=str(exc))
        return

    with ctx.factory() as s:
        run = s.get(ResearchRun, run_id)
        if ctx.narrative:
            run.narrative = ctx.narrative
        s.commit()
