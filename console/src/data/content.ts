// 内容域 & 洞察域 mock 数据（spec §4/§5/§6 的前端投影）
import { nowLabel, uid } from "./ecom";

export type ChannelTier = "A" | "B" | "C";

export interface ChannelMeta {
  name: string; short: string; color: string; tier: ChannelTier;
  limits: string; // 展示用能力摘要，对应真实世界 capability descriptor
}

export const channelMeta: Record<string, ChannelMeta> = {
  douyin:     { name: "抖音", short: "抖音", color: "#141414", tier: "A", limits: "9:16 · ≤60s · 标题≤26字" },
  kuaishou:   { name: "快手", short: "快手", color: "#FF5000", tier: "B", limits: "9:16 · ≤57s · 发布包导入" },
  shipinhao:  { name: "视频号", short: "视频号", color: "#07C160", tier: "C", limits: "1:1/9:16 · ≤60s · 人工发布" },
  bilibili:   { name: "B站", short: "B站", color: "#FB7299", tier: "A", limits: "16:9/9:16 · 投稿API" },
  xiaohongshu:{ name: "小红书", short: "小红书", color: "#FF2442", tier: "C", limits: "3:4/9:16 · ≤1000字文案 · 人工发布" },
  wechat_mp:  { name: "公众号", short: "公众号", color: "#4CB050", tier: "C", limits: "图文 · 人工发布" },
  tiktok:     { name: "TikTok", short: "TikTok", color: "#38bdf8", tier: "A", limits: "9:16 · ≤10min · Content Posting API" },
  youtube:    { name: "YouTube Shorts", short: "YT", color: "#FF0000", tier: "A", limits: "9:16 · ≤60s · Data API" },
  instagram:  { name: "Instagram Reels", short: "IG", color: "#C13584", tier: "B", limits: "9:16 · ≤90s · 辅助导入" },
};

export const tierLabels: Record<ChannelTier, string> = { A: "A · API 直发", B: "B · 发布包辅助", C: "C · 人工工单" };

// ── 账号矩阵 ──
export interface ContentAccount {
  id: string; platformId: string; name: string;
  group: "品牌号" | "员工号" | "垂类号";
  personaTags: string[]; tier: ChannelTier;
  status: "已连接" | "授权过期";
  dailyQuota: number; todayPosts: number; addedAt: string;
}
export const seedAccounts: ContentAccount[] = [
  { id: "ca-1", platformId: "douyin", name: "蓝海优品官方号", group: "品牌号", personaTags: ["3C实测", "新品首发"], tier: "A", status: "已连接", dailyQuota: 5, todayPosts: 1, addedAt: "08-15" },
  { id: "ca-2", platformId: "xiaohongshu", name: "蓝海好物日记", group: "垂类号", personaTags: ["桌面美学", "种草"], tier: "C", status: "已连接", dailyQuota: 2, todayPosts: 0, addedAt: "08-22" },
  { id: "ca-3", platformId: "shipinhao", name: "蓝海优品·视频号", group: "品牌号", personaTags: ["品牌向"], tier: "C", status: "授权过期", dailyQuota: 2, todayPosts: 0, addedAt: "07-30" },
  { id: "ca-4", platformId: "tiktok", name: "Blueseas Gear", group: "垂类号", personaTags: ["EDC", "gadget"], tier: "A", status: "已连接", dailyQuota: 4, todayPosts: 2, addedAt: "09-01" },
];

