import { NavLink, Outlet, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import {
  LayoutDashboard, Store, Search, BarChart3, LineChart, Images, Rocket, FolderOpen,
  ListChecks, Plug, Bell, ChevronsUpDown, Sparkles, Clapperboard, MessagesSquare, Users, Send, Crosshair, LogOut,
} from "lucide-react";
import { useEcom } from "../store/ecom";
import { useAuth } from "../auth/session";
import { Dot } from "./ui";

type NavItem = { to: string; label: string; icon: typeof LayoutDashboard; perm?: string };

const nav: NavItem[] = [
  { to: "/", label: "总览", icon: LayoutDashboard },
  { to: "/stores", label: "店铺", icon: Store, perm: "commerce.view" },
  { to: "/research", label: "选品调研", icon: Search },
  { to: "/analytics", label: "经营分析", icon: BarChart3, perm: "commerce.view" },
  { to: "/insights", label: "内容洞察", icon: LineChart },
  { to: "/competitors", label: "竞品情报", icon: Crosshair },
  { to: "/studio", label: "主图工坊", icon: Images, perm: "commerce.manage" },
  { to: "/publish", label: "商品上架", icon: Rocket, perm: "task.create" },
  { to: "/assets", label: "素材库", icon: FolderOpen, perm: "commerce.view" },
  { to: "/editing", label: "自动剪辑", icon: Clapperboard },
  { to: "/accounts", label: "账号矩阵", icon: Users },
  { to: "/distribute", label: "分发中枢", icon: Send },
  { to: "/after-sales", label: "AI 售后", icon: MessagesSquare, perm: "commerce.view" },
  { to: "/tasks", label: "任务中心", icon: ListChecks, perm: "task.view" },
  { to: "/connectors", label: "连接器市场", icon: Plug, perm: "connector.view" },
];

const titles: Record<string, string> = {
  "/": "总览", "/stores": "店铺管理", "/research": "选品调研", "/analytics": "经营分析", "/insights": "内容洞察", "/competitors": "竞品情报",
  "/studio": "主图工坊", "/publish": "商品上架", "/assets": "品牌素材库",
  "/editing": "自动剪辑", "/accounts": "账号矩阵", "/distribute": "分发中枢", "/after-sales": "AI 售后中心",
  "/tasks": "任务中心与审计", "/connectors": "连接器市场",
};

export default function Shell() {
  const { pathname } = useLocation();
  const { tasks, connectors } = useEcom();
  const { principal, meta, can, logout } = useAuth();
  const authOn = meta?.auth_enabled ?? false;
  const visibleNav = nav.filter((n) => !n.perm || can(n.perm));
  const pending = tasks.filter((t) => t.status === "待审批").length;
  const seatName = principal?.display_name || principal?.user_id || "陈晨";

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="flex w-60 shrink-0 flex-col border-r border-line bg-panel/70 backdrop-blur">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-neon to-neondeep font-display text-lg font-bold text-[#04110b] shadow-[0_0_20px_rgba(0,255,153,0.4)]">
            A
          </div>
          <div>
            <div className="font-display text-[15px] font-bold leading-none">AGP Ecom</div>
            <div className="mt-1 text-[10px] tracking-widest text-mute">电商运营中枢</div>
          </div>
        </div>

        <nav className="mt-2 flex-1 space-y-1 px-3" aria-label="主导航">
          {visibleNav.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `focus-ring relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors ${
                  isActive ? "bg-neon/10 font-semibold text-neon" : "text-mute hover:bg-white/5 hover:text-ink"
                }`
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <motion.span
                      layoutId="nav-active"
                      className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-neon"
                    />
                  )}
                  <Icon size={17} strokeWidth={isActive ? 2.3 : 1.8} />
                  {label}
                  {to === "/publish" && pending > 0 && (
                    <span className="ml-auto rounded-full bg-warn/20 px-1.5 py-0.5 text-[10px] font-bold text-warn">{pending}</span>
                  )}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* AI 额度 mini */}
        <div className="mx-3 mb-3 rounded-2xl border border-line bg-surface p-3.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-mute">本月 AI 额度</span>
            <span className="tnum text-neon">12.8k / 200k</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/8">
            <div className="h-full w-[6%] rounded-full bg-gradient-to-r from-neon to-accent" />
          </div>
          <span className="mt-2 block text-[11px] text-mute">{connectors.filter((c) => c.status === "已安装").length} 个连接器已启用</span>
        </div>

        <div className="border-t border-line px-4 py-3.5">
          <div className="flex items-center gap-2.5 rounded-xl px-1 py-1">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/25 font-display text-sm font-bold text-[#b7b1ff]">{seatName.slice(0, 1)}</div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-semibold">{seatName} · 蓝海优品</div>
              <div className="truncate text-[10px] text-mute">
                {authOn ? `席位 ${principal?.roles.join(" / ") || "未分配"} · ${principal?.permissions.length ?? 0} 项权限` : "开发模式 · 免登录全量视图"}
              </div>
            </div>
            {authOn ? (
              <button onClick={logout} className="focus-ring rounded-lg p-1.5 text-mute hover:bg-white/5 hover:text-ink" aria-label="退出登录" title="退出登录">
                <LogOut size={14} />
              </button>
            ) : (
              <ChevronsUpDown size={14} className="shrink-0 text-mute" />
            )}
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-line bg-panel/50 px-6 backdrop-blur">
          <div className="flex items-center gap-2 text-sm text-mute">
            <span>蓝海优品</span><span>/</span><span className="font-medium text-ink">{titles[pathname] ?? "AGP Ecom"}</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-2 rounded-xl border border-line bg-panel px-3 py-1.5 text-sm text-mute md:flex">
              <Search size={14} /> 搜索商品、店铺、任务…
              <kbd className="rounded bg-white/8 px-1.5 py-0.5 text-[10px]">⌘K</kbd>
            </div>
            <button className="focus-ring relative rounded-xl p-2 text-mute hover:bg-white/5 hover:text-ink" aria-label="通知">
              <Bell size={17} />
              <span className="absolute right-1.5 top-1.5"><Dot tone={pending ? "warn" : "neon"} /></span>
            </button>
            <div className="flex items-center gap-2 rounded-xl border border-line bg-panel px-2.5 py-1.5 text-xs">
              <Sparkles size={13} className="text-neon" />
              <span className="text-mute">自动化运营 v0.1</span>
            </div>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto">
          <motion.div
            key={pathname}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
            className="mx-auto h-full max-w-[1240px] p-6 lg:p-8"
          >
            <Outlet />
          </motion.div>
        </main>
      </div>
    </div>
  );
}
