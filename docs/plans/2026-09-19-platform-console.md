# ecos-platform 迁移 + 交易域 + console 全量对接 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 ecos server 迁入 ecos-platform，补齐交易域与 AI 可插拔后端，并把 ecom-proto 原型 1:1 迁移为真实对接的 ecos-console。

**Architecture:** 后端在既有 FastAPI/SQLAlchemy 领域层上新增 commerce 域与 ModelAdapter；所有跨平台写操作复用既有任务/审批/审计引擎（5 个平台沙箱连接器为执行载体）。前端复制原型全部页面/布局，仅将 EcomProvider 从内存 mock 换底为 REST + mappers，内容域（Editing/Accounts）保留 mock 并标注。

**Tech Stack:** Python 3.12 / FastAPI / SQLAlchemy 2 / PyJWT（既有）；Vite 6 / React 18 / TS 5.6 / Tailwind 4 / react-router 6（原型栈，不加组件库）；vitest（新增，仅 devDep）。

**Spec:** `D:\Develop\ai-workspace\ecos-platform\docs\specs\2026-09-19-platform-console-design.md`（执行时先读 spec 再读本计划）

## Global Constraints（每个任务隐含遵守）

- **禁止 git commit/push**（用户"先不提交"红线；计划中所有"检查点"仅跑测试，不做版本控制操作）。
- 后端测试命令一律 `cd server && PYTHONUTF8=1 .venv/Scripts/python -m pytest -q`（Windows Git Bash）；venv 位于 `server/.venv`，与 luckybench 的 `.venv-2x` 互不共用。
- TDD 铁律：先写失败测试并实际跑出 RED，再实现转 GREEN；无新输出不得宣称通过。
- 每个端点必须有 `svc.require(<权限码>)`、租户过滤（非本人资源 404 不泄露存在性）、审计留痕；外部写只能经 TaskEngine。
- 前端保持原型布局/文案/动效 1:1；换底只动 `src/store/*、src/data/*、新增 src/api/*` 与登录页，页面组件改动以"零改动"为目标（数据形状经 mappers 对齐）。
- 已知偏差（记录进 README）：原型 `stopTask`（停止运行中任务）后端无对应能力且引擎为同步执行，按钮置 disabled + tooltip「暂不支持」；编辑域 `editingTasks` 三项 action 保持 provider 本地 mock。

---

### Task 1: server 迁入 ecos-platform（纯迁移零代码改动）

**Files:**
- Move: `D:\Develop\ai-workspace\ecos-design\server\**` → `D:\Develop\ai-workspace\ecos-platform\server\**`（整目录物理移动；ecos-design 侧原位置建 `server/MOVED.txt`，内容一行：`moved to D:\Develop\ai-workspace\ecos-platform\server on 2026-09-19`）
- Delete & rebuild: `server/.venv`（venv 烘焙绝对路径，移动后必毁，重装即可）

**Interfaces:**
- Consumes: 无
- Produces: `ecos-platform/server/` 可运行基线（133 tests），后续所有后端任务的落点

- [ ] **Step 1: 确认 ecos-design 侧无进程占用后移动目录**

```bash
mv /d/Develop/ai-workspace/ecos-design/server /d/Develop/ai-workspace/ecos-platform/server
echo 'moved to D:\Develop\ai-workspace\ecos-platform\server on 2026-09-19' > /d/Develop/ai-workspace/ecos-design/server/MOVED.txt
```
（注意：mv 后需先 `mkdir -p ecos-design/server` 再写 MOVED.txt，顺序如上不可换）

- [ ] **Step 2: 重建 venv 并安装**

```bash
cd /d/Develop/ai-workspace/ecos-platform/server
rm -rf .venv && python -m venv .venv
PYTHONUTF8=1 .venv/Scripts/python -m pip install -q -e ".[dev]"
```
Expected: 无报错；`pip show ecos-server` 显示 Version 0.1.0

