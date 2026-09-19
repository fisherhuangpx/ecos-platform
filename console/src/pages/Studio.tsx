import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Images, Sparkles, RefreshCw, Check, ArrowRight } from "lucide-react";
import { Card, Badge, Button, Dot, PageHeader, Progress, inputCls } from "../components/ui";
import { stylePresets, studioVariants, type StudioVariant } from "../data/ecom";
import { useEcom } from "../store/ecom";

const genSteps = ["套用品牌规范", "生成构图", "商品图渲染", "局部优化"];

export function MainImageMock({ title, variant, tagline, brand }: { title: string; variant: StudioVariant; tagline?: string; brand?: string }) {
  return (
    <div className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-2xl border border-white/10 p-4 text-center" style={{ background: variant.bg }}>
      <div>
        <div className="font-display text-lg font-bold leading-tight" style={{ color: variant.fg }}>{title.split(" ")[0]}</div>
        {tagline && <div className="mt-2 inline-block rounded-full px-3 py-1 text-xs font-semibold" style={{ background: variant.accent, color: "#04110b" }}>{tagline}</div>}
        {brand && <div className="mt-3 text-[10px] font-semibold tracking-widest opacity-70" style={{ color: variant.fg }}>{brand}</div>}
      </div>
    </div>
  );
}

