"""身份提供者：LocalDirectoryIdP（HS256 自签）与 OidcIdP（RS256+JWKS）。"""

import json
import time

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from sqlalchemy.orm import sessionmaker

from ecos.auth.identity import LocalDirectoryIdP, OidcIdP, build_idp
from ecos.auth.rbac import ensure_user, grant_role, seed_rbac
from ecos.config import Settings
from ecos.db import init_db, make_engine
from ecos.errors import NotFoundError, Unauthorized
from ecos.models import Base


@pytest.fixture()
def db():
    engine = make_engine("sqlite://")
    init_db(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    with factory() as s:
        seed_rbac(s)
        yield s


@pytest.fixture()
def local_idp(db):
    return LocalDirectoryIdP(secret_key="test-secret", ttl_seconds=60)


def test_local_mint_resolve_roundtrip_grants_seeded_permissions(db, local_idp):
    ensure_user(db, "alice", display_name="爱丽丝")
    grant_role(db, "alice", "operator")
    db.commit()

    token = local_idp.mint_token(db, "alice")
    principal = local_idp.resolve(token, db)

    assert principal.user_id == "alice"
    assert principal.display_name == "爱丽丝"
    assert "operator" in principal.roles
    assert "connector.install" in principal.permissions
    assert "task.approve" not in principal.permissions


def test_local_mint_unknown_user_rejected(db, local_idp):
    with pytest.raises(NotFoundError):
        local_idp.mint_token(db, "ghost")


def test_local_resolve_rejects_expired(db, local_idp):
    ensure_user(db, "bob")
    db.commit()
    expired = LocalDirectoryIdP(secret_key="test-secret", ttl_seconds=-10)
    token = expired.mint_token(db, "bob")
    with pytest.raises(Unauthorized, match="过期"):
        local_idp.resolve(token, db)


def test_local_resolve_rejects_tampered(db, local_idp):
    ensure_user(db, "bob")
    db.commit()
    token = local_idp.mint_token(db, "bob")
    with pytest.raises(Unauthorized):
        local_idp.resolve(token[:-3] + "abc", db)


def test_local_resolve_rejects_foreign_audience(db, local_idp):
    ensure_user(db, "bob")
    db.commit()
    other = LocalDirectoryIdP(
        secret_key="test-secret", ttl_seconds=60, audience="someone-else"
    )
    token = other.mint_token(db, "bob")
    with pytest.raises(Unauthorized):
        local_idp.resolve(token, db)


def test_disabled_user_cannot_get_principal(db, local_idp):
    from ecos.models import User

    ensure_user(db, "carol")
    db.get(User, "carol").status = "disabled"
    db.commit()
    with pytest.raises((Unauthorized, ValueError)):
        # mint 时就应拒绝；若 mint 放行，resolve 必须拦
        token = local_idp.mint_token(db, "carol")
        local_idp.resolve(token, db)


# ---- OIDC ----

@pytest.fixture(scope="module")
def rsa_material():
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private_pem = key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )
    jwk = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(key.public_key()))
    jwk.update({"kid": "k1", "use": "sig", "alg": "RS256"})
    return private_pem, {"keys": [jwk]}


def _oidc_token(private_pem, *, sub="ext-1", aud="ecos-server", iss="https://idp.test", exp_in=600, kid="k1"):
    now = int(time.time())
    return jwt.encode(
        {
            "sub": sub,
            "aud": aud,
            "iss": iss,
            "name": "外部用户",
            "iat": now,
            "exp": now + exp_in,
        },
        private_pem,
        algorithm="RS256",
        headers={"kid": kid},
    )


def test_oidc_resolve_verifies_rs256_and_provisions_user(db, rsa_material):
    private_pem, jwks = rsa_material
    idp = OidcIdP(
        issuer="https://idp.test",
        audience="ecos-server",
        jwks_fetcher=lambda: jwks,
    )
    token = _oidc_token(private_pem)
    principal = idp.resolve(token, db)
    assert principal.user_id == "ext-1"
    assert principal.display_name == "外部用户"
    assert principal.permissions == frozenset()  # JIT 建档，角色待授权


def test_oidc_rejects_wrong_audience(db, rsa_material):
    private_pem, jwks = rsa_material
    idp = OidcIdP(issuer="https://idp.test", audience="ecos-server", jwks_fetcher=lambda: jwks)
    with pytest.raises(Unauthorized):
        idp.resolve(_oidc_token(private_pem, aud="other-app"), db)


def test_oidc_rejects_expired(db, rsa_material):
    private_pem, jwks = rsa_material
    idp = OidcIdP(issuer="https://idp.test", audience="ecos-server", jwks_fetcher=lambda: jwks)
    with pytest.raises(Unauthorized, match="过期"):
        idp.resolve(_oidc_token(private_pem, exp_in=-30), db)


def test_oidc_rejects_unknown_kid(db, rsa_material):
    private_pem, jwks = rsa_material
    idp = OidcIdP(issuer="https://idp.test", audience="ecos-server", jwks_fetcher=lambda: jwks)
    with pytest.raises(Unauthorized):
        idp.resolve(_oidc_token(private_pem, kid="unknown"), db)


def test_build_idp_switches_on_mode():
    local = build_idp(Settings(secret_key="t"))
    assert isinstance(local, LocalDirectoryIdP)
    oidc = build_idp(
        Settings(secret_key="t", auth_mode="oidc", oidc_issuer="https://idp.test")
    )
    assert isinstance(oidc, OidcIdP)
