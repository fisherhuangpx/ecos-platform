"""规则层流水线：plan→fetch(快照优先)→cross→synthesize；数字全部出自信号池，不经 LLM。"""

from __future__ import annotations

import re
import statistics
import time
from collections import Counter
from typing import Any

from sqlalchemy.orm import sessionmaker

from ..config import Settings
from ..models.base import utcnow
from ..models.research import ResearchCandidate, ResearchRun, ResearchStep
from .base import FetchError, ResearchSource, Signal
from .snapshot import fresh_payload, query_key, store_payload

# 权重与公式透明：随 score_basis 落库供复核
SCORE_WEIGHTS = {"heat": 0.35, "trend": 0.25, "rank": 0.15, "sales_proxy": 0.25}
SINGLE_SOURCE_PENALTY = 0.6
TOP_N = 10

_BOARD_BY_PLATFORM = {
    "京东": "shelf", "淘宝": "shelf", "拼多多": "shelf", "1688": "shelf",
    "抖音": "content", "快手": "content", "百度": "content", "小红书": "content",
    "Amazon": "crossborder", "Google": "crossborder", "TikTok": "crossborder",
}


def normalize_keyword(kw: str) -> str:
    return re.sub(r"[\s\-_/·，,。.]+", "", kw).lower()


def is_category_relevant(keyword: str, category: str) -> bool:
    """品类相关性门：全品类混排源（热搜/热词）只留与品类共享 ≥2 字子串的信号。

    实机走查校准：否则「沙特利雅得遭空袭」这类全网热点会混进「手机支架」候选。
    """
    k, c = normalize_keyword(keyword), normalize_keyword(category)
    if not k or not c:
        return False
    if c in k or k in c:
        return True
    return any(k[i:i + 2] in c for i in range(len(k) - 1))


def parse_traffic(s: str) -> float:
    """'100K+'→1e5、'1.2M+'→1.2e6、'2万+'→2e4；异常→0。"""
    text = (s or "").strip().rstrip("+").replace(",", "")
    for suf, mult in (("K", 1e3), ("M", 1e6), ("B", 1e9), ("万", 1e4), ("亿", 1e8)):
        if text.endswith(suf):
            try:
                return float(text[: -len(suf)]) * mult
            except ValueError:
                return 0.0
    try:
        return float(text)
    except ValueError:
        return 0.0


def _zscore(values: list[float]) -> list[float]:
    if len(values) < 2:
        return [0.0 for _ in values]
    mean = statistics.fmean(values)
    std = statistics.pvariance(values) ** 0.5 or 1.0
    return [(v - mean) / std for v in values]


def _fmt_count(v: float) -> str:
    if v >= 1e8:
        return f"{v / 1e8:.1f}亿"
    if v >= 1e4:
        return f"{v / 1e4:.1f}万"
    return f"{v:.0f}"


def cross_and_score(
    signals: list[Signal],
    online_source_ids: set[str],
    single_source_penalty: float = SINGLE_SOURCE_PENALTY,
) -> list[dict[str, Any]]:
    """按归一化词分桶交叉证据并打分；返回按 score 降序的候选 dict 列表。"""
    usable = [
        s for s in signals
        if s["source_id"] in online_source_ids and str(s.get("keyword", "")).strip()
    ]
    if not usable:
        return []
    buckets: dict[str, list[Signal]] = {}
    for s in usable:
        buckets.setdefault(normalize_keyword(s["keyword"]), []).append(s)

    # 指标内全池 z 标准化（rank 越小越好：z 前取负）
    z_by_bucket_metric: dict[str, dict[str, float]] = {b: {} for b in buckets}
    means_by_bucket_metric: dict[str, dict[str, float]] = {b: {} for b in buckets}
    for metric, weight in SCORE_WEIGHTS.items():
        means: dict[str, float] = {}
        for b, rows in buckets.items():
            vals = [
                -float(r["value"]) if metric == "rank" else float(r["value"])
                for r in rows if r["metric"] == metric
            ]
            if vals:
                means[b] = statistics.fmean(vals)
        zs = _zscore(list(means.values()))
        for (b, _), z in zip(means.items(), zs):
            z_by_bucket_metric[b][metric] = z
        for b, m in means.items():
            means_by_bucket_metric[b][metric] = m

    rows_out: list[dict[str, Any]] = []
    for b, rows in buckets.items():
        sources = {r["source_id"] for r in rows}
        score = sum(
            w * z_by_bucket_metric[b].get(m, 0.0)
            for m, w in SCORE_WEIGHTS.items()
        )
        basis: dict[str, Any] = {
            "weights": dict(SCORE_WEIGHTS),
            "z": {m: round(z, 4) for m, z in z_by_bucket_metric[b].items()},
            "metric_means": {
                m: (round(v, 4) if m != "rank" else round(-v, 4))
                for m, v in means_by_bucket_metric[b].items()
            },
            "sources": sorted(sources),
        }
        if len(sources) == 1:
            score *= single_source_penalty
            basis["penalty"] = single_source_penalty
        heat = max(0, min(100, round(50 + 25 * score)))
        basis["heat_scaled"] = heat

        plats = Counter(str(r["platform"]) for r in rows)
        platform = plats.most_common(1)[0][0]
        boards = Counter(
            _BOARD_BY_PLATFORM.get(p, "") for p in plats
        )
        board = boards.most_common(1)[0][0]
        prices = sorted(float(r["value"]) for r in rows if r["metric"] == "price_band")
        if not prices:
            price = ""
        elif len(prices) == 1:
            price = f"¥{prices[0]:.2f}"
        else:
            price = f"¥{prices[0]:.2f}–¥{prices[-1]:.2f}"
        proxies = [float(r["value"]) for r in rows if r["metric"] == "sales_proxy"]
        ranks = [float(r["value"]) for r in rows if r["metric"] == "rank"]
        if proxies:
            sales_signal = f"销量代理 {_fmt_count(max(proxies))}"
        elif ranks:
            sales_signal = f"榜位 #{int(min(ranks))}"
        else:
            sales_signal = ""
        keywords = list(dict.fromkeys(str(r["keyword"]).strip() for r in rows))[:4]
        rows_out.append({
            "name": keywords[0],
            "platform": platform,
            "board": board,
            "price": price,
            "sales_signal": sales_signal,
            "heat": heat,
            "keywords": keywords,
            "score": round(score, 4),
            "score_basis": basis,
            "evidence": [
                {
                    "source_id": r["source_id"],
                    "metric": r["metric"],
                    "value": r["value"],
                    "url": r["url"],
                    "captured_at": r["captured_at"],
                }
                for r in rows
            ],
        })
    rows_out.sort(key=lambda r: r["score"], reverse=True)
    return rows_out


