/* First-visit tour with P'Pre: highlights one part of the page at a time (elements marked data-tour="key").
   Skippable at any step, remembered in browser storage, and can be replayed from Help or Settings. */
import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Button } from "./ui";
import { PPre } from "./PPre";
import { PREF, writePref } from "./prefs";
import { ignoreKey, SkipButton } from "./states";

export interface TourStep { key: string; title: string; body: string }

export const HOME_TOUR: TourStep[] = [
  { key: "stage", title: "ไฟเวทีของคุณ", body: "ซ้อมอย่างน้อย 1 รอบต่อสัปดาห์ ไฟจะติดเพิ่มทีละดวง ครบ 5 ดวงเวทีสว่างเต็ม ถ้าหายไปทั้งสัปดาห์ ไฟจะหรี่ลงทีละดวง ไม่ดับหมดทันที" },
  { key: "start", title: "เริ่มซ้อมรอบใหม่", body: "ตั้งเวลาเป้าหมาย แล้วอัดจากกล้องหรืออัปโหลดคลิป ระบบจะบอกทุกขั้นว่ากำลังทำอะไรอยู่" },
  { key: "latest", title: "ผลรอบล่าสุด", body: "ดูระดับ 8 เกณฑ์ และเกณฑ์ที่ดีขึ้นจากรอบก่อน กดเพื่อดูหลักฐานในวิดีโอได้ทุกจุด" },
  { key: "trend", title: "แนวโน้มข้ามรอบ", body: "เลือกเกณฑ์เพื่อดูระดับที่ระบบวัดได้ในแต่ละรอบ (ไม่ใช่หลักฐานว่าทักษะเพิ่มขึ้น)" },
  { key: "help", title: "สงสัยตรงไหน กดที่นี่", body: "คำถามที่พบบ่อย วิธีวัดผลแต่ละเกณฑ์ และดูทัวร์นี้อีกครั้งได้จากเมนูช่วยเหลือ (บนมือถืออยู่ในปุ่ม \"เพิ่มเติม\")" },
];

function findTarget(key: string): HTMLElement | null {
  const all = Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${key}"]`));
  return all.find((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }) ?? null;
}

export function Tour({ steps, open, onClose }: { steps: TourStep[]; open: boolean; onClose: () => void }) {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const step = steps[i];

  const finish = useCallback(() => { writePref(PREF.tourDone, "1"); setI(0); onClose(); }, [onClose]);

  const measure = useCallback(() => {
    const el = step && findTarget(step.key);
    setRect(el ? el.getBoundingClientRect() : null);
  }, [step]);

  useLayoutEffect(() => {
    if (!open || !step) return;
    const el = findTarget(step.key);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
    const t = window.setTimeout(measure, 380);
    measure();
    return () => window.clearTimeout(t);
  }, [open, step, measure]);

  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => {
      if (ignoreKey(e)) return;
      if (e.key === "Escape") finish();
      if (e.key === "ArrowRight") setI((x) => Math.min(steps.length - 1, x + 1));
      if (e.key === "ArrowLeft") setI((x) => Math.max(0, x - 1));
    };
    window.addEventListener("resize", measure); window.addEventListener("scroll", measure, true); window.addEventListener("keydown", key);
    return () => { window.removeEventListener("resize", measure); window.removeEventListener("scroll", measure, true); window.removeEventListener("keydown", key); };
  }, [open, measure, finish, steps.length]);

  if (!open || !step) return null;
  const pad = 8;
  const vw = window.innerWidth, vh = window.innerHeight;
  const cardW = Math.min(360, vw - 32);
  const below = rect ? rect.bottom + 200 < vh || rect.top < 220 : true;
  const cardTop = rect ? (below ? Math.min(rect.bottom + pad + 14, vh - 210) : Math.max(16, rect.top - pad - 14 - 190)) : vh / 2 - 100;
  const cardLeft = rect ? Math.min(Math.max(16, rect.left + rect.width / 2 - cardW / 2), vw - cardW - 16) : vw / 2 - cardW / 2;

  return createPortal(<div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label={`แนะนำการใช้งาน ขั้นที่ ${i + 1} จาก ${steps.length}`}>
    {/* dim everything except the highlighted box */}
    {rect ? <motion.div className="pointer-events-none absolute rounded-2xl ring-2 ring-lime"
      animate={{ top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 }}
      transition={{ type: "spring", stiffness: 260, damping: 30 }}
      style={{ boxShadow: "0 0 0 9999px rgb(8 7 43 / 0.62)" }} />
      : <div className="absolute inset-0 bg-navy-950/60" />}
    <div className="absolute inset-0" onClick={finish} aria-hidden />
    <AnimatePresence mode="wait">
      <motion.div key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
        className="absolute rounded-panel bg-white p-5 text-ink shadow-lift" style={{ top: cardTop, left: cardLeft, width: cardW }}>
        <div className="flex items-start gap-3">
          <PPre pose={i === 0 ? "wave" : i === steps.length - 1 ? "celebrate" : "point"} size={54} className="-mt-1 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-brand">{i + 1} / {steps.length}</p>
            <h3 className="font-bold leading-snug">{step.title}</h3>
          </div>
          <SkipButton onSkip={finish} dark={false} fixed={false} esc={false} className="-mr-2 -mt-2 min-h-9 px-3 text-xs" />
        </div>
        <p className="mt-2 text-sm leading-relaxed text-muted">{step.body}</p>
        <div className="mt-4 flex items-center justify-between gap-2">
          <div className="flex gap-1">{steps.map((s, j) => <span key={s.key} className={j === i ? "h-1.5 w-5 rounded-full bg-brand" : "size-1.5 rounded-full bg-brand-100"} />)}</div>
          <div className="flex gap-1.5">
            {i > 0 && <Button size="sm" variant="ghost" onClick={() => setI(i - 1)} aria-label="ก่อนหน้า"><ArrowLeft /></Button>}
            {i < steps.length - 1
              ? <Button size="sm" onClick={() => setI(i + 1)}>ถัดไป <ArrowRight /></Button>
              : <Button size="sm" variant="lime" onClick={finish}>เริ่มใช้งาน</Button>}
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  </div>, document.body);
}
