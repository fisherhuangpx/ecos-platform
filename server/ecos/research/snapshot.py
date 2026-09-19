"""SourceSnapshot TTL 缓存：payload 即 Signal 列表 JSON。"""

from __future__ import annotations

import hashlib
import json
from datetime import timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models.base import utcnow
from ..models.research import SourceSnapshot


def query_key(source_id: str, args: dict[str, Any]) -> str:
    blob = json.dumps(args, ensure_ascii=False, sort_keys=True)
    return hashlib.md5(f"{source_id}|{blob}".encode("utf-8")).hexdigest()


def fresh_payload(
    session: Session, source_id: str, args: dict[str, Any], ttl: int
) -> list[dict[str, Any]] | None:
    """命中条件：未到 expires_at，且抓取时刻在 ttl 窗口内（ttl 小可强制更新鲜）。"""
    row = session.execute(
        select(SourceSnapshot).where(
            SourceSnapshot.source_id == source_id,
            SourceSnapshot.query_key == query_key(source_id, args),
        )
    ).scalars().first()
    if row is None:
        return None
    now = utcnow()
    if row.expires_at <= now:
        return None
    if (now - row.captured_at).total_seconds() > ttl:
        return None
    return list(row.payload or [])


def store_payload(
    session: Session,
    source_id: str,
    args: dict[str, Any],
    payload: list[dict[str, Any]],
    ttl: int = 21600,
) -> None:
    key = query_key(source_id, args)
    now = utcnow()
    row = session.execute(
        select(SourceSnapshot).where(
            SourceSnapshot.source_id == source_id, SourceSnapshot.query_key == key
        )
    ).scalars().first()
    if row is None:
        row = SourceSnapshot(source_id=source_id, query_key=key, captured_at=now)
        session.add(row)
    row.payload = payload
    row.captured_at = now
    row.expires_at = now + timedelta(seconds=max(ttl, 0))