- [ ] **Step 3: 回归检查点（不 commit）**

Run: `PYTHONUTF8=1 .venv/Scripts/python -m pytest -q`
Expected: `133 passed`。若失败：先查是否残留绝对路径（grep -rn "ecos-design" ecos/ tests/ 应为 0 命中）。

### Task 2: commerce ORM + 种子数据

**Files:**
- Create: `server/ecos/models/commerce.py`
- Modify: `server/ecos/models/__init__.py`（导出新模型，确保 `Base.metadata` 建表覆盖）
- Create: `server/ecos/commerce/__init__.py`、`server/ecos/commerce/seed.py`
- Modify: `server/ecos/main.py`（seed 块内调用 `seed_commerce`，仅当该 user 无 stores 行时写入）
- Test: `server/tests/test_commerce_models.py`

**Interfaces:**
- Consumes: `models/base.py` 的 `Base, new_id, utcnow`
- Produces: 模型类 `Store, Product, Order, Favorite, Asset, Draft, Ticket`（字段见 spec 2.1；均含 `user_id: Mapped[str]` 索引列、`id = new_id("<前缀>")`，前缀 st/po/or/fv/as/dr/tk）；`seed_commerce(session, user_id: str) -> None`

- [ ] **Step 1: 写失败测试**

```python
# tests/test_commerce_models.py
from sqlalchemy import select
from ecos.commerce.seed import seed_commerce
from ecos.models import Asset, Draft, Favorite, Order, Product, Store, Ticket

def test_seed_is_idempotent(session):
    seed_commerce(session, "u1"); session.commit()
    first = len(session.execute(select(Store)).scalars().all())
    seed_commerce(session, "u1"); session.commit()
    assert first == 5 and len(session.execute(select(Store)).scalars().all()) == 5

def test_seed_covers_all_tables(session):
    seed_commerce(session, "u1"); session.commit()
    assert session.execute(select(Product)).scalars().first().sales_7d >= 0
    assert session.execute(select(Order)).scalars().first().amount > 0
    assert session.execute(select(Asset)).scalars().first().versions
    assert session.execute(select(Ticket)).scalars().first().status == "待分析"
```

- [ ] **Step 2: 跑出 RED**（`pytest tests/test_commerce_models.py -q` → ModuleNotFoundError 即失败态）
- [ ] **Step 3: 实现模型**（对齐 `models/connector.py` 现有风格：Mapped 注解、json 列用 `Mapped[dict] = mapped_column(JSON, default=dict)`；Ticket.status 直接存中文态 `待分析/待审批/已发出/已驳回`，与前端 mapper 一一对应）与 `seed_commerce`（5 店=taobao/tmall/douyin/pdd 各 connected+jd expired；12 SKU 沿用原型 `seedProducts` 的 sku/标题/价格常量，先读 `ecom-proto/src/data/ecom.ts` 抄数值；订单 30 天按日期哈希生成，保证确定性）
- [ ] **Step 4: 接 main.py seed 块 → 跑 GREEN；全量回归 `133+2 passed`**

### Task 3: commerce 查询与本地写端点

**Files:**
- Create: `server/ecos/api/commerce.py`（新 APIRouter，prefix="/api/commerce"）
- Modify: `server/ecos/api/routes.py`（`GET /api/meta` 加在既有 router；放这里避免新 app 装配）
- Modify: `server/ecos/main.py`（include commerce router）
- Modify: `server/ecos/api/deps.py`（Services 增 `commerce: CommerceService`）
- Create: `server/ecos/commerce/service.py`
- Test: `server/tests/test_commerce_api.py`

