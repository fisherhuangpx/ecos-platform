"""ECOS 服务入口：装配 FastAPI 应用。"""

from __future__ import annotations

import json

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import select

from .ai.adapter import build_adapter
from .api.ai import router as ai_router
from .api.commerce import router as commerce_router
from .api.gateway import router as gateway_router
from .api.research import router as research_router
from .api.routes import router
from .auth.identity import build_idp
from .auth.rbac import ensure_user, grant_role, seed_rbac
from .commerce.seed import seed_commerce, seed_platform_connectors
from .config import Settings
from .connectors.catalog import default_catalog
from .db import init_db, make_engine, make_session_factory
from .errors import (
    ApprovalForbidden,
    ApprovalRequired,
    ConnectorError,
    NotFoundError,
    PermissionDenied,
    TaskStateError,
    Unauthorized,
)
from .models.connector import ConnectorInstance
from .research.service import ResearchService
from .research.sources import default_sources as default_research_sources
from .security.vault import CredentialVault

_STATUS_BY_ERROR = {
    NotFoundError: 404,
    Unauthorized: 401,
    PermissionDenied: 403,
    ApprovalForbidden: 403,
    ApprovalRequired: 409,
    TaskStateError: 409,
    ConnectorError: 400,
    ValueError: 400,
}


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()
    settings.validate_runtime()
    engine = make_engine(settings.database_url)
    init_db(engine)

    app = FastAPI(title="ECOS Server", version="0.1.0")
    app.state.settings = settings
    app.state.session_factory = make_session_factory(engine)
    app.state.vault = CredentialVault(settings.secret_key)
    app.state.catalog = default_catalog()
    app.state.idp = build_idp(settings)
    app.state.model_adapter = build_adapter(settings)

    with app.state.session_factory() as seed_session:
        seed_rbac(seed_session)
        if settings.env != "prod":
            # 开发/测试引导：默认用户直接持有 admin 角色
            ensure_user(seed_session, settings.default_user_id, display_name="开发管理员")
            grant_role(seed_session, settings.default_user_id, "admin")
            seed_commerce(seed_session, settings.default_user_id)
            seed_platform_connectors(
                seed_session,
                settings.default_user_id,
                catalog=app.state.catalog,
                vault=app.state.vault,
                gateway_base_url=settings.gateway_base_url,
            )
        seed_session.commit()

    def research_vault_lookup(kind: str) -> dict | None:
        """研究壳源凭据：查 src-* active 连接器实例并解密。"""
        with app.state.session_factory() as s:
            inst = s.execute(
                select(ConnectorInstance)
                .where(
                    ConnectorInstance.kind == kind,
                    ConnectorInstance.status == "active",
                )
                .limit(1)
            ).scalar_one_or_none()
            if inst is None or not inst.credential_blob:
                return None
            return json.loads(app.state.vault.decrypt(inst.credential_blob))

    app.state.research_service = ResearchService(
        settings,
        app.state.session_factory,
        default_research_sources(settings, vault_lookup=research_vault_lookup),
    )

    origins = settings.cors_origin_list()
    if origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=origins,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    for exc_type, status in _STATUS_BY_ERROR.items():
        app.add_exception_handler(exc_type, _error_handler(status))

    app.include_router(router)
    app.include_router(commerce_router)
    app.include_router(ai_router)
    app.include_router(research_router)
    app.include_router(gateway_router)

    @app.get("/healthz")
    def healthz() -> dict[str, str]:
        return {"status": "ok"}

    return app


def _error_handler(status: int):
    async def handler(request: Request, exc: Exception) -> JSONResponse:
        return JSONResponse(status_code=status, content={"detail": str(exc)})

    return handler
