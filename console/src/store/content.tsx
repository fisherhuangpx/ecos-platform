// 内容域状态层（spec §4/§5/§6 的前端投影）：账号矩阵 / 分发工单状态机 / EditPlan 流水线 / 回流二创 / 竞品监听 / 粉丝互动 / 助手意图路由。
// 挂载说明：ContentProvider 位于 EcomProvider 内层，复用其 audit —— 所有用户动作写操作 100% 可审计（原型红线）。
// v2 流水线写路径自 ecom store "平移"至本文件：editJobs 为独立 state（seed 3 条映射补 v2 字段 + ed-4 二创血缘节点），
// ecom 侧旧 createEditingTask 保留不删（Task 9 切页面数据源后再停用）。
// Task 7 追加唯一成员：pullSignals（竞品信号「立即拉取」同步只读演示，reserveSignals 池放行，契约 26+1）。
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  seedEditingTasks, analyticsSeries, nowLabel, uid,
  type EditingTask,
} from "../data/ecom";
import {
  seedAccounts, seedPosts, seedInsights, seedWatches, seedSignals, reserveSignals, seedMessages,
  channelMeta, tierLabels, examplePlan, hotSlots, reeditRuleFor,
  type ContentAccount, type ContentInsight, type CompetitorSignal, type CompetitorWatch,
  type ChannelTier, type EditPlan, type EditTrigger, type EngineId,
  type InteractionMsg, type Post, type PostMetricPoint,
} from "../data/content";
import { useEcom } from "./ecom";

export interface AssistantAnswer {
  kind: "chart" | "table" | "action" | "text";
  title: string; text: string; chart?: { type: "area"; data: number[] };
  actionTaskId?: string; // kind=action 时新建的待审批任务
}
export interface ContentCtx {
  accounts: ContentAccount[]; posts: Post[]; insights: ContentInsight[];
  watches: CompetitorWatch[]; signals: CompetitorSignal[]; messages: InteractionMsg[];
  editJobs: EditingTask[];               // v2 流水线视图数据源（含 seed 3 条 + 新建）
  hotspots: number[][];
  connectAccount: (platformId: string, name: string, group: ContentAccount["group"]) => boolean;
  removeAccount: (id: string) => void; setAccountStatus: (id: string, s: ContentAccount["status"]) => void;
  createPost: (editTaskId: string, accountIds: string[], productId?: string) => string; // tier=账号中最高档；排队后自动流转：A→发布中→已发布(2.2s/4s)；B→待人工(需发布包)；C→待人工
  exportPublishPack: (postId: string) => void;   // B 档：标记"发布包已导出"并 toast 化文案
  backfillPublish: (postId: string, url: string) => void; // C 档回填 → 已发布 + attributed 计算 + 种子指标
  cancelPost: (postId: string) => void;
  pullMetrics: (postId?: string) => number;      // 模拟回流：补当日点，返回命中二创规则数
  startEditJob: (title: string, assetNames: string[], engine: EngineId, template: string, trigger: EditTrigger, sourceTaskId?: string) => string;
  approvePlan: (jobId: string) => void; rejectPlan: (jobId: string, reason: string) => void;
  approveJob: (jobId: string) => void;  rejectJob: (jobId: string, reason: string) => void;
  decomposeViral: (url: string) => ContentInsight;   // 爆款拆解 → 新 Insight（kind=爆款拆解 复用 in 结构）
  suggestReedit: (postId: string) => string;          // 依 reeditRuleFor 生成二创 job（kind 二创, FFmpeg, trigger 回流规则），返回 jobId
  addWatch: (name: string, t: CompetitorWatch["targetType"], platformId: string, cadence: "每日" | "每周") => void;
  toggleWatch: (id: string) => void;
  pullSignals: () => CompetitorSignal | null; // 立即拉取（演示）：从 reserveSignals 池随机放行 1 条进 signals；池空 ⇒ null + 「信号池已空」审计（只读）
  replyMessage: (id: string) => void;    // 白名单(咨询/好评)直接 已回复；投诉→待审批
  approveMessage: (id: string) => void;  rejectMessage: (id: string) => void;
  askAssistant: (q: string) => AssistantAnswer;
}

