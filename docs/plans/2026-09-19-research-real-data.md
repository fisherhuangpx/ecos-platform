# 选品调研真实化 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把选品调研从「哈希查表 / LLM 凭记忆编数」升级为「公开数据源真实抓取 + 可回看步骤 + 证据链候选」的任务化子系统，并让 Research 页换底真实轮询。

**Architecture:** 新建 `ecos/research/` 子域：统一 `ResearchSource` 源抽象（live 公开源 / official / licensed 壳），`ResearchRun/Step/Candidate/SourceSnapshot` 四表落库，双层流水线（规则聚合层无 LLM 出真数，agent 层只做编排与叙述且不得造数），REST 挂 `/api/research`，前端轮询 run 详情。TaskEngine/审批红线区零改动。

**Tech Stack:** FastAPI + SQLAlchemy 2.0 + httpx（已在依赖）+ AgentScope 2.x `build_agent`/`ScriptedChatModel`；前端 Vite6+React18+TS strict。

**Spec:** `docs/specs/2026-09-19-research-real-data-design.md`（随本计划一起读）

## Global Constraints

- **禁止 git commit/push**（用户红线：先不提交）。每个任务收尾**只跑回归**，不建分支不提交。
- 回归基线只增不减：后端 `pytest -q` ≥ **186 passed**；前端 vitest ≥ **24 passed**、`tsc --noEmit` 零错、`vite build` 通过。
- 后端命令一律在 `server/` 下：`PYTHONUTF8=1 .venv/Scripts/python -m pytest -q`（win + Git Bash）。
- 红线：研究是**纯读操作**，不进审批闸门；不得新增任何外部平台写调用。**跨租户统一 404**。权限沿用 `research.run`（admin/operator 持有），不新增权限码。
- 合规红线：live 源只碰完全公开页面/接口；UA 明示、限频 `min_interval_seconds≥2`、禁登录态强爬；单源失败只降级不抛穿。
- **模型不改数字**：候选表数值永远来自规则层；agent 只增 `narrative`，叙述中的数字必须能在证据里找到，否则裁句。
- `@pytest.mark.external`（真网冒烟）默认被 `-m "not external"` 过滤，永不进基线。
- 测试时区口径：全库朴素 UTC（`models/base.utcnow`），时间显示前端 `fmtTime` 负责。

## 文件结构（全量）

```
server/
  ecosystem 无关，全部在 ecos/ 下：
  + ecos/research/__init__.py          子域包
  + ecos/research/base.py              Signal/FetchError/ResearchSource/make_signal
  + ecos/research/scraper.py           ScraperSource（httpx+限频+blocked/timeout/layout 分类）
  + ecos/research/snapshot.py          SourceSnapshot TTL 缓存读写
  + ecos/research/sources/__init__.py  default_sources() 注册表
  + ecos/research/sources/douyin_hot.py / google_trends.py / amazon_bestsellers.py
  + ecos/research/sources/jd_rank.py / ali1688_hot.py / baidu_index.py / juliang_trend.py
  + ecos/research/sources/shells.py    VaultApiSource + taobao_open + chanmama
  + ecos/research/pipeline.py          规则层（plan/fetch/cross/synthesize+打分+证据）
  + ecos/research/agent.py             agent 层（ReAct + 叙述数字校验）
  + ecos/research/service.py           ResearchService（submit/线程/blocking/缓存命中/源健康）
  + ecos/models/research.py            四张表
  ~ ecos/models/__init__.py            注册导出
  ~ ecos/config.py                     ECOS_RESEARCH_* 字段
  ~ ecos/api/research.py               REST 四端点
  ~ ecos/api/deps.py                   Services.research
  ~ ecos/main.py                       app.state.research_sources + include_router
  ~ ecos/api/serializers.py            run/step/candidate/source_out
  ~ ecos/ai/adapter.py                 删除 LiveAdapter.research_report 与 Protocol 声明
  ~ ecos/api/ai.py                     /api/ai/research 固定走 Simulated（演示基线注释）
  ~ pyproject.toml                     markers + addopts
  + scripts/research_probe.py          external 冒烟：录真 fixture
  + tests/helpers_research.py          FakeSource/信号工厂
  + tests/fixtures/research/*.json|html 每源一份代表结构
  + tests/test_research_base.py / test_research_sources.py / test_research_pipeline.py
  + tests/test_research_agent.py / test_research_api.py
console/
  + src/api/research.ts                run/step/candidate 类型 + 纯函数 reducer
  + src/api/research.test.ts           reducer/证据格式化单测
  ~ src/pages/Research.tsx             换底：真提交+1.5s 轮询+步骤时间线+证据弹层+源横幅
  ~ src/pages/Overview.tsx             「最新动态」首条读最近真实 run（无 run 保持现文案）
```

---

### Task 1: 配置与四张 ORM 表

**Files:**
- Modify: `server/ecos/config.py`（Settings 类尾部追加字段）
- Create: `server/ecos/models/research.py`
- Modify: `server/ecos/models/__init__.py`
- Test: `server/tests/test_research_models.py`（新建）

**Interfaces:**
- Produces: `ResearchRun(id,user_id,category,boards,status,mode,signal_count,error,narrative,tokens_in,tokens_out,created_at,started_at,finished_at)`、`ResearchStep(id,run_id,seq,kind,source_id,args_digest,summary,status,seconds,error)`、`ResearchCandidate(id,run_id,rank,name,platform,board,price,sales_signal,heat,keywords,score,score_basis,evidence)`、`SourceSnapshot(id,source_id,query_key,payload,captured_at,expires_at)`；`Settings.research_*` 六字段。

- [ ] **Step 1: 写失败测试**

`server/tests/test_research_models.py`:

```python
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
    step = ResearchStep(run_id=run.id, seq=1, kind="fetch", source_id="douyin_hot",
                        args_digest="d" * 12, summary="12 信号", status="ok", seconds=1.2)
    cand = ResearchCandidate(run_id=run.id, rank=1, name="磁吸支架", platform="抖音",
                             board="content", evidence=[{"source_id": "douyin_hot", "url": "u"}])
    snap = SourceSnapshot(source_id="douyin_hot", query_key="k" * 32, payload=[],
                          expires_at=utcnow())
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd server && PYTHONUTF8=1 .venv/Scripts/python -m pytest tests/test_research_models.py -q`
Expected: FAIL（ImportError: cannot import name 'ResearchRun'）

- [ ] **Step 3: 实现**

`server/ecos/models/research.py`:

```python
"""研究子域 ORM：调研运行 / 步骤 / 候选 / 源快照缓存。"""

from datetime import datetime

from sqlalchemy import DateTime, Float, JSON, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin, new_id


class ResearchRun(Base, TimestampMixin):
    __tablename__ = "research_runs"

    id: Mapped[str] = mapped_column(primary_key=True, default=lambda: new_id("rsr"))
    user_id: Mapped[str] = mapped_column(index=True)
    category: Mapped[str]
    boards: Mapped[list] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(default="running")  # running|succeeded|partial|failed
    mode: Mapped[str] = mapped_column(default="rule")  # rule|agent
    signal_count: Mapped[int] = mapped_column(default=0)
    error: Mapped[str | None] = mapped_column(default=None)
    narrative: Mapped[str | None] = mapped_column(default=None)
    tokens_in: Mapped[int] = mapped_column(default=0)
    tokens_out: Mapped[int] = mapped_column(default=0)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, default=None)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, default=None)


class ResearchStep(Base, TimestampMixin):
    __tablename__ = "research_steps"

    id: Mapped[str] = mapped_column(primary_key=True, default=lambda: new_id("rst"))
    run_id: Mapped[str] = mapped_column(index=True)
    seq: Mapped[int]
    kind: Mapped[str]  # plan|fetch|cross|synthesize
    source_id: Mapped[str] = mapped_column(default="")
    args_digest: Mapped[str] = mapped_column(default="")
    summary: Mapped[str] = mapped_column(default="")
    status: Mapped[str] = mapped_column(default="ok")  # ok|failed|skipped
    seconds: Mapped[float] = mapped_column(Float, default=0.0)
    error: Mapped[str | None] = mapped_column(default=None)


class ResearchCandidate(Base, TimestampMixin):
    __tablename__ = "research_candidates"

    id: Mapped[str] = mapped_column(primary_key=True, default=lambda: new_id("rcd"))
    run_id: Mapped[str] = mapped_column(index=True)
    rank: Mapped[int]
    name: Mapped[str]
    platform: Mapped[str] = mapped_column(default="")
    board: Mapped[str] = mapped_column(default="")
    price: Mapped[str] = mapped_column(default="")
    sales_signal: Mapped[str] = mapped_column(default="")
    heat: Mapped[int] = mapped_column(default=0)
    keywords: Mapped[list] = mapped_column(JSON, default=list)
    score: Mapped[float] = mapped_column(Float, default=0.0)
    score_basis: Mapped[dict] = mapped_column(JSON, default=dict)
    evidence: Mapped[list] = mapped_column(JSON, default=list)


class SourceSnapshot(Base, TimestampMixin):
    __tablename__ = "research_snapshots"
    __table_args__ = (UniqueConstraint("source_id", "query_key", name="uq_snapshot_key"),)

    id: Mapped[str] = mapped_column(primary_key=True, default=lambda: new_id("rsc"))
    source_id: Mapped[str] = mapped_column(index=True)
    query_key: Mapped[str]
    payload: Mapped[list] = mapped_column(JSON, default=list)
    captured_at: Mapped[datetime]
    expires_at: Mapped[datetime]
```

`models/__init__.py` 追加（导入块按字母序插在 connector 之后）：

```python
from .research import (
    ResearchCandidate,
    ResearchRun,
    ResearchStep,
    SourceSnapshot,
)
```

并把四个类名加进 `__all__`。`config.py` 在 `cors_origins` 之前追加：

```python
    # 选品调研（research 子域）
    research_enabled: bool = True
    research_source_ttl: int = 21600          # 快照缓存秒数（默认 6h）
    research_run_budget: int = 120            # 单次 run 网络预算（秒）
    research_source_timeout: int = 10         # 单源请求超时（秒）
    research_proxy_url: str = ""              # 跨境源出境代理（空=跨境源不可达降级）
    research_disabled_sources: str = ""       # 逗号分隔源 id，应急拉闸
```

- [ ] **Step 4: 跑测试确认通过 + 全量回归**

Run: `cd server && PYTHONUTF8=1 .venv/Scripts/python -m pytest -q`
Expected: 24 号新用例 PASS，全量 ≥ 188 passed（186 基线 + 本任务 2）

- [ ] **Step 5: 检查点（不提交）**

`git status --short` 仅确认改动范围在预期文件内；**不 commit**。

---

### Task 2: 源抽象基座（base.py）

**Files:**
- Create: `server/ecos/research/__init__.py`（空文件 + 包注释）
- Create: `server/ecos/research/base.py`
- Test: `server/tests/test_research_base.py`