**Interfaces:**
- Consumes: `deps.get_services`、`Services.require`、AuditService
- Produces: `CommerceService(session, audit)` 方法 `list_stores/create_store/set_store_status/delete_store/list_products/list_orders/analytics_series/kpis/list_favorites/add_favorite/remove_favorite/list_assets/create_asset/add_asset_version/list_drafts/create_draft/update_draft/delete_draft`；REST 形状（响应全部 `{"<entity>": {...}}` 包裹，序列化名与模型字段同 camelCase→snake_case 直传）：
  - `GET /api/commerce/stores|products?store_id=|orders?store_id=&limit=|analytics/series?store_id=|kpis|favorites|assets|drafts`
  - `POST /api/commerce/stores {platform,name?}`、`PATCH /api/commerce/stores/{id} {status}`、`DELETE /api/commerce/stores/{id}`
  - `POST /api/commerce/favorites {ref_id,name,source,heat,price}`、`DELETE /api/commerce/favorites/{id}`
  - `POST /api/commerce/assets {name,type,tags[]}`、`POST /api/commerce/assets/{id}/versions {by,note}`
  - `POST/PATCH/DELETE /api/commerce/drafts[/ {id}]`
  - 权限码：查询 `commerce.view`；写 `commerce.manage`；`GET /api/meta` 公开返回 `{"auth_enabled":…,"auth_mode":…,"app_version":"0.1.0"}`

- [ ] **Step 1: 写失败测试**（TestClient 模式抄 `tests/test_api.py` 的 client fixture；覆盖：种子可见、PATCH 状态流转落库+审计 `commerce.store_update`、跨用户 404、未带 meta 端点免令牌可访问）

```python
def test_kpis_aggregate_seed(client):
    k = client.get("/api/commerce/kpis").json()["kpis"]
    assert k["stores_connected"] == 4 and k["products"] >= 12
def test_store_status_patch_audited(client):
    sid = client.get("/api/commerce/stores").json()["stores"][0]["id"]
    assert client.patch(f"/api/commerce/stores/{sid}", json={"status": "expired"}).status_code == 200
    acts = [e["action"] for e in client.get("/api/audit").json()["entries"]]
    assert "commerce.store_update" in acts
def test_foreign_tenant_404(auth_client):  # 参照 test_api.py 跨租户写法
```
- [ ] **Step 2: RED** → **Step 3: 实现 service+routes（每 handler 三行纪律：require → 租户过滤 → 审计）** → **Step 4: GREEN + 全量回归**

### Task 4: 平台沙箱连接器（catalog + 确定性适配器）

**Files:**
- Create: `server/ecos/connectors/catalog.d/{taobao,tmall,douyin,pdd,jd}-shop.yaml`
- Create: `server/ecos/connectors/adapters/platforms.py`
- Modify: `server/ecos/connectors/adapters/__init__.py`（注册 5 kind → platforms 适配器模块）
- Test: `server/tests/test_platform_adapters.py`

**Interfaces:**
- Consumes: `catalog.py` YAML 契约（kind/name/auth_kind=personal_token/mcp_mode=gateway/credential_fields=[access_token]/tools）
- Produces: 每平台工具集 `publish_product(write/high, required=[sku,title,price])、update_price(write/high,[sku,price])、push_reply(write/medium,[order_ref,body])、grant_refund(write/high,[order_ref,amount])、list_orders(read,[])`；`platforms.call_adapter(kind, tool, args) -> dict`：确定性行为——`douyin` 平台 `publish_product` 当 `price>=9999` 时抛 `AdapterError("平台合规打回：价格异常")`（供 E2E 部分失败场景），其余成功并写入模块级内存账本（`reset()` 可清）；`list_orders` 返回固定 3 单

- [ ] **Step 1: 失败测试**

