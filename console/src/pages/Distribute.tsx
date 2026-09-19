// /distribute 分发中枢（spec §4/§5 的前端投影）：工单看板 / 发布日历 / 互动收件箱 三视图 +
// A/B/C 档人工出口（A 直发自动流转 / B 导出发布包 / C 回填链接）+ 拉取回流（命中数 toast 化，引导去 /editing）+
// 发起分发三步向导（成片 → 账号 → 关联商品）。
// 本页本地 state 仅视图切换、弹窗/向导与 toast；数据与状态机全部走 useContent()，不碰 seed。
// 决策（brief 看板列 = 排队/待人工/已发布/失败）：store 定时器产生的「发布中」瞬时态并入 排队 列展示并带状态徽章；
// 「草稿 / 已归档」非看板态不出卡。
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";
import {
  AlertCircle, Ban, CalendarDays, Check, CheckCircle2, FileDown, Inbox,
  Link2, RefreshCw, Send, X, XCircle,
} from "lucide-react";
import { Badge, Button, Card, Field, Modal, PageHeader, Select, Tabs, inputCls } from "../components/ui";
import { TierBadge } from "../components/content/kit";
import { PostCalendar } from "../components/content/Calendar";
import { SlotHeatmap } from "../components/content/Heatmap";
import { AreaChart } from "../components/charts";
import { channelMeta, tierLabels, type ChannelTier, type ContentAccount, type InteractionMsg, type Post, type PostStatus } from "../data/content";
import { nowLabel, seedProducts, type Product } from "../data/ecom";
import { useContent } from "../store/content";
import { useEcom } from "../store/ecom";

// ── 页面口径常量 ──
const wizardSteps = ["成片选择", "账号矩阵", "关联商品"];
const boardColumns: { key: string; hint: string; match: (p: Post) => boolean }[] = [
  { key: "排队", hint: "A 档自动直发中", match: (p) => p.status === "排队" || p.status === "发布中" }, // 发布中 瞬时态并入本列
  { key: "待人工", hint: "B 导出发布包 / C 回填链接", match: (p) => p.status === "待人工" },
  { key: "已发布", hint: "回流指标按日补点", match: (p) => p.status === "已发布" },
  { key: "失败", hint: "平台打回待处理", match: (p) => p.status === "失败" },
];
// 归因徽章（brief 口径）：full/partial/none → "GMV 全链路 / GMV 部分 / GMV 未归因"
const attributedMeta: Record<Post["attributed"], { label: string; tone: "neon" | "accent" | "mute" }> = {
  full: { label: "GMV 全链路", tone: "neon" },
  partial: { label: "GMV 部分", tone: "accent" },
  none: { label: "GMV 未归因", tone: "mute" },
};
const msgIntentTone: Record<InteractionMsg["intent"], "accent" | "neon" | "warn"> = { 咨询: "accent", 好评: "neon", 投诉: "warn" };
const msgStatusTone: Record<InteractionMsg["status"], "mute" | "warn" | "neon"> = { 待回复: "mute", 待审批: "warn", 已回复: "neon" };
const msgStatusRank: Record<InteractionMsg["status"], number> = { 待审批: 0, 待回复: 1, 已回复: 2 };
const tierRank: Record<ChannelTier, number> = { A: 0, B: 1, C: 2 };
const PRODUCT_NONE = "不关联商品";
const productLabel = (p: Product) => `${p.name}（¥${p.price}）`;

// AreaChart 需 ≥2 点（单点会算出 NaN 坐标）：C 档回填后只有 1 个种子点，复制成平线让 sparkline 立刻可现（Step 2 走查口径）
const completionSeries = (p: Post): number[] => {
  const s = p.metrics.map((m) => m.completion);
  return s.length === 1 ? [s[0] as number, s[0] as number] : s;
};

