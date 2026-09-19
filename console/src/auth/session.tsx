import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api } from "../api/client";

export interface Principal {
  user_id: string;
  display_name: string;
  roles: string[];
  permissions: string[];
}

export interface Meta {
  auth_enabled: boolean;
  auth_mode: string;
  app_version?: string;
}

interface AuthCtx {
  principal: Principal | null;
  meta: Meta | null;
  ready: boolean;
  login: (userId: string) => Promise<void>;
  logout: () => void;
  can: (...perms: string[]) => boolean;
}

const TOKEN_KEY = "ecos_token";

function readStoredToken(): string | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

const Ctx = createContext<AuthCtx | null>(null);

let currentUserIdValue: string | null = null;

// 供 store 层（在 AuthProvider 之外也要拿身份的场景）读取当前登录用户；测试无 AuthProvider 时返回 null
export function currentUserId(): string | null {
  return currentUserIdValue;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [principal, setPrincipal] = useState<Principal | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    currentUserIdValue = principal?.user_id ?? null;
  }, [principal]);

  const logout = useCallback(() => {
    api.setToken(null);
    try {
      typeof localStorage !== "undefined" && localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
    setPrincipal(null);
  }, []);

  useEffect(() => {
    api.onUnauthorized(() => {
      logout();
      if (window.location.pathname !== "/login") window.location.assign("/login");
    });
    return () => api.onUnauthorized(null);
  }, [logout]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const m = await api.get<Meta>("/api/meta");
        if (cancelled) return;
        setMeta(m);
        if (m.auth_enabled) {
          const token = readStoredToken();
          if (token) {
            api.setToken(token);
            try {
              const r = await api.get<{ principal: Principal }>("/api/auth/me");
              if (!cancelled) setPrincipal(r.principal);
            } catch {
              logout();
            }
          }
        }
      } catch {
        /* 后端不可达时保持 ready，页面以空数据呈现 */
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [logout]);

  const login = useCallback(async (userId: string) => {
    const r = await api.post<{ access_token: string }>("/api/auth/token", { user_id: userId });
    api.setToken(r.access_token);
    try {
      typeof localStorage !== "undefined" && localStorage.setItem(TOKEN_KEY, r.access_token);
    } catch {
      /* ignore */
    }
    const me = await api.get<{ principal: Principal }>("/api/auth/me");
    setPrincipal(me.principal);
  }, []);

  const value = useMemo<AuthCtx>(
    () => ({
      principal,
      meta,
      ready,
      login,
      logout,
      can: (...perms: string[]) =>
        !meta?.auth_enabled || (principal !== null && perms.every((p) => principal.permissions.includes(p))),
    }),
    [principal, meta, ready, login, logout],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth 必须在 AuthProvider 内使用");
  return ctx;
}
