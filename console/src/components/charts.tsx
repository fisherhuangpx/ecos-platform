import { motion } from "framer-motion";

export function AreaChart({ data, color = "#00FF99", height = 120 }: { data: number[]; color?: string; height?: number }) {
  const w = 320;
  const max = Math.max(...data) * 1.15;
  const pts = data.map((v, i) => [(i / (data.length - 1)) * w, height - (v / max) * height]);
  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const area = `${line} L${w},${height} L0,${height} Z`;
  const id = `g-${color.replace("#", "")}`;
  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="w-full" role="img" aria-label="用量趋势图">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <motion.path
        d={area}
        fill={`url(#${id})`}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8, delay: 0.3 }}
      />
      <motion.path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth="2.5"
        strokeLinecap="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 1.1, ease: "easeOut" }}
      />
      {pts.slice(-1).map((p, i) => (
        <motion.circle
          key={i}
          cx={p[0]}
          cy={p[1]}
          r="4"
          fill={color}
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 1.1 }}
        />
      ))}
    </svg>
  );
}

export function HBars({ items }: { items: { name: string; v: number; color: string }[] }) {
  const max = Math.max(...items.map((i) => i.v));
  return (
    <div className="space-y-3.5">
      {items.map((it, idx) => (
        <div key={it.name}>
          <div className="mb-1 flex justify-between text-xs">
            <span className="text-mute">{it.name}</span>
            <span className="tnum text-ink/80">{it.v.toLocaleString()}</span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-white/6">
            <motion.div
              className="h-full rounded-full"
              style={{ background: `linear-gradient(90deg, ${it.color}, ${it.color}88)` }}
              initial={{ width: 0 }}
              animate={{ width: `${(it.v / max) * 100}%` }}
              transition={{ duration: 0.9, delay: idx * 0.1, ease: [0.22, 1, 0.36, 1] }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export function Donut({ value, size = 96, color = "#00FF99", label }: { value: number; size?: number; color?: string; label: string }) {
  const r = size / 2 - 7;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,0.08)" strokeWidth="7" fill="none" />
        <motion.circle
          cx={size / 2} cy={size / 2} r={r}
          stroke={color} strokeWidth="7" fill="none" strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - value / 100) }}
          transition={{ duration: 1, ease: "easeOut" }}
        />
      </svg>
      <div className="absolute text-center">
        <div className="font-display text-lg font-bold tnum" style={{ color }}>{value}%</div>
        <div className="text-[10px] text-mute">{label}</div>
      </div>
    </div>
  );
}
