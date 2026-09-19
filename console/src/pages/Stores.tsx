import { useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Check, RotateCcw, Unplug, ArrowRight, Store as StoreIcon, AlertCircle } from "lucide-react";
import { Card, Badge, Dot, PageHeader, Button, Modal } from "../components/ui";
import { platformMeta, enabledStorePlatforms, metaOf } from "../data/ecom";
import { useEcom } from "../store/ecom";

const wizardSteps = ["选择平台", "授权", "挂载到工作台"];

export default function Stores() {
  const { stores, addStore, setStoreStatus } = useEcom();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [pick, setPick] = useState<string>("taobao");
  const [failSim, setFailSim] = useState(false);
  const [authState, setAuthState] = useState<"idle" | "ok" | "fail">("idle");

  const reset = () => {
    setStep(0); setPick("taobao"); setFailSim(false); setAuthState("idle");
  };
  const openWizard = () => { reset(); setOpen(true); };

  const storeDot = (s: { status: string }) =>
    s.status === "connected" ? <Dot tone="neon" pulse /> : s.status === "expired" ? <Dot tone="warn" /> : <Dot tone="mute" />;

  return (
    <div>
      <PageHeader
        title="店铺管理"
        sub="把店铺接进同一个工作台，AI 任务才有数据来源；授权状态一目了然"
        actions={<Button icon={<PlugZap size={15} />} onClick={openWizard}>连接新店铺</Button>}
      />

      {stores.length === 0 ? (
        <Card className="flex flex-col items-center py-16 text-center">
          <StoreIcon size={40} className="mb-3 text-mute" />
          <h3 className="text-lg font-semibold">还没有连接的店铺</h3>
          <p className="mt-1 max-w-sm text-sm text-mute">点「连接新店铺」，走完授权后店铺会出现在这里，之后就能跑选品 / 分析 / 上架任务。</p>
          <Button className="mt-5" icon={<ArrowRight size={15} />} onClick={openWizard}>连接你的第 1 家店</Button>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {stores.map((s, i) => {
            const meta = metaOf(s.platformId);
            return (
              <motion.div key={s.id} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
                <Card hover className="flex h-full flex-col gap-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl font-display font-bold" style={{ background: `${meta.color}22`, color: meta.color }}>
                        {meta.short.slice(0, 1)}
                      </div>
                      <div>
                        <div className="font-semibold">{s.name}</div>
                        <div className="text-xs text-mute">加入于 {s.addedAt}</div>
                      </div>
                    </div>
                    {storeDot(s)}
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-center">
                    {[["在售", s.products], ["7 日订单", s.orders7d], ["状态", s.status === "connected" ? "在线" : s.status === "expired" ? "授权过期" : "已断开"]].map(([k, v]) => (
                      <div key={k as string} className="rounded-xl bg-white/4 px-2 py-2">
                        <div className="tnum text-sm font-semibold">{typeof v === "number" ? v.toLocaleString() : v}</div>
                        <div className="text-[10px] text-mute">{k}</div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-auto flex flex-wrap gap-2">
                    {s.status === "connected" ? (
                      <>
                        <Link to="/analytics"><Button variant="outline" className="flex-1" icon={<RotateCcw size={13} />}>分析</Button></Link>
                        <Button variant="ghost" onClick={() => setStoreStatus(s.id, "expired")}>模拟过期</Button>
                        <Button variant="ghost" onClick={() => setStoreStatus(s.id, "disconnected")} icon={<Unplug size={13} />}>断开</Button>
                      </>
                    ) : (
                      <Button className="flex-1" icon={<RotateCcw size={14} />} onClick={() => setStoreStatus(s.id, "connected")}>
                        {s.status === "expired" ? "重新授权" : "重新连接"}
                      </Button>
                    )}
                  </div>
                </Card>
              </motion.div>
            );
          })}

          <button onClick={openWizard} className="glass focus-ring flex min-h-[168px] flex-col items-center justify-center gap-2 rounded-card border-dashed text-mute transition-colors hover:border-neon/40 hover:text-neon">
            <StoreIcon size={26} />
            <span className="text-sm font-medium">连接新店铺</span>
          </button>
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="连接店铺向导">
        <ol className="mb-5 flex items-center gap-1 text-xs">
          {wizardSteps.map((s, i) => (
            <li key={s} className={`flex items-center gap-1 ${i <= step ? "text-neon" : "text-mute"}`}>
              <span className={`flex h-5 w-5 items-center justify-center rounded-full ${i < step ? "bg-neon text-[#04110b]" : i === step ? "border border-neon/50" : "border border-line"}`}>
                {i < step ? <Check size={12} /> : i + 1}
              </span>
              {s}
              {i < wizardSteps.length - 1 && <span className="mx-1 h-px w-4 bg-line" />}
            </li>
          ))}
        </ol>

        {step === 0 && (
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {enabledStorePlatforms.map((id) => {
              const m = platformMeta[id];
              const installed = stores.some((s) => s.platformId === id && s.status !== "disconnected");
              const active = pick === id;
              return (
                <button
                  key={id}
                  onClick={() => setPick(id)}
                  className={`focus-ring flex flex-col items-start gap-2 rounded-2xl border p-3 text-left transition-colors ${active ? "border-neon/60 bg-neon/8" : "border-line bg-panel hover:border-neon/30"}`}
                >
                  <span className="font-display text-sm font-bold" style={{ color: m.color }}>{m.short}</span>
                  <span className="text-[10px] text-mute">{installed ? "已有同平台店铺" : `${m.scope.join(" · ")}`}</span>
                  {active && <Badge tone="neon">已选</Badge>}
                </button>
              );
            })}
          </div>
        )}

        {step === 1 && (
          <div className="space-y-3">
            <p className="text-sm text-mute">模拟跳转到 {platformMeta[pick].name} 授权页。读取范围：{platformMeta[pick].scope.join("、")}。</p>
            <label className="flex items-center gap-2 text-sm text-mute">
              <input type="checkbox" checked={failSim} onChange={(e) => setFailSim(e.target.checked)} className="accent-[#00ff99]" />
              模拟授权失败（回调超时）以演示重试路径
            </label>
            <div className="rounded-2xl border border-line bg-panel p-4">
              {authState === "fail" ? (
                <div className="flex items-start gap-2 text-sm text-warn">
                  <AlertCircle size={16} className="mt-0.5 shrink-0" />
                  <div>
                    授权失败：平台回调超时。已保留你选择的平台，可直接重试，不会从头再来。
                  </div>
                </div>
              ) : (
                <div className="text-sm">授权页（模拟）：账号「lanhai@example.com」 · 允许「蓝海优品」读取并管理 {platformMeta[pick].short} 店铺数据</div>
              )}
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="ghost" onClick={() => setStep(0)}>上一步</Button>
              <Button onClick={() => {
                if (authState === "fail") { setAuthState("idle"); return; }
                if (failSim) { setAuthState("fail"); return; }
                setAuthState("ok"); setStep(2);
              }}>
                {failSim && authState === "idle" ? "授权（会失败）" : "完成授权"}
              </Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <div className="rounded-2xl border border-neon/25 bg-neon/5 p-4 text-sm">
              授权成功！{platformMeta[pick].name} 的读 / 写权限已就绪，挂载后立即出现在左侧店铺列表。
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="ghost" onClick={() => { setStep(1); setAuthState("idle"); }}>返回</Button>
              <Button
                icon={<Check size={15} />}
                onClick={() => {
                  addStore(pick);
                  setOpen(false);
                }}
              >
                挂载到工作台
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function PlugZap({ size }: { size?: number }) {
  return <span style={{ display: "inline-flex" }}><svg width={size ?? 15} height={size ?? 15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22v-3"/><path d="M12 15v-4"/><path d="M4 3l16 16"/><path d="M9 3h6v3"/><path d="M8 6h8"/><path d="M8 6v4a4 4 0 0 0 .5 2"/><path d="M11.5 12H14"/><path d="M14 6v3"/></svg></span>;
}