**Interfaces:**
- Consumes: `models/base.utcnow/new_id`
- Produces: `Signal`（TypedDict）、`FetchError(kind, message)`、`make_signal(source_id,platform,keyword,metric,value,window,url)->Signal`、`ResearchSource`（ABC：类属性 `id/name/board/tier/ttl_seconds=21600/auth="none"/min_interval_seconds=2.0/description`，方法 `arg_errors(args)->list[str]`、`input_schema()->dict`、`capabilities()->dict`、抽象 `fetch(args)->list[Signal]`）；常量 `METRICS = ("heat","trend","rank","sales_proxy","price_band")`、`BOARDS = ("shelf","content","crossborder")`、`TIERS = ("live","official","licensed")`。

- [ ] **Step 1: 写失败测试**

`server/tests/test_research_base.py`:

```python
"""源抽象契约：arg_errors 与 ToolDecl 同构；capabilities 可 JSON 化；fetch 契约。"""

import json

import pytest

from ecos.research.base import FetchError, ResearchSource, make_signal


class EchoSource(ResearchSource):
    id = "echo"
    name = "回声源"
    board = "shelf"
    tier = "live"
    params = {"category": {"type": "string"}, "window": {"type": "string"}}
    required = ("category",)

    def fetch(self, args):
        return [make_signal(self.id, "京东", args["category"], "heat", 1.0, "7d", "https://e")]


def test_arg_errors_parity_with_tool_decl():
    src = EchoSource()
    assert src.arg_errors({"category": "支架"}) == []
    assert src.arg_errors({}) == ["缺少参数: category"]
    assert src.arg_errors({"category": "  "}) == ["参数不能为空: category"]
    assert src.arg_errors({"category": "x", "nope": 1}) == ["未声明参数: nope"]


def test_capabilities_json_safe_and_schema():
    caps = EchoSource().capabilities()
    assert json.loads(json.dumps(caps))["id"] == "echo"
    assert caps["input_schema"] == {
        "type": "object",
        "properties": {"category": {"type": "string"}, "window": {"type": "string"}},
        "required": ["category"],
    }


def test_make_signal_shape_and_metric_guard():
    sig = make_signal("echo", "京东", "支架", "heat", 12.5, "7d", "https://e")
    assert set(sig) == {"source_id", "platform", "keyword", "metric",
                        "value", "window", "url", "captured_at"}
    with pytest.raises(ValueError):
        make_signal("echo", "京东", "支架", "gmv", 1, "7d", "https://e")


def test_fetch_error_carries_kind():
    err = FetchError("blocked", "风控页")
    assert err.kind == "blocked" and "blocked" in str(err)
```

- [ ] **Step 2: 跑测试确认失败**（ImportError）

- [ ] **Step 3: 实现 `server/ecos/research/base.py`**

```python
"""源抽象：所有数据盘统一到 Signal；契约风格对齐 connectors.ToolDecl。"""

from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import datetime
from typing import Any, Mapping, TypedDict

from ..models.base import utcnow

METRICS = ("heat", "trend", "rank", "sales_proxy", "price_band")
BOARDS = ("shelf", "content", "crossborder")
TIERS = ("live", "official", "licensed")


class Signal(TypedDict):
    source_id: str
    platform: str
    keyword: str
    metric: str
    value: float
    window: str
    url: str
    captured_at: str


class FetchError(Exception):
    """取数失败分类：timeout|blocked|layout|empty|unconfigured|unreachable。"""

    def __init__(self, kind: str, message: str = "") -> None:
        super().__init__(f"{kind}: {message}" if message else kind)
        self.kind = kind


def make_signal(
    source_id: str, platform: str, keyword: str, metric: str,
    value: float, window: str, url: str,
) -> Signal:
    if metric not in METRICS:
        raise ValueError(f"非法信号指标: {metric}（可选 {METRICS}）")
    return {
        "source_id": source_id, "platform": platform, "keyword": keyword,
        "metric": metric, "value": float(value), "window": window, "url": url,
        "captured_at": utcnow().isoformat(timespec="seconds"),
    }


class ResearchSource(ABC):
    id: str = ""
    name: str = ""
    board: str = ""
    tier: str = "live"
    description: str = ""
    ttl_seconds: int = 21600
    auth: str = "none"  # "none" | "vault:<kind>"
    min_interval_seconds: float = 2.0
    params: Mapping[str, Any] = {}
    required: tuple[str, ...] = ()

    def arg_errors(self, args: Mapping[str, Any]) -> list[str]:
        provided = set(args)
        errors = [f"缺少参数: {n}" for n in self.required if n not in provided]
        errors += [f"未声明参数: {n}" for n in sorted(provided - set(self.params))]
        errors += [
            f"参数不能为空: {n}" for n in self.required
            if n in provided and (args[n] is None or (isinstance(args[n], str) and not args[n].strip()))
        ]
        return errors

    def input_schema(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": dict(self.params),
            "required": list(self.required),
        }

    def capabilities(self) -> dict[str, Any]:
        return {
            "id": self.id, "name": self.name, "board": self.board, "tier": self.tier,
            "description": self.description, "auth": self.auth,
            "input_schema": self.input_schema(),
        }

    @abstractmethod
    def fetch(self, args: dict[str, Any]) -> list[Signal]: ...
```

- [ ] **Step 4: 单测通过**（4 passed）

- [ ] **Step 5: 检查点**：全量 `pytest -q` 通过。

---

### Task 3: 抓取基座 + 快照缓存（scraper.py / snapshot.py）

**Files:**
- Create: `server/ecos/research/scraper.py`
- Create: `server/ecos/research/snapshot.py`
- Test: `server/tests/test_research_scraper.py`

**Interfaces:**
- Consumes: `base.ResearchSource/FetchError/Signal`、`models.research.SourceSnapshot`
- Produces: `ScraperSource`（子类只需：类属性 `url_template:str`（`{arg}` 模板）、`headers:dict`、`use_proxy:bool`、实现 `parse(text:str)->list[Signal]`；`fetch()` 已提供）；`fetch_http_text(url,*,timeout,proxy,headers)->str`（独立可 mock）；`query_key(source_id,args)->str`、`fresh_payload(session,source_id,args,ttl)->list[dict]|None`、`store_payload(session,source_id,args,payload)->None`。

- [ ] **Step 1: 写失败测试**

`server/tests/test_research_scraper.py`:

```python
"""抓取基座：blocked 判定、proxy 缺失降级、TTL 缓存命中/过期。"""

import pytest

from ecos.models.base import utcnow
from ecos.research.base import FetchError, Signal, make_signal
from ecos.research.scraper import ScraperSource, fetch_http_text
from ecos.research.snapshot import fresh_payload, query_key, store_payload

BLOCKED_PAGE = "<html>请输入验证码 captcha</html>"
OK_PAGE = "PLACEHOLDER"


class TinySource(ScraperSource):
    id = "tiny"
    name = "微型源"
    board = "shelf"
    url_template = "https://example.com/hot?cat={category}"
    params = {"category": {"type": "string"}}
    required = ("category",)

    def parse(self, text):
        if "支架" in text:
            return [make_signal(self.id, "京东", "手机支架", "heat", 9, "7d", "https://e")]
        return []


@pytest.fixture()
def patched_fetch(monkeypatch):
    calls = {"n": 0}

    def fake(url, *, timeout, proxy, headers):
        calls["n"] += 1
        fake.last = {"url": url, "proxy": proxy}
        return fake.body

    fake.body = OK_PAGE
    monkeypatch.setattr("ecos.research.scraper.fetch_http_text", fake)
    return calls


def test_fetch_validates_and_builds_url(patched_fetch, monkeypatch):
    monkeypatch.setattr(
        "ecos.research.scraper.fetch_http_text",
        lambda url, **kw: patched_fetch and kw.get("url") or "", raise_recent:=None or (lambda: None)(),
    ) if False else None
    src = TinySource()
    with pytest.raises(FetchError):
        src.fetch({})  # 参数缺失应直接拒绝（不触发网络）


def test_fetch_blocked_and_empty_classification(patched_fetch, monkeypatch):
    import ecos.research.scraper as scraper_mod
    # 绕过真实限频与 URL 构造，直接注入响应体
    monkeypatch.setattr(scraper_mod, "fetch_http_text", lambda url, **kw: BLOCKED_PAGE)
    src = TinySource()
    with pytest.raises(FetchError) as e:
        src.fetch({"category": "支架"})
    assert e.value.kind == "blocked"
    monkeypatch.setattr(scraper_mod, "fetch_http_text", lambda url, **kw: "无相关数据")
    with pytest.raises(FetchError) as e2:
        src.fetch({"category": "支架"})
    assert e2.value.kind == "empty"


def test_fetch_success_returns_signals(monkeypatch):
    import ecos.research.scraper as scraper_mod
    monkeypatch.setattr(scraper_mod, "fetch_http_text", lambda url, **kw: "支架热销")
    signals = TinySource().fetch({"category": "支架"})
    assert signals[0]["metric"] == "heat"


def test_proxy_required_but_missing_is_unreachable(monkeypatch):
    import ecos.research.scraper as scraper_mod
    monkeypatch.setattr(scraper_mod, "fetch_http_text", lambda url, **kw: "")
    src = TinySource()
    src.use_proxy = True
    src.proxy_url = ""
    with pytest.raises(FetchError) as e:
        src.fetch({"category": "x"})
    assert e.value.kind == "unreachable"


def test_snapshot_ttl(session):
    args = {"category": "支架"}
    payload = [make_signal("tiny", "京东", "手机支架", "heat", 9, "7d", "https://e")]
    assert fresh_payload(session, "tiny", args, ttl=600) is None
    store_payload(session, "tiny", args, payload)
    session.commit()
    assert query_key("tiny", args) == query_key("tiny", dict(args))
    got = fresh_payload(session, "tiny", args, ttl=600)
    assert got and got[0]["keyword"] == "手机支架"
    assert fresh_payload(session, "tiny", args, ttl=-1) is None  # 过期
```

注：上面 `test_fetch_validates_and_builds_url` 的第一行是笔误残留，实施时删除该行写法，任务代码以此为准：

```python
def test_fetch_validates_and_builds_url(patched_fetch):
    src = TinySource()
    with pytest.raises(FetchError) as e:
        src.fetch({})
    assert e.value.kind == "layout"  # 契约校验失败视为不可执行 → 用 arg 错误直接抛
```

——实施时改为专用 kind：`arg_errors` 非空 → `raise FetchError("layout", ";".join(errs))` 不必要；正确做法是 `fetch` 前置校验失败抛 `ValueError`。**最终契约（测试以此为准）**：

```python
def test_fetch_rejects_invalid_args():
    with pytest.raises(ValueError):
        TinySource().fetch({})
```

- [ ] **Step 2: 跑测试确认失败**（ImportError）

- [ ] **Step 3: 实现**

