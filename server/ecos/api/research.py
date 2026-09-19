"""研究 REST：/api/research（任务化真实选品调研）。"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from .deps import Services, get_services

router = APIRouter(prefix="/api/research")

RUN_PERM = "research.run"


class ResearchPayload(BaseModel):
    category: str
    boards: list[str] | None = None
    blocking: bool = False  # 同步执行（TestClient/演示用；默认后台线程）


@router.post("")
def create_research(
    payload: ResearchPayload, svc: Services = Depends(get_services)
) -> dict[str, Any]:
    svc.require(RUN_PERM)
    run_id, cached = svc.research.create(svc.user_id, payload.category, payload.boards)
    if payload.blocking and not cached:
        svc.research.run_now(run_id)
    run = svc.research.get_run(svc.user_id, run_id)
    return {"run_id": run_id, "status": run["status"], "cached": cached}


@router.get("/runs")
def list_runs(svc: Services = Depends(get_services)) -> dict[str, Any]:
    svc.require(RUN_PERM)
    return {"runs": svc.research.list_runs(svc.user_id)}


@router.get("/runs/{run_id}")
def get_run(run_id: str, svc: Services = Depends(get_services)) -> dict[str, Any]:
    svc.require(RUN_PERM)
    detail = svc.research.get_run(svc.user_id, run_id)
    candidates = detail.pop("candidates", [])
    steps = detail.pop("steps", [])
    return {"run": detail, "steps": steps, "candidates": candidates}


@router.get("/sources")
def sources(svc: Services = Depends(get_services)) -> dict[str, Any]:
    svc.require(RUN_PERM)
    return {"sources": svc.research.sources_health(svc.user_id)}