```python
def test_five_platform_kinds_in_catalog():
    cat = default_catalog()
    assert {"taobao-shop","tmall-shop","douyin-shop","pdd-shop","jd-shop"} <= set(cat)
def test_douyin_price_guard_is_deterministic():
    platforms.reset()
    ok = platforms.call_adapter("douyin-shop","publish_product",{"sku":"S1","title":"t","price":9.9})
    assert ok["status"] == "published"
    with pytest.raises(AdapterError, match="合规打回"):
        platforms.call_adapter("douyin-shop","publish_product",{"sku":"S2","title":"t","price":9999})
```
- [ ] **Step 2: RED** → **Step 3: 写 YAML×5 + platforms.py（抄 demo_shop 结构）** → **Step 4: GREEN；确认既有 catalog 测试不破（`default_catalog()` 数量断言若有硬编码需同步，先 grep `len(cat` / `== 1` 于 tests）**

### Task 5: 发布任务化（drafts/{id}/publish → 引擎 E2E）

**Files:**
- Modify: `server/ecos/commerce/service.py`（+`publish_draft`）、`server/ecos/api/commerce.py`（+端点）
- Test: `server/tests/test_publish_flow.py`

**Interfaces:**
- Consumes: `TaskEngine.create_task/submit`、`spec_from_tool`、`ConnectorService.install`（发布前需该平台连接器 active——seed 期为 default_user 自动安装 5 平台实例，状态 active，凭据 `{"access_token":"sandbox"}`；写进 `seed_commerce`）
- Produces: `POST /api/commerce/drafts/{id}/publish {platforms:["taobao-shop",…]}` → 200 `{"task": task_out}`；合规规则：platforms 非空且都在 catalog、draft.title 不含违禁词表 `["最好","第一","100%"]`（违规 `ConnectorValidationError`→400）；每平台一步 `spec_from_tool(name=f"上架·{平台}", tool_ref=f"{kind}:publish_product", decl, args={sku,title,price})`；`requested_by = principal | "system"`（沿用 routes.create_task 同款三元式）

- [ ] **Step 1: 失败测试（E2E 全链路）**

```python
def test_publish_end_to_end(client):
    draft = client.post("/api/commerce/drafts", json={"title":"新品支架","price":9.9,"selling_points":["稳"],"image_label":"主图A","source":"主图工坊"}).json()["draft"]
    r = client.post(f"/api/commerce/drafts/{draft['id']}/publish", json={"platforms":["taobao-shop","douyin-shop"]}).json()["task"]
    assert r["status"] == "pending_approval" and len(r["steps"]) == 2
    appr = r["approval"]["id"]
    client.post(f"/api/approvals/{appr}/decide", json={"approver":"林芳","decision":"approve"})
    done = client.post(f"/api/tasks/{r['id']}/run", json={}).json()["task"]
    assert done["status"] == "succeeded"
def test_partial_failure_then_retry(client):
    # douyin 步 price>=9999 → 该步 failed，任务 partial_failed；retry_failed 后 succeeded
def test_banned_title_rejected(client):  # 标题含"最好"→400
```
- [ ] **Step 2: RED** → **Step 3: 实现**（publish 走 `task.create` 权限；成功后审计 `commerce.publish`）→ **Step 4: GREEN + 全量回归**

### Task 6: 售后工单（review → 写任务）

**Files:**
- Modify: `server/ecos/commerce/service.py`、`server/ecos/api/commerce.py`
- Test: `server/tests/test_tickets_flow.py`

**Interfaces:**
- Consumes: 引擎（同 Task 5）、Ticket 模型
- Produces: `GET /api/commerce/tickets`；`PATCH /api/commerce/tickets/{id}/review {decision:"approve"|"reject", reason?, feedback?}` → approve：状态置"已转执行"+建 `push_reply`（含退款金额加 `grant_refund` 步，平台取工单归属 kind）写任务并返回 `{"ticket":…, "task":…}`；reject：本地状态"已驳回"+reject_reason/feedback+审计；两端点权限 `ticket.review`

- [ ] **Step 1: 失败测试**（approve 生成 pending_approval 任务、reject 不建任务且状态回写、跨租户 404）→ **Step 2: RED** → **Step 3: 实现** → **Step 4: GREEN**

