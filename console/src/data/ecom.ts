// AGP 电商运营平台 · 静态可信 mock 数据（纯前端演示用）

export type StoreStatus = "connected" | "expired" | "disconnected";

export interface PlatformMeta {
  name: string;
  short: string;
  color: string;
  scope: string[];
}

export const platformMeta: Record<string, PlatformMeta> = {
  taobao: { name: "淘宝 / 天猫", short: "淘宝", color: "#FF8C42", scope: ["商品", "订单", "评价"] },
  tmall: { name: "天猫", short: "天猫", color: "#FF0036", scope: ["商品", "订单", "评价"] },
  pdd: { name: "拼多多", short: "拼多多", color: "#E33E3E", scope: ["商品", "订单", "售后"] },
  douyin: { name: "抖音小店", short: "抖音", color: "#141414", scope: ["商品", "订单", "内容"] },
  jd: { name: "京东", short: "京东", color: "#E1251B", scope: ["商品", "订单"] },
  amazon: { name: "Amazon", short: "亚马逊", color: "#FF9900", scope: ["商品", "订单", "评论"] },
  shopify: { name: "Shopify", short: "Shopify", color: "#95BF47", scope: ["商品", "订单"] },
  tiktok: { name: "TikTok Shop", short: "TikTok", color: "#38bdf8", scope: ["商品", "订单", "内容"] },
};

export const enabledStorePlatforms = ["taobao", "douyin", "pdd", "jd", "amazon", "shopify", "tiktok"];

/** 后端平台码可能超出本地表：兜底防整页崩溃（渲染边界防御）。 */
export const metaOf = (platformId: string): PlatformMeta =>
  platformMeta[platformId] ?? { name: platformId, short: platformId, color: "#8fa3ad", scope: [] };

export interface Store {
  id: string;
  platformId: string;
  name: string;
  status: StoreStatus;
  addedAt: string;
  products: number;
  orders7d: number;
}

export const seedStores: Store[] = [];

export interface Product {
  id: string;
  name: string;
  price: number;
  platformId: string;
  storeId?: string;
  category: string;
  sales7d: number;
  trend: "up" | "down" | "flat";
  conv: number;
  rating: number;
  reviewNote: string;
}

export const seedProducts: Product[] = [];

export interface Favorite {
  id: string;
  name: string;
  source: string;
  heat: number;
  price: string;
}

export interface ResearchCandidate {
  id: string;
  name: string;
  platform: string;
  monthlySales: string;
  price: string;
  keywords: string[];
  heat: number;
}

export function researchForCategory(category: string): ResearchCandidate[] {
  const base = [
    { suffix: "热销款（基础型）", platform: "淘宝", price: "29-59", keys: ["实用", "性价比", "售后少"] },
    { suffix: "升级款（旗舰型）", platform: "淘宝", price: "79-129", keys: ["材质好", "颜值高", "复购"] },
    { suffix: "直播引流款", platform: "抖音", price: "19-49", keys: ["视觉冲击", "话术好讲", "客单低"] },
    { suffix: "高佣分销款", platform: "拼多多", price: "9-25", keys: ["走量", "低价心智", "退货率中"] },
    { suffix: "跨境潜力款", platform: "Amazon", price: "18-35 USD", keys: ["review 少", "搜索增长", "合规简单"] },
    { suffix: "内容种草款", platform: "小红书", price: "69-159", keys: ["场景感", "图文笔记", "颜值溢价"] },
  ];
  return base.map((b, i) => ({
    id: `rc-${i}-${category.length}`,
    name: `${category}${b.suffix}`,
    platform: b.platform,
    monthlySales: `${[3200, 1800, 5200, 8600, 1400, 2100][i]} 件/月`,
    price: b.price,
    keywords: b.keys,
    heat: [78, 64, 88, 71, 55, 66][i],
  }));
}

export interface Insight {
  title: string;
  point: string;
  evidence: string;
  action: string;
}

export const analyticsSeries = [42, 58, 51, 76, 69, 88, 82, 97, 91, 108, 96, 121, 134, 141];

export interface StudioVariant {
  id: string;
  label: string;
  bg: string;
  fg: string;
  accent: string;
}

export const studioVariants: StudioVariant[] = [
  { id: "v1", label: "纯净白底", bg: "linear-gradient(135deg,#ffffff,#eef1f4)", fg: "#1a1a1a", accent: "#00b377" },
  { id: "v2", label: "碳黑科技", bg: "linear-gradient(135deg,#0b141b,#162b38)", fg: "#e7eff2", accent: "#00ff99" },
  { id: "v3", label: "暖光生活", bg: "linear-gradient(135deg,#f7e6cf,#f2d9b8)", fg: "#5a3a1a", accent: "#cc785c" },
];

export const stylePresets = [
  { id: "s1", label: "简约白底", selling: ["三合一快充", "2 米线长"] },
  { id: "s2", label: "卖点标签", selling: ["磁吸稳固", "多设备同充"] },
  { id: "s3", label: "场景图", selling: ["车载通勤", "随手即充"] },
];

