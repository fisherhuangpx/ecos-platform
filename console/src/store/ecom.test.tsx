// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EcomProvider, useEcom } from "./ecom";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Ctx = ReturnType<typeof useEcom>;

const backendStore = (id: string, platform: string) => ({
  id, user_id: "u", platform, name: `店 ${id}`, status: "connected",
  authorized_at: null, created_at: "2026-09-03T12:00:00", updated_at: null,
  products: 2, orders_7d: 5,
});

const makeTask = (status: string) => ({
  id: "tsk-9",
  user_id: "u",
  type: "publish",
  title: "上架 · 新品快充线",
  status,
  payload: { platforms: ["taobao-shop", "douyin-shop"], draft_id: "dr-1" },
  result: null,
  created_at: "2026-09-03T12:00:00",
  steps: [
    { id: "s1", seq: 1, name: "淘宝", tool: "taobao-shop:publish_product", args: {}, scope: "write", risk: "high", requires_approval: true, status: "succeeded", attempt: 1, output: null, error: null },
    { id: "s2", seq: 2, name: "抖音", tool: "douyin-shop:publish_product", args: {}, scope: "write", risk: "high", requires_approval: true, status: status === "succeeded" ? "succeeded" : "pending", attempt: 1, output: null, error: null },
  ],
  approval: { id: "ap-1", task_id: "tsk-9", status: status === "pending_approval" ? "pending" : "approved", requested_by: "system", decided_by: status === "pending_approval" ? null : "林芳", note: null, decided_at: null, created_at: null },
});

let latest: Ctx | null = null;
function Probe() {
  latest = useEcom();
  return null;
}

let calls: string[] = [];
let storeRows: unknown[];
let taskState: string;
let publishBody: { platforms?: string[] } | null;
let decided: boolean;
let ranAfterDecide: boolean | null;
let root: Root;

async function settle(rounds = 6) {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

beforeEach(async () => {
  calls = [];
  storeRows = [backendStore("st-1", "taobao")];
  taskState = "pending_approval";
  publishBody = null;
  decided = false;
  ranAfterDecide = null;
  latest = null;

  const routes: Record<string, unknown> = {
    "GET /api/commerce/products": {
      products: [{ id: "po-1", store_id: "st-1", sku: "TAO-1", title: "快充数据线", price: 29.9, category: "配件", stock: 100, sales_7d: 12, trend: "up", conv: 3.1, rating: 4.7, review_note: "评价稳", created_at: null }],
    },
    "GET /api/commerce/drafts": {
      drafts: [{ id: "dr-1", title: "新品快充线", price: 29.9, selling_points: ["磁吸"], image_label: "白底", source: "主图工坊", status: "待完善", created_at: "2026-09-03T12:00:00" }],
    },
    "GET /api/commerce/favorites": { favorites: [] },
    "GET /api/commerce/assets": { assets: [] },
    "GET /api/commerce/tickets": { tickets: [] },
    "GET /api/connectors/catalog": {
      connectors: [{
        kind: "taobao-shop", name: "淘宝（平台沙箱）", category: "电商平台", auth_kind: "personal_token", mcp_mode: "gateway",
        description: "沙箱", credential_fields: ["access_token"],
        tools: [
          { name: "publish_product", scope: "write", risk: "high", description: "上架商品", requires_approval: true, params: {}, required: [] },
          { name: "list_orders", scope: "read", risk: "low", description: "订单列表", requires_approval: false, params: {}, required: [] },
        ],
      }],
    },
    "GET /api/connectors/instances": { instances: [{ id: "ci-1", kind: "taobao-shop", status: "active", shared: false, mcp_server_name: "taobao-shop__ci-1", credential_expires_at: null, created_at: null }] },
    "GET /api/audit": { entries: [] },
  };

  vi.stubGlobal(
    "fetch",
    async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? "GET";
      const path = url.split("?")[0];
      const key = `${method} ${path}`;
      calls.push(key);
      let body: unknown;
      if (key === "GET /api/commerce/stores") body = { stores: storeRows };
      else if (key === "GET /api/tasks") body = { tasks: [makeTask(taskState)] };
      else if (key === "POST /api/commerce/stores") {
        const p = JSON.parse(String(init.body));
        const row = backendStore(`st-${storeRows.length + 1}`, p.platform);
        storeRows = [...storeRows, row];
        body = { store: row };
      } else if (key === "POST /api/commerce/drafts/dr-1/publish") {
        publishBody = JSON.parse(String(init.body));
        body = { task: makeTask("pending_approval") };
      } else if (key === "POST /api/approvals/ap-1/decide") {
        decided = true;
        body = { approval: { id: "ap-1", task_id: "tsk-9", status: "approved", requested_by: "system", decided_by: "林芳", note: null, decided_at: null, created_at: null } };
      } else if (key === "POST /api/tasks/tsk-9/run") {
        ranAfterDecide = decided;
        taskState = "succeeded";
        body = { task: makeTask("succeeded") };
      } else {
        const r = routes[key];
        body = r ?? {};
      }
      return { status: 200, ok: true, json: async () => body };
    },
  );

  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root.render(
      <EcomProvider>
        <Probe />
      </EcomProvider>,
    );
  });
  await settle();
});

afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});

describe("EcomProvider 换底", () => {
  it("初始加载：后端行映射为原型类型", () => {
    expect(latest).not.toBeNull();
    expect(latest!.stores[0]).toMatchObject({ id: "st-1", platformId: "taobao", name: "店 st-1", products: 2, orders7d: 5 });
    expect(latest!.products[0]).toMatchObject({ id: "po-1", name: "快充数据线", platformId: "taobao", sales7d: 12, trend: "up" });
    expect(latest!.drafts[0]).toMatchObject({ id: "dr-1", sellingPoints: ["磁吸"], imageLabel: "白底" });
    expect(latest!.connectors[0]).toMatchObject({ id: "taobao-shop", status: "已安装", write: ["上架商品"], read: ["订单列表"], risk: "高" });
  });

  it("addStore 走 POST /stores 并重取后 +1", async () => {
    const before = latest!.stores.length;
    const ok = await act(async () => latest!.addStore("pdd"));
    expect(ok).toBe(true);
    expect(calls).toContain("POST /api/commerce/stores");
    expect(latest!.stores.length).toBe(before + 1);
    expect(latest!.stores[before].platformId).toBe("pdd");
  });

  it("submitPublish 换算平台 kind 并返回后端任务 id", async () => {
    const id = await act(async () => latest!.submitPublish("dr-1", ["taobao", "douyin"]));
    expect(id).toBe("tsk-9");
    expect(publishBody).toEqual({ platforms: ["taobao-shop", "douyin-shop"] });
  });

  it("approveTask 先 decide 后 run 再刷新", async () => {
    expect(latest!.tasks[0].status).toBe("待审批");
    await act(async () => latest!.approveTask("tsk-9"));
    expect(ranAfterDecide).toBe(true);
    expect(calls).toContain("POST /api/approvals/ap-1/decide");
    expect(calls.indexOf("POST /api/approvals/ap-1/decide")).toBeLessThan(calls.indexOf("POST /api/tasks/tsk-9/run"));
    await settle(3);
    expect(latest!.tasks[0].status).toBe("成功");
  });

  it("audit() 为 no-op：前端不再产生审计", async () => {
    await act(async () => {
      latest!.audit({ user: "陈晨", action: "x", target: "y", level: "写入", result: "ok" });
    });
    expect(latest!.audits).toEqual([]);
  });
});
