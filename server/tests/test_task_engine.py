import threading

import pytest

from ecos.connectors.adapters import call_adapter, demo_shop
from ecos.connectors.catalog import default_catalog
from ecos.connectors.executor import ConnectorStepExecutor
from ecos.connectors.service import ConnectorService
from ecos.db import init_db, make_engine
from ecos.errors import ApprovalForbidden, ApprovalRequired, TaskStateError
from ecos.models import Task
from ecos.security.vault import CredentialVault
from ecos.tasks.approval import ApprovalService
from ecos.tasks.audit import AuditService
from ecos.tasks.engine import StepSpec, TaskEngine, spec_from_tool


@pytest.fixture(autouse=True)
def _reset_store():
    demo_shop.reset()
    yield
    demo_shop.reset()


@pytest.fixture()
def env(session, settings):
    audit = AuditService(session)
    svc = ConnectorService(
        session=session,
        catalog=default_catalog(),
        vault=CredentialVault(settings.secret_key),
        gateway_base_url=settings.gateway_base_url,
        audit=audit,
    )
    approvals = ApprovalService(session, audit)
    engine = TaskEngine(
        session=session,
        executor=ConnectorStepExecutor(svc),
        audit=audit,
        approvals=approvals,
    )
    svc.install(user_id="u1", kind="demo-shop", credentials={"access_token": "t"})
    return {"engine": engine, "approvals": approvals, "audit": audit, "svc": svc}


READ_STEP = StepSpec(name="查看商品", tool="demo-shop:list_products")
WRITE_STEP = StepSpec(
    name="创建商品",
    tool="demo-shop:create_product",
    args={"sku": "SKU-1", "title": "新品", "price": 99.0},
    scope="write",
    risk="medium",
    requires_approval=True,
)


def _skus() -> list[str]:
    return [
        p["sku"]
        for p in call_adapter("demo-shop", "list_products", {})["products"]
    ]


def test_read_only_task_runs_without_approval(env):
    task = env["engine"].create_task(
        user_id="u1", type="research", title="看商品", steps=[READ_STEP]
    )
    env["engine"].submit(task)
    assert task.status == "created"
    assert env["approvals"].for_task(task) is None

    env["engine"].run(task)
    assert task.status == "succeeded"
    assert task.steps[0].status == "succeeded"
    assert task.steps[0].output["products"]
    levels = [r.level for r in env["audit"].list(user_id="u1")]
    assert "read" in levels


def test_spec_from_tool_derives_gate_from_catalog_declaration():
    decl = default_catalog()["demo-shop"].tool("update_price")
    spec = spec_from_tool(name="改价", tool_ref="demo-shop:update_price", decl=decl, args={"sku": "x", "price": 1.0})
    assert spec.requires_approval is True
    assert spec.scope == "write"
    assert spec.risk == "high"

    read_decl = default_catalog()["demo-shop"].tool("list_products")
    read_spec = spec_from_tool(name="看", tool_ref="demo-shop:list_products", decl=read_decl)
    assert read_spec.requires_approval is False


def test_write_task_blocks_until_approved(env):
    task = env["engine"].create_task(
        user_id="u1", type="publish", title="上架新品", steps=[READ_STEP, WRITE_STEP]
    )
    env["engine"].submit(task)
    assert task.status == "pending_approval"
    approval = env["approvals"].for_task(task)
    assert approval is not None and approval.status == "pending"

    with pytest.raises(ApprovalRequired):
        env["engine"].run(task)

    assert task.steps[0].status == "pending"
    assert "SKU-1" not in _skus()


def test_approve_then_run_executes_write_and_audits(env):
    task = env["engine"].create_task(
        user_id="u1", type="publish", title="上架新品", steps=[READ_STEP, WRITE_STEP]
    )
    env["engine"].submit(task)
    approval = env["approvals"].for_task(task)
    env["approvals"].decide(approval.id, approver="林芳", decision="approve")
    assert task.status == "approved"

    env["engine"].run(task)
    assert task.status == "succeeded"
    assert "SKU-1" in _skus()

    actions = list(reversed([r.action for r in env["audit"].list(user_id="u1")]))
    assert "approval.approve" in actions
    assert actions.index("approval.approve") < actions.index("task.started")
    write_rows = [r for r in env["audit"].list(user_id="u1") if r.level == "write"]
    assert write_rows and write_rows[0].target_id == task.steps[1].id


def test_reject_blocks_run(env):
    task = env["engine"].create_task(
        user_id="u1", type="publish", title="上架新品", steps=[WRITE_STEP]
    )
    env["engine"].submit(task)
    approval = env["approvals"].for_task(task)
    env["approvals"].decide(approval.id, approver="林芳", decision="reject", note="价格有误")
    assert task.status == "rejected"

    with pytest.raises(TaskStateError):
        env["engine"].run(task)
    assert "SKU-1" not in _skus()
    rejects = [r for r in env["audit"].list(user_id="u1") if r.action == "approval.reject"]
    assert rejects and rejects[0].detail["note"] == "价格有误"


