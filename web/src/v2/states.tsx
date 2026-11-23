/* Shared UX states so a user is never left guessing (owner's rule, 23 Nov 2026):
   1 see what the system is doing, 2 always a clear next step, 3 stop mistakes early,
   4 errors say what happened / why / what to do, 5 jargon has a "?" explanation. */
import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, CheckCircle2, ChevronsRight, CircleHelp, Info, Loader2, X } from "lucide-react";
import { Button, cn } from "./ui";
import { PPre, type Pose } from "./PPre";

/* ---------- 1. Status stepper ---------- */

export interface Step { label: string; hint?: string }

/** The one list of steps for a practice round, used by Setup, Record, Waiting and the dashboard. */
export const PRACTICE_STEPS: Step[] = [
  { label: "เตรียม", hint: "ตั้งเวลาและหัวข้อ" },
  { label: "ซ้อมและส่งคลิป", hint: "อัดหรืออัปโหลด" },
  { label: "รอคิว" },
  { label: "วิเคราะห์", hint: "ราวความยาวคลิป" },
  { label: "ผลออก" },
];

/** Full-screen moments (result reveal, recap) set a flag on <body> so floating helpers hide under them. */
let overlays = 0;
export function useOverlayFlag(active = true) {
  useEffect(() => {
    if (!active) return;
    overlays++; document.body.dataset.ppOverlay = "1";
    return () => { overlays = Math.max(0, overlays - 1); if (!overlays) delete document.body.dataset.ppOverlay; };
  }, [active]);
}

/** True when a page-wide key shortcut should not fire: the user is typing, or the Ctrl+K palette is open. */
export function ignoreKey(e: KeyboardEvent) {
  const t = e.target;
  const typing = t instanceof HTMLElement && (t.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(t.tagName));
  return typing || document.body.dataset.ppPalette === "1";
}

/** "ข้าม" for every animated moment (result reveal, stage lights, curtain, recap, tour): always visible from the
    first second, at least 44 px to tap, and Esc does the same unless `esc` is off. `fixed` pins it top-right. */
