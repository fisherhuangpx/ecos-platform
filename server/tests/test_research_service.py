"""Service：缓存命中不重抓、后台线程落库、同品类并发复用、审计两条、源健康。"""

import threading

import pytest

from ecos.config import Settings
from ecos.db import init_db, make_engine, make_session_factory
from ecos.errors import NotFoundError
from ecos.research.service import ResearchService
from ecos.tasks.audit import AuditService
from tests.helpers_research import FakeSource, sig


def _svc(sources, settings=None, runner=None):
    engine = make_engine("sqlite://")
    init_db(engine)
    factory = make_session_factory(engine)
    audit = AuditService(factory())
    kwargs = {"runner": runner} if runner is not None else {}
    return ResearchService(
        settings or Settings(database_url="sqlite://"), factory, sources, audit, **kwargs
    )


def _good():
    return FakeSource("s_a", "shelf", [sig("s_a", "京东", "手机支架", "heat", 5)])


def test_create_and_run_now_with_audit_and_persistence():
    svc = _svc([_good()])
    run_id, cached = svc.create("u1", "手机支架", None)
    assert not cached
    svc.run_now(run_id)  # blocking 路径
    run = svc.get_run("u1", run_id)
    assert run["status"] == "succeeded" and run["signal_count"] == 1
    assert run["candidates"] and run["candidates"][0]["evidence"]
    with svc.factory() as s:
        actions = [a.action for a in AuditService(s).list(limit=50)]
        assert "research.create" in actions and "research.finish" in actions


def test_create_validates_category_and_switch():
    svc = _svc([_good()])
    with pytest.raises(ValueError):
        svc.create("u1", "  ", None)
    off = _svc([_good()], settings=Settings(database_url="sqlite://", research_enabled=False))
    with pytest.raises(ValueError):
        off.create("u1", "手机支架", None)


def test_same_category_reuses_running_run():
    svc = _svc([_good()])
    r1, _ = svc.create("u1", "手机支架", None)
    r2, reused = svc.create("u1", "手机支架", None)
    assert r2 == r1 and reused is True  # 第一条还在 running 或刚完成即缓存


def test_finished_recent_run_serves_cached():
    svc = _svc([_good()])
    r1, _ = svc.create("u1", "手机支架", None)
    svc.run_now(r1)
    r2, cached = svc.create("u1", "手机支架", None)
    assert r2 == r1 and cached


def test_cross_user_run_invisible():
    svc = _svc([_good()])
    r1, _ = svc.create("u1", "手机支架", None)
    with pytest.raises(NotFoundError):  # 路由映射 404，不泄漏存在性
        svc.get_run("u2", r1)
    assert svc.list_runs("u2") == []


def test_sources_health_lists_tiers_and_credentials():
    from ecos.research.sources import default_sources

    svc = _svc(default_sources())
    rows = svc.sources_health("u1")
    assert len(rows) == 9
    assert all(r["capabilities"]["input_schema"]["type"] == "object" for r in rows)
    assert any(r["health"] == "awaiting_credentials" for r in rows)
    assert any(r["health"] == "online" for r in rows)


def test_background_thread_completes():
    # join 替代轮询：内存 sqlite 用 StaticPool，后台写库期间主线程并发读同一连接偶发互斥
    threads: list[threading.Thread] = []

    def runner(fn):
        t = threading.Thread(target=fn)
        threads.append(t)
        t.start()

    svc = _svc([_good()], runner=runner)  # create 已排后台线程
    r1, _ = svc.create("u1", "手机支架", None)
    for t in threads:
        t.join(10)
    assert svc.get_run("u1", r1)["status"] == "succeeded"


def test_list_runs_summarizes_for_owner():
    svc = _svc([_good()])
    r1, _ = svc.create("u1", "手机支架", None)
    svc.run_now(r1)
    rows = svc.list_runs("u1")
    assert any(r["id"] == r1 and r["status"] == "succeeded" for r in rows)