export default function Studio() {
  const { favorites, products, assets, addDraft } = useEcom();
  const choices = [
    ...favorites.map((f) => ({ key: `fav-${f.name}`, title: f.name, price: parseFloat(f.price) || 39, source: f.source })),
    ...products.map((p) => ({ key: p.id, title: p.name, price: p.price, source: p.platformId })),
  ];
  const [pickKey, setPickKey] = useState(choices[0]?.key ?? "");
  const chosen = choices.find((c) => c.key === pickKey) ?? choices[0];
  const [styleId, setStyleId] = useState(stylePresets[0].id);
  const [selling, setSelling] = useState<string[]>(stylePresets[0].selling);
  const [brandAssetIds, setBrandAssetIds] = useState<string[]>([]);
  const [phase, setPhase] = useState<"idle" | "running" | "done">("idle");
  const [step, setStep] = useState(0);
  const [variants, setVariants] = useState<StudioVariant[]>([]);
  const [chosenVariant, setChosenVariant] = useState<StudioVariant | null>(null);
  const [repaint, setRepaint] = useState("");
  const [repainting, setRepainting] = useState(false);
  const [madeDraft, setMadeDraft] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current) window.clearInterval(timer.current); }, []);

  const brandLine = () => {
    const list = brandAssetIds.map((id) => assets.find((a) => a.id === id)).filter(Boolean);
    return list.length ? list.map((a) => a!.name.split("（")[0]).join(" · ") : undefined;
  };
  const brandColor = () => {
    const first = brandAssetIds.map((id) => assets.find((a) => a.id === id)).filter(Boolean)[0];
    return first?.color;
  };

  const startGen = () => {
    if (!chosen) return;
    setPhase("running");
    setStep(0);
    setMadeDraft(false);
    setVariants([]);
    let i = 0;
    timer.current = window.setInterval(() => {
      i += 1;
      if (i >= genSteps.length) {
        if (timer.current) window.clearInterval(timer.current);
        setVariants(studioVariants);
        setChosenVariant(studioVariants[0]);
        setPhase("done");
      } else {
        setStep(i);
      }
    }, 620);
  };

  const doRepaint = () => {
    if (!repaint.trim()) return;
    setRepainting(true);
    window.setTimeout(() => {
      setRepainting(false);
      setRepaint("");
      setChosenVariant((prev) => prev ?? studioVariants[0]);
    }, 1000);
  };

  const toDraft = () => {
    if (!chosen || !chosenVariant) return;
    const style = stylePresets.find((s) => s.id === styleId);
    addDraft({
      title: chosen.title,
      price: chosen.price,
      sellingPoints: selling,
      imageLabel: `${style?.label ?? "风格"} / ${chosenVariant.label}`,
      source: "主图工坊",
    });
    setMadeDraft(true);
  };

  const brandAssets = assets.filter((a) => a.type === "logo" || a.type === "swatch" || a.type === "main");

  return (
    <div>
      <PageHeader
        title="主图工坊"
        sub="选商品 → 套品牌素材 → AI 出 3 稿 → 圈选局部重绘 → 定稿直接转上架材料"
        actions={madeDraft ? <Link to="/publish"><Button icon={<ArrowRight size={15} />}>去上架</Button></Link> : undefined}
      />

      <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
        <div className="space-y-4">
          <Card className="space-y-3">
            <div>
              <div className="mb-1.5 text-xs font-medium text-mute">商品</div>
              <select value={pickKey} onChange={(e) => { setPickKey(e.target.value); setMadeDraft(false); }} className={inputCls}>
                {choices.map((c) => <option key={c.key} value={c.key}>{c.title}（¥{c.price}）</option>)}
              </select>
              {favorites.length > 0 && <div className="mt-1.5 text-[11px] text-mute">已带入 {favorites.length} 个选品清单候选</div>}
            </div>
            <div>
              <div className="mb-1.5 text-xs font-medium text-mute">风格 / 卖点</div>
              <div className="flex flex-wrap gap-1.5">
                {stylePresets.map((s) => (
                  <button key={s.id} onClick={() => { setStyleId(s.id); setSelling(s.selling); }} className={`focus-ring rounded-full border px-3 py-1 text-xs transition-colors ${styleId === s.id ? "border-neon/60 bg-neon/10 text-neon" : "border-line text-mute hover:text-ink"}`}>
                    {s.label}
                  </button>
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {selling.map((sp) => (
                  <button key={sp} onClick={() => setSelling((prev) => (prev.includes(sp) ? prev.filter((x) => x !== sp) : [...prev, sp]))} className={`focus-ring rounded-md border px-2 py-0.5 text-[11px] ${selling.includes(sp) ? "border-accent/50 bg-accent/10 text-[#b7b1ff]" : "border-line text-mute"}`}>
                    {selling.includes(sp) ? "✓ " : "+ "}{sp}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-1.5 text-xs font-medium text-mute">品牌资产引用（素材库）</div>
              {brandAssets.length === 0 ? (
                <p className="text-xs text-mute">还没有素材，去 <Link to="/assets" className="text-neon hover:underline">素材库</Link> 上传 logo / 色卡后会自动套用。</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {brandAssets.map((a) => {
                    const active = brandAssetIds.includes(a.id);
                    return (
                      <button key={a.id} onClick={() => setBrandAssetIds((prev) => (active ? prev.filter((x) => x !== a.id) : [...prev, a.id]))} title={a.name} className={`focus-ring flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] ${active ? "border-neon/60 bg-neon/10 text-neon" : "border-line text-mute"}`}>
                        <span className="inline-block h-3 w-3 rounded" style={{ background: a.color ?? "#8fa3ad" }} />
                        {a.name.length > 12 ? a.name.slice(0, 12) + "…" : a.name}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <Button className="w-full" disabled={phase === "running" || !chosen} icon={phase === "running" ? <Dot tone="neon" pulse /> : <Sparkles size={15} />} onClick={startGen}>
              {phase === "running" ? "生成中…" : "生成 3 张主图方案"}
            </Button>
          </Card>

          {phase === "running" && (
            <Card>
              <div className="mb-3 text-sm font-semibold">AI 生成中（分步可见）</div>
              <ol className="space-y-2">
                {genSteps.map((s, i) => (
                  <li key={s} className={`flex items-center gap-2 text-xs ${i <= step ? "text-ink" : "text-mute/60"}`}>
                    <span className={`flex h-4 w-4 items-center justify-center rounded-full ${i < step ? "bg-neon text-[#04110b]" : i === step ? "border border-neon/50" : "border border-line"}`}>{i < step ? <Check size={10} /> : ""}</span>
                    {s}
                  </li>
                ))}
              </ol>
              <div className="mt-3"><Progress value={Math.round((step / genSteps.length) * 100)} /></div>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          {phase !== "done" ? (
            <Card className="flex min-h-[320px] flex-col items-center justify-center py-12 text-center">
              <Images size={40} className="mb-3 text-mute" />
              <h3 className="font-semibold">{phase === "running" ? `正在为「${chosen?.title}」生成主图…` : "AI 主图画布（占位视觉稿）"}</h3>
              <p className="mt-1 max-w-sm text-sm text-mute">
                {phase === "running" ? "模型正在引用品牌素材并合成 3 个构图方向。" : "生成后用卡片对比 3 稿；圈选「背景 / 文案 / 配色」说一句话即可局部重绘。"}
              </p>
              {phase === "running" && chosen && <div className="mt-4 max-w-[260px]"><MainImageMock title={chosen.title} variant={{ id: "loading", label: "", bg: "linear-gradient(135deg,#0b141b,#162b38)", fg: "#e7eff2", accent: "#00ff99" }} brand={brandLine()} /></div>}
            </Card>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
                {variants.map((v, i) => {
                  const active = chosenVariant?.id === v.id;
                  return (
                    <motion.button key={v.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }} onClick={() => setChosenVariant(v)} className={`focus-ring rounded-card p-1.5 text-left transition-colors ${active ? "bg-neon/12" : "hover:bg-white/4"}`}>
                      <MainImageMock title={chosen?.title ?? "商品"} variant={v} tagline={selling[0]} brand={brandLine()} />
                      <div className="mt-2 flex items-center justify-between px-1">
                        <span className="text-xs font-medium">{v.label}</span>
                        {active ? <Badge tone="neon">选中</Badge> : <Badge tone="mute">方案 {i + 1}</Badge>}
                      </div>
                    </motion.button>
                  );
                })}
              </div>

              <Card className="flex flex-wrap items-center gap-3">
                <div className="flex-1">
                  <div className="mb-1 text-xs text-mute">局部重绘（圈选区域用自然语言描述，此处演示文案指令）</div>
                  <input value={repaint} onChange={(e) => setRepaint(e.target.value)} onKeyDown={(e) => e.key === "Enter" && doRepaint()} placeholder='例如：把背景换成浅灰渐变，突出“磁吸”' className={inputCls} />
                </div>
                <Button variant="outline" icon={repainting ? <RefreshCw size={14} className="animate-spin" /> : <RefreshCw size={14} />} onClick={doRepaint} disabled={repainting || !repaint.trim()}>
                  {repainting ? "重绘中…" : "重绘选中区域"}
                </Button>
              </Card>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm text-mute">
                  当前定稿：<span className="font-medium text-ink">{chosenVariant?.label}</span>
                  {brandColor() && <span className="ml-2 inline-flex items-center gap-1.5"><span className="inline-block h-3 w-3 rounded-full" style={{ background: brandColor() }} /> 已套用品牌资产</span>}
                </div>
                <div className="flex gap-3">
                  <Button variant="outline" icon={<RefreshCw size={14} />} onClick={startGen}>换个思路重来</Button>
                  <Button icon={<Check size={15} />} onClick={toDraft}>定稿 · 转上架材料</Button>
                </div>
              </div>
              {madeDraft && (
                <div className="flex items-center gap-2 rounded-2xl border border-neon/25 bg-neon/5 px-4 py-3 text-sm">
                  <Check size={15} className="text-neon" /> 已写入上架草稿：{chosen?.title} — 去 <Link to="/publish" className="text-neon underline">商品上架</Link> 编排多平台。
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