`server/ecos/research/scraper.py`:

```python
"""公开页面抓取基座：声明式 url + 纯函数 parse；失败分类只记不抛穿。"""

from __future__ import annotations

import hashlib
import time
from typing import Any, Callable

import httpx

from .base import FetchError, ResearchSource, Signal

BLOCK_MARKERS = ("验证码", "captcha", "安全验证", "access denied", "滑动验证")

_last_hit: dict[str, float] = {}


def fetch_http_text(
    url: str, *, timeout: float, proxy: str | None, headers: dict[str, str]
) -> str:
    with httpx.Client(
        timeout=timeout, proxy=proxy or None, headers=headers, follow_redirects=True
    ) as client:
        resp = client.get(url)
        resp.raise_for_status()
        return resp.text


class ScraperSource(ResearchSource):
    """子类契约：url_template（format 模板）、headers、use_proxy、parse()。"""

    url_template: str = ""
    headers: dict[str, str] = {
        "User-Agent": "ECOSResearchBot/0.1 (internal tool; contact: ops@example.com)"
    }
    use_proxy: bool = False
    proxy_url: str = ""

    def fetch(self, args: dict[str, Any]) -> list[Signal]:
        errs = self.arg_errors(args)
        if errs:
            raise ValueError(";".join(errs))
        if self.use_proxy and not self.proxy_url:
            raise FetchError("unreachable", f"源 {self.id} 需出境代理但未配置")
        url = self.url_template.format(**args)
        text = self._rate_limited_get(url)
        low = text.lower()
        if not text.strip() or any(m in low for m in BLOCK_MARKERS):
            raise FetchError("blocked", f"源 {self.id} 返回疑似风控页")
        signals = self.parse(text)
        if not signals:
            raise FetchError("layout", f"源 {self.id} 结构未命中（改版或品类无数据）")
        return signals

    def _rate_limited_get(self, url: str) -> str:
        now = time.monotonic()
        gap = now - _last_hit.get(self.id, 0.0)
        if gap < self.min_interval_seconds:
            time.sleep(self.min_interval_seconds - gap)
        _last_hit[self.id] = time.monotonic()
        try:
            return fetch_http_text(
                url, timeout=self.http_timeout, proxy=self.proxy_url, headers=self.headers
            )
        except FetchError:
            raise
        except httpx.TimeoutException as exc:
            raise FetchError("timeout", str(exc)) from exc
        except httpx.HTTPError as exc:
            raise FetchError("blocked", str(exc)) from exc

    http_timeout: float = 8.0

    def parse(self, text: str) -> list[Signal]:  # pragma: no cover - 抽象
        raise NotImplementedError
```

`server/ecos/research/snapshot.py`:

```python
"""SourceSnapshot TTL 缓存：payload 即 Signal 列表 JSON。"""

from __future__ import annotations

import hashlib
import json
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models.base import utcnow
from ..models.research import SourceSnapshot


def query_key(source_id: str, args: dict[str, Any]) -> str:
    blob = json.dumps(args, ensure_ascii=False, sort_keys=True)
    return hashlib.md5(f"{source_id}|{blob}".encode("utf-8")).hexdigest()


def fresh_payload(
    session: Session, source_id: str, args: dict[str, Any], ttl: int
) -> list[dict[str, Any]] | None:
    row = session.execute(
        select(SourceSnapshot).where(
            SourceSnapshot.source_id == source_id,
            SourceSnapshot.query_key == query_key(source_id, args),
        )
    ).scalars().first()
    if row is None or row.expires_at <= utcnow():
        return None
    return list(row.payload or [])


def store_payload(
    session: Session, source_id: str, args: dict[str, Any], payload: list[dict[str, Any]]
) -> None:
    key = query_key(source_id, args)
    now = utcnow()
    row = session.execute(
        select(SourceSnapshot).where(
            SourceSnapshot.source_id == source_id, SourceSnapshot.query_key == key
        )
    ).scalars().first()
    if row is None:
        row = SourceSnapshot(source_id=source_id, query_key=key, captured_at=now)
        session.add(row)
    row.payload = payload
    row.expires_at = now.replace() if ttl < 0 else now
    from datetime import timedelta
    row.expires_at = now + timedelta(seconds=max(ttl, 0))
```

（`store_payload` 里那行绕弯的 `expires_at` 赋值实施时直接写 `row.expires_at = now + timedelta(seconds=max(ttl, 0))` 并把 `timedelta` 放顶部 import——两行删一行，保持干净。）

- [ ] **Step 4: 修掉测试里被推翻的用例后跑通**：`pytest tests/test_research_scraper.py -q` 全绿（blocked/empty/unreachable/ttl/arg 校验 5+ 用例）。

- [ ] **Step 5: 检查点**：全量回归。

---

### Task 4: live 源第一批（抖音热搜 / Google Trends / Amazon Best Sellers）

**Files:**
- Create: `server/ecos/research/sources/__init__.py`、`sources/douyin_hot.py`、`sources/google_trends.py`、`sources/amazon_bestsellers.py`
- Create: `server/tests/fixtures/research/douyin_hot.json`、`google_trends.json`、`amazon_bestsellers.html`
- Test: `server/tests/test_research_sources.py`
- Modify: `server/pyproject.toml`（markers + addopts）

**Interfaces:**
- Consumes: `ScraperSource`（Task 3）
- Produces: 三个源类 `DouyinHot/GoogleTrends/AmazonBestSellers`（id：`douyin_hot`/`google_trends`/`amazon_bestsellers`），每个提供纯函数 `parse(text) -> list[Signal]`；`sources/__init__.py` 的 `default_sources(settings, vault_lookup: Callable[[str], dict|None] | None) -> list[ResearchSource]`（本任务先返回这三个，后续任务扩充注册表）。

- [ ] **Step 1: pytest 标记基建**

`pyproject.toml` `[tool.pytest.ini_options]` 增加：

```toml
markers = [
    "external: 需要真实外网访问的源冒烟（默认跳过）",
]
addopts = "-m 'not external'"
```

- [ ] **Step 2: 写失败测试（fixture 驱动，零网络）**

`server/tests/fixtures/research/douyin_hot.json`（代表结构，字段名以真实响应为准）:

```json
{"status_code": 0, "data": {"word_list": [
  {"word": "手机支架 懒人神器", "hot_value": 9552626, "word_label": 3, "event_time": 1758270000},
  {"word": "磁吸快充", "hot_value": 821123, "word_label": 1, "event_time": 1758270000}
]}}
```

`google_trends.json`（Google dailytrends 去 `)]}',` 前缀后结构）:

```json
{"default": {"trendingSearchesDays": [{"date": "2026-09-19", "trendingSearches": [
  {"title": {"query": "magsafe 支架"}, "formattedTraffic": "100K+",
   "relatedQueries": [{"query": "车载磁吸支架"}]}
]}]}}
```

`amazon_bestsellers.html`（代表结构：两个榜单条目）:

```html
<ul id="gridItemRoot"><li class="zg-bdg-text">#1<div class="_cDEzb_p13n-sc-css-line-clamp-3_g3dy1">Magnetic Phone Mount for Car Dashboard</div><span class="_cDEzb_p13n-sc-price_3mJ9Z">$12.99</span><div data-asin="B0TESTASIN01"></div></li>
<li class="zg-bdg-text">#2<div class="_cDEzb_p13n-sc-css-line-clamp-3_g3dy1">Wireless Charging Phone Holder</div><span class="_cDEzb_p13n-sc-price_3mJ9Z">$25.50</span><div data-asin="B0TESTASIN02"></div></li></ul>
```

`server/tests/test_research_sources.py`:

```python
"""live 源解析：fixture 纯函数断言 + external 冒烟录真 fixture。"""

import json
from pathlib import Path

import pytest

from ecos.research.base import BOARDS, METRICS
from ecos.research.sources.amazon_bestsellers import AmazonBestSellers
from ecos.research.sources.douyin_hot import DouyinHot
from ecos.research.sources.google_trends import GoogleTrends

FIXTURES = Path(__file__).parent / "fixtures" / "research"


def _load(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


def _assert_signals(signals):
    for s in signals:
        assert s["metric"] in METRICS and s["url"].startswith("http") and s["keyword"]


def test_douyin_hot_parse():
    signals = DouyinHot().parse(_load("douyin_hot.json"))
    assert len(signals) == 2
    assert signals[0]["metric"] == "heat"
    assert signals[0]["value"] == pytest.approx(9552626)
    _assert_signals(signals)


def test_google_trends_parse_strips_jsonp_garbage():
    raw = ")]}',\n" + _load("google_trends.json")
    signals = GoogleTrends().parse(raw)
    assert signals and signals[0]["metric"] == "trend"
    assert signals[0]["value"] == pytest.approx(100000)  # "100K+" → 100000
    _assert_signals(signals)


def test_amazon_bestsellers_parse_rank_price():
    signals = AmazonBestSellers().parse(_load("amazon_bestsellers.html"))
    ranks = [s for s in signals if s["metric"] == "rank"]
    prices = [s for s in signals if s["metric"] == "price_band"]
    assert [s["value"] for s in ranks] == [1, 2]
    assert prices[0]["value"] == pytest.approx(12.99)
    _assert_signals(signals)


def test_registry_contract():
    from ecos.research.sources import default_sources

    for src in default_sources():
        assert src.board in BOARDS and src.tier == "live"
        assert src.arg_errors({"category": "x"}) == [] or src.required == ()


@pytest.mark.external()  # 写法：@pytest.mark.external
def test_probe_douyin_hot_live():
    pytest.skip("人工执行：scripts/research_probe.py douyin_hot")
```

（`@pytest.mark.external()` 那行按标准 `@pytest.mark.external` 写；冒烟用例真实体见 Step 5 脚本。）

- [ ] **Step 3: 跑测试确认失败**（ImportError）

- [ ] **Step 4: 实现三个源 + 注册表**

`sources/douyin_hot.py`:

```python
"""抖音热搜榜（公开接口）：需求脉冲信号。"""

from __future__ import annotations

import json
from typing import Any

from ..base import FetchError, Signal
from ..scraper import ScraperSource


class DouyinHot(ScraperSource):
    id = "douyin_hot"
    name = "抖音热搜榜"
    board = "content"
    description = "抖音公开热搜脉冲（词级热度，全品类混排，交叉层按品类词过滤）"
    url_template = "https://www.iesdouyin.com/web/api/v2/hotsearch/billboard/word/"
    params = {"category": {"type": "string"}}
    required = ("category",)

    def parse(self, text: str) -> list[Signal]:
        from ecos.research.base import make_signal

        try:
            data = json.loads(text)
        except json.JSONDecodeError as exc:
            raise FetchError("layout", str(exc)) from exc
        rows = (data.get("data") or {}).get("word_list") or []
        return [
            make_signal(
                self.id, "抖音", str(r.get("word", "")).strip(), "heat",
                float(r.get("hot_value") or 0), "now", "https://www.douyin.com/hot",
            )
            for r in rows if str(r.get("word", "")).strip()
        ]
```

