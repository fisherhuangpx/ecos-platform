// /accounts 账号矩阵（spec §4.1 的前端投影）：连接向导（沿用 /stores「模拟一次授权失败可重试」骨架）/
// A/B/C 通道徽章 / 当日配额 / 矩阵组过滤 / 分组风控前置校验演示。本页本地 state（组筛选、向导开关）不共享。
import { useState } from "react";
import { motion } from "framer-motion";
import { AlertCircle, Check, RotateCcw, Unplug, UserPlus, Users } from "lucide-react";
import { Badge, Button, Card, Dot, Field, Modal, PageHeader, Progress, Select, Tabs, inputCls } from "../components/ui";
import { TierBadge } from "../components/content/kit";
import { MockBadge } from "../components/mock";
import { channelMeta, tierLabels, type ContentAccount, type Post, type PostStatus } from "../data/content";
import { nowLabel } from "../data/ecom";
import { useContent } from "../store/content";

const wizardSteps = ["选择账号", "平台授权", "挂载到矩阵"];
const groups: ContentAccount["group"][] = ["品牌号", "员工号", "垂类号"];
// 演示口径：同平台品牌号上限（真实规则见 riskBlockedAt 注释）
const BRAND_ACCOUNT_CAP_PER_PLATFORM = 3;

export default function Accounts() {
  const { accounts, posts, connectAccount, removeAccount, setAccountStatus } = useContent();
  const [tab, setTab] = useState("全部");

  // 连接向导（本地 state）
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [platform, setPlatform] = useState("douyin");
  const [name, setName] = useState("");
  const [group, setGroup] = useState<ContentAccount["group"]>("品牌号");
  const [failSim, setFailSim] = useState(false);
  const [authState, setAuthState] = useState<"idle" | "ok" | "fail">("idle");
  const [riskBlocked, setRiskBlocked] = useState(false);

  // R14/R15 口径：已发=有真实派发动作；待人工=C 档工单已占配额；真实系统读平台配额 API 的回写（seed 的静态 todayPosts 字段 UI 不信任，仅保留在类型层）。
  const todayKey = nowLabel().slice(0, 5); // "MM-DD"
  // 状态口径（R15）：草稿尚未进调度队列；失败 / 已归档按 store 语义「不产生平台写操作」→ 三者都不占当日配额。
  const noDispatchStatus: PostStatus[] = ["草稿", "失败", "已归档"];
  const dispatchedToday = (p: Post) =>
    p.createdAt.slice(0, 5) === todayKey && !noDispatchStatus.includes(p.status);
  const platformsOfPost = (p: Post) =>
    accounts.filter((a) => p.accountIds.includes(a.id)).map((a) => a.platformId);
  // 卡片口径（R14 有意为之）：按平台交集匹配 —— 同平台任一工单都算这张卡的当日消耗，
  // 故一条工单可以同时出现在多个同平台账号卡上（卡片是「该账号视角的压力」，不是账本）。
  const todayPostsOf = (a: ContentAccount) =>
    posts.filter((p) => dispatchedToday(p) && platformsOfPost(p).includes(a.platformId)).length;

  const connected = accounts.filter((a) => a.status === "已连接").length;
  const expired = accounts.filter((a) => a.status === "授权过期").length;
  // R15：统计卡按「去重后的工单条数」计 —— 一条工单无论被矩阵内多少个同平台账号共享都只算 1 条，
  // 不再用逐卡求和（旧口径会被同平台账号数放大 N 倍，出现「今日已发 18 / 总配额 15」）。
  const usedToday = posts.filter((p) => dispatchedToday(p) && platformsOfPost(p).length > 0).length;
  const quotaTotal = accounts.reduce((s, a) => s + a.dailyQuota, 0);
  // R15：占比封顶 100%（配额耗尽后 Progress 不再溢出，满额由 warn 色表达）
  const quotaPct = quotaTotal ? Math.min(100, Math.round((usedToday / quotaTotal) * 100)) : 0;

  const meta = channelMeta[platform];
  const platformOptions = Object.entries(channelMeta).map(([id, m]) => ({ id, label: `${m.name}（${id}）` }));
  const platformLabel = `${meta.name}（${platform}）`;

  // 矩阵风控前置校验（页面前置演示口径）：真实规则（同平台品牌号上限 / 审批例外）在连接器风控服务，
  // 生产环境由 connectAccount 网关侧统一判定，此处仅为可走查的拦截提示。
  const riskBlockedAt = (platformId: string, g: ContentAccount["group"]) =>
    g === "品牌号" &&
    accounts.filter((a) => a.platformId === platformId && a.group === "品牌号").length >= BRAND_ACCOUNT_CAP_PER_PLATFORM;

  const reset = () => {
    setStep(0); setPlatform("douyin"); setName(""); setGroup("品牌号");
    setFailSim(false); setAuthState("idle"); setRiskBlocked(false);
  };
  const openWizard = () => { reset(); setOpen(true); };

  const shown = tab === "全部" ? accounts : accounts.filter((a) => a.group === tab);

  return (
    <div>
      <PageHeader
        title="账号矩阵"
        sub="内容平台托管 · A/B/C 发布通道徽章 · 日配额与分组风控"
        actions={
          <div className="flex items-center gap-3">
            <MockBadge />
            <Button icon={<UserPlus size={15} />} onClick={openWizard}>接入新账号</Button>
          </div>
        }
      />

      {/* 顶部 3 张统计卡 */}
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Card className="flex flex-col gap-1.5">
          <span className="text-sm text-mute">已连接</span>
          <div className="flex items-baseline gap-2">
            <span className="font-display text-3xl font-bold tnum text-neon">{connected}</span>
            <span className="text-xs text-mute">/ 矩阵共 {accounts.length} 个账号</span>
          </div>
        </Card>
        <Card className="flex flex-col gap-1.5">
          <span className="text-sm text-mute">授权过期</span>
          <div className="flex items-baseline gap-2">
            <span className={`font-display text-3xl font-bold tnum ${expired ? "text-warn" : "text-ink"}`}>{expired}</span>
            <span className="text-xs text-mute">重新授权即可恢复发布</span>
          </div>
        </Card>
        <Card className="flex flex-col gap-1.5">
          <span className="text-sm text-mute">今日已发配额占比</span>
          <div className="flex items-baseline gap-2">
            <span className="font-display text-3xl font-bold tnum text-[#b7b1ff]">{quotaPct}%</span>
            <span className="text-xs text-mute">今日已发 {usedToday} / 总配额 {quotaTotal} 条</span>
          </div>
          <Progress value={quotaPct} tone={quotaPct >= 100 ? "warn" : "accent"} />
        </Card>
      </div>

      <Tabs items={["全部", ...groups]} active={tab} onChange={setTab} />

      {accounts.length === 0 ? (
        <Card className="flex flex-col items-center py-16 text-center">
          <Users size={40} className="mb-3 text-mute" />
          <h3 className="text-lg font-semibold">还没有托管的内容账号</h3>
          <p className="mt-1 max-w-sm text-sm text-mute">点「接入新账号」完成平台授权，账号将按 A/B/C 通道档位进入矩阵。</p>
          <Button className="mt-5" icon={<UserPlus size={15} />} onClick={openWizard}>接入第 1 个账号</Button>
        </Card>
      ) : shown.length === 0 ? (
        <Card className="py-10 text-center text-sm text-mute">
          「{tab}」组还没有账号，点右上角「接入新账号」或在上方切回「全部」。
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {shown.map((a, i) => {
            const m = channelMeta[a.platformId];
            const today = todayPostsOf(a);
            const pct = a.dailyQuota ? Math.min(100, Math.round((today / a.dailyQuota) * 100)) : 0;
            return (
              <motion.div key={a.id} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
                <Card hover className="flex h-full flex-col gap-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2.5">
                      {/* 渠道色点（ring 描边：深色品牌色如抖音 #141414 在暗卡上也可辨） */}
                      <span
                        aria-hidden
                        className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-white/25"
                        style={{ background: m.color, boxShadow: `0 0 8px ${m.color}` }}
                      />
                      <div className="min-w-0">
                        <div className="truncate font-semibold">{a.name}</div>
                        <div className="text-xs text-mute">{m.name} · 加入于 {a.addedAt}</div>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      <TierBadge tier={a.tier} />
                      <span className="flex items-center gap-1.5 text-[11px] text-mute">
                        {a.status === "已连接" ? <Dot tone="neon" pulse /> : <Dot tone="warn" />}
                        {a.status}
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone="accent">{a.group}</Badge>
                    {a.personaTags.map((t) => (
                      <span key={t} className="rounded-full border border-line bg-white/5 px-2 py-0.5 text-[10px] text-mute">{t}</span>
                    ))}
                  </div>

                  <div className="mt-auto space-y-1.5">
                    <Progress value={pct} tone={pct >= 100 ? "warn" : "neon"} label={`今日已发 ${today} / ${a.dailyQuota}`} />
                    <div className="flex gap-2">
                      {a.status === "已连接" ? (
                        <>
                          <Button variant="ghost" className="flex-1" onClick={() => setAccountStatus(a.id, "授权过期")}>模拟过期</Button>
                          <Button variant="ghost" className="flex-1" icon={<Unplug size={13} />} onClick={() => removeAccount(a.id)}>断开</Button>
                        </>
                      ) : (
                        <Button className="flex-1" icon={<RotateCcw size={14} />} onClick={() => setAccountStatus(a.id, "已连接")}>重新授权</Button>
                      )}
                    </div>
                  </div>
                </Card>
              </motion.div>
            );
          })}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="接入内容账号向导">
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
            {/* 平台选项来自 channelMeta 键（brief 口径） */}
            <Field label="平台">
              <Select
                value={platformLabel}
                options={platformOptions.map((o) => o.label)}
                onChange={(label) => {
                  const hit = platformOptions.find((o) => o.label === label);
                  if (hit) setPlatform(hit.id);
                  setRiskBlocked(false);
                }}
              />
            </Field>
            <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-panel p-3 text-xs text-mute">
              <TierBadge tier={meta.tier} />
              <span>{tierLabels[meta.tier]} · {meta.limits}</span>
            </div>
            <Field label="账号名称">
              <input
                className={inputCls}
                value={name}
                placeholder={`如：蓝海优品·${meta.short}`}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field label="矩阵分组">
              <div className="grid grid-cols-3 gap-2">
                {groups.map((g) => (
                  <button
                    key={g}
                    onClick={() => { setGroup(g); setRiskBlocked(false); }}
                    className={`focus-ring rounded-xl border px-3 py-2 text-sm transition-colors ${group === g ? "border-neon/60 bg-neon/8 font-semibold text-neon" : "border-line bg-panel text-mute hover:border-neon/30 hover:text-ink"}`}
                  >
                    {g}
                    {g === "品牌号" && riskBlockedAt(platform, g) && <span className="ml-1 text-[10px] text-warn">已满</span>}
                  </button>
                ))}
              </div>
            </Field>
            <div className="flex justify-end">
              <Button disabled={!name.trim()} onClick={() => setStep(1)}>下一步</Button>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-3">
            <p className="text-sm text-mute">模拟跳转到 {meta.name} 授权页 · 通道档位「{tierLabels[meta.tier]}」，授权后按该通道调度发布。</p>
            <label className="flex items-center gap-2 text-sm text-mute">
              <input type="checkbox" checked={failSim} onChange={(e) => setFailSim(e.target.checked)} className="accent-[#00ff99]" />
              模拟授权失败（回调超时）以演示重试路径
            </label>
            <div className="rounded-2xl border border-line bg-panel p-4">
              {riskBlocked ? (
                <div className="flex items-start gap-2 text-sm text-warn">
                  <AlertCircle size={16} className="mt-0.5 shrink-0" />
                  <div>
                    矩阵风控：同平台品牌号上限 3，走审批例外
                    <div className="mt-1 text-xs text-mute">页面演示级拦截（真实规则在连接器风控服务）；可返回上一步改矩阵分组或平台。</div>
                  </div>
                </div>
              ) : authState === "fail" ? (
                <div className="flex items-start gap-2 text-sm text-warn">
                  <AlertCircle size={16} className="mt-0.5 shrink-0" />
                  <div>授权失败：平台回调超时。已保留你选择的平台与分组，可直接重试，不会从头再来。</div>
                </div>
              ) : (
                <div className="text-sm">授权页（模拟）：账号「lanhai@example.com」 · 允许「蓝海优品」读取并发布 {meta.name} 内容账号「{name.trim()}」</div>
              )}
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="ghost" onClick={() => { setStep(0); setAuthState("idle"); setRiskBlocked(false); }}>上一步</Button>
              <Button disabled={riskBlocked} onClick={() => {
                // Minor-A：分支顺序与面板一致 —— 风控拦截先判，否则「勾选失败模拟 + 同平台品牌号已满」时
                // 点击只在面板看不见的地方翻转 authState，形成静默死循环（按钮也永远显示不出「授权（会失败）」）。
                if (riskBlockedAt(platform, group)) { setRiskBlocked(true); return; }
                if (authState === "fail") { setAuthState("idle"); return; }
                if (failSim) { setAuthState("fail"); return; }
                setAuthState("ok"); setStep(2);
              }}>
                {failSim && authState === "idle" && !riskBlocked ? "授权（会失败）" : "完成授权"}
              </Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <div className="rounded-2xl border border-neon/25 bg-neon/5 p-4 text-sm">
              授权成功！「{name.trim()}」将以 {meta.name} · {tierLabels[meta.tier]} 挂载到「{group}」组，审计已记录本次连接。
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="ghost" onClick={() => { setStep(1); setAuthState("idle"); }}>返回</Button>
              <Button
                icon={<Check size={15} />}
                onClick={() => {
                  if (connectAccount(platform, name.trim(), group)) setOpen(false);
                }}
              >
                挂载到矩阵
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
