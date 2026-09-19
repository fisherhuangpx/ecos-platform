# ECOS Server（基础框架 · 垂直切片）

基于 AgentScope 2.x 的企业级 Agent 平台后端骨架：**Agent 内核用 AgentScope，平台层自建**（连接器域、任务/审批/审计域、REST 接口层）。

红线（来自 ecom-proto 原型，不可绕过）：

- **跨平台写操作 100% 审批闸门**：`requires_approval` 由目录 `scope` 在服务端推导，客户端伪造无效；引擎 `_guard_approval`（run 与 retry 均先过闸，驳回任务的重试尝试同样留 `denied` 痕）与执行器第二道关卡双重兜底；被拦截的尝试落审计（`result=denied`）。
- **100% 审计**：所有工具调用、任务流转、审批决策落 `audit_logs`（read / write / high_risk / system 四级），失败调用同样落 `result=failed`。
- **参数契约校验**：调用参数必须落在目录声明的 `params/required` 内，API / Agent 工具 / 执行器三处校验（防止"审批的是 A、执行的是 A+越权参数"）。
- **租户口径**：REST 层按当前用户过滤任务与审批，跨用户访问一律 404（不泄露存在性）；同 kind 仅允许一个 active 安装实例（撤销后可重装）。
- **RBAC 与职责分离**：认证开启时所有业务端点按权限码把关（缺权 403 并落 `rbac.denied` 审计）；审批人身份必须等于登录身份（代批 400），且**任务属主 / 审批发起人不能审批自己的写操作**（自批 403 并落 `approval.forbidden` denied 审计）。
- **事务完整性**：写接口在返回响应前显式提交，提交失败不会向客户端报告成功。
- **并发互斥**：同一任务的 run/retry 走进程级任务锁，执行中再次触发返回 409（拒绝并发）。

## 目录结构

```
server/
├── ecos/
│   ├── main.py            # FastAPI app 工厂（create_app）+ /healthz
│   ├── config.py          # Settings（env 前缀 ECOS_）
│   ├── db.py              # 引擎 / 会话工厂 / 建表
│   ├── errors.py          # 统一错误层级
│   ├── models/            # ORM：用户·角色·权限（RBAC 五表）/ 连接器实例 / 任务·步骤·审批 / 审计
│   ├── security/vault.py  # 凭据加密（Fernet）+ 网关短时令牌（HMAC + 过期）
│   ├── auth/              # 身份层：LocalDirectoryIdP（HS256 自签，dev）/ OidcIdP（RS256+JWKS，prod）+ RBAC 种子
│   ├── connectors/        # 连接器域：声明式目录 / MCP spec / 实例服务 / 执行器 / 适配器
│   │   └── catalog.d/     # 目录声明 YAML（demo-shop 为切片样例）
│   ├── tasks/             # 任务引擎 / 审批服务 / 审计服务
│   ├── agent/             # AgentScope 接线：工具桥 + 运行时工厂
│   └── api/               # REST 路由 / 依赖装配 / 序列化 / 内部 MCP 网关（JSON-RPC）
├── demo/run_slice.py      # 垂直切片演示脚本（全内存，不访问网络）
└── tests/                 # pytest（asyncio_mode=auto）
```

## 快速开始

```bash
cd server
python -m venv .venv
.venv/Scripts/pip install -e ".[dev]"      # Windows；Linux/macOS 用 .venv/bin/pip

.venv/Scripts/python -m pytest -q          # 测试
.venv/Scripts/python demo/run_slice.py     # 垂直切片演示
.venv/Scripts/python -m uvicorn ecos.main:create_app --factory --port 8000   # 启动服务
```

## 垂直切片（已闭环）

`demo/run_slice.py` 依次演示：连接器安装（凭据加密、生成 `{kind}__{instance_id}` 服务名）→ MCP 接入 spec（gateway 模式内部端点 + 绑定实例的过期令牌）→ 只读工具经 Agent 直接执行并落 read 级审计 → 写工具仅创建待审批任务（**绝不直接执行**）→ 审批前执行被闸门拦截 → 人工审批通过后任务引擎执行 → 审计流水。

## REST 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/healthz` | 健康检查 |
| POST | `/api/auth/token` | 本地自签令牌签发（仅 `auth_mode=local`，需已存在的活跃用户） |
| GET | `/api/auth/me` | 当前身份（角色 + 权限码） |
| GET | `/api/auth/roles` | 静态角色 → 权限码定义 |
| POST | `/api/admin/users` | 建/更新用户（`user.manage`） |
| POST | `/api/admin/users/{id}/roles` | 授予角色（`user.manage`） |
| GET | `/api/connectors/catalog` | 连接器目录（含 scope / risk / requires_approval） |
| POST | `/api/connectors/install` | 安装连接器实例（凭据加密入库，响应不含明文） |
| GET | `/api/connectors/instances` | 实例列表 |
| GET | `/api/connectors/instances/{id}/mcp-spec` | MCP 接入 spec（URL 携带绑定实例的过期令牌） |
| POST | `/api/connectors/instances/{id}/revoke` | 撤销实例（撤销后可重装） |
| GET | `/api/tasks` | 任务列表 |
| POST | `/api/tasks` | 创建任务（`requires_approval` 服务端推导，忽略客户端值） |
| POST | `/api/tasks/{id}/run` | 执行任务（未审批的写任务返回 409；执行中并发触发返回 409） |
| POST | `/api/tasks/{id}/retry` | 仅重试失败步骤 |
| POST | `/api/approvals/{id}/decide` | 审批决策（approve / reject；身份强制 + 职责分离） |
| GET | `/api/audit` | 审计流水（倒序） |
| POST | `/api/internal/mcp/{kind}/{instance_id}?token=…` | 内部 MCP 网关（JSON-RPC 2.0 子集，见下节） |

