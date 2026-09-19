"""AI REST：/api/ai/**（选品报告 / 经营洞察 / 售后归因）。"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ..ai.adapter import SimulatedAdapter
from ..errors import NotFoundError
from .deps import Services, get_services

router = APIRouter(prefix="/api/ai")


class ResearchPayload(BaseModel):
    category: str


def _audit(svc: Services, action: str, level: str, detail: dict[str, Any]) -> None:
    svc.audit.log(
        user_id=svc.user_id,
        actor=f"user:{svc.user_id}",
        action=action,
        target_type="ai",
        target_id=action,
        level=level,
        result="ok",
        detail=detail,
    )


@router.post("/research")
def research(payload: ResearchPayload, svc: Services = Depends(get_services)) -> dict[str, Any]:
    svc.require("research.run")
    category = payload.category.strip()
    if not category:
        raise ValueError("品类不能为空")
    candidates = SimulatedAdapter().research_report(category)  # 演示档；真实分析走 /api/research
    _audit(svc, "ai.research", "read", {"category": category, "count": len(candidates)})
    svc.session.commit()
    return {"candidates": candidates}


@router.get("/insight")
def insight(store_id: str | None = None, svc: Services = Depends(get_services)) -> dict[str, Any]:
    svc.require("ai.use")
    if not store_id:
        raise NotFoundError("缺少 store_id")
    store = svc.commerce.get_store(store_id)
    series = svc.commerce.analytics_series(store_id)
    narrative = svc.ai.insight_narrative(store.name, {"series": series, "kpis": svc.commerce.kpis()})
    _audit(svc, "ai.insight", "read", {"store_id": store_id})
    return {"narrative": narrative}


@router.post("/tickets/triage")
def triage_tickets(svc: Services = Depends(get_services)) -> dict[str, Any]:
    """本地写：把待分析工单批量归因并转待审批（不触碰外部平台）。"""
    svc.require("ai.use")
    triaged = svc.commerce.triage_tickets(svc.ai)
    _audit(svc, "ai.triage", "system", {"triaged": triaged})
    svc.session.commit()
    return {"triaged": triaged}
