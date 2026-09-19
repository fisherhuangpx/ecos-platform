import { useState } from "react";
import { motion } from "framer-motion";
import { TrendingUp, TrendingDown, Minus, Lightbulb, ChevronDown, Mail } from "lucide-react";
import { Card, Badge, Button, Dot, PageHeader, Select, Stat } from "../components/ui";
import { AreaChart, HBars } from "../components/charts";
import { analyticsSeries, platformMeta, type Product } from "../data/ecom";
import { useEcom } from "../store/ecom";

const ranges = ["近 7 天", "近 30 天", "本周"];

const trendMeta: Record<Product["trend"], { label: string; color: string; icon: typeof TrendingUp }> = {
  up: { label: "增长", color: "#00ff99", icon: TrendingUp },
  down: { label: "下滑", color: "#ff8c42", icon: TrendingDown },
  flat: { label: "平稳", color: "#8fa3ad", icon: Minus },
};

export default function Analytics() {
  const { stores, products } = useEcom();
  const connected = stores.filter((s) => s.status === "connected");
  const [storeId, setStoreId] = useState(connected[0]?.id ?? "");
  const [range, setRange] = useState("近 7 天");
  const [selected, setSelected] = useState<Product | null>(null);
  const [subscribed, setSubscribed] = useState(false);

  const store = stores.find((s) => s.id === storeId);
  const list = products.slice(0, 5);

  return (
    <div>
      <PageHeader
        title="经营分析"
        sub="先给一句人话解读，再下钻看数据；建议都标明依据，不让你盲信"
        actions={
          <Button variant={subscribed ? "ghost" : "outline"} icon={<Mail size={14} />} onClick={() => setSubscribed((v) => !v)}>
            {subscribed ? "已订阅周报 ✓" : "订阅每周经营周报"}
          </Button>
        }
      />

      <div className="grid gap-4 md:grid-cols-[280px_1fr]">
        <Card className="space-y-4">
          <div>
            <div className="mb-1.5 text-xs font-medium text-mute">店铺</div>
            <select
              value={storeId}
              onChange={(e) => setStoreId(e.target.value)}
              className="focus-ring w-full rounded-xl border border-line bg-panel px-3 py-2.5 text-sm"
            >
              {connected.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <div className="mb-1.5 text-xs font-medium text-mute">时间范围</div>
            <Select value={range} options={ranges} onChange={setRange} />
          </div>
          {store && (
            <div className="rounded-2xl border border-line bg-panel p-3 text-xs text-mute">
              <div className="mb-1 flex items-center gap-1.5"><Dot tone="neon" pulse /> 数据实时连通中</div>
              授权范围：{platformMeta[store.platformId]?.scope.join(" / ")}
            </div>
          )}
        </Card>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            {[
              { label: "近 7 日 GMV", value: "¥86.4k", delta: "↑ 12% 环比", tone: "neon" as const },
              { label: "订单量", value: store ? store.orders7d.toLocaleString() : "—", delta: "↑ 8% 环比", tone: "neon" as const },
              { label: "平均转化", value: "3.9%", delta: "Top 款 6.1%", tone: "accent" as const },
              { label: "退款率", value: "2.4%", delta: "差评集中在 2 款", tone: "warn" as const },
            ].map((s) => <Stat key={s.label} {...s} />)}
          </div>

          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold">AI 经营解读 · {range}</h3>
              <Badge tone="neon">自动生成</Badge>
            </div>
            <div className="rounded-2xl border border-accent/20 bg-accent/5 p-4 text-sm leading-relaxed">
              <div className="mb-2 flex items-center gap-2 text-[#b7b1ff]"><Lightbulb size={15} /> 结论</div>
              本周主力增长来自 <span className="font-semibold text-ink">快充数据线</span>（销量 ↑26%，搜索流量带动明显）；<span className="font-semibold text-ink">防晒冰袖</span> 转化在掉，疑似评价区集中出现「尺码偏小」；<span className="font-semibold text-ink">车载手机支架</span> 评价出现「夹子晃动」，建议先处理口碑再投放。
              <div className="mt-3 flex items-center gap-2 text-xs text-mute"><span className="text-neon">依据</span> 基于 7 日销量环比 + 评价关键词聚类 + 流量来源拆分</div>
            </div>
            <div className="mt-4">
              <div className="mb-2 text-xs font-medium text-mute">近 14 日销售趋势（{range} 视图）</div>
              <AreaChart data={analyticsSeries} color="#00FF99" height={110} />
            </div>
          </Card>

          <Card>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold">SKU 表现（可下钻）</h3>
              <span className="text-xs text-mute">点击行查看建议与依据</span>
            </div>
            <div className="divide-y divide-line">
              {list.map((p) => {
                const t = trendMeta[p.trend];
                const Icon = t.icon;
                return (
                  <button key={p.id} onClick={() => setSelected(p)} className="focus-ring flex w-full items-center gap-3 rounded-lg px-1 py-3 text-left hover:bg-white/[0.03]">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{p.name}</div>
                      <div className="text-xs text-mute">{p.category} · {platformMeta[p.platformId]?.short ?? p.platformId} · ¥{p.price}</div>
                    </div>
                    <div className="hidden w-40 sm:block">
                      <div className="mb-1 text-[11px] text-mute">转化率 {p.conv}%</div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-white/8">
                        <div className="h-full rounded-full bg-gradient-to-r from-accent to-[#8f89ff]" style={{ width: `${Math.min(100, p.conv * 12)}%` }} />
                      </div>
                    </div>
                    <div className="flex w-24 items-center gap-1 text-sm" style={{ color: t.color }}>
                      <Icon size={14} /> {t.label}
                    </div>
                    <ChevronDown size={14} className="text-mute" />
                  </button>
                );
              })}
            </div>
          </Card>
        </div>
      </div>

      {selected && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mt-4">
          <Card className="border-accent/25">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="font-semibold">{selected.name}</h3>
                <p className="mt-1 text-xs text-mute">{selected.reviewNote}</p>
              </div>
              <button onClick={() => setSelected(null)} className="focus-ring rounded-lg p-1.5 text-mute hover:bg-white/5 hover:text-ink">✕</button>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <Card className="!p-4">
                <div className="text-xs text-mute">7 日销量</div>
                <div className="tnum mt-1 font-display text-2xl font-bold text-neon">{selected.sales7d}</div>
              </Card>
              <Card className="!p-4">
                <div className="text-xs text-mute">转化率</div>
                <div className="tnum mt-1 font-display text-2xl font-bold" style={{ color: "#b7b1ff" }}>{selected.conv}%</div>
              </Card>
              <Card className="!p-4">
                <div className="text-xs text-mute">建议</div>
                <div className="mt-1 text-sm text-ink">{selected.trend === "down" ? "先处理评价区高频问题再恢复投放" : "维持投放，考虑加购组合装提升客单"}</div>
              </Card>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-mute">
              <span className="font-medium text-ink">建议依据：</span>
              <HBars items={[{ name: "销量环比", v: selected.trend === "up" ? 82 : 40, color: "#00FF99" }, { name: "转化趋势", v: selected.conv * 14, color: "#6C63FF" }, { name: "评价负面率", v: selected.trend === "down" ? 68 : 22, color: "#FF8C42" }]} />
            </div>
          </Card>
        </motion.div>
      )}
    </div>
  );
}