def execute_rule_pipeline(
    session_factory: sessionmaker,
    settings: Settings,
    sources: list[ResearchSource],
    *,
    user_id: str,
    category: str,
    boards: list[str] | None,
    deadline: float,
    run_id: str | None = None,
) -> str:
    """同步执行四阶段并落库；返回 run_id。审计在 service 层（Task 8）。

    run_id 传入时复用 service 预建的 running 行（T8 线程路径）。
    """
    wanted = boards or []
    enabled = [s for s in sources if not wanted or s.board in wanted]
    args = {"category": category}
    with session_factory() as session:
        if run_id is None:
            run = ResearchRun(
                user_id=user_id, category=category, boards=list(wanted),
                mode="rule", started_at=utcnow(),
            )
            session.add(run)
            session.flush()
            run_id = run.id
        else:
            run = session.get(ResearchRun, run_id)

        state = {"seq": 0}

        def step(kind: str, **kw: Any) -> ResearchStep:
            state["seq"] += 1
            st = ResearchStep(run_id=run_id, seq=state["seq"], kind=kind, **kw)
            session.add(st)
            return st

        step("plan", summary=f"{len(enabled)} 源 × {category}")
        session.commit()

        pool: list[Signal] = []
        ok_sources: set[str] = set()
        failed = skipped = 0
        for src in enabled:
            st = step(
                "fetch", source_id=src.id, args_digest=query_key(src.id, args)[:12]
            )
            t0 = time.monotonic()
            if time.monotonic() > deadline:
                st.status, st.error = "skipped", "预算耗尽"
                skipped += 1
                session.commit()
                continue
            ttl = src.ttl_seconds or settings.research_source_ttl
            cached = fresh_payload(session, src.id, args, ttl)
            if cached is not None:
                st.summary = "快照命中"
                pool.extend(cached)  # type: ignore[arg-type]
                ok_sources.add(src.id)
                session.commit()
                continue
            try:
                # 源可能就地补默认参数（如 jd 的 cat）：fetch 只拿副本，防污染快照键
                signals = src.fetch({**args})
            except FetchError as exc:
                st.status = "failed"
                st.error = str(exc)[:120]
                failed += 1
                st.seconds = round(time.monotonic() - t0, 3)
                session.commit()
                continue
            store_payload(session, src.id, args, signals, ttl)
            st.summary = f"{len(signals)} 信号"
            st.seconds = round(time.monotonic() - t0, 3)
            pool.extend(signals)
            ok_sources.add(src.id)
            session.commit()

        cst = step("cross")
        relevant = [s for s in pool if is_category_relevant(str(s["keyword"]), category)]
        dropped = len(pool) - len(relevant)
        rows = cross_and_score(relevant, ok_sources)
        if not relevant:
            cst.status = "failed"
            cst.error = "无可用信号（品类相关性过滤后为空）" if pool else "无可用信号"
            run.status = "failed"
            run.error = (
                f"无可用信号（{len(ok_sources)} 源成功 / {failed} 失败 / {skipped} 跳过"
                + (f"，{dropped} 信号被品类相关性过滤）" if pool else "）")
            )
            run.finished_at = utcnow()
            session.commit()
            return run_id
        cst.summary = (
            f"{len(relevant)} 信号 → {len(rows)} 候选"
            + (f"（过滤无关 {dropped}）" if dropped else "")
        )

        syn = step("synthesize")
        for i, row in enumerate(rows[:TOP_N], start=1):
            session.add(ResearchCandidate(run_id=run_id, rank=i, **row))
        run.signal_count = len(relevant)
        if failed == 0 and skipped == 0:
            run.status = "succeeded"
        elif rows:
            run.status = "partial"
        else:
            run.status = "failed"
            run.error = "无可用信号（交叉层无候选）"
        syn.summary = f"落库 {min(len(rows), TOP_N)} 候选"
        run.finished_at = utcnow()
        session.commit()
    return run_id