def test_partial_failure_then_retry_failed_step(env):
    steps = [
        WRITE_STEP,
        StepSpec(
            name="创建限流品",
            tool="demo-shop:create_product",
            args={"sku": "SKU-FLAKY", "title": "限流品", "price": 5.0},
            scope="write",
            risk="medium",
            requires_approval=True,
        ),
    ]
    task = env["engine"].create_task(user_id="u1", type="publish", title="批量上架", steps=steps)
    env["engine"].submit(task)
    approval = env["approvals"].for_task(task)
    env["approvals"].decide(approval.id, approver="林芳", decision="approve")

    env["engine"].run(task)
    assert task.status == "partial_failed"
    assert task.steps[0].status == "succeeded"
    assert task.steps[1].status == "failed"
    assert task.steps[1].attempt == 1
    assert "SKU-FLAKY" not in _skus()

    env["engine"].retry_failed(task)
    assert task.status == "succeeded"
    assert task.steps[1].attempt == 2
    assert "SKU-FLAKY" in _skus()
    assert "SKU-1" in _skus()


def test_retry_requires_failed_or_partial_state(env):
    task = env["engine"].create_task(user_id="u1", type="research", title="看商品", steps=[READ_STEP])
    env["engine"].submit(task)
    env["engine"].run(task)
    assert task.status == "succeeded"
    with pytest.raises(TaskStateError):
        env["engine"].retry_failed(task)


def test_forged_write_step_is_refused_by_executor(env):
    forged = StepSpec(
        name="伪造写步骤",
        tool="demo-shop:create_product",
        args={"sku": "SKU-EVIL", "title": "绕过", "price": 1.0},
        scope="write",
        risk="medium",
        requires_approval=False,
    )
    task = env["engine"].create_task(user_id="u1", type="publish", title="绕过尝试", steps=[forged])
    env["engine"].submit(task)
    assert task.status == "created"

    env["engine"].run(task)
    assert task.status == "failed"
    assert task.steps[0].status == "failed"
    assert "审批" in (task.steps[0].error or "")
    assert "SKU-EVIL" not in _skus()


def test_task_survives_reload_from_session(env, session):
    task = env["engine"].create_task(user_id="u1", type="research", title="看商品", steps=[READ_STEP])
    env["engine"].submit(task)
    env["engine"].run(task)
    session.expire_all()
    reloaded = session.get(Task, task.id)
    assert reloaded.status == "succeeded"
    assert reloaded.steps[0].output["products"]


def test_gate_denial_is_audited(env):
    task = env["engine"].create_task(
        user_id="u1", type="publish", title="上架新品", steps=[WRITE_STEP]
    )
    env["engine"].submit(task)
    with pytest.raises(ApprovalRequired):
        env["engine"].run(task)
    denied = [
        r
        for r in env["audit"].list(user_id="u1")
        if r.action == "task.approval_blocked"
    ]
    assert denied and denied[0].result == "denied"
    assert denied[0].target_id == task.id
    assert "SKU-1" not in _skus()


def test_rejected_run_denial_is_audited(env):
    task = env["engine"].create_task(
        user_id="u1", type="publish", title="上架新品", steps=[WRITE_STEP]
    )
    env["engine"].submit(task)
    approval = env["approvals"].for_task(task)
    env["approvals"].decide(approval.id, approver="林芳", decision="reject")
    with pytest.raises(TaskStateError):
        env["engine"].run(task)
    denied = [
        r
        for r in env["audit"].list(user_id="u1")
        if r.action == "task.approval_blocked"
    ]
    assert denied and denied[0].result == "denied"


def test_forged_write_refusal_is_audited_at_write_level(env):
    forged = StepSpec(
        name="伪造写步骤",
        tool="demo-shop:create_product",
        args={"sku": "SKU-EVIL", "title": "绕过", "price": 1.0},
        scope="write",
        risk="medium",
        requires_approval=False,
    )
    task = env["engine"].create_task(
        user_id="u1", type="publish", title="绕过尝试", steps=[forged]
    )
    env["engine"].submit(task)
    env["engine"].run(task)
    rows = [
        r
        for r in env["audit"].list(user_id="u1")
        if r.action == "connector.step.refused"
    ]
    assert rows and rows[0].result == "denied" and rows[0].level == "write"
    assert "SKU-EVIL" not in _skus()


def test_executor_rejects_args_outside_catalog_contract(env):
    bad = StepSpec(
        name="越权参数",
        tool="demo-shop:create_product",
        args={"sku": "SKU-X", "title": "越权", "price": 1.0, "stock": 99},
        scope="write",
        risk="medium",
        requires_approval=True,
    )
    task = env["engine"].create_task(
        user_id="u1", type="publish", title="越权尝试", steps=[bad]
    )
    env["engine"].submit(task)
    approval = env["approvals"].for_task(task)
    env["approvals"].decide(approval.id, approver="林芳", decision="approve")
    env["engine"].run(task)
    assert task.status == "failed"
    assert "未声明参数" in (task.steps[0].error or "")
    assert "SKU-X" not in _skus()