export interface Draft {
  id: string;
  title: string;
  price: number;
  sellingPoints: string[];
  imageLabel: string;
  source: string;
  createdAt: string;
}

export const seedDrafts: Draft[] = [];

export const publishPlatformOptions = ["taobao", "douyin", "pdd", "amazon"];

export function complianceFor(title: string, platforms: string[]): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  platforms.forEach((p) => {
    const issues: string[] = [];
    if (p === "douyin") {
      if (title.length > 26) issues.push("抖音标题超限（≤26 字）");
      if (!title.includes("快充") && !title.includes("支架")) issues.push("建议标题前 10 字含核心卖点");
    }
    if (p === "amazon") {
      issues.push("缺少 UPC/EAN 商品编码");
      if (title.length > 40) issues.push("Amazon 标题建议 ≤40 字");
    }
    if (p === "pdd") {
      if (title.length > 20) issues.push("拼多多标题建议 ≤20 字");
    }
    if (p === "taobao") {
      if (issues.length === 0) issues.push("需确认主图 ≥800px 白底");
    }
    if (issues.length === 0) issues.push("合规校验通过");
    map[p] = issues;
  });
  return map;
}

export interface AssetTypeInfo {
  label: string;
  color: string;
}

export const assetTypes: Record<string, AssetTypeInfo> = {
  logo: { label: "Logo", color: "#6C63FF" },
  swatch: { label: "色卡", color: "#00FF99" },
  model: { label: "模特图", color: "#FF8C42" },
  main: { label: "主图", color: "#38bdf8" },
  doc: { label: "文档", color: "#8fa3ad" },
};

export interface AssetVersion {
  v: string;
  by: string;
  at: string;
  note: string;
}

export interface Asset {
  id: string;
  name: string;
  type: keyof typeof assetTypes;
  tags: string[];
  size: string;
  versions: AssetVersion[];
  refs: { task: string; at: string }[];
  color?: string;
  letter?: string;
}

export const seedAssets: Asset[] = [];

export interface Connector {
  id: string;
  name: string;
  category: "电商平台" | "自动剪辑" | "内容渠道" | "执行引擎";
  status: "未安装" | "已安装" | "授权过期";
  read: string[];
  write: string[];
  risk: "低" | "中" | "高";
  desc: string;
  note: string;
  tier?: import("./content").ChannelTier;
}

export const seedConnectors: Connector[] = [];

export interface Audit {
  id: string;
  time: string;
  user: string;
  action: string;
  target: string;
  level: "写入" | "高危" | "只读" | "系统";
  result: string;
}

export const seedAudits: Audit[] = [];

export interface TaskResult {
  platformId: string;
  status: "成功" | "打回";
  reason?: string;
}

export type TaskStatus = "待审批" | "运行中" | "成功" | "部分失败" | "已停止" | "失败" | "排队中" | "已驳回";

export interface Task {
  id: string;
  kind: string;
  title: string;
  status: TaskStatus;
  stepIndex: number;
  steps: string[];
  target: string;
  startedAt: string;
  approver?: string;
  results?: TaskResult[];
}

export const seedTasks: Task[] = [];

export const roleUsers = ["陈晨", "林芳", "沈默"];

export const nowLabel = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export const uid = (p: string) => `${p}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1000)}`;

// ─── Phase 2 · Story 9 · OpenCut 自动剪辑 ───

export type EditingStatus = "排队中" | "剪辑中" | "待审核" | "已发布" | "已驳回" | "失败";

export interface PlatformAdaptation {
  platformId: string;
  aspectRatio: string;
  duration: string;
  copy: string;
  ready: boolean;
}

export interface EditingTask {
  id: string;
  title: string;
  assetNames: string[];
  provider: "OpenCut" | "OpenMontage";
  template: string;
  status: EditingStatus;
  adaptations: PlatformAdaptation[];
  createdAt: string;
  completedAt?: string;
  approver?: string;
  rejectReason?: string;
  queuePosition?: number;
  queueEta?: string;
  // v2 · EditPlan 流水线（spec §5.1），由 store/content.tsx 读写
  plan?: import("./content").EditPlan;
  trigger?: import("./content").EditTrigger;
  engine?: import("./content").EngineId;
  sourceTaskId?: string;      // 二创血缘 parent（= 本类型 id）
  awaitingPlanApproval?: boolean;
  planApprovedAt?: string;
  fallbackUsed?: boolean;     // agentic 失败 → FFmpeg 保底
  reeditRule?: string;        // 命中规则名（换钩子/剪短/换封面）
}

export const editingTemplates = [
  { id: "et-1", label: "商品展示 · 15s", desc: "快节奏产品展示，适合抖音/快手" },
  { id: "et-2", label: "场景种草 · 30s", desc: "场景化叙事，适合小红书/种草" },
  { id: "et-3", label: "卖点拆解 · 20s", desc: "核心卖点逐条展示，适合详情页视频" },
];

