import { useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import { Clapperboard, Play, CheckCircle2, XCircle, Clock, Loader2, Film, Sparkles, ChevronDown, ChevronUp, Eye, Download } from "lucide-react";
import { Card, Badge, Button, PageHeader, Field, Select, Tabs, Modal } from "../components/ui";
import { MockBadge } from "../components/mock";
import { useEcom } from "../store/ecom";
import { editingTemplates, platformMeta, type EditingTask } from "../data/ecom";

const statusTone: Record<string, "neon" | "accent" | "warn" | "danger" | "mute"> = {
  "排队中": "mute", "剪辑中": "accent", "待审核": "warn", "已发布": "neon", "已驳回": "danger", "失败": "danger",
};

const providerColors: Record<string, string> = { OpenCut: "#6C63FF", OpenMontage: "#FF8C42" };

function TaskCard({ task, onApprove, onReject }: { task: EditingTask; onApprove: (id: string) => void; onReject: (id: string, reason: string) => void }) {
  const [expanded, setExpanded] = useState(task.status === "待审核");
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  return (
    <>
      <Card hover className="!p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ background: `${providerColors[task.provider]}20` }}>
            <Film size={18} style={{ color: providerColors[task.provider] }} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-medium">{task.title}</span>
              <Badge tone={statusTone[task.status]}>{task.status}</Badge>
              <span className="text-[10px] text-mute">{task.provider}</span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-mute">
              <span>模板：{task.template}</span>
              <span>素材：{task.assetNames.length} 项</span>
              <span>创建：{task.createdAt}</span>
              {task.completedAt && <span>完成：{task.completedAt}</span>}
              {task.approver && <span className="text-neon">审批人：{task.approver}</span>}
            </div>

            {task.status === "排队中" && task.queuePosition && (
              <div className="mt-2 flex items-center gap-2 rounded-xl bg-white/4 px-3 py-2 text-xs">
                <Clock size={13} className="text-mute" />
                <span className="text-mute">队列第 {task.queuePosition} 位</span>
                <span className="text-neon">{task.queueEta}</span>
              </div>
            )}

            {task.status === "剪辑中" && <EditingProgress />}

            {task.status === "已驳回" && task.rejectReason && (
              <div className="mt-2 rounded-xl bg-danger/5 px-3 py-2 text-xs text-danger">
                驳回原因：{task.rejectReason}
              </div>
            )}

            {(task.status === "待审核" || task.status === "已发布") && task.adaptations.length > 0 && (
              <button onClick={() => setExpanded(!expanded)} className="mt-2 flex items-center gap-1 text-xs text-mute hover:text-neon">
                {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                {expanded ? "收起平台适配" : `查看 ${task.adaptations.length} 个平台适配`}
              </button>
            )}
          </div>

          {task.status === "待审核" && (
            <div className="flex shrink-0 gap-2">
              <Button variant="outline" onClick={() => { setRejectOpen(true); }} icon={<XCircle size={14} />}>驳回</Button>
              <Button onClick={() => onApprove(task.id)} icon={<CheckCircle2 size={14} />}>批准发布</Button>
            </div>
          )}
          {task.status === "已发布" && (
            <div className="flex shrink-0 gap-2">
              <Button variant="outline" icon={<Eye size={14} />}>预览</Button>
              <Button variant="ghost" icon={<Download size={14} />}>下载</Button>
            </div>
          )}
        </div>

        {expanded && task.adaptations.some((a) => a.ready) && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} className="mt-4 grid gap-3 sm:grid-cols-2">
            {task.adaptations.map((a) => {
              const meta = platformMeta[a.platformId];
              return (
                <div key={a.platformId} className="rounded-2xl border border-line bg-panel p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="h-3 w-3 rounded-full" style={{ background: meta?.color ?? "#888" }} />
                      <span className="text-sm font-medium">{meta?.name ?? a.platformId}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-mute">
                      <span>{a.aspectRatio}</span>
                      <span>·</span>
                      <span>{a.duration}</span>
                    </div>
                  </div>
                  <div className="flex items-center justify-center rounded-xl bg-carbon py-6" style={a.aspectRatio === "9:16" ? { aspectRatio: "9/16", maxHeight: 160 } : { aspectRatio: "1/1", maxHeight: 160 }}>
                    {a.ready ? (
                      <div className="text-center">
                        <Play size={24} className="mx-auto mb-1 text-neon" />
                        <span className="text-xs text-mute">视频就绪</span>
                      </div>
                    ) : (
                      <Loader2 size={20} className="animate-spin text-mute" />
                    )}
                  </div>
                  {a.copy && <p className="mt-2 text-xs text-mute">文案：{a.copy}</p>}
                </div>
              );
            })}
          </motion.div>
        )}
      </Card>

      <Modal open={rejectOpen} onClose={() => setRejectOpen(false)} title="驳回视频">
        <Field label="驳回原因">
          <input className="w-full rounded-xl border border-line bg-panel px-3.5 py-2.5 text-sm text-ink placeholder:text-mute/60" placeholder="说明驳回原因，便于剪辑团队调整…" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
        </Field>
        <div className="mt-5 flex justify-end gap-3">
          <Button variant="ghost" onClick={() => setRejectOpen(false)}>取消</Button>
          <Button variant="outline" onClick={() => { onReject(task.id, rejectReason || "未说明"); setRejectOpen(false); setRejectReason(""); }}>确认驳回</Button>
        </div>
      </Modal>
    </>
  );
}