`sources/google_trends.py`（要点：`parse` 先 `text.partition("\n")` 去掉 `)]}',` 前缀；`_traffic_to_float`：`"100K+"→100000`、`"1.2M+"→1200000`、纯数字直转、失败 0；对每个 trendingSearch 产 `trend` 信号 + relatedQueries 各产权重 0.4× 的 `trend` 信号；url=`https://trends.google.com/trends/daily?geo=CN`；类属性 `use_proxy = True`；`params={"category":..., "geo": {"type":"string"}}`、`required=("category",)`，`url_template = "https://trends.google.com/trends/api/dailytrends?hl=zh-CN&tz=-480&geo={geo}"`，`fetch` 前把缺省 `geo` 补为 `CN`：覆写 `fetch` 一行 `args.setdefault("geo", "CN")` 再 `super().fetch(args)`）。

`sources/amazon_bestsellers.py`（要点：正则三件套，**rank 用 `zg-bdg-text` 里的 #N，缺失时按出现顺序编号**）:

```python
import re
TITLE_RE = re.compile(r'class="_cDEzb_p13n-sc-css-line-clamp-\d[^"]*">([^<]{8,})</div>')
PRICE_RE = re.compile(r'class="_cDEzb_p13n-sc-price_3mJ9Z">\$([\d.,]+)</span>')
ASIN_RE = re.compile(r'data-asin="([A-Z0-9]{10})"')
```

`parse` 对 zip(titles, prices, asins) 逐条产两类信号：`rank`（value=序号+1，keyword=标题前 40 字符）与 `price_band`（value=价格）；url=`https://www.amazon.com/Best-Sellers/zgbs`；`params={"category": ...}`、`required=("category",)`；`use_proxy = True`。

`sources/__init__.py`:

```python
"""研究源注册表：配置决定启用（disabled 拉闸 / 代理缺失由源自身降级）。"""

from __future__ import annotations

from typing import Callable

from ..base import ResearchSource
from .amazon_bestsellers import AmazonBestSellers
from .douyin_hot import DouyinHot
from .google_trends import GoogleTrends


def default_sources(
    settings=None,
    disabled: frozenset[str] = frozenset(),
) -> list[ResearchSource]:
    sources: list[ResearchSource] = [DouyinHot(), GoogleTrends(), AmazonBestSellers()]
    live = [s for s in sources if s.id not in disabled]
    if settings is not None and getattr(settings, "research_proxy_url", ""):
        for s in live:
            s.proxy_url = settings.research_proxy_url
    return live
```

- [ ] **Step 5: 录制脚本（external 冒烟，不进基线）**

`server/scripts/research_probe.py`:

```python
"""人工冒烟：python scripts/research_probe.py <source_id> [category]
真网抓一次并把响应体写进 tests/fixtures/research/<id>.<ext>（覆盖前看 diff）。
仅公开 GET，UA 已声明为内部工具。"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ecos.research.scraper import fetch_http_text  # noqa: E402
from ecos.research.sources import default_sources  # noqa: E402

TARGETS = {"douyin_hot": ".json", "google_trends": ".json", "amazon_bestsellers": ".html"}

def main() -> None:
    source_id = sys.argv[1] if len(sys.argv) > 1 else ""
    if source_id not in TARGETS:
        raise SystemExit(f"可选: {sorted(TARGETS)}")
    src = next(s for s in default_sources() if s.id == source_id)
    url = src.url_template.format(category="手机支架", geo="CN")
    text = fetch_http_text(url, timeout=15, proxy=src.proxy_url or None, headers=src.headers)
    out = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "research" / f"{source_id}{TARGETS[source_id]}"
    out.write_text(text, encoding="utf-8")
    print(f"captured {len(text)} bytes -> {out}")
    print("若真实结构与代表 fixture 不同：以真实结构为准更新 fixture 与 parse 选择器。")

if __name__ == "__main__":
    main()
```

- [ ] **Step 6: 单测通过**：`pytest tests/test_research_sources.py -q`（external 被过滤）+ 全量回归。

---

### Task 5: live 源第二批（京东榜 / 1688 / 百度指数 / 巨量算数）

**Files:**
- Create: `sources/jd_rank.py`、`sources/ali1688_hot.py`、`sources/baidu_index.py`、`sources/juliang_trend.py`
- Create: `tests/fixtures/research/jd_rank.html`、`ali1688_hot.json`、`baidu_index.json`、`juliang_trend.json`
- Modify: `tests/test_research_sources.py`（追加 4 个 parse 用例）、`sources/__init__.py`（注册表 +4）

**Interfaces:**
- Consumes: `ScraperSource`、Task 4 的 `default_sources`
- Produces: `JdRank(jd_rank)`、`Ali1688Hot(ali1688_hot)`、`BaiduIndex(baidu_index)`、`JuliangTrend(juliang_trend)`——全部 live/shelf 或 content 盘；`default_sources()` 返回 7 源。

- [ ] **Step 1: 追加失败测试**（模式与 Task 4 一致：fixture → parse → 断言指标与值）

```python
def test_jd_rank_parse():
    from ecos.research.sources.jd_rank import JdRank
    signals = JdRank().parse((FIXTURES / "jd_rank.html").read_text(encoding="utf-8"))
    assert any(s["metric"] == "sales_proxy" for s in signals)
    _assert_signals(signals)


def test_ali1688_hot_parse():
    from ecos.research.sources.ali1688_hot import Ali1688Hot
    signals = Ali1688Hot().parse((FIXTURES / "ali1688_hot.json").read_text(encoding="utf-8"))
    assert signals and signals[0]["platform"] == "1688" and signals[0]["metric"] == "heat"
    _assert_signals(signals)


def test_baidu_index_degrades_on_non_json():
    from ecos.research.base import FetchError
    from ecos.research.sources.baidu_index import BaiduIndex
    with pytest.raises(FetchError) as e:
        BaiduIndex().parse("<html>403</html>")
    assert e.value.kind == "blocked"


def test_juliang_trend_parse():
    from ecos.research.sources.juliang_trend import JuliangTrend
    signals = JuliangTrend().parse((FIXTURES / "juliang_trend.json").read_text(encoding="utf-8"))
    assert signals and signals[0]["metric"] == "trend"
    _assert_signals(signals)
```

代表 fixture（结构与 Task 4 同理——真站结构以 probe 校准，parse 只认这个代表结构）:

`jd_rank.html`:

```html
<ul class="gl-warp clearfix"><li class="gl-item" data-sku="100012043978">
 <div class="p-name p-name-type-2"><em>磁吸 手机支架 车载 <span class="p-tag">自营</span></em></div>
 <div class="p-price"><i>39.90</i></div>
 <div class="p-commit"><strong>2万+</strong></div></li>
<li class="gl-item" data-sku="100089238471">
 <div class="p-name p-name-type-2"><em>无线充 手机支架</em></div>
 <div class="p-price"><i>89.00</i></div>
 <div class="p-commit"><strong>5000+</strong></div></li></ul>
```

`ali1688_hot.json`: `{"result": {"hotKeyWords": [{"keyword": "手机支架批发", "uv": 12345}, {"keyword": "磁吸支架", "uv": 678}]}}`

`baidu_index.json`: `{"Data": {"手机支架": [{"day": "2026-09-18", "all": 45678}]}}`

`juliang_trend.json`: `{"data": {"hot_words": [{"word": "磁吸支架", "hot_value": 55.2, "trend": 12.1}]}}`

- [ ] **Step 2: 确认失败** → **Step 3: 实现**

`jd_rank.py` 要点：`url_template = "https://list.jd.com/list.html?cat={cat}&sort=stock&desc=true"`，`params={"category","cat"}`、`required=("category",)`，`fetch` 里 `args.setdefault("cat", "9987,2131,2133")`（数码配件默认类目）；`parse` 正则 `data-sku="(\d+)"` 块内取 `em>([^<]+)<`、`p-price"><i>([\d.]+)`、`p-commit"><strong>([^<]+)`；标题→keyword（去空白、截 40），`<em>` 内含 `span` 的先 `re.sub(r"<[^>]+>", " ", block)` 清洗；commit `2万+→20000`、`5000+→5000`（`_cn_count` 辅助：`万/w=×10000`、`亿=×100000000`、剥 `+`/千分位）；产 `sales_proxy`（评价数代理销量）与 `price_band` 两族信号；证据 url=`https://list.jd.com/list.html?cat=...`。blocked 判定继承基类。

`ali1688_hot.py` 要点：`url_template = "https://s.1688.com/selloffer/rpc.json?searchScene=pcSearchFind&keywords={category}"`（probe 校准点；拿不到就退 `https://s.1688.com/hot/` HTML 同结构提取）；parse：优先 JSON `result.hotKeyWords[]`→`heat`=uv；非 JSON 时正则 `"hotKeyWords":(\[.*?\])` 兜底；platform="1688"。

`baidu_index.py` 要点（**默认降级源**）：`url_template = "https://index.baidu.com/api/trend/api?area=all&words={category}"`；`parse` 非 JSON → `FetchError("blocked", "百度指数握手失败（设计内降级）")`；JSON 时取 `Data.<word>[0].all` → `trend`。类注释写明：blocked 属预期路径，验收不依赖。

`juliang_trend.py` 要点：`url_template = "https://trendinsight.oceanengine.com/arithmetic-index/analysisHotWord?category_name=全部&begin_date=20250912&end_date=20250919&size=20&page=1"`（日期由 `fetch` 按当日回溯 7 天动态 format，`params={"category","begin_date","end_date"}` 中日期 required 元组空——实现为 `fetch` 内 setdefault 后 `super().fetch`）；parse：`data.hot_words[]`→`trend`（hot_value）platform="抖音"；403/风控→继承 blocked。**blocked 即降级**，同 baidu_index。

`sources/__init__.py` 注册表扩为 7 源（import + 列表顺序：douyin_hot, jd_rank, ali1688_hot, google_trends, amazon_bestsellers, baidu_index, juliang_trend）。

- [ ] **Step 4: 单测 + probe 注册**：`TARGETS` 增加 `"jd_rank": ".html", "ali1688_hot": ".json", "baidu_index": ".json", "juliang_trend": ".json"`。
- [ ] **Step 5: 检查点**：`pytest tests/test_research_sources.py -q` 全绿；全量回归。

---

### Task 6: official/licensed 壳（VaultApiSource）

**Files:**
- Create: `server/ecos/research/vault_source.py`、`server/ecos/research/sources/shells.py`
- Modify: `server/ecos/research/sources/__init__.py`
- Test: `tests/test_research_sources.py` 追加