// ── 分发工单 ──
export type PostStatus = "草稿" | "排队" | "发布中" | "待人工" | "已发布" | "失败" | "已归档";
export interface PostMetricPoint { date: string; views: number; completion: number; ctr: number; } // completion: 完播率%
export interface Post {
  id: string; editTaskId: string; title: string; accountIds: string[];
  tier: ChannelTier; scheduledAt: string; status: PostStatus;
  publishUrl?: string; productId?: string;
  attributed: "full" | "partial" | "none";
  metrics: PostMetricPoint[]; createdAt: string;
}
export const seedPosts: Post[] = [
  { // 闭环剧本主角：A 档已发布满 3 天 + 完播率断崖 → 二创规则命中
    id: "po-1", editTaskId: "ed-1", title: "快充数据线 · 商品展示视频", accountIds: ["ca-1"],
    tier: "A", scheduledAt: "09-01 19:30", status: "已发布", publishUrl: "https://v.douyin.com/mock-abc",
    productId: "p-1", attributed: "full",
    metrics: [
      { date: "09-02", views: 4200, completion: 38, ctr: 3.1 },
      { date: "09-03", views: 2600, completion: 33, ctr: 2.4 },
      { date: "09-04", views: 1500, completion: 19, ctr: 1.6 },
    ], createdAt: "09-01 15:10",
  },
  { // C 档人工：待回填链接
    id: "po-2", editTaskId: "ed-2", title: "防晒冰袖 · 场景种草视频", accountIds: ["ca-2"],
    tier: "C", scheduledAt: "09-02 12:00", status: "待人工", productId: "p-4", attributed: "none",
    metrics: [], createdAt: "09-02 10:30",
  },
  { id: "po-3", editTaskId: "ed-1", title: "快充数据线 · TikTok EDC 版", accountIds: ["ca-4"],
    tier: "A", scheduledAt: "09-02 20:10", status: "排队", productId: "p-1", attributed: "partial",
    metrics: [], createdAt: "09-02 11:20" },
];

// ── 回流 → 二创规则（spec §5.3 的前端投影，唯一判定入口） ──
export function reeditRuleFor(post: Post): { rule: string; detail: string } | null {
  if (post.status !== "已发布" || post.metrics.length < 2) return null;
  const last = post.metrics[post.metrics.length - 1];
  const prev = post.metrics[post.metrics.length - 2];
  if (last.completion < 25 && last.completion - prev.completion <= -8)
    return { rule: "换钩子", detail: `完播率跌至 ${last.completion}%（前日 ${prev.completion}%），第 3 秒断崖` };
  if (last.ctr < 2 && post.metrics.every((m) => m.ctr < 2.5))
    return { rule: "换封面", detail: `CTR 连续低位（最新 ${last.ctr}%）` };
  return null;
}

// ── EditPlan（spec §5.1 一等公民） ──
export type EngineId = "OpenMontage" | "OpenCut" | "FFmpeg";
export type EditTrigger = "手动" | "爆款模板" | "回流规则" | "选品结论";
export interface StoryboardShot { idx: number; seconds: number; visual: string; subtitle: string; voiceover: string; }
export interface EditPlan { hook: string; bgm: string; shots: StoryboardShot[]; }
export const examplePlan: EditPlan = {
  hook: "前3秒：一根线同时点亮手机+平板+耳机", bgm: "轻快电子 120bpm",
  shots: [
    { idx: 1, seconds: 3, visual: "特写：三设备同时吸附磁接头", subtitle: "一线三充", voiceover: "还在翻包找线？" },
    { idx: 2, seconds: 5, visual: "车载场景：出风口取放", subtitle: "通勤即充", voiceover: "上车即充，下车即走" },
    { idx: 3, seconds: 4, visual: "白底旋转产品展示 1.2m 线长", subtitle: "磁吸收纳不打结", voiceover: "1.2 米，收纳只要一圈" },
    { idx: 4, seconds: 3, visual: "价格牌+促销标", subtitle: "限时 59", voiceover: "现在只要 59" },
  ],
};

// ── 洞察（Insight 对象结构 = spec §3 总原则） ──
export interface ContentInsight {
  id: string; kind: "归因" | "爆款拆解" | "时段推荐" | "异动";
  conclusion: string; evidence: string[]; confidence: number;
  action: string; deepLink: string; createdAt: string;
}
export const seedInsights: ContentInsight[] = [
  { id: "in-1", kind: "归因", conclusion: "「卖点直给型」钩子的 3 秒留存比“场景引入型”高 21%",
    evidence: ["近 14 天 9 条视频", "po-1 完播断崖 vs po-3 上升", "第 3 秒留存曲线对比"], confidence: 87,
    action: "新视频前 3 秒改为卖点直给", deepLink: "/editing", createdAt: "09-02 08:30" },
  { id: "in-2", kind: "归因", conclusion: "小红书「桌面美学」标签内容 CTR 均值最高（4.2%）",
    evidence: ["ca-2 近 7 篇数据", "同素材跨平台对比"], confidence: 81,
    action: "冰袖素材追加“工位改造”选题", deepLink: "/insights", createdAt: "09-02 08:31" },
  { id: "in-3", kind: "异动", conclusion: "竞品「线象旗舰店」上新磁吸线 45.9 元，低于我方 13 元",
    evidence: ["wa-1 每日抓取", "价格代理指标"], confidence: 93,
    action: "评估跟价或强化“三合一”差异化卖点", deepLink: "/competitors", createdAt: "09-02 07:55" },
];

