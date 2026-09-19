"""ModelAdapter：可插拔 AI 基座。

- SimulatedAdapter（默认）：纯确定性（种子表 + md5），同输入同输出，测试快照可重复。
- LiveAdapter：包 AgentScope 模型（OpenAI 兼容）；解析失败自动回退 Simulated，保证端点不因模型抖动而 500。
"""

from __future__ import annotations

import asyncio
import hashlib
import json
from typing import Any, Protocol

from ..config import Settings


def _hash_int(*parts: object) -> int:
    digest = hashlib.md5("|".join(str(p) for p in parts).encode("utf-8")).hexdigest()
    return int(digest[:12], 16)


class ModelAdapter(Protocol):
    def insight_narrative(self, store_name: str, series: dict[str, Any]) -> str: ...

    def triage_ticket(self, complaint: str) -> dict[str, Any]: ...


# 选品候选底表：数值抄自 ecom-proto/src/data/ecom.ts researchForCategory
_BASE_CANDIDATES: list[dict[str, Any]] = [
    {"suffix": "热销款（基础型）", "platform": "淘宝", "price": "29-59", "keys": ["实用", "性价比", "售后少"], "sales": "3200 件/月", "heat": 78},
    {"suffix": "升级款（旗舰型）", "platform": "淘宝", "price": "79-129", "keys": ["材质好", "颜值高", "复购"], "sales": "1800 件/月", "heat": 64},
    {"suffix": "直播引流款", "platform": "抖音", "price": "19-49", "keys": ["视觉冲击", "话术好讲", "客单低"], "sales": "5200 件/月", "heat": 88},
    {"suffix": "高佣分销款", "platform": "拼多多", "price": "9-25", "keys": ["走量", "低价心智", "退货率中"], "sales": "8600 件/月", "heat": 71},
    {"suffix": "跨境潜力款", "platform": "Amazon", "price": "18-35 USD", "keys": ["review 少", "搜索增长", "合规简单"], "sales": "1400 件/月", "heat": 55},
    {"suffix": "内容种草款", "platform": "小红书", "price": "69-159", "keys": ["场景感", "图文笔记", "颜值溢价"], "sales": "2100 件/月", "heat": 66},
]

# 归因关键词表（顺序即优先级），复用原型售后剧本话术
_TRIAGE_RULES: list[tuple[str, list[str], str, str]] = [
    ("物流", ["快递", "物流", "没到", "发货", "签收", "到货"], "自助解决",
     "亲，已帮您催促物流，预计明天送达。给您带来不便非常抱歉，如明天仍未收到请联系我们，会第一时间处理。"),
    ("质量", ["质量", "松动", "断了", "坏", "裂", "故障", "充不上", "吸不住"], "回复草稿",
     "亲，非常抱歉给您带来不便。经核实该批次存在工艺偏差，我们为您安排补发或退款，后续会加强出厂检测。"),
    ("尺码", ["尺码", "偏大", "偏小", "勒", "不合身"], "回复草稿",
     "亲，抱歉尺码不合适。该款建议参考详情页尺码表选购，目前可为您安排换货（运费我们承担）或退款处理。"),
    ("错发", ["发错", "错发", "不是我要", "颜色", "下单黑", "下单白", "收到的是"], "建议退款",
     "亲，核实仓库确实发错，非常抱歉。为您安排补发正确商品 + 错发商品无需退回，或全额退款。"),
]
_DEFAULT_TRIAGE = ("其他", "回复草稿", "亲，您的反馈已收到，客服将尽快为您跟进处理，感谢理解与支持。")