### Task 7: ModelAdapter + AI 端点

**Files:**
- Create: `server/ecos/ai/__init__.py`、`server/ecos/ai/adapter.py`、`server/ecos/api/ai.py`
- Modify: `server/ecos/main.py`（`app.state.model_adapter`）、`server/ecos/api/deps.py`（Services 增 `ai`）
- Test: `server/tests/test_ai_endpoints.py`

**Interfaces:**
- Consumes: `agent/runtime.build_model`（live 路径）、commerce 数据（insight 用 products/orders）
- Produces:

```python
class ModelAdapter(Protocol):
    def research_report(self, category: str) -> list[dict]: ...      # 5 候选
    def insight_narrative(self, store_name: str, series: dict) -> str: ...
    def triage_ticket(self, complaint: str) -> dict: ...             # attribution/confidence/suggestion/reply_draft

class SimulatedAdapter:  # 纯确定性：md5(category) 选品池；triage 关键词表(物流|质量|尺码|错发)
class LiveAdapter:       # 包 agentscope model，同三方法，内部同步化（asyncio.run 包装由调用层负责）
def build_adapter(settings) -> ModelAdapter  # ECOS_MODEL_* 齐备→LiveAdapter，否则 Simulated
```
端点：`POST /api/ai/research {category}`→`{"candidates":[ResearchCandidate…]}`（`research.run`）；`GET /api/ai/insight?store_id=`→`{"narrative":…}`（`ai.use`）；`POST /api/ai/tickets/triage`→把"待分析"工单批量写 attribution/confidence/suggestion/reply_draft 并转"待审批"（`ai.use`，本地写+审计 `ai.triage`）。三端点均审计 action=`ai.<name>`，level=read|system。

- [ ] **Step 1: 失败测试（快照确定性：同 category 两次调用输出相等；候选字段齐全；triage 后 GET /tickets 状态变化）** → **Step 2: RED** → **Step 3: 实现** → **Step 4: GREEN**

### Task 8: RBAC 新权限码 + 角色矩阵

**Files:**
- Modify: `server/ecos/auth/rbac.py`（PERMISSIONS +6 码：`commerce.view/commerce.manage/research.run/ai.use/ticket.review`；ROLES 按 spec 2.5 重排：viewer 加 commerce.view、operator 加 manage/run/use、approver 加 ticket.review+commerce.view）
- Test: 追加到 `server/tests/test_auth_api.py`

- [ ] **Step 1: 失败测试**（operator 发布 200 / viewer 发布 403 / viewer GET /api/commerce/stores 200 / `/auth/roles` 输出含新码）→ **Step 2: RED** → **Step 3: 改种子（seed_rbac 已自动同步，验证即可）** → **Step 4: GREEN + 全量回归（此时后端全绿 ≈ 133+~35）**

### Task 9: console 脚手架（复制 + 装依赖 + 构建绿）

**Files:**
- Create: `ecos-platform/console/` ← 复制 `ecom-proto/{src,index.html,tsconfig.json,vite.config.ts,package.json}`（不带 dist/node_modules）
- Modify: `console/package.json`（name→`ecos-console`；devDeps +`vitest@^2`；scripts +`"test": "vitest run"`、`"typecheck": "tsc --noEmit"`）
- Modify: `console/vite.config.ts`（`server.proxy["/api"] = "http://localhost:8000"`）
- Modify: `console/src/data/ecom.ts`（seed* 数组清空为 `[]`/最小常量保留 platformMeta/assetTypes 等展示配置；`nowLabel/uid` 保留）

**Interfaces:**
- Produces: `npm run typecheck`、`npm run build` 零错基线（此时 EcomProvider 仍读 seed 常量→空数组，页面空态但不崩）

