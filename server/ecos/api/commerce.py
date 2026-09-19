"""交易域 REST：/api/commerce/**（查询 + 本地写；外部平台写走任务引擎）。"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from . import serializers
from .deps import Services, get_services

router = APIRouter(prefix="/api/commerce")

VIEW = "commerce.view"
MANAGE = "commerce.manage"


def _row(obj: Any) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for col in obj.__table__.columns:
        value = getattr(obj, col.name)
        out[col.name] = value.isoformat() if isinstance(value, datetime) else value
    return out


class StoreCreate(BaseModel):
    platform: str
    name: str = ""


class StorePatch(BaseModel):
    status: str


class FavoriteCreate(BaseModel):
    ref_id: str = ""
    name: str
    source: str = ""
    heat: int = 0
    price: float = 0


class AssetCreate(BaseModel):
    name: str
    type: str
    tags: list[str] = Field(default_factory=list)


class AssetVersionCreate(BaseModel):
    by: str = ""
    note: str = ""


class DraftCreate(BaseModel):
    title: str
    price: float = 0
    selling_points: list[str] = Field(default_factory=list)
    image_label: str = ""
    source: str = ""
    status: str = ""


class DraftPatch(BaseModel):
    title: str | None = None
    price: float | None = None
    selling_points: list[str] | None = None
    image_label: str | None = None
    source: str | None = None
    status: str | None = None


class PublishPayload(BaseModel):
    platforms: list[str] = Field(default_factory=list)


# ── stores ──────────────────────────────────────────────────


@router.get("/stores")
def list_stores(svc: Services = Depends(get_services)) -> dict[str, Any]:
    svc.require(VIEW)
    stats = svc.commerce.store_stats()
    stores = []
    for store in svc.commerce.list_stores():
        row = _row(store)
        row.update(stats.get(store.id, {"products": 0, "orders_7d": 0}))
        stores.append(row)
    return {"stores": stores}


@router.post("/stores")
def create_store(payload: StoreCreate, svc: Services = Depends(get_services)) -> dict[str, Any]:
    svc.require(MANAGE)
    store = svc.commerce.create_store(payload.platform, payload.name)
    svc.session.commit()
    return {"store": _row(store)}


@router.patch("/stores/{store_id}")
def patch_store(store_id: str, payload: StorePatch, svc: Services = Depends(get_services)) -> dict[str, Any]:
    svc.require(MANAGE)
    store = svc.commerce.set_store_status(store_id, payload.status)
    svc.session.commit()
    return {"store": _row(store)}


@router.delete("/stores/{store_id}")
def delete_store(store_id: str, svc: Services = Depends(get_services)) -> dict[str, Any]:
    svc.require(MANAGE)
    svc.commerce.delete_store(store_id)
    svc.session.commit()
    return {"deleted": store_id}


# ── 查询：products / orders / analytics / kpis ─────────────


@router.get("/products")
def list_products(store_id: str | None = None, svc: Services = Depends(get_services)) -> dict[str, Any]:
    svc.require(VIEW)
    return {"products": [_row(p) for p in svc.commerce.list_products(store_id)]}


@router.get("/orders")
def list_orders(
    store_id: str | None = None, limit: int = 50, svc: Services = Depends(get_services)
) -> dict[str, Any]:
    svc.require(VIEW)
    return {"orders": [_row(o) for o in svc.commerce.list_orders(store_id, limit)]}


@router.get("/analytics/series")
def analytics_series(store_id: str | None = None, svc: Services = Depends(get_services)) -> dict[str, Any]:
    svc.require(VIEW)
    return {"series": svc.commerce.analytics_series(store_id)}


@router.get("/kpis")
def kpis(svc: Services = Depends(get_services)) -> dict[str, Any]:
    svc.require(VIEW)
    return {"kpis": svc.commerce.kpis()}


# ── favorites ───────────────────────────────────────────────


@router.get("/favorites")
def list_favorites(svc: Services = Depends(get_services)) -> dict[str, Any]:
    svc.require(VIEW)
    return {"favorites": [_row(f) for f in svc.commerce.list_favorites()]}


@router.post("/favorites")
def add_favorite(payload: FavoriteCreate, svc: Services = Depends(get_services)) -> dict[str, Any]:
    svc.require(MANAGE)
    fav = svc.commerce.add_favorite(
        ref_id=payload.ref_id,
        name=payload.name,
        source=payload.source,
        heat=payload.heat,
        price=payload.price,
    )
    svc.session.commit()
    return {"favorite": _row(fav)}


@router.delete("/favorites/{favorite_id}")
def remove_favorite(favorite_id: str, svc: Services = Depends(get_services)) -> dict[str, Any]:
    svc.require(MANAGE)
    svc.commerce.remove_favorite(favorite_id)
    svc.session.commit()
    return {"deleted": favorite_id}


# ── assets ──────────────────────────────────────────────────


@router.get("/assets")
def list_assets(svc: Services = Depends(get_services)) -> dict[str, Any]:
    svc.require(VIEW)
    return {"assets": [_row(a) for a in svc.commerce.list_assets()]}


@router.post("/assets")
def create_asset(payload: AssetCreate, svc: Services = Depends(get_services)) -> dict[str, Any]:
    svc.require(MANAGE)
    asset = svc.commerce.create_asset(name=payload.name, atype=payload.type, tags=payload.tags)
    svc.session.commit()
    return {"asset": _row(asset)}


@router.post("/assets/{asset_id}/versions")
def add_asset_version(
    asset_id: str, payload: AssetVersionCreate, svc: Services = Depends(get_services)
) -> dict[str, Any]:
    svc.require(MANAGE)
    asset = svc.commerce.add_asset_version(asset_id, by=payload.by, note=payload.note)
    svc.session.commit()
    return {"asset": _row(asset)}


# ── drafts ──────────────────────────────────────────────────


@router.get("/drafts")
def list_drafts(svc: Services = Depends(get_services)) -> dict[str, Any]:
    svc.require(VIEW)
    return {"drafts": [_row(d) for d in svc.commerce.list_drafts()]}


@router.post("/drafts")
def create_draft(payload: DraftCreate, svc: Services = Depends(get_services)) -> dict[str, Any]:
    svc.require(MANAGE)
    draft = svc.commerce.create_draft(payload.model_dump(exclude_none=True))
    svc.session.commit()
    return {"draft": _row(draft)}


@router.patch("/drafts/{draft_id}")
def update_draft(draft_id: str, payload: DraftPatch, svc: Services = Depends(get_services)) -> dict[str, Any]:
    svc.require(MANAGE)
    draft = svc.commerce.update_draft(draft_id, payload.model_dump(exclude_none=True))
    svc.session.commit()
    return {"draft": _row(draft)}


@router.delete("/drafts/{draft_id}")
def delete_draft(draft_id: str, svc: Services = Depends(get_services)) -> dict[str, Any]:
    svc.require(MANAGE)
    svc.commerce.delete_draft(draft_id)
    svc.session.commit()
    return {"deleted": draft_id}


@router.post("/drafts/{draft_id}/publish")
def publish_draft(
    draft_id: str, payload: PublishPayload, svc: Services = Depends(get_services)
) -> dict[str, Any]:
    """外部写唯一通道：校验后建多步任务走审批闸门，绝不直接执行。"""
    svc.require("task.create")
    task = svc.commerce.publish_draft(
        draft_id,
        payload.platforms,
        connectors=svc.connectors,
        engine=svc.engine,
        requested_by=svc.principal.user_id if svc.settings.auth_enabled else "system",
    )
    svc.session.commit()
    return {"task": serializers.task_out(task, svc.approvals.for_task(task))}


# ── tickets ─────────────────────────────────────────────────


@router.get("/tickets")
def list_tickets(svc: Services = Depends(get_services)) -> dict[str, Any]:
    svc.require(VIEW)
    return {"tickets": [_row(t) for t in svc.commerce.list_tickets()]}


class TicketReview(BaseModel):
    decision: str
    reason: str = ""
    feedback: str = ""


@router.patch("/tickets/{ticket_id}/review")
def review_ticket(
    ticket_id: str, payload: TicketReview, svc: Services = Depends(get_services)
) -> dict[str, Any]:
    """approve → push_reply(±grant_refund) 写任务走审批闸门；reject 仅本地状态+审计。"""
    svc.require("ticket.review")
    ticket, task = svc.commerce.review_ticket(
        ticket_id,
        decision=payload.decision,
        reason=payload.reason,
        feedback=payload.feedback,
        connectors=svc.connectors,
        engine=svc.engine,
        requested_by=svc.principal.user_id if svc.settings.auth_enabled else "system",
    )
    svc.session.commit()
    return {
        "ticket": _row(ticket),
        "task": serializers.task_out(task, svc.approvals.for_task(task)) if task else None,
    }
