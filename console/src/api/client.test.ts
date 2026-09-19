import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, type ApiErr } from "./client";

type Resolved = { status: number; body: unknown };

function mockFetch(responses: Resolved[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const r = responses.shift();
      if (!r) throw new Error(`mockFetch 响应不足: ${url}`);
      return {
        status: r.status,
        ok: r.status >= 200 && r.status < 300,
        json: async () => r.body,
      };
    },
  );
  return calls;
}

beforeEach(() => {
  api.setToken(null);
  api.onUnauthorized(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("api client", () => {
  it("get 返回 JSON 并携带 Bearer 头", async () => {
    api.setToken("tok-1");
    const calls = mockFetch([{ status: 200, body: { stores: [] } }]);
    const data = await api.get<{ stores: unknown[] }>("/api/commerce/stores");
    expect(data).toEqual({ stores: [] });
    expect(calls[0].url).toBe("/api/commerce/stores");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tok-1");
  });

  it("未设置 token 时不发送 Authorization 头", async () => {
    const calls = mockFetch([{ status: 200, body: {} }]);
    await api.get("/api/meta");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  it("post 序列化 body 且默认 JSON content-type", async () => {
    const calls = mockFetch([{ status: 200, body: { ok: true } }]);
    await api.post("/api/commerce/stores", { platform: "taobao", name: "x" });
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.body).toBe(JSON.stringify({ platform: "taobao", name: "x" }));
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("非 2xx 抛出归一化的 ApiErr（detail 字符串）", async () => {
    mockFetch([{ status: 404, body: { detail: "店铺不存在: st-x" } }]);
    const p = api.get("/api/commerce/stores/st-x");
    await expect(p).rejects.toMatchObject({ status: 404, detail: "店铺不存在: st-x" });
  });

  it("422 数组 detail 也归一为字符串", async () => {
    mockFetch([{ status: 422, body: { detail: [{ loc: ["body", "platform"], msg: "field required" }] } }]);
    const err = (await api.post("/api/x", {}).catch((e: ApiErr) => e)) as ApiErr;
    expect(err.status).toBe(422);
    expect(err.detail).toContain("field required");
  });

  it("响应无 JSON body 时以状态码兜底", async () => {
    vi.stubGlobal("fetch", async () => ({ status: 500, ok: false, json: async () => { throw new Error("no body"); } }));
    const err = (await api.get("/api/x").catch((e: ApiErr) => e)) as ApiErr;
    expect(err.status).toBe(500);
    expect(err.detail).toContain("500");
  });

  it("401 触发 onUnauthorized 回调并抛出 ApiErr", async () => {
    const onUnauth = vi.fn();
    api.onUnauthorized(onUnauth);
    mockFetch([{ status: 401, body: { detail: "缺少 Bearer 令牌" } }]);
    const err = (await api.get("/api/commerce/stores").catch((e: ApiErr) => e)) as ApiErr;
    expect(err.status).toBe(401);
    expect(onUnauth).toHaveBeenCalledTimes(1);
  });

  it("未注册回调时 401 仅抛错不崩", async () => {
    mockFetch([{ status: 401, body: { detail: "过期" } }]);
    await expect(api.get("/api/x")).rejects.toMatchObject({ status: 401 });
  });

  it("del 在 204 无 body 时返回 undefined", async () => {
    const calls = mockFetch([{ status: 204, body: undefined }]);
    await expect(api.del("/api/commerce/stores/st-1")).resolves.toBeUndefined();
    expect(calls[0].init.method).toBe("DELETE");
  });
});