**Interfaces:**
- Consumes: `CredentialVault.decrypt` 不直接用——vault_lookup 抽象
- Produces: `VaultApiSource(ResearchSource)`：类属性 `auth = "vault:<kind>"`，构造入参 `credential_lookup: Callable[[str], dict | None]`（按 kind 返回解密后的凭据 dict 或 None），`fetch` 在凭据缺失时 `raise FetchError("unconfigured", ...)`，凭据在场时本期也抛 `FetchError("unconfigured", "真实对接未排期")`（壳的本分）但 `health()->"awaiting_credentials"|"configured"`；`TaobaoOpen`（official，params: category 必填、fields 可选）、`Chanmama`（licensed，params: category）；`default_sources(..., vault_lookup=None)` 返回 9 源（7 live + 2 壳）。

- [ ] **Step 1: 追加失败测试**

```python
def test_shells_report_health_by_credential_presence():
    from ecos.research.sources.shells import Chanmama, TaobaoOpen

    t = TaobaoOpen(credential_lookup=lambda kind: None)
    c = Chanmama(credential_lookup=lambda kind: {"app_key": "k", "app_secret": "s"})
    assert t.health() == "awaiting_credentials"
    assert c.health() == "configured"
    with pytest.raises(FetchError) as e:
        t.fetch({"category": "支架"})
    assert e.value.kind == "unconfigured"


def test_registry_now_nine_sources():
    from ecos.research.sources import default_sources
    srcs = default_sources()
    assert len(srcs) == 9
    assert {s.tier for s in srcs} == {"live", "official", "licensed"}
```

- [ ] **Step 2: 确认失败** → **Step 3: 实现**

`vault_source.py`:

```python
"""凭据型源（official 开放平台 / licensed 第三方）：本期为壳，契约先行。"""

from __future__ import annotations

from typing import Any, Callable

from .base import FetchError, ResearchSource, Signal


class VaultApiSource(ResearchSource):
    tier = "official"
    credential_lookup: Callable[[str], dict[str, Any] | None] = staticmethod(lambda kind: None)

    def __init__(self, *, credential_lookup=None) -> None:
        if credential_lookup is not None:
            self.credential_lookup = credential_lookup
        self.auth = f"vault:{self.vault_kind}"

    vault_kind: str = ""

    def _credentials(self) -> dict[str, Any] | None:
        return self.credential_lookup(self.vault_kind)

    def health(self) -> str:
        return "configured" if self._credentials() else "awaiting_credentials"

    def fetch(self, args: dict[str, Any]) -> list[Signal]:
        errs = self.arg_errors(args)
        if errs:
            raise ValueError(";".join(errs))
        if not self._credentials():
            raise FetchError("unconfigured", f"{self.id} 未配置凭据实例")
        raise FetchError("unconfigured", f"{self.id} 真实 HTTP 对接未排期（壳）")
```

`shells.py`:

```python
"""两个代表壳：official（淘宝开放平台）与 licensed（蝉妈妈）。"""

from .vault_source import VaultApiSource


class TaobaoOpen(VaultApiSource):
    id = "taobao_open"
    name = "淘宝开放平台"
    board = "shelf"
    tier = "official"
    vault_kind = "src-taobao-open"
    description = "需商家 appkey + 授权；填凭据即进入可用清单（真实对接未排期）"
    params = {"category": {"type": "string"}, "fields": {"type": "string"}}
    required = ("category",)


class Chanmama(VaultApiSource):
    id = "chanmama"
    name = "蝉妈妈开放 API"
    board = "content"
    tier = "licensed"
    vault_kind = "src-chanmama"
    description = "抖音电商 GMV 级数据；采购开通后填凭据启用（真实对接未排期）"
    params = {"category": {"type": "string"}}
    required = ("category",)
```

注册表 `default_sources(settings=None, disabled=frozenset(), vault_lookup=None)`：追加 `TaobaoOpen(credential_lookup=vault_lookup or (lambda k: None)), Chanmama(credential_lookup=vault_lookup or (lambda k: None))`。live 过滤只作用于 `tier == "live"` 的 disabled 判断不变（壳 id 也可拉闸）。

- [ ] **Step 4: 全绿 + 全量回归**（此时 Task 4 的 `test_registry_contract` 断言 `src.tier == "live"` 要改为按 tier∈TIERS 且 live 源 board 校验——同步修正）。

---

### Task 7: 规则层流水线（pipeline.py：plan/fetch/cross/synthesize + 打分落库）

**Files:**
- Create: `server/ecos/research/pipeline.py`
- Create: `server/tests/helpers_research.py`
- Test: `server/tests/test_research_pipeline.py`

**Interfaces:**
- Consumes: Task 1 四表、Task 2/3 源与快照、`models/base.utcnow/new_id`
- Produces:
  - `normalize_keyword(kw: str) -> str`
  - `parse_traffic(s: str) -> float`（"100K+"/"2万+" 双语向）
  - `cross_and_score(signals: list[Signal], online_source_ids: set[str], single_source_penalty: float = 0.6) -> list[dict]`——候选 dict：`{name,platform,board,price,sales_signal,heat,keywords,score,score_basis,evidence}`
  - `execute_rule_pipeline(session_factory, settings, sources, *, user_id, category, boards, deadline: float) -> str(run_id)`（同步执行全四阶段并落库，返回 run_id；预算外未跑的 fetch 记 `skipped`，状态按覆盖度算 `succeeded|partial|failed`）

- [ ] **Step 1: 测试辅助**

`server/tests/helpers_research.py`:

```python
"""研究流水线测试的假源：注入信号、模拟失败，不碰网络。"""

from __future__ import annotations

from ecos.research.base import ResearchSource, Signal


class FakeSource(ResearchSource):
    tier = "live"

    def __init__(self, id: str, board: str, signals: list[Signal] | None = None,
                 fail: str | None = None) -> None:
        self.id, self.name, self.board = id, id, board
        self._signals = signals or []
        self._fail = fail  # None | FetchError kind

    def fetch(self, args):
        from ecos.research.base import FetchError
        if self._fail:
            raise FetchError(self._fail, f"{self.id} 注入失败")
        return list(self._signals)


def sig(source_id, platform, keyword, metric, value, window="7d", url=None):
    from ecos.research.base import make_signal
    return make_signal(source_id, platform, keyword, metric, value, window,
                       url or f"https://example.com/{source_id}")
```

- [ ] **Step 2: 写失败测试**

`server/tests/test_research_pipeline.py`:

```python
"""规则层：候选数值全部可溯源、单源孤证降权、partial/failed 状态、打分透明。"""

import time

import pytest
from sqlalchemy import select

from ecos.config import Settings
from ecos.db import init_db, make_engine, make_session_factory
from ecos.models import ResearchCandidate, ResearchRun, ResearchStep
from ecos.research.pipeline import cross_and_score, execute_rule_pipeline, normalize_keyword
from tests.helpers_research import FakeSource, sig


@pytest.fixture()
def factory():
    engine = make_engine("sqlite://")
    init_db(engine)
    yield make_session_factory(engine)


def _sources():
    return [
        FakeSource("s_a", "shelf", [
            sig("s_a", "京东", "手机支架", "rank", 1),
            sig("s_a", "京东", "手机支架", "price_band", 39.9),
            sig("s_a", "京东", "磁吸快充", "rank", 2),
        ]),
        FakeSource("s_b", "content", [
            sig("s_b", "抖音", "手机支架", "heat", 900),
            sig("s_b", "抖音", "防晒冰袖", "heat", 700),  # 孤证
        ]),
        FakeSource("s_c", "crossborder", [], fail="blocked"),
    ]


def test_normalize_keyword():
    assert normalize_keyword(" 磁吸 手机支架 ") == "磁吸手机支架"


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
    assert by_name["手机支架"]["heat"] == by_name["手机支架"]["score_basis"]["heat_scaled"]  # heat 可溯源
    assert by_name["防晒冰袖"]["score_basis"]["penalty"] == 0.6


def test_execute_rule_pipeline_persists(factory):
    settings = Settings(database_url="sqlite://")
    run_id = execute_rule_pipeline(
        factory, settings, _sources(),
        user_id="u1", category="手机支架", boards=["shelf", "content", "crossborder"],
        deadline=time.monotonic() + 60,
    )
    with factory() as s:
        run = s.get(ResearchRun, run_id)
        steps = s.execute(select(ResearchStep).where(ResearchStep.run_id == run_id).order_by(ResearchStep.seq)).scalars().all()
        cands = s.execute(select(ResearchCandidate).where(ResearchCandidate.run_id == run_id)).scalars().all()
        assert run.status == "partial"  # s_c blocked → 覆盖 2/3
        assert run.signal_count == 5
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
        steps = s.execute(select(ResearchStep).where(ResearchStep.run_id == run_id)).scalars().all()
        assert [st.status for st in steps if st.kind == "fetch"].count("skipped") == 3
```

- [ ] **Step 3: 确认失败** → **Step 4: 实现 `pipeline.py`**

关键实现点（完整代码按此骨架展开，禁止留空）：

```python
"""规则层流水线：plan→fetch(快照优先)→cross→synthesize；数字全部出自信号池。"""

from __future__ import annotations

import json
import re
import statistics
import time
from datetime import datetime
from typing import Any, Callable

from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

from ..config import Settings
from ..models.base import new_id, utcnow
from ..models.research import ResearchCandidate, ResearchRun, ResearchStep
from .base import FetchError, ResearchSource, Signal
from .snapshot import fresh_payload, query_key, store_payload

# 权重与公式透明：随 score_basis 落库供复核
SCORE_WEIGHTS = {"heat": 0.35, "trend": 0.25, "rank": 0.15, "sales_proxy": 0.25}
SINGLE_SOURCE_PENALTY = 0.6


def normalize_keyword(kw: str) -> str:
    return re.sub(r"[\s\-_/·，,。.]+", "", kw).lower()


def parse_traffic(s: str) -> float: ...  # "100K+"→1e5, "1.2M+"→1.2e6, "2万+"→2e4, 异常→0


def _zscore(values: list[float]) -> list[float]:
    if len(values) < 2:
        return [0.0 for _ in values]
    mean = statistics.fmean(values)
    var = statistics.pvariance(values)
    std = var ** 0.5 or 1.0
    return [(v - mean) / std for v in values]


def cross_and_score(signals, online_source_ids, single_source_penalty=SINGLE_SOURCE_PENALTY):
    # 1) normalize_keyword 分桶；桶内保留 metric 原始值
    # 2) 桶证据 = 全部 signals；多源集合 = {source_id}
    # 3) rank 指标取负向：z 前先转 "越小越好"→ -value
    # 4) 每桶 score = Σ w_metric · z(mean(该 metric 值))（z 在全池上先做指标内标准化）
    # 5) len(sources)==1 → score *= penalty，score_basis.penalty = penalty
    # 6) heat = clamp(round(50 + 25 * score), 0, 100)，写入 score_basis["heat_scaled"]
    # 7) price/sales_signal/platform(众数)/board(众数)/keywords(桶内各源 keyword 原文去重前 4)
    # 返回按 score 降序 list[dict]，附 evidence=[{source_id,metric,value,url,captured_at}]
    ...
```

