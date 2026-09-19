"""研究子域四表：建表、租户列、run/step/candidate 级联写入冒烟。"""

from ecos.models import (
    ResearchCandidate,
    ResearchRun,
    ResearchStep,
    SourceSnapshot,
    utcnow,
)


def test_research_tables_roundtrip(session):
    run = ResearchRun(user_id="u1", category="手机饰品", boards=["shelf", "content"])
    session.add(run)
    session.flush()
    assert run.id.startswith("rsr_") and run.status == "running" and run.mode == "rule"
    step = ResearchStep(
        run_id=run.id, seq=1, kind="fetch", source_id="douyin_hot",
        args_digest="d" * 12, summary="12 信号", status="ok", seconds=1.2,
    )
    cand = ResearchCandidate(
        run_id=run.id, rank=1, name="磁吸支架", platform="抖音",
        board="content", evidence=[{"source_id": "douyin_hot", "url": "u"}],
    )
    snap = SourceSnapshot(
        source_id="douyin_hot", query_key="k" * 32, payload=[], expires_at=utcnow()
    )
    session.add_all([step, cand, snap])
    session.commit()
    assert session.get(ResearchRun, run.id).signal_count == 0
    assert session.query(ResearchStep).filter_by(run_id=run.id).count() == 1


def test_settings_research_defaults(settings):
    assert settings.research_enabled is True
    assert settings.research_source_ttl == 21600
    assert settings.research_run_budget == 120
    assert settings.research_source_timeout == 10
    assert settings.research_proxy_url == ""
    assert settings.research_disabled_sources == ""
