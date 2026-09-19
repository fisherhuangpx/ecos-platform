# 选品调研真实化设计（research real-data）

日期：2026-09-19 · 状态：已实施（T1–T12 完成，见 §9；按红线未 git 提交） · 前置：`2026-09-19-platform-console-design.md`（其第 6 节偏差 6 是本设计的立项起点）

## 0. 已锁裁决（对话记录）

1. **全平台盘都做**：货架（淘系/京东/拼多多）+ 内容（抖音/小红书）+ 跨境（Amazon/TikTok/全球需求），不砍盘。
2. **统一抽象 + 配置支持**：官方 API、持牌第三方、公开页面抓取是同一接口的三种实现；启用哪些由配置/凭据决定，缺源降权不写死。
3. **任务化运行，研究步骤与结果落库**（否掉同步端点方案）。
4. **架构取方案三**：run/step/candidate 独立落库（不碰 TaskEngine 红线区），但源的声明契约与凭据管理对齐现有连接器风格（JSON schema 工具声明 + CredentialVault）。
5. **真实数据与是否配大模型解耦**：取数、打分、交叉验证不需要 LLM；LLM 只做规划编排与叙述，**候选数值永远来自数据层计算，模型不改数字**。
6. 全程照旧 **不 git commit**。

## 1. 问题陈述

现状 `POST /api/ai/research` 两档都不碰真实数据：`SimulatedAdapter.research_report` 从抄自原型的 6 行底表按 md5 轮转（`server/ecos/ai/adapter.py:31-73`）；`LiveAdapter.research_report` 让 LLM 凭记忆报数（`adapter.py:140-155`），销量与热度是编造出来的。"热门商品选品 agent 自主分析"要求：可靠的真实数据源 + 可回看的自主分析过程 + 有证据链的结论。

## 2. 数据源矩阵

三档属性：**live**（首批真实实现，公开页面/接口）/ **official**（官方开放平台 API 位，填入凭据即启用）/ **licensed**（持牌第三方付费 API 位）。

| 盘 | 源 | 信号 | 档位 |
|---|---|---|---|
| 货架 | 京东公开榜（rank 页） | 类目热销榜排名、价格带 | live |
| 货架 | 1688 批发热销/热搜 | 供给侧热度、出厂价带（淘系热榜锁在生意参谋，1688 是免费面最诚实的代理） | live |
| 货架 | 百度指数 | 品类搜索需求趋势 | live（需 cookie 握手，可降级源） |
| 货架 | 淘宝/天猫开放平台 · 京东商智 · 拼多多开放平台 | 官方真实销量 | official |
| 内容 | 巨量算数（抖音指数）热点/品类趋势 | 内容侧热度、搜索指数 | live |
| 内容 | 抖音热搜榜公开页 | 需求脉冲 | live |
| 内容 | 蝉妈妈 / 飞瓜 | 抖音电商 GMV 级数据 | licensed |
| 内容 | 千瓜 / 陈红（小红书） | 种草热度 | licensed（无公开 API、反爬强，不做直抓） |
| 跨境 | Google Trends | 需求趋势对比 | live（经 `ECOS_RESEARCH_PROXY_URL`） |
| 跨境 | Amazon Best Sellers 公开页 | 类目榜、评论数代理销量 | live |
| 跨境 | Keepa / 卖家精灵 | 历史价格与销量 | licensed |

合规红线（写进代码注释与 README）：live 源只碰**完全公开页面/接口**，限频 + 公开 UA + robots 遵从；**禁止登录态强爬**（绕过技术措施的爬取有刑事案例）；小红书类无公开面的盘只留位不实现。

## 3. 后端：`ecos/research/` 子域

### 3.1 源抽象（`ecos/research/sources/base.py`）

```python
class Signal(TypedDict):        # 所有盘归一到这一种结构，交叉验证才有共同语言
    source_id: str
    platform: str               # 淘宝/京东/拼多多/抖音/小红书/Amazon/...
    keyword: str                # 归一化关键词或商品名
    metric: str                 # heat | trend | rank | sales_proxy | price_band
    value: float
    window: str                 # 如 "7d" / "2026-09-19"
    url: str                    # 证据出处
    captured_at: datetime

class ResearchSource(ABC):
    id: str; board: str         # shelf | content | crossborder
    tier: str                   # live | official | licensed
    ttl_seconds: int            # 快照缓存时长，默认 6h
    auth: str                   # "none" | "vault:<kind>"
    def capabilities(self) -> dict      # JSON schema 工具声明（agent 面）
    def validate(self, args: dict) -> list[str]   # 对齐 ConnectorDef.arg_errors 风格
    def fetch(self, args: dict) -> list[Signal]    # 失败抛 FetchError(kind)
```

