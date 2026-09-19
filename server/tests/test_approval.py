import pytest

from ecos.errors import NotFoundError, TaskStateError
from ecos.tasks.approval import ApprovalService
from ecos.tasks.audit import AuditService


@pytest.fixture()
def services(session):
    audit = AuditService(session)
    return {"approvals": ApprovalService(session, audit), "audit": audit}


@pytest.fixture()
def task(session):
    from ecos.models import Task

    t = Task(id="task_1", user_id="u1", type="publish", title="上架新品")
    session.add(t)
    session.flush()
    return t


def test_request_creates_pending_approval_and_audits(services, task):
    approval = services["approvals"].request(task, requested_by="system")
    assert approval.status == "pending"
    assert approval.task_id == task.id
    assert task.status == "pending_approval"
    actions = [r.action for r in services["audit"].list(user_id="u1")]
    assert "approval.request" in actions


def test_approve_updates_task_and_audit(services, task):
    approval = services["approvals"].request(task)
    decided = services["approvals"].decide(approval.id, approver="林芳", decision="approve")
    assert decided.status == "approved"
    assert decided.decided_by == "林芳"
    assert decided.decided_at is not None
    assert task.status == "approved"
    rows = [r for r in services["audit"].list(user_id="u1") if r.action == "approval.approve"]
    assert rows and rows[0].actor == "user:林芳"


def test_double_decide_rejected(services, task):
    approval = services["approvals"].request(task)
    services["approvals"].decide(approval.id, approver="林芳", decision="approve")
    with pytest.raises(TaskStateError):
        services["approvals"].decide(approval.id, approver="林芳", decision="reject")


def test_decide_requires_approver(services, task):
    approval = services["approvals"].request(task)
    with pytest.raises(ValueError):
        services["approvals"].decide(approval.id, approver="  ", decision="approve")


def test_decide_invalid_decision_rejected(services, task):
    approval = services["approvals"].request(task)
    with pytest.raises(ValueError):
        services["approvals"].decide(approval.id, approver="林芳", decision="maybe")


def test_unknown_approval_not_found(services):
    with pytest.raises(NotFoundError):
        services["approvals"].decide("appv_missing", approver="林芳", decision="approve")


def test_for_task_returns_latest(services, task):
    first = services["approvals"].request(task)
    assert services["approvals"].for_task(task).id == first.id
