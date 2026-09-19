import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Rocket, Sparkles, Store, Search, ImagePlus, ArrowUpRight, CheckCircle2, Circle, Hourglass, Clapperboard, MessagesSquare, Film, Brain } from "lucide-react";
import { Card, Stat, Badge, Dot, PageHeader, Button } from "../components/ui";
import { AreaChart, HBars } from "../components/charts";
import { analyticsSeries } from "../data/ecom";
import { useEcom } from "../store/ecom";
import { fetchRuns, type ResearchRun } from "../api/research";
import { fmtTime } from "../api/mappers";

const RUN_STATUS_LABEL: Record<ResearchRun["status"], string> = {
  running: "调研进行中",
  succeeded: "调研完成",
  partial: "调研部分完成",
  failed: "调研失败",
};

export default function Overview() {
  const { stores, favorites, drafts, tasks, connectors, audits, editingTasks, tickets } = useEcom();
  const [recentRuns, setRecentRuns] = useState<ResearchRun[]>([]);
  useEffect(() => {
    fetchRuns(3).then(setRecentRuns).catch(() => undefined);
  }, []);
  const latestRun = recentRuns[0];
  const connected = stores.filter((s) => s.status === "connected").length;
  const pending = tasks.filter((t) => t.status === "待审批").length;
  const running = tasks.filter((t) => t.status === "运行中").length;
  const installedConn = connectors.filter((c) => c.status === "已安装");
  const published = tasks.filter((t) => t.status === "成功" && t.kind === "商品上架").length;
  const lastAudit = audits[0];

  const pipe = [
    { key: "stores", done: connected > 0, label: "连接店铺", to: "/stores", icon: Store, note: connected ? `${connected} 店在线` : "去连接第 1 家店" },
    { key: "research", done: favorites.length > 0, label: "选品调研", to: "/research", icon: Search, note: favorites.length ? `${favorites.length} 个候选已收藏` : "跑一个品类调研" },
    { key: "studio", done: drafts.some((d) => d.source === "主图工坊"), label: "生成主图", to: "/studio", icon: ImagePlus, note: drafts.filter((d) => d.source === "主图工坊").length ? "已有 AI 主图草稿" : "AI 出 3 稿对比" },
    { key: "publish", done: published > 0, label: "审批上架", to: "/publish", icon: Rocket, note: published ? `${published} 次成功上架` : pending ? `${pending} 个任务待审批` : "编排多平台并审批" },
  ];

  const pendingTone: "neon" | "warn" = pending ? "warn" : "neon";
  const pipelineDone = pipe.filter((p) => p.done).length;

  return (
    <div>
      <PageHeader
        title="早上好，蓝海优品 👋"
        sub={`电商自动化运营中枢 · ${connected} 家店铺在线 · ${installedConn.length} 个连接器 · 闭环进度 ${pipelineDone}/4`}
        actions={
          <>
            <Link to="/research"><Button variant="outline" icon={<Search size={14} />}>选品调研</Button></Link>
            <Link to="/publish"><Button icon={<Rocket size={15} />}>发起一次上架</Button></Link>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {[
          { label: "已连接店铺", value: `${connected}`, delta: `${stores.length - connected} 个待重连/断开`, icon: <Store size={17} />, tone: "neon" as const },
          { label: "选品候选", value: `${favorites.length}`, delta: favorites.length ? "来自 AI 调研" : "去调研收藏候选", icon: <Search size={17} />, tone: "accent" as const },
          { label: "上架草稿", value: `${drafts.length}`, delta: `${drafts.filter((d) => d.source === "主图工坊").length} 个来自主图工坊`, icon: <ImagePlus size={17} />, tone: "neon" as const },
          { label: "待处理", value: `${pending + running}`, delta: pending ? `${pending} 个写操作待审批` : "审批闸门全清", icon: <Hourglass size={17} />, tone: pendingTone },
        ].map((s, i) => (
          <motion.div key={s.label} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
            <Stat {...s} />
          </motion.div>
        ))}
      </div>

      <Card className="mt-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-semibold">自动化运营闭环（P0）</h3>
          <Badge tone={pipelineDone === 4 ? "neon" : "accent"}>{pipelineDone}/4 已点亮</Badge>
        </div>
        <div className="grid gap-3 md:grid-cols-4">
          {pipe.map((p, i) => (
            <Link key={p.key} to={p.to} className="focus-ring group">
              <Card hover className="flex h-full flex-col gap-2 !p-4">
                <div className="flex items-center justify-between">
                  {p.done ? <CheckCircle2 size={18} className="text-neon" /> : <Circle size={18} className="text-mute/50" />}
                  <span className="text-[10px] text-mute">Step {i + 1}</span>
                </div>
                <div className="flex items-center gap-2"><p.icon size={15} className="text-mute" /><span className="font-medium">{p.label}</span></div>
                <p className={`text-xs ${p.done ? "text-neon" : "text-mute"}`}>{p.note}</p>
              </Card>
            </Link>
          ))}
        </div>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-semibold">近 14 天自动化任务量</h3>
            <Badge tone="neon">峰值 141 次/日（mock）</Badge>
          </div>
          <AreaChart data={analyticsSeries} height={120} />
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-line bg-panel p-3">
              <div className="mb-2 text-xs font-medium text-mute">任务类型分布</div>
              <HBars items={[
                { name: "商品上架", v: tasks.filter((t) => t.kind === "商品上架").length * 20 + 48, color: "#00FF99" },
                { name: "主图生成", v: tasks.filter((t) => t.kind === "主图生成").length * 20 + 36, color: "#6C63FF" },
                { name: "选品调研", v: tasks.filter((t) => t.kind === "选品调研").length * 20 + 28, color: "#FF8C42" },
              ]} />
            </div>
            <div className="rounded-2xl border border-line bg-panel p-3">
              <div className="mb-2 text-xs font-medium text-mute">平台订单占比（7 日）</div>
              <HBars items={[
                { name: "拼多多", v: 1120, color: "#E33E3E" },
                { name: "淘宝", v: 834, color: "#FF8C42" },
                { name: "Amazon", v: 312, color: "#FF9900" },
              ]} />
            </div>
          </div>
        </Card>

        <div className="space-y-4">
          <Card>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-semibold">最近会话</h3>
              <Link to="/research" className="focus-ring rounded-lg p-1 text-mute hover:text-neon" aria-label="去选品调研"><ArrowUpRight size={14} /></Link>
            </div>
            <ul className="divide-y divide-line text-sm">
              {[
                latestRun
                  ? {
                      q: `品类调研「${latestRun.category}」`,
                      who: `选品调研 · ${RUN_STATUS_LABEL[latestRun.status]} · ${latestRun.signal_count ?? 0} 信号`,
                      t: fmtTime(latestRun.created_at),
                    }
                  : { q: "调研「车载支架」品类并给 6 款候选", who: "陈晨 · 选品调研", t: "10:12" },
                { q: "上周抖音店哪几款转化在掉", who: "陈晨 · 经营分析", t: "09:48" },
                { q: "给快充数据线生成 3 张主图方案", who: "沈默 · 主图工坊", t: "09:15" },
              ].map((c) => (
                <li key={c.q} className="flex items-center gap-2 py-2.5">
                  <Dot tone="mute" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs text-mute">{c.q}</div>
                    <div className="text-[10px] text-mute">{c.who}</div>
                  </div>
                  <span className="tnum text-[10px] text-mute">{c.t}</span>
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <div className="mb-3 flex items-center gap-2">
              {pending > 0 ? <Badge tone="warn">{pending} 待审批</Badge> : <Badge tone="neon">审批清空</Badge>}
              <span className="text-xs text-mute">写操作闸门 · 100% 可审计</span>
            </div>
            {lastAudit ? (
              <>
                <p className="text-sm">{lastAudit.user} 在「{lastAudit.action}」中</p>
                <p className="mt-1 text-xs text-mute">{lastAudit.time} · {lastAudit.result}</p>
                <Link to="/tasks"><Button variant="outline" className="mt-3 w-full">查看审计</Button></Link>
              </>
            ) : <p className="text-sm text-mute">暂无记录</p>}
          </Card>

          <Card>
            <h3 className="mb-3 flex items-center gap-2 font-semibold"><Sparkles size={15} className="text-neon" /> 连接器状态</h3>
            <ul className="space-y-1.5 text-sm">
              {installedConn.slice(0, 5).map((c) => (
                <li key={c.id} className="flex items-center gap-2">
                  <Dot tone="neon" pulse />
                  <span className="min-w-0 flex-1 truncate">{c.name}</span>
                  <span className="text-[11px] text-mute">{c.category}</span>
                </li>
              ))}
            </ul>
            <Link to="/connectors"><Button variant="outline" className="mt-3 w-full">去连接器市场</Button></Link>
          </Card>

          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-2 font-semibold"><Film size={15} className="text-[#6C63FF]" /> 自动剪辑</h3>
              <Link to="/editing" className="focus-ring rounded-lg p-1 text-mute hover:text-neon" aria-label="去自动剪辑"><ArrowUpRight size={14} /></Link>
            </div>
            <div className="space-y-1.5 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-mute">待审核视频</span>
                <span className="font-medium">{editingTasks.filter((t) => t.status === "待审核").length}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-mute">进行中</span>
                <span className="font-medium">{editingTasks.filter((t) => t.status === "排队中" || t.status === "剪辑中").length}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-mute">已发布</span>
                <span className="font-medium text-neon">{editingTasks.filter((t) => t.status === "已发布").length}</span>
              </div>
            </div>
            <Link to="/editing"><Button variant="outline" className="mt-3 w-full" icon={<Clapperboard size={13} />}>管理剪辑任务</Button></Link>
          </Card>

          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="flex items-center gap-2 font-semibold"><Brain size={15} className="text-warn" /> AI 售后</h3>
              <Link to="/after-sales" className="focus-ring rounded-lg p-1 text-mute hover:text-neon" aria-label="去 AI 售后"><ArrowUpRight size={14} /></Link>
            </div>
            <div className="space-y-1.5 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-mute">待审批回复</span>
                <span className="font-medium">{tickets.filter((t) => t.status === "待审批").length}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-mute">本周解决率</span>
                <span className="font-medium text-neon">80.9%</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-mute">AI 采纳率</span>
                <span className="font-medium text-neon">72.3%</span>
              </div>
            </div>
            <Link to="/after-sales"><Button variant="outline" className="mt-3 w-full" icon={<MessagesSquare size={13} />}>进入售后中心</Button></Link>
          </Card>
        </div>
      </div>
    </div>
  );
}