- `ScraperSource(ResearchSource)`：声明式（url 模板、选择器/jsonpath、headers、限频、可选 proxy），**解析是纯函数** `parse(response_text) -> list[Signal]`，喂 fixture 即测。失败分类：`timeout | blocked(反爬) | layout(改版) | empty`，只记不抛。
- `VaultApiSource(ResearchSource)`：official/licensed 位。凭据从现有 `CredentialVault` 按 `vault:<kind>` 实例取；**未配置实例的源不进可用清单**，`GET /sources` 标 `awaiting_credentials`。本期只交付两个代表壳——`taobao_open`（official 代表）与 `chanmama`（licensed 代表），其余同档位源到计划期只登记声明不建模块；均不含真实 HTTP 对接。
- live 首批 7 个源各一个模块（`jd_rank.py`、`ali1688_hot.py`、`baidu_index.py`、`juliang_trend.py`、`douyin_hot.py`、`google_trends.py`、`amazon_bestsellers.py`），其中 `baidu_index`（cookie 握手）与 `juliang_trend`（登录墙边缘）最脆弱，允许实现为"blocked 即降级"的源而不阻塞验收。

### 3.2 落库模型（`ecos/models/research.py`，均含 user_id 租户列，风格对齐 commerce.py）

- `ResearchRun`：id(`rsr_`)、category、boards(JSON)、status(`running|succeeded|partial|failed`)、mode(`rule|agent`)、signal_count、error、tokens_in/out、created_at/started_at/finished_at。
- `ResearchStep`：run_id、seq、kind(`plan|fetch|cross|synthesize`)、source_id、args_digest、summary、status(`ok|failed|skipped`)、seconds、error。
- `ResearchCandidate`：run_id、rank、name、platform、board、price、sales_signal、heat(0-100)、keywords(JSON)、**evidence(JSON：`[{signal 指针, source_id, url, captured_at}]`，每条候选必须可点开看到支撑信号)**、score、score_basis(JSON 权重快照)。
- `SourceSnapshot`：source_id、query_key(source_id+args 哈希)、payload(JSON)、captured_at。TTL 内直接复用，去重网络与费用；`SourceFetchLockTable` 不需要——用进程内 `dict[key, threading.Lock]`（对齐 `tasks/engine.py:20-26` 的写法）防同 key 并发抓。

收藏链路不变：`POST /api/commerce/favorites`，detail 里带 run_id + candidate rank。

### 3.3 运行流水线（`ecos/research/pipeline.py`）

第一层 · 规则聚合（默认，无 LLM 全程可用）：

1. **plan**：品类 → 每盘每在线源一条 fetch 计划（step 落库）。
2. **fetch**：先查 `SourceSnapshot`，过期才真抓；结果入信号池并写快照。
3. **cross**：同名/近名候选聚合，多源信号做排名相关性；**单源孤证自动降权 ×0.6 并标注**。
4. **synthesize**：透明打分 `score = Σ wᵢ·z(metricᵢ)`（权重常量表 + 快照进 score_basis），产出候选表。

第二层 · agent 自主（`ECOS_MODEL_*` 齐备时，mode=agent）：

- 把在线源 capabilities + `read_signals` + `finish` 注册为 AgentScope 工具，ReAct 循环自主决定：查哪些源、信号矛盾时补查哪个、何时收口。
- **硬约束**：①工具只读（无写外部平台能力可注册）；②最终叙述经校验——正则抽取其中出现的数字，必须能在证据包中找到出处，否则裁掉该句并记 step；③候选表数值始终来自第一层计算，模型输出只增 `narrative` 字段。
- 复用 `agent/runtime.py::build_model`；LiveAdapter 的 `research_report` 改走本流水线（旧"凭记忆报数"路径删除，`SimulatedAdapter.research_report` 保留仅用于测试基座）。