`execute_rule_pipeline(factory, settings, sources, *, user_id, category, boards, deadline) -> str`：

1. 建 `ResearchRun(user_id, category, boards, mode="rule")` 拿 `run.id`；step1 `kind="plan"`：`summary=f"{len(enabled)} 源 × {category}"`；enabled 源 = `[s for s in sources if s.board in (boards or 全部)]`。
2. 每源 step `kind="fetch"`（seq 递增，`args_digest=query_key(s.id, {"category": category})[:12]`）：`time.monotonic() > deadline` → `status="skipped", error="预算耗尽"`；否则 `fresh_payload(session, s.id, args, ttl=s.ttl_seconds or settings.research_source_ttl)` 命中 → `summary="快照命中"`；未命中 → `try: s.fetch(args)`，成功 `store_payload` + `summary=f"{n} 信号"` + `seconds`；`FetchError` → `status="failed", error=f"{kind}:{message[:80]}"`；每源独立 `session.commit()`（后台线程与请求线程共享 engine 时尽早释放写锁）。
3. 汇总信号池（快照 + 新抓），`ok_sources = {s.id | fetch step ok}`；`kind="cross"` step：`cross_and_score(...)`；空池 → 直接 `run.status="failed", error="无可用信号（0 源成功）"` + `finished_at` 落库返回。
4. `kind="synthesize"` step：前 **10** 候选写 `ResearchCandidate`（rank 1..n，score_basis 含 `weights=SCORE_WEIGHTS` 与 penalty）；`run.signal_count = len(信号池)`；状态：failed_steps==0 且 skipped==0 → `succeeded`，否则有候选 → `partial`，无候选 → `failed`；`run.narrative = None`（agent 层再填）；`started_at`/`finished_at` 补记。
5. 返回 run_id。审计**不在此层**（service 层记 create/finish 两条，见 Task 8）。

- [ ] **Step 5: 测试通过 + 回归**：`pytest tests/test_research_pipeline.py -q`；全量 ≥ 194。

---

### Task 8: ResearchService（线程执行 + 缓存命中 + 审计 + 源健康）

**Files:**
- Create: `server/ecos/research/service.py`
- Test: `server/tests/test_research_service.py`

**Interfaces:**
- Consumes: pipeline、sources registry、`AuditService`、Task 2/6 `capabilities()/health()`
- Produces: `ResearchService(settings, session_factory, sources, audit, *, runner: Callable[[Callable], None] = _spawn_thread)`——`create(user_id, category, boards|None) -> (run_id, cached: bool)`（同品类 30 分钟内 succeeded/partial run 且快照全新鲜 → 直接回旧 run）、`run_now(run_id)`（blocking 包装，独立 session）、`get_run(user_id, run_id)`、`list_runs(user_id)`、`sources_health(user_id) -> list[dict]`；`_spawn_thread(fn)`：`threading.Thread(daemon=True)`；同 `user_id+category` 有 running → 复用其 id（`threading.Lock` 保护的进程内 dict，风格照抄 `tasks/engine.py:20-26`）。

- [ ] **Step 1: 写失败测试**

`server/tests/test_research_service.py`:

```python
"""Service：缓存命中不重抓、后台线程落库、同品类并发复用、审计两条、源健康。"""

import time

import pytest

from ecos.config import Settings
from ecos.db import init_db, make_engine, make_session_factory
from ecos.research.service import ResearchService
from ecos.tasks.audit import AuditService
from tests.helpers_research import FakeSource, sig


def _svc(sources):
    engine = make_engine("sqlite://")
    init_db(engine)
    factory = make_session_factory(engine)
    audit = AuditService(factory())
    return ResearchService(Settings(database_url="sqlite://"), factory, sources, audit)


def _good():
    return FakeSource("s_a", "shelf", [sig("s_a", "京东", "手机支架", "heat", 5)])


def test_create_and_run_now_with_audit_and_persistence():
    svc = _svc([_good()])
    run_id, cached = svc.create("u1", "手机支架", None)
    assert not cached
    svc.run_now(run_id)  # blocking 路径
    run = svc.get_run("u1", run_id)
    assert run["status"] == "succeeded" and run["signal_count"] == 1
    with svc.factory() as s:
        actions = [a.action for a in AuditService(s).list(limit=50)]
        assert "research.create" in actions and "research.finish" in actions


def test_same_category_reuses_running_run():
    svc = _svc([_good()])
    r1, _ = svc.create("u1", "手机支架", None)
    r2, reused = svc.create("u1", "手机支架", None)
    assert r2 == r1 and reused is True  # 第一条还在 running


def test_finished_recent_run_serves_cached():
    svc = _svc([_good()])
    r1, _ = svc.create("u1", "手机支架", None)
    svc.run_now(r1)
    r2, cached = svc.create("u1", "手机支架", None)
    assert r2 == r1 and cached


def test_cross_user_run_invisible():
    svc = _svc([_good()])
    r1, _ = svc.create("u1", "手机支架", None)
    with pytest.raises(Exception):  # NotFoundError 由 service 抛，路由映射 404
        svc.get_run("u2", r1)


def test_sources_health_lists_tiers_and_credentials():
    from ecos.research.sources import default_sources

    svc = _svc(default_sources())
    rows = svc.sources_health("u1")
    assert len(rows) == 9
    assert all(r["capabilities"]["input_schema"]["type"] == "object" for r in rows)
    assert any(r["health"] == "awaiting_credentials" for r in rows)


def test_background_thread_completes(tmp_path):
    svc = _svc([_good()])
    r1, _ = svc.create("u1", "手机支架", None)  # create 已排后台线程（默认 runner）
    for _ in range(100):
        if svc.get_run("u1", r1)["status"] != "running":
            break
        time.sleep(0.05)
    assert svc.get_run("u1", r1)["status"] == "succeeded"
```

注：`_svc` 里 `audit = AuditService(factory())` 只给 create 前的写审计用；service 内部每次操作**自开新 session**（`factory()`），不共享 AuditService 实例的 session——实现时 `ResearchService._audit(user_id, action, result, detail)` 每次 `with self.factory() as s: AuditService(s).log(...); s.commit()`。

- [ ] **Step 2: 确认失败** → **Step 3: 实现 service.py**

要点：`create` = 校验 category 非空（ValueError）→ `research_enabled` 假 → `ValueError("研究功能已关闭")`；running/近 30min 完成 run 判定（`_recent_run(user_id, category)` 查 `ResearchRun`）→ 命中返回 `(old.id, True)` 且**不再触发抓取**；未命中建 run + `audit research.create` + `self._runner(self._bound_run(run_id))` 返回 `(run_id, False)`。`run_now(run_id)`：置 `started_at` → 组 `deadline = time.monotonic() + settings.research_run_budget` → `execute_rule_pipeline(...)`（内部把 run 记录继续用同一 run_id——pipeline 签名相应接 `run_id` 而非自建：Task 7 的 `execute_rule_pipeline` 增加可选参 `run_id: str | None = None`，None 才自建，实现时同步改测试）→ 完成后 `audit research.finish(result=run.status, detail={category, signals, mode})`。异常兜底：任何线程内异常 → run `failed + error[:200]` + finish 审计 `result="failed"`。`get_run/list_runs` 返回 `serializers.research_run_out` dict；`sources_health` = 每源 `{**capabilities(), "health": "online"|"awaiting_credentials"|"disabled", "ttl_seconds", "board", "tier"}`（disabled 判定 `settings.research_disabled_sources`）。

- [ ] **Step 4: 全绿 + 回归**

---

### Task 9: agent 层（ReAct 编排 + 叙述数字红线）

**Files:**
- Create: `server/ecos/research/agent.py`
- Modify: `server/ecos/research/service.py`（`run_now` 末尾按条件调 `augment_with_agent`）
- Test: `server/tests/test_research_agent.py`

**Interfaces:**
- Consumes: `agent/runtime.build_agent/scripted_model`、`ecos.research.tools`（本任务产）、pipeline 落库结果
- Produces: `run_rule_then_agent(settings, factory, sources, *, user_id, run_id, category) -> None`（在**已完成规则层**的 run 上叠加）；`validate_narrative(narrative: str, evidence_numbers: set[str]) -> tuple[str, list[str]]`（返回清洗后文本与被裁句列表）；`build_research_tools(service_ctx) -> list[ToolBase]`：工具 `fetch_source(source_id, category)`、`read_signals(category)`、`finish(narrative)`；红线常量 `MAX_TOOL_CALLS = 12`。

- [ ] **Step 1: 写失败测试**

`server/tests/test_research_agent.py`:

```python
"""agent 层：脚本化模型驱动工具循环；叙述不得带证据外数字；候选数值不被模型改动。"""

import time

import pytest
from sqlalchemy import select

from ecos.agent.runtime import scripted_model
from ecos.config import Settings
from ecos.db import init_db, make_engine, make_session_factory
from ecos.models.research import ResearchCandidate, ResearchRun, ResearchStep
from ecos.research.agent import run_rule_then_agent, validate_narrative
from tests.helpers_research import FakeSource, sig

SIGNALS = [sig("s_a", "京东", "手机支架", "heat", 500),
           sig("s_b", "抖音", "手机支架", "heat", 900)]


def test_validate_narrative_strips_unsourced_numbers():
    keep, cut = validate_narrative(
        "月销约 500 件，抖音热度 900。编造的转化率 37% 必须裁掉。", {"500", "900"}
    )
    assert "500" in keep and "900" in keep and "37%" not in keep
    assert cut and "37%" in cut[0]


@pytest.fixture()
def env():
    engine = make_engine("sqlite://")
    init_db(engine)
    return Settings(database_url="sqlite://"), make_session_factory(engine)


def _finish_block(text):
    from agentscope.message import TextBlock
    return [TextBlock(type="text", text=text)]


def test_agent_writes_narrative_without_touching_numbers(env):
    settings, factory = env
    run_id = "rsr_test"
    with factory() as s:
        s.add(ResearchRun(id=run_id, user_id="u1", category="手机支架", mode="agent"))
        s.add(ResearchCandidate(run_id=run_id, rank=1, name="手机支架", heat=61, score=0.44,
                                evidence=[{"source_id": "s_a", "value": 500.0, "url": "u"}]))
        s.commit()
    model = scripted_model([
        _finish_block("该品类京东信号 500，抖音信号 900，建议优先磁吸款。"),
    ])
    sources = [FakeSource("s_a", "shelf", SIGNALS[:1]), FakeSource("s_b", "content", SIGNALS[1:])]
    run_rule_then_agent(settings, factory, sources,
                        user_id="u1", run_id=run_id, category="手机支架", model=model)
    with factory() as s:
        run = s.get(ResearchRun, run_id)
        assert run.narrative and "500" in run.narrative
        cand = s.execute(select(ResearchCandidate)).scalars().one()
        assert cand.heat == 61  # 模型不得改候选数值


def test_agent_extra_fetch_records_steps(env):
    settings, factory = env
    run_id = "rsr_x2"
    with factory() as s:
        s.add(ResearchRun(id=run_id, user_id="u1", category="手机支架", mode="agent"))
        s.add(ResearchCandidate(run_id=run_id, rank=1, name="手机支架", heat=50))
        s.commit()
    from agentscope.message import ToolUseBlock
    model = scripted_model([
        [ToolUseBlock(type="tool_use", id="c1", name="fetch_source",
                      input={"source_id": "s_a", "category": "手机支架"})],
        [ToolUseBlock(type="tool_use", id="c2", name="finish",
                      input={"narrative": "京东侧 500 热度确认。"})],
    ])
    sources = [FakeSource("s_a", "shelf", SIGNALS[:1]), FakeSource("s_b", "content", SIGNALS[1:])]
    run_rule_then_agent(settings, factory, sources,
                        user_id="u1", run_id=run_id, category="手机支架", model=model)
    with factory() as s:
        steps = s.execute(select(ResearchStep).where(ResearchStep.run_id == run_id)
                          .order_by(ResearchStep.seq)).scalars().all()
        agent_steps = [st for st in steps if st.kind == "agent"]
        assert [st.summary for st in agent_steps][:2] == ["call:fetch_source", "call:finish"]
        assert s.get(ResearchRun, run_id).narrative
```

