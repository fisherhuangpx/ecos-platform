from sqlalchemy import inspect, text
from sqlalchemy.orm import sessionmaker

EXPECTED_TABLES = {
    "connector_instances",
    "tasks",
    "task_steps",
    "approvals",
    "audit_logs",
}


def test_init_db_creates_shared_tables(engine):
    assert EXPECTED_TABLES <= set(inspect(engine).get_table_names())


def test_in_memory_engine_shares_state_across_sessions(engine):
    factory = sessionmaker(bind=engine)
    with factory() as s1:
        s1.execute(
            text(
                "INSERT INTO audit_logs "
                "(id, at, user_id, actor, action, target_type, target_id, "
                " level, result) "
                "VALUES ('aud_probe', '2026-01-01', 'u', 'system', 'probe', "
                "'x', 'y', 'system', 'ok')"
            ),
        )
        s1.commit()
    with factory() as s2:
        count = s2.execute(text("SELECT COUNT(*) FROM audit_logs")).scalar()
    assert count == 1
