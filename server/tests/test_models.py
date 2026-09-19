from ecos.models import Approval, ConnectorInstance, Task, TaskStep


def test_id_prefixes_and_defaults(session):
    inst = ConnectorInstance(user_id="u1", kind="demo-shop")
    task = Task(user_id="u1", type="publish", title="上架新品")
    session.add_all([inst, task])
    session.flush()
    step = TaskStep(task=task, seq=1, name="create_product")
    appr = Approval(task_id=task.id)
    session.add_all([step, appr])
    session.flush()

    assert inst.id.startswith("con_")
    assert task.id.startswith("task_")
    assert step.id.startswith("step_")
    assert appr.id.startswith("appv_")
    assert inst.status == "active"
    assert task.status == "created"
    assert step.status == "pending"
    assert step.attempt == 0
    assert step.requires_approval is False
    assert task.payload == {}
    assert appr.status == "pending"


def test_task_steps_relationship_orders_by_seq(session):
    task = Task(user_id="u1", type="publish", title="t")
    session.add(task)
    session.flush()
    session.add_all(
        [
            TaskStep(task=task, seq=2, name="b"),
            TaskStep(task=task, seq=1, name="a"),
        ],
    )
    session.flush()
    session.refresh(task)
    assert [s.name for s in task.steps] == ["a", "b"]
