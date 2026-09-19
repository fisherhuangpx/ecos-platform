"""连接器实例表（对齐 Octop 013_connector_instances 的裁剪版）。"""

from datetime import datetime

from sqlalchemy import DateTime
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin, new_id


class ConnectorInstance(Base, TimestampMixin):
    __tablename__ = "connector_instances"

    id: Mapped[str] = mapped_column(
        primary_key=True, default=lambda: new_id("con")
    )
    user_id: Mapped[str] = mapped_column(index=True)
    kind: Mapped[str]
    status: Mapped[str] = mapped_column(default="active")
    shared: Mapped[bool] = mapped_column(default=False)
    mcp_server_name: Mapped[str] = mapped_column(default="")
    credential_blob: Mapped[str | None] = mapped_column(default=None)
    credential_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime, default=None
    )
