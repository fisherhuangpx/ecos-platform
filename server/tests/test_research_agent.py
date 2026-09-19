"""agent 层：脚本化模型驱动工具循环；叙述不得带证据外数字；候选数值不被模型改动。"""

import json

import pytest
from agentscope.message import TextBlock, ToolCallBlock
from sqlalchemy import select

from ecos.agent.runtime import scripted_model
from ecos.config import Settings
from ecos.db import init_db, make_engine, make_session_factory
from ecos.models.research import ResearchCandidate, ResearchRun, ResearchStep
from ecos.research.agent import run_rule_then_agent, validate_narrative
from tests.helpers_research import FakeSource, sig


def test_validate_narrative_strips_unsourced_numbers():
    keep, cut = validate_narrative(
        "月销约 500 件，抖音热度 900。编造的转化率 37% 必须裁掉。", {"500", "900"}
    )
    assert "500" in keep and "900" in keep and "37%" not in keep
    assert cut and "37%" in cut[0]


def test_validate_narrative_keeps_numberless_sentences():
    keep, cut = validate_narrative("建议优先磁吸款。还有别的。", set())
    assert "磁吸" in keep and not cut


@pytest.fixture()
def env():
    engine = make_engine("sqlite://")
    init_db(engine)
    return Settings(database_url="sqlite://"), make_session_factory(engine)


def _seed(factory, run_id="rsr_test", evidence=True):
    with factory() as s:
        s.add(
            ResearchRun(
                id=run_id, user_id="u1", category="手机支架", mode="agent", signal_count=2
            )
        )
        s.add(
            ResearchCandidate(
                run_id=run_id,
                rank=1,
                name="手机支架",
                heat=61,
                score=0.44,
                evidence=(
                    [
                        {
                            "source_id": "s_a",
                            "metric": "heat",
                            "value": 500.0,
                            "url": "https://example.com/s_a",
                            "captured_at": "2026-09-19T00:00:00",
                        }
                    ]
                    if evidence
                    else []
                ),
            )
        )
        s.commit()


def _sources():
    return [
        FakeSource("s_a", "shelf", [sig("s_a", "京东", "手机支架", "heat", 500)]),
        FakeSource("s_b", "content", [sig("s_b", "抖音", "手机支架", "heat", 900)]),
    ]


def test_model_none_keeps_rule_result(env):
    settings, factory = env
    _seed(factory)
    run_rule_then_agent(
        settings, factory, _sources(),
        user_id="u1", run_id="rsr_test", category="手机支架", model=None,
    )
    with factory() as s:
        assert s.get(ResearchRun, "rsr_test").narrative is None


def test_agent_writes_narrative_without_touching_numbers(env):
    settings, factory = env
    _seed(factory)
    model = scripted_model(
        [[TextBlock(text="该品类京东信号 500。编造的转化率 37% 必须裁掉。")]]
    )
    run_rule_then_agent(
        settings, factory, _sources(),
        user_id="u1", run_id="rsr_test", category="手机支架", model=model,
    )
    with factory() as s:
        run = s.get(ResearchRun, "rsr_test")
        assert run.narrative and "500" in run.narrative and "37%" not in run.narrative
        cand = s.execute(select(ResearchCandidate)).scalars().one()
        assert cand.heat == 61  # 模型不得改候选数值


def test_agent_extra_fetch_records_steps(env):
    settings, factory = env
    _seed(factory, run_id="rsr_x2", evidence=False)
    model = scripted_model(
        [
            [
                ToolCallBlock(
                    id="c1",
                    name="fetch_source",
                    input=json.dumps({"source_id": "s_a", "category": "手机支架"}),
                )
            ],
            [
                ToolCallBlock(
                    id="c2",
                    name="finish",
                    input=json.dumps({"narrative": "京东侧 500 热度确认。"}),
                )
            ],
        ]
    )
    run_rule_then_agent(
        settings, factory, _sources(),
        user_id="u1", run_id="rsr_x2", category="手机支架", model=model,
    )
    with factory() as s:
        steps = s.execute(
            select(ResearchStep)
            .where(ResearchStep.run_id == "rsr_x2")
            .order_by(ResearchStep.seq)
        ).scalars().all()
        agent_steps = [st for st in steps if st.kind == "agent"]
        assert [st.summary for st in agent_steps][:2] == ["call:fetch_source", "call:finish"]
        run = s.get(ResearchRun, "rsr_x2")
        assert run.narrative and "500" in run.narrative


def test_agent_unsourced_finish_is_cleaned_to_empty(env):
    settings, factory = env
    _seed(factory, run_id="rsr_x3", evidence=False)
    model = scripted_model(
        [
            [
                ToolCallBlock(
                    id="c1",
                    name="finish",
                    input=json.dumps({"narrative": "纯编造的转化率 88%，裁掉。"}),
                )
            ],
        ]
    )
    run_rule_then_agent(
        settings, factory, _sources(),
        user_id="u1", run_id="rsr_x3", category="手机支架", model=model,
    )
    with factory() as s:
        assert not s.get(ResearchRun, "rsr_x3").narrative  # 造数不可入叙述


def test_agent_error_keeps_rule_results(env):
    settings, factory = env
    _seed(factory, run_id="rsr_x4")

    class Boom:  # 模型直接爆炸也要保住规则层结果
        pass

    import ecos.research.agent as agent_mod

    orig = agent_mod.build_agent
    agent_mod.build_agent = lambda **kw: (_ for _ in ()).throw(RuntimeError("模型初始化失败"))
    try:
        run_rule_then_agent(
            settings, factory, _sources(),
            user_id="u1", run_id="rsr_x4", category="手机支架", model=Boom(),
        )
    finally:
        agent_mod.build_agent = orig
    with factory() as s:
        run = s.get(ResearchRun, "rsr_x4")
        assert run.narrative is None
        steps = s.execute(
            select(ResearchStep).where(ResearchStep.run_id == "rsr_x4", ResearchStep.kind == "agent")
        ).scalars().all()
        assert any(st.status == "failed" for st in steps)
