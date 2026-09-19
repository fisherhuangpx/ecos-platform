"""交易域服务：查询与本地写。外部平台写一律走任务引擎（红线），本层不触碰连接器。"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..errors import NotFoundError
from ..models import Asset, Draft, Favorite, Order, Product, Store, Ticket
from ..models.base import utcnow
from ..tasks.audit import AuditService
from ..tasks.engine import StepSpec, spec_from_tool

PLATFORMS = ("taobao", "tmall", "douyin", "pdd", "jd")
STORE_STATUSES = ("connected", "expired", "disconnected")

# 外部写目标 = 平台沙箱连接器（T4），kind → 步骤展示名
PUBLISH_PLATFORMS = {
    "taobao-shop": "淘宝",
    "tmall-shop": "天猫",
    "douyin-shop": "抖音",
    "pdd-shop": "拼多多",
    "jd-shop": "京东",
}
BANNED_TERMS = ("最好", "第一", "100%")


class CommerceService:
    def __init__(self, session: Session, audit: AuditService, user_id: str) -> None:
        self.session = session
        self.audit = audit
        self.user_id = user_id

    # ── 内部工具 ──────────────────────────────────────────────

    def _audit(self, action: str, target_type: str, target_id: str, **kw: Any) -> None:
        self.audit.log(
            user_id=self.user_id,
            actor=f"user:{self.user_id}",
            action=action,
            target_type=target_type,
            target_id=target_id,
            level=kw.pop("level", "write"),
            result="ok",
            detail=kw.pop("detail", None),
        )

    def _get(self, model: Any, ident: str, label: str) -> Any:
        row = self.session.get(model, ident)
        if row is None or row.user_id != self.user_id:
            # 不泄露存在性：他人行与不存在同样 404
            raise NotFoundError(f"{label}不存在: {ident}")
        return row

    # ── 店铺 ─────────────────────────────────────────────────

    def list_stores(self) -> list[Store]:
        rows = self.session.execute(
            select(Store).where(Store.user_id == self.user_id).order_by(Store.created_at, Store.id)
        ).scalars().all()
        return list(rows)

    def create_store(self, platform: str, name: str = "") -> Store:
        if platform not in PLATFORMS:
            raise ValueError(f"不支持的平台: {platform}")
        store = Store(
            user_id=self.user_id,
            platform=platform,
            name=name or f"蓝海优品 · {platform}",
            status="connected",
            authorized_at=utcnow(),
        )
        self.session.add(store)
        self.session.flush()
        self._audit("commerce.store_create", "store", store.id, detail={"platform": platform})
        return store

    def set_store_status(self, store_id: str, status: str) -> Store:
        if status not in STORE_STATUSES:
            raise ValueError(f"非法店铺状态: {status}")
        store = self._get(Store, store_id, "店铺")
        store.status = status
        self.session.flush()
        self._audit("commerce.store_update", "store", store.id, detail={"status": status})
        return store

    def delete_store(self, store_id: str) -> None:
        store = self._get(Store, store_id, "店铺")
        self.session.delete(store)
        self._audit("commerce.store_delete", "store", store_id)

    # ── 商品 / 订单 ──────────────────────────────────────────

    def list_products(self, store_id: str | None = None) -> list[Product]:
        stmt = select(Product).where(Product.user_id == self.user_id)
        if store_id:
            stmt = stmt.where(Product.store_id == store_id)
        return list(self.session.execute(stmt.order_by(Product.created_at, Product.id)).scalars().all())

    def list_orders(self, store_id: str | None = None, limit: int = 50) -> list[Order]:
        stmt = select(Order).where(Order.user_id == self.user_id)
        if store_id:
            stmt = stmt.where(Order.store_id == store_id)
        stmt = stmt.order_by(Order.created_at.desc(), Order.id.desc()).limit(limit)
        return list(self.session.execute(stmt).scalars().all())

    def _orders_anchor(self) -> datetime | None:
        return self.session.execute(
            select(func.max(Order.created_at)).where(Order.user_id == self.user_id)
        ).scalar()

    def analytics_series(self, store_id: str | None = None, buckets: int = 14) -> list[dict[str, Any]]:
        stmt = select(Order).where(Order.user_id == self.user_id)
        if store_id:
            stmt = stmt.where(Order.store_id == store_id)
        orders = list(self.session.execute(stmt).scalars().all())
        if not orders:
            return []
        anchor = max(o.created_at for o in orders)
        series: list[dict[str, Any]] = []
        for i in range(buckets):
            day = (anchor - timedelta(days=i)).date()
            in_day = [o for o in orders if o.created_at.date() == day]
            series.append(
                {
                    "date": day.strftime("%m-%d"),
                    "amount": round(sum(o.amount for o in in_day), 2),
                    "orders": len(in_day),
                }
            )
        series.reverse()
        return series

    def store_stats(self) -> dict[str, dict[str, Any]]:
        products = dict(
            self.session.execute(
                select(Product.store_id, func.count())
                .where(Product.user_id == self.user_id)
                .group_by(Product.store_id)
            ).all()
        )
        anchor = self._orders_anchor()
        window_start = anchor - timedelta(days=7) if anchor else None
        orders7: dict[str, int] = {}
        if window_start:
            rows = self.session.execute(
                select(Order.store_id, func.count())
                .where(Order.user_id == self.user_id, Order.created_at >= window_start)
                .group_by(Order.store_id)
            ).all()
            orders7 = dict(rows)
        stats: dict[str, dict[str, Any]] = {}
        for sid in set(products) | set(orders7):
            stats[sid] = {"products": products.get(sid, 0), "orders_7d": orders7.get(sid, 0)}
        return stats

    def kpis(self) -> dict[str, Any]:
        stores_connected = self.session.execute(
            select(func.count())
            .select_from(Store)
            .where(Store.user_id == self.user_id, Store.status == "connected")
        ).scalar() or 0
        products = self.session.execute(
            select(func.count()).select_from(Product).where(Product.user_id == self.user_id)
        ).scalar() or 0
        anchor = self._orders_anchor()
        orders_7d, gmv_7d = 0, 0.0
        if anchor:
            rows = self.session.execute(
                select(func.count(), func.coalesce(func.sum(Order.amount), 0.0)).where(
                    Order.user_id == self.user_id,
                    Order.created_at >= anchor - timedelta(days=7),
                )
            ).one()
            orders_7d, gmv_7d = int(rows[0]), float(rows[1])
        tickets_pending = self.session.execute(
            select(func.count())
            .select_from(Ticket)
            .where(
                Ticket.user_id == self.user_id,
                Ticket.status.in_(("待分析", "待审批")),
            )
        ).scalar() or 0
        return {
            "stores_connected": stores_connected,
            "products": products,
            "orders_7d": orders_7d,
            "gmv_7d": round(gmv_7d, 2),
            "tickets_pending": tickets_pending,
        }

    # ── 收藏 ─────────────────────────────────────────────────

    def list_favorites(self) -> list[Favorite]:
        return list(
            self.session.execute(
                select(Favorite).where(Favorite.user_id == self.user_id).order_by(Favorite.created_at.desc(), Favorite.id.desc())
            ).scalars().all()
        )

    def add_favorite(self, *, ref_id: str, name: str, source: str, heat: int, price: float) -> Favorite:
        hit = self.session.execute(
            select(Favorite).where(Favorite.user_id == self.user_id, Favorite.name == name)
        ).scalars().first()
        if hit:
            return hit
        fav = Favorite(
            user_id=self.user_id, ref_id=ref_id, name=name, source=source, heat=heat, price=price
        )
        self.session.add(fav)
        self.session.flush()
        self._audit("commerce.favorite_add", "favorite", fav.id, detail={"name": name})
        return fav

    def remove_favorite(self, favorite_id: str) -> None:
        fav = self._get(Favorite, favorite_id, "收藏")
        self.session.delete(fav)
        self._audit("commerce.favorite_remove", "favorite", favorite_id)

    # ── 资产 ─────────────────────────────────────────────────

    def list_assets(self) -> list[Asset]:
        return list(
            self.session.execute(
                select(Asset).where(Asset.user_id == self.user_id).order_by(Asset.created_at.desc(), Asset.id.desc())
            ).scalars().all()
        )

    def create_asset(self, *, name: str, atype: str, tags: list[str]) -> Asset:
        asset = Asset(
            user_id=self.user_id,
            name=name,
            type=atype,
            size="0 KB",
            tags=list(tags),
            versions=[{"v": "v1", "by": self.user_id, "at": utcnow().strftime("%m-%d"), "note": "上传"}],
            refs=[],
        )
        self.session.add(asset)
        self.session.flush()
        self._audit("commerce.asset_create", "asset", asset.id, detail={"name": name})
        return asset

    def add_asset_version(self, asset_id: str, *, by: str, note: str) -> Asset:
        asset = self._get(Asset, asset_id, "资产")
        versions = [
            {"v": f"v{len(asset.versions) + 1}", "by": by or self.user_id, "at": utcnow().strftime("%m-%d"), "note": note or "更新"},
            *asset.versions,
        ]
        asset.versions = versions
        self.session.flush()
        self._audit("commerce.asset_version_add", "asset", asset_id, detail={"v": versions[0]["v"]})
        return asset

    # ── 草稿 ─────────────────────────────────────────────────

    def list_drafts(self) -> list[Draft]:
        return list(
            self.session.execute(
                select(Draft).where(Draft.user_id == self.user_id).order_by(Draft.created_at.desc(), Draft.id.desc())
            ).scalars().all()
        )

    def create_draft(self, payload: dict[str, Any]) -> Draft:
        title = str(payload.get("title") or "").strip()
        if not title:
            raise ValueError("草稿标题不能为空")
        draft = Draft(
            user_id=self.user_id,
            title=title,
            price=float(payload.get("price") or 0),
            selling_points=list(payload.get("selling_points") or []),
            image_label=str(payload.get("image_label") or ""),
            source=str(payload.get("source") or ""),
            status=str(payload.get("status") or "待完善"),
        )
        self.session.add(draft)
        self.session.flush()
        self._audit("commerce.draft_create", "draft", draft.id, detail={"title": title})
        return draft

    def update_draft(self, draft_id: str, payload: dict[str, Any]) -> Draft:
        draft = self._get(Draft, draft_id, "草稿")
        for field in ("title", "price", "selling_points", "image_label", "source", "status"):
            if field in payload:
                value = payload[field]
                if field == "price":
                    value = float(value)
                elif field == "selling_points":
                    value = list(value)
                setattr(draft, field, value)
        self.session.flush()
        self._audit("commerce.draft_update", "draft", draft.id, detail={"fields": sorted(payload)})
        return draft

    def delete_draft(self, draft_id: str) -> None:
        draft = self._get(Draft, draft_id, "草稿")
        self.session.delete(draft)
        self._audit("commerce.draft_delete", "draft", draft_id)

    # ── 工单（查询；审批流在 T6） ────────────────────────────

    def list_tickets(self) -> list[Ticket]:
        return list(
            self.session.execute(
                select(Ticket).where(Ticket.user_id == self.user_id).order_by(Ticket.created_at, Ticket.id)
            ).scalars().all()
        )

    def get_store(self, store_id: str) -> Store:
        return self._get(Store, store_id, "店铺")

    def triage_tickets(self, adapter) -> int:
        """把待分析工单批量归因并转待审批，返回处理数（本地写，不涉外部平台）。"""
        pending = self.session.execute(
            select(Ticket)
            .where(Ticket.user_id == self.user_id, Ticket.status == "待分析")
            .order_by(Ticket.created_at, Ticket.id)
        ).scalars().all()
        for ticket in pending:
            out = adapter.triage_ticket(ticket.complaint)
            ticket.attribution = out["attribution"]
            ticket.confidence = int(out["confidence"])
            ticket.suggestion = out["suggestion"]
            ticket.reply_draft = out["reply_draft"]
            ticket.status = "待审批"
        self.session.flush()
        return len(list(pending))

    # ── 发布：外部写一律任务引擎（红线） ─────────────────────

    def publish_draft(
        self,
        draft_id: str,
        platform_kinds: list[str],
        *,
        connectors,
        engine,
        requested_by: str = "system",
    ):
        if not platform_kinds:
            raise ValueError("请至少选择一个发布平台")
        unknown = [k for k in platform_kinds if k not in PUBLISH_PLATFORMS]
        if unknown:
            raise ValueError(f"不支持的平台: {'、'.join(unknown)}")
        draft = self._get(Draft, draft_id, "草稿")
        hits = [term for term in BANNED_TERMS if term in draft.title]
        if hits:
            raise ValueError(f"标题含平台违禁词: {'、'.join(hits)}")

        specs: list[StepSpec] = []
        for kind in platform_kinds:
            try:
                _instance, decl = connectors.resolve_tool(self.user_id, kind, "publish_product")
            except NotFoundError:
                raise ValueError(f"平台连接器未安装或已撤销: {PUBLISH_PLATFORMS[kind]}") from None
            tool_ref = f"{kind}:publish_product"
            errors = decl.arg_errors(
                {"sku": f"DR-{draft.id[-6:]}", "title": draft.title, "price": draft.price}
            )
            if errors:
                raise ValueError(f"草稿不满足平台参数契约: {'；'.join(errors)}")
            specs.append(
                spec_from_tool(
                    name=f"上架·{PUBLISH_PLATFORMS[kind]}",
                    tool_ref=tool_ref,
                    decl=decl,
                    args={
                        "sku": f"DR-{draft.id[-6:]}",
                        "title": draft.title,
                        "price": draft.price,
                    },
                )
            )

        task = engine.create_task(
            user_id=self.user_id,
            type="publish",
            title=f"{draft.title} · 多渠道上架",
            steps=specs,
            payload={"draft_id": draft.id, "platforms": list(platform_kinds)},
        )
        engine.submit(task, requested_by=requested_by)
        draft.status = "已提交"
        self.session.flush()
        self._audit(
            "commerce.publish",
            "draft",
            draft.id,
            detail={"platforms": list(platform_kinds), "task_id": task.id},
        )
        return task

    # ── 工单裁决：approve 走任务引擎，reject 仅本地 ─────────

    def review_ticket(
        self,
        ticket_id: str,
        *,
        decision: str,
        reason: str = "",
        feedback: str = "",
        connectors,
        engine,
        requested_by: str = "system",
    ) -> tuple[Ticket, Any]:
        ticket = self._get(Ticket, ticket_id, "工单")
        if decision == "reject":
            ticket.status = "已驳回"
            ticket.reject_reason = reason.strip() or "未说明"
            ticket.reject_feedback = feedback.strip()
            self.session.flush()
            self._audit("ticket.reject", "ticket", ticket.id, detail={"reason": ticket.reject_reason})
            return ticket, None
        if decision != "approve":
            raise ValueError(f"非法裁决: {decision}")
        if ticket.status not in ("待审批", "待分析"):
            raise ValueError(f"工单状态不允许裁决: {ticket.status}")

        kind = f"{ticket.platform}-shop"
        specs: list[StepSpec] = []

        def _spec(tool_name: str, args: dict[str, Any]) -> StepSpec:
            try:
                _instance, decl = connectors.resolve_tool(self.user_id, kind, tool_name)
            except NotFoundError:
                raise ValueError(f"平台连接器未安装或已撤销: {kind}") from None
            errors = decl.arg_errors(args)
            if errors:
                raise ValueError(f"{tool_name} 参数不符合契约: {'；'.join(errors)}")
            return spec_from_tool(name=f"{tool_name}·{kind}", tool_ref=f"{kind}:{tool_name}", decl=decl, args=args)

        specs.append(
            _spec(
                "push_reply",
                {
                    "order_ref": ticket.order_ref,
                    "body": ticket.reply_draft
                    or f"您好，关于「{ticket.product_name}」的反馈我们已处理，请留意后续进度。",
                },
            )
        )
        if ticket.refund_amount:
            specs.append(_spec("grant_refund", {"order_ref": ticket.order_ref, "amount": float(ticket.refund_amount)}))

        task = engine.create_task(
            user_id=self.user_id,
            type="after_sales",
            title=f"售后处理 · {ticket.order_ref}",
            steps=specs,
            payload={"ticket_id": ticket.id},
        )
        engine.submit(task, requested_by=requested_by)
        ticket.status = "已转执行"
        ticket.approved_at = utcnow()
        self.session.flush()
        self._audit("ticket.approve", "ticket", ticket.id, detail={"task_id": task.id})
        return ticket, task
