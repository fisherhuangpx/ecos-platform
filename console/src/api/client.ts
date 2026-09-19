export type ApiErr = { status: number; detail: string };

function makeErr(status: number, body: unknown): ApiErr {
  const detail = (body as { detail?: unknown } | null)?.detail;
  if (typeof detail === "string" && detail) return { status, detail };
  if (detail != null) return { status, detail: JSON.stringify(detail) };
  return { status, detail: `请求失败（HTTP ${status}）` };
}

class ApiClient {
  private token: string | null = null;
  private unauthorizedHandler: (() => void) | null = null;

  setToken(token: string | null) {
    this.token = token;
  }

  /** 注册 401 回调（登出 + 跳登录页）；传 null 注销。 */
  onUnauthorized(cb: (() => void) | null) {
    this.unauthorizedHandler = cb;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {};
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    let payload: string | undefined;
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
    const res = await fetch(path, { method, headers, body: payload });
    if (res.status === 401) this.unauthorizedHandler?.();
    if (!res.ok) {
      let parsed: unknown = null;
      try {
        parsed = await res.json();
      } catch {
        parsed = null;
      }
      throw makeErr(res.status, parsed);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  get<T>(path: string) {
    return this.request<T>("GET", path);
  }
  post<T>(path: string, body?: unknown) {
    return this.request<T>("POST", path, body ?? {});
  }
  patch<T>(path: string, body: unknown) {
    return this.request<T>("PATCH", path, body);
  }
  del(path: string) {
    return this.request<void>("DELETE", path);
  }
}

export const api = new ApiClient();