def test_high_risk_write_success_audited_at_high_risk_level(env):
    step = StepSpec(
        name="改价",
        tool="demo-shop:update_price",
        args={"sku": "SKU-1001", "price": 49.0},
        scope="write",
        risk="high",
        requires_approval=True,
    )
    task = env["engine"].create_task(
        user_id="u1", type="pricing", title="限时降价", steps=[step]
    )
    env["engine"].submit(task)
    approval = env["approvals"].for_task(task)
    env["approvals"].decide(approval.id, approver="林芳", decision="approve")
    env["engine"].run(task)
    assert task.status == "succeeded"
    rows = [
        r
        for r in env["audit"].list(user_id="u1")
        if r.action == "task.step.succeeded"
    ]
    assert rows and rows[0].level == "high_risk"
    products = call_adapter("demo-shop", "list_products", {})["products"]
    assert any(p["sku"] == "SKU-1001" and p["price"] == 49.0 for p in products)


def test_self_approval_is_forbidden_and_audited(env):
    task = env["engine"].create_task(
        user_id="u1", type="publish", title="上架新品", steps=[WRITE_STEP]
    )
    env["engine"].submit(task)
    approval = env["approvals"].for_task(task)
    with pytest.raises(ApprovalForbidden):
        env["approvals"].decide(approval.id, approver="u1", decision="approve")
    rows = [
        r
        for r in env["audit"].list(user_id="u1")
        if r.action == "approval.forbidden"
    ]
    assert rows and rows[0].result == "denied"
    assert rows[0].target_id == approval.id
    assert approval.status == "pending"


def test_requester_identity_in_approval_is_audited(env):
    task = env["engine"].create_task(
        user_id="u1", type="publish", title="上架新品", steps=[WRITE_STEP]
    )
    env["engine"].submit(task, requested_by="alice")
    approval = env["approvals"].for_task(task)
    with pytest.raises(ApprovalForbidden):
        env["approvals"].decide(approval.id, approver="alice", decision="approve")
    # 别的审批人仍可正常批准
    env["approvals"].decide(approval.id, approver="林芳", decision="approve")
    assert approval.status == "approved"


def test_retry_on_rejected_task_is_audited_as_denied(env):
    task = env["engine"].create_task(
        user_id="u1", type="publish", title="上架新品", steps=[WRITE_STEP]
    )
    env["engine"].submit(task)
    approval = env["approvals"].for_task(task)
    env["approvals"].decide(approval.id, approver="林芳", decision="reject")
    with pytest.raises(TaskStateError):
        env["engine"].retry_failed(task)
    denied = [
        r
        for r in env["audit"].list(user_id="u1")
        if r.action == "task.approval_blocked"
    ]
    assert denied and denied[0].result == "denied"
    assert denied[0].target_id == task.id
    assert "SKU-1" not in _skus()


class _SlowExecutor:
    """占住执行槽位直到放行，用于并发互斥测试。"""

    def __init__(self) -> None:
        self.started = threading.Event()
        self.release = threading.Event()

    def run_step(self, task, step):
        self.started.set()
        assert self.release.wait(10), "执行器未被放行"
        return {"ok": True}


def _make_engine_for(session, executor):
    audit = AuditService(session)
    return TaskEngine(
        session=session,
        executor=executor,
        audit=audit,
        approvals=ApprovalService(session, audit),
    )


def test_second_run_while_executing_is_rejected(tmp_path, settings):
    # 引擎按请求装配，互斥必须落在进程级 task 锁上
    from sqlalchemy.orm import sessionmaker

    db_engine = make_engine(f"sqlite:///{tmp_path / 'lock.db'}")
    init_db(db_engine)
    factory = sessionmaker(bind=db_engine, expire_on_commit=False)

    with factory() as seed_session:
        seed_engine = _make_engine_for(seed_session, _SlowExecutor())
        task = seed_engine.create_task(
            user_id="u1", type="research", title="慢任务", steps=[READ_STEP]
        )
        seed_engine.submit(task)
        seed_session.commit()
        task_id = task.id

    slow = _SlowExecutor()
    outcome: dict[str, str] = {}

    def worker() -> None:
        with factory() as worker_session:
            worker_engine = _make_engine_for(worker_session, slow)
            running_task = worker_session.get(Task, task_id)
            worker_engine.run(running_task)
            worker_session.commit()
            outcome["worker"] = "ran"

    thread = threading.Thread(target=worker)
    thread.start()
    assert slow.started.wait(5), "首次执行未启动"
    try:
        with factory() as rival_session:
            rival_engine = _make_engine_for(rival_session, _SlowExecutor())
            rival_task = rival_session.get(Task, task_id)
            with pytest.raises(TaskStateError, match="正在执行"):
                rival_engine.run(rival_task)
            with pytest.raises(TaskStateError, match="正在执行"):
                rival_engine.retry_failed(rival_task)
    finally:
        slow.release.set()
        thread.join(10)

    assert outcome.get("worker") == "ran"
    with factory() as check_session:
        assert check_session.get(Task, task_id).status == "succeeded"
