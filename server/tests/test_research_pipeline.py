"""规则层：候选数值全部可溯源、单源孤证降权、partial/failed 状态、打分透明。"""

import time

import pytest
from sqlalchemy import select

from ecos.config import Settings
from ecos.db import init_db, make_engine, make_session_factory
from ecos.models import ResearchCandidate, ResearchRun, ResearchStep
from ecos.research.pipeline import (
    cross_and_score,
    execute_rule_pipeline,
    is_category_relevant,
    normalize_keyword,
    parse_traffic,
)
from tests.helpers_research import FakeSource, sig


@pytest.fixture()
def factory():
    engine = make_engine("sqlite://")
    init_db(engine)
    yield make_session_factory(engine)
    engine.dispose()


def _sources():
    return [
        FakeSource("s_a", "shelf", [
            sig("s_a", "京东", "手机支架", "rank", 1),
            sig("s_a", "京东", "手机支架", "price_band", 39.9),
            sig("s_a", "京东", "磁吸快充", "rank", 2),
        ]),
        FakeSource("s_b", "content", [
            sig("s_b", "抖音", "手机支架", "heat", 900),
            sig("s_b", "抖音", "防晒冰袖", "heat", 700),
        ]),
        FakeSource("s_c", "crossborder", [], fail="blocked"),
    ]


def test_normalize_keyword():
    assert normalize_keyword(" 磁吸 手机支架 ") == "磁吸手机支架"


def test_is_category_relevant():
    assert is_category_relevant("磁吸手机支架爆款", "手机支架")   # 包含
    assert is_category_relevant("磁吸支架", "手机支架")           # 共享 2 字子串
    assert not is_category_relevant("沙特首都利雅得遭空袭", "手机支架")  # 热搜噪声
    assert not is_category_relevant("防晒冰袖", "手机支架")
    assert not is_category_relevant("", "手机支架")


def test_parse_traffic_bilingual():
    assert parse_traffic("100K+") == pytest.approx(100000)
    assert parse_traffic("1.2M+") == pytest.approx(1200000)
    assert parse_traffic("2万+") == pytest.approx(20000)
    assert parse_traffic("garbage") == 0.0


def test_cross_and_score_multi_source_beats_single():
    pool = (
        [sig("s_a", "京东", "手机支架", "rank", 1), sig("s_a", "京东", "手机支架", "price_band", 39.9),
         sig("s_b", "抖音", "手机支架", "heat", 900)]
        + [sig("s_b", "抖音", "防晒冰袖", "heat", 700)]
    )
    rows = cross_and_score(pool, {"s_a", "s_b"})
    by_name = {r["name"]: r for r in rows}
    assert by_name["手机支架"]["score"] > by_name["防晒冰袖"]["score"]
    assert len(by_name["手机支架"]["evidence"]) == 3
    assert by_name["手机支架"]["heat"] == by_name["手机支架"]["score_basis"]["heat_scaled"]
    assert by_name["防晒冰袖"]["score_basis"]["penalty"] == 0.6
    assert by_name["手机支架"]["heat"] > by_name["防晒冰袖"]["heat"]


def test_execute_rule_pipeline_persists(factory):
    settings = Settings(database_url="sqlite://")
    run_id = execute_rule_pipeline(
        factory, settings, _sources(),
        user_id="u1", category="手机支架", boards=["shelf", "content", "crossborder"],
        deadline=time.monotonic() + 60,
    )
    with factory() as s:
        run = s.get(ResearchRun, run_id)
        steps = s.execute(
            select(ResearchStep)
            .where(ResearchStep.run_id == run_id)
            .order_by(ResearchStep.seq)
        ).scalars().all()
        cands = s.execute(
            select(ResearchCandidate).where(ResearchCandidate.run_id == run_id)
        ).scalars().all()
        assert run.status == "partial"  # s_c blocked → 覆盖 2/3
        assert run.signal_count == 3  # 相关性门留「手机支架」3 信号（磁吸快充/防晒冰袖被过滤）
        kinds = [st.kind for st in steps]
        assert kinds[0] == "plan" and kinds[-2:] == ["cross", "synthesize"]
        failed = [st for st in steps if st.status == "failed"]
        assert len(failed) == 1 and failed[0].error.startswith("blocked")
        assert cands and all(c.evidence for c in cands)  # 无证据不出候选
        assert max(c.rank for c in cands) == len(cands)


def test_execute_all_failed_marks_run_failed(factory):
    settings = Settings(database_url="sqlite://")
    run_id = execute_rule_pipeline(
        factory, settings,
        [FakeSource("s_x", "shelf", fail="timeout"), FakeSource("s_y", "content", fail="blocked")],
        user_id="u1", category="手机支架", boards=["shelf", "content"],
        deadline=time.monotonic() + 60,
    )
    with factory() as s:
        run = s.get(ResearchRun, run_id)
        assert run.status == "failed" and "无可用信号" in (run.error or "")


def test_budget_skips_remaining_fetches(factory):
    settings = Settings(database_url="sqlite://")
    run_id = execute_rule_pipeline(
        factory, settings, _sources(),
        user_id="u1", category="手机支架", boards=["shelf", "content", "crossborder"],
        deadline=time.monotonic() - 1,  # 预算已尽
    )
    with factory() as s:
        steps = s.execute(
            select(ResearchStep).where(ResearchStep.run_id == run_id)
        ).scalars().all()
        fetches = [st for st in steps if st.kind == "fetch"]
        assert all(st.status == "skipped" for st in fetches)
        assert len(fetches) == 3


def test_source_mutating_args_does_not_pollute_others(factory):
    """实机走查回归：jd_rank 在 fetch 内 setdefault("cat")，不得把 cat 漏给后位源或快照键。"""

    class PollutingSource(FakeSource):
        def fetch(self, args):
            args["cat"] = "9987,2131"  # 模仿 jd_rank 就地补默认参数
            return [sig(self.id, "京东", "手机支架", "price_band", 39.9)]

    class ContractSource(FakeSource):
        params = {"category": {"type": "string"}}
        required = ("category",)

        def fetch(self, args):
            errs = self.arg_errors(args)
            if errs:
                raise ValueError(";".join(errs))
            return [sig(self.id, "抖音", "手机支架", "heat", 88)]

    settings = Settings(database_url="sqlite://")
    run_id = execute_rule_pipeline(
        factory, settings,
        [PollutingSource("s_pol", "shelf", []), ContractSource("s_ct", "content", [])],
        user_id="u1", category="手机支架", boards=["shelf", "content"],
        deadline=time.monotonic() + 60,
    )
    with factory() as s:
        steps = s.execute(
            select(ResearchStep).where(ResearchStep.run_id == run_id)
        ).scalars().all()
        fetches = {st.source_id: st for st in steps if st.kind == "fetch"}
        assert fetches["s_pol"].status == "ok" and fetches["s_ct"].status == "ok"
        assert s.get(ResearchRun, run_id).status == "succeeded"
