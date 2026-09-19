// 活跃时段热力图（/distribute「建议发布时段」、/insights「受众与回流」共用）：
// 行=周一~周日，列=9~23 点每 2h，值 0-100 直接映射霓虹绿透明度；>80 标 ★ 黄金档。
const ROWS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const COLS = [9, 11, 13, 15, 17, 19, 21, 23];
const GOLD = 80;
const LEGEND = [0.1, 0.3, 0.5, 0.7, 0.95];
// 跨零点的尾时刻补零：23 → "23:00–01:00"（否则 "23:00–1:00" 读数不对称）
const slotLabel = (h: number) => `${h}:00–${String((h + 2) % 24).padStart(2, "0")}:00`;

export function SlotHeatmap({ grid }: { grid: number[][] }) {
  return (
    <div>
      <div className="grid gap-1" style={{ gridTemplateColumns: "2.2rem repeat(8, minmax(0, 1fr))" }}>
        <span aria-hidden />
        {COLS.map((h) => (
          <span key={h} className="tnum pb-0.5 text-center text-[10px] text-mute">{h}</span>
        ))}
        {grid.map((row, r) => (
          <RowCells key={r} row={row} label={ROWS[r] ?? `第 ${r + 1} 行`} />
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[10px] text-mute">
        <span>冷门</span>
        {LEGEND.map((o) => (
          <span key={o} className="h-3 w-6 rounded" style={{ background: `rgba(0,255,153,${o})` }} />
        ))}
        <span>热门</span>
        <span className="ml-1 text-warn">★ 黄金档（活跃指数 &gt;{GOLD}）</span>
      </div>
    </div>
  );
}

// 一行 = 行标签 + 8 个格子（CSS Grid 要求子节点扁平，故整行由本组件产出）
function RowCells({ row, label }: { row: number[]; label: string }) {
  // 渲染前把整行强制为 COLS.length 格：缺值 → undefined 渲染空格占位，超列截断。
  // 不定长时扁平子节点会让后续整行错位（阶梯漂移 / 换行级联）。
  const cells: (number | undefined)[] = Array.from({ length: COLS.length }, (_, c) => row[c]);
  return (
    <>
      <span className="flex items-center text-[10px] text-mute">{label}</span>
      {cells.map((value, c) => {
        if (value === undefined) {
          return <div key={c} aria-hidden title={`${label} ${slotLabel(COLS[c])} · 无数据`} className="h-7 rounded-md" />;
        }
        const alpha = Math.max(0, Math.min(100, value)) / 100;
        return (
          <div
            key={c}
            title={`${label} ${slotLabel(COLS[c])} · 活跃指数 ${value}`}
            className="tnum relative flex h-7 items-center justify-center rounded-md text-[10px]"
            style={{ background: `rgba(0,255,153,${alpha})`, color: alpha > 0.55 ? "#04110B" : "rgba(231,239,242,0.55)" }}
          >
            {value}
            {value > GOLD && <span aria-hidden className="absolute -right-0.5 -top-1 text-[9px] leading-none text-warn">★</span>}
          </div>
        );
      })}
    </>
  );
}
