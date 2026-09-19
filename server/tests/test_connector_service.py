from datetime import timedelta

import pytest

from ecos.connectors.catalog import Scope, default_catalog
from ecos.connectors.service import ConnectorService
from ecos.errors import (
    ConnectorAuthError,
    ConnectorInactive,
    ConnectorValidationError,
    ToolNotAllowed,
    UnknownConnectorKind,
)
from ecos.models import utcnow
from ecos.security.vault import CredentialVault
from ecos.tasks.audit import AuditService


@pytest.fixture()
def svc(session, settings):
    return ConnectorService(
        session=session,
        catalog=default_catalog(),
        vault=CredentialVault(settings.secret_key),
        gateway_base_url=settings.gateway_base_url,
        audit=AuditService(session),
    )


def test_install_stores_encrypted_credential(svc):
    inst = svc.install(
        user_id="u1",
        kind="demo-shop",
        credentials={"access_token": "tok-123"},
    )
    assert inst.status == "active"
    assert inst.mcp_server_name == f"demo-shop__{inst.id}"
    assert "tok-123" not in (inst.credential_blob or "")
    assert svc.credential(inst) == {"access_token": "tok-123"}


def test_install_unknown_kind_rejected(svc):
    with pytest.raises(UnknownConnectorKind):
        svc.install(user_id="u1", kind="nope", credentials={})


def test_install_validates_credential_fields(svc):
    with pytest.raises(ConnectorValidationError):
        svc.install(user_id="u1", kind="demo-shop", credentials={})
    with pytest.raises(ConnectorValidationError):
        svc.install(
            user_id="u1",
            kind="demo-shop",
            credentials={"access_token": "x", "extra": "y"},
        )


def test_duplicate_active_install_is_rejected(svc):
    svc.install(user_id="u1", kind="demo-shop", credentials={"access_token": "t"})
    with pytest.raises(ConnectorValidationError):
        svc.install(user_id="u1", kind="demo-shop", credentials={"access_token": "t2"})
    # 其他用户安装同一连接器不受影响
    svc.install(user_id="u2", kind="demo-shop", credentials={"access_token": "t3"})


def test_reinstall_allowed_after_revoke(svc):
    inst = svc.install(user_id="u1", kind="demo-shop", credentials={"access_token": "t"})
    svc.revoke(inst, by="u1")
    again = svc.install(user_id="u1", kind="demo-shop", credentials={"access_token": "t2"})
    assert again.status == "active"
    assert again.id != inst.id


def test_install_is_audited(session, svc):
    svc.install(
        user_id="u1",
        kind="demo-shop",
        credentials={"access_token": "t"},
    )
    rows = AuditService(session).list(user_id="u1")
    assert rows[0].action == "connector.install"
    assert rows[0].level == "system"


def test_revoke_marks_revoked_and_blocks_resolve(svc):
    inst = svc.install(
        user_id="u1",
        kind="demo-shop",
        credentials={"access_token": "t"},
    )
    svc.revoke(inst, by="u1")
    assert inst.status == "revoked"
    with pytest.raises(ConnectorInactive):
        svc.resolve_tool("u1", "demo-shop", "list_products")


def test_expiring_credential_requires_reauth(session, svc):
    inst = svc.install(
        user_id="u1",
        kind="demo-shop",
        credentials={"access_token": "t"},
        expires_at=utcnow() + timedelta(seconds=30),
    )
    with pytest.raises(ConnectorAuthError):
        svc.ensure_fresh(inst)
    assert inst.status == "expired"
    failed = [r for r in AuditService(session).list(user_id="u1") if r.result == "failed"]
    assert failed and failed[0].action == "connector.credential.expired"


def test_mcp_spec_uses_decrypted_token(svc):
    inst = svc.install(
        user_id="u1",
        kind="demo-shop",
        credentials={"access_token": "tok-XYZ"},
    )
    assert svc.is_expiring(inst) is False
    spec = svc.mcp_spec(inst)
    assert spec.name == inst.mcp_server_name
    assert spec.url.startswith(f"http://testserver/api/internal/mcp/demo-shop/{inst.id}?token=")
    assert len(spec.url.split("token=")[1]) >= 16


def test_resolve_tool_enforces_allowlist(svc):
    svc.install(
        user_id="u1",
        kind="demo-shop",
        credentials={"access_token": "t"},
    )
    inst, decl = svc.resolve_tool("u1", "demo-shop", "create_product")
    assert decl.scope is Scope.write
    assert inst.status == "active"
    with pytest.raises(ToolNotAllowed):
        svc.resolve_tool("u1", "demo-shop", "delete_everything")


def test_resolve_tool_requires_active_instance(svc):
    with pytest.raises(ConnectorInactive):
        svc.resolve_tool("u2", "demo-shop", "list_products")
