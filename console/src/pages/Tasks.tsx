import { useState } from "react";
import { Link } from "react-router-dom";
import { Check, RefreshCw, Square, ShieldCheck, CircleDot } from "lucide-react";
import { Card, Badge, Button, Dot, PageHeader } from "../components/ui";
import { useEcom } from "../store/ecom";
import type { Audit, Task } from "../data/ecom";

const taskTone: Record<string, { label: string; tone: "neon" | "warn" | "danger" | "accent" | "mute" }> = {
  成功: { label: "成功", tone: "neon" },
  运行中: { label: "运行中", tone: "accent" },
  待审批: { label: "待审批", tone: "warn" },
  部分失败: { label: "部分失败", tone: "warn" },
  失败: { label: "失败", tone: "danger" },
  已停止: { label: "已停止", tone: "mute" },
};

const levelTone = (l: Audit["level"]) =>
  l === "高危" ? "danger" : l === "写入" ? "warn" : l === "只读" ? "accent" : "mute";

export default function Tasks() {
  const { tasks, audits, approveTask, rerunTask, stopTask } = useEcom();
  const [tab, setTab] = useState<"任务" | "审计">("任务");
  const sorted = [...tasks].sort((a, b) => (a.status === "运行中" || a.status === "待审批" ? -1 : 1));

  const actions = (t: Task) => {
    if (t.status === "待审批")
      return (
        <>
          <Badge tone="warn">需 {t.approver ?? "林芳"} 批准</Badge>
          <Button variant="outline" icon={<ShieldCheck size={13} />} onClick={() => approveTask(t.id)}>批准执行</Button>
        </>
      );
    if (t.status === "运行中") return <Button variant="ghost" icon={<Square size={12} />} onClick={() => stopTask(t.id)}>停止</Button>;
    if (t.status === "已停止") return <Button variant="outline" icon={<RefreshCw size={13} />} onClick={() => rerunTask(t.id)}>重跑</Button>;
    if (t.status === "部分失败") return <Button variant="outline" icon={<RefreshCw size={13} />} onClick={() => rerunTask(t.id)}>整体重跑</Button>;
    return <Button variant="ghost" icon={<RefreshCw size={13} />} onClick={() => rerunTask(t.id)}>重跑</Button>;
  };

  return (
    <div>
      <PageHeader title="任务中心与审计" sub="每个自动化任务做到哪一步都可见；写操作谁批的、改了哪，随时可回看" />

      <div className="mb-5 inline-flex rounded-2xl border border-line bg-panel p-1">
        {(["任务", "审计"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`focus-ring rounded-xl px-4 py-1.5 text-sm ${tab === t ? "bg-gradient-to-r from-neon to-neondeep font-semibold text-[#04110b]" : "text-mute hover:text-ink"}`}>
            {t}
            <span className="ml-1.5 opacity-70">{t === "任务" ? tasks.length : audits.length}</span>
          </button>
        ))}
      </div>

      {tab === "任务" ? (
        <div className="space-y-3">
          {sorted.length === 0 && <Card className="py-10 text-center text-sm text-mute">还没有任务，去跑一个「选品调研」或「商品上架」。</Card>}
          {sorted.map((t) => {
            const meta = taskTone[t.status] ?? taskTone.成功;
            return (
              <Card key={t.id} hover className="flex flex-wrap items-start gap-4">
                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="mute">{t.kind}</Badge>
                    <h3 className="font-semibold">{t.title}</h3>
                    <Badge tone={meta.tone}>{meta.label}</Badge>
                    {t.status === "运行中" && <Dot tone="neon" pulse />}
                  </div>
                  <div className="mt-1 text-xs text-mute">目标：{t.target} · 开始于 {t.startedAt}</div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {t.steps.map((s, i) => {
                      const done = i < t.stepIndex;
                      const current = t.status === "运行中" && i === t.stepIndex;
                      return (
                        <span key={s} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] ${done ? "bg-neon/10 text-neon" : current ? "border border-accent/40 text-[#b7b1ff]" : "bg-white/5 text-mute"}`}>
                          {done ? <Check size={10} /> : current ? <CircleDot size={10} /> : <span className="opacity-50">{i + 1}</span>}
                          {s}
                        </span>
                      );
                    })}
                  </div>
                  {t.results && t.results.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {t.results.map((r) => (
                        <span key={r.platformId} className={`inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] ${r.status === "成功" ? "bg-neon/10 text-neon" : "bg-warn/10 text-warn"}`}>
                          <Dot tone={r.status === "成功" ? "neon" : "warn"} />
                          {r.platformId}
                          {r.reason && ` · ${r.reason}`}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">{actions(t)}</div>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-semibold">审计日志（写操作全记录）</h3>
            <span className="text-xs text-mute">写操作 100% 可审计 · 由 AGP 审批闸门保障</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b border-line text-xs text-mute">
                  <th className="py-2.5 pr-3 font-medium">时间</th>
                  <th className="py-2.5 pr-3 font-medium">成员</th>
                  <th className="py-2.5 pr-3 font-medium">动作</th>
                  <th className="py-2.5 pr-3 font-medium">对象</th>
                  <th className="py-2.5 pr-3 font-medium">级别</th>
                  <th className="py-2.5 font-medium">结果</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {audits.map((a) => (
                  <tr key={a.id} className="hover:bg-white/[0.02]">
                    <td className="tnum py-3 pr-3 text-xs text-mute">{a.time}</td>
                    <td className="py-3 pr-3 font-medium">{a.user}</td>
                    <td className="py-3 pr-3 text-mute">{a.action}</td>
                    <td className="py-3 pr-3 text-mute">{a.target}</td>
                    <td className="py-3 pr-3"><Badge tone={levelTone(a.level) as "danger" | "warn" | "accent" | "mute"}>{a.level}</Badge></td>
                    <td className={`py-3 ${a.result.includes("打回") || a.result.includes("拦截") ? "text-warn" : a.result.includes("成功") || a.result.includes("通过") ? "text-neon" : "text-mute"}`}>{a.result}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-mute">提示：完整「审批 → 执行 → 打回 → 重试」闭环可在 <Link to="/publish" className="text-neon underline">商品上架</Link> 里走一遍。</p>
        </Card>
      )}
    </div>
  );
}
