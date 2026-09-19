import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Rocket, Check, RefreshCw, AlertCircle, ShieldCheck } from "lucide-react";
import { Card, Badge, Button, Dot, PageHeader, Progress, inputCls } from "../components/ui";
import ApprovalGate from "../components/ApprovalGate";
import { platformMeta, publishPlatformOptions, complianceFor } from "../data/ecom";
import { useEcom } from "../store/ecom";
import { MainImageMock } from "./Studio";
import { studioVariants } from "../data/ecom";

const steps = ["填充商品资料", "生成平台字段映射", "逐平台合规自检", "写入平台草稿"];

export default function Publish() {
  const { drafts, tasks, submitPublish, approvePublish, finishPublish, retryFailedPlatform } = useEcom();
  const [draftId, setDraftId] = useState(drafts[0]?.id ?? "");
  const [platforms, setPlatforms] = useState<string[]>(["taobao", "douyin"]);
  const [mode, setMode] = useState<"preview" | "running" | "done">("preview");
  const [approveOpen, setApproveOpen] = useState(false);
  const [runStep, setRunStep] = useState(0);
  const [taskId, setTaskId] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current) window.clearInterval(timer.current); }, []);

  const draft = drafts.find((d) => d.id === draftId) ?? drafts[0];
  const compliance = draft ? complianceFor(draft.title, platforms) : {};
  const activeTask = taskId ? tasks.find((t) => t.id === taskId) ?? null : null;

  const toggle = (id: string) => setPlatforms((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));

  const submit = async () => {
    if (!draft || platforms.length === 0) return;
    const id = await submitPublish(draft.id, platforms);
    if (!id) return;
    setTaskId(id);
    setApproveOpen(true);
  };

  const run = () => {
    setMode("running");
    setRunStep(0);
    let i = 0;
    timer.current = window.setInterval(() => {
      i += 1;
      if (i >= steps.length) {
        if (timer.current) window.clearInterval(timer.current);
        // 结果不再前端伪造：触发一次任务刷新，done 卡片读取服务端 results
        if (taskId) void finishPublish(taskId, []);
        setMode("done");
      } else {
        setRunStep(i);
      }
    }, 620);
  };

  const reset = () => {
    if (timer.current) window.clearInterval(timer.current);
    setMode("preview");
    setTaskId(null);
    setRunStep(0);
  };

  const statusMeta = (s: string) =>
    s === "成功" ? { color: "text-neon", bg: "bg-neon/10 border-neon/25", dot: "neon" as const }
      : s === "打回" ? { color: "text-warn", bg: "bg-warn/10 border-warn/25", dot: "warn" as const }
      : { color: "text-mute", bg: "bg-white/5 border-line", dot: "mute" as const };

  return (
    <div>
      <PageHeader
        title="商品上架"
        sub="填一份资料，勾选平台，AI 生成各平台字段并逐项合规预览；写操作必须过审批闸门"
        actions={mode === "done" ? <Button variant="ghost" icon={<RefreshCw size={14} />} onClick={reset}>新建上架</Button> : undefined}
      />

      {drafts.length === 0 ? (
        <Card className="flex flex-col items-center py-16 text-center">
          <Rocket size={36} className="mb-3 text-mute" />
          <h3 className="text-lg font-semibold">还没有上架草稿</h3>
          <p className="mt-1 text-sm text-mute">先在「主图工坊」生成主图并转上架材料，或录入一个草稿。</p>
          <Link to="/studio"><Button className="mt-5">去主图工坊</Button></Link>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
          <div className="space-y-4">
            <Card className="space-y-4">
              <div>
                <div className="mb-1.5 text-xs font-medium text-mute">选择商品草稿</div>
                <select value={draftId} onChange={(e) => { setDraftId(e.target.value); setMode("preview"); setTaskId(null); }} className={inputCls}>
                  {drafts.map((d) => <option key={d.id} value={d.id}>{d.title}（¥{d.price} · {d.source}）</option>)}
                </select>
              </div>

              <div>
                <div className="mb-1.5 text-xs font-medium text-mute">今晚要上的平台（{platforms.length}）</div>
                <div className="flex flex-wrap gap-2">
                  {publishPlatformOptions.map((id) => {
                    const meta = platformMeta[id];
                    const on = platforms.includes(id);
                    const connectedStore = true;
                    return (
                      <button key={id} onClick={() => toggle(id)} className={`focus-ring flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-colors ${on ? "border-neon/60 bg-neon/10 text-neon" : "border-line text-mute hover:text-ink"}`}>
                        <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: connectedStore ? meta.color : "#555" }} />
                        {meta.name}
                      </button>
                    );
                  })}
                </div>
              </div>

              {draft && (
                <div className="grid gap-4 sm:grid-cols-[180px_1fr]">
                  <MainImageMock title={draft.title} variant={studioVariants[0]} tagline={draft.sellingPoints[0]} />
                  <div className="text-sm">
                    <div className="mb-1 flex items-center gap-2"><span className="font-semibold">{draft.title}</span><Badge tone="accent">¥{draft.price}</Badge></div>
                    <div className="text-xs text-mute">主图：{draft.imageLabel} · 卖点：{draft.sellingPoints.join(" / ")}</div>
                    <div className="mt-3 text-xs text-mute">合规预览（AI 自动标注差异，可在此页面原地调整）</div>
                  </div>
                </div>
              )}
            </Card>

            {mode === "preview" && platforms.length > 0 && (
              <Card>
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="font-semibold">平台合规预览</h3>
                  <Badge tone={Object.values(compliance).flat().some((x) => x !== "合规校验通过") ? "warn" : "neon"}>
                    {Object.values(compliance).flat().some((x) => x !== "合规校验通过") ? "存在差异" : "全部通过"}
                  </Badge>
                </div>
                <div className="space-y-2.5">
                  {platforms.map((p) => {
                    const issues = compliance[p] ?? [];
                    const ok = issues.length === 1 && issues[0] === "合规校验通过";
                    return (
                      <div key={p} className={`rounded-2xl border p-3 ${ok ? "border-line" : "border-warn/30 bg-warn/4"}`}>
                        <div className="flex items-center gap-2 text-sm">
                          <span className="font-medium">{platformMeta[p].name}</span>
                          {ok ? <Badge tone="neon"><Check size={11} /> 合规</Badge> : <Badge tone="warn"><AlertCircle size={11} /> 需处理</Badge>}
                        </div>
                        <ul className="mt-2 space-y-1 text-xs text-mute">
                          {issues.map((msg) => <li key={msg} className={ok ? "text-neon/80" : "text-warn"}>{ok ? "✓ " : "⚠ "}{msg}</li>)}
                        </ul>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-4 flex justify-end">
                  <Button icon={<ShieldCheck size={15} />} onClick={submit}>提交上架（进入审批）</Button>
                </div>
              </Card>
            )}

            {mode === "running" && taskId && (
              <Card>
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="font-semibold">正在执行上架（审批已通过）</h3>
                  <Badge tone="neon"><Dot tone="neon" pulse /> 运行中</Badge>
                </div>
                <ol className="space-y-2.5">
                  {steps.map((s, i) => {
                    const st = i < runStep ? "done" : i === runStep ? "current" : "todo";
                    return (
                      <li key={s} className={`flex items-center gap-3 text-sm ${st === "todo" ? "text-mute/70" : "text-ink"}`}>
                        <span className={`flex h-5 w-5 items-center justify-center rounded-full ${st === "done" ? "bg-neon text-[#04110b]" : st === "current" ? "animate-pulse border border-neon/60 text-neon" : "border border-line"}`}>
                          {st === "done" ? <Check size={12} /> : st === "current" ? <Dot tone="neon" pulse /> : i + 1}
                        </span>
                        {s}
                      </li>
                    );
                  })}
                </ol>
                <div className="mt-4"><Progress value={Math.round((runStep / steps.length) * 100)} label="执行进度" /></div>
              </Card>
            )}

            {mode === "done" && activeTask?.results && (
              <Card>
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="font-semibold">上架结果汇总</h3>
                  <Badge tone={activeTask.status === "成功" ? "neon" : "warn"}>{activeTask.status}</Badge>
                </div>
                <div className="space-y-2.5">
                  {activeTask.results.map((r) => {
                    const m = statusMeta(r.status);
                    const canRetry = r.status === "打回";
                    return (
                      <div key={r.platformId} className={`flex flex-wrap items-center gap-3 rounded-2xl border p-3 ${m.bg}`}>
                        <Dot tone={m.dot} pulse={r.status === "成功"} />
                        <div className="min-w-0 flex-1">
                          <div className={`text-sm font-medium ${m.color}`}>{platformMeta[r.platformId]?.name} · {r.status}</div>
                          {r.reason && <div className="text-xs text-mute">打回原因：{r.reason}</div>}
                        </div>
                        {canRetry && taskId && (
                          <Button variant="outline" icon={<RefreshCw size={13} />} onClick={() => retryFailedPlatform(taskId, r.platformId)}>修正后重试该平台</Button>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="mt-3 text-xs text-mute">每一次平台写入都已进入审计日志：谁批准、何时、改了哪个平台——可去 <Link to="/tasks" className="text-neon underline">任务中心</Link> 回看。</div>
                {activeTask.status !== "成功" && (
                  <div className="mt-4 flex justify-end"><Button icon={<RefreshCw size={14} />} onClick={reset}>新建上架</Button></div>
                )}
              </Card>
            )}
          </div>

          <Card className="h-fit">
            <div className="mb-2 flex items-center gap-2"><ShieldCheck size={16} className="text-warn" /><h3 className="font-semibold">信任规则（红线）</h3></div>
            <ul className="space-y-2 text-xs text-mute">
              <li>· 跨平台写操作必须人工确认，不可跳过审批。</li>
              <li>· 执行后每条动作进入审计，可回看批准人 / 时间 / 对象。</li>
              <li>· 平台打回可单独重试该平台，不影响已成功平台。</li>
              <li>· 本演示为前端状态机模拟，不产生真实平台写入。</li>
            </ul>
            <div className="mt-4 rounded-2xl border border-line bg-panel p-3">
              <div className="text-xs font-medium text-ink">快捷路径</div>
              <div className="mt-2 space-y-1 text-xs text-mute">
                <div>① <Link to="/stores" className="text-neon">连接店铺</Link> ② <Link to="/research" className="text-neon">选品调研</Link></div>
                <div>③ <Link to="/studio" className="text-neon">生成主图</Link> → 本文档</div>
              </div>
            </div>
          </Card>
        </div>
      )}

      <ApprovalGate
        open={approveOpen}
        title={draft ? `「${draft.title}」多渠道上架` : "商品上架"}
        action={`向 ${platforms.map((p) => platformMeta[p]?.short).join("、")} 写入商品资料与主图（写操作）`}
        scope={platforms.map((p) => platformMeta[p]?.name).join("、")}
        approver="林芳"
        onCancel={() => setApproveOpen(false)}
        onConfirm={() => {
          setApproveOpen(false);
          if (taskId) approvePublish(taskId);
          run();
        }}
      />
    </div>
  );
}