export const seedEditingTasks: EditingTask[] = [
  {
    id: "ed-1", title: "快充数据线 · 商品展示视频", assetNames: ["蓝海优品 Logo（新版）", "快充数据线 历史主图"],
    provider: "OpenCut", template: "商品展示 · 15s", status: "已发布",
    adaptations: [
      { platformId: "douyin", aspectRatio: "9:16", duration: "15s", copy: "三合一磁吸快充 | 一线搞定", ready: true },
      { platformId: "xiaohongshu", aspectRatio: "1:1", duration: "15s", copy: "桌面理线神器 ✨ 三合一磁吸", ready: true },
    ],
    createdAt: "09-01 14:20", completedAt: "09-01 14:38", approver: "林芳",
  },
  {
    id: "ed-2", title: "防晒冰袖 · 场景种草视频", assetNames: ["新品 · 白底模特图", "品牌主色 · 深海蓝"],
    provider: "OpenMontage", template: "场景种草 · 30s", status: "待审核",
    adaptations: [
      { platformId: "douyin", aspectRatio: "9:16", duration: "28s", copy: "UPF50+ 冰感防晒 | 夏日必备", ready: true },
      { platformId: "xiaohongshu", aspectRatio: "1:1", duration: "30s", copy: "出门不怕晒 ❄️ 冰袖凉感实测", ready: true },
    ],
    createdAt: "09-02 09:40", completedAt: "09-02 10:15", approver: "林芳",
  },
  {
    id: "ed-3", title: "车载支架 · 卖点拆解视频", assetNames: ["蓝海优品 Logo（新版）"],
    provider: "OpenCut", template: "卖点拆解 · 20s", status: "剪辑中",
    adaptations: [
      { platformId: "douyin", aspectRatio: "9:16", duration: "—", copy: "", ready: false },
      { platformId: "xiaohongshu", aspectRatio: "1:1", duration: "—", copy: "", ready: false },
    ],
    createdAt: "09-02 11:02", queuePosition: 2, queueEta: "约 8 分钟",
  },
];

// ─── Phase 2 · Story 10 · AI 售后归因 ───

export type AttributionType = "物流" | "质量" | "尺码" | "错发" | "其他";
export type SuggestionType = "自助解决" | "回复草稿" | "建议退款";
export type TicketStatus = "待分析" | "分析中" | "待审批" | "已发出" | "已驳回";

export interface AfterSalesTicket {
  id: string;
  orderId: string;
  customer: string;
  platformId: string;
  productName: string;
  complaint: string;
  attribution: AttributionType | null;
  confidence: number;
  suggestion: SuggestionType | null;
  replyDraft: string;
  refundAmount?: number;
  status: TicketStatus;
  createdAt: string;
  approvedAt?: string;
  rejectReason?: string;
  rejectFeedback?: string;
}

export const seedTickets: AfterSalesTicket[] = [];

export interface WeeklyReport {
  period: string;
  totalTickets: number;
  resolved: number;
  resolutionRate: number;
  adoptionRate: number;
  avgResponseTime: string;
  attributionBreakdown: { name: string; count: number; color: string }[];
  topIssues: { issue: string; count: number; trend: "up" | "down" | "flat" }[];
}

export const weeklyReport: WeeklyReport = {
  period: "08-26 ~ 09-01",
  totalTickets: 47,
  resolved: 38,
  resolutionRate: 80.9,
  adoptionRate: 72.3,
  avgResponseTime: "23 分钟",
  attributionBreakdown: [
    { name: "物流", count: 16, color: "#38bdf8" },
    { name: "质量", count: 12, color: "#FF8C42" },
    { name: "尺码", count: 9, color: "#6C63FF" },
    { name: "错发", count: 6, color: "#E33E3E" },
    { name: "其他", count: 4, color: "#8fa3ad" },
  ],
  topIssues: [
    { issue: "磁吸端松动", count: 8, trend: "up" },
    { issue: "快递超时", count: 7, trend: "down" },
    { issue: "尺码偏差", count: 6, trend: "flat" },
    { issue: "颜色发错", count: 4, trend: "up" },
    { issue: "包装破损", count: 3, trend: "down" },
  ],
};

// ─── v2 · 执行引擎连接器（spec §5.1 降级链：OpenMontage → OpenCut → FFmpeg） ───

export const seedEngines: Connector[] = [
  { id: "en-openmontage", name: "OpenMontage 蒙太奇", category: "执行引擎", status: "已安装", read: ["任务状态"], write: ["创建渲染任务"], risk: "低", desc: "agentic 成片主力，独立容器 HTTP 服务化接入（AGPLv3 进程隔离）。", note: "EngineAdapter · 能力:分镜→成片" },
  { id: "en-opencut", name: "OpenCut 剪辑引擎", category: "执行引擎", status: "未安装", read: ["任务状态"], write: ["创建渲染任务"], risk: "低", desc: "第二 agentic 引擎，防单一供应商锁定。", note: "EngineAdapter · 能力:分镜→成片" },
  { id: "en-ffmpeg", name: "FFmpeg 保底渲染", category: "执行引擎", status: "已安装", read: [], write: ["裁剪/画幅/字幕/拼接"], risk: "低", desc: "确定性操作兜底与二创局部重做，零许可风险。", note: "进程内 · 降级链终点" },
];
