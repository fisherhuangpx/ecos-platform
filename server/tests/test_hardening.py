"""生产守护与 CORS：ECOS_ENV=prod 拒绝不安全配置；cors_origins 白名单。"""

import pytest

from ecos.config import Settings
from ecos.main import create_app


def _prod_settings(**overrides) -> Settings:
    base = dict(
        database_url="sqlite://",
        env="prod",
        secret_key="x" * 48,
        auth_enabled=True,
        auth_mode="oidc",
        oidc_issuer="https://idp.internal.example/realms/ecos",
    )
    base.update(overrides)
    return Settings(**base)


def test_new_settings_have_dev_defaults(settings):
    assert settings.env == "dev"
    assert settings.auth_enabled is False
    assert settings.auth_mode == "local"
    assert settings.gateway_token_ttl_seconds == 900
    assert settings.cors_origins == ""


def test_prod_rejects_default_secret():
    with pytest.raises(ValueError, match="SECRET_KEY"):
        create_app(_prod_settings(secret_key="dev-secret-change-me"))


def test_prod_rejects_short_secret():
    with pytest.raises(ValueError, match="SECRET_KEY"):
        create_app(_prod_settings(secret_key="tiny"))


def test_prod_requires_auth_enabled():
    with pytest.raises(ValueError, match="AUTH_ENABLED"):
        create_app(_prod_settings(auth_enabled=False))


def test_prod_requires_oidc_mode():
    with pytest.raises(ValueError, match="IdP"):
        create_app(_prod_settings(auth_mode="local"))


def test_prod_requires_oidc_issuer():
    with pytest.raises(ValueError, match="ISSUER"):
        create_app(_prod_settings(oidc_issuer=""))


def test_prod_accepts_valid_config():
    app = create_app(_prod_settings())
    assert app.state.settings.env == "prod"


def test_dev_allows_insecure_defaults(settings):
    assert create_app(settings) is not None


def test_cors_preflight_allowed_for_whitelisted_origin(settings):
    settings.cors_origins = "http://localhost:5173,https://ecos.internal"
    from fastapi.testclient import TestClient

    client = TestClient(create_app(settings))
    r = client.options(
        "/api/tasks",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert r.status_code == 200
    assert r.headers["access-control-allow-origin"] == "http://localhost:5173"


def test_cors_absent_by_default(settings):
    from fastapi.testclient import TestClient

    client = TestClient(create_app(settings))
    r = client.options(
        "/api/tasks",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "POST",
        },
    )
    assert "access-control-allow-origin" not in r.headers
