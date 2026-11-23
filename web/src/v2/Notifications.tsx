/* Bell menu: results ready, stage lights about to dim, days to the real presentation. Read state is kept per browser. */
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { Bell, CalendarClock, ChartNoAxesCombined, CheckCheck, Lightbulb, type LucideIcon } from "lucide-react";
import { cn } from "./ui";
import { PREF, readPref, writePref } from "./prefs";

export interface Note { id: string; kind: "result" | "stage" | "day" | "info"; title: string; body?: string; when: string; to?: string }

const ICON: Record<Note["kind"], LucideIcon> = { result: ChartNoAxesCombined, stage: Lightbulb, day: CalendarClock, info: Bell };

export function Notifications({ notes }: { notes: Note[] }) {
  const [open, setOpen] = useState(false);
  const [read, setRead] = useState<Set<string>>(() => new Set((readPref(PREF.readNotes) ?? "").split(",").filter(Boolean)));
  const box = useRef<HTMLDivElement>(null);
  const unread = notes.filter((n) => !read.has(n.id)).length;
  const mark = (ids: string[]) => { const next = new Set([...read, ...ids]); setRead(next); writePref(PREF.readNotes, [...next].join(",")); };

  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", away); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  return <div ref={box} className="relative">
    <button type="button" aria-label={unread ? `การแจ้งเตือน ยังไม่อ่าน ${unread} รายการ` : "การแจ้งเตือน"} aria-expanded={open} onClick={() => setOpen(!open)}
      className={cn("relative grid size-10 place-items-center rounded-full bg-white text-muted shadow-card transition-colors hover:text-brand", open && "text-brand")}>
      <Bell className="size-[18px]" />
      {unread > 0 && <span className="absolute -right-0.5 -top-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-lime px-1 text-[10px] font-bold text-navy ring-2 ring-surface">{unread}</span>}
    </button>
    <AnimatePresence>
      {open && <motion.div initial={{ opacity: 0, y: -6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6 }}
        className="fixed inset-x-4 top-[72px] z-40 origin-top-right rounded-panel bg-white p-2 shadow-lift sm:absolute sm:inset-x-auto sm:right-0 sm:top-12 sm:w-[22rem]">
        <div className="flex items-center justify-between px-3 py-2">
          <p className="font-bold">การแจ้งเตือน</p>
          {unread > 0 && <button type="button" onClick={() => mark(notes.map((n) => n.id))} className="flex items-center gap-1 text-xs font-semibold text-brand hover:underline"><CheckCheck className="size-4" />อ่านทั้งหมด</button>}
        </div>
        {notes.length === 0 ? <p className="px-3 pb-4 pt-1 text-sm text-muted">ยังไม่มีการแจ้งเตือน ผลการวิเคราะห์และไฟเวทีจะมาแจ้งที่นี่</p>
          : <ul className="max-h-[60vh] overflow-y-auto">
            {notes.map((n) => { const Icon = ICON[n.kind], isNew = !read.has(n.id);
              const inner = <>
                <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl", n.kind === "stage" ? "bg-navy text-lime" : "bg-brand-50 text-brand")}><Icon className="size-[18px]" /></span>
                <span className="min-w-0 flex-1">
                  <span className={cn("block text-sm leading-snug", isNew ? "font-semibold text-ink" : "text-muted")}>{n.title}</span>
                  {n.body && <span className="mt-0.5 block text-xs text-muted">{n.body}</span>}
                  <span className="mt-1 block text-[11px] text-faint">{n.when}</span>
                </span>
                {isNew && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-brand" aria-label="ยังไม่อ่าน" />}
              </>;
              const cls = "flex w-full gap-3 rounded-xl p-3 text-left transition-colors hover:bg-surface";
              return <li key={n.id}>{n.to
                ? <Link to={n.to} className={cls} onClick={() => { mark([n.id]); setOpen(false); }}>{inner}</Link>
                : <button type="button" className={cls} onClick={() => mark([n.id])}>{inner}</button>}</li>; })}
          </ul>}
      </motion.div>}
    </AnimatePresence>
  </div>;
}