错误映射：`Unauthorized→401`、`PermissionDenied` / `ApprovalForbidden→403`、`NotFoundError→404`、`ApprovalRequired` / `TaskStateError→409`、`ConnectorError` / `ValueError→400`。

## 认证与 RBAC

- `ECOS_AUTH_ENABLED=false`（默认，开发模式）：身份取 `ECOS_DEFAULT_USER_ID`，启动时自动授予 admin 角色，所有端点免令牌；审批可见性退回租户 404 兜底。
- `ECOS_AUTH_ENABLED=true`：所有 `/api/*`（除令牌签发与内部网关）要求 `Authorization: Bearer`；无效/过期令牌 401 并落 `auth.denied` 审计。
- `ECOS_AUTH_MODE=local`：HS256 自签（`POST /api/auth/token` 换发，仅限开发/测试）；`oidc`：RS256 + JWKS 校验（iss/aud/exp），企业 IdP 用户 JIT 落库（不带角色，需管理员授权）。生产推荐对接 Casdoor（原生钉钉/飞书）或 Keycloak。
- 角色（种子幂等，权限变更自动重同步）：

| 角色 | 权限要点 |
| --- | --- |
| `admin` | 全部 11 项权限码 |
| `operator` | 安装/撤销、建任务、run/retry、查看审批与审计；**无 `task.approve`** |
| `approver` | 查看 + `task.approve`（不能安装、不能触发执行） |
| `viewer` | 只读（目录/任务/审批） |

- 职责分离：审批人 ≠ 任务属主 且 ≠ 审批发起人，违反 403 + `approval.forbidden` denied 审计。
- 生产红线（`env=prod` 启动守护）：默认/短密钥、`auth_enabled=false`、`auth_mode!=oidc`、缺 `oidc_issuer` 均拒绝启动。

## 内部 MCP 网关

`GET /api/connectors/instances/{id}/mcp-spec` 返回的 URL 携带绑定实例的短时令牌（`{过期epoch}.{HMAC-SHA256 签名}`，TTL `ECOS_GATEWAY_TOKEN_TTL_SECONDS`，默认 900s）。端点实现 JSON-RPC 2.0 子集：

- `initialize` / `notifications/initialized`：握手，`serverInfo.name` 即 `{kind}__{instance_id}`。
- `tools/list`：目录白名单工具 + `inputSchema` + `risk` + `requiresApproval`。
- `tools/call`：**读工具**直通适配器并落 read 审计；**写工具**只创建 `pending_approval` 任务（`requested_by=mcp-gateway`），绝不直接执行；参数违约返回 `-32602`。
- 鉴权失败 401、实例撤销/不存在 404，均落 `connector.gateway.denied` 审计。

## AgentScope 接线

- `agent/tools.py`：连接器工具 → `FunctionTool`。读工具 `is_read_only=True` + ALLOW 直接执行并审计；写工具 ASK，调用只创建待审批任务并返回 `{status: pending_approval, task_id}`。
- `agent/runtime.py`：`build_model`（OpenAI 兼容端点）、`build_agent`（Toolkit 装配）、`scripted_model`（离线脚本化模型，演示与测试不访问网络）。

## 关键环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `ECOS_ENV` | `dev` | `prod` 触发启动守护（强密钥 + OIDC 必填） |
| `ECOS_DATABASE_URL` | `sqlite:///./ecos.db` | 数据库连接串 |
| `ECOS_SECRET_KEY` | `dev-secret-change-me` | 凭据加密主密钥 + 自签/网关令牌密钥（生产必改，≥32 位） |
| `ECOS_GATEWAY_BASE_URL` | `http://localhost:8000` | 内部 MCP 网关基址 |
| `ECOS_DEFAULT_USER_ID` | `dev-user` | 开发模式默认用户（启动时自动授 admin） |
| `ECOS_AUTH_ENABLED` | `false` | 是否强制 Bearer 认证 + RBAC |
| `ECOS_AUTH_MODE` | `local` | `local`（HS256 自签）\| `oidc`（RS256+JWKS） |
| `ECOS_JWT_TTL_SECONDS` | `28800` | 本地自签令牌有效期 |
| `ECOS_OIDC_ISSUER` / `ECOS_OIDC_AUDIENCE` | 空 / `ecos-server` | 企业 IdP 校验参数 |
| `ECOS_GATEWAY_TOKEN_TTL_SECONDS` | `900` | MCP 网关令牌有效期 |
| `ECOS_CORS_ORIGINS` | 空 | 逗号分隔跨域白名单（空=不下发跨域头） |
| `ECOS_MODEL_NAME` / `ECOS_MODEL_API_KEY` / `ECOS_MODEL_BASE_URL` | 空 | 真实模型接入配置 |

## 边界（当前框架不含）

- 内容域（AI 分析/分发/剪辑）：规格在 `../docs/specs/` 独立推进，后续以独立模块并入。
- 前端控制台接线：CORS 与令牌端点已就绪，ecom-proto UI 侧对接不在本期范围。
- AgentScope `ResourceAccessPolicy` 适配：平台身份层落地后，可将 AgentScope app 层的资源访问接到 ecos Principal（骨架期未接）。
- 审计链防篡改（哈希链/外部存证）与生产管理员引导流程（首启 admin 交接）：待后续补齐。
