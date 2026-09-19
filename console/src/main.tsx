import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider, useAuth } from "./auth/session";
import { EcomProvider } from "./store/ecom";
import { ContentProvider } from "./store/content";
import "./index.css";

function EcomScoped({ children }: { children: React.ReactNode }) {
  const { principal, meta, ready } = useAuth();
  const authOn = meta?.auth_enabled ?? false;
  // 认证恢复完成前不挂载数据层：否则刷新受保护页时会先发出无令牌的请求，401 会把刚恢复的会话踢回登录页
  if (!ready) {
    return <div className="flex h-screen items-center justify-center text-sm text-mute">正在连接 ECOS 服务…</div>;
  }
  // 已开启认证但尚未登录：只渲染路由外壳（Login / RequireAuth 跳转），不挂载任何数据层
  if (authOn && !principal) return <App />;
  // 登录/登出切换身份时重挂数据层，按新用户重新拉取
  return <EcomProvider key={principal?.user_id ?? "anonymous"}>{children}</EcomProvider>;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AuthProvider>
        <EcomScoped>
          <ContentProvider>
            <App />
          </ContentProvider>
        </EcomScoped>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