执行：后台线程（FastAPI 启动时挂一个 `ThreadPoolExecutor(max_workers=2)`），run 预算 120s、单源 10s。降级：单源失败 → step failed、run 继续；全部源失败 → failed；部分成功 → **partial** 且候选表带"信号覆盖 n/m"。

### 3.4 REST（`server/ecos/api/research.py`，挂 `/api/research`）

| 端点 | 权限 | 语义 |
|---|---|---|
| `POST /api/research {category, boards?}` | `research.run` | 建 run 后台执行；同品类快照全新鲜时返回 `cached_run`；返回 run_id |
| `GET /api/research/runs` | `research.run` | 租户内列表（倒序） |
| `GET /api/research/runs/{id}` | `research.run` | run + steps + candidates；跨租户 404 |
| `GET /api/research/sources` | `research.run` | 声明源清单：tier/在线状态/最近健康/awaiting_credentials |

审计：`research.create`、`research.finish(ok|partial|failed)` 两条流水；步骤明细靠 step 表不灌审计。RBAC 不新增权限码（admin/operator 已有 `research.run`，approver/viewer 不含——查看研究报告视为运行权同源，如需放开记偏差）。

## 4. 配置（`Settings` 扩展，env 前缀 `ECOS_`）

- `research_enabled: bool = True`
- `research_source_ttl: int = 21600`（秒）
- `research_run_budget: int = 120` / `research_source_timeout: int = 10`
- `research_proxy_url: str = ""`（Google Trends/Amazon 出境通道，空则跨境源标 `unreachable` 自动降级）
- `research_disabled_sources: str = ""`（逗号分隔源 id，应急拉闸）

## 5. 前端（console）

- `pages/Research.tsx` 换底：删除本地常量动画 → 提交后 1.5s 轮询 run → **步骤时间线**（源、耗时、结果摘要、失败原因）→ 候选表（heat 条、价格、**证据链弹层**逐条列 Signal 与源 URL 链接）→ 收藏按钮走现有 favorites API。
- 顶部横幅：`当前 n 个可靠源在线 · m 个待授权 · 最近快照 x 小时前`（读 `GET /sources`）。
- `store/ecom.tsx`：`runResearch` 改 Promise 返回 run_id + `researchRunsRef` 轮询态；`ecom.test.tsx` 相应改桩。
- Overview 页调研动画改读最近一次真实 run 的候选（收掉一期偏差 6 的后半段）。
- 无真实 run 时 Research 页显示空态引导，而非假数据。

## 6. 测试与验收

- 后端：每 live 源一个 fixture 文件驱动 `parse` 纯函数测试（零网络）；FakeSource 注入信号池跑全流水线，打分/降权/覆盖度标注做快照断言；mock 模型返回写死的 tool-call 序列，断言 step 落库完整 + "模型不改候选数字"红线；租户外 404、RBAC、预算超时用例。pytest 基线 186 只增不减。
- `@pytest.mark.external`：真网验选择器，默认 addopts skip，网站改版后手动 `-m external` 跑。
- 前端：vitest 24 基线不降，Research 换底加桩改测；`tsc --noEmit` 零错。
- 实机验收：认证模式下 operator-1 真跑「手机饰品」→ partial/succeeded 步骤时间线可见、候选带可点证据链 → 收藏落库 → 审计两条目。

## 7. 边界（本期不含）

- 小红书/拼多多官方数据对接（只有壳）；登录态抓取（法律红线，永久不做）。
- official/licensed 壳的真实 HTTP 对接（凭据到位后另立小期）。
- 定时自动重跑（调度器）、跨进程/分布式抓取协调、代理池管理。
- Analytics/Insights 图表真实化（另一遗留项，不在本域）。

## 8. 风险与对策

| 风险 | 对策 |
|---|---|
| 公开页面反爬升级导致 live 源批量失效 | 解析纯函数 + external 冒烟分离，改版只动声明与 parse；源级 `disabled` 拉闸不用发版 |
| 跨境源在本机网络不可达 | proxy 配置 + 不可达自动降级标 `unreachable`，报告注明覆盖度 |
| 模型幻觉包装数字 | 数字全部来自数据层 + 叙述出处校验（§3.3 硬约束②） |
| 抓取拖慢体验 | 快照 TTL 命中 + 后台线程不占 HTTP；run 预算 120s 兜底 |
| SQLite 并发写（后台线程 + 请求线程） | 独立 session_factory 用法对齐 TaskEngine 后台执行既有模式；写冲突概率低（run 行独占） |