- [ ] **Step 1: 复制+安装**：`cd console && npm install --no-audit --no-fund`
- [ ] **Step 2: `npm run typecheck && npm run build`** → 若清空 data 引发类型错（非空断言），把对应类型改 `| undefined` 处逐条记录，留给 Task 11 统一处理，先以"能编译"为准（允许 seed 暂不清）
- [ ] **Step 3: 检查点**：记录基线输出（build 成功 + 耗时），不动 git

### Task 10: api client + mappers + 认证态

**Files:**
- Create: `console/src/api/client.ts`、`console/src/api/mappers.ts`、`console/src/auth/session.tsx`、`console/src/pages/Login.tsx`
- Modify: `console/src/App.tsx`（路由 + `/login`；Shell 包 AuthProvider）
- Test: `console/src/api/client.test.ts`、`mappers.test.ts`（vitest + 注入 mock fetch）

**Interfaces:**
- Produces:

```ts
// client.ts
type ApiErr = { status: number; detail: string };
const api: { get<T>(p: string): Promise<T>; post<T>(p: string, body?: unknown): Promise<T>;
             patch<T>(p: string, body: unknown): Promise<T>; del(p: string): Promise<void>;
             setToken(t: string | null): void };
// 401 → session.logout() + location '/login'；非 2xx → throw ApiErr
// session.tsx
useAuth(): { principal: Principal | null; meta: {auth_enabled: boolean; auth_mode: string} | null;
             login(userId: string): Promise<void>; logout(): void; can(...perms: string[]): boolean }
// Principal 类型含 user_id/display_name/roles/permissions（对齐 serializers.principal_out）
// mappers.ts —— 后端↔原型字面量单点对照
taskStatus(s): created→"排队中" pending_approval→"待审批" running→"运行中" succeeded→"成功" partial_failed→"部分失败" failed→"失败" rejected→"已驳回"
level(l): read→"只读" write→"写入" high_risk→"高危" system→"系统"
result(r): ok→"成功" denied→"已拒绝" failed→"失败"
storeStatus / connector 状态映射同表（active→"已安装" revoked→"未安装" expired→"授权过期"）
backendTaskToProto(task): Task   // steps→TaskResult[]（succeeded→"成功"，failed→"打回"+error 作 reason）
```

- [ ] **Step 1: 写失败 vitest**（ApiErr 归一、401 钩子、mappers 全枚举断言）→ **Step 2: RED** → **Step 3: 实现 → `npm run typecheck && npx vitest run` GREEN**

### Task 11: EcomProvider 换底 + RBAC 驱动 UI

**Files:**
- Rewrite: `console/src/store/ecom.tsx`（**对外 EcomCtx 接口签名逐字不动**，见下表；内部改 useEffect 拉取 + action 调 api + 重取）
- Modify: `console/src/components/Shell.tsx`（席位徽标→`useAuth().principal`；nav 项按 `can()` 过滤；auth_enabled=false 时不显登录）
- Modify: `console/src/main.tsx`（挂 AuthProvider；启动先 `GET /api/meta`）

**Interfaces（action→API 映射表，逐条实现，参数/返回类型不变）：**

