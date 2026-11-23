import { useEffect, useRef, useState } from "react";
import { animate, motion, useInView, useReducedMotion } from "motion/react";
import { ArrowDown, ArrowUp, Equal, HelpCircle } from "lucide-react";
import type { Criterion, CriterionCode, Topic } from "@/contract";
import { COVERAGE_LABEL, fmtDuration } from "@/presentation";
import { cn, SHORT_NAME } from "./ui";

export const LEVEL_COLOR = ["", "var(--color-level-1)", "var(--color-level-2)", "var(--color-level-3)", "var(--color-level-4)"];

/* ---------- Levels ---------- */

/** 4-step level band. Unanalysable is a dashed outline with "?" — never an empty bar that could read as level 1. */
export function LevelMeter({ level, className, size = "md", dark }: { level: number | null; className?: string; size?: "sm" | "md"; dark?: boolean }) {
  const h = size === "sm" ? "h-1.5" : "h-2.5";
  if (level == null) return <div className={cn("flex items-center gap-1.5 text-xs font-semibold", dark ? "text-white/60" : "text-faint", className)}>
    <div className={cn("flex-1 rounded-full border-[1.5px] border-dashed", dark ? "border-white/40" : "border-faint", h)} /><HelpCircle className="size-4" />
  </div>;
  return <div className={cn("flex gap-1", className)} role="img" aria-label={`ระดับ ${level} จาก 4`}>
    {[1, 2, 3, 4].map((i) => <motion.div key={i} className={cn("flex-1 rounded-full", h)}
      initial={{ scaleX: 0.3, opacity: 0.4 }} whileInView={{ scaleX: 1, opacity: 1 }} viewport={{ once: true }}
      transition={{ delay: i * 0.08, duration: 0.5, ease: "easeOut" }}
      style={{ background: i <= level ? (dark ? "var(--color-lime)" : LEVEL_COLOR[level]) : dark ? "rgb(255 255 255 / 0.15)" : "var(--color-brand-50)", originX: 0 }} />)}
  </div>;
}

export function LevelBadge({ level, className, big }: { level: number | null; className?: string; big?: boolean }) {
  const s = big ? "size-14 text-2xl" : "size-10 text-lg";
  if (level == null) return <div className={cn("grid shrink-0 place-items-center rounded-2xl border-[1.5px] border-dashed border-faint bg-white text-faint", s, className)} title="วิเคราะห์ไม่ได้">
    <HelpCircle className={big ? "size-7" : "size-5"} />
  </div>;
  return <div className={cn("grid shrink-0 place-items-center rounded-2xl font-bold tabular-nums", s, level >= 3 ? "text-white" : "text-brand-800", className)}
    style={{ background: LEVEL_COLOR[level] }} aria-label={`ระดับ ${level}`}>{level}</div>;
}

export function DeltaTag({ before, now, className }: { before: number | null | undefined; now: number | null; className?: string }) {
  if (before == null || now == null) return null;
  const d = now > before ? "up" : now < before ? "down" : "same";
  const cfg = {
    up: { Icon: ArrowUp, text: "ดีขึ้นจากรอบก่อน", cls: "bg-lime text-navy" },
    same: { Icon: Equal, text: "คงที่", cls: "bg-brand-50 text-brand" },
    down: { Icon: ArrowDown, text: "ลดลงจากรอบก่อน", cls: "bg-surface text-muted ring-1 ring-inset ring-line" },
  }[d];
  return <span data-delta={d} title={`ระดับรอบก่อน ${before} · รอบนี้ ${now}`} className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold", cfg.cls, className)}>
    <cfg.Icon className="size-3" />{cfg.text}
  </span>;
}

/* ---------- Numbers ---------- */

