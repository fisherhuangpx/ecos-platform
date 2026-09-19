"""连接器实例服务：安装 / 凭据 / 有效期 / 工具白名单 / MCP spec。

会话即工作单元：调用方负责 commit。
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta
from typing import Mapping

from sqlalchemy import select

from ..errors import (
    ConnectorAuthError,
    ConnectorInactive,
    ConnectorValidationError,
    NotFoundError,
    ToolNotAllowed,
    UnknownConnectorKind,
)
from ..models import ConnectorInstance, utcnow
from ..security.vault import CredentialVault
from ..tasks.audit import AuditService
from .builder import McpServerSpec, build_mcp_spec, server_name
from .catalog import ConnectorEntry, ToolDecl

EXPIRY_SKEW_SECONDS = 120


class ConnectorService:
    def __init__(
        self,
        *,
        session,
        catalog: Mapping[str, ConnectorEntry],
        vault: CredentialVault,
        gateway_base_url: str,
        audit: AuditService,
        gateway_token_ttl_seconds: int = 900,
    ) -> None:
        self._session = session
        self._catalog = dict(catalog)
        self._vault = vault
        self._gateway_base_url = gateway_base_url
        self._audit = audit
        self._gateway_token_ttl = gateway_token_ttl_seconds

    @property
    def catalog(self) -> Mapping[str, ConnectorEntry]:
        return dict(self._catalog)

    @property
    def audit(self) -> AuditService:
        return self._audit

    def install(
        self,
        *,
        user_id: str,
        kind: str,
        credentials: Mapping[str, str],
        expires_at: datetime | None = None,
    ) -> ConnectorInstance:
        entry = self._catalog.get(kind)
        if entry is None:
            raise UnknownConnectorKind(f"连接器不存在: {kind}")
        self._validate_credentials(entry, credentials)

        active = (
            self._session.execute(
                select(ConnectorInstance).where(
                    ConnectorInstance.user_id == user_id,
                    ConnectorInstance.kind == kind,
                    ConnectorInstance.status == "active",
                )
            )
            .scalars()
            .first()
        )
        if active is not None:
            raise ConnectorValidationError(
                f"已安装该连接器（实例 {active.id}），请先撤销后再安装"
            )

        instance = ConnectorInstance(
            user_id=user_id,
            kind=kind,
            status="active",
            credential_blob=self._vault.encrypt(
                json.dumps(dict(credentials), ensure_ascii=False)
            ),
            credential_expires_at=expires_at,
        )
        self._session.add(instance)
        self._session.flush()
        instance.mcp_server_name = server_name(kind, instance.id)
        self._audit.log(
            user_id=user_id,
            actor=f"user:{user_id}",
            action="connector.install",
            target_type="connector_instance",
            target_id=instance.id,
            level="system",
            detail={"kind": kind},
        )
        return instance

    def get(self, instance_id: str) -> ConnectorInstance:
        instance = self._session.get(ConnectorInstance, instance_id)
        if instance is None:
            raise NotFoundError(f"连接器实例不存在: {instance_id}")
        return instance

    def list_instances(self, user_id: str) -> list[ConnectorInstance]:
        return list(
            self._session.execute(
                select(ConnectorInstance)
                .where(ConnectorInstance.user_id == user_id)
                .order_by(ConnectorInstance.created_at)
            )
            .scalars()
            .all()
        )

    def find_active(self, user_id: str, kind: str) -> ConnectorInstance:
        instance = (
            self._session.execute(
                select(ConnectorInstance)
                .where(
                    ConnectorInstance.user_id == user_id,
                    ConnectorInstance.kind == kind,
                    ConnectorInstance.status == "active",
                )
                .order_by(ConnectorInstance.created_at.desc())
            )
            .scalars()
            .first()
        )
        if instance is None:
            raise ConnectorInactive(f"未安装或不可用的连接器: {kind}")
        return instance

    def credential(self, instance: ConnectorInstance) -> dict[str, str]:
        if not instance.credential_blob:
            raise ConnectorAuthError(f"连接器缺少凭据: {instance.id}")
        return json.loads(self._vault.decrypt(instance.credential_blob))

    def is_expiring(
        self, instance: ConnectorInstance, *, now: datetime | None = None
    ) -> bool:
        if instance.credential_expires_at is None:
            return False
        current = now or utcnow()
        return instance.credential_expires_at <= current + timedelta(
            seconds=EXPIRY_SKEW_SECONDS
        )

    def ensure_fresh(self, instance: ConnectorInstance) -> ConnectorInstance:
        if self.is_expiring(instance):
            instance.status = "expired"
            self._audit.log(
                user_id=instance.user_id,
                actor="system",
                action="connector.credential.expired",
                target_type="connector_instance",
                target_id=instance.id,
                level="system",
                result="failed",
                detail={"kind": instance.kind},
            )
            raise ConnectorAuthError(
                f"连接器凭据已过期或即将过期，需要重新授权: {instance.kind}"
            )
        return instance

    def revoke(self, instance: ConnectorInstance, *, by: str) -> ConnectorInstance:
        instance.status = "revoked"
        self._audit.log(
            user_id=instance.user_id,
            actor=f"user:{by}",
            action="connector.revoke",
            target_type="connector_instance",
            target_id=instance.id,
            level="system",
            detail={"kind": instance.kind},
        )
        return instance

    def resolve_tool(
        self, user_id: str, kind: str, tool_name: str
    ) -> tuple[ConnectorInstance, ToolDecl]:
        entry = self._catalog.get(kind)
        if entry is None:
            raise UnknownConnectorKind(f"连接器不存在: {kind}")
        decl = entry.tool(tool_name)
        if decl is None:
            raise ToolNotAllowed(f"工具 {tool_name} 不在 {kind} 的白名单内")
        instance = self.find_active(user_id, kind)
        self.ensure_fresh(instance)
        return instance, decl

    def mcp_spec(self, instance: ConnectorInstance) -> McpServerSpec:
        entry = self._catalog.get(instance.kind)
        if entry is None:
            raise UnknownConnectorKind(f"连接器不存在: {instance.kind}")
        credentials = self.credential(instance)
        token = credentials.get("access_token") or next(
            iter(credentials.values()), ""
        )
        return build_mcp_spec(
            entry,
            instance,
            credential=token,
            gateway_base_url=self._gateway_base_url,
            gateway_token=self._vault.issue_gateway_token(
                instance.id, ttl_seconds=self._gateway_token_ttl
            ),
        )

    def _validate_credentials(
        self, entry: ConnectorEntry, credentials: Mapping[str, str]
    ) -> None:
        provided = set(credentials)
        required = set(entry.credential_fields)
        missing = required - provided
        if missing:
            raise ConnectorValidationError(
                f"缺少凭据字段: {', '.join(sorted(missing))}"
            )
        extra = provided - required
        if extra:
            raise ConnectorValidationError(
                f"未声明的凭据字段: {', '.join(sorted(extra))}"
            )
