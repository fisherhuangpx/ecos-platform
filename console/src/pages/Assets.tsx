import { useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Upload, Plus, Tag, History, Link2, Search } from "lucide-react";
import { Card, Badge, Button, Dot, Modal, PageHeader, inputCls } from "../components/ui";
import { assetTypes } from "../data/ecom";
import { useEcom } from "../store/ecom";

type TypeKey = "all" | keyof typeof assetTypes;

const typeFilter: { id: TypeKey; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "logo", label: "Logo" },
  { id: "swatch", label: "色卡" },
  { id: "model", label: "模特图" },
  { id: "main", label: "主图" },
  { id: "doc", label: "文档" },
];

export default function Assets() {
  const { assets, addAsset } = useEcom();
  const [type, setType] = useState<TypeKey>("all");
  const [query, setQuery] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState("");
  const [addType, setAddType] = useState<keyof typeof assetTypes>("logo");
  const [tags, setTags] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const filtered = useMemo(() => {
    return assets.filter((a) => {
      const okType = type === "all" || a.type === type;
      const q = query.trim().toLowerCase();
      const okQuery = !q || a.name.toLowerCase().includes(q) || a.tags.some((t) => t.toLowerCase().includes(q));
      return okType && okQuery;
    });
  }, [assets, type, query]);

  const detail = assets.find((a) => a.id === detailId);

  const commitAdd = (n: string, t: keyof typeof assetTypes, tagText: string) => {
    if (!n.trim()) return;
    addAsset(n.trim(), t, tagText.split(/[,，]/).map((x) => x.trim()).filter(Boolean));
    setAddOpen(false);
    setName("");
    setTags("");
  };

  return (
    <div>
      <PageHeader
        title="品牌素材库"
        sub="logo / 色卡 / 模特图 / 历史主图统一管理；AI 生成主图时可直接引用并自动套用规范"
        actions={
          <>
            <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) commitAdd(f.name, addType, tags);
              e.target.value = "";
            }} />
            <Button variant="outline" icon={<Upload size={14} />} onClick={() => fileRef.current?.click()}>上传文件</Button>
            <Button icon={<Plus size={15} />} onClick={() => setAddOpen(true)}>添加素材</Button>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {typeFilter.map((t) => (
            <button key={t.id} onClick={() => setType(t.id)} className={`focus-ring rounded-full border px-3 py-1.5 text-xs transition-colors ${type === t.id ? "border-neon/60 bg-neon/10 text-neon" : "border-line text-mute hover:text-ink"}`}>
              {t.label}
              {t.id !== "all" && <span className="ml-1 text-mute">{assets.filter((a) => a.type === t.id).length}</span>}
            </button>
          ))}
        </div>
        <div className="flex w-56 items-center gap-2 rounded-xl border border-line bg-panel px-3 py-1.5 text-sm text-mute">
          <Search size={14} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜名称 / 标签" className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-mute/50" />
        </div>
      </div>

      {filtered.length === 0 ? (
        <Card className="flex flex-col items-center py-14 text-center">
          <Upload size={30} className="mb-3 text-mute" />
          <h3 className="font-semibold">没有匹配的素材</h3>
          <p className="mt-1 text-sm text-mute">换个筛选条件，或把品牌 logo / 色卡拖进来。</p>
        </Card>
      ) : (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f) commitAdd(f.name, addType, tags);
          }}
          className={`grid gap-3 sm:grid-cols-2 xl:grid-cols-4 ${dragOver ? "rounded-2xl ring-2 ring-neon/60" : ""}`}
        >
          {filtered.map((a, i) => {
            const info = assetTypes[a.type];
            return (
              <motion.button key={a.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }} onClick={() => setDetailId(a.id)} className="focus-ring text-left">
                <Card hover className="flex h-full flex-col gap-3 !p-4">
                  <div className="flex h-24 items-center justify-center overflow-hidden rounded-xl border border-line bg-panel">
                    {a.type === "swatch" ? (
                      <div className="h-16 w-16 rounded-2xl shadow-lg" style={{ background: a.color ?? "#8fa3ad" }} />
                    ) : (
                      <div className="flex h-16 w-16 items-center justify-center rounded-2xl font-display text-2xl font-bold" style={{ background: `${info.color}22`, color: info.color }}>
                        {a.letter ?? "图"}
                      </div>
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{a.name}</div>
                    <div className="mt-1 flex items-center gap-2 text-[11px] text-mute">
                      <Badge tone="mute">{info.label}</Badge>
                      <span>{a.size}</span>
                    </div>
                  </div>
                  <div className="mt-auto flex flex-wrap gap-1">
                    {a.tags.slice(0, 3).map((t) => <span key={t} className="rounded bg-white/6 px-1.5 py-0.5 text-[10px] text-mute">#{t}</span>)}
                    <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-mute"><History size={11} /> v{a.versions.length}</span>
                  </div>
                </Card>
              </motion.button>
            );
          })}

          <button onClick={() => setAddOpen(true)} className="glass focus-ring flex min-h-[200px] flex-col items-center justify-center gap-2 rounded-card border-dashed text-mute transition-colors hover:border-neon/40 hover:text-neon">
            <Upload size={22} />
            <span className="text-xs">拖文件到卡片区，或点这里添加</span>
          </button>
        </div>
      )}

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="添加素材">
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-mute">名称</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="如：品牌 Logo（新版）" className={inputCls} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-mute">类型</span>
              <select value={addType} onChange={(e) => setAddType(e.target.value as keyof typeof assetTypes)} className={inputCls}>
                {Object.entries(assetTypes).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-mute">标签（逗号分隔）</span>
              <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="品牌A, 官方, 2026" className={inputCls} />
            </label>
          </div>
          <div className="flex justify-end gap-3 pt-1">
            <Button variant="ghost" onClick={() => setAddOpen(false)}>取消</Button>
            <Button icon={<Plus size={15} />} disabled={!name.trim()} onClick={() => commitAdd(name, addType, tags)}>添加</Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!detail} onClose={() => setDetailId(null)} title={detail?.name ?? ""} wide>
        {detail && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Badge tone="neon">{assetTypes[detail.type].label}</Badge>
              {detail.tags.map((t) => <span key={t} className="rounded bg-white/6 px-2 py-0.5 text-xs text-mute">#{t}</span>)}
              <span className="ml-auto text-xs text-mute"><Tag size={12} className="mr-1 inline" />{detail.size}</span>
            </div>
            <div className="flex h-28 items-center justify-center rounded-2xl border border-line bg-panel">
              {detail.type === "swatch" ? <div className="h-16 w-16 rounded-2xl shadow-lg" style={{ background: detail.color ?? "#8fa3ad" }} /> : (
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl font-display text-3xl font-bold" style={{ background: `${assetTypes[detail.type].color}22`, color: assetTypes[detail.type].color }}>
                  {detail.letter ?? "图"}
                </div>
              )}
            </div>
            <div>
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold"><History size={14} /> 版本历史</div>
              <ul className="divide-y divide-line rounded-2xl border border-line">
                {detail.versions.map((v) => (
                  <li key={v.v} className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm">
                    <Badge tone="accent">{v.v}</Badge>
                    <span className="min-w-0 flex-1 truncate text-mute">{v.note}</span>
                    <span className="text-xs text-mute">{v.by} · {v.at}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold"><Link2 size={14} /> 被引用位置</div>
              {detail.refs.length === 0 ? (
                <p className="text-xs text-mute">暂未被 AI 任务引用——被引用后这里会显示使用位置与版本。</p>
              ) : (
                <ul className="space-y-1.5 text-sm">
                  {detail.refs.map((r) => (
                    <li key={r.task} className="flex items-center gap-2 rounded-xl border border-line bg-panel px-3 py-2">
                      <Dot tone="neon" /> <span className="flex-1">{r.task}</span><span className="text-xs text-mute">{r.at}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
