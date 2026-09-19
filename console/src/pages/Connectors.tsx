import { useState } from "react";
import { motion } from "framer-motion";
import { Plug, Check, ShieldAlert, KeyRound, Eye, PenLine, Rocket } from "lucide-react";
import { Card, Badge, Button, Dot, Modal, PageHeader } from "../components/ui";
import { useEcom } from "../store/ecom";

type Cat = "全部" | "电商平台" | "自动剪辑" | "内容渠道";
const cats: Cat[] = ["全部", "电商平台", "自动剪辑", "内容渠道"];
const riskTone = (r: string) => (r === "低" ? "neon" : r === "中" ? "warn" : "danger") as "neon" | "warn" | "danger";
const wizSteps = ["了解连接器", "授权", "设置权限", "启用"];

export default function Connectors() {
  const { connectors, enableConnector, disableConnector } = useEcom();
  const [cat, setCat] = useState<Cat>("全部");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [wizard, setWizard] = useState(false);
  const [wStep, setWStep] = useState(0);
  const detail = connectors.find((c) => c.id === detailId);
  const filtered = connectors.filter((c) => cat === "全部" || c.category === cat);

  const startWizard = (id: string) => { setWizard(true); setWStep(0); setDetailId(id); };
  const finishWizard = () => {
    if (detailId) enableConnector(detailId);
    setWizard(false);
    setDetailId(null);
  };

  return (
    <div>
      <PageHeader
        title="连接器市场"
        sub={`${connectors.length} 个可用连接器（电商 / 剪辑 / 内容渠道），已安装 ${connectors.filter((c) => c.status === "已安装").length} 个；安装前看清读哪些、写哪些`}
        actions={<Link_ to="/stores" />}
      />

      <div className="mb-4 flex flex-wrap gap-1.5">
        {cats.map((c) => (
          <button key={c} onClick={() => setCat(c)} className={`focus-ring rounded-full border px-3 py-1.5 text-xs transition-colors ${cat === c ? "border-neon/60 bg-neon/10 text-neon" : "border-line text-mute hover:text-ink"}`}>
            {c}
            <span className="ml-1 text-mute">{connectors.filter((x) => c === "全部" || x.category === c).length}</span>
          </button>
        ))}
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((c, i) => (
          <motion.button key={c.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }} onClick={() => setDetailId(c.id)} className="focus-ring text-left">
            <Card hover className="flex h-full flex-col gap-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/15 text-[#b7b1ff]"><Plug size={18} /></div>
                  <div>
                    <div className="font-semibold">{c.name}</div>
                    <div className="text-[11px] text-mute">{c.category}</div>
                  </div>
                </div>
                {c.status === "已安装" ? <Badge tone="neon"><Check size={11} /> 已安装</Badge> : c.status === "授权过期" ? <Badge tone="warn">授权过期</Badge> : <Badge tone="mute">未安装</Badge>}
              </div>
              <p className="line-clamp-2 text-xs text-mute">{c.desc}</p>
              <div className="mt-auto flex items-center justify-between text-[11px] text-mute">
                <span>读：{c.read.length} 项 · 写：{c.write.length} 项</span>
                <Badge tone={riskTone(c.risk)}>风险 {c.risk}</Badge>
              </div>
            </Card>
          </motion.button>
        ))}
      </div>

      <Modal open={!!detail} onClose={() => setDetailId(null)} title={detail?.name ?? ""}>
        {detail && (
          <div className="space-y-4">
            <p className="text-sm text-mute">{detail.desc}</p>
            <div className="flex flex-wrap gap-2">
              <Badge tone="mute">{detail.category}</Badge>
              <Badge tone={riskTone(detail.risk)}><ShieldAlert size={11} /> 风险 {detail.risk}</Badge>
              <span className="text-[11px] text-mute">{detail.note}</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl border border-line bg-panel p-3">
                <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-neon"><Eye size={13} /> 将读取（{detail.read.length}）</div>
                <ul className="space-y-1 text-xs text-mute">{detail.read.map((x) => <li key={x}>· {x}</li>)}</ul>
              </div>
              <div className="rounded-2xl border border-warn/20 bg-panel p-3">
                <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-warn"><PenLine size={13} /> 将写入（{detail.write.length}）</div>
                <ul className="space-y-1 text-xs text-mute">{detail.write.length ? detail.write.map((x) => <li key={x}>· {x}</li>) : <li>· 无（只读）</li>}</ul>
              </div>
            </div>
            {detail.status === "已安装" ? (
              <div className="flex items-center justify-between">
                <Badge tone="neon"><Dot tone="neon" pulse /> 已启用，可在工作台使用</Badge>
                <Button variant="ghost" onClick={() => { disableConnector(detail.id); setDetailId(null); }}>停用</Button>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <span className="text-xs text-mute">{detail.status === "授权过期" ? "授权已过期，重新授权即可继续使用。" : "安装后出现在可用渠道，无需重启。"}</span>
                <Button icon={<Rocket size={14} />} onClick={() => startWizard(detail.id)}>{detail.status === "授权过期" ? "重新授权" : "开始安装"}</Button>
              </div>
            )}
          </div>
        )}
      </Modal>

      <Modal open={wizard} onClose={() => setWizard(false)} title={`安装向导 · ${detail?.name ?? ""}`}>
        <ol className="mb-5 flex items-center gap-1 text-xs">
          {wizSteps.map((s, i) => (
            <li key={s} className={`flex items-center gap-1 ${i <= wStep ? "text-neon" : "text-mute"}`}>
              <span className={`flex h-5 w-5 items-center justify-center rounded-full ${i < wStep ? "bg-neon text-[#04110b]" : i === wStep ? "border border-neon/50" : "border border-line"}`}>
                {i < wStep ? <Check size={12} /> : i + 1}
              </span>
              {s}
              {i < wizSteps.length - 1 && <span className="mx-1 h-px w-4 bg-line" />}
            </li>
          ))}
        </ol>

        {wStep === 0 && (
          <div className="space-y-2 text-sm text-mute">
            <p>· 读取范围：{detail?.read.join("、")}</p>
            <p>· 写入范围：{detail?.write.length ? detail?.write.join("、") : "无"}</p>
            <p className="rounded-xl bg-warn/8 p-3 text-xs text-warn">风险说明：本连接器 {detail?.risk} 风险。所有写操作仍受审批闸门保护，人工确认后才执行。</p>
          </div>
        )}
        {wStep === 1 && (
          <div className="rounded-2xl border border-line bg-panel p-4 text-sm">
            <div className="mb-2 flex items-center gap-2 font-medium"><KeyRound size={15} className="text-neon" /> 授权（模拟）</div>
            <p className="text-xs text-mute">跳转到 {detail?.name} 授权页 → 允许「蓝海优品」按上述范围接入。</p>
          </div>
        )}
        {wStep === 2 && (
          <div className="space-y-2 text-sm">
            <div className="rounded-2xl border border-line bg-panel p-4">
              <div className="mb-1 flex items-center justify-between"><span>读取权限</span><Badge tone="neon">只读</Badge></div>
              <p className="text-xs text-mute">用于数据同步与 AI 分析</p>
            </div>
            <div className="rounded-2xl border border-line bg-panel p-4">
              <div className="mb-1 flex items-center justify-between"><span>写入权限</span><Badge tone="warn">需审批</Badge></div>
              <p className="text-xs text-mute">写操作全部过审批闸门 + 审计，不可静默执行</p>
            </div>
          </div>
        )}
        {wStep === 3 && (
          <div className="rounded-2xl border border-neon/25 bg-neon/5 p-4 text-sm">
            完成！安装后连接器立即出现在可用渠道；建议接下来跑一个任务验证连通性。
          </div>
        )}

        <div className="mt-6 flex justify-between">
          <Button variant="ghost" onClick={() => (wStep === 0 ? setWizard(false) : setWStep((s) => s - 1))}>上一步</Button>
          {wStep < wizSteps.length - 1 ? (
            <Button onClick={() => setWStep((s) => s + 1)}>下一步</Button>
          ) : (
            <Button icon={<Check size={15} />} onClick={finishWizard}>启用连接器</Button>
          )}
        </div>
      </Modal>
    </div>
  );
}

function Link_({ to }: { to: string }) {
  return (
    <a href={to} className="focus-ring flex items-center gap-1 rounded-xl border border-line px-3 py-2 text-xs text-mute hover:text-neon">店铺授权管理</a>
  );
}
