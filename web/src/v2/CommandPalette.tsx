/* Ctrl+K (⌘K on Mac) / "/" palette: jump to any page, round, criterion or help answer by typing.
   Arrow keys move, Enter opens, Esc closes. Other parts open it with openPalette(). */
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { CornerDownLeft, Search, type LucideIcon } from "lucide-react";
import { cn } from "./ui";

export interface Command { id: string; group: string; label: string; hint?: string; to: string; Icon: LucideIcon; keywords?: string }

const EVENT = "pp:palette";
export const openPalette = () => window.dispatchEvent(new Event(EVENT));
export const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

export function CommandPalette({ commands }: { commands: Command[] }) {
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const show = () => { setOpen(true); setQ(""); setAt(0); };
    const key = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName));
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((o) => { if (!o) { setQ(""); setAt(0); } return !o; }); }
      else if (e.key === "/" && !typing) { e.preventDefault(); show(); }
    };
    window.addEventListener(EVENT, show); window.addEventListener("keydown", key);
    return () => { window.removeEventListener(EVENT, show); window.removeEventListener("keydown", key); };
  }, []);
  useEffect(() => {
    if (!open) return;
    // other page shortcuts (recap slides, tour) check this flag and stay quiet while the palette is open
    document.body.dataset.ppPalette = "1";
    const id = window.setTimeout(() => input.current?.focus(), 20);
    return () => { window.clearTimeout(id); delete document.body.dataset.ppPalette; };
  }, [open]);

  const hits = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return commands.filter((c) => { const hay = `${c.label} ${c.hint ?? ""} ${c.group} ${c.keywords ?? ""}`.toLowerCase(); return words.every((w) => hay.includes(w)); }).slice(0, 40);
  }, [q, commands]);
  useEffect(() => { setAt(0); }, [q]);
  useEffect(() => { list.current?.querySelector(`[data-i="${at}"]`)?.scrollIntoView({ block: "nearest" }); }, [at]);

  const go = (c?: Command) => { if (!c) return; setOpen(false); nav(c.to); };
  const groups = hits.reduce<Record<string, { c: Command; i: number }[]>>((g, c, i) => { (g[c.group] ??= []).push({ c, i }); return g; }, {});

  return createPortal(<AnimatePresence>
    {open && <motion.div className="fixed inset-0 z-[80] flex items-start justify-center bg-navy-950/55 px-3 pt-[12vh] backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }} role="dialog" aria-modal="true" aria-label="ค้นหาและไปที่">
      <motion.div initial={{ y: -12, scale: 0.98 }} animate={{ y: 0, scale: 1 }} exit={{ y: -8, opacity: 0 }} className="w-full max-w-xl overflow-hidden rounded-panel bg-white text-ink shadow-lift">
        <label className="flex items-center gap-3 border-b border-line px-5">
          <Search className="size-5 text-brand" />
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาหน้า รอบซ้อม เกณฑ์ หรือคำถาม..."
            role="combobox" aria-expanded="true" aria-controls="pp-palette-list" aria-activedescendant={hits[at] ? `pp-cmd-${hits[at].id}` : undefined}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setAt((x) => Math.min(hits.length - 1, x + 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setAt((x) => Math.max(0, x - 1)); }
              else if (e.key === "Enter") { e.preventDefault(); go(hits[at]); }
              else if (e.key === "Escape") setOpen(false);
            }} className="h-14 w-full bg-transparent text-base outline-none" />
          <kbd className="rounded-md bg-surface px-2 py-1 text-[11px] font-semibold text-muted">Esc</kbd>
        </label>
        <ul ref={list} id="pp-palette-list" role="listbox" className="max-h-[min(60vh,28rem)] overflow-y-auto p-2">
          {hits.length === 0 && <li className="px-4 py-8 text-center text-sm text-muted">ไม่พบ "{q}" ลองคำอื่น เช่น ผล, ไฟเวที, เสียงเติม<br />
            <button type="button" className="mt-2 font-semibold text-brand hover:underline" onClick={() => go({ id: "help", group: "", label: "", to: "/lab/help", Icon: Search })}>ไปหน้าช่วยเหลือ</button></li>}
          {Object.entries(groups).map(([g, xs]) => <li key={g} role="presentation">
            <p className="px-3 pb-1 pt-3 text-[11px] font-semibold text-faint">{g}</p>
            <ul role="presentation">{xs.map(({ c, i }) => <li key={c.id} id={`pp-cmd-${c.id}`} role="option" aria-selected={i === at} data-i={i}
              onMouseMove={() => setAt(i)} onClick={() => go(c)}
              className={cn("flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5", i === at ? "bg-brand text-white" : "hover:bg-surface")}>
              <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg", i === at ? "bg-white/15" : "bg-brand-50 text-brand")}><c.Icon className="size-4" /></span>
              <span className="min-w-0 flex-1"><b className="block truncate text-sm font-semibold">{c.label}</b>{c.hint && <span className={cn("block truncate text-xs", i === at ? "text-white/70" : "text-muted")}>{c.hint}</span>}</span>
              {i === at && <CornerDownLeft className="size-4 opacity-70" />}
            </li>)}</ul>
          </li>)}
        </ul>
        <div className="flex items-center gap-4 border-t border-line bg-surface px-5 py-2.5 text-[11px] text-muted">
          <span><kbd className="font-semibold">↑ ↓</kbd> เลือก</span><span><kbd className="font-semibold">Enter</kbd> เปิด</span><span className="ml-auto">{isMac() ? "⌘" : "Ctrl"} K เปิดได้ทุกหน้า</span>
        </div>
      </motion.div>
    </motion.div>}
  </AnimatePresence>, document.body);
}
