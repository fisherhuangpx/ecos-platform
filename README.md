# ecos-platform

AGP 电商运营平台：`server/`（FastAPI 后端）+ `console/`（Vite + React 前端控制台）。
前端按 ecom-proto 原型 1:1 复刻，全部交易域 / 连接器 / 任务 / 审批 / 审计 / AI 数据走真实 REST API。

## 快速启动

### 后端（server/）

```bash
cd server
python -m venv .venv
.venv/Scripts/pip install -e ".[dev]"        # Windows；Linux/mac 用 bin/pip

# 开发模式（免登录，默认 sqlite）
PYTHONUTF8=1 .venv/Scripts/python -m uvicorn ecos.main:create_app --factory --host 127.0.0.1 --port 8000

# 认证模式（本地自签 JWT）
PYTHONUTF8=1 ECOS_AUTH_ENABLED=true .venv/Scripts/python -m uvicorn ecos.main:create_app --factory --host 127.0.0.1 --port 8000
```

注意入口是工厂函数：必须 `ecos.main:create_app --factory`。

测试：`PYTHONUTF8=1 .venv/Scripts/python -m pytest -q`（238 项）。

### 前端（console/）

```bash
cd console
npm install
npm run dev          # http://localhost:5173，/api 代理到 :8000
npm run test         # vitest，27 项
npm run typecheck    # tsc --noEmit
npm run build        # 产物 dist/
```

## 环境变量（前缀 ECOS_）

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `ECOS_ENV` | `dev` | `production` 时守护生效 |
| `ECOS_DATABASE_URL` | `sqlite:///./ecos.db` | 任意 SQLAlchemy URL |
| `ECOS_SECRET_KEY` | dev 占位 | `ECOS_ENV=production` 下必须显式提供，否则启动即报错 |
| `ECOS_AUTH_ENABLED` | `false` | 关闭时全量视图（身份=dev-user），开启后所有数据按登录用户隔离 |
| `ECOS_AUTH_MODE` | `local` | `local` 走 `POST /api/auth/token` 自签；`oidc` 预留企业 IdP |
| `ECOS_MODEL_NAME` / `ECOS_MODEL_API_KEY` | 空 | 配置后 AI 端点走真实模型适配器，否则 Simulated 确定性输出 |
| `ECOS_RESEARCH_ENABLED` | `true` | 选品调研总开关 |
| `ECOS_RESEARCH_SOURCE_TTL` | `21600` | 快照缓存秒数（6h），TTL 内重跑秒回缓存 |
| `ECOS_RESEARCH_RUN_BUDGET` / `ECOS_RESEARCH_SOURCE_TIMEOUT` | `120` / `10` | 单次 run 网络预算 / 单源请求超时（秒） |
| `ECOS_RESEARCH_PROXY_URL` | 空 | 跨境源（Google Trends / Amazon）出境代理；空则跨境源标 `unreachable` 自动降级 |
| `ECOS_RESEARCH_DISABLED_SOURCES` | 空 | 逗号分隔源 id，应急拉闸不发版 |

## 身份与 RBAC

登录（local 模式）：`POST /api/auth/token {user_id}` → Bearer 令牌（TTL 8h）。用户首次使用 `POST /api/admin/users` + `/roles` 授权（admin 或开发模式下操作）。

| 角色 | 权限要点 |
| --- | --- |
| `admin` | 全部 16 项，含 `user.manage`、`task.approve` |
| `operator` | 交易域读写、连接器安装/撤销、任务创建/执行/重试、AI 与工单裁决；**无 `task.approve`** |
| `approver` | 查看 + `task.approve` + `ticket.review`；不做日常运营写操作。认证模式下 `GET /tasks` 额外可见他人 `pending_approval` 任务（审批收件箱），并可对已批准的他人任务触发执行（步骤凭据仍按属主解析） |
| `viewer` | 只读 4 项：`connector.view` / `task.view` / `approval.view` / `commerce.view` |

## 信任红线

- 外部平台写操作（上架、售后回复）只能由任务引擎在**人工审批通过后**执行，审批闸门不可跳过。
- 审批人身份取自令牌，服务端强制**审批人 ≠ 任务属主/发起人**，违规返回 403 并记 `rbac.denied` 审计。
- 写操作 100% 落审计流水（`GET /api/audit`），可回看批准人/时间/对象。
- 跨租户访问统一 404（不泄露资源存在性）；权限校验（403）先于租户校验（404）。
- 选品调研只抓**完全公开**的页面/接口：限频（单源 ≥2s 间隔）+ 声明式公开 UA + 只读 GET；**永久禁止登录态强爬**（绕过技术措施有刑事风险）；无公开面的盘（小红书等）只留 licensed 壳位不实现。

## 选品调研数据源

三档：**live**（公开页面/接口直抓，无需凭据）/ **official**（官方开放平台壳，配好连接器凭据即启用）/ **licensed**（持牌第三方 API 壳）。

| 源 id | 盘 | 信号 | 档位 |
|---|---|---|---|
| `douyin_hot` 抖音热搜榜 | 内容 | 需求脉冲（heat） | live |
| `jd_rank` 京东公开榜 | 货架 | 类目榜排名、价格带 | live |
| `ali1688_hot` 1688 热搜词 | 货架 | 供给侧热度、出厂价带 | live |
| `baidu_index` 百度指数 | 货架 | 品类搜索趋势 | live（可降级） |
| `juliang_trend` 巨量算数 | 内容 | 内容侧搜索指数 | live（可降级） |
| `google_trends` | 跨境 | 需求趋势对比 | live（需代理） |
| `amazon_bestsellers` | 跨境 | 类目榜、评论数代理销量 | live（需代理） |
| `taobao_open` 淘宝开放平台 | 货架 | 官方真实销量 | official 壳 |
| `chanmama` 蝉妈妈开放 API | 内容 | 抖音电商 GMV 级数据 | licensed 壳 |

- 规则层（plan→fetch→cross→synthesize）不依赖大模型，候选数字全部来自信号池并可点开证据链（源名 + 指标 + 数值 + 出处链接）；配置 `ECOS_MODEL_*` 后 agent 层只做编排与叙述，叙述中的数字若不在证据包中该句被裁掉。
- official/licensed 源不进凭据（连接器页配置）就不出现在可用清单，`GET /api/research/sources` 标 `awaiting_credentials`。
- 网站改版排障：`cd server && PYTHONUTF8=1 .venv/Scripts/python scripts/research_probe.py <source_id> [品类]` 真网抓一次并回写 fixture；对应 `tests/fixtures/research/` 纯函数测试离线重放。

## 前端数据来源与「示例数据」标注

- 真实接口：店铺/商品/订单、草稿、收藏、素材、连接器目录与实例、任务/审批/审计、售后工单、AI 归因与分诊、选品研究。
- 仍是本地演示（页面带「示例数据」角标）：**自动剪辑、账号矩阵**。
- 经营分析/内容洞察/总览的图表序列仍读本地常量（后端对应端点已就绪，属收尾项）；选品调研页与总览「最近会话」首条已全量走真实 run 数据。

## 已知偏差（相对 spec）

1. `retryFailedPlatform` 重跑该任务全部失败步骤，非单平台粒度（后端 retry 语义即如此）。
2. 停止运行中任务仅前端提示，无服务端中断 API（红线：不可绕闸门）。
3. 发布/售后写操作失败时前端以 `window.alert` 代替 toast。
4. 剪辑/账号矩阵保留原型 mock（内容域后端建设中）。
5. 选品调研已真实化（见「选品调研数据源」节）；经营分析图表数据仍为本地生成。
