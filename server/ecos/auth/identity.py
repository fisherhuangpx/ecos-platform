"""身份提供者：可替换的 IdentityProvider 抽象 + 本地自签与 OIDC 两个实现。

生产方向：企业 IdP（如 Casdoor/Keycloak，支持钉钉/飞书登录）走 OIDC；
local 模式仅供开发/测试，自签 HS256 令牌。RBAC 判定始终在应用库内完成。
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Any, Callable, Mapping, Protocol

import jwt
from sqlalchemy.orm import Session

from ..config import Settings
from ..errors import NotFoundError, Unauthorized
from ..models import User, utcnow
from .rbac import ensure_user, effective_permissions


@dataclass(frozen=True)
class Principal:
    user_id: str
    display_name: str = ""
    roles: tuple[str, ...] = ()
    permissions: frozenset[str] = field(default_factory=frozenset)
    claims: Mapping[str, Any] = field(default_factory=dict)

    def has_perm(self, code: str) -> bool:
        return code in self.permissions


class IdentityProvider(Protocol):
    mode: str

    def resolve(self, token: str, session: Session) -> Principal: ...


def _principal_for(
    session: Session, claims: Mapping[str, Any], *, provision: bool
) -> Principal:
    user_id = str(claims.get("sub") or "")
    if not user_id:
        raise Unauthorized("令牌缺少 sub")
    user = session.get(User, user_id)
    if user is None:
        if not provision:
            raise Unauthorized(f"用户未在 RBAC 目录中: {user_id}")
        display = str(claims.get("name") or claims.get("preferred_username") or user_id)
        user = ensure_user(session, user_id, display_name=display)
    if user.status != "active":
        raise Unauthorized(f"用户已停用: {user_id}")
    roles, perms = effective_permissions(session, user.user_id)
    return Principal(
        user_id=user.user_id,
        display_name=user.display_name,
        roles=roles,
        permissions=perms,
        claims=dict(claims),
    )


class LocalDirectoryIdP:
    """开发/测试：HS256 自签令牌；签发要求用户已在 RBAC 目录。"""

    mode = "local"

    def __init__(
        self,
        *,
        secret_key: str,
        ttl_seconds: int = 8 * 3600,
        audience: str = "ecos-server",
    ) -> None:
        self._secret = secret_key
        self._ttl = ttl_seconds
        self._audience = audience

    def mint_token(self, session: Session, user_id: str) -> str:
        user = session.get(User, user_id)
        if user is None:
            raise NotFoundError(f"用户不存在，无法签发: {user_id}")
        if user.status != "active":
            raise ValueError(f"用户已停用，无法签发: {user_id}")
        now = utcnow()
        return jwt.encode(
            {
                "sub": user_id,
                "aud": self._audience,
                "iat": now,
                "exp": now + timedelta(seconds=self._ttl),
            },
            self._secret,
            algorithm="HS256",
        )

    def resolve(self, token: str, session: Session) -> Principal:
        try:
            claims = jwt.decode(
                token,
                self._secret,
                algorithms=["HS256"],
                audience=self._audience,
                options={"require": ["sub", "exp"]},
            )
        except jwt.ExpiredSignatureError as exc:
            raise Unauthorized("登录令牌已过期，请重新获取") from exc
        except jwt.PyJWTError as exc:
            raise Unauthorized(f"登录令牌无效: {exc}") from exc
        return _principal_for(session, claims, provision=False)


class OidcIdP:
    """生产：企业 IdP 签发的 RS256 JWT，经 JWKS 验签；首见用户 JIT 建档（无角色）。"""

    mode = "oidc"

    def __init__(
        self,
        *,
        issuer: str,
        audience: str,
        jwks_fetcher: Callable[[], Mapping[str, Any]] | None = None,
        leeway_seconds: int = 30,
    ) -> None:
        self._issuer = issuer
        self._audience = audience
        self._fetch_jwks = jwks_fetcher or self._default_jwks_fetcher(issuer)
        self._jwks_cache: Mapping[str, Any] | None = None
        self._leeway = leeway_seconds

    @staticmethod
    def _default_jwks_fetcher(issuer: str):
        def fetch() -> Mapping[str, Any]:
            import httpx

            well_known = issuer.rstrip("/") + "/.well-known/openid-configuration"
            config = httpx.get(well_known, timeout=10).json()
            return httpx.get(config["jwks_uri"], timeout=10).json()

        return fetch

    def _key_for(self, kid: str | None):
        if self._jwks_cache is None:
            self._jwks_cache = self._fetch_jwks()
        keys = list(self._jwks_cache.get("keys", []))
        data = next((k for k in keys if k.get("kid") == kid), None)
        if data is None:
            return None
        return jwt.algorithms.RSAAlgorithm.from_jwk(json.dumps(data))

    def resolve(self, token: str, session: Session) -> Principal:
        try:
            kid = jwt.get_unverified_header(token).get("kid")
        except jwt.PyJWTError as exc:
            raise Unauthorized(f"登录令牌格式非法: {exc}") from exc
        key = self._key_for(kid)
        if key is None:
            raise Unauthorized(f"IdP 签名密钥不可用（kid={kid}）")
        try:
            claims = jwt.decode(
                token,
                key,
                algorithms=["RS256"],
                audience=self._audience,
                issuer=self._issuer,
                leeway=self._leeway,
                options={"require": ["sub", "exp"]},
            )
        except jwt.ExpiredSignatureError as exc:
            raise Unauthorized("登录令牌已过期，请重新获取") from exc
        except jwt.PyJWTError as exc:
            raise Unauthorized(f"令牌校验失败: {exc}") from exc
        return _principal_for(session, claims, provision=True)


def build_idp(settings: Settings) -> IdentityProvider:
    if settings.auth_mode == "oidc":
        return OidcIdP(
            issuer=settings.oidc_issuer,
            audience=settings.oidc_audience,
        )
    return LocalDirectoryIdP(
        secret_key=settings.secret_key,
        ttl_seconds=settings.jwt_ttl_seconds,
        audience=settings.oidc_audience,
    )
