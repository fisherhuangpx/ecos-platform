// /competitors 竞品情报（spec §6 的前端投影）：两段——监控对象（店铺/账号两类监听 + 频率开关）/ 信号流（时间倒序 + 选品挂接）。
// 合规红线贯穿全页：仅公开数据 + 速率限制 · 零写操作；「立即拉取」= 同步只读演示动作（pullSignals 从池放行 1 条），不触发任何平台写。
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowUpRight, Info, Pause, Play, Plus, Radar, RefreshCw, Store, User } from "lucide-react";
import { Badge, Button, Card, Field, Modal, PageHeader, Select, inputCls } from "../components/ui";
import { channelMeta, signalTone, type CompetitorSignal, type CompetitorWatch } from "../data/content";
import { platformMeta, type ResearchCandidate } from "../data/ecom";
import { useContent } from "../store/content";
import { useEcom } from "../store/ecom";

// 监听对象的平台展示元信息：店铺 → 电商平台（platformMeta）、账号 → 内容平台（channelMeta），色点两套同源取色
const watchMeta = (w: CompetitorWatch) => {
  const m = w.targetType === "店铺" ? platformMeta[w.platformId] : channelMeta[w.platformId];
  return { name: m?.name ?? w.platformId, color: m?.color ?? "#8fa3ad" };
};

