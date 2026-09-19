import type { AfterSalesTicket, Audit, Task, TaskResult, TicketStatus } from "../data/ecom";

export const taskStatus = (s: string): string =>
  ({
    created: "排队中",
    pending_approval: "待审批",
    running: "运行中",
    succeeded: "成功",
    partial_failed: "部分失败",
    failed: "失败",
    rejected: "已驳回",
  })[s] ?? s;

export const levelLabel = (l: string): string =>
  ({ read: "只读", write: "写入", high_risk: "高危", system: "系统" })[l] ?? l;

export const resultLabel = (r: string): string =>
  ({ ok: "成功", denied: "已拒绝", failed: "失败" })[r] ?? r;

export const riskLabel = (r: string): string =>
  ({ low: "低", medium: "中", high: "高" })[r] ?? r;

export const connectorStatus = (s: string): string =>
  ({ active: "已安装", revoked: "未安装", expired: "授权过期" })[s] ?? s;

export const ticketStatus = (s: string): string =>
  s === "已转执行" ? "已发出" : s;

export const taskKindLabel = (t: string): string =>
  ({ publish: "商品上架", after_sales: "售后处理" })[t] ?? t;

const PLATFORM_SHORT: Record<string, string> = {
  taobao: "淘宝",
  tmall: "天猫",
  douyin: "抖音",
  pdd: "拼多多",
  jd: "京东",
};

export const platformShort = (kindOrPlatform: string): string => {
  const p = kindOrPlatform.replace(/-shop$/, "");
  return PLATFORM_SHORT[p] ?? kindOrPlatform;
};

/** ISO "2026-09-03T12:00:00" → "09-03 12:00"（后端 naive UTC，直接截取展示）。 */
export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(iso);
  return m ? `${m[2]}-${m[3]} ${m[4]}:${m[5]}` : iso;
}

export interface BackendStep {
  seq: number;
  name: string;
  tool: string;
  status: string;
  error?: string | null;
}

export interface BackendTask {
  id: string;
  type: string;
  title: string;
  status: string;
  payload: Record<string, unknown>;
  created_at: string | null;
  steps: BackendStep[];
  approval?: { id?: string; decided_by?: string | null; status?: string } | null;
}

const DONE_STATUSES = new Set(["succeeded", "partial_failed", "failed"]);

export function backendTaskToProto(task: BackendTask): Task {
  const stepIndex = task.steps.filter((s) => s.status === "succeeded").length;
  let results: TaskResult[] | undefined;
  if (DONE_STATUSES.has(task.status)) {
    results = task.steps.map((s) => ({
      platformId: s.tool.split(":")[0].replace(/-shop$/, ""),
      status: s.status === "succeeded" ? ("成功" as const) : ("打回" as const),
      ...(s.status === "succeeded" ? {} : { reason: s.error ?? "见审计" }),
    }));
  }
  const platforms = (task.payload?.platforms as string[] | undefined) ?? [];
  const target = platforms.length
    ? platforms.map(platformShort).join("、")
    : `${platformShort(task.steps[0]?.tool.split(":")[0] ?? "")} · ${String(task.payload?.ticket_id ?? task.title)}`;
  return {
    id: task.id,
    kind: taskKindLabel(task.type),
    title: task.title,
    status: taskStatus(task.status) as Task["status"],
    stepIndex,
    steps: task.steps.map((s) => s.name),
    target,
    startedAt: fmtTime(task.created_at),
    approver: task.approval?.decided_by ?? undefined,
    results,
  };
}

export interface BackendAudit {
  id: string;
  at: string | null;
  user_id: string;
  actor: string;
  action: string;
  target_type: string;
  target_id: string;
  level: string;
  result: string;
  detail?: unknown;
}

export function backendAuditToProto(row: BackendAudit): Audit {
  return {
    id: row.id,
    time: fmtTime(row.at),
    user: row.actor.startsWith("user:") ? row.actor.slice(5) : row.actor || row.user_id,
    action: row.action,
    target: row.target_id || row.target_type,
    level: levelLabel(row.level) as Audit["level"],
    result: resultLabel(row.result),
  };
}

export interface BackendTicket {
  id: string;
  order_ref: string;
  customer: string;
  platform: string;
  product_name: string;
  complaint: string;
  attribution: string | null;
  confidence: number;
  suggestion: string | null;
  reply_draft: string;
  refund_amount: number | null;
  status: string;
  created_at: string | null;
  approved_at: string | null;
  reject_reason: string | null;
  reject_feedback: string | null;
}

export function backendTicketToProto(row: BackendTicket): AfterSalesTicket {
  return {
    id: row.id,
    orderId: row.order_ref,
    customer: row.customer,
    platformId: row.platform,
    productName: row.product_name,
    complaint: row.complaint,
    attribution: row.attribution as AfterSalesTicket["attribution"],
    confidence: row.confidence,
    suggestion: row.suggestion as AfterSalesTicket["suggestion"],
    replyDraft: row.reply_draft,
    refundAmount: row.refund_amount ?? undefined,
    status: ticketStatus(row.status) as TicketStatus,
    createdAt: fmtTime(row.created_at),
    approvedAt: fmtTime(row.approved_at) || undefined,
    rejectReason: row.reject_reason ?? undefined,
    rejectFeedback: row.reject_feedback ?? undefined,
  };
}