// 活跃时段矩阵：行=周一~周日，列=9/11/13/15/17/19/21/23 点，值 0-100
export const hotSlots: number[][] = [
  [22, 35, 41, 38, 45, 66, 88, 74],
  [25, 33, 44, 40, 48, 71, 92, 69],
  [21, 36, 42, 39, 47, 68, 90, 72],
  [24, 34, 45, 41, 50, 73, 95, 78],
  [28, 39, 48, 46, 55, 79, 97, 85],
  [42, 47, 52, 55, 60, 82, 99, 91],
  [45, 49, 54, 57, 62, 80, 96, 88],
];

// ── 竞品情报 ──
export interface CompetitorWatch { id: string; targetType: "店铺" | "账号"; name: string; platformId: string; cadence: "每日" | "每周"; active: boolean; }
export interface CompetitorSignal { id: string; watchId: string; type: "上新" | "改价" | "销量代理" | "内容化动向"; detail: string; detectedAt: string; matchedProduct?: string; }
export const seedWatches: CompetitorWatch[] = [
  { id: "wa-1", targetType: "店铺", name: "线象旗舰店", platformId: "taobao", cadence: "每日", active: true },
  { id: "wa-2", targetType: "账号", name: "线象数码测评", platformId: "douyin", cadence: "每日", active: true },
  { id: "wa-3", targetType: "店铺", name: "UAG京东自营", platformId: "jd", cadence: "每周", active: false },
];
export const seedSignals: CompetitorSignal[] = [
  { id: "sg-1", watchId: "wa-1", type: "改价", detail: "磁吸快充线降至 45.9（原价 55），带动销量代理 +38%", detectedAt: "09-02 07:55", matchedProduct: "p-1" },
  { id: "sg-2", watchId: "wa-2", type: "内容化动向", detail: "近 7 天发布 5 条短视频（此前月均 2 条），起用“实测倒计时”模板", detectedAt: "09-02 07:56" },
  { id: "sg-3", watchId: "wa-1", type: "上新", detail: "新增 SKU：双 Type-C 短线 19.9，销量 30 天破千", detectedAt: "09-01 08:02" },
];

// 未展示信号池（Task 7）：08:00 批量调度已回传、待「立即拉取」逐条放行的存货 —— pullSignals 每次随机放行 1 条进 signals 视图。
export const reserveSignals: CompetitorSignal[] = [
  { id: "sg-4", watchId: "wa-1", type: "改价", detail: "磁吸快充线追加限时券再降 3 元（到手 42.9），创历史低价", detectedAt: "09-02 08:00", matchedProduct: "p-1" },
  { id: "sg-5", watchId: "wa-2", type: "销量代理", detail: "「实测倒计时」模板视频挂车引流，店铺同款销量代理周环比 +52%", detectedAt: "09-02 08:00" },
  { id: "sg-6", watchId: "wa-3", type: "内容化动向", detail: "UAG 京东自营开通短视频挂车，新品页同步 3 条场景视频", detectedAt: "09-02 08:00" },
];

// 信号类型 → 徽章色（Task 7 /competitors 与 Task 12 /research 列共用；放本文件以免页面互 import 成环）
export const signalTone: Record<CompetitorSignal["type"], "warn" | "danger" | "accent" | "neon"> =
  { 改价: "danger", 上新: "warn", 销量代理: "accent", 内容化动向: "neon" };

// ── 粉丝互动 ──
export interface InteractionMsg {
  id: string; accountId: string; platformId: string; author: string; text: string;
  intent: "咨询" | "好评" | "投诉"; replyDraft: string; status: "待回复" | "待审批" | "已回复"; createdAt: string;
}
export const seedMessages: InteractionMsg[] = [
  { id: "im-1", accountId: "ca-1", platformId: "douyin", author: "数码小白", text: "这个能充笔记本吗？", intent: "咨询",
    replyDraft: "亲，55W PD 款可以给支持 Type-C 充电的笔记本供电哦～", status: "待回复", createdAt: "09-02 10:12" },
  { id: "im-2", accountId: "ca-1", platformId: "douyin", author: "momo", text: "广告吧，肯定虚标", intent: "投诉",
    replyDraft: "支持实测，虚标包退，还有 7 天无理由～", status: "待审批", createdAt: "09-02 10:40" },
];
