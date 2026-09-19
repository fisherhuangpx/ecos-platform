// /insights 内容洞察（spec §3「算数与说话分离」总原则的前端投影）：每条结论 = 依据快照 + 置信度 + 可执行动作。
// 四段：四维归因（算数视图）→ 爆款拆解（decomposeViral 入洞察池，种子+新产出同列表）→ 受众热力/粉丝增长回流 → 数据不完整显式标注。
// 数据全部走 useContent()（insights/hotspots/posts/decomposeViral/pullMetrics），本页本地 state 仅输入框与拉取回显，不碰 seed。
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AlertCircle, ArrowRight, ArrowUpRight, RefreshCw, Scissors, Sparkles } from "lucide-react";
import { Badge, Button, Card, PageHeader, inputCls } from "../components/ui";
import { InsightCard, TierBadge } from "../components/content/kit";
import { SlotHeatmap } from "../components/content/Heatmap";
import { AreaChart, HBars } from "../components/charts";
import { analyticsSeries } from "../data/ecom";
import { useContent } from "../store/content";

// ── 四维归因表：真实来源=指标层物化视图（原型演示用本任务内联常量，口径为近 14 天实测组合样本） ──
interface AttributionRow {
  topic: string; hook: string; format: string; slot: string; // 四维：选题方向 / 钩子类型 / 形式 / 发布时段
  completion: number; ctr: number;                            // 两指标：完播率% / CTR%
}
const attributionRows: AttributionRow[] = [
  { topic: "3C实测", hook: "卖点直给", format: "15s", slot: "19–21点", completion: 41, ctr: 3.8 },
  { topic: "新品首发", hook: "悬念提问", format: "20s", slot: "19–21点", completion: 37, ctr: 3.1 },
  { topic: "桌面美学", hook: "场景引入", format: "30s", slot: "12–14点", completion: 31, ctr: 2.6 },
  { topic: "优惠清单", hook: "价格锚定", format: "15s", slot: "21–23点", completion: 28, ctr: 2.2 },
  { topic: "剧情段子", hook: "情绪共鸣", format: "45s", slot: "17–19点", completion: 22, ctr: 1.3 },
];

// 「最优」由算数裁定（完播率最高者得霓虹描边），不写死行号——说话（建议追加投放）只跟随结论
const bestRow = attributionRows.reduce<AttributionRow | undefined>(
  (best, r) => (!best || r.completion > best.completion ? r : best),
  undefined,
);
const cellCls = (on: boolean) => `py-2.5 pr-3 ${on ? "border-y border-neon/45 bg-neon/6" : "border-b border-line"}`;

