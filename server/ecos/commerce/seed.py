""""蓝海优品" 种子剧本：首启为 default_user 写入演示交易数据。

全部确定性生成（无随机、无当前时间依赖），保证测试快照可重复：
- 5 店铺（taobao/tmall/douyin/pdd connected + jd expired）
- 12 SKU（数值抄自 ecom-proto/src/data/ecom.ts 的 seedProducts）
- 30 天订单流水（按 platform+day 哈希生成）
- 3 资产 / 2 售后工单（工单状态=待分析，供 AI 归因演示）
"""

from __future__ import annotations

import hashlib
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Asset, Order, Product, Store, Ticket

_SEED_ANCHOR = datetime(2026, 9, 3, 12, 0)  # 固定纪元，保证 created_at/authorized_at 确定性


def _hash_int(*parts: object) -> int:
    digest = hashlib.md5("|".join(str(p) for p in parts).encode("utf-8")).hexdigest()
    return int(digest[:8], 16)


def _is_seeded(session: Session, user_id: str) -> bool:
    return (
        session.execute(
            select(Store.id).where(Store.user_id == user_id).limit(1)
        ).first()
        is not None
    )


# (platform_id, name, status, authorized_offset_days) —— 4 connected + 1 expired
_STORES: list[tuple[str, str, str, int]] = [
    ("taobao", "蓝海优品 · 淘宝旗舰店", "connected", 120),
    ("tmall", "蓝海优品 · 天猫旗舰店", "connected", 110),
    ("douyin", "蓝海优品 · 抖音小店", "connected", 95),
    ("pdd", "蓝海优品 · 拼多多小店", "connected", 80),
    ("jd", "蓝海优品 · 京东自营", "expired", 60),
]

# (platform, sku, title, price, category, stock, sales_7d, trend, conv, rating)
# 数值抄自原型 seedProducts，并补齐到 12 个 SKU 以覆盖各店。
_PRODUCTS: list[tuple] = [
    ("taobao", "TAO-CABLE-01", "三合一磁吸快充数据线 1.2m", 59.0, "3C数码", 1280, 421, "up", 4.8, 4.8),
    ("taobao", "TAO-HOOK-02", "车载手机支架 出风口款", 39.0, "车载配件", 860, 286, "down", 4.5, 4.5),
    ("taobao", "TAO-CUP-03", "便携果汁杯 无线榨汁", 89.0, "厨房电器", 640, 153, "flat", 4.6, 3.2),
    ("tmall", "TMM-CABLE-01", "三合一磁吸快充数据线 1.2m", 65.0, "3C数码", 980, 388, "up", 4.7, 4.8),
    ("tmall", "TMM-SLEEVE-04", "防晒冰袖 UPF50+ 男女通用", 19.9, "服饰配件", 2200, 918, "up", 6.1, 4.7),
    ("tmall", "TMM-BAG-05", "桌面收纳盒 三层可叠", 45.0, "家居收纳", 540, 97, "down", 4.2, 1.8),
    ("douyin", "DYN-SLEEVE-04", "防晒冰袖 UPF50+ 男女通用", 22.9, "服饰配件", 3100, 1240, "up", 6.8, 4.7),
    ("douyin", "DYN-CUP-03", "便携果汁杯 无线榨汁", 92.0, "厨房电器", 720, 268, "up", 5.2, 4.6),
    ("douyin", "DYN-HOOK-02", "车载手机支架 出风口款", 35.0, "车载配件", 1500, 512, "flat", 4.4, 4.5),
    ("pdd", "PDD-BAG-05", "桌面收纳盒 三层可叠", 39.9, "家居收纳", 4100, 1680, "up", 5.9, 4.3),
    ("pdd", "PDD-CABLE-01", "三合一磁吸快充数据线 1.2m", 49.9, "3C数码", 2600, 742, "down", 3.8, 4.6),
    ("jd", "JD-HOOK-02", "车载手机支架 出风口款", 42.0, "车载配件", 300, 64, "flat", 4.1, 4.4),
]

# (name, type, tags, size, versions, refs)
_ASSETS: list[tuple] = [
    (
        "蓝海优品 Logo（新版）", "logo", ["品牌", "官方", "2026"], "412 KB",
        [{"v": "v2", "by": "沈默", "at": "08-28", "note": "更新中文字重"},
         {"v": "v1", "by": "外部供应商", "at": "07-15", "note": "首发"}],
        [],
    ),
    (
        "品牌主色 · 深海蓝", "swatch", ["品牌", "色卡"], "12 KB",
        [{"v": "v1", "by": "沈默", "at": "07-15", "note": "品牌规范"}],
        [],
    ),
    (
        "新品 · 白底模特图", "model", ["新品", "模特", "白底"], "1.8 MB",
        [{"v": "v1", "by": "林芳", "at": "09-01", "note": "影棚直出"}],
        [],
    ),
]

