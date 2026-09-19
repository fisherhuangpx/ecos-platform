# ecos-platform 迁移 + console 全量对接 设计（spec）

日期：2026-09-19 ｜ 状态：待终审 ｜ 仓库：`ecos-platform`（main，本期不 commit）｜ 原型基准：`../ecos-design/ecom-proto`

## 0. 已锁裁决（对话记录）

1. 范围 = **全量真实**：交易域后端补齐 API；仅 Editing/Accounts 所属**内容域**保留 mock 并标注（内容域按 `ecos-design/docs/specs/2026-09-19-content-distribution-extension-design.md` 独立推进）。
2. AI 产出 = **端点真实 + 可插拔 ModelAdapter**（未配模型用确定性模拟；配 `ECOS_MODEL_*` 换真实模型）。
3. 前端 = **原型整体迁移 + provider→REST 换底**（方案 A）：12 页布局 1:1 复刻，不重做设计、不换组件库。
4. `server` 移入 `ecos-platform/`；`ecom-proto` 在 ecos-design 留原件；两仓库本期均不 commit（用户"先不提交"红线持续有效）。
5. 全部跨平台写操作（发布/改价/回复/退款）必须走既有任务/审批/审计引擎，不开旁路。

## 1. 仓库结构与迁移

```
D:\Develop\ai-workspace\ecos-platform\
├── server/          # 从 ecos-design/server 整体物理移动（未跟踪文件；.venv 移动后删除重建，
│                    #   venv 内烘焙了绝对路径；pip install -e ".[dev]" 复验 133 tests）
├── console/         # 新建：复制 ecom-proto 的 src/ + index.html + vite/tsconfig/tailwind
│                    #   配置 + package.json（不带 dist/node_modules），npm install
├── docs/specs/      # 本文件；后续实施计划同目录
└── README.md        # 重写为平台总览：server/console 双启动方式、生产守护、验收摘要
```

- ecos-design 侧：`server` 原位置留 `MOVED.txt` 一行指向新址；ecom-proto 原件与 README 不动。
- 命名：后端包名保持 `ecos`（导入不变）；前端工程名 `ecos-console`（package.json name 改之）。

## 2. 后端：交易域（commerce）+ AI 适配

### 2.1 新增 ORM（`ecos/models/commerce.py`，均含 user_id 租户列，风格对齐现有表）

| 表 | 关键字段 | 服务页面 |
| --- | --- | --- |
| stores | platform(taobao/tmall/douyin/pdd/jd), name, status(connected/expired/disconnected), authorized_at | Stores、Overview |
| products | store_id, sku, title, price, category, stock, sales_7d, trend(json), conv, rating, review_note | Analytics、Studio |
| orders | store_id, sku, amount, status, created_at | Overview KPI |
| favorites | ref_id, name, source, heat, price | Research→Studio |
| assets | name, type, tags(json), versions(json[{v,by,at,note}]), refs(json) | Assets（元数据 only；文件上传记边界） |
| drafts | title, price, selling_points(json), image_label, source, status | Studio→Publish |
| tickets | order_ref, customer, platform, product_name, complaint, attribution, confidence, suggestion, reply_draft, refund_amount, status, approved_at, reject_reason, reject_feedback | AfterSales |

### 2.2 端点（`/api/commerce/...`，`Services.require()` 把关，全部审计）

- stores：`GET /stores`、`POST /stores`（授权=选平台+起名，模拟 OAuth 回调一步完成）、`PATCH /stores/{id}`（状态流转 expired/disconnected/connected）、`DELETE /stores/{id}`。
- 查询：`GET /products?store_id=`、`GET /orders?store_id=&limit=`、`GET /analytics/series?store_id=`、`GET /kpis`（connected 店铺数/待审批/运行中订单聚合，替代 Overview 硬编码）。
- favorites：`GET /favorites`、`POST /favorites`、`DELETE /favorites/{id}`。
- assets：`GET/POST /assets`、`POST /assets/{id}/versions`。
- drafts：`GET/POST /drafts`、`PATCH /drafts/{id}`、`DELETE /drafts/{id}`。
- tickets：`GET /tickets`、`PATCH /tickets/{id}/review`（decision=approve → 生成 `push_reply`(±`grant_refund`) 写任务并回写"待执行"；decision=reject → 仅本地状态+reject_reason/feedback+审计）。
- `GET /api/meta`（公开，无鉴权）：`{auth_enabled, auth_mode, app_version}`——前端登录页显隐用。
- AI 端点权限映射：`POST /api/ai/research`→`research.run`；`GET /api/ai/insight`、`POST /api/ai/tickets/triage`→`ai.use`。

### 2.3 外部写 = 任务引擎（红线）