（`ToolUseBlock` 导入路径、脚本化响应块的 content 结构以 `agentscope 2.x` 实际消息类型为准——先看 `tests/test_agent_bridge.py` 与 `agent/runtime.py::ScriptedChatModel` 既有用法，照其模式写 content 列表；若 Agent 循环需要 tool_result 回填，`ScriptedChatModel.calls` 已记录消息，参考 `test_agent_bridge.py` 的断言方式。）

- [ ] **Step 2: 确认失败** → **Step 3: 实现 agent.py**

要点：

```python
def validate_narrative(narrative, evidence_numbers):
    NUMBER_RE = re.compile(r"\d+(?:\.\d+)?")
    kept, cut = [], []
    for sentence in re.split(r"(?<=[。！？;；\n])", narrative):
        nums = set(NUMBER_RE.findall(sentence))
        if nums and not nums <= evidence_numbers:
            cut.append(sentence)
        else:
            kept.append(sentence)
    return "".join(kept).strip(), cut
```

- `run_rule_then_agent(settings, factory, sources, *, user_id, run_id, category, model)`：`model is None` 直接 return（规则层结果原样即终态）；否则 `build_agent(name="research-agent", system_prompt=<只许引用工具返回、候选数值不得改写、≤12 次工具调用后必须 finish>, model=model, tools=build_research_tools(...))`，`asyncio.run(agent(Msg("user", f"品类「{category}」……", "user")))`；工具 wrapper 闭包持有 `factory`：每次调用 step `kind="agent"`、`summary=f"call:{tool_name}"`；`finish` 工具 = `validate_narrative` 后写 `run.narrative`（裁掉的句子句数写进 `run.error=None`、step summary 附 `cleaned= n句`）。`evidence_numbers` 从当轮候选 evidence 的 value 字符串集 + `signal_count` + heat 值取十进制文本（`{str(int(v)) for v...} | {json.dumps(...)}`——以数字文本形态与 `NUMBER_RE.findall` 对齐，`500.0` 与 `500` 两种都要进集合）。
- 保护：`MAX_TOOL_CALLS` 计数超限后 `fetch_source/read_signals` 返回引导 finish 的 ToolResponse；agent 抛任何异常 → step `kind="agent", status="failed", error=...[:200]`，**run 保留规则层结果与状态**（叙述缺失可接受，造数不可接受）。
- service 接线：`run_now` 完成规则层后，`if settings.model_name and settings.model_api_key:` → `model = build_model(settings)`，`run.mode = "agent"` → `run_rule_then_agent(...)`；`tokens_in/out` 若模型响应带 usage 则记，无则 0。
- **`ai/adapter.py` 清理**（同任务收尾）：`ModelAdapter` Protocol 删 `research_report`；`LiveAdapter.research_report` 整个方法删除（治"凭记忆编数"）；`api/ai.py` 的 `/api/ai/research` 改为显式演示基线：

```python
    candidates = SimulatedAdapter().research_report(category)  # 演示档；真实分析走 /api/research
```

（`svc.ai` 不再调 `research_report`；`SimulatedAdapter` 保留该方法作测试/演示底表，docstring 注明。）

- [ ] **Step 4: 全绿 + 回归**（test_adapters.py / test_ai_endpoints.py 若有对 LiveAdapter.research_report 的断言，按新契约改写并计数入本任务）

---

### Task 10: REST 端点 + 装配 + auth 模式用例

**Files:**
- Create: `server/ecos/api/research.py`
- Modify: `server/ecos/api/serializers.py`、`server/ecos/api/deps.py`、`server/ecos/main.py`
- Test: `server/tests/test_research_api.py`

**Interfaces:**
- Consumes: `ResearchService`、`Services.require`、错误映射（`NotFoundError→404`、`ValueError→400`）
- Produces: 路由四端点（spec §3.4 表）；`Services.research: ResearchService`；`app.state.research_service`。响应形状：
  - `POST /api/research {category, boards?}` → `{run_id, status, cached}`
  - `GET /api/research/runs` → `{runs: [run_out]}`；`run_out = {id,category,boards,status,mode,signal_count,error,narrative,created_at,started_at,finished_at}`
  - `GET /api/research/runs/{id}` → `{run, steps: [step_out], candidates: [cand_out]}`；`step_out = {seq,kind,source_id,args_digest,summary,status,seconds,error}`；`cand_out = {rank,name,platform,board,price,sales_signal,heat,keywords,score,score_basis,evidence}`
  - `GET /api/research/sources` → `{sources: [...]}`（`sources_health` 原样）

- [ ] **Step 1: 写失败测试**

`server/tests/test_research_api.py`:

```python
"""/api/research：注入假源后全链路；租户隔离；RBAC；缓存命中。"""

import pytest
from fastapi.testclient import TestClient

from ecos.config import Settings
from ecos.main import create_app
from tests.helpers_research import FakeSource, sig

FAKE_SOURCES = [
    FakeSource("s_a", "shelf", [sig("s_a", "京东", "手机支架", "heat", 500),
                                 sig("s_a", "京东", "手机支架", "price_band", 39.9)]),
    FakeSource("s_b", "content", [sig("s_b", "抖音", "磁吸支架", "heat", 900)]),
    FakeSource("s_c", "crossborder", [], fail="blocked"),
]


@pytest.fixture()
def app_factory(monkeypatch):
    def make(settings: Settings):
        import ecos.main as main_mod
        monkeypatch.setattr(
            main_mod, "default_research_sources", lambda settings, vault_lookup=None: FAKE_SOURCES
        )
        return create_app(settings)
    return make


@pytest.fixture()
def client(app_factory):
    settings = Settings(database_url="sqlite://", secret_key="test-secret",
                        gateway_base_url="http://testserver")
    app = app_factory(settings)
    with TestClient(app) as c:
        yield c


def _run_blocking(client, category="手机支架"):
    r = client.post("/api/research", json={"category": category, "blocking": True})
    assert r.status_code == 200, r.text
    return r.json()["run_id"]


def test_research_full_chain(client):
    run_id = _run_blocking(client)
    body = client.get(f"/api/research/runs/{run_id}").json()
    assert body["run"]["status"] == "partial"          # s_c 失败
    kinds = [s["kind"] for s in body["steps"]]
    assert kinds[0] == "plan" and kinds[-2:] == ["cross", "synthesize"]
    top = body["candidates"][0]
    assert top["name"] and top["evidence"] and top["heat"] > 0
    assert client.get("/api/research/sources").json()["sources"]  # 假源也在健康表


def test_research_validation_and_audit(client):
    assert client.post("/api/research", json={"category": "  "}).status_code == 400
    _run_blocking(client, "冰袖")
    actions = [a["action"] for a in client.get("/api/audit").json()["entries"]]
    assert "research.create" in actions and "research.finish" in actions


def test_research_tenant_404_and_rbac(app_factory):
    settings = Settings(database_url="sqlite://", secret_key="test-secret",
                        gateway_base_url="http://testserver",
                        auth_enabled=True, auth_mode="local")
    app = app_factory(settings)
    with TestClient(app) as c:
        with c.app.state.session_factory() as s:
            from ecos.auth.rbac import ensure_user, grant_role
            ensure_user(s, "operator-9"); grant_role(s, "operator-9", "operator")
            ensure_user(s, "approver-9"); grant_role(s, "approver-9", "approver")
            s.commit()
        tok_o = c.post("/api/auth/token", json={"user_id": "operator-9"}).json()["access_token"]
        tok_a = c.post("/api/auth/token", json={"user_id": "approver-9"}).json()["access_token"]
        run_id = TestClient(app, headers={"Authorization": f"Bearer {tok_o}"})  # 独立客户端不便，手动置头
        c.headers.update({"Authorization": f"Bearer {tok_o}"})
        rid = c.post("/api/research", json={"category": "手机支架", "blocking": True}).json()["run_id"]
        assert c.get(f"/api/research/runs/{rid}").status_code == 200
        c.headers["Authorization"] = f"Bearer {tok_a}"
        assert c.get(f"/api/research/runs/{rid}").status_code == 404        # 跨租户
        assert c.post("/api/research", json={"category": "x"}).status_code == 403  # 无 research.run
        assert "rbac.denied" in [a["action"] for a in c.get("/api/audit").json()["entries"]]


def test_cached_second_request_reuses_run(client):
    a = _run_blocking(client, "车载支架")
    r = client.post("/api/research", json={"category": "车载支架", "blocking": True})
    assert r.json()["run_id"] == a and r.json()["cached"] is True
```

（`test_research_tenant_404_and_rbac` 中那行多余 `run_id =` 赋值实施时删除，以 `c.headers.update` 流为准；approver POST → 403 断言依赖 `svc.require("research.run")` 先于任何建 run 逻辑。）

- [ ] **Step 2: 确认失败** → **Step 3: 实现**

`api/research.py`:

