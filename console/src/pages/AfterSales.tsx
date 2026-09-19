import { useState } from "react";
import { motion } from "framer-motion";
import { MessagesSquare, CheckCircle2, XCircle, Brain, TrendingUp, TrendingDown, Minus, Send, RotateCcw, AlertTriangle, Clock, ShieldAlert } from "lucide-react";
import { Card, Badge, Button, PageHeader, Tabs, Modal, Field } from "../components/ui";
import { HBars } from "../components/charts";
import { useEcom } from "../store/ecom";
import { metaOf, weeklyReport, type AfterSalesTicket, type AttributionType, type SuggestionType } from "../data/ecom";

const statusTone: Record<string, "neon" | "accent" | "warn" | "danger" | "mute"> = {
  "待分析": "mute", "分析中": "accent", "待审批": "warn", "已发出": "neon", "已驳回": "danger",
};

const attrColors: Record<AttributionType, string> = {
  "物流": "#38bdf8", "质量": "#FF8C42", "尺码": "#6C63FF", "错发": "#E33E3E", "其他": "#8fa3ad",
};

const suggestionIcons: Record<SuggestionType, string> = {
  "自助解决": "💡", "回复草稿": "📝", "建议退款": "💰",
};

function TicketCard({ ticket, onApprove, onReject }: {
  ticket: AfterSalesTicket;
  onApprove: (id: string) => void;
  onReject: (id: string, reason: string, feedback: string) => void;
}) {
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectFeedback, setRejectFeedback] = useState("");
  const [draftExpanded, setDraftExpanded] = useState(false);
  const meta = metaOf(ticket.platformId);

  return (
    <>
      <Card hover className="!p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-warn/10 text-warn">
            <MessagesSquare size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{ticket.customer}</span>
              <span className="text-xs text-mute">订单 {ticket.orderId}</span>
              <span className="flex items-center gap-1 text-xs">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: meta?.color ?? "#888" }} />
                <span className="text-mute">{meta?.short ?? ticket.platformId}</span>
              </span>
              <Badge tone={statusTone[ticket.status]}>{ticket.status}</Badge>
              <span className="ml-auto text-[10px] text-mute">{ticket.createdAt}</span>
            </div>

            <div className="mt-1 text-xs text-mute">
              <span className="text-ink/70">{ticket.productName}</span>
            </div>

            <div className="mt-2 rounded-xl bg-white/4 px-3 py-2 text-sm">
              <span className="text-mute">客户反馈：</span>{ticket.complaint}
            </div>

            {ticket.attribution && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium" style={{ background: `${attrColors[ticket.attribution]}18`, color: attrColors[ticket.attribution] }}>
                  <Brain size={12} />
                  AI 归因：{ticket.attribution}
                </div>
                <span className="text-[10px] text-mute">置信度 {ticket.confidence}%</span>
                {ticket.suggestion && (
                  <Badge tone={ticket.suggestion === "建议退款" ? "danger" : ticket.suggestion === "回复草稿" ? "warn" : "neon"}>
                    {suggestionIcons[ticket.suggestion]} {ticket.suggestion}
                  </Badge>
                )}
                {ticket.refundAmount && (
                  <span className="text-xs text-danger">退款 ¥{ticket.refundAmount}</span>
                )}
              </div>
            )}

            {ticket.status === "分析中" && (
              <div className="mt-2 flex items-center gap-2 text-xs text-[#b7b1ff]">
                <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }}>
                  <Brain size={14} />
                </motion.div>
                AI 正在归因分析…
              </div>
            )}

            {ticket.replyDraft && ticket.attribution && (
              <div className="mt-2">
                <button onClick={() => setDraftExpanded(!draftExpanded)} className="flex items-center gap-1 text-xs text-mute hover:text-neon">
                  {draftExpanded ? "收起回复草稿" : "查看 AI 回复草稿"}
                </button>
                {draftExpanded && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} className="mt-1 rounded-xl border border-line bg-panel p-3 text-sm leading-relaxed text-ink/80">
                    {ticket.replyDraft}
                  </motion.div>
                )}
              </div>
            )}

            {ticket.status === "已驳回" && (
              <div className="mt-2 space-y-1 rounded-xl bg-danger/5 px-3 py-2 text-xs">
                <div className="flex items-center gap-1 text-danger"><XCircle size={12} /> 驳回原因：{ticket.rejectReason}</div>
                {ticket.rejectFeedback && <div className="text-mute">反馈：{ticket.rejectFeedback}</div>}
              </div>
            )}

            {ticket.status === "已发出" && ticket.approvedAt && (
              <div className="mt-2 flex items-center gap-1 text-xs text-neon">
                <CheckCircle2 size={12} /> 已发出 · {ticket.approvedAt}
              </div>
            )}
          </div>

          {ticket.status === "待审批" && (
            <div className="flex shrink-0 flex-col gap-2">
              {ticket.suggestion === "建议退款" && ticket.refundAmount && (
                <div className="flex items-center gap-1 rounded-lg bg-danger/10 px-2 py-1 text-[10px] text-danger">
                  <ShieldAlert size={11} /> 退款 ¥{ticket.refundAmount}
                </div>
              )}
              <Button onClick={() => onApprove(ticket.id)} icon={<Send size={14} />}>批准发出</Button>
              <Button variant="outline" onClick={() => setRejectOpen(true)} icon={<XCircle size={14} />}>驳回</Button>
            </div>
          )}
        </div>
      </Card>

      <Modal open={rejectOpen} onClose={() => setRejectOpen(false)} title="驳回 AI 回复">
        <div className="space-y-4">
          <div className="rounded-xl bg-warn/5 px-3 py-2 text-xs text-warn">
            驳回后，原因和反馈将回流到 AI 学习池，帮助改进后续建议质量。
          </div>
          <Field label="驳回原因">
            <input className="w-full rounded-xl border border-line bg-panel px-3.5 py-2.5 text-sm text-ink placeholder:text-mute/60" placeholder="例：方案不合适、需先核实…" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
          </Field>
          <Field label="改进反馈（帮助 AI 学习）">
            <textarea className="w-full rounded-xl border border-line bg-panel px-3.5 py-2.5 text-sm text-ink placeholder:text-mute/60" rows={3} placeholder="告诉 AI 应该怎么处理…" value={rejectFeedback} onChange={(e) => setRejectFeedback(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-3">
            <Button variant="ghost" onClick={() => setRejectOpen(false)}>取消</Button>
            <Button variant="outline" onClick={() => { onReject(ticket.id, rejectReason || "未说明", rejectFeedback); setRejectOpen(false); }}>确认驳回</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

function WeeklyReportView() {
  const r = weeklyReport;
  const trendIcon = (t: "up" | "down" | "flat") => {
    if (t === "up") return <TrendingUp size={12} className="text-danger" />;
    if (t === "down") return <TrendingDown size={12} className="text-neon" />;
    return <Minus size={12} className="text-mute" />;
  };

  return (
    <div className="space-y-4">
      <Card>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-semibold">售后周报 · {r.period}</h3>
          <Badge tone="neon">AI 采纳率 {r.adoptionRate}%</Badge>
        </div>
        <div className="grid gap-4 sm:grid-cols-4">
          {[
            { label: "总工单", value: r.totalTickets, sub: "本周新增" },
            { label: "已解决", value: r.resolved, sub: `${r.resolutionRate}% 解决率` },
            { label: "AI 采纳率", value: `${r.adoptionRate}%`, sub: "≥60% 达标" },
            { label: "平均响应", value: r.avgResponseTime, sub: "较上周 -3min" },
          ].map((s) => (
            <div key={s.label} className="rounded-2xl border border-line bg-panel p-4 text-center">
              <div className="text-xs text-mute">{s.label}</div>
              <div className="mt-1 font-display text-2xl font-bold">{s.value}</div>
              <div className="mt-0.5 text-[10px] text-mute">{s.sub}</div>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h3 className="mb-3 font-semibold">归因分布</h3>
          <HBars items={r.attributionBreakdown.map((b) => ({ name: b.name, v: b.count, color: b.color }))} />
        </Card>
        <Card>
          <h3 className="mb-3 font-semibold">高频问题 Top5</h3>
          <div className="space-y-2.5">
            {r.topIssues.map((issue) => (
              <div key={issue.issue} className="flex items-center gap-2 text-sm">
                {trendIcon(issue.trend)}
                <span className="flex-1">{issue.issue}</span>
                <span className="tnum text-xs text-mute">{issue.count} 次</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

export default function AfterSales() {
  const { tickets, analyzeTickets, approveReply, rejectReply } = useEcom();
  const [tab, setTab] = useState("工单队列");
  const [filter, setFilter] = useState("全部");

  const pendingApproval = tickets.filter((t) => t.status === "待审批");
  const analyzing = tickets.filter((t) => t.status === "待分析" || t.status === "分析中");
  const pendingAnalysis = tickets.filter((t) => t.status === "待分析");

  const filtered = filter === "全部" ? tickets : tickets.filter((t) => t.status === filter);
  const filters = ["全部", "待分析", "分析中", "待审批", "已发出", "已驳回"];

  return (
    <div>
      <PageHeader
        title="AI 售后中心"
        sub="AI 归因分析 → 建议处理方案 → 人批准发出 → 驳回回流学习"
        actions={
          pendingAnalysis.length > 0 ? (
            <Button icon={<Brain size={15} />} onClick={analyzeTickets}>
              AI 归因分析（{pendingAnalysis.length} 条待分析）
            </Button>
          ) : undefined
        }
      />

      <div className="mb-4 grid gap-4 sm:grid-cols-4">
        {[
          { label: "待审批", value: pendingApproval.length, tone: "warn" as const, icon: <AlertTriangle size={17} /> },
          { label: "分析中", value: analyzing.length, tone: "accent" as const, icon: <Brain size={17} /> },
          { label: "本周解决率", value: `${weeklyReport.resolutionRate}%`, tone: "neon" as const, icon: <CheckCircle2 size={17} /> },
          { label: "AI 采纳率", value: `${weeklyReport.adoptionRate}%`, tone: "neon" as const, icon: <RotateCcw size={17} /> },
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

      <Tabs items={["工单队列", "周报"]} active={tab} onChange={setTab} />

      {tab === "工单队列" ? (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            {filters.map((f) => (
              <button key={f} onClick={() => setFilter(f)} className={`focus-ring rounded-full px-3 py-1 text-xs transition-colors ${filter === f ? "bg-neon/15 font-semibold text-neon" : "bg-white/5 text-mute hover:text-ink"}`}>
                {f}
                {f === "待审批" && pendingApproval.length > 0 && (
                  <span className="ml-1 text-warn">{pendingApproval.length}</span>
                )}
              </button>
            ))}
          </div>

          <div className="space-y-3">
            {filtered.map((t) => (
              <TicketCard key={t.id} ticket={t} onApprove={approveReply} onReject={rejectReply} />
            ))}
            {filtered.length === 0 && (
              <Card className="py-12 text-center text-sm text-mute">
                <MessagesSquare size={28} className="mx-auto mb-2 text-mute/40" />
                暂无{filter === "全部" ? "" : filter}工单
              </Card>
            )}
          </div>
        </>
      ) : (
        <WeeklyReportView />
      )}
    </div>
  );
}