- catalog.d 新增 5 个平台沙箱连接器 YAML（`taobao-shop/tmall-shop/douyin-shop/pdd-shop/jd-shop`，gateway 模式，确定性内存适配器，与 demo_shop 同族实现）；工具：`publish_product`(write/high)、`update_price`(write/high)、`push_reply`(write/medium)、`grant_refund`(write/high)、`list_orders`(read)。
- Publish：`POST /api/commerce/drafts/{id}/publish` 校验合规（服务端规则：标题违禁词/必带平台）→ 建多步任务（每平台一步，`requires_approval` 由 scope 推导）→ 既有 decide/run/retry 闭环。原型 `finishPublish/retryFailedPlatform` 语义 = 任务步骤状态/单步重试。
- AfterSales：approveReply → `push_reply`（+含退款金额时追加 `grant_refund` 步）写任务；reject 只落 ticket 状态 + 审计。职责分离沿用 T3 红线。

### 2.4 ModelAdapter（`ecos/ai/adapter.py`）

- 协议三方法：`research_report(category)` → 候选 5 项（id/name/platform/monthly_sales/price/keywords/heat）；`insight_narrative(store, series)` → 文本；`triage_ticket(complaint)` → {attribution, confidence, suggestion, reply_draft}。
- `SimulatedAdapter`（默认）：纯函数+种子哈希，同输入同输出（测试快照可重复）；`LiveAdapter`：走 `agent/runtime.build_model`（OpenAI 兼容），`ECOS_MODEL_NAME/API_KEY/BASE_URL` 齐备时在 `create_app` 装配。
- 端点：`POST /api/ai/research {category}`（读操作，直接返回并审计 ai.research）、`GET /api/ai/insight?store_id=`、`POST /api/ai/tickets/triage`（批量给 pending 单生成归因并回写 tickets，属本地写：直接落库+审计，不涉外部平台）。

### 2.5 RBAC 扩展（seed_rbac 自动同步）

新权限码：`commerce.view`（四角色全有）、`commerce.manage`（admin/operator；stores/drafts/assets/favorites 写）、`research.run`、`ai.use`（admin/operator）、`ticket.review`（admin/operator/approver）。审批仍用既有 `task.approve`。

### 2.6 Seed 数据

dev/测试首启（与 RBAC 种子同处）写入"蓝海优品"剧本：5 店（4 connected 1 expired）、~12 SKU、订单流水 30 天、3 资产、2 售后单、空 drafts/favorites。auth 模式多租户下按 default_user 播种；跨用户一律 404 兜底（沿用 F1 口径）。

## 3. 前端：console 数据层换底

- **复制迁移**：ecom-proto src 全量入 `console/`；路由、Shell、动效、ApprovalGate 组件原样保留。新增依赖仅 vitest(dev)；自写 `src/api/client.ts`（约 60 行：fetch、Bearer 注入、401→登出跳登录、错误归一 `{status, detail}`）。
- **EcomProvider 换底**：对外接口签名不变（页面组件零改动为验收标准），内部改 API + 重取；mutation 语义映射：addStore→POST /stores、setStoreStatus→PATCH、submitPublish→drafts publish 任务、approveTask/rerunTask→decide/retry、audits→GET /api/audit（level/result 映射进 mappers）。`data/ecom.ts` seed 清空，`platformMeta` 等展示常量留下。
- **mappers**：`src/api/mappers.ts` 单点转换（`pending_approval`→"待审批"、`high_risk`→"高危"、`ok/denied/failed`→原型 result 色板、任务 steps→发布结果卡）。
- **ContentProvider（Editing/Accounts）**：保持本地 mock；两页头部挂「示例数据」徽标组件；provider 接口即未来接缝。
- **登录/RBAC**：`GET /api/meta.auth_enabled=false` → 无登录页（现行为）；true → 未登录跳 `/login`（user_id 换 local 令牌；auth_mode=oidc 时"企业 IdP 登录"占位禁用）；登录后 `/auth/me` 权限码驱动侧栏项与操作按钮显隐；Shell 席位徽标显示真实 display_name/roles。
- **错误 UX**：403→toast「权限不足」；409→复用 ApprovalGate 提示样式（未审批/并发执行中）；网络失败→顶部重试条；404→空态。
- **dev 联调**：vite proxy `/api → http://localhost:8000`；生产构建产物托管方式记边界（本期 nginx/静态目录说明，不做 uvicorn StaticFiles）。

## 4. 测试与验收

- 后端 TDD：commerce CRUD/任务化发布端到端（建任务→审批→执行→单步失败→retry）/AI 三端点（Simulated 快照）/RBAC 新码/租户 404/`/api/meta`；现有 133 基线不破。
- 前端：`tsc --noEmit` 零错；vitest：client 错误归一 + mappers 全量映射 + EcomProvider 关键 action（mock fetch）；`vite build` 通过。
- 实机走查（browser-use，两模式）：dev 模式全链路（登录隐藏、店铺→选品→收藏→主图→草稿→发布→审批→审计）；auth 模式（登录、viewer 侧栏收敛、发起人自批 403、并发 409 提示）；Editing/Accounts 显示「示例数据」。
- 交付：两仓库不 commit；README 双启动说明；本 spec 增补实施计划于 `docs/specs/`。