```python
"""研究 REST：/api/research（任务化真实选品调研）。"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from .deps import Services, get_services

router = APIRouter(prefix="/api/research")


class ResearchPayload(BaseModel):
    category: str
    boards: list[str] | None = None
    blocking: bool = False  # 同步执行（TestClient/演示用；默认后台线程）


@router.post("")
def create_research(payload: ResearchPayload, svc: Services = Depends(get_services)) -> dict[str, Any]:
    svc.require("research.run")
    run_id, cached = svc.research.create(svc.user_id, payload.category, payload.boards)
    if payload.blocking and not cached:
        svc.research.run_now(run_id)
    run = svc.research.get_run(svc.user_id, run_id)
    return {"run_id": run_id, "status": run["status"], "cached": cached}


@router.get("/runs")
def list_runs(svc: Services = Depends(get_services)) -> dict[str, Any]:
    svc.require("research.run")
    return {"runs": svc.research.list_runs(svc.user_id)}


@router.get("/runs/{run_id}")
def get_run(run_id: str, svc: Services = Depends(get_services)) -> dict[str, Any]:
    svc.require("research.run")
    detail = svc.research.get_run(svc.user_id, run_id, with_detail=True)
    return detail


@router.get("/sources")
def sources(svc: Services = Depends(get_services)) -> dict[str, Any]:
    svc.require("research.run")
    return {"sources": svc.research.sources_health(svc.user_id)}
```

`main.py`：`from ecos.research.sources import default_sources as default_research_sources`（名字保持可 monkeypatch——**模块级名导入**，工厂内调用 `app.state.research_service = ResearchService(settings, app.state.session_factory, default_research_sources(settings, vault_lookup), audit_factory...)`；`vault_lookup` 闭包：查 `ConnectorInstance` 里 kind 匹配 `src-*` 的 active 实例并用 `vault.decrypt` 解出 JSON 凭据 dict，无则 None）。deps：`Services` 增 `research: ResearchService` 字段，`get_services` 里 `research=request.app.state.research_service`。serializers：`research_run_out/research_step_out/research_candidate_out`（datetime `.isoformat()`；字段名与上面 cand_out/step_out 一致）。`ResearchService` 需要 AuditService：构造参数 `audit` 改传 `factory`，内部自开 session（Task 8 已定）。

`/api/audit` 路径以现有为准（若实际是 `/api/audits`，测试跟随改——先 `grep router.get("/audit` 确认再写死）。

- [ ] **Step 4: 全绿 + 全量回归**（≥ 186+新用例；`test_ai_endpoints.py` 的 4 个 research 用例应仍全绿——`/api/ai/research` 演示档行为不变）。

---

### Task 11: 前端 Research 页换底（真轮询 + 步骤时间线 + 证据弹层 + 源横幅）

**Files:**
- Create: `console/src/api/research.ts`、`console/src/api/research.test.ts`
- Modify: `console/src/pages/Research.tsx`
- （`src/data/ecom.ts` 的 `researchForCategory` 暂留——Competitors 页还用 `ResearchCandidate` 类型与 `platformMeta`，只删 Research.tsx 对生成函数的 import）

**Interfaces:**
- Consumes: `api.get/post`（Bearer 自动）、`useEcom().favorites/toggleFavorite`、`fmtTime`
- Produces: `research.ts`：类型 `ResearchRun/ResearchStep/ResearchCandidateRow/Evidence/SourceHealthRow`；纯函数 `nextPollStatus(run): "pending"|"done"`、`candidateToFavorite(c: ResearchCandidateRow): {name, source, heat, price(number)}`（price 取 `parsePriceMin("¥29-59"/"$12.99"→数字)`）、`parsePriceMin(s: string): number`、`stepIconFor(status)`；Research.tsx 完全重写为受控轮询组件。

- [ ] **Step 1: 先写纯函数失败测试**

`console/src/api/research.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { candidateToFavorite, nextPollStatus, parsePriceMin } from "./research";

describe("research helpers", () => {
  it("parsePriceMin 兼容 ¥29-59 / $12.99 / 9-25 USD / 空", () => {
    expect(parsePriceMin("¥29-59")).toBe(29);
    expect(parsePriceMin("$12.99")).toBe(12.99);
    expect(parsePriceMin("9-25 USD")).toBe(9);
    expect(parsePriceMin("")).toBe(0);
  });
  it("nextPollStatus 终态判定", () => {
    expect(nextPollStatus({ status: "running" } as never)).toBe("pending");
    for (const s of ["succeeded", "partial", "failed"]) {
      expect(nextPollStatus({ status: s } as never)).toBe("done");
    }
  });
  it("candidateToFavorite 映射形状", () => {
    const f = candidateToFavorite({
      rank: 1, name: "磁吸手机支架", heat: 82, price: "¥29-59", platform: "抖音",
    } as never);
    expect(f).toMatchObject({ name: "磁吸手机支架", heat: 82 });
    expect(f.source).toContain("磁吸手机支架");
    expect(f.source).toContain("rsr"); // run_id 进 source 便于溯源
  });
});
```

- [ ] **Step 2: 确认失败 → Step 3: 实现 research.ts**（`parsePriceMin` 正则 `/-?\d+(?:\.\d+)?/` 首个命中，币种无关；`candidateToFavorite(c)` 返回 `{ name: c.name, source: \`rsr ${c.run_id.slice(4, 10)} · ${c.platform}\`, heat: c.heat, price: parsePriceMin(c.price) }` ——`toggleFavorite` 入参形状以 `EcomCtx` 现签名为准，`run_id` 由调用方传入）。

- [ ] **Step 4: Research.tsx 重写**

结构保持原型五段（搜索卡 / 运行卡 / partial 卡 / 候选墙 / 清单条），数据流替换为：

```tsx
const [runId, setRunId] = useState<string | null>(null);
const [detail, setDetail] = useState<ResearchDetail | null>(null);
const [sources, setSources] = useState<SourceHealthRow[]>([]);

// 提交：POST /api/research {category} → run_id；sources 拉 GET /api/research/sources
// 轮询：useEffect(runId 存在且 status==="running") → setInterval 1500 GET /api/research/runs/{id}
// 步骤时间线：detail.steps 渲染（plan=规划、fetch=每源一行：源名+耗时+摘要/失败原因、
//   cross=交叉验证 n 信号→m 候选、synthesize=成文、agent=模型编排调用），状态色沿用 done/current/todo 三态
// partial 横幅文案改真：「{失败源名} 抓取失败（{error kind}），本报告信号覆盖 {ok}/{total}」，
//   按钮「重跑」＝再 POST 一次（快照新鲜源秒回，仅缺失源重抓）
// 候选卡：heat 条与收藏按钮逻辑不变；新增证据弹层：
```

证据弹层（卡内「依据 n 条信号」按钮 → 展开列表，逐条：源 name + metric 中文（`METRIC_LABEL: heat=热度/trend=趋势/rank=排名/sales_proxy=销量代理/price_band=价格带`）+ value 格式化 + `<a href={ev.url} target="_blank" rel="noreferrer">出处</a>`）。源横幅（搜索卡下）：`当前 {online} 个可靠源在线 · {awaiting} 个待授权 · {disabled} 个已拉闸`，tooltip 列每源 tier/health。narrative 非空时报告标题下渲染为「分析师叙述」引用块；空则不显示。`researchForCategory` import 删除；`quickCats/步骤文案` 中"连接数据源/抓取平台销量…"五条改映射真实 kinds（规划/取数/交叉验证/成文/叙述）。删掉「演示说明 mock」段落，替换为「数据源为公开榜单/指数，刷新即取最新缓存；授权源在连接器页配置」。

- [ ] **Step 5: 验证**

Run: `cd console && npm run test && npm run typecheck && npm run build`
Expected: vitest ≥ 27 passed（24 + 新 3）、tsc 零错、build 成功。

---

### Task 12: Overview 联动 + 全量回归 + 实机走查 + 文档回写

**Files:**
- Modify: `console/src/pages/Overview.tsx:108-112`（硬编码「AI 动态」首条）
- Modify: `ecos-platform/README.md`（数据源矩阵节 + ECOS_RESEARCH_* 配置表 + 红线补一条）
- Modify: `docs/specs/2026-09-19-research-real-data-design.md`（追加「## 9. 实施结果」）
- Modify: `server/ecos/research/*.py` 走查中发现的源级校准（fixture/proxy/超时）

**Interfaces:**
- Consumes: Task 10/11 全部
- Produces: 实机走查报告（spec §9）

- [ ] **Step 1: Overview 动态条真化**：组件挂载后 `api.get("/api/research/runs")`；有最近 run → 首条替换为 `{ q: "品类调研「{category}」", who: "{status 中文} · {signal_count} 信号", t: fmtTime(created_at) }`；无 run 保留现文案（不给假数据加假数据）。
- [ ] **Step 2: 全量回归**：`cd server && PYTHONUTF8=1 .venv/Scripts/python -m pytest -q`（基线 186 + 新增全绿）；`cd console && npm run test && npm run typecheck && npm run build`。
- [ ] **Step 3: 实机走查（live 模式，用户红线：必须真网络数据）**：重启后端（不带模型配置=规则层；如已配 `ECOS_MODEL_*` 则 agent 层）；browser-use `evaluate_script` 走 operator 身份（沿用现有 demo 登录态或 `/api/auth/token`）：Research 页输入「手机支架」提交 → 轮询步骤时间线截图取证（快照文本）→ 候选卡证据弹层逐个展开 → 收藏 → Overview/任务页联动检查；`partial` 场景天然存在（跨境源无代理必 unreachable），验证横幅与重跑。若全源 blocked（网络受控）：如实写进 §9 并给出 probe 脚本用法，**不得用 fixture 冒充实机**。
- [ ] **Step 4: 文档回写**：README 新增「选品调研数据源」小节（复制 spec §2 矩阵 + 合规一段 + probe 用法）；spec §9 记录：最终测试数字、7 源真实健康状态（逐源：online/blocked/layout/last_captured）、agent 层是否实机验证、走查发现的偏差。
- [ ] **Step 5: 检查点（不提交）**：`git status --short` 核对清单；汇报用户裁决点（哪些源真站结构与代表 fixture 有出入、校准了什么）。

---

## Self-Review 结论（已随写随查）

1. **Spec 覆盖**：§2 矩阵→T4/5/6；§3.1→T2/3/6；§3.2→T1；§3.3→T7/8/9；§3.4→T10；§4→T1；§5→T11/12；§6→各任务测试步 + T12 实机；§7 无越界任务。缺口：spec 提「源级 `disabled` 拉闸」→T8 `sources_health` +T1 配置承载 ✓；「快照命中 cached_run」→T8/T10 ✓。
2. **占位符扫描**：T9 的 `validate_narrative`、T10 路由给的是全文；T7 `cross_and_score` 与 T11 Research.tsx 是「骨架+完整行为规格」——两处实现者需按注释展开，属可控省略（前端保持 1:1 布局约束在 spec），其余步骤无 TBD。
3. **类型一致性**：`run_id(rsr_)`、`status: running|succeeded|partial|failed`、`kind: plan|fetch|cross|synthesize|agent`（agent kind 为 T9 新增，spec 的四种是其子集——已在 T9 测试固化）、`FetchError.kind` 六枚举（T3 落定 +T6 `unconfigured` +T3 `unreachable`）、`evidence` 元素字段与 T1 表默认值一致。`default_research_sources` 名称在 T10 测试与 main.py 装配一致。