export function SkipButton({ onSkip, label = "ข้าม", dark = true, fixed = true, esc = true, className }: {
  onSkip: () => void; label?: string; dark?: boolean; fixed?: boolean; esc?: boolean; className?: string;
}) {
  const cb = useRef(onSkip); cb.current = onSkip;
  useEffect(() => {
    if (!esc) return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape" && document.body.dataset.ppPalette !== "1") cb.current(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [esc]);
  return <button type="button" data-skip onClick={(e) => { e.stopPropagation(); onSkip(); }} aria-keyshortcuts={esc ? "Escape" : undefined}
    className={cn("inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-full px-4 text-sm font-semibold transition-colors",
      dark ? "bg-white/10 text-white ring-1 ring-inset ring-white/25 backdrop-blur hover:bg-white/20" : "bg-surface text-muted hover:bg-brand-50 hover:text-brand",
      fixed && "fixed right-4 top-4 z-[95] sm:right-6 sm:top-6", className)}>
    {label}<ChevronsRight className="size-4" />
  </button>;
}

/** Horizontal steps: done (blue check), current (lime, spinning when busy), waiting (faint). `failedAt` marks a step red-free: dashed + "!". */
export function StatusStepper({ steps, current, busy, failedAt, className, dark }: {
  steps: Step[]; current: number; busy?: boolean; failedAt?: number; className?: string; dark?: boolean;
}) {
  return <ol className={cn("flex items-start", className)} aria-label="ขั้นตอน">
    {steps.map((s, i) => {
      const done = i < current, now = i === current, failed = failedAt === i;
      return <li key={s.label} className="flex flex-1 items-start last:flex-none" aria-current={now ? "step" : undefined}>
        <span className="flex w-14 flex-col items-center gap-1.5 text-center sm:w-24">
          <span className={cn("grid size-8 place-items-center rounded-full text-xs font-bold transition-colors",
            failed ? "border-2 border-dashed border-current" : done ? "bg-brand text-white" : now ? "bg-lime text-navy" : dark ? "bg-white/10 text-white/50" : "bg-brand-50 text-faint",
            failed && (dark ? "text-white" : "text-ink"))}>
            {failed ? "!" : done ? <CheckCircle2 className="size-4" /> : now && busy ? <Loader2 className="size-4 animate-spin" /> : i + 1}
          </span>
          <span className={cn("text-[11px] font-semibold leading-tight sm:text-xs", now || done ? (dark ? "text-white" : "text-ink") : dark ? "text-white/50" : "text-faint")}>{s.label}</span>
          {s.hint && now && <span className={cn("hidden text-[11px] leading-tight sm:block", dark ? "text-white/60" : "text-muted")}>{s.hint}</span>}
        </span>
        {i < steps.length - 1 && <span className={cn("mt-4 h-0.5 flex-1 rounded-full", done ? "bg-brand" : dark ? "bg-white/15" : "bg-line")} />}
      </li>;
    })}
  </ol>;
}

/* ---------- Loading skeletons (shape of the page, so nothing jumps when data arrives) ---------- */

export function Skeleton({ className, dark }: { className?: string; dark?: boolean }) {
  return <span aria-hidden className={cn("block animate-pulse rounded-xl motion-reduce:animate-none", dark ? "bg-white/10" : "bg-brand-100/60", className)} />;
}

/** Signed-in page frame while a page's code or data loads. */
export function PageSkeleton() {
  return <div className="min-h-dvh bg-surface lg:pl-[248px]" role="status" aria-label="กำลังโหลด">
    <aside className="fixed inset-y-0 left-0 hidden w-[248px] flex-col gap-3 border-r border-line bg-white px-6 py-7 lg:flex">
      <Skeleton className="h-7 w-36" />
      <div className="mt-8 space-y-3">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-9" />)}</div>
      <Skeleton className="mt-auto h-40 rounded-2xl" />
    </aside>
    <div className="mx-auto max-w-[1280px] px-4 pt-6 sm:px-6 lg:px-8">
      <Skeleton className="h-8 w-56" /><Skeleton className="mt-2 h-4 w-80 max-w-full" />
      <DashboardSkeleton className="mt-8" />
    </div>
  </div>;
}

export function DashboardSkeleton({ className }: { className?: string }) {
  return <div className={cn("grid grid-cols-1 gap-5 lg:grid-cols-12", className)} role="status" aria-label="กำลังโหลด">
    <Skeleton className="h-72 rounded-panel bg-navy/15 lg:col-span-7" /><Skeleton className="h-72 rounded-panel lg:col-span-5" />
    {Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-36 rounded-card lg:col-span-4" />)}
    <Skeleton className="h-80 rounded-card lg:col-span-8" /><Skeleton className="h-80 rounded-card lg:col-span-4" />
  </div>;
}

/* ---------- 2. Empty state ---------- */

export function EmptyState({ title, children, action, pose = "wave", className }: { title: ReactNode; children?: ReactNode; action?: ReactNode; pose?: Pose; className?: string }) {
  return <div className={cn("card flex flex-col items-center px-6 py-10 text-center", className)}>
    <PPre pose={pose} size={104} />
    <h3 className="mt-4 text-lg font-bold">{title}</h3>
    {children && <p className="mt-1 max-w-md text-sm text-muted">{children}</p>}
    {action && <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div>}
  </div>;
}

/* ---------- 4. Error panel: what happened / why / what to do ---------- */

export function ErrorPanel({ what, why, todo, actions, tone = "error", className, dark }: {
  what: ReactNode; why?: ReactNode; todo?: ReactNode; actions?: ReactNode; tone?: "error" | "info"; className?: string; dark?: boolean;
}) {
  const Icon = tone === "error" ? AlertTriangle : Info;
  return <div role={tone === "error" ? "alert" : "status"} className={cn("rounded-2xl p-5", dark ? "bg-white/10 text-white ring-1 ring-inset ring-white/15" : "bg-white shadow-card ring-1 ring-inset ring-brand-100", className)}>
    <div className="flex gap-3">
      <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl", tone === "error" ? "bg-navy text-lime" : "bg-brand-50 text-brand", dark && "bg-white/15")}><Icon className="size-5" /></span>
      <div className="min-w-0">
        <p className="font-bold leading-snug">{what}</p>
        {why && <p className={cn("mt-1 text-sm", dark ? "text-white/75" : "text-muted")}><b className="font-semibold">สาเหตุ:</b> {why}</p>}
        {todo && <p className={cn("mt-1 text-sm", dark ? "text-white/75" : "text-muted")}><b className="font-semibold">ทำอย่างไรต่อ:</b> {todo}</p>}
        {actions && <div className="mt-3 flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  </div>;
}

/* ---------- Toast (bottom corner, optional undo) ---------- */

interface ToastItem { id: number; text: ReactNode; undo?: () => void }
const ToastCtx = createContext<(text: ReactNode, undo?: () => void) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastHost({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const show = useCallback((text: ReactNode, undo?: () => void) => {
    const id = ++seq.current;
    setItems((xs) => [...xs.slice(-2), { id, text, undo }]);
    window.setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 5000);
  }, []);
  return <ToastCtx.Provider value={show}>
    {children}
    <div className="pointer-events-none fixed inset-x-4 bottom-[140px] z-[60] flex flex-col items-center gap-2 sm:inset-x-auto sm:right-6 sm:items-end lg:bottom-20" aria-live="polite">
      <AnimatePresence>
        {items.map((t) => <motion.div key={t.id} initial={{ opacity: 0, y: 12, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8 }}
          className="pointer-events-auto flex max-w-sm items-center gap-3 rounded-2xl bg-navy py-3 pl-4 pr-2 text-sm text-white shadow-lift">
          <CheckCircle2 className="size-4 shrink-0 text-lime" /><span className="min-w-0 flex-1">{t.text}</span>
          {t.undo && <button type="button" onClick={() => { t.undo!(); setItems((xs) => xs.filter((x) => x.id !== t.id)); }} className="rounded-full px-3 py-1 font-semibold text-lime hover:bg-white/10">เลิกทำ</button>}
          <button type="button" aria-label="ปิด" onClick={() => setItems((xs) => xs.filter((x) => x.id !== t.id))} className="grid size-7 place-items-center rounded-full text-white/60 hover:bg-white/10"><X className="size-4" /></button>
        </motion.div>)}
      </AnimatePresence>
    </div>
  </ToastCtx.Provider>;
}

/* ---------- 3. Confirm before anything that cannot be undone ---------- */

export function ConfirmDialog({ open, title, children, confirmLabel, onConfirm, onClose, requireText }: {
  open: boolean; title: ReactNode; children?: ReactNode; confirmLabel: string; onConfirm: () => void; onClose: () => void;
  /** Ask the user to type this word first (for deleting everything). */
  requireText?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [typed, setTyped] = useState("");
  const titleId = useId();
  useEffect(() => {
    const d = ref.current; if (!d) return;
    if (open && !d.open) { setTyped(""); d.showModal(); }
    if (!open && d.open) d.close();
  }, [open]);
  const ok = !requireText || typed.trim() === requireText;
  return <dialog ref={ref} onClose={onClose} aria-labelledby={titleId}
    className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-panel bg-white p-0 text-ink shadow-lift backdrop:bg-navy-950/60 backdrop:backdrop-blur-sm">
    <div className="p-6">
      <h2 id={titleId} className="text-lg font-bold">{title}</h2>
      {children && <div className="mt-2 text-sm text-muted">{children}</div>}
      {requireText && <label className="mt-4 block text-sm">
        <span className="text-muted">พิมพ์ <b className="text-ink">{requireText}</b> เพื่อยืนยัน</span>
        <input value={typed} onChange={(e) => setTyped(e.target.value)} className="mt-1.5 h-11 w-full rounded-xl bg-surface px-3 outline-none ring-1 ring-inset ring-line focus:ring-2 focus:ring-brand" />
      </label>}
      <div className="mt-6 flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={onClose} autoFocus>ยกเลิก</Button>
        <Button disabled={!ok} title={ok ? undefined : `พิมพ์ ${requireText} ก่อน`} onClick={() => { onConfirm(); onClose(); }} className="bg-navy hover:bg-navy-800">{confirmLabel}</Button>
      </div>
    </div>
  </dialog>;
}

/* ---------- 5. "?" next to a term ---------- */

export function HelpTip({ children, href, label = "ความหมาย", className, dark }: { children: ReactNode; href?: string; label?: string; className?: string; dark?: boolean }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null), tip = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; up: boolean } | null>(null);
  // the tip is drawn in a portal with fixed position, so a card with overflow-hidden cannot cut it,
  // and it is kept inside the screen on phones
  const place = useCallback(() => {
    const r = btn.current?.getBoundingClientRect(); if (!r) return;
    const w = Math.min(256, window.innerWidth - 24), h = tip.current?.offsetHeight ?? 120;
    const up = r.bottom + 8 + h > window.innerHeight && r.top - 8 - h > 0;
    setPos({ top: up ? r.top - 8 - h : r.bottom + 8, left: Math.min(Math.max(12, r.left + r.width / 2 - w / 2), window.innerWidth - w - 12), up });
  }, []);
  useLayoutEffect(() => { if (open) place(); }, [open, place]);
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => { const n = e.target as Node; if (!btn.current?.contains(n) && !tip.current?.contains(n)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", away); document.addEventListener("keydown", esc);
    window.addEventListener("scroll", place, true); window.addEventListener("resize", place);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); window.removeEventListener("scroll", place, true); window.removeEventListener("resize", place); };
  }, [open, place]);
  return <span className={cn("relative inline-flex align-middle", className)}>
    <button ref={btn} type="button" aria-label={label} aria-expanded={open} onClick={() => setOpen(!open)}
      className={cn("grid size-5 place-items-center rounded-full transition-colors", dark ? "text-white/60 hover:text-lime" : "text-faint hover:text-brand")}>
      <CircleHelp className="size-4" />
    </button>
    {createPortal(<AnimatePresence>
      {open && <motion.span ref={tip} role="tooltip" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
        className="fixed z-[75] block rounded-xl bg-navy p-3 text-left text-xs font-normal leading-relaxed text-white shadow-lift"
        style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width: "min(16rem, calc(100vw - 24px))" }}>
        {children}
        {href && <Link to={href} onClick={() => setOpen(false)} className="mt-2 block font-semibold text-lime hover:underline">อ่านวิธีวัดเต็ม ๆ →</Link>}
      </motion.span>}
    </AnimatePresence>, document.body)}
  </span>;
}
