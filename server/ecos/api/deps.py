"""请求级依赖：会话提交/回滚 + 身份解析 + 领域服务装配。"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterator

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from ..ai.adapter import SimulatedAdapter
from ..auth.identity import IdentityProvider, Principal
from ..commerce.service import CommerceService
from ..config import Settings
from ..connectors.executor import ConnectorStepExecutor
from ..connectors.service import ConnectorService
from ..errors import EcosError, PermissionDenied, Unauthorized
from ..research.service import ResearchService
from ..security.vault import CredentialVault
from ..tasks.approval import ApprovalService
from ..tasks.audit import AuditService
from ..tasks.engine import TaskEngine


def get_session(request: Request) -> Iterator[Session]:
    session: Session = request.app.state.session_factory()
    try:
        yield session
        session.commit()
    except EcosError:
        # 领域判定（审批拦截 denied、凭据过期等）本身就是审计事实，必须留痕
        session.commit()
        raise
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


@dataclass
class Services:
    settings: Settings
    user_id: str
    session: Session
    audit: AuditService
    connectors: ConnectorService
    approvals: ApprovalService
    engine: TaskEngine
    commerce: CommerceService
    ai: Any
    research: ResearchService
    principal: Principal
    idp: IdentityProvider

    def require(self, *perms: str) -> None:
        """RBAC 强制：开发模式（auth_enabled=false）放行；缺权落 denied 审计。"""
        if not self.settings.auth_enabled:
            return
        missing = [p for p in perms if p not in self.principal.permissions]
        if missing:
            self.audit.log(
                user_id=self.principal.user_id,
                actor=f"user:{self.principal.user_id}",
                action="rbac.denied",
                target_type="permission",
                target_id=",".join(missing),
                level="system",
                result="denied",
            )
            raise PermissionDenied(f"缺少所需权限: {'，'.join(missing)}")


def _resolve_principal(
    request: Request,
    session: Session,
    settings: Settings,
    audit: AuditService,
    idp: IdentityProvider,
) -> Principal:
    if not settings.auth_enabled:
        return Principal(user_id=settings.default_user_id, display_name="dev")
    if request.url.path == "/api/auth/token":
        # 令牌签发端点是认证自举入口，本身不做认证（仅 local 模式可用）
        return Principal(user_id="anonymous", display_name="匿名")
    if request.url.path.startswith("/api/internal/mcp"):
        # 机机端点由绑定实例的过期令牌鉴权，不走登录身份
        return Principal(user_id="mcp-gateway", display_name="MCP 网关")
    header = request.headers.get("authorization", "")
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        _auth_denied(audit, request, "缺少 Bearer 令牌")
        raise Unauthorized("缺少 Bearer 令牌")
    try:
        return idp.resolve(token.strip(), session)
    except Unauthorized as exc:
        _auth_denied(audit, request, str(exc))
        raise


def _auth_denied(audit: AuditService, request: Request, reason: str) -> None:
    audit.log(
        user_id="",
        actor="anonymous",
        action="auth.denied",
        target_type="request",
        target_id=request.url.path,
        level="system",
        result="denied",
        detail={"reason": reason},
    )


def get_services(
    request: Request, session: Session = Depends(get_session)
) -> Services:
    settings: Settings = request.app.state.settings
    vault: CredentialVault = request.app.state.vault
    idp: IdentityProvider = request.app.state.idp
    audit = AuditService(session)
    principal = _resolve_principal(request, session, settings, audit, idp)
    connectors = ConnectorService(
        session=session,
        catalog=request.app.state.catalog,
        vault=vault,
        gateway_base_url=settings.gateway_base_url,
        audit=audit,
        gateway_token_ttl_seconds=settings.gateway_token_ttl_seconds,
    )
    approvals = ApprovalService(session, audit)
    engine = TaskEngine(
        session=session,
        executor=ConnectorStepExecutor(connectors),
        audit=audit,
        approvals=approvals,
    )
    commerce = CommerceService(session, audit, principal.user_id)
    return Services(
        settings=settings,
        user_id=principal.user_id,
        session=session,
        audit=audit,
        connectors=connectors,
        approvals=approvals,
        engine=engine,
        commerce=commerce,
        ai=getattr(request.app.state, "model_adapter") or SimulatedAdapter(),
        research=request.app.state.research_service,
        principal=principal,
        idp=idp,
    )