export default function Insights() {
  const { insights, hotspots, posts, decomposeViral, pullMetrics } = useContent();
  const navigate = useNavigate();

  const [url, setUrl] = useState("");
  const [pullNote, setPullNote] = useState("");

  const decompose = () => {
    const v = url.trim(); // 空/纯空白输入由 disabled 挡下，此处再兜一层防 Enter 连击
    if (!v) return;
    decomposeViral(v); // store 行为：产 kind=爆款拆解 Insight，置顶入 insights 池（只读分析，零平台写操作）
    setUrl("");
  };

  // 数据不完整 = 从 posts 动态过滤（待人工 ⇒ C 档待回填，seed 里 po-2 自然落入；演示中新增人工单同样入列，勿写死）
  const incomplete = posts.filter((p) => p.status === "待人工");

  const handlePull = () => {
    const fired = pullMetrics(); // 为已发布工单补当日回流点（当日幂等），返回命中二创规则数
    setPullNote(fired > 0 ? `已拉取回流 · ${fired} 条命中二创规则 → 到 /editing 查看生成入口` : "已拉取回流 · 当日点已补齐，规则命中 0 条");
  };

  return (
    <div>
      <PageHeader title="内容洞察" sub="算数与说话分离 · 每条结论带指标快照依据与置信度" />

      {/* ── 段 1 · 四维归因卡 ── */}
      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">四维归因 · 选题 × 钩子 × 形式 × 时段</h3>
          <span className="text-xs text-mute">最优组合由完播率裁定 · 样本真实来源 = 指标层物化视图</span>
        </div>
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_260px]">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="text-left text-xs text-mute">
                  <th className="pb-2 pl-3 font-medium">选题方向</th>
                  <th className="pb-2 pr-3 font-medium">钩子类型</th>
                  <th className="pb-2 pr-3 font-medium">形式</th>
                  <th className="pb-2 pr-3 font-medium">发布时段</th>
                  <th className="pb-2 pr-3 text-right font-medium">完播</th>
                  <th className="pb-2 pr-3 text-right font-medium">CTR</th>
                  <th className="pb-2 pr-3" aria-hidden />
                </tr>
              </thead>
              <tbody>
                {attributionRows.map((r) => {
                  const on = r === bestRow;
                  return (
                    <tr key={`${r.topic}-${r.hook}-${r.slot}`}>
                      <td className={`${cellCls(on)} rounded-l-lg pl-3 ${on ? "border-l border-neon/45" : ""}`}>
                        <span className="inline-flex flex-wrap items-center gap-2">
                          {r.topic}
                          {on && <Badge tone="neon">最优</Badge>}
                        </span>
                      </td>
                      <td className={cellCls(on)}>{r.hook}</td>
                      <td className={`tnum ${cellCls(on)}`}>{r.format}</td>
                      <td className={`tnum ${cellCls(on)}`}>{r.slot}</td>
                      <td className={`tnum text-right ${on ? "font-semibold text-neon" : ""} ${cellCls(on)}`}>{r.completion}%</td>
                      <td className={`tnum text-right ${on ? "font-semibold text-neon" : ""} ${cellCls(on)}`}>{r.ctr}%</td>
                      <td className={`${cellCls(on)} ${on ? "border-r border-neon/45" : ""}`}>
                        {on && (
                          <Link
                            to="/distribute"
                            className="focus-ring inline-flex items-center gap-1 whitespace-nowrap text-xs font-semibold text-neon hover:underline"
                          >
                            建议追加投放 <ArrowRight size={13} />
                          </Link>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div>
            <div className="mb-3 text-xs font-medium text-mute">组合完播率对比（算数侧）</div>
            <HBars
              items={attributionRows.map((r) => ({
                name: `${r.topic}×${r.hook}`,
                v: r.completion,
                color: r === bestRow ? "#00FF99" : "#8FA3AD",
              }))}
            />
          </div>
        </div>
      </Card>

      {/* ── 段 2 · 爆款拆解：输入 → decomposeViral → 洞察池（种子 + 拆解产出同列表） ── */}
      <Card className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">爆款拆解</h3>
          <span className="text-xs text-mute">只读分析 · 零平台写操作 · 产出的洞察置顶进入下方列表</span>
        </div>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <input
            className={inputCls}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") decompose();
            }}
            placeholder="粘贴一条爆款视频链接"
            aria-label="粘贴一条爆款视频链接"
          />
          <Button icon={<Sparkles size={15} />} disabled={!url.trim()} onClick={decompose}>
            开始拆解
          </Button>
        </div>
        <p className="mt-2 text-[11px] text-mute">
          拆解结论沿用 Insight 结构：钩子 / 分镜结构 / 可复用模板判断，均附来源链接作为依据。
        </p>

        <div className="mt-5 grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
          {insights.map((ins) => (
            <div key={ins.id} className="flex flex-col gap-2">
              {/* InsightCard 页脚自带 deepLink「详情」跳转（爆款拆解 → /editing）；卡片动作槽（onOpen）文案固定为「展开」，
                  故「用作剪辑模板」按 brief 参数契约以卡下动作按钮呈现，不 fork 组件 */}
              <InsightCard insight={ins} />
              {ins.kind === "爆款拆解" && (
                <Button
                  variant="outline"
                  className="!h-8 self-end text-xs"
                  icon={<Scissors size={13} />}
                  onClick={() => navigate("/editing?template=viral")}
                >
                  用作剪辑模板
                </Button>
              )}
            </div>
          ))}
        </div>
      </Card>

      {/* ── 段 3 · 受众与回流：左活跃时段热力（与 /distribute 同源 hotspots）+ 右矩阵粉丝增长 ── */}
      <div className="mt-6 grid gap-4 xl:grid-cols-2">
        <Card>
          <h3 className="font-semibold">受众活跃热力图</h3>
          <p className="mb-4 mt-1 text-xs text-mute">行=周一~周日 · 列=9~23 点每 2h · 与分发中枢「建议发布时段」同源数据</p>
          <SlotHeatmap grid={hotspots} />
        </Card>
        <Card>
          <h3 className="font-semibold">账号矩阵粉丝增长</h3>
          <p className="mb-4 mt-1 text-xs text-mute">近 14 个快照周期 · 矩阵四号合计净增趋势 · 数据源为回流指标快照层</p>
          <AreaChart data={analyticsSeries} height={150} />
          <div className="mt-3 flex items-center justify-between text-xs text-mute">
            <span>周期起点 {analyticsSeries[0]}</span>
            <span className="tnum text-neon">最新 {analyticsSeries[analyticsSeries.length - 1]}</span>
          </div>
        </Card>
      </div>

      {/* ── 段 4 · 数据不完整提示卡：动态过滤 posts，不写死日期与工单 id ── */}
      <Card className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 font-semibold">
            <AlertCircle size={16} className="text-warn" /> 数据不完整
          </h3>
          <Badge tone="warn">{incomplete.length} 单待人工回填</Badge>
        </div>
        <p className="mt-2 text-sm text-mute">
          人工回填滞后 → 分析显式标注，不静默：下列工单走人工通道已发出但链接未回填，无回流指标，归因与增长样本均不含它们。
        </p>
        {incomplete.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-line px-3 py-4 text-center text-xs text-mute">
            当前没有待回填工单 · 人工通道均已闭环，分析样本完整
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {incomplete.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-panel px-3 py-2 text-sm">
                <span className="tnum text-xs text-mute">{p.id}</span>
                <span className="font-medium">{p.title}</span>
                <TierBadge tier={p.tier} />
                <span className="text-xs text-mute">建于 {p.createdAt} · 待回填链接 · 暂无回流指标</span>
                <Link
                  to="/distribute"
                  className="focus-ring ml-auto inline-flex items-center gap-1 text-xs text-neon hover:underline"
                >
                  去回填 <ArrowUpRight size={12} />
                </Link>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-3">
          <Button variant="outline" className="!h-8 text-xs" icon={<RefreshCw size={13} />} onClick={handlePull}>
            拉取回流指标
          </Button>
          <span className="text-xs text-mute">
            {pullNote || "连接器回写：为已发布工单补当日点（当日幂等）；命中二创规则时提示去 /editing 生成"}
          </span>
        </div>
      </Card>
    </div>
  );
}
