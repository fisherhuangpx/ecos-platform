// 发布排期日历（/distribute 日历视图）：窗口数据锚定且自适应（起点 = min(今天, 最早工单)，
// 长度覆盖 max(今天, 最晚工单)，且不小于 days），故 seed 工单与新建工单、今天必然同屏可现；
// 格内按 scheduledAt 命中的工单落 tier 色点，今天描霓虹绿，点击回调 postId（页面侧跳到工单卡）。
import { tierLabels, type ChannelTier, type Post } from "../../data/content";

const tierDot: Record<ChannelTier, string> = { A: "#00FF99", B: "#FF8C42", C: "#8FA3AD" };
const weekdayCn = ["日", "一", "二", "三", "四", "五", "六"];
const pad = (n: number) => String(n).padStart(2, "0");
const dateKey = (d: Date) => `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const timeOf = (scheduledAt: string) => scheduledAt.slice(6); // "MM-DD HH:mm" → "HH:mm"
const DAY_MS = 86_400_000;
// scheduledAt 无年份：一律按当年解析（与本文件既有的 "MM-DD 命中当日" 口径同源）。
// 回读校验防脏串撑爆窗口："13-99" 会被 Date 顺延成次年 04-09，回读 key 不符即不参与定窗。
const monthDayToStamp = (key: string, year: number): number | undefined => {
  if (!/^\d{2}-\d{2}$/.test(key)) return undefined;
  const d = new Date(year, Number(key.slice(0, 2)) - 1, Number(key.slice(3, 5)));
  return d.getFullYear() === year && dateKey(d) === key ? d.getTime() : undefined;
};

export function PostCalendar({
  posts, days = 7, onSelect,
}: {
  posts: Post[]; days?: number; onSelect?: (postId: string) => void;
}) {
  const now = new Date();
  const todayKey = dateKey(now); // 今天判定 = cell.key === dateKey(new Date())（窗口锚到数据后，今天不再是固定第 0 格）
  const year = now.getFullYear();
  const stamps = [monthDayToStamp(todayKey, year)]
    .concat(posts.map((p) => monthDayToStamp(p.scheduledAt.slice(0, 5), year)))
    .filter((s): s is number => s !== undefined); // 今天恒合法 → 数组非空
  const base = new Date(Math.min(...stamps)); // 窗口起点 = min(今年今天, 最早工单日)
  const last = Math.max(...stamps); // 窗口终点 = max(今年今天, 最晚工单日)，故 seed / 新工单 / 今天三者同屏
  const length = Math.max(days, Math.round((last - base.getTime()) / DAY_MS) + 1); // 自适应长度，且不小于 days（+1 含首尾）
  const cells = Array.from({ length }, (_, i) => {
    const date = new Date(base);
    date.setDate(base.getDate() + i);
    const key = dateKey(date);
    const dayPosts = posts
      .filter((p) => p.scheduledAt.slice(0, 5) === key)
      .sort((a, b) => timeOf(a.scheduledAt).localeCompare(timeOf(b.scheduledAt)));
    return { key, date, dayPosts, isToday: key === todayKey };
  });

  return (
    <div className="grid grid-cols-7 gap-2">
      {cells.map((cell, i) => (
        <div
          key={`${i}-${cell.key}`}
          className={`min-h-[76px] rounded-xl border p-1.5 ${
            cell.isToday ? "border-neon/60 bg-neon/5" : "border-line bg-panel/60"
          }`}
        >
          <div className={`flex items-baseline justify-between text-[10px] ${cell.isToday ? "text-neon" : "text-mute"}`}>
            <span className="tnum font-medium">{cell.key}</span>
            <span aria-hidden>周{weekdayCn[cell.date.getDay()]}</span>
          </div>
          <div className="mt-1.5 space-y-1">
            {cell.dayPosts.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onSelect?.(p.id)}
                title={`${p.scheduledAt} · ${p.title}（${tierLabels[p.tier]}）`}
                className="focus-ring flex w-full items-center gap-1.5 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-white/5"
              >
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: tierDot[p.tier], boxShadow: `0 0 8px ${tierDot[p.tier]}` }}
                />
                <span className="tnum min-w-0 truncate text-[10px] text-ink/70">{timeOf(p.scheduledAt)}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