class SimulatedAdapter:
    """确定性模拟：无网络、无随机。"""

    def research_report(self, category: str) -> list[dict[str, Any]]:
        """演示档底表（/api/ai/research 与前端演示模式专用）；真实选品分析走 /api/research。"""
        start = _hash_int("research", category) % len(_BASE_CANDIDATES)
        out = []
        for i in range(5):
            base = _BASE_CANDIDATES[(start + i) % len(_BASE_CANDIDATES)]
            out.append(
                {
                    "id": f"rc-{_hash_int('id', category, i):08x}",
                    "name": f"{category}{base['suffix']}",
                    "platform": base["platform"],
                    "monthly_sales": base["sales"],
                    "price": base["price"],
                    "keywords": list(base["keys"]),
                    "heat": base["heat"],
                }
            )
        return out

    def insight_narrative(self, store_name: str, series: dict[str, Any]) -> str:
        buckets = series.get("series") or []
        total_amount = round(sum(b.get("amount", 0) for b in buckets), 2)
        total_orders = sum(int(b.get("orders", 0)) for b in buckets)
        half = len(buckets) // 2
        first = sum(b.get("amount", 0) for b in buckets[:half])
        second = sum(b.get("amount", 0) for b in buckets[half:])
        if second > first * 1.05:
            trend = "上行"
        elif second < first * 0.95:
            trend = "回落"
        else:
            trend = "平稳"
        peak = max(buckets, key=lambda b: b.get("amount", 0))["date"] if buckets else "—"
        return (
            f"{store_name} · 近 {len(buckets)} 天共 {total_orders} 单、成交额 ¥{total_amount:,.0f}，"
            f"整体呈{trend}态势，峰值出现在 {peak}。"
            "建议：聚焦头部 SKU 的主图素材迭代与评价维护，将峰值日的投放节奏复用到相邻价格带；"
            "对转化率低于 3% 的商品优先做卖点前置。"
        )

    def triage_ticket(self, complaint: str) -> dict[str, Any]:
        for attribution, keywords, suggestion, reply in _TRIAGE_RULES:
            if any(k in complaint for k in keywords):
                break
        else:
            attribution, suggestion, reply = _DEFAULT_TRIAGE
        return {
            "attribution": attribution,
            "confidence": 85 + _hash_int("conf", complaint) % 13,
            "suggestion": suggestion,
            "reply_draft": reply,
        }


class LiveAdapter:
    """真实模型路径：两方法均先问模型，输出不可解析时回退 Simulated。选品分析不在此域（走 /api/research）。"""

    def __init__(self, model: Any) -> None:
        self._model = model
        self._fallback = SimulatedAdapter()

    def _text(self, prompt: str) -> str:
        from agentscope.message import Msg

        async def _call() -> str:
            resp = await self._model([Msg(name="user", content=prompt, role="user")])
            blocks = getattr(resp, "content", None) or []
            parts = []
            for block in blocks:
                if isinstance(block, dict):
                    parts.append(str(block.get("text", "")))
                else:
                    parts.append(str(getattr(block, "text", "")))
            return "".join(parts)

        return asyncio.run(_call())

    @staticmethod
    def _parse_json(text: str) -> Any:
        start = min((i for i in (text.find("["), text.find("{")) if i >= 0), default=-1)
        if start < 0:
            raise ValueError("模型输出不含 JSON")
        return json.loads(text[start:])

    def insight_narrative(self, store_name: str, series: dict[str, Any]) -> str:
        try:
            text = self._text(
                f"店铺「{store_name}」近 14 天经营数据（JSON）：{json.dumps(series, ensure_ascii=False)[:2000]}。"
                "用 3 句中文给出洞察与行动建议。"
            )
            return text.strip() or self._fallback.insight_narrative(store_name, series)
        except Exception:
            return self._fallback.insight_narrative(store_name, series)

    def triage_ticket(self, complaint: str) -> dict[str, Any]:
        try:
            out = self._parse_json(
                self._text(
                    f"售后客诉：「{complaint}」。归因（物流/质量/尺码/错发/其他）并"
                    '仅输出 JSON：{"attribution","confidence"(0-100),"suggestion","reply_draft"}。'
                )
            )
            if out.get("attribution") not in ("物流", "质量", "尺码", "错发", "其他"):
                raise ValueError("归因越界")
            return {
                "attribution": out["attribution"],
                "confidence": int(out.get("confidence") or 85),
                "suggestion": out.get("suggestion") or "回复草稿",
                "reply_draft": out.get("reply_draft") or "",
            }
        except Exception:
            return self._fallback.triage_ticket(complaint)


def build_adapter(settings: Settings) -> ModelAdapter:
    """ECOS_MODEL_* 齐备 → LiveAdapter，否则 SimulatedAdapter（默认）。"""
    if settings.model_name and settings.model_api_key:
        from ..agent.runtime import build_model

        return LiveAdapter(build_model(settings))
    return SimulatedAdapter()