// ── 工单卡：标题 + TierBadge + 目标账号头像点 + scheduledAt + 归因徽章；已发布带完播 sparkline；操作按状态 ──
function PostCard({
  post, accounts, focused, onBackfill, onExport, onCancel,
}: {
  post: Post; accounts: ContentAccount[]; focused: boolean;
  onBackfill: (p: Post) => void; onExport: (p: Post) => void; onCancel: (p: Post) => void;
}) {
  const attr = attributedMeta[post.attributed];
  return (
    <Card hover className={`flex h-full flex-col gap-2 !p-4 transition-shadow ${focused ? "ring-2 ring-neon/60" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 text-sm font-semibold leading-snug">{post.title}</span>
        <TierBadge tier={post.tier} />
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[11px] text-mute">
        <span className="flex items-center gap-1" aria-label="目标账号">
          {post.accountIds.map((aid) => {
            const a = accounts.find((x) => x.id === aid);
            const m = a ? channelMeta[a.platformId] : undefined;
            return (
              <span
                key={aid}
                title={a ? `${a.name} · ${m?.name ?? a.platformId}` : "账号已移除"}
                className="inline-block h-2.5 w-2.5 rounded-full ring-1 ring-white/25"
                style={{ background: m?.color ?? "#8fa3ad" }}
              />
            );
          })}
        </span>
        <span className="tnum">{post.scheduledAt}</span>
        {post.status === "发布中" && <Badge tone="accent">发布中</Badge>}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={attr.tone}>{attr.label}</Badge>
        {post.publishUrl && (
          <a
            href={post.publishUrl.startsWith("http") ? post.publishUrl : undefined}
            target="_blank"
            rel="noreferrer"
            title={post.publishUrl}
            className="max-w-[180px] truncate text-[10px] text-mute hover:text-neon"
          >
            {post.publishUrl}
          </a>
        )}
      </div>

      {post.status === "已发布" && (
        post.metrics.length > 0 ? (
          <div className="rounded-xl border border-line bg-panel/60 px-2 pt-1.5">
            <div className="flex items-center justify-between text-[10px] text-mute">
              <span>完播率趋势</span>
              <span className="tnum">最新 {post.metrics[post.metrics.length - 1]?.completion}% · {post.metrics.length} 个回流点</span>
            </div>
            <AreaChart data={completionSeries(post)} height={40} />
          </div>
        ) : (
          <p className="text-[10px] text-mute">暂无回流指标 · 到「发布日历」点拉取回流补当日点</p>
        )
      )}

      {(post.status === "待人工" || post.status === "排队" || post.status === "发布中") && (
        <div className="mt-auto flex gap-2 pt-1">
          {post.status === "待人工" && (post.tier === "C" ? (
            <Button variant="outline" className="flex-1 !h-8 !px-2 text-xs" icon={<Link2 size={13} />} onClick={() => onBackfill(post)}>回填链接</Button>
          ) : (
            <Button variant="outline" className="flex-1 !h-8 !px-2 text-xs" icon={<FileDown size={13} />} onClick={() => onExport(post)}>导出发布包</Button>
          ))}
          {(post.status === "排队" || post.status === "发布中") && (
            <Button variant="ghost" className="flex-1 !h-8 !px-2 text-xs" icon={<Ban size={13} />} onClick={() => onCancel(post)}>取消</Button>
          )}
        </div>
      )}
    </Card>
  );
}

export default function Distribute() {
  const {
    posts, accounts, messages, editJobs, hotspots,
    createPost, exportPublishPack, backfillPublish, cancelPost, pullMetrics,
    replyMessage, approveMessage, rejectMessage,
  } = useContent();
  const { audit } = useEcom();

  const [tab, setTab] = useState("工单看板");
  const [focusId, setFocusId] = useState<string | null>(null); // 日历 → 看板跳焦

  // ── 发起分发向导（Step 1 成片 / Step 2 账号 / Step 3 商品）──
  const [wizardOpen, setWizardOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [editId, setEditId] = useState("");
  const [accSel, setAccSel] = useState<string[]>([]);
  const [productPick, setProductPick] = useState(PRODUCT_NONE);

  // C 档回填弹窗
  const [backfillFor, setBackfillFor] = useState<Post | null>(null);
  const [backfillUrl, setBackfillUrl] = useState("");
  // 收件箱驳回弹窗（store rejectMessage(id) 不收原因 → 原因走本页 audit 备案）
  const [rejectFor, setRejectFor] = useState<InteractionMsg | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  // ── toast（拉取回流命中为 sticky 手动关闭，其余自动消失）──
  interface ToastItem { id: number; tone: "ok" | "warn"; msg: ReactNode }
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastSeq = useRef(0);
  const dismissToast = (id: number) => setToasts((prev) => prev.filter((t) => t.id !== id));
  const pushToast = (msg: ReactNode, tone: "ok" | "warn" = "ok", sticky = false) => {
    const id = ++toastSeq.current;
    setToasts((prev) => [...prev, { id, tone, msg }]);
    if (!sticky) window.setTimeout(() => dismissToast(id), 4200);
  };

  // ── 配额展示口径与 /accounts 完全同源（R14/R15）：按「当日有真实派发动作的工单」经平台交集推导，
  //    seed 的静态 account.todayPosts 字段 UI 不信任、不做动态读取。
  const todayKey = nowLabel().slice(0, 5); // "MM-DD"
  const noDispatchStatus: PostStatus[] = ["草稿", "失败", "已归档"];
  const dispatchedToday = (p: Post) => p.createdAt.slice(0, 5) === todayKey && !noDispatchStatus.includes(p.status);
  const platformsOfPost = (p: Post) => accounts.filter((a) => p.accountIds.includes(a.id)).map((a) => a.platformId);
  const dispatchedCountOf = (a: ContentAccount) =>
    posts.filter((p) => dispatchedToday(p) && platformsOfPost(p).includes(a.platformId)).length;

  // 可分发成片：已发布 / 待审核（回流二创 ed-4 类任务同样可发起，支撑 A/B 对照演示）
  const distributableJobs = useMemo(
    () => editJobs.filter((j) => j.status === "已发布" || j.status === "待审核"),
    [editJobs],
  );

  const openWizard = (presetJobId = "") => {
    setStep(0); setEditId(presetJobId); setAccSel([]); setProductPick(PRODUCT_NONE);
    setWizardOpen(true);
  };

  // 接口契约（本任务定义，Task 9 依赖）：/distribute?from=<editJobId> 带参进入 → 打开「发起分发」向导并在 Step 1 预选该成片；
  // from 为未知 id 或不在可分发成片（已发布/待审核）内 → 忽略参数，正常进页。
  const [searchParams] = useSearchParams();
  const fromHandled = useRef(false); // 只消费一次，避免向导关掉后 effect 复燃
  useEffect(() => {
    if (fromHandled.current) return;
    fromHandled.current = true;
    const from = searchParams.get("from");
    if (!from) return;
    const job = editJobs.find((j) => j.id === from && (j.status === "已发布" || j.status === "待审核"));
    if (!job) return; // 未知/不可分发 id → 忽略
    openWizard(job.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, editJobs]);

  // 日历点选 → 切到看板并把对应工单卡滚入视野、霓虹描边短暂高亮
  const jumpToCard = (postId: string) => {
    setTab("工单看板");
    setFocusId(postId);
  };
  useEffect(() => {
    if (!focusId || tab !== "工单看板") return;
    document.getElementById(`post-card-${focusId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    const t = window.setTimeout(() => setFocusId(null), 2600);
    return () => window.clearTimeout(t);
  }, [focusId, tab]);

  // ── 动作出口 ──
  const handlePull = () => {
    const n = pullMetrics(); // 全量已发布工单补当日点，返回命中二创规则数（当日幂等）
    pushToast(
      n > 0 ? (
        <>回流命中 {n} 条 · 去 <Link to="/editing" className="font-semibold text-neon underline-offset-2 hover:underline">/editing</Link> 查看二创建议</>
      ) : (
        <>回流命中 0 条 · 全部已发布工单已补当日点（当日重复拉取幂等跳过）</>
      ),
      n > 0 ? "warn" : "ok",
      true, // sticky：手动点 ✕ 关闭，走查时不被自动消失吃掉
    );
  };

  const handleExport = (p: Post) => {
    exportPublishPack(p.id);
    pushToast("发布包已导出 · 已按线下导入标记发布，指标随后由回流任务补挂");
  };

  const handleCancel = (p: Post) => {
    cancelPost(p.id);
    pushToast("已取消分发 · 工单归档，不产生平台写操作");
  };

  const confirmBackfill = () => {
    if (!backfillFor || !backfillUrl.trim()) return;
    backfillPublish(backfillFor.id, backfillUrl.trim());
    pushToast("已回填发布链接 · 工单转已发布，归因按平台表计算并挂 1 个种子指标点");
    setBackfillFor(null); setBackfillUrl("");
  };

  const handleReply = (m: InteractionMsg) => {
    replyMessage(m.id);
    pushToast(
      m.intent === "投诉" ? "投诉类敏感 · AI 回复已转审批闸门" : "AI 回复已发出 · 计入周报",
      m.intent === "投诉" ? "warn" : "ok",
    );
  };
  const handleApproveMsg = (m: InteractionMsg) => {
    approveMessage(m.id);
    pushToast("回复审批通过 · 已发出");
  };
  const confirmRejectMsg = () => {
    if (!rejectFor) return;
    const reason = rejectReason.trim() || "未说明";
    rejectMessage(rejectFor.id); // 状态回落由 store 审计；原因文案 store 不接收 → 页面补一条备案审计
    audit({ user: "林芳", action: "驳回回复 · 原因备案", target: rejectFor.id, level: "写入", result: `原因：${reason} · 撤出审批流转人工` });
    pushToast(`已驳回回复 · 回落待回复池转人工（${reason}）`, "warn");
    setRejectFor(null); setRejectReason("");
  };

  // 向导：所选账号的最不利档（与 store worstTier 同口径：含 C 即人工）
  const selTiers = accSel
    .map((id) => accounts.find((a) => a.id === id)?.tier)
    .filter((t): t is ChannelTier => Boolean(t));
  const worst = selTiers.reduce<ChannelTier>((w, t) => (tierRank[t] > tierRank[w] ? t : w), "A");

  const toggleAcc = (id: string) =>
    setAccSel((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const handleCreate = () => {
    if (!editId || accSel.length === 0) return;
    const product = seedProducts.find((p) => productLabel(p) === productPick);
    const id = createPost(editId, accSel, product?.id);
    if (!id) {
      // store 拒绝（无可用账号，不建幽灵工单）+ 已降级审计 → 页面只 toast 化提示
      pushToast("无可用账号，发起失败 · 未创建工单", "warn");
      return;
    }
    setWizardOpen(false);
    setTab("工单看板");
    pushToast("分发工单已创建 · 进入调度队列（A 档直发 / B、C 档转人工）");
  };

  const inbox = [...messages].sort((a, b) => msgStatusRank[a.status] - msgStatusRank[b.status]);

  return (
    <div>
      <PageHeader
        title="分发中枢"
        sub="成片 → 多渠道分发工单 · A/B/C 档人工出口 · 回流指标与互动审批"
        actions={<Button icon={<Send size={15} />} onClick={() => openWizard()}>发起分发</Button>}
      />

      <Tabs items={["工单看板", "发布日历", "互动收件箱"]} active={tab} onChange={setTab} />

      {/* ── 视图 1 · 工单看板 ── */}
      {tab === "工单看板" && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {boardColumns.map((col) => {
            const list = posts.filter(col.match);
            return (
              <div key={col.key} className="rounded-card border border-line bg-panel/40 p-3">
                <div className="mb-1 flex items-center justify-between px-1">
                  <span className="text-sm font-semibold">{col.key}</span>
                  <span className="tnum text-xs text-mute">{list.length}</span>
                </div>
                <p className="mb-3 px-1 text-[10px] text-mute">{col.hint}</p>
                <div className="space-y-3">
                  {list.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-line px-3 py-6 text-center text-xs text-mute/70">暂无「{col.key}」工单</p>
                  ) : (
                    list.map((p) => (
                      <div key={p.id} id={`post-card-${p.id}`} className="scroll-mt-4">
                        <PostCard
                          post={p}
                          accounts={accounts}
                          focused={focusId === p.id}
                          onBackfill={(post) => { setBackfillFor(post); setBackfillUrl(""); }}
                          onExport={handleExport}
                          onCancel={handleCancel}
                        />
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── 视图 2 · 发布日历：PostCalendar（数据锚定自适应窗口，直接喂全量工单）+ 建议发布时段 + 拉取回流 ── */}
      {tab === "发布日历" && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <Card>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 font-semibold">
                <CalendarDays size={16} className="text-neon" /> 发布排期
              </h3>
              <span className="text-xs text-mute">点击排期跳到对应工单卡 · 格内色点 = 渠道档位</span>
            </div>
            <PostCalendar posts={posts} onSelect={jumpToCard} />
          </Card>

          <div className="space-y-4">
            <Card>
              <h3 className="mb-3 font-semibold">建议发布时段</h3>
              <SlotHeatmap grid={hotspots} />
              <p className="mt-3 rounded-xl bg-white/4 px-3 py-2 text-xs text-mute">
                19:00–21:00 黄金档，抖音官方号已排 1 单
              </p>
            </Card>
            <Card>
              <h3 className="mb-2 font-semibold">回流指标</h3>
              <p className="mb-3 text-xs text-mute">
                连接器回写：为全部「已发布」工单补当日数据点（当日幂等）；完播断崖命中二创规则时引导去 /editing 生成建议。当前 {posts.filter((p) => p.status === "已发布").length} 单在管。
              </p>
              <Button className="w-full" icon={<RefreshCw size={15} />} onClick={handlePull}>拉取回流</Button>
            </Card>
          </div>
        </div>
      )}

      {/* ── 视图 3 · 互动收件箱：白名单直发 / 投诉进审批闸门 ── */}
      {tab === "互动收件箱" && (
        <div className="space-y-3">
          {inbox.map((m) => {
            const a = accounts.find((x) => x.id === m.accountId);
            const meta = channelMeta[m.platformId];
            return (
              <Card key={m.id} hover className="!p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    aria-hidden
                    className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-white/25"
                    style={{ background: meta?.color ?? "#8fa3ad" }}
                  />
                  <span className="font-semibold">{m.author}</span>
                  <span className="text-xs text-mute">{meta?.name ?? m.platformId}{a ? ` · ${a.name}` : ""} · {m.createdAt}</span>
                  <Badge tone={msgIntentTone[m.intent]}>{m.intent}</Badge>
                  <Badge tone={msgStatusTone[m.status]}>{m.status}</Badge>
                </div>
                <p className="mt-2 text-sm">{m.text}</p>
                <div className="mt-2 rounded-xl border border-line bg-panel px-3 py-2 text-xs">
                  <span className="text-mute">AI 回复草稿：</span>
                  <span className="text-ink/85">{m.replyDraft}</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {m.status === "待回复" && (
                    <Button variant="outline" className="!h-8 !px-3 text-xs" icon={<Send size={13} />} onClick={() => handleReply(m)}>发送 AI 回复</Button>
                  )}
                  {m.status === "待审批" && (
                    <>
                      <Button className="!h-8 !px-3 text-xs" icon={<CheckCircle2 size={13} />} onClick={() => handleApproveMsg(m)}>批准</Button>
                      <Button variant="ghost" className="!h-8 !px-3 text-xs text-warn" icon={<XCircle size={13} />} onClick={() => { setRejectFor(m); setRejectReason(""); }}>驳回</Button>
                    </>
                  )}
                </div>
              </Card>
            );
          })}
          {inbox.length === 0 && (
            <Card className="py-12 text-center text-sm text-mute">
              <Inbox size={28} className="mx-auto mb-2 text-mute/40" /> 暂无粉丝互动消息
            </Card>
          )}
        </div>
      )}

      {/* ── 发起分发 Modal（三步）── */}
      <Modal open={wizardOpen} onClose={() => setWizardOpen(false)} title="发起分发" wide>
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
          <div className="space-y-4">
            {distributableJobs.length === 0 ? (
              <p className="rounded-xl border border-dashed border-line px-3 py-8 text-center text-sm text-mute">
                暂无可分发成片 · 请到 <Link to="/editing" className="text-neon hover:underline">/editing</Link> 完成剪辑并审批
              </p>
            ) : (
              <div className="space-y-2">
                {distributableJobs.map((j) => {
                  const on = editId === j.id;
                  return (
                    <button
                      key={j.id}
                      type="button"
                      onClick={() => setEditId(j.id)}
                      className={`focus-ring flex w-full items-center gap-3 rounded-xl border p-3 text-left text-sm transition-colors ${on ? "border-neon/50 bg-neon/5" : "border-line hover:border-neon/20"}`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{j.title}</span>
                          <Badge tone={j.status === "已发布" ? "neon" : "warn"}>{j.status}</Badge>
                          {j.reeditRule && <Badge tone="accent">二创 · {j.reeditRule}</Badge>}
                        </div>
                        <div className="mt-1 text-xs text-mute">{j.template} · {j.engine ?? j.provider} · 创建 {j.createdAt}</div>
                      </div>
                      {on && <Badge tone="neon">已选</Badge>}
                    </button>
                  );
                })}
              </div>
            )}
            <div className="flex justify-end">
              <Button disabled={!editId} onClick={() => setStep(1)}>下一步</Button>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-2">
              {accounts.map((a) => {
                const m = channelMeta[a.platformId];
                const expired = a.status !== "已连接";
                const used = dispatchedCountOf(a);
                const full = used >= a.dailyQuota;
                const on = accSel.includes(a.id);
                return (
                  <button
                    key={a.id}
                    type="button"
                    disabled={expired}
                    onClick={() => toggleAcc(a.id)}
                    className={`focus-ring flex items-center gap-3 rounded-xl border p-3 text-left text-sm transition-colors ${
                      expired ? "cursor-not-allowed border-line opacity-50"
                        : on ? "border-neon/50 bg-neon/5" : "border-line hover:border-neon/20"
                    }`}
                  >
                    <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-white/25" style={{ background: m?.color ?? "#8fa3ad" }} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{a.name}</span>
                      <span className="mt-0.5 block text-xs text-mute">
                        {m?.name} · {a.group}
                        {expired ? (
                          <span className="text-warn"> · 授权过期，请到 /accounts 重连</span>
                        ) : (
                          <span className={full ? "text-warn" : undefined}> · 今日已发 {used}/{a.dailyQuota}{full ? "（已满）" : ""}</span>
                        )}
                      </span>
                    </span>
                    <TierBadge tier={a.tier} />
                    {on && !expired && <Badge tone="neon">已选</Badge>}
                  </button>
                );
              })}
            </div>
            {accSel.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-panel px-3 py-2 text-xs text-mute">
                已选 {accSel.length} 个账号 · 按最不利档流转：<TierBadge tier={worst} />
                <span>{tierLabels[worst]}</span>
                {worst === "C" && (
                  <span className="flex items-center gap-1 font-semibold text-warn">
                    <AlertCircle size={13} /> 含 C 档将走人工工单
                  </span>
                )}
              </div>
            )}
            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => setStep(0)}>上一步</Button>
              <Button disabled={accSel.length === 0} onClick={() => setStep(2)}>下一步</Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <Field label="关联商品（可选 · 打通内容 → GMV 归因）">
              <Select
                value={productPick}
                options={[PRODUCT_NONE, ...seedProducts.map(productLabel)]}
                onChange={setProductPick}
              />
            </Field>
            <div className="rounded-xl border border-line bg-panel px-3 py-2.5 text-xs text-mute">
              成片「{editJobs.find((j) => j.id === editId)?.title ?? "—"}」 → {accounts.filter((a) => accSel.includes(a.id)).map((a) => a.name).join("、")}
              （{tierLabels[worst]}）· 商品「{productPick === PRODUCT_NONE ? "不关联" : productPick}」
            </div>
            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => setStep(1)}>上一步</Button>
              <Button icon={<Send size={14} />} onClick={handleCreate}>发起分发</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* C 档：回填链接 Modal */}
      <Modal open={!!backfillFor} onClose={() => setBackfillFor(null)} title={`回填发布链接 · ${backfillFor?.title ?? ""}`}>
        <Field label="平台发布链接（url）">
          <input
            className={inputCls}
            value={backfillUrl}
            placeholder="如 https://www.xiaohongshu.com/explore/xxxx"
            onChange={(e) => setBackfillUrl(e.target.value)}
          />
        </Field>
        <p className="mt-3 text-xs text-mute">
          C 档人工出口：回填后工单转「已发布」，GMV 归因按平台表计算，并即时挂 1 个种子指标点（看板卡完播 sparkline 随之出现）。
        </p>
        <div className="mt-5 flex justify-end gap-3">
          <Button variant="ghost" onClick={() => setBackfillFor(null)}>取消</Button>
          <Button disabled={!backfillUrl.trim()} onClick={confirmBackfill}>确认回填</Button>
        </div>
      </Modal>

      {/* 收件箱：驳回回复（原因写页级审计） */}
      <Modal open={!!rejectFor} onClose={() => setRejectFor(null)} title="驳回 AI 回复">
        <Field label="驳回原因">
          <input
            className={inputCls}
            value={rejectReason}
            placeholder="说明驳回原因，便于回复口径调整…"
            onChange={(e) => setRejectReason(e.target.value)}
          />
        </Field>
        <p className="mt-3 text-xs text-mute">驳回语义 = 撤出审批流、回落到待回复池转人工（原因已记入审计流水）。</p>
        <div className="mt-5 flex justify-end gap-3">
          <Button variant="ghost" onClick={() => setRejectFor(null)}>取消</Button>
          <Button variant="outline" onClick={confirmRejectMsg}>确认驳回</Button>
        </div>
      </Modal>

      {/* toast 栈：全部可手动 ✕ 关闭 */}
      <div className="pointer-events-none fixed bottom-6 right-6 z-[60] flex w-[min(92vw,380px)] flex-col gap-2">
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className={`pointer-events-auto flex items-start gap-2.5 rounded-2xl border border-line bg-panel/95 p-3.5 text-sm shadow-[0_0_24px_rgba(0,0,0,0.5)] backdrop-blur ${
              t.tone === "warn" ? "border-l-2 border-l-warn" : "border-l-2 border-l-neon"
            }`}
          >
            {t.tone === "warn"
              ? <AlertCircle size={16} className="mt-0.5 shrink-0 text-warn" />
              : <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-neon" />}
            <span className="min-w-0 flex-1">{t.msg}</span>
            <button
              type="button"
              aria-label="关闭通知"
              onClick={() => dismissToast(t.id)}
              className="focus-ring shrink-0 rounded-lg p-1 text-mute hover:bg-white/5 hover:text-ink"
            >
              <X size={14} />
            </button>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
