import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Search, Star, RotateCcw, AlertCircle, Sparkles, Check, ExternalLink, ChevronDown } from "lucide-react";
import { Card, Badge, Button, Dot, PageHeader, Progress } from "../components/ui";
import type { ResearchCandidate } from "../data/ecom";
import { useEcom } from "../store/ecom";
import {
  METRIC_LABEL,
  STEP_KIND_LABEL,
  candidateToFavorite,
  fetchRunDetail,
  fetchSourceHealth,
  startResearch,
  nextPollStatus,
  type ResearchCandidateRow,
  type ResearchDetail,
  type SourceHealthRow,
} from "../api/research";

const quickCats = ["车载支架", "无线快充", "防晒冰袖", "桌面收纳"];

const fmtEvidenceValue = (metric: string, value: number) => {
  if (metric === "price_band") return `¥${value.toLocaleString("zh-CN")}`;
  if (metric === "rank") return `#${value}`;
  return value.toLocaleString("zh-CN");
};

export default function Research() {
  const { favorites, toggleFavorite } = useEcom();
  const [cat, setCat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<ResearchDetail | null>(null);
  const [sources, setSources] = useState<SourceHealthRow[]>([]);
  const [openEv, setOpenEv] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  const stopPoll = () => {
    if (pollRef.current) window.clearInterval(pollRef.current);
    pollRef.current = null;
  };
  useEffect(() => {
    fetchSourceHealth().then(setSources).catch(() => undefined);
    return stopPoll;
  }, []);

  const sourceName = (id: string | null) =>
    (id && sources.find((s) => s.id === id)?.name) || id || "数据源";

  const openRun = async (runId: string) => {
    stopPoll();
    const d = await fetchRunDetail(runId);
    setDetail(d);
    if (nextPollStatus(d.run) === "pending") {
      pollRef.current = window.setInterval(async () => {
        try {
          const dd = await fetchRunDetail(runId);
          setDetail(dd);
          if (nextPollStatus(dd.run) === "done") stopPoll();
        } catch {
          stopPoll();
        }
      }, 1500);
    }
  };

  const start = async (c: string) => {
    const category = c.trim();
    if (!category || busy) return;
    setBusy(true);
    setError(null);
    setDetail(null);
    setOpenEv(null);
    try {
      const r = await startResearch(category);
      await openRun(r.run_id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String((e as { detail?: string })?.detail ?? e));
    } finally {
      setBusy(false);
    }
  };

  const run = detail?.run ?? null;
  const running = busy || run?.status === "running";
  const phase: "idle" | "running" | "done" = run ? (running ? "running" : "done") : busy ? "running" : "idle";
  const steps = detail?.steps ?? [];
  const fetchSteps = steps.filter((s) => s.kind === "fetch");
  const failedFetch = fetchSteps.filter((s) => s.status === "failed");
  const candidates = detail?.candidates ?? [];
  const okSources = sources.filter((s) => s.health === "online" || s.health === "configured").length;
  const awaitingSources = sources.filter((s) => s.health === "awaiting_credentials").length;
  const disabledSources = sources.filter((s) => s.health === "disabled").length;

  const fav = (c: ResearchCandidateRow) => favorites.some((f) => f.name === c.name);
  const toggleFav = (c: ResearchCandidateRow) => {
    if (!run) return;
    const f = candidateToFavorite({ ...c, run_id: run.id });
    toggleFavorite({
      id: c.id, name: f.name, platform: f.source, heat: f.heat,
      price: String(f.price), monthlySales: c.sales_signal, keywords: c.keywords,
    } as ResearchCandidate);
  };

  return (
    <div>
      <PageHeader
        title="选品调研"
        sub="输入品类后由多数据源真实取数：公开榜单/指数逐源抓取，规则层交叉打分，数字全部可溯源到出处"
        actions={favorites.length > 0 ? <Link to="/studio"><Button icon={<Sparkles size={15} />}>用选品清单做主图（{favorites.length}）</Button></Link> : undefined}
      />

      <Card>
        <div className="flex flex-wrap gap-2">
          {quickCats.map((c) => (
            <button key={c} onClick={() => { setCat(c); }} className={`focus-ring rounded-full border px-3 py-1.5 text-sm transition-colors ${cat === c ? "border-neon/60 bg-neon/10 text-neon" : "border-line text-mute hover:text-ink"}`}>
              {c}
            </button>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <input
            value={cat}
            onChange={(e) => setCat(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && start(cat)}
            placeholder="输入想调研的品类，如：露营灯"
            className="focus-ring min-w-0 flex-1 rounded-2xl border border-line bg-panel px-4 py-3 text-sm placeholder:text-mute/60"
          />
          <Button onClick={() => start(cat)} disabled={running || !cat.trim()} icon={running ? <Dot tone="neon" pulse /> : <Search size={15} />}>
            {running ? "调研中…" : "开始调研"}
          </Button>
        </div>
        {sources.length > 0 && (
          <div
            className="mt-3 text-xs text-mute"
            title={sources.map((s) => `${s.name}（${s.tier} / ${s.health}）`).join("；")}
          >
            数据源健康：当前 {okSources} 个可靠源在线
            {awaitingSources > 0 && ` · ${awaitingSources} 个待授权`}
            {disabledSources > 0 && ` · ${disabledSources} 个已拉闸`}
          </div>
        )}
        <p className="mt-3 text-xs text-mute">数据源为公开榜单 / 指数，重复调研命中新鲜快照时秒回缓存；需授权的官方 / 第三方源在连接器页配置凭据后启用。</p>
        {error && <p className="mt-3 text-xs text-warn">调研请求失败：{error}</p>}
      </Card>

      {phase === "running" && (
        <Card className="mt-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-semibold">AI 正在调研「{run?.category ?? cat}」</h3>
            <Badge tone="neon">运行中</Badge>
          </div>
          <ol className="space-y-2.5">
            {steps.map((s) => (
              <li key={s.id} className={`flex items-center gap-3 text-sm ${s.status === "failed" ? "text-warn" : "text-ink"}`}>
                <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] ${s.status === "ok" ? "bg-neon text-[#04110b]" : s.status === "failed" ? "border border-warn/60 text-warn" : "border border-line text-mute"}`}>
                  {s.status === "ok" ? <Check size={12} /> : s.status === "failed" ? <AlertCircle size={12} /> : s.seq}
                </span>
                <span className="min-w-0 truncate">
                  {STEP_KIND_LABEL[s.kind]}
                  {s.kind === "fetch" && ` · ${sourceName(s.source_id)}`}
                  {s.seconds != null && `（${s.seconds.toFixed(1)}s）`}
                  {s.error && <span className="ml-2 text-xs text-mute">{s.error}</span>}
                  {!s.error && s.summary && s.kind !== "fetch" && <span className="ml-2 text-xs text-mute">{s.summary}</span>}
                </span>
              </li>
            ))}
            {running && (
              <li className="flex items-center gap-3 text-sm text-mute">
                <span className="flex h-5 w-5 items-center justify-center rounded-full border border-neon/60"><Dot tone="neon" pulse /></span>
                执行中…
              </li>
            )}
          </ol>
          <div className="mt-4">
            <Progress value={running ? Math.round((steps.filter((s) => s.status === "ok").length / Math.max(steps.length + 1, 1)) * 100) : 100} label="整体进度" />
          </div>
        </Card>
      )}

      {phase === "done" && run && (
        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="mt-4 space-y-4">
          {run.status === "failed" && (
            <Card className="border-warn/30">
              <div className="flex flex-wrap items-center gap-3">
                <AlertCircle size={18} className="text-warn" />
                <div className="min-w-0 flex-1 text-sm">
                  <span className="font-medium text-warn">本次调研失败：</span>
                  <span className="text-mute">{run.error || "所有数据源均未取到信号，报告无法生成。"}</span>
                </div>
                <Button variant="outline" icon={<RotateCcw size={14} />} onClick={() => start(run.category)} disabled={busy}>
                  {busy ? "重跑中…" : "重跑"}
                </Button>
              </div>
            </Card>
          )}
          {run.status === "partial" && failedFetch.length > 0 && (
            <Card className="border-warn/30">
              <div className="flex flex-wrap items-center gap-3">
                <AlertCircle size={18} className="text-warn" />
                <div className="min-w-0 flex-1 text-sm">
                  <span className="font-medium text-warn">部分数据缺失：</span>
                  <span className="text-mute">
                    {failedFetch.map((s) => `${sourceName(s.source_id)} 抓取失败（${(s.error ?? "unknown").split(":")[0]}）`).join("；")}，
                    本报告信号覆盖 {fetchSteps.length - failedFetch.length}/{fetchSteps.length}，其余部分已完成。
                  </span>
                </div>
                <Button variant="outline" icon={busy ? <Dot tone="neon" pulse /> : <RotateCcw size={14} />} onClick={() => start(run.category)} disabled={busy}>
                  {busy ? "重试中…" : "重跑"}
                </Button>
              </div>
            </Card>
          )}

          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">「{run.category}」候选品对比报告</h3>
            <div className="flex items-center gap-2">
              <Badge tone="accent">{candidates.length} 款候选</Badge>
              <Badge tone="neon">{run.signal_count ?? 0} 信号</Badge>
            </div>
          </div>

          {run.narrative && (
            <Card className="border-accent/30">
              <div className="mb-1 text-xs font-medium text-accent">分析师叙述</div>
              <blockquote className="text-sm leading-relaxed text-ink/90">{run.narrative}</blockquote>
            </Card>
          )}

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {candidates.map((c, i) => (
              <motion.div key={c.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
                <Card hover className="flex h-full flex-col gap-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-semibold leading-snug">#{c.rank} {c.name}</div>
                      <div className="mt-1 text-xs text-mute">{c.platform} · {c.price || "价格带未知"}</div>
                    </div>
                    <button
                      onClick={() => toggleFav(c)}
                      aria-label="收藏"
                      className={`focus-ring rounded-lg p-1 transition-colors ${fav(c) ? "text-warn" : "text-mute hover:text-ink"}`}
                    >
                      <Star size={16} fill={fav(c) ? "currentColor" : "none"} />
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <Badge tone="neon">{c.sales_signal || `综合分 ${c.score}`}</Badge>
                    <div className="flex items-center gap-1 text-mute">
                      <span className="font-medium" style={{ color: c.heat >= 80 ? "#ff8c42" : c.heat >= 65 ? "#00ff99" : "#8fa3ad" }}>热度 {c.heat}</span>
                      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-white/8">
                        <div className="h-full rounded-full" style={{ width: `${c.heat}%`, background: c.heat >= 80 ? "#ff8c42" : c.heat >= 65 ? "#00ff99" : "#8fa3ad" }} />
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {c.keywords.map((k) => <span key={k} className="rounded-md bg-white/6 px-2 py-0.5 text-[11px] text-mute">{k}</span>)}
                  </div>
                  <div>
                    <button
                      onClick={() => setOpenEv(openEv === c.id ? null : c.id)}
                      className="focus-ring flex items-center gap-1 text-xs text-accent"
                    >
                      依据 {c.evidence.length} 条信号
                      <ChevronDown size={12} className={`transition-transform ${openEv === c.id ? "rotate-180" : ""}`} />
                    </button>
                    {openEv === c.id && (
                      <ul className="mt-2 space-y-1.5 rounded-xl border border-line bg-white/4 p-2.5">
                        {c.evidence.map((ev, j) => (
                          <li key={j} className="flex items-center justify-between gap-2 text-[11px] text-mute">
                            <span className="min-w-0 truncate">
                              {sourceName(ev.source_id)} · {METRIC_LABEL[ev.metric] ?? ev.metric}
                              <span className="ml-1 text-ink">{fmtEvidenceValue(ev.metric, ev.value)}</span>
                            </span>
                            <a href={ev.url} target="_blank" rel="noreferrer" className="flex shrink-0 items-center gap-0.5 text-accent hover:underline">
                              出处 <ExternalLink size={10} />
                            </a>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="mt-auto flex items-center gap-2 text-xs text-mute">
                    <Dot tone={fav(c) ? "warn" : "mute"} />
                    {fav(c) ? "已加入选品清单" : "点星标加入选品清单"}
                  </div>
                </Card>
              </motion.div>
            ))}
          </div>

          {favorites.length > 0 && (
            <Card className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm">
                <span className="font-semibold">选品清单（{favorites.length}）</span>
                <span className="ml-2 text-mute">{favorites.map((f) => f.name).join(" · ")}</span>
              </div>
              <Link to="/studio"><Button icon={<Sparkles size={15} />}>下一步：生成主图</Button></Link>
            </Card>
          )}
        </motion.div>
      )}

      {phase === "idle" && !detail && (
        <Card className="mt-4 flex flex-col items-center py-12 text-center">
          <Search size={34} className="mb-3 text-mute" />
          <h3 className="font-semibold">从品类开始，得到可溯源的候选品对比</h3>
          <p className="mt-1 max-w-md text-sm text-mute">例如输入「车载支架」，系统会并发抓取公开榜单 / 指数数据源，交叉验证后产出带证据链接的候选品卡片墙。</p>
        </Card>
      )}
    </div>
  );
}
