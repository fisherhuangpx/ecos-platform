"""交易域 ORM：店铺 / 商品 / 订单 / 收藏 / 资产 / 草稿 / 售后工单。"""

from datetime import datetime

from sqlalchemy import JSON, DateTime
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin, new_id


class Store(Base, TimestampMixin):
    __tablename__ = "stores"

    id: Mapped[str] = mapped_column(
        primary_key=True, default=lambda: new_id("st")
    )
    user_id: Mapped[str] = mapped_column(index=True)
    platform: Mapped[str] = mapped_column(index=True)
    name: Mapped[str]
    status: Mapped[str] = mapped_column(default="connected")
    authorized_at: Mapped[datetime | None] = mapped_column(
        DateTime, default=None
    )


class Product(Base, TimestampMixin):
    __tablename__ = "products"

    id: Mapped[str] = mapped_column(
        primary_key=True, default=lambda: new_id("po")
    )
    user_id: Mapped[str] = mapped_column(index=True)
    store_id: Mapped[str] = mapped_column(index=True)
    sku: Mapped[str]
    title: Mapped[str]
    price: Mapped[float]
    category: Mapped[str] = mapped_column(default="")
    stock: Mapped[int] = mapped_column(default=0)
    sales_7d: Mapped[int] = mapped_column(default=0)
    trend: Mapped[str] = mapped_column(default="flat")
    conv: Mapped[float] = mapped_column(default=0.0)
    rating: Mapped[float] = mapped_column(default=0.0)
    review_note: Mapped[str] = mapped_column(default="")


class Order(Base, TimestampMixin):
    __tablename__ = "orders"

    id: Mapped[str] = mapped_column(
        primary_key=True, default=lambda: new_id("or")
    )
    user_id: Mapped[str] = mapped_column(index=True)
    store_id: Mapped[str] = mapped_column(index=True)
    sku: Mapped[str] = mapped_column(default="")
    amount: Mapped[float]
    status: Mapped[str] = mapped_column(default="已完成")


class Favorite(Base, TimestampMixin):
    __tablename__ = "favorites"

    id: Mapped[str] = mapped_column(
        primary_key=True, default=lambda: new_id("fv")
    )
    user_id: Mapped[str] = mapped_column(index=True)
    ref_id: Mapped[str] = mapped_column(default="")
    name: Mapped[str]
    source: Mapped[str] = mapped_column(default="")
    heat: Mapped[int] = mapped_column(default=0)
    price: Mapped[float] = mapped_column(default=0.0)


class Asset(Base, TimestampMixin):
    __tablename__ = "assets"

    id: Mapped[str] = mapped_column(
        primary_key=True, default=lambda: new_id("as")
    )
    user_id: Mapped[str] = mapped_column(index=True)
    name: Mapped[str]
    type: Mapped[str]
    size: Mapped[str] = mapped_column(default="0 KB")
    tags: Mapped[list] = mapped_column(JSON, default=list)
    versions: Mapped[list] = mapped_column(JSON, default=list)
    refs: Mapped[list] = mapped_column(JSON, default=list)


class Draft(Base, TimestampMixin):
    __tablename__ = "drafts"

    id: Mapped[str] = mapped_column(
        primary_key=True, default=lambda: new_id("dr")
    )
    user_id: Mapped[str] = mapped_column(index=True)
    title: Mapped[str]
    price: Mapped[float] = mapped_column(default=0.0)
    selling_points: Mapped[list] = mapped_column(JSON, default=list)
    image_label: Mapped[str] = mapped_column(default="")
    source: Mapped[str] = mapped_column(default="")
    status: Mapped[str] = mapped_column(default="待完善")


class Ticket(Base, TimestampMixin):
    __tablename__ = "tickets"

    id: Mapped[str] = mapped_column(
        primary_key=True, default=lambda: new_id("tk")
    )
    user_id: Mapped[str] = mapped_column(index=True)
    order_ref: Mapped[str] = mapped_column(default="")
    customer: Mapped[str] = mapped_column(default="")
    platform: Mapped[str] = mapped_column(default="")
    product_name: Mapped[str] = mapped_column(default="")
    complaint: Mapped[str] = mapped_column(default="")
    attribution: Mapped[str | None] = mapped_column(default=None)
    confidence: Mapped[int] = mapped_column(default=0)
    suggestion: Mapped[str | None] = mapped_column(default=None)
    reply_draft: Mapped[str] = mapped_column(default="")
    refund_amount: Mapped[float | None] = mapped_column(default=None)
    status: Mapped[str] = mapped_column(default="待分析")
    approved_at: Mapped[datetime | None] = mapped_column(
        DateTime, default=None
    )
    reject_reason: Mapped[str | None] = mapped_column(default=None)
    reject_feedback: Mapped[str | None] = mapped_column(default=None)