| EcomCtx 成员 | 换底实现 |
| --- | --- |
| stores/products/drafts/favorites/assets/tickets | GET 对应端点，mappers 转原类型（Product 字段名对齐 `analyticsSeries/trend` 结构） |
| connectors | `GET /api/connectors/catalog` + `GET instances` 合成原 `Connector{id,name,category,status,read[],write[],risk,desc,note}`（read/write=按 scope 分组的工具名；risk 枚举映射 低/中/高） |
| audits | `GET /api/audit?limit=40`（level/result 走 mappers；time 取 `at` 本地化） |
| tasks | `GET /api/tasks` → backendTaskToProto；`editingTasks` 保持本地 mock（含 3 个定时器 action 原样搬） |
| addStore / setStoreStatus / removeStore | POST/PATCH/DELETE stores（addStore 成功返回 true；failOnce 参数保留但恒走服务端） |
| enableConnector / disableConnector | POST install（credentials `{access_token:"sandbox"}`，kind=id）/ POST revoke |
| toggleFavorite | POST /favorites 或按 name 命中 DELETE |
| addDraft / addAsset | POST drafts / POST assets |
| submitPublish | POST drafts/{id}/publish；返回后端 task.id 字符串（原型契约 return string 不变） |
| approvePublish / approveTask | decide(approve)+run 两步（先查 approval id）；返回 void；**不**再用 setTimeout 假跑 |
| finishPublish | 换底后为只读派生：从 tasks 轮询 `GET /api/tasks` 后覆盖 results（保留签名，内部不再由前端伪造结果）|
| retryFailedPlatform / rerunTask | POST tasks/{id}/retry 或 run |
| stopTask | api 未调用，置 disabled（Global Constraints 记录的偏差） |
| audit | 前端不再直接写：no-op + console.assert（审计全部服务端产生） |
| analyzeTickets | POST /api/ai/tickets/triage |
| approveReply / rejectReply | PATCH /tickets/{id}/review（approve 后若返回 task，则入 tasks 流） |

- [ ] **Step 1: 失败测试**（ecom.test.tsx：vitest+mock fetch，断言 addStore 触发 POST /stores 且重取后 stores 长度+1；submitPublish 返回 task id）→ **Step 2: RED** → **Step 3: 重写 provider**（页面文件 diff 目标为 0；若个别页面因空态崩溃，仅做 null-guard 最小修改并记录）→ **Step 4: typecheck + vitest GREEN**

### Task 12: 内容域标注 + 全链路走查 + 文档收尾

**Files:**
- Modify: `console/src/pages/Editing.tsx`、`Accounts.tsx`（页头挂 `<MockBadge/>` 新组件 `components/mock.tsx`：文案「示例数据 · 内容域接口建设中」）
- Modify: `ecos-platform/README.md`（server+console 双启动、prod 守护、RBAC 表、已知偏差清单）、`ecos-design/ecom-proto/README.md` 顶部加一行"工程化版本见 ecos-platform/console"
- Create: `ecos-platform/docs/specs/2026-09-19-platform-console-design.md` 追加「实施结果」小节（回归数字、走查结论）

- [ ] **Step 1: 后端全量** `PYTHONUTF8=1 .venv/Scripts/python -m pytest -q` → 全绿；`demo/run_slice.py` 复跑
- [ ] **Step 2: 前端** `npm run typecheck && npx vitest run && npm run build` 全绿
- [ ] **Step 3: live 双模式 browser-use 走查**：起 uvicorn（dev 模式 :8000）+ `npm run dev`（:5173）。dev 链路：Overview KPI 真数据→Connectors 安装→Stores→Research AI 候选→收藏→Studio 草稿→Publish 提交→Tasks 审批(林芳名已禁自由文本→dev 下 approver 输入仍生效)→Audit 流水含 commerce.*；auth 模式重启服务器：登录页、viewer 登录侧栏收敛、自批被拒 toast。截图存档 `docs/walkthrough/`
- [ ] **Step 4: 清理冒烟进程与临时库**（netstat+taskkill；删 *.db/临时脚本）
- [ ] **Step 5: 交付报告**（回归输出原样引用；列全部已知偏差；等用户对 commit 发话）

---

## Self-Review 结论（已执行）

1. Spec 覆盖：2.1→T2、2.2→T3/T8、2.3→T4/T5/T6、2.4→T7、2.5→T8、2.6→T2、§1→T1、§3→T9–T11、§4→T12。无缺口。
2. 占位符扫描：无 TBD/"similar to Task N"；每段代码含可运行内容或完整映射表。
3. 类型一致性：EcomCtx 签名以 `store/ecom.tsx:13-46` 实读为准；`approval` 单数键对齐 `serializers.task_out`；`/api/meta` 与 task_out 字段均引自现有代码。
