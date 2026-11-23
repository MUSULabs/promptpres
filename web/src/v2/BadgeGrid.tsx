/* Badge medals: lime when earned, dashed outline with a progress ring while still locked. */
import { motion } from "motion/react";
import { CalendarCheck2, Clock3, Flag, Footprints, Lightbulb, Medal, NotebookPen, RotateCcw, type LucideIcon } from "lucide-react";
import type { Badge, BadgeId } from "./badges";
import { cn } from "./ui";

const ICON: Record<BadgeId, LucideIcon> = {
  first: Footprints, weeks3: CalendarCheck2, fullStage: Lightbulb, rounds10: Medal,
  hour: Clock3, planner: NotebookPen, ready: Flag, comeback: RotateCcw,
};

export function BadgeMedal({ b, size = 72 }: { b: Badge; size?: number }) {
  const Icon = ICON[b.id];
  const pct = Math.min(1, b.have / b.goal), R = 46, C = 2 * Math.PI * R;
  return <span className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }}>
    <svg viewBox="0 0 100 100" className="absolute inset-0 -rotate-90">
      <circle cx="50" cy="50" r={R} fill="none" stroke={b.earned ? "var(--color-lime)" : "var(--color-brand-100)"} strokeWidth="6" strokeDasharray={b.earned ? undefined : "4 5"} />
      {!b.earned && pct > 0 && <circle cx="50" cy="50" r={R} fill="none" stroke="var(--color-brand)" strokeWidth="6" strokeLinecap="round" strokeDasharray={`${pct * C} ${C}`} />}
    </svg>
    <span className={cn("grid place-items-center rounded-full", b.earned ? "bg-navy text-lime shadow-[0_8px_20px_-8px_rgb(14_12_69/0.7)]" : "bg-surface text-faint")} style={{ width: size * 0.72, height: size * 0.72 }}>
      <Icon style={{ width: size * 0.32, height: size * 0.32 }} />
    </span>
  </span>;
}

export function BadgeGrid({ list, className }: { list: Badge[]; className?: string }) {
  return <ul className={cn("grid grid-cols-2 gap-3 sm:grid-cols-4", className)}>
    {list.map((b, i) => <motion.li key={b.id} initial={{ opacity: 0, y: 10 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.05 }}
      className={cn("flex flex-col items-center rounded-2xl p-4 text-center", b.earned ? "bg-white shadow-card" : "bg-surface")}>
      <BadgeMedal b={b} />
      <b className={cn("mt-3 text-sm leading-snug", !b.earned && "text-muted")}>{b.title}</b>
      <span className="mt-1 text-xs leading-snug text-muted">{b.desc}</span>
      <span className={cn("mt-2 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums", b.earned ? "bg-lime text-navy" : "bg-white text-muted ring-1 ring-inset ring-line")}>
        {b.earned ? "ได้แล้ว" : `${b.have}/${b.goal}`}
      </span>
    </motion.li>)}
  </ul>;
}
