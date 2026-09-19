// 内容域共享小组件（spec §4/§5 的前端投影）：渠道档位徽章 / 执行引擎徽章 / 洞察卡。
// 页面级复用件放这里，不内联进页面（/accounts /distribute /insights /editing /overview 共用同一口径）。
import { Link } from "react-router-dom";
import { ArrowUpRight, Lightbulb } from "lucide-react";
import { Badge, Card, Progress } from "../ui";
import { tierLabels, type ChannelTier, type ContentInsight, type EngineId } from "../../data/content";

// ── 渠道档位：A=API 直发 / B=发布包 / C=人工工单，色随主题 tone（tooltip 文案取 tierLabels） ──
const tierTone: Record<ChannelTier, "neon" | "warn" | "mute"> = { A: "neon", B: "warn", C: "mute" };

export function TierBadge({ tier }: { tier: ChannelTier }) {
  return (
    <span className="inline-flex cursor-help" title={tierLabels[tier]}>
      <Badge tone={tierTone[tier]}>{tier} 档</Badge>
    </span>
  );
}

// ── 执行引擎色：本模块自带全量 EngineId 覆盖（pages/Editing.tsx 的 providerColors 无 FFmpeg，不可复用）
// OpenMontage/OpenCut 沿用其既有橙/紫，FFmpeg 保底用天蓝以示"确定性兜底"而非降级告警。
const engineColors: Record<EngineId, string> = {
  OpenMontage: "#FF8C42",
  OpenCut: "#6C63FF",
  FFmpeg: "#38BDF8",
};

export function EngineBadge({ engine, fallback = false }: { engine: EngineId; fallback?: boolean }) {
  const color = engineColors[engine];
  return (
    <Badge tone="mute">
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ background: color, boxShadow: `0 0 8px ${color}` }}
      />
      <span className="text-ink/80">{engine}</span>
      {fallback && (
        <span className="rounded-full border border-warn/30 bg-warn/10 px-1.5 text-[10px] font-semibold text-warn">
          保底
        </span>
      )}
    </Badge>
  );
}

// ── 洞察卡：结论 / 置信条 / 依据 / 建议 + 跳转（Insight 对象结构 = spec §3 总原则） ──
const insightTone: Record<ContentInsight["kind"], "neon" | "accent" | "warn" | "mute"> = {
  归因: "accent", 爆款拆解: "neon", 时段推荐: "neon", 异动: "warn",
};

export function InsightCard({ insight, onOpen }: { insight: ContentInsight; onOpen?: (i: ContentInsight) => void }) {
  const confidenceTone: "neon" | "accent" | "warn" =
    insight.confidence >= 80 ? "neon" : insight.confidence >= 60 ? "accent" : "warn";
  return (
    <Card hover className="flex flex-col">
      <div className="flex items-center justify-between gap-2">
        <Badge tone={insightTone[insight.kind]}>{insight.kind}</Badge>
        <span className="tnum text-[11px] text-mute">{insight.createdAt}</span>
      </div>

      <p className="mt-3 text-[15px] font-semibold leading-snug text-ink">{insight.conclusion}</p>

      <div className="mt-3">
        <Progress value={insight.confidence} tone={confidenceTone} label="置信度" />
      </div>

      <ul className="mt-3 mb-4 space-y-1">
        {insight.evidence.map((e, i) => (
          <li key={`${i}-${e}`} className="flex items-start gap-2 text-xs text-mute">
            <span aria-hidden className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-mute/70" />
            {e}
          </li>
        ))}
      </ul>

      {/* mt-auto：列表长短不一时把页脚压到卡底，并排 InsightCard 的底部分割线对齐
          （原 mt-4 与 mt-auto 同为 margin-top，故改为把该间距移到列表的 mb-4） */}
      <div className="mt-auto flex items-end justify-between gap-3 border-t border-line pt-3">
        <p className="flex min-w-0 items-start gap-1.5 text-xs text-ink/80">
          <Lightbulb size={14} className="mt-0.5 shrink-0 text-neon" />
          <span>建议：{insight.action}</span>
        </p>
        <div className="flex shrink-0 items-center gap-1">
          {onOpen && (
            <button
              type="button"
              onClick={() => onOpen(insight)}
              className="focus-ring rounded-lg px-1.5 py-1 text-xs text-mute transition-colors hover:bg-white/5 hover:text-ink"
            >
              展开
            </button>
          )}
          <Link
            to={insight.deepLink}
            className="focus-ring inline-flex items-center gap-1 rounded-lg px-1.5 py-1 text-xs text-neon hover:underline"
          >
            详情 <ArrowUpRight size={13} />
          </Link>
        </div>
      </div>
    </Card>
  );
}