export default function Competitors() {
  const { watches, signals, addWatch, toggleWatch, pullSignals } = useContent();
  const { products, favorites, toggleFavorite } = useEcom();
  const [pullNote, setPullNote] = useState("");

  // 新增监听 Modal（本地 state）：类型二选一 ⇒ 平台选项随之切换，默认值取各源首键（taobao / douyin）
  const [open, setOpen] = useState(false);
  const [targetType, setTargetType] = useState<CompetitorWatch["targetType"]>("店铺");
  const [platformId, setPlatformId] = useState("taobao");
  const [cadence, setCadence] = useState<CompetitorWatch["cadence"]>("每日");
  const [name, setName] = useState("");

  const platformOptions = useMemo(
    () => Object.entries(targetType === "店铺" ? platformMeta : channelMeta).map(([id, m]) => ({ id, label: `${m.name}（${id}）` })),
    [targetType],
  );
  const pickType = (t: CompetitorWatch["targetType"]) => {
    setTargetType(t);
    setPlatformId(Object.keys(t === "店铺" ? platformMeta : channelMeta)[0] ?? "taobao");
  };
  const platformLabel = platformOptions.find((o) => o.id === platformId)?.label ?? platformOptions[0]?.label ?? "";

  const watchNameOf = (id: string) => watches.find((w) => w.id === id)?.name ?? id;
  // 时间倒序：detectedAt 统一 "MM-DD HH:mm" 定长格式，字典序即时间序；sort 作用于副本，不动 store 数组
  const sortedSignals = useMemo(() => [...signals].sort((a, b) => b.detectedAt.localeCompare(a.detectedAt)), [signals]);

  // 「加入选品」：按 useEcom().toggleFavorite(c: ResearchCandidate) 的真实入参形状构造竞品同款候选（favorites 按 name 去重）
  const candidateFor = (s: CompetitorSignal): ResearchCandidate => {
    const prod = products.find((p) => p.id === s.matchedProduct);
    return {
      id: `cand-${s.id}`,
      name: prod?.name ?? "竞品同款商品",
      platform: prod ? platformMeta[prod.platformId]?.short ?? prod.platformId : "淘宝",
      monthlySales: "销量代理 3000+/月",
      price: prod ? String(prod.price) : "—",
      keywords: ["竞品同款", s.type],
      heat: 76,
    };
  };

  const handlePull = () => {
    const sig = pullSignals();
    setPullNote(sig ? `已放行 1 条新信号（${sig.type} · ${watchNameOf(sig.watchId)}）` : "信号池已空 · 今日批次已全部放行");
  };
  const openModal = () => {
    setTargetType("店铺"); setPlatformId("taobao"); setCadence("每日"); setName(""); setOpen(true);
  };
  const submit = () => {
    if (!name.trim()) return;
    addWatch(name.trim(), targetType, platformId, cadence); // store 行为：active=true 入列 + 系统级审计（仅公开数据口径由其 result 注明）
    setOpen(false);
  };

  return (
    <div>
      <PageHeader
        title="竞品情报"
        sub="监听公开页信号 · 改价/上新/销量代理/内容化动向 四类动向 → 挂接选品与上架"
        actions={<Button icon={<Plus size={15} />} onClick={openModal}>新增监听对象</Button>}
      />

      {/* 顶部提示条（brief 文案 verbatim）+ 立即拉取（pullSignals：从池放行 1 条，只读审计） */}
      <div className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-panel px-4 py-3">
        <span className="flex items-center gap-2 text-sm text-mute">
          <Radar size={14} className="text-neon" />
          信号每日 08:00 批量更新（演示：点击立即拉取）
        </span>
        <Button variant="outline" className="!h-8 text-xs" icon={<RefreshCw size={13} />} onClick={handlePull}>立即拉取</Button>
        {pullNote && <span className="text-xs text-neon">{pullNote}</span>}
      </div>

      {/* ── 段 1 · 监控对象：类型徽章 / 平台色点 / 抓取频率开关（toggleWatch）/ 上次信号数 ── */}
      <h3 className="mb-3 text-sm font-medium text-mute">监控对象 · {watches.length} 个</h3>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {watches.map((w, i) => {
          const meta = watchMeta(w);
          const n = signals.filter((s) => s.watchId === w.id).length;
          return (
            <motion.div key={w.id} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
              <Card hover className="flex h-full flex-col gap-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2.5">
                    {/* 平台色点（ring 描边：深色品牌色在暗卡上也可辨，与 /accounts 同款处理） */}
                    <span
                      aria-hidden
                      className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-white/25"
                      style={{ background: meta.color, boxShadow: `0 0 8px ${meta.color}` }}
                    />
                    <div className="min-w-0">
                      <div className="truncate font-semibold">{w.name}</div>
                      <div className="text-xs text-mute">{meta.name}</div>
                    </div>
                  </div>
                  <Badge tone={w.targetType === "店铺" ? "accent" : "mute"}>
                    {w.targetType === "店铺" ? <Store size={12} /> : <User size={12} />}
                    {w.targetType}
                  </Badge>
                </div>
                <div className="mt-auto flex items-center justify-between gap-2 border-t border-line pt-3">
                  <span className="text-xs text-mute">上次信号数 <span className="tnum font-semibold text-ink">{n}</span></span>
                  <button
                    type="button"
                    onClick={() => toggleWatch(w.id)}
                    aria-pressed={w.active}
                    className={`focus-ring inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                      w.active ? "border-neon/40 bg-neon/10 text-neon" : "border-line bg-white/5 text-mute hover:text-ink"
                    }`}
                  >
                    {w.active ? <Pause size={12} /> : <Play size={12} />}
                    {w.cadence} · {w.active ? "抓取中" : "已暂停"}
                  </button>
                </div>
              </Card>
            </motion.div>
          );
        })}
      </div>

      {/* ── 段 2 · 信号流：时间倒序 + signalTone 徽章 + 命中商品挂接（链接 /publish + 加入选品） ── */}
      <Card className="mt-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">信号流</h3>
          <span className="text-xs text-mute">时间倒序 · 只读分析 · 命中商品可一键挂接到选品</span>
        </div>
        <ul className="space-y-3">
          {sortedSignals.map((s) => {
            const prod = s.matchedProduct ? products.find((p) => p.id === s.matchedProduct) : undefined;
            const cand = s.matchedProduct ? candidateFor(s) : null;
            return (
              <li key={s.id} className="rounded-2xl border border-line bg-panel px-4 py-3">
                <div className="flex flex-wrap items-center gap-2 text-xs text-mute">
                  <Badge tone={signalTone[s.type]}>{s.type}</Badge>
                  <span className="font-medium text-ink/80">{watchNameOf(s.watchId)}</span>
                  <span className="tnum ml-auto">{s.detectedAt}</span>
                </div>
                <p className="mt-2 text-sm text-ink">{s.detail}</p>
                {cand && (
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                    <Link
                      to="/publish?draft=dr-1"
                      className="focus-ring inline-flex items-center gap-1 font-medium text-neon hover:underline"
                    >
                      命中商品：{prod?.name ?? "三合一磁吸快充线"} <ArrowUpRight size={12} />
                    </Link>
                    <Button
                      variant="outline"
                      className="!h-7 text-xs"
                      icon={<Plus size={12} />}
                      onClick={() => toggleFavorite(cand)}
                    >
                      {favorites.some((f) => f.name === cand.name) ? "已加入选品" : "加入选品"}
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </Card>

      {/* 新增监听 Modal：类型二选一 ⇒ 平台 Select 选项切换（店铺→电商平台 / 账号→内容平台） */}
      <Modal open={open} onClose={() => setOpen(false)} title="新增监听对象">
        <div className="space-y-4">
          <Field label="目标类型">
            <div className="grid grid-cols-2 gap-2">
              {(["店铺", "账号"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => pickType(t)}
                  className={`focus-ring rounded-xl border px-3 py-2 text-sm transition-colors ${
                    targetType === t ? "border-neon/60 bg-neon/8 font-semibold text-neon" : "border-line bg-panel text-mute hover:border-neon/30 hover:text-ink"
                  }`}
                >
                  {t === "店铺" ? "店铺（电商平台）" : "账号（内容平台）"}
                </button>
              ))}
            </div>
          </Field>
          <Field label="平台">
            <Select
              value={platformLabel}
              options={platformOptions.map((o) => o.label)}
              onChange={(label) => {
                const hit = platformOptions.find((o) => o.label === label);
                if (hit) setPlatformId(hit.id);
              }}
            />
          </Field>
          <Field label="监听对象名称">
            <input
              className={inputCls}
              value={name}
              placeholder={targetType === "店铺" ? "如：线象旗舰店" : "如：线象数码测评"}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label="抓取频率">
            <Select value={cadence} options={["每日", "每周"]} onChange={(v) => setCadence(v === "每周" ? "每周" : "每日")} />
          </Field>
          <p className="flex items-start gap-2 rounded-2xl border border-line bg-panel px-3 py-2.5 text-xs text-mute">
            <Info size={14} className="mt-0.5 shrink-0 text-neon" />
            仅公开数据 + 速率限制 · 零写操作：只抓取商品/账号公开页，不下单、不互动、不越权。
          </p>
          <div className="flex justify-end gap-3">
            <Button variant="ghost" onClick={() => setOpen(false)}>取消</Button>
            <Button disabled={!name.trim()} onClick={submit}>开始监听</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