// ── seed：ecom 侧 3 条剪辑任务映射补 v2 字段 + 追加二创血缘示范节点（Task 9 会按 provider/status 规则给 ed-3 置 fallbackUsed） ──
const seedEditingTasksV2: EditingTask[] = [
  ...seedEditingTasks.map((t) => ({ ...t, engine: t.provider as EngineId, trigger: "手动" as EditTrigger, plan: examplePlan })),
  { // 二创血缘示范：ed-1 的换钩子版本，待审核（任务13 演示闭环的后半段）
    id: "ed-4", title: "快充数据线 · 换钩子版 v2", assetNames: ["快充数据线 历史主图"],
    provider: "OpenCut", template: "商品展示 · 15s", status: "待审核",
    adaptations: [{ platformId: "douyin", aspectRatio: "9:16", duration: "15s", copy: "三合一磁吸快充 | 3秒看懂", ready: true }],
    createdAt: "09-02 09:00", completedAt: "09-02 09:20",
    engine: "FFmpeg", trigger: "回流规则", sourceTaskId: seedEditingTasks[0].id, reeditRule: "换钩子", plan: examplePlan, fallbackUsed: false,
  },
];

// ── 纯工具 ──
const tierRank: Record<ChannelTier, number> = { A: 0, B: 1, C: 2 };
// 多账号取"最不利档"决定流转（含 C 即走人工通道）；空账号列表由 createPost 上游直接拒绝（不再兜底成 A 档幽灵工单）
const worstTier = (tiers: ChannelTier[]): ChannelTier =>
  tiers.reduce<ChannelTier>((worst, t) => (tierRank[t] > tierRank[worst] ? t : worst), "A");

// 归因边界（spec §4.5）： douyin/tiktok=full；youtube/bilibili=partial；其余 none。多账号取可达最好档
const attributedFor = (platformIds: string[]): Post["attributed"] => {
  if (platformIds.some((p) => p === "douyin" || p === "tiktok")) return "full";
  if (platformIds.some((p) => p === "youtube" || p === "bilibili")) return "partial";
  return "none";
};

const rand = (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1));
const rand1 = (min: number, max: number) => Math.round((min + Math.random() * (max - min)) * 10) / 10;
const mockUrl = (platformId: string, id: string) =>
  platformId === "douyin" ? `https://v.douyin.com/mock-${id.slice(-4)}` : `https://${platformId || "channel"}.example.com/video/mock-${id.slice(-4)}`;
