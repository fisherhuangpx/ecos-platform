import pytest

from ecos.tasks.audit import AuditService


def _log(audit, **overrides):
    kwargs = dict(
        user_id="u1",
        actor="system",
        action="connector.install",
        target_type="connector_instance",
        target_id="con_1",
        level="system",
    )
    kwargs.update(overrides)
    return audit.log(**kwargs)


def test_log_and_list_roundtrip(session):
    audit = AuditService(session)
    _log(audit, detail={"kind": "demo-shop"})
    rows = audit.list(user_id="u1")
    assert len(rows) == 1
    row = rows[0]
    assert row.action == "connector.install"
    assert row.detail == {"kind": "demo-shop"}
    assert row.actor == "system"
    assert row.result == "ok"


def test_invalid_level_rejected(session):
    with pytest.raises(ValueError):
        _log(AuditService(session), level="bogus")


def test_list_filters_by_user_and_orders_recent_first(session):
    audit = AuditService(session)
    for i in range(3):
        _log(audit, action=f"a{i}")
    _log(audit, user_id="u2", action="other")
    rows = audit.list(user_id="u1")
    assert [r.action for r in rows] == ["a2", "a1", "a0"]


def test_list_limit_applied(session):
    audit = AuditService(session)
    for i in range(5):
        _log(audit, action=f"a{i}")
    assert len(audit.list(user_id="u1", limit=2)) == 2
