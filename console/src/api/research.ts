/** 选品调研 REST 封装与纯函数（真实数据版）。 */

import { api } from "./client";

export type ResearchStatus = "running" | "succeeded" | "partial" | "failed";
export type StepKind = "plan" | "fetch" | "cross" | "synthesize" | "agent";

export interface ResearchRun {
  id: string;
  category: string;
  boards: string[];
  status: ResearchStatus;
  mode: string;
  signal_count: number | null;
  error: string | null;
  narrative: string | null;
  created_at: string | null;
  started_at: string | null;
  finished_at: string | null;
}

export interface ResearchStep {
  id: string;
  seq: number;
  kind: StepKind;
  source_id: string | null;
  args_digest: string;
  summary: string | null;
  status: "ok" | "failed" | "skipped";
  seconds: number | null;
  error: string | null;
}

export interface Evidence {
  source_id: string;
  metric: string;
  value: number;
  url: string;
  captured_at: string;
}

export interface ResearchCandidateRow {
  id: string;
  run_id?: string;
  rank: number;
  name: string;
  platform: string;
  board: string;
  price: string;
  sales_signal: string;
  heat: number;
  keywords: string[];
  score: number;
  score_basis: Record<string, unknown>;
  evidence: Evidence[];
}

export interface ResearchDetail {
  run: ResearchRun;
  steps: ResearchStep[];
  candidates: ResearchCandidateRow[];
}

export interface SourceHealthRow {
  id: string;
  name: string;
  board: string;
  tier: string;
  health: string;
  ttl_seconds: number;
  capabilities: Record<string, unknown>;
}

export const METRIC_LABEL: Record<string, string> = {
  heat: "热度",
  trend: "趋势",
  rank: "排名",
  sales_proxy: "销量代理",
  price_band: "价格带",
};

export const STEP_KIND_LABEL: Record<StepKind, string> = {
  plan: "规划",
  fetch: "取数",
  cross: "交叉验证",
  synthesize: "成文",
  agent: "叙述",
};

export function startResearch(category: string) {
  return api.post<{ run_id: string; status: ResearchStatus; cached: boolean }>("/api/research", {
    category,
  });
}

export function fetchRunDetail(runId: string) {
  return api.get<ResearchDetail>(`/api/research/runs/${runId}`);
}

export async function fetchSourceHealth(): Promise<SourceHealthRow[]> {
  const r = await api.get<{ sources: SourceHealthRow[] }>("/api/research/sources");
  return r.sources;
}

export async function fetchRuns(limit = 5): Promise<ResearchRun[]> {
  const r = await api.get<{ runs: ResearchRun[] }>("/api/research/runs");
  return r.runs.slice(0, limit);
}

/** 价格带字符串取最低价（币种无关）：¥29-59→29、$12.99→12.99、""→0。 */
export function parsePriceMin(s: string): number {
  const m = /-?\d+(?:\.\d+)?/.exec(s ?? "");
  return m ? Number(m[0]) : 0;
}

export function nextPollStatus(run: Pick<ResearchRun, "status">): "pending" | "done" {
  return run && run.status !== "running" ? "done" : "pending";
}

/** 候选 → 收藏形状；source 带 run_id 前缀便于溯源。 */
export function candidateToFavorite(c: ResearchCandidateRow): {
  name: string;
  source: string;
  heat: number;
  price: number;
} {
  const runTag = (c.run_id ?? c.id).replace(/^rsr[_-]?/, "").slice(0, 6);
  return {
    name: c.name,
    source: `rsr ${runTag} · ${c.platform}`,
    heat: c.heat,
    price: parsePriceMin(c.price),
  };
}

export function stepIconFor(status: ResearchStep["status"]): "done" | "failed" | "skipped" {
  if (status === "ok") return "done";
  if (status === "failed") return "failed";
  return "skipped";
}