## 5. 边界（本期不含）

内容域后端（posts/editJobs/insights/watches/messages 真实化）、资产文件二进制上传、OIDC 前端重定向流、uvicorn 托管静态站点、电商真实平台适配器（沙箱适配器即其替身接口）、跨进程分布式锁。

## 6. 实施结果（2026-09-19 收尾）

**回归基线（收尾时点重新跑）**：后端 `pytest -q` **186 passed**（含认证模式补测 2 例）；前端 `vitest run` **24 passed**（client 9 / mappers 10 / EcomProvider 5）、`tsc --noEmit` 零错、`vite build` 4.92s 通过（仅 chunk>500kB 提示）。

**实机走查结论（browser-use，快照取证；进程内浏览器无可见表面，截图与指针事件不可用，全部交互以脚本驱动 DOM 完成）**：

- dev 模式：Overview/Stores/Assets 显示真实种子数据；连接器安装 5 个（审计 5×connector.install）；调研→候选→收藏真实落库（`POST /api/commerce/favorites`，刷新可回读）；curl 建草稿后 Publish 页下拉框出现该草稿；提交→审批闸门（目标「淘宝、抖音」由后端 payload 渲染）→批准并执行→结果卡两平台均「成功」（读自任务 steps，非前端伪造）；任务中心两张任务卡、审计流水覆盖 draft_create→publish→approval→step(高危)→finished→ai.triage→ticket.approve 全链路；售后页 AI 归因（置信度 0→94%）→批准发出→派生售后任务待审批→任务中心批准→成功。
- auth 模式（ECOS_AUTH_ENABLED=true，DB 副本）：登录页 + local 模式快捷身份芯片；viewer-1 登录后侧栏收敛（主图工坊/商品上架隐藏，席位徽标「viewer · 4 项权限」）且租户隔离生效（0 个连接器、只见本人数据）；operator-1 建发布任务后在审批闸门自批 → 后端 **403**、审计记 `rbac.denied`、前端 alert 提示。
- auth 模式走查暴露并修复两处真实缺口（均为「认证开启后审批闭环断裂」）：
  1. **审批收件箱**（后端）：`GET /tasks` 原按属主隔离，approver 看不到任何待审批任务、也无从触发执行 → 认证模式下持 `task.approve` 者额外可见他人 `pending_approval` 任务；`POST /tasks/{id}/run` 允许审批人触发「已批准待执行」的他人任务（权限 403 仍先于租户 404；步骤凭据按 `task.user_id` 解析，仍用属主连接器）。补测 2 例（收件箱可见性、批准前 run 404/批准自己决策后 run 成功），后端 184→186。
  2. **决策身份**（前端）：`approveTask` 硬编码 `approver: "当前用户"`，认证模式禁止代批 → **400**。改为从会话取真实 user_id（`auth/session.tsx` 导出非 hook 的 `currentUserId()`，无 AuthProvider 的单测回退原字符串），24 测/类型检查全绿。
  复验：approver-1 在任务中心点「批准执行」→ decide 200 + 跨属主 run 200 → 任务「成功」并从收件箱消失；operator-1 侧同一任务显示成功、步骤 taobao 完成；审计页 `approval.approve` actor=approver-1，职责分离闭环实机成立。
- 走查中修复一处真 bug：受保护页整页刷新时数据层先于令牌恢复发起无 Authorization 请求→401 误登出。修复为 `EcomScoped` 在 `ready` 前不挂载数据层、未登录时仅渲染路由外壳（`console/src/main.tsx`）。

**已知偏差（相对本 spec）**：

1. `EcomCtx` 写操作改为返回 Promise（提交后需真实任务 id），Publish.tsx 的 submit/run 相应加 await——「页面组件零改动」仅此一处破例。
2. 平台失败重试为任务级（重跑全部失败步骤），非 spec 暗示的单平台粒度（后端 retry 语义如此）。
3. 停止运行中任务仅前端红线提示，无服务端中断 API。
4. `audit()` 前端埋点改静默 no-op（写操作审计全部服务端生成）。
5. toast 以 `window.alert` 代替；409 复用 ApprovalGate 提示的场景由 decide/run 调用序近似。
6. Editing/Accounts 保留 mock + 「示例数据」徽标（符合 spec）；此外调研分步动画与 Analytics/Insights/Overview 图表序列仍读本地常量（后端 AI/分析端点已就绪并过测，属后续收尾项）。
7. `TaskStatus` 联合扩展「排队中/已驳回」以覆盖后端状态机。
8. 走查取证为结构快照文本而非 PNG（环境限制）。