function EditingProgress() {
  const [step, setStep] = useState(0);
  const steps = ["素材解析", "镜头编排", "文案适配", "渲染导出"];
  const timer = useRef<number | null>(null);
  useEffect(() => {
    timer.current = window.setInterval(() => {
      setStep((s) => {
        if (s >= steps.length - 1) { if (timer.current) window.clearInterval(timer.current); return s; }
        return s + 1;
      });
    }, 1200);
    return () => { if (timer.current) window.clearInterval(timer.current); };
  }, []);
  return (
    <div className="mt-2 flex items-center gap-2">
      {steps.map((s, i) => (
        <div key={s} className="flex items-center gap-1.5">
          <div className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${i <= step ? "bg-neon/20 text-neon" : "bg-white/5 text-mute"}`}>
            {i < step ? <CheckCircle2 size={12} className="text-neon" /> : i === step ? <Loader2 size={11} className="animate-spin text-neon" /> : i + 1}
          </div>
          <span className={`text-[11px] ${i <= step ? "text-neon" : "text-mute"}`}>{s}</span>
          {i < steps.length - 1 && <span className="text-mute/30">→</span>}
        </div>
      ))}
    </div>
  );
}

export default function Editing() {
  const { assets, editingTasks, createEditingTask, approveEditingVideo, rejectEditingVideo } = useEcom();
  const [tab, setTab] = useState("任务列表");
  const [selectedAssets, setSelectedAssets] = useState<string[]>([]);
  const [template, setTemplate] = useState(editingTemplates[0].label);
  const [provider, setProvider] = useState<"OpenCut" | "OpenMontage">("OpenCut");
  const [title, setTitle] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  const toggleAsset = (name: string) => {
    setSelectedAssets((prev) => prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]);
  };

  const handleCreate = () => {
    if (!title.trim() || selectedAssets.length === 0) return;
    createEditingTask(title, selectedAssets, provider, template);
    setTitle(""); setSelectedAssets([]); setCreateOpen(false);
  };

  const pending = editingTasks.filter((t) => t.status === "待审核");
  const active = editingTasks.filter((t) => t.status === "排队中" || t.status === "剪辑中");
  const done = editingTasks.filter((t) => t.status === "已发布" || t.status === "已驳回");

  return (
    <div>
      <PageHeader
        title="自动剪辑"
        sub="接入 OpenCut / OpenMontage 第三方剪辑能力 · 选素材 → 自动出片 → 平台画幅适配 → 审批发布"
        actions={
          <div className="flex items-center gap-3">
            <MockBadge />
            <Button icon={<Sparkles size={15} />} onClick={() => setCreateOpen(true)}>发起剪辑任务</Button>
          </div>
        }
      />

      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        {[
          { label: "待审核", value: pending.length, tone: "warn" as const, icon: <Eye size={17} /> },
          { label: "进行中", value: active.length, tone: "accent" as const, icon: <Loader2 size={17} /> },
          { label: "已完成", value: done.length, tone: "neon" as const, icon: <CheckCircle2 size={17} /> },
        ].map((s) => (
          <Card key={s.label} hover className="flex items-center gap-3 !p-4">
            <span className={s.tone === "warn" ? "text-warn" : s.tone === "accent" ? "text-[#b7b1ff]" : "text-neon"}>{s.icon}</span>
            <div>
              <div className="text-xs text-mute">{s.label}</div>
              <div className="font-display text-2xl font-bold">{s.value}</div>
            </div>
          </Card>
        ))}
      </div>

      <Tabs items={["任务列表", "待审核", "已完成"]} active={tab} onChange={setTab} />

      <div className="space-y-3">
        {(tab === "任务列表" ? editingTasks : tab === "待审核" ? pending : done).map((t) => (
          <TaskCard key={t.id} task={t} onApprove={approveEditingVideo} onReject={rejectEditingVideo} />
        ))}
        {(tab === "任务列表" ? editingTasks : tab === "待审核" ? pending : done).length === 0 && (
          <Card className="py-12 text-center text-sm text-mute">
            <Clapperboard size={28} className="mx-auto mb-2 text-mute/40" />
            暂无{tab}任务
          </Card>
        )}
      </div>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="发起剪辑任务" wide>
        <div className="space-y-5">
          <Field label="任务标题">
            <input className="w-full rounded-xl border border-line bg-panel px-3.5 py-2.5 text-sm text-ink placeholder:text-mute/60" placeholder="例：快充数据线 · 商品展示视频" value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="剪辑服务商">
              <Select value={provider} options={["OpenCut", "OpenMontage"]} onChange={(v) => setProvider(v as "OpenCut" | "OpenMontage")} />
            </Field>
            <Field label="模板">
              <Select value={template} options={editingTemplates.map((t) => t.label)} onChange={setTemplate} />
            </Field>
          </div>

          {editingTemplates.find((t) => t.label === template) && (
            <p className="rounded-xl bg-white/4 px-3 py-2 text-xs text-mute">{editingTemplates.find((t) => t.label === template)!.desc}</p>
          )}

          <div>
            <div className="mb-2 text-xs font-medium text-mute">选择素材（已选 {selectedAssets.length} 项）</div>
            <div className="grid gap-2 sm:grid-cols-2">
              {assets.map((a) => {
                const selected = selectedAssets.includes(a.name);
                return (
                  <button key={a.id} onClick={() => toggleAsset(a.name)} className={`focus-ring flex items-center gap-3 rounded-xl border p-3 text-left text-sm transition-colors ${selected ? "border-neon/50 bg-neon/5" : "border-line hover:border-neon/20"}`}>
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg text-xs font-bold" style={{ background: a.color ? `${a.color}25` : "rgba(255,255,255,0.06)", color: a.color || "#8fa3ad" }}>
                      {a.letter || a.name[0]}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate">{a.name}</div>
                      <div className="text-[10px] text-mute">{a.tags.join(" · ")}</div>
                    </div>
                    {selected && <CheckCircle2 size={16} className="shrink-0 text-neon" />}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex justify-end gap-3">
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>取消</Button>
            <Button onClick={handleCreate} disabled={!title.trim() || selectedAssets.length === 0} icon={<Clapperboard size={14} />}>提交剪辑</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
