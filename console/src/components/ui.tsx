import { motion } from "framer-motion";
import type { ReactNode } from "react";

export function Card({ children, className = "", hover = false }: { children: ReactNode; className?: string; hover?: boolean }) {
  return (
    <div
      className={`glass rounded-card p-6 ${hover ? "transition-colors hover:border-neon/30" : ""} ${className}`}
    >
      {children}
    </div>
  );
}

const badgeTones: Record<string, string> = {
  neon: "bg-neon/10 text-neon border-neon/25",
  accent: "bg-accent/15 text-[#b7b1ff] border-accent/30",
  warn: "bg-warn/10 text-warn border-warn/25",
  danger: "bg-danger/10 text-danger border-danger/25",
  mute: "bg-white/5 text-mute border-white/10",
};

export function Badge({ tone = "mute", children }: { tone?: keyof typeof badgeTones; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${badgeTones[tone]}`}>
      {children}
    </span>
  );
}

export function Dot({ tone = "neon", pulse = false }: { tone?: "neon" | "warn" | "danger" | "mute"; pulse?: boolean }) {
  const c = { neon: "bg-neon", warn: "bg-warn", danger: "bg-danger", mute: "bg-mute" }[tone];
  return (
    <span className="relative inline-flex h-2 w-2">
      {pulse && <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-50 ${c}`} />}
      <span className={`relative inline-flex h-2 w-2 rounded-full ${c}`} />
    </span>
  );
}

export function Button({
  children, variant = "primary", className = "", onClick, icon, disabled = false,
}: {
  children: ReactNode; variant?: "primary" | "ghost" | "outline"; className?: string; onClick?: () => void; icon?: ReactNode; disabled?: boolean;
}) {
  const base = "focus-ring inline-flex h-10 items-center justify-center gap-2 rounded-2xl px-4 text-sm font-semibold transition-transform active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100";
  const v = {
    primary: "bg-gradient-to-r from-neon to-neondeep text-[#04110b] shadow-[0_0_24px_rgba(0,255,153,0.25)]",
    ghost: "text-mute hover:text-ink hover:bg-white/5",
    outline: "border border-line text-ink hover:border-neon/40 hover:text-neon",
  }[variant];
  return (
    <button onClick={onClick} disabled={disabled} className={`${base} ${v} ${className}`}>
      {icon}{children}
    </button>
  );
}

export function PageHeader({ title, sub, actions }: { title: string; sub?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {sub && <p className="mt-1 text-sm text-mute">{sub}</p>}
      </div>
      {actions && <div className="flex items-center gap-3">{actions}</div>}
    </div>
  );
}

export function Progress({ value, tone = "neon", label }: { value: number; tone?: "neon" | "accent" | "warn"; label?: string }) {
  const c = { neon: "from-neon to-neondeep", accent: "from-accent to-[#8f89ff]", warn: "from-warn to-[#ffb27d]" }[tone];
  return (
    <div>
      {label && <div className="mb-1.5 flex justify-between text-xs text-mute"><span>{label}</span><span className="tnum">{value}%</span></div>}
      <div className="h-2 overflow-hidden rounded-full bg-white/8">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${value}%` }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
          className={`h-full rounded-full bg-gradient-to-r ${c}`}
        />
      </div>
    </div>
  );
}

export function Stat({ label, value, delta, tone = "neon", icon }: { label: string; value: string; delta?: string; tone?: "neon" | "accent" | "warn"; icon?: ReactNode }) {
  const c = { neon: "text-neon", accent: "text-[#b7b1ff]", warn: "text-warn" }[tone];
  return (
    <Card hover className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-sm text-mute">{label}</span>
        {icon && <span className={c}>{icon}</span>}
      </div>
      <div className={`font-display text-3xl font-bold tnum ${c}`}>{value}</div>
      {delta && <div className="text-xs text-mute">{delta}</div>}
    </Card>
  );
}

export function Tabs({ items, active, onChange }: { items: string[]; active: string; onChange: (t: string) => void }) {
  return (
    <div className="mb-5 inline-flex rounded-2xl border border-line bg-panel p-1">
      {items.map((t) => (
        <button
          key={t}
          onClick={() => onChange(t)}
          className={`focus-ring relative rounded-xl px-4 py-1.5 text-sm transition-colors ${active === t ? "text-[#04110b]" : "text-mute hover:text-ink"}`}
        >
          {active === t && (
            <motion.div layoutId="tab-pill" className="absolute inset-0 rounded-xl bg-gradient-to-r from-neon to-neondeep" transition={{ type: "spring", stiffness: 400, damping: 32 }} />
          )}
          <span className="relative font-medium">{t}</span>
        </button>
      ))}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-mute">{label}</span>
      {children}
    </label>
  );
}

export function Select({ value, options, onChange }: { value: string; options: string[]; onChange?: (v: string) => void }) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        className={`${inputCls} appearance-none pr-9`}
      >
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
      <span aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-mute">▾</span>
    </div>
  );
}

export const inputCls =
  "focus-ring w-full rounded-xl border border-line bg-panel px-3.5 py-2.5 text-sm text-ink placeholder:text-mute/60";

export function Modal({ open, onClose, title, children, wide = false }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6" role="dialog" aria-modal="true">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
        className={`glass relative max-h-[85vh] w-full ${wide ? "max-w-3xl" : "max-w-xl"} overflow-y-auto rounded-card p-7`}
      >
        <div className="mb-5 flex items-center justify-between">
          <h3 className="text-lg font-bold">{title}</h3>
          <button onClick={onClose} aria-label="关闭" className="focus-ring rounded-lg p-1.5 text-mute hover:bg-white/5 hover:text-ink">✕</button>
        </div>
        {children}
      </motion.div>
    </div>
  );
}