## 9. 实施结果（2026-09-19 实机走查）

计划：`docs/plans/2026-09-19-research-real-data.md`（T1–T12 全部完成，未提交）。

**测试数字**：server pytest **238 passed**（基线 186 只增不减）；console vitest **27 passed**、`tsc --noEmit` 零错、`vite build` 成功。解析测试全部走 `tests/fixtures/research/` 离线重放，零网络进基线。

**逐源真实健康**（本机网络，2026-09-19；排障用 `server/scripts/research_probe.py <source_id> [品类]`）：

| 源 | 实机结果 |
|---|---|
| douyin_hot | **online**，真站返回 50 条真实热搜信号（JSON 顶层 `data.word_list`，与初版按 `word_list` 直取不同，已校准） |
| jd_rank | 降级 `empty`：榜单页为 CSR 壳，静态 HTML 无商品信号；parse 按空信号抛错设计内处理 |
| ali1688_hot | 降级 `blocked`：返回 punish 反爬页；设计内只记不抛 |
| baidu_index / juliang_trend | 降级 `blocked`：cookie 握手/登录墙，spec §3.1 即允许"blocked 即降级" |
| google_trends / amazon_bestsellers | `unreachable`：本机无出境通道，配 `ECOS_RESEARCH_PROXY_URL` 后启用；解析由 fixture 覆盖（Amazon 页面为人民币价 `_cDEzb_p13n-sc-price` 变体，fixture 已按真站校准） |
| taobao_open / chanmama | `awaiting_credentials`：壳不建真实 HTTP 对接（§7 边界） |

**agent 层未实机验证**：本机未配 `ECOS_MODEL_*`，全部实机 run 为 `mode=rule`。工具注册、叙述数字出处校验（不在证据包即裁句）、"模型不改候选数字"红线均由 mock 模型测试覆盖（T9）。

**实机走查（浏览器 :5173，dev 免登录身份 dev-user）**：提交「手机支架」→ 快照新鲜秒回 cached partial run（横幅如实列 8 源失败原因、信号覆盖 1/9）；新品类 run 中轮询可见步骤时间线（每源一行：源名+耗时+失败 kind，如 `empty: 源 jd_rank 该品类无命中信号`）；证据弹层展示真实抓取值（抖音热度 11,106,952 + 出处链接）；收藏落 `/api/commerce/favorites` 并出现在总览审计；「桌面收纳」等品类最终 failed 并显示 `无可用信号（1 源成功 / 8 失败 / 0 跳过，50 信号被品类相关性过滤）`——今日抖音热榜为新闻/娱乐脉冲，无任何品类相关词，门控后宁可不给结果也不编数（符合"不给假数据加假数据"）。

**走查发现的偏差与修正**（均已固化回归测试）：
1. **args 污染**：源在 `fetch` 内就地补默认参数（`jd_rank.setdefault("cat", …)`、`google.setdefault("geo", …)`）毒化共享 args，导致后续源契约检查报 `未声明参数: cat`。修正：流水线传 `{**args}` 副本 + 回归测试。
2. **品类相关性门**（计划缺口）：抖音热榜是全品类榜单，初版直接把「沙特首都利雅得遭空袭」送上候选榜首。cross 步前新增 `is_category_relevant`（归一化互含 + 2-gram 回退）过滤信号池；`run.signal_count` 口径改为过滤后数量。
3. step error 双前缀（`empty:empty: …`）：`FetchError.__str__` 已含 kind，直接截断存 `str(exc)[:120]`。
4. T10 计划测试断言有误（approver 跨租户取 run 期望 404）：与红线"403 先于 404"冲突，改为 403；另备持 `research.run` 用户验证跨租户 404。
5. cached 命中语义：只要**取数成功源**的快照新鲜即可缓存复用，失败源不阻塞缓存（「重跑」可能秒回同一 run；想强制重抓需等 TTL 或拉闸后重试）。
6. 后台线程测试改 joinable runner：内存 sqlite StaticPool 共享连接下，主线程轮询读与后台写竞争造成偶发 `failed`，改显式 `thread.join` 消除。