export function CountUp({ to, decimals = 0, duration = 1.2, className, suffix }: { to: number; decimals?: number; duration?: number; className?: string; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const still = useReducedMotion();
  const [v, setV] = useState(still ? to : 0);
  useEffect(() => {
    if (!inView || still) { if (still) setV(to); return; }
    const c = animate(0, to, { duration, ease: "easeOut", onUpdate: setV });
    return () => c.stop();
  }, [inView, to, duration, still]);
  return <span ref={ref} className={cn("tabular-nums", className)}>{v.toFixed(decimals)}{suffix}</span>;
}

/* ---------- Radar ---------- */

const ORDER: CriterionCode[] = ["C1", "C2", "S1", "S2", "S3", "N1", "N2", "T1"];

/** 8 axes, levels 1–4 (no total). Unanalysable = hollow dashed dot outside the scale. Optional dashed previous round.
 *  `dark` draws it for a blue/navy card (white grid, lime shape). */
export function Radar({ criteria, previous, size = 320, showLabels = true, className, active, onPick, dark }: {
  criteria: Criterion[]; previous?: Partial<Record<CriterionCode, number | null>>; size?: number; showLabels?: boolean;
  className?: string; active?: CriterionCode | null; onPick?: (c: CriterionCode) => void; dark?: boolean;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const still = useReducedMotion();
  const c = 160, R = 108;
  const pt = (i: number, r: number) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / ORDER.length;
    return [c + Math.cos(a) * r, c + Math.sin(a) * r] as const;
  };
  const byCode = Object.fromEntries(criteria.map((x) => [x.code, x])) as Record<CriterionCode, Criterion | undefined>;
  // an unanalysable axis is skipped (the shape joins its neighbours), so it never reads as level 0 or 1
  const poly = (lv: (code: CriterionCode) => number | null | undefined) =>
    ORDER.flatMap((code, i) => { const l = lv(code); return l == null ? [] : [pt(i, (l / 4) * R).join(",")]; }).join(" ");
  const now = poly((code) => byCode[code]?.level);
  const prev = previous ? poly((code) => previous[code]) : null;
  const grid = dark ? "white" : "var(--color-brand)";
  const shape = dark ? "var(--color-lime)" : "var(--color-brand)";

  return <svg ref={ref} viewBox={showLabels ? "-74 -14 468 348" : "36 36 248 248"} width={size} height={showLabels ? size * 348 / 468 : size}
    className={cn("h-auto max-w-full", className)} role="img"
    aria-label={"กราฟเรดาร์ 8 เกณฑ์: " + ORDER.map((code) => `${SHORT_NAME[code]} ${byCode[code]?.level ?? "วิเคราะห์ไม่ได้"}`).join(", ")}>
    {[1, 2, 3, 4].map((l) => <polygon key={l} points={ORDER.map((_, i) => pt(i, (l / 4) * R).join(",")).join(" ")}
      fill={l === 4 ? (dark ? "rgb(255 255 255 / 0.06)" : "var(--color-brand-50)") : "none"} stroke={grid} strokeOpacity={l === 4 ? 0.25 : 0.12} strokeWidth={1.2} />)}
    {ORDER.map((code, i) => { const [x, y] = pt(i, R); return <line key={code} x1={c} y1={c} x2={x} y2={y} stroke={grid} strokeOpacity={0.12} strokeWidth={1.2} />; })}
    {prev && <polygon points={prev} fill="none" stroke={dark ? "white" : "var(--color-faint)"} strokeOpacity={dark ? 0.55 : 1} strokeWidth={1.8} strokeDasharray="5 5" />}
    <motion.polygon data-shape="now" points={now} fill={shape} fillOpacity={dark ? 0.3 : 0.16} stroke={shape} strokeWidth={2.5} strokeLinejoin="round"
      initial={still ? false : { scale: 0, opacity: 0 }} animate={inView ? { scale: 1, opacity: 1 } : undefined}
      transition={{ type: "spring", stiffness: 110, damping: 18, delay: 0.15 }} style={{ transformOrigin: "160px 160px", transformBox: "view-box" }} />
    {ORDER.map((code, i) => {
      const cr = byCode[code]; const lv = cr?.level ?? null;
      const [x, y] = lv == null ? pt(i, R + 16) : pt(i, (lv / 4) * R);
      const [lx, ly] = pt(i, R + 38);
      const isActive = active === code;
      const dotFill = lv == null ? (dark ? "transparent" : "white") : isActive ? (dark ? "white" : "var(--color-navy)") : shape;
      return <g key={code} data-axis={code} data-level={lv ?? "unanalyzable"} className={onPick ? "cursor-pointer" : undefined} onClick={onPick ? () => onPick(code) : undefined}>
        {isActive && <circle cx={x} cy={y} r={15} fill={shape} fillOpacity={0.2} />}
        <motion.circle cx={x} cy={y} r={isActive ? 8 : 5.5} fill={dotFill}
          stroke={lv == null ? (dark ? "white" : "var(--color-faint)") : dark ? "var(--color-brand)" : "white"} strokeWidth={lv == null ? 1.8 : 2}
          strokeDasharray={lv == null ? "3 3" : undefined}
          initial={still ? false : { scale: 0 }} animate={inView ? { scale: 1 } : undefined}
          transition={{ delay: 0.45 + i * 0.06, type: "spring", stiffness: 380, damping: 18 }} style={{ transformBox: "fill-box", transformOrigin: "center" }} />
        {showLabels && <text x={lx} y={ly} textAnchor={Math.abs(lx - c) < 8 ? "middle" : lx > c ? "start" : "end"} dominantBaseline="middle"
          className={cn("text-[13px] font-semibold", dark ? "fill-white" : "fill-ink", isActive && (dark ? "fill-lime" : "fill-brand"))}>
          {SHORT_NAME[code]}<tspan className={dark ? "fill-white/60 font-normal" : "fill-faint font-normal"}> {lv ?? "?"}</tspan>
        </text>}
      </g>;
    })}
  </svg>;
}

/* ---------- Per-criterion mini charts ---------- */

/** T1: deviation from the target on a −30%…+30% arc. The level-4/3 zones come from config (`bands`, via
    /api/criteria) and are drawn as soft bands; without them only the needle shows. */
export function TimeGauge({ span, target, bands, className }: { span: number; target: number; bands?: { l4: number; l3: number } | null; className?: string }) {
  const dev = ((span - target) / target) * 100;
  const clamp = Math.max(-30, Math.min(30, dev));
  const angle = (clamp / 30) * 90; // −90 … 90
  const deg = (pct: number) => Math.min(90, (pct / 30) * 90);
  const arc = (from: number, to: number) => {
    const p = (a: number) => [100 + 80 * Math.sin((a * Math.PI) / 180), 100 - 80 * Math.cos((a * Math.PI) / 180)];
    const [x1, y1] = p(from), [x2, y2] = p(to);
    return `M${x1} ${y1} A80 80 0 0 1 ${x2} ${y2}`;
  };
  return <div className={cn("relative", className)}>
    <svg viewBox="0 0 200 118" className="w-full overflow-visible">
      <path d={arc(-90, 90)} fill="none" stroke="var(--color-brand-50)" strokeWidth={18} strokeLinecap="round" />
      {bands && <path d={arc(-deg(bands.l3), deg(bands.l3))} fill="none" stroke="var(--color-brand-200)" strokeWidth={18} data-band="3" />}
      {bands && <path d={arc(-deg(bands.l4), deg(bands.l4))} fill="none" stroke="var(--color-lime)" strokeWidth={18} data-band="4" />}
      <motion.g initial={{ rotate: -90 }} whileInView={{ rotate: angle }} viewport={{ once: true }} transition={{ type: "spring", stiffness: 60, damping: 12, delay: 0.2 }}
        style={{ transformOrigin: "100px 100px", transformBox: "view-box" }}>
        <line x1={100} y1={100} x2={100} y2={34} stroke="var(--color-navy)" strokeWidth={4} strokeLinecap="round" />
      </motion.g>
      <circle cx={100} cy={100} r={7} fill="var(--color-navy)" />
      <text x={22} y={116} className="fill-faint text-[10px]" textAnchor="middle">สั้นไป</text>
      <text x={178} y={116} className="fill-faint text-[10px]" textAnchor="middle">ยาวไป</text>
      <text x={100} y={12} className="fill-muted text-[10px] font-semibold" textAnchor="middle">เป้าหมาย {fmtDuration(target)}</text>
    </svg>
    <p className="text-center text-sm"><b className="text-lg tabular-nums">{fmtDuration(span)}</b> <span className="text-muted tabular-nums">({dev >= 0 ? "+" : ""}{dev.toFixed(1)}%)</span></p>
  </div>;
}

/** S1: speaking rate on a 2–8 syllables/s ruler with the recommended band highlighted. */
export function SpeedRuler({ value, band, className }: { value: number; band: [number, number]; className?: string }) {
  const min = 2, max = 8, pct = (v: number) => ((Math.max(min, Math.min(max, v)) - min) / (max - min)) * 100;
  return <div className={cn("pt-8", className)}>
    <div className="relative h-3 rounded-full bg-brand-50">
      <div className="absolute inset-y-0 rounded-full bg-lime" style={{ left: `${pct(band[0])}%`, width: `${pct(band[1]) - pct(band[0])}%` }} />
      <motion.div className="absolute -top-8 flex -translate-x-1/2 flex-col items-center" initial={{ left: "0%" }} whileInView={{ left: `${pct(value)}%` }}
        viewport={{ once: true }} transition={{ type: "spring", stiffness: 70, damping: 14 }}>
        <span className="rounded-md bg-navy px-1.5 py-0.5 text-[11px] font-bold text-white tabular-nums">{value.toFixed(1)}</span>
        <span className="h-6 w-0.5 rounded-full bg-navy" />
      </motion.div>
    </div>
    <div className="mt-1.5 flex justify-between text-[11px] text-faint"><span>ช้า</span><span>ช่วงแนะนำ {band[0]}–{band[1]} พยางค์/วินาที</span><span>เร็ว</span></div>
  </div>;
}

/** C2: topic coverage donut (clear / brief / not mentioned). */
export function CoverageDonut({ topics, size = 124, className }: { topics: Topic[]; size?: number; className?: string }) {
  const n = topics.length || 1;
  const parts = [
    { k: "clear", label: COVERAGE_LABEL.clear, color: "var(--color-brand)", v: topics.filter((t) => t.coverage === "clear").length },
    { k: "brief", label: COVERAGE_LABEL.brief, color: "var(--color-brand-300)", v: topics.filter((t) => t.coverage === "brief").length },
    { k: "not_mentioned", label: COVERAGE_LABEL.not_mentioned, color: "var(--color-line)", v: topics.filter((t) => t.coverage === "not_mentioned").length },
  ];
  const r = 44, C = 2 * Math.PI * r;
  let acc = 0;
  return <div className={cn("flex items-center gap-4", className)}>
    <svg viewBox="0 0 120 120" width={size} height={size} className="-rotate-90 shrink-0">
      <circle cx={60} cy={60} r={r} fill="none" stroke="var(--color-brand-50)" strokeWidth={14} />
      {parts.map((p) => {
        const len = (p.v / n) * C; const off = acc; acc += len;
        return <motion.circle key={p.k} cx={60} cy={60} r={r} fill="none" stroke={p.color} strokeWidth={14}
          strokeDasharray={`${Math.max(0, len - 2)} ${C}`} initial={{ strokeDashoffset: C }} whileInView={{ strokeDashoffset: -off }} viewport={{ once: true }}
          transition={{ duration: 0.9, ease: "easeOut" }} />;
      })}
    </svg>
    <ul className="space-y-1.5 text-sm">
      {parts.map((p) => <li key={p.k} className="flex items-center gap-2">
        <span className="size-2.5 rounded-full" style={{ background: p.color }} /><span className="text-muted">{p.label}</span> <b className="tabular-nums">{p.v}</b>
      </li>)}
    </ul>
  </div>;
}

/** C1: planned order (left) vs order first explained (right). Crossing lines = swapped pairs. */
export function OrderFlow({ topics, className }: { topics: Topic[]; className?: string }) {
  const planned = [...topics].sort((a, b) => a.order - b.order);
  const spoken = planned.filter((t) => t.first_mention_s != null).sort((a, b) => a.first_mention_s! - b.first_mention_s!);
  const row = 26, h = planned.length * row + 6;
  const spokenIdx = new Map(spoken.map((t, i) => [t.id, i]));
  return <div className={cn("grid grid-cols-[1fr_56px_1fr] items-start gap-1 text-[12px]", className)}>
    <div><p className="mb-1 font-semibold text-faint">แผน</p>{planned.map((t) => <p key={t.id} className="truncate" style={{ height: row, lineHeight: `${row}px` }}>{t.order}. {t.title}</p>)}</div>
    <svg viewBox={`0 0 56 ${h}`} width={56} height={h} className="mt-[22px] overflow-visible">
      {planned.map((t, i) => {
        const j = spokenIdx.get(t.id); if (j == null) return null;
        const y1 = i * row + row / 2, y2 = j * row + row / 2, swapped = i !== j;
        return <motion.path key={t.id} d={`M2 ${y1} C28 ${y1} 28 ${y2} 54 ${y2}`} fill="none" stroke={swapped ? "var(--color-navy)" : "var(--color-brand-300)"}
          strokeWidth={swapped ? 3 : 2} strokeDasharray={swapped ? "5 4" : undefined}
          initial={{ pathLength: 0 }} whileInView={{ pathLength: 1 }} viewport={{ once: true }} transition={{ duration: 0.7, delay: i * 0.1 }} />;
      })}
    </svg>
    <div><p className="mb-1 font-semibold text-faint">พูดจริง</p>{spoken.map((t) => <p key={t.id} className="truncate" style={{ height: row, lineHeight: `${row}px` }}>{t.order}. {t.title}</p>)}
      {planned.length > spoken.length && <p className="text-faint" style={{ height: row, lineHeight: `${row}px` }}>ไม่พูดถึง {planned.length - spoken.length}</p>}</div>
  </div>;
}

/** Share-of-time bar (N2 head direction, N1 hands visible/active). */
export function ShareBar({ parts, className }: { parts: { label: string; pct: number; color: string }[]; className?: string }) {
  return <div className={className}>
    <div className="flex h-3 gap-0.5 overflow-hidden rounded-full bg-brand-50">
      {parts.map((p, i) => <motion.div key={p.label} className="first:rounded-l-full last:rounded-r-full" style={{ background: p.color }}
        initial={{ width: 0 }} whileInView={{ width: `${p.pct}%` }} viewport={{ once: true }} transition={{ duration: 0.8, delay: i * 0.1 }} />)}
    </div>
    <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
      {parts.map((p) => <li key={p.label} className="flex items-center gap-1.5"><span className="size-2.5 rounded-full" style={{ background: p.color }} /><span className="text-muted">{p.label}</span> <b className="tabular-nums">{Math.round(p.pct)}%</b></li>)}
    </ul>
  </div>;
}

/** Moments along the clip (S2 pauses, S3 fillers, N1 still spans) as marks on one strip. */
export function MomentStrip({ evidence, duration, color = "var(--color-brand)", className, onSeek }: {
  evidence: { start_s: number; end_s: number }[]; duration: number; color?: string; className?: string; onSeek?: (s: number) => void;
}) {
  return <div className={cn("relative h-6 rounded-lg bg-brand-50", className)}>
    {evidence.map((e, i) => {
      const w = Math.max(0.9, ((e.end_s - e.start_s) / duration) * 100);
      const style = { left: `${(e.start_s / duration) * 100}%`, width: `${w}%`, background: color, minWidth: 4 };
      const anim = { initial: { scaleY: 0 }, whileInView: { scaleY: 1 }, viewport: { once: true }, transition: { delay: i * 0.03 } };
      // only clickable when there is a video to jump in; otherwise a plain mark, not a dead button
      return onSeek ? <motion.button key={i} type="button" aria-label={`ไปที่ ${fmtDuration(e.start_s)}`} onClick={() => onSeek(e.start_s)}
        className="absolute inset-y-1 rounded-sm hover:brightness-125 focus-visible:z-10" style={style} {...anim} />
        : <motion.span key={i} aria-hidden className="absolute inset-y-1 rounded-sm" style={style} {...anim} />;
    })}
  </div>;
}