const hostOf = (url: string) => url.replace(/^https?:\/\//, "").split("/")[0] || url;

// C 档回填种子指标（brief 口径：views 1200-1800 · completion 30-45 · ctr 2-4）
const backfillPoint = (): PostMetricPoint => ({
  date: nowLabel(), views: rand(1200, 1800), completion: rand(30, 45), ctr: rand1(2, 4),
});

// ── 模拟回流"当日点"（R10：剧本化 + 当日幂等，命中不得漂移） ──
// 日期两侧统一 slice(0,5) → "MM-DD"（Minor-B：backfill 点带时刻 "09-19 10:24" 也按当日归一比较）。
// 剧本（randomness 只留在不需要命中规则的地方）：
//  1) 未命中 & 当日无点 → 剧本首点 completion 33-42（≥33 给第二点预留算术空间）· ctr ≥2.5 不误触发规则；
//  2) 未命中 & 当日已有点（首点或 C 档回填点，completion ≥25）→ 剧本第二点 = 断崖：
//     completion = max(5, min(24, prev - rand(12,18))) ⇒ 恒 ≤24 < 25 且降幅 ≥12（> 规则阈值 8）⇒ reeditRuleFor 必返「换钩子」；ctr ≤ 1.9 与剧本口径一致；
//  3) 已命中帖 → 当日已有点则原样不动（旧实现第二次拉取会被 max(4,·) 把降幅磨成 3-6 而脱钩）；
//     未有点则补延续断崖点保持命中，completion < 13 时无法再保证降幅 ≥8，同样不动（宁可不漂移）。
const refluxFirstPoint = (prev: PostMetricPoint | undefined, today: string): PostMetricPoint => ({
  date: today,
  views: Math.max(600, Math.round((prev?.views ?? 1500) * rand1(0.85, 1.15))),
  completion: rand(33, 42),
  ctr: rand1(2.5, 4),
});
const refluxCliffPoint = (prev: PostMetricPoint, today: string): PostMetricPoint => ({
  date: today,
  views: Math.max(200, Math.round(prev.views * 0.6)),
  completion: Math.max(5, Math.min(24, prev.completion - rand(12, 18))),
  ctr: rand1(1.0, 1.9),
});
/** 本次拉取该帖要补的当日点；null = 当日幂等跳过（状态保持不变） */
const refluxPoint = (p: Post, today: string): PostMetricPoint | null => {
  const last = p.metrics[p.metrics.length - 1];
  if (!last) return refluxFirstPoint(undefined, today);
  const hasTodayPoint = p.metrics.some((m) => m.date.slice(0, 5) === today);
  if (reeditRuleFor(p)) {
    if (hasTodayPoint || last.completion - 8 < 5) return null;
    return refluxCliffPoint(last, today);
  }
  if (!hasTodayPoint) return refluxFirstPoint(last, today);
  return last.completion >= 25 ? refluxCliffPoint(last, today) : null;
};

const Ctx = createContext<ContentCtx | null>(null);

export function ContentProvider({ children }: { children: ReactNode }): JSX.Element {
  const { audit } = useEcom();
  const [accounts, setAccounts] = useState<ContentAccount[]>(seedAccounts);
  const [posts, setPosts] = useState<Post[]>(seedPosts);
  const [insights, setInsights] = useState<ContentInsight[]>(seedInsights);
  const [watches, setWatches] = useState<CompetitorWatch[]>(seedWatches);
  const [signals, setSignals] = useState<CompetitorSignal[]>(seedSignals);
  // 竞品信号池（Task 7）：seedSignals 为已展示视图，reserveSignals 是 08:00 批量已回传、待「立即拉取」放行的存货（池 ≥3）
  const [signalPool, setSignalPool] = useState<CompetitorSignal[]>(reserveSignals);
  const [messages, setMessages] = useState<InteractionMsg[]>(seedMessages);
  const [editJobs, setEditJobs] = useState<EditingTask[]>(seedEditingTasksV2);
  const hotspots = hotSlots;

  // R11：定时器回调触发时（createPost +2.2s/+4s）useMemo closure 里的 posts 已过期，
  // 用 ref 镜像"渲染后最新工单行"，跃迁前先读回当前 status 再决定 状态+审计 是否同源下发，
  // 状态不匹配（如已被 cancelPost 归档）只补一条降级审计，不再伪装成功跃迁。
  const postsRef = useRef(posts);
  useEffect(() => {
    postsRef.current = posts;
  }, [posts]);

  const value = useMemo<ContentCtx>(() => {
    // ── 账号矩阵 ──
    const connectAccount: ContentCtx["connectAccount"] = (platformId, name, group) => {
      const meta = channelMeta[platformId];
      if (!meta) return false;
      const quotaByTier: Record<ChannelTier, number> = { A: 5, B: 3, C: 2 };
      const account: ContentAccount = {
        id: uid("ca"), platformId, name, group, personaTags: [],
        tier: meta.tier, status: "已连接", dailyQuota: quotaByTier[meta.tier], todayPosts: 0,
        addedAt: nowLabel().slice(0, 5),
      };
      setAccounts((prev) => [...prev, account]);
      audit({ user: "林芳", action: `连接内容账号 · ${meta.name}`, target: name, level: "系统", result: `授权成功 · ${tierLabels[meta.tier]} · 日配额 ${quotaByTier[meta.tier]} 条` });
      return true;
    };
    const removeAccount: ContentCtx["removeAccount"] = (id) => {
      setAccounts((prev) => prev.filter((a) => a.id !== id));
      audit({ user: "林芳", action: "断开内容账号", target: id, level: "系统", result: "已断开 · 可随时重新授权" });
    };
    const setAccountStatus: ContentCtx["setAccountStatus"] = (id, s) => {
      setAccounts((prev) => prev.map((a) => (a.id === id ? { ...a, status: s } : a)));
      audit({ user: "林芳", action: "账号状态变更", target: id, level: "系统", result: `已置为 ${s}` });
    };

    // ── 分发工单状态机（A 直发 / B 发布包 / C 人工回填） ──
    const platformIdsOf = (p: Post) =>
      accounts.filter((a) => p.accountIds.includes(a.id)).map((a) => a.platformId);

    const createPost: ContentCtx["createPost"] = (editTaskId, accountIds, productId) => {
      const chosen = accounts.filter((a) => accountIds.includes(a.id));
      // Minor-C：零可用账号 → 拒绝发起（旧实现会兜底成 tier=A 的"幽灵工单"并自动流转为已发布）。
      // 返回空串（契约不变：string）+ 降级审计，页面据此 toast 化提示，绝不进入调度队列。
      if (chosen.length === 0) {
        const orphan = editJobs.find((t) => t.id === editTaskId);
        audit({ user: "林芳", action: "发起分发（已拒绝）", target: orphan ? orphan.title : editTaskId, level: "系统", result: "无可用账号，发起失败 · 未创建工单 · 零平台写操作" });
        return "";
      }
      const id = uid("po");
      const tier = worstTier(chosen.map((a) => channelMeta[a.platformId]?.tier ?? "C"));
      const job = editJobs.find((t) => t.id === editTaskId);
      const post: Post = {
        id, editTaskId, title: job ? `${job.title} · ${tier} 档分发` : "内容分发工单",
        accountIds: [...accountIds], tier, scheduledAt: nowLabel(), status: "排队",
        productId, attributed: "none", metrics: [], createdAt: nowLabel(),
      };
      setPosts((prev) => [post, ...prev]);
      audit({ user: "林芳", action: `创建分发工单 · ${tierLabels[tier]}`, target: `${post.title} → ${chosen.map((a) => a.name).join("、")}`, level: "写入", result: "进入调度队列 · 等待连接器执行" });
      // 排队 → 发布中（2.2s）→ 已发布 / 待人工（4s，brief 口径 2.2s/4s）。
      // 注：与 ecom store 同口径，定时器不做清理（原型约定）。
      // R11：每次跃迁先读 postsRef 的最新行 —— 状态不匹配（已归档/已被人工出口处理）只补降级审计，
      // 状态与审计同源下发，杜绝"已归档工单收到成功审计"。updater 再带一次 guard，防并发重复跃迁。
      window.setTimeout(() => {
        const row = postsRef.current.find((p) => p.id === id);
        if (!row) return;
        if (row.status !== "排队") {
          audit({ user: "林芳", action: "工单调度器 · 跃迁取消", target: id, level: "系统", result: `当前状态 ${row.status} · 未开始执行，零平台写操作` });
          return;
        }
        setPosts((prev) => prev.map((p) => (p.id === id && p.status === "排队" ? { ...p, status: "发布中" } : p)));
        audit({ user: "林芳", action: "工单开始执行", target: id, level: "写入", result: tier === "A" ? "API 直发中" : "转人工通道中（B/C 档）" });
      }, 2200);
      window.setTimeout(() => {
        const row = postsRef.current.find((p) => p.id === id);
        if (!row) return;
        if (row.status !== "排队" && row.status !== "发布中") {
          audit({ user: "林芳", action: "工单调度器 · 跃迁取消", target: id, level: "系统", result: `当前状态 ${row.status} · 未执行发布，零平台写操作` });
          return;
        }
        const outcome: Post["status"] = tier === "A" ? "已发布" : "待人工";
        setPosts((prev) => prev.map((p) => {
          if (p.id !== id || (p.status !== "排队" && p.status !== "发布中")) return p;
          if (tier === "A") {
            const platformIds = platformIdsOf(p);
            return { ...p, status: "已发布", publishUrl: mockUrl(platformIds[0] ?? chosen[0]?.platformId ?? "", id), attributed: attributedFor(platformIds) };
          }
          return { ...p, status: "待人工" };
        }));
        audit({ user: "林芳", action: "工单执行完成", target: id, level: "写入", result: `→ ${outcome} · ${outcome === "已发布" ? "链接已回填 · 等待指标回流" : "B 档导出发布包 / C 档回填链接"}` });
      }, 4000);
      return id;
    };

    // B 档人工出口：导出发布包 → 标记"发布包 · 线下导入"式发布。toast 文案由页面（Task 5）呈现，此处 audit result 即演示口径文案。
    // R11（仿 replyMessage）：先读 closure 里的目标行，状态不是 待人工 就只出降级审计，不伪装成功、不改状态。
    const exportPublishPack: ContentCtx["exportPublishPack"] = (postId) => {
      const post = posts.find((p) => p.id === postId);
      if (!post) return;
      if (post.status !== "待人工") {
        audit({ user: "林芳", action: "导出发布包 · B 档线下导入", target: postId, level: "系统", result: `当前状态 ${post.status} · 无需导出，未执行任何写操作` });
        return;
      }
      setPosts((prev) => prev.map((p) => {
        if (p.id !== postId || p.status !== "待人工") return p;
        return { ...p, status: "已发布", publishUrl: "发布包 · 线下导入", attributed: attributedFor(platformIdsOf(p)) };
      }));
      audit({ user: "林芳", action: "导出发布包 · B 档线下导入", target: postId, level: "写入", result: "已按线下导入标记发布 · 指标随后由回流任务补挂" });
    };

    // C 档人工出口：回填链接 → 已发布 + attributed 平台查表 + 挂一个种子指标点（copy-on-write，不改动 seed 对象）。
    // R11：显式 待人工 前置校验 —— 双击回填不再追加第二个指标点，也不会把已归档帖"复活"。
    const backfillPublish: ContentCtx["backfillPublish"] = (postId, url) => {
      const post = posts.find((p) => p.id === postId);
      if (!post) return;
      if (post.status !== "待人工") {
        audit({ user: "林芳", action: "回填发布链接 · C 档人工", target: postId, level: "系统", result: `当前状态 ${post.status} · 回填忽略，不重复挂指标` });
        return;
      }
      setPosts((prev) => prev.map((p) => {
        if (p.id !== postId || p.status !== "待人工") return p;
        return { ...p, status: "已发布", publishUrl: url, attributed: attributedFor(platformIdsOf(p)), metrics: [...p.metrics, backfillPoint()] };
      }));
      audit({ user: "林芳", action: "回填发布链接 · C 档人工", target: postId, level: "写入", result: "已发布 · 归因按平台表计算 · 已挂种子指标" });
    };

    // 取消/归档：R11 先读目标行 —— 重复取消只出降级审计，状态与审计同源（result 带上原状态，便于核对跃迁被拦截）。
    // createPost 侧定时器跃迁由 postsRef 读回校验，归档后不会再补"成功"审计。
    const cancelPost: ContentCtx["cancelPost"] = (postId) => {
      const post = posts.find((p) => p.id === postId);
      if (!post) return;
      if (post.status === "已归档") {
        audit({ user: "林芳", action: "取消分发工单", target: postId, level: "系统", result: "已是归档态 · 重复取消忽略，零平台写操作" });
        return;
      }
      setPosts((prev) => prev.map((p) => (p.id === postId && p.status !== "已归档" ? { ...p, status: "已归档" } : p)));
      audit({ user: "林芳", action: "取消分发工单", target: postId, level: "写入", result: `已归档（原状态 ${post.status}）· 不产生平台写操作 · 后续调度跃迁将被拦截` });
    };

    // 模拟回流：为 已发布 工单（或指定工单）补当日点，返回 reeditRuleFor 命中数。
    // 口径：命中规则时【不】自动建二创工单/建议 —— 建议仅在页面显式点"生成二创"（suggestReedit）时产生，store 保持被动纯净。
    // R10：当日点幂等（同帖当日只推进一格剧本）→ 连点"拉取回流"命中数不漂移；Minor-A：以 updater 形式落库。
    const pullMetrics: ContentCtx["pullMetrics"] = (postId) => {
      const targets = posts.filter((p) => p.status === "已发布" && (!postId || p.id === postId));
      if (targets.length === 0) {
        audit({ user: "林芳", action: "拉取回流指标", target: postId ?? "全部已发布工单", level: "只读", result: "无可拉取对象 · 0 条" });
        return 0;
      }
      const today = nowLabel().slice(0, 5); // "MM-DD"：与 seed/backfill 点两侧归一后比较（Minor-B）
      const points = new Map<string, PostMetricPoint>();
      targets.forEach((p) => {
        const pt = refluxPoint(p, today);
        if (pt) points.set(p.id, pt);
      });
      const next = posts.map((p) => {
        const pt = points.get(p.id);
        return pt ? { ...p, metrics: [...p.metrics, pt] } : p; // 不可变追加，禁 push
      });
      const fired = next.filter((p) => targets.some((t) => t.id === p.id) && reeditRuleFor(p)).length;
      setPosts((prev) => prev.map((p) => {
        const pt = points.get(p.id);
        return pt ? { ...p, metrics: [...p.metrics, pt] } : p;
      }));
      const skipped = targets.length - points.size;
      audit({
        user: "林芳", action: "拉取回流指标 · 连接器回写", target: `${targets.length} 条已发布工单`, level: "只读",
        result: `补当日点 ${points.size} 条${skipped > 0 ? ` · ${skipped} 条当日已回流（幂等跳过）` : ""} · ${fired} 条命中二创规则`,
      });
      return fired;
    };

    // ── EditPlan 流水线（排队 → [计划闸门] → 剪辑中 → 待审核 → 已发布/已驳回） ──
    const finishJobRender = (id: string, delay: number) => {
      window.setTimeout(() => {
        setEditJobs((prev) => prev.map((t) => {
          if (t.id !== id || t.status !== "剪辑中") return t;
          return {
            ...t, status: "待审核" as const, completedAt: nowLabel(),
            adaptations: t.adaptations.map((a) => ({
              ...a, ready: true,
              duration: a.platformId === "douyin" ? "15s" : "20s",
              copy: a.platformId === "douyin" ? `${t.title.slice(0, 8)} | 新品推荐` : `${t.title.slice(0, 6)} · 种草分享`,
            })),
          };
        }));
      }, delay);
    };

    const startEditJob: ContentCtx["startEditJob"] = (title, assetNames, engine, template, trigger, sourceTaskId) => {
      const id = uid("ed");
      const fast = engine === "FFmpeg"; // FFmpeg 确定性保底：约 1.2s 直接出片；agentic 引擎走 2s 排队 + 5s 渲染
      const job: EditingTask = {
        id, title, assetNames,
        provider: engine === "FFmpeg" ? "OpenCut" : engine, // EditingTask.provider 联合类型暂无 "FFmpeg"（Task 1 遗留），engine 字段才是事实源
        template, status: "排队中",
        adaptations: [
          { platformId: "douyin", aspectRatio: "9:16", duration: "—", copy: "", ready: false },
          { platformId: "xiaohongshu", aspectRatio: "1:1", duration: "—", copy: "", ready: false },
        ],
        createdAt: nowLabel(), queuePosition: 1, queueEta: fast ? "约 1 分钟" : "约 5 分钟",
        engine, trigger, sourceTaskId, plan: examplePlan, awaitingPlanApproval: false, fallbackUsed: false,
      };
      setEditJobs((prev) => [job, ...prev]);
      audit({ user: "林芳", action: `创建剪辑任务 · ${engine}（${trigger}）`, target: title, level: "写入", result: "EditPlan 就绪 · 进入流水线" });
      window.setTimeout(() => {
        setEditJobs((prev) => prev.map((t) => {
          // 计划闸门（任务级可选开关，默认关，spec 裁定 #9）：开启时停在 排队中+awaitingPlanApproval，待 approvePlan 放行
          if (t.id !== id || t.status !== "排队中" || t.awaitingPlanApproval) return t;
          return { ...t, status: "剪辑中" as const, queuePosition: undefined, queueEta: undefined };
        }));
      }, fast ? 400 : 2000);
      finishJobRender(id, fast ? 1200 : 5000); // guard 只放行 剪辑中 态；计划闸门下此定时器空转，由 approvePlan 重新挂链
      return id;
    };

    const approvePlan: ContentCtx["approvePlan"] = (jobId) => {
      setEditJobs((prev) => prev.map((t) => (t.id === jobId ? {
        ...t, awaitingPlanApproval: false, planApprovedAt: nowLabel(), status: "剪辑中" as const, queuePosition: undefined, queueEta: undefined,
      } : t)));
      audit({ user: "林芳", action: "批准 EditPlan · 派发引擎", target: jobId, level: "写入", result: "计划闸门通过 · 开始渲染" });
      finishJobRender(jobId, 3000);
    };
    const rejectPlan: ContentCtx["rejectPlan"] = (jobId, reason) => {
      setEditJobs((prev) => prev.map((t) => (t.id === jobId ? { ...t, status: "已驳回" as const, awaitingPlanApproval: false, rejectReason: reason } : t)));
      audit({ user: "林芳", action: "驳回 EditPlan", target: jobId, level: "写入", result: `已驳回 · ${reason}` });
    };
    // 成片审批：对齐既有 approveEditingVideo 语义 —— 已发布 + approver 林芳
    const approveJob: ContentCtx["approveJob"] = (jobId) => {
      setEditJobs((prev) => prev.map((t) => (t.id === jobId ? { ...t, status: "已发布" as const, approver: "林芳" } : t)));
      audit({ user: "林芳", action: "审批成片 · 已发布", target: jobId, level: "写入", result: "确认发布 · 已同步到平台" });
    };
    const rejectJob: ContentCtx["rejectJob"] = (jobId, reason) => {
      setEditJobs((prev) => prev.map((t) => (t.id === jobId ? { ...t, status: "已驳回" as const, rejectReason: reason } : t)));
      audit({ user: "林芳", action: "驳回成片", target: jobId, level: "写入", result: `已驳回 · ${reason}` });
    };

    // 爆款拆解（spec §3.2）：贴链接 → 拆解洞察（复用 ContentInsight 结构，kind=爆款拆解）；纯只读分析
    const decomposeViral: ContentCtx["decomposeViral"] = (url) => {
      const insight: ContentInsight = {
        id: uid("in"), kind: "爆款拆解",
        conclusion: `爆款「${hostOf(url)}」拆解：前 3 秒卖点直给 + 倒计时字幕 + 价格锚点收尾`,
        evidence: [`来源：${url}`, "分镜结构 4 镜 · 平均 3.8s/镜", "钩子类型：卖点直给（与 in-1 归因结论一致）"],
        confidence: 78 + Math.floor(Math.random() * 10),
        action: "已在 /editing 生成可复用「爆款模板」触发入口，一键转 EditPlan",
        deepLink: "/editing", createdAt: nowLabel(),
      };
      setInsights((prev) => [insight, ...prev]);
      audit({ user: "林芳", action: "爆款拆解 · 视频理解", target: url, level: "只读", result: "产出拆解洞察 · 零平台写操作" });
      return insight;
    };

    // 回流 → 二创：依 reeditRuleFor 生成子任务（FFmpeg · trigger 回流规则），复制 parent 的 plan 并换首镜字幕（copy-on-write）
    const suggestReedit: ContentCtx["suggestReedit"] = (postId) => {
      const post = posts.find((p) => p.id === postId);
      if (!post) return "";
      const hit = reeditRuleFor(post);
      if (!hit) return ""; // 未命中规则不建任务（页面仅在命中时亮出"生成二创"按钮）
      const parent = editJobs.find((t) => t.id === post.editTaskId);
      const parentPlan: EditPlan = parent?.plan ?? examplePlan;
      const plan: EditPlan = { ...parentPlan, shots: parentPlan.shots.map((s, i) => (i === 0 ? { ...s, subtitle: "3 秒卖点直给" } : s)) };
      const id = uid("ed");
      const job: EditingTask = {
        id, title: `${post.title} · ${hit.rule}版`, assetNames: parent?.assetNames ?? ["回流二创 · 源成片素材"],
        provider: "OpenCut", template: parent?.template ?? "商品展示 · 15s",
        status: "待审核", // NOTE: 跳过排队/渲染时长直接进成片审批 —— 压缩演示链路（brief 既定口径）
        adaptations: (parent?.adaptations ?? [{ platformId: "douyin", aspectRatio: "9:16", duration: "15s", copy: "", ready: false }]).map((a) => ({ ...a, ready: true })),
        createdAt: nowLabel(), completedAt: nowLabel(),
        engine: "FFmpeg", trigger: "回流规则", sourceTaskId: post.editTaskId, reeditRule: hit.rule, plan, fallbackUsed: false,
      };
      setEditJobs((prev) => [job, ...prev]);
      audit({ user: "林芳", action: `回流规则命中 · 生成二创任务（${hit.rule}）`, target: `${postId} ← ${post.editTaskId}`, level: "写入", result: `${hit.detail} · 已进成片审批闸门` });
      return id;
    };

    // ── 竞品情报（仅公开数据 + 速率限制，零平台写操作） ──
    const addWatch: ContentCtx["addWatch"] = (name, t, platformId, cadence) => {
      const watch: CompetitorWatch = { id: uid("wa"), targetType: t, name, platformId, cadence, active: true };
      setWatches((prev) => [...prev, watch]);
      audit({ user: "林芳", action: `新增竞品监听 · ${t}`, target: name, level: "系统", result: `${cadence}批量拉取 · 仅公开数据 + 速率限制` });
    };
    const toggleWatch: ContentCtx["toggleWatch"] = (id) => {
      setWatches((prev) => prev.map((w) => (w.id === id ? { ...w, active: !w.active } : w)));
      const w = watches.find((x) => x.id === id);
      audit({ user: "林芳", action: w?.active ? "暂停竞品监听" : "恢复竞品监听", target: id, level: "系统", result: w?.active ? "调度器已停 · 不再抓取" : "已恢复 · 按频率批量抓取" });
    };
    // 「立即拉取」演示口径：从 08:00 批量回传的池内随机放行 1 条 → signals 追加（不可变，禁 push）；
    // 池空 ⇒ 不改状态，只落一条「信号池已空」诚实审计。同步只读动作，无定时器（postsRef 类护栏不适用）。
    const pullSignals: ContentCtx["pullSignals"] = () => {
      if (signalPool.length === 0) {
        audit({ user: "林芳", action: "立即拉取竞品信号", target: "竞品信号池", level: "只读", result: "信号池已空 · 本轮无新批次回传，放行 0 条" });
        return null;
      }
      const sig = signalPool[Math.floor(Math.random() * signalPool.length)]!;
      const rest = signalPool.filter((x) => x.id !== sig.id);
      setSignalPool(rest);
      setSignals((prev) => [...prev, sig]);
      audit({ user: "林芳", action: "立即拉取竞品信号 · 批量调度演示", target: `监听对象 ${sig.watchId}`, level: "只读", result: `放行 1 条（${sig.type}）· 池内剩余 ${rest.length} 条 · 仅公开数据 + 速率限制` });
      return sig;
    };

    // ── 粉丝互动（回复是写操作：白名单直发，投诉进审批闸门，spec §4.3-4） ──
    const replyMessage: ContentCtx["replyMessage"] = (id) => {
      const m = messages.find((x) => x.id === id);
      if (!m) return;
      const whitelist = m.intent === "咨询" || m.intent === "好评";
      setMessages((prev) => prev.map((x) => (x.id === id ? { ...x, status: whitelist ? "已回复" as const : "待审批" as const } : x)));
      audit(whitelist
        ? { user: "林芳", action: "AI 回复发出 · 白名单直发", target: id, level: "写入", result: `已回复（${m.intent}）· 计入周报` }
        : { user: "林芳", action: "AI 回复转审批", target: id, level: "写入", result: "投诉类敏感 · 进入审批闸门" });
    };
    const approveMessage: ContentCtx["approveMessage"] = (id) => {
      setMessages((prev) => prev.map((x) => (x.id === id ? { ...x, status: "已回复" as const } : x)));
      audit({ user: "林芳", action: "审批回复 · 已发出", target: id, level: "写入", result: "回复已发送 · 计入周报" });
    };
    // InteractionMsg 状态联合无"已驳回"（Task 1 定），驳回语义 = 撤出审批流、回落到待回复池转人工
    const rejectMessage: ContentCtx["rejectMessage"] = (id) => {
      setMessages((prev) => prev.map((x) => (x.id === id ? { ...x, status: "待回复" as const } : x)));
      audit({ user: "林芳", action: "驳回回复", target: id, level: "写入", result: "已驳回 · 回落待回复池转人工" });
    };

    // ── 助手意图路由表（brief 精确实现；抽屉只做渲染） ──
    const askAssistant: ContentCtx["askAssistant"] = (q) => {
      const intent: { test: RegExp; build: () => AssistantAnswer }[] = [
        { test: /本周|周报|这周/, build: () => ({ kind: "chart", title: "本周 GMV 走势", text: "本周 GMV 12.4 万，环比 +9%；内容渠道贡献 18%（数据源：指标层 metrics.weekly_gmv）。", chart: { type: "area", data: analyticsSeries } }) },
        { test: /完播|留存/, build: () => ({ kind: "chart", title: "完播率对比", text: "「卖点直给」开头平均 3 秒留存 61%，“场景引入” 50%。建议新视频换钩子。", chart: { type: "area", data: [38, 36, 33, 31, 27, 24, 19] } }) },
        { test: /剪|视频|出片/, build: () => {
          const jobId = startEditJob("助手快剪 · 快充数据线 商品展示", ["快充数据线 历史主图", "蓝海优品 Logo（新版）"], "OpenMontage", "商品展示 · 15s", "手动");
          return { kind: "action", title: "已生成剪辑任务（待审批）", text: "按“商品展示·15s”模板创建了剪辑任务，进入审批闸门，批准后自动派发引擎。", actionTaskId: jobId };
        } },
        // 发布意图（brief 尾注 + 工作口径）：不建假任务 —— 纯文案引导去 /distribute 真实发起，避免过度承诺
        { test: /发|投放|排期/, build: () => ({ kind: "text", title: "发布排期 · 请到分发中枢发起", text: "依据受众活跃热力图，今晚 19:30 · 抖音官方号是黄金档。发布工单请在「分发中枢 /distribute」选片+选号创建（A 档 API 直发、B/C 档人工出口），助手不代造跨平台写任务。" }) },
        { test: /竞品|对手/, build: () => ({ kind: "table", title: "竞品异动 Top3", text: "线象旗舰店改价 +38% 销量代理、内容化提速、上新低价 SKU。见竞品情报页。" }) },
      ];
      const hit = intent.find((i) => i.test.test(q));
      return hit
        ? hit.build()
        : { kind: "text", title: "暂未理解", text: "我可以帮你：看周报 / 对比完播率 / 发起剪辑 / 安排发布 / 查竞品。" };
    };

    return {
      accounts, posts, insights, watches, signals, messages, editJobs, hotspots,
      connectAccount, removeAccount, setAccountStatus,
      createPost, exportPublishPack, backfillPublish, cancelPost, pullMetrics,
      startEditJob, approvePlan, rejectPlan, approveJob, rejectJob,
      decomposeViral, suggestReedit,
      addWatch, toggleWatch, pullSignals,
      replyMessage, approveMessage, rejectMessage,
      askAssistant,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts, posts, insights, watches, signals, signalPool, messages, editJobs]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useContent(): ContentCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useContent 必须在 ContentProvider 内使用");
  return ctx;
}