# (order_ref, customer, platform, product_name, complaint, attribution, confidence, suggestion, reply_draft, refund_amount, status)
_TICKETS: list[tuple] = [
    (
        "DD2026090201", "张**", "taobao", "三合一磁吸快充数据线 1.2m",
        "充电线收到后磁吸端松动，吸不住", "质量", 0, "回复草稿", "", None, "待分析",
    ),
    (
        "DD2026090105", "王**", "pdd", "桌面收纳盒 三层可叠",
        "快递三天了还没到", "物流", 0, "自助解决", "", None, "待分析",
    ),
]

_ORDER_STATUSES = ["已完成", "待发货", "已发货", "已完成", "退款", "已完成"]


def _seed_stores(session: Session, user_id: str) -> dict[str, Store]:
    by_platform: dict[str, Store] = {}
    for platform, name, status, auth_offset in _STORES:
        store = Store(
            user_id=user_id,
            platform=platform,
            name=name,
            status=status,
            authorized_at=_SEED_ANCHOR - timedelta(days=auth_offset),
        )
        session.add(store)
        by_platform[platform] = store
    session.flush()
    return by_platform


def _seed_products(session: Session, user_id: str, stores: dict[str, Store]) -> None:
    for (
        platform, sku, title, price, category, stock, sales_7d, trend, conv, rating
    ) in _PRODUCTS:
        store = stores[platform]
        session.add(
            Product(
                user_id=user_id,
                store_id=store.id,
                sku=sku,
                title=title,
                price=price,
                category=category,
                stock=stock,
                sales_7d=sales_7d,
                trend=trend,
                conv=conv,
                rating=rating,
            )
        )


def _seed_orders(session: Session, user_id: str, stores: dict[str, Store]) -> None:
    products_by_store: dict[str, list[Product]] = {}
    for product in session.execute(
        select(Product).where(Product.user_id == user_id).order_by(Product.sku)
    ).scalars():
        products_by_store.setdefault(product.store_id, []).append(product)

    for platform in ("taobao", "tmall", "douyin", "pdd"):
        store = stores[platform]
        store_products = products_by_store.get(store.id, [])
        if not store_products:
            continue
        for day in range(30):
            n_orders = 1 + _hash_int("orders", platform, day) % 4
            for i in range(n_orders):
                product = store_products[_hash_int("pick", platform, day, i) % len(store_products)]
                amount = round(product.price * (1 + _hash_int("amt", platform, day, i) % 3), 2)
                status = _ORDER_STATUSES[_hash_int("st", platform, day, i) % len(_ORDER_STATUSES)]
                session.add(
                    Order(
                        user_id=user_id,
                        store_id=store.id,
                        sku=product.sku,
                        amount=amount,
                        status=status,
                        created_at=_SEED_ANCHOR - timedelta(days=day),
                    )
                )


def seed_commerce(session: Session, user_id: str) -> None:
    """幂等：仅当该 user 尚无 stores 行时写入整套种子数据。"""
    if _is_seeded(session, user_id):
        return

    stores = _seed_stores(session, user_id)
    _seed_products(session, user_id, stores)
    _seed_orders(session, user_id, stores)

    for name, atype, tags, size, versions, refs in _ASSETS:
        session.add(
            Asset(
                user_id=user_id,
                name=name,
                type=atype,
                size=size,
                tags=list(tags),
                versions=list(versions),
                refs=list(refs),
            )
        )

    for (
        order_ref, customer, platform, product_name, complaint,
        attribution, confidence, suggestion, reply_draft, refund_amount, status,
    ) in _TICKETS:
        session.add(
            Ticket(
                user_id=user_id,
                order_ref=order_ref,
                customer=customer,
                platform=platform,
                product_name=product_name,
                complaint=complaint,
                attribution=attribution,
                confidence=confidence,
                suggestion=suggestion,
                reply_draft=reply_draft,
                refund_amount=refund_amount,
                status=status,
            )
        )


def seed_platform_connectors(
    session: Session,
    user_id: str,
    *,
    catalog,
    vault,
    gateway_base_url: str,
) -> None:
    """为发布链路预装 5 个平台沙箱连接器实例（幂等：已 active 的 kind 跳过）。"""
    from ..connectors.adapters import platforms as _platforms  # 注册适配器
    from ..connectors.service import ConnectorService
    from ..tasks.audit import AuditService

    service = ConnectorService(
        session=session,
        catalog=catalog,
        vault=vault,
        gateway_base_url=gateway_base_url,
        audit=AuditService(session),
    )
    active = {i.kind for i in service.list_instances(user_id) if i.status == "active"}
    for kind in _platforms.PLATFORM_KINDS:
        if kind not in active:
            service.install(
                user_id=user_id, kind=kind, credentials={"access_token": "sandbox"}
            )
