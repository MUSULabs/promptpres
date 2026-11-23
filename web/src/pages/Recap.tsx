/* /recap: "this month on stage", full-screen story slides (auto-advance, tap left/right, arrows, hold to pause).
   Shows practice effort first; the one slide about levels says plainly they are measured levels, not proof of skill. */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowRight, Pause, Play, Share2, X } from "lucide-react";
import { Button, Chip, SHORT_NAME, cn, Logo } from "@/v2/ui";
import { PPre } from "@/v2/PPre";
import { StageLights } from "@/v2/StageLights";
import { CountUp } from "@/v2/viz";
import { stageLights } from "@/v2/streak";
import { badges } from "@/v2/badges";
import { BadgeMedal } from "@/v2/BadgeGrid";
import { SkipButton, useOverlayFlag, ignoreKey } from "@/v2/states";
import { rehearsals, useSessions } from "@/v2/sessions";
import { PATH } from "@/v2/paths";
import { monthSummary, presentDay } from "@/v2/time";

const MS = 6000;

export default function Recap() {
  const { rows } = useSessions();
  const rounds = useMemo(() => monthSummary(rehearsals(rows), new Date()).rounds, [rows]);
  if (rows === null || rounds === 0) return <main id="main-content" tabIndex={-1} className="bg-navy-gradient grid min-h-dvh place-items-center px-6 text-center text-white outline-none">
    {rows === null ? <p role="status" className="text-white/70">กำลังโหลดสรุปเดือนนี้…</p> : <div>
      <PPre pose="think" size={130} color="white" className="mx-auto" />
      <h1 className="mt-6 text-3xl font-bold">เดือนนี้ยังไม่มีรอบซ้อม</h1>
      <p className="mt-2 text-white/70">ส่งซ้อมอย่างน้อย 1 รอบ แล้วสรุปประจำเดือนจะเปิดได้</p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Button asChild variant="lime" size="lg"><Link to={PATH.new}>ซ้อมรอบใหม่ <ArrowRight /></Link></Button>
        <Button asChild variant="outlineLight" size="lg"><Link to={PATH.progress}>กลับหน้าความคืบหน้า</Link></Button>
      </div>
    </div>}
  </main>;
  return <RecapSlides />;
}

function RecapSlides() {
  const nav = useNavigate();
  const still = useReducedMotion();
  const { rows } = useSessions();
  const mine = useMemo(() => rehearsals(rows), [rows]);
  const now = useMemo(() => new Date(), []);
  const s = useMemo(() => monthSummary(mine, now), [mine, now]);
  const stage = useMemo(() => stageLights(mine, now), [mine, now]);
  const earned = useMemo(() => badges(mine, now, presentDay() ?? undefined).filter((b) => b.earned), [mine, now]);
  const [i, setI] = useState(0);
  useOverlayFlag();
  const [paused, setPaused] = useState(false); // pause button / space
  const [held, setHeld] = useState(false);     // finger or mouse held down
  const [k, setK] = useState(0); // restarts the progress bar

  const slides: { bg: string; body: ReactNode }[] = [
    { bg: "bg-navy-gradient", body: <Center>
      <PPre pose="wave" size={170} color="white" />
      <p className="mt-8 text-lg font-semibold text-lime">สรุปประจำเดือน</p>
      <h1 className="mt-2 text-5xl font-bold leading-tight sm:text-6xl">{s.label}<br />ของคุณบนเวที</h1>
    </Center> },
    { bg: "bg-brand-gradient", body: <Center>
      <p className="text-xl text-white/80">เดือนนี้คุณขึ้นซ้อม</p>
      <p className="mt-2 text-[9rem] font-bold leading-none text-lime"><CountUp to={s.rounds} duration={1.4} /></p>
      <p className="text-3xl font-bold">รอบ</p>
      <Chip tone="glass" className="mt-6 px-4 py-2 text-base">รวมเวลาคลิปซ้อม {s.minutes} นาที</Chip>
    </Center> },
    { bg: "bg-navy-gradient", body: <Center>
      <p className="text-xl text-white/80">วันที่คุณซ้อม</p>
      <div className="mt-6 grid grid-cols-7 gap-2">
        {Array.from({ length: s.daysInMonth }, (_, d) => d + 1).map((d) => { const on = s.days.includes(d);
          return <motion.span key={d} initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.2 + d * 0.02 }}
            className={cn("grid size-9 place-items-center rounded-lg text-xs font-semibold sm:size-10", on ? "bg-lime text-navy" : d > s.today ? "text-white/20 ring-1 ring-inset ring-white/10" : "bg-white/10 text-white/50")}>{d}</motion.span>; })}
      </div>
      <p className="mt-8 text-2xl font-bold">คุณชอบซ้อม<span className="text-lime">{s.topSlot}</span></p>
      <p className="mt-1 text-white/70">และซ้อมบ่อยสุดใน{s.topWeekday}</p>
    </Center> },
    { bg: "bg-navy-950", body: <Center>
      <p className="text-xl text-white/80">ไฟเวทีตอนนี้</p>
      <StageLights lights={stage.lights} sequence={!still} key={`st${k}`} className="mt-6 w-full max-w-md" />
      <p className="mt-6 text-4xl font-bold">{stage.lights}/5 ดวง</p>
      <p className="mt-2 text-white/70">ซ้อมติดต่อกัน <b className="text-lime">{stage.streak}</b> สัปดาห์ · สถิติสูงสุด {stage.best}</p>
    </Center> },
    { bg: "bg-brand-gradient", body: !s.comparable ? <Center>
      <p className="text-xl text-white/80">เทียบรอบแรกกับรอบล่าสุดของเดือน</p>
      <p className="mt-4 text-3xl font-bold leading-snug">ต้องมีผลอย่างน้อย 2 รอบ<br />ในเดือนนี้จึงจะเทียบได้</p>
      <p className="mt-6 max-w-sm text-sm text-white/60">ซ้อมอีกรอบ แล้วสรุปเดือนจะบอกว่าเกณฑ์ไหนที่ระบบวัดได้ระดับสูงขึ้น</p>
    </Center> : <Center>
      <p className="text-xl text-white/80">เทียบรอบแรกกับรอบล่าสุดของเดือน</p>
      <p className="mt-3 text-7xl font-bold text-lime"><CountUp to={s.higher.length} /></p>
      <p className="text-2xl font-bold">เกณฑ์ที่ระบบวัดได้ระดับสูงขึ้น</p>
      <div className="mt-6 flex max-w-md flex-wrap justify-center gap-2">{s.higher.map((c) => <Chip key={c} tone="lime" className="px-3.5 py-1.5 text-sm">{SHORT_NAME[c]}</Chip>)}</div>
      <p className="mt-8 max-w-sm text-sm text-white/60">ระดับที่ระบบวัดได้ ไม่ใช่หลักฐานว่าทักษะเพิ่มขึ้น หัวข้อ ห้อง และกล้องที่ต่างกันมีผลด้วย</p>
    </Center> },
    { bg: "bg-navy-gradient", body: <Center>
      <p className="text-xl text-white/80">ตราที่คุณได้</p>
      <p className="mt-2 text-6xl font-bold text-lime">{earned.length}<span className="text-3xl text-white/50">/8</span></p>
      <div className="mt-8 flex max-w-md flex-wrap justify-center gap-4">
        {earned.map((b, j) => <motion.div key={b.id} initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.3 + j * 0.12 }} className="flex w-24 flex-col items-center text-center">
          <BadgeMedal b={b} size={68} /><span className="mt-2 text-xs font-semibold leading-tight">{b.title}</span>
        </motion.div>)}
      </div>
    </Center> },
    { bg: "bg-brand-gradient", body: <Center>
      <PPre pose="celebrate" size={150} color="white" />
      <h2 className="mt-6 text-4xl font-bold leading-tight">เดือนหน้า<br />ขึ้นเวทีด้วยกันอีกนะ!</h2>
      <div className="mt-8 flex flex-wrap justify-center gap-3" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
        <Button asChild variant="lime" size="lg"><Link to={PATH.share}><Share2 />ทำการ์ดแชร์</Link></Button>
        <Button asChild variant="outlineLight" size="lg"><Link to={PATH.new}>ซ้อมรอบใหม่ <ArrowRight /></Link></Button>
      </div>
    </Center> },
  ];
  const last = slides.length - 1;
  const go = useCallback((d: number) => { setI((x) => Math.max(0, Math.min(last, x + d))); setK((x) => x + 1); }, [last]);

  const [elapsed, setElapsed] = useState(0);
  useEffect(() => setElapsed(0), [i, k]);
  useEffect(() => {
    if (paused || held || i === last) return;
    const id = window.setInterval(() => setElapsed((e) => e + 100), 100);
    return () => window.clearInterval(id);
  }, [i, paused, held, k, last]);
  useEffect(() => { if (elapsed >= MS) go(1); }, [elapsed, go]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (ignoreKey(e)) return; // typing, or the Ctrl+K palette is open
      if (e.key === "ArrowRight") go(1); else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === " ") { e.preventDefault(); setPaused((p) => !p); } else if (e.key === "Escape") nav(PATH.progress);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [go, nav]);

  return <div id="main-content" tabIndex={-1} className={cn("fixed inset-0 z-50 select-none overflow-hidden text-white outline-none transition-colors duration-500", slides[i].bg)}>
    <div className="grid-lines pointer-events-none absolute inset-0 opacity-60" />
    <div className="absolute inset-x-0 top-0 z-10 px-4 pt-4 sm:px-8">
      <div className="mx-auto flex max-w-xl gap-1.5">
        {slides.map((_, j) => <span key={j} className="h-1 flex-1 overflow-hidden rounded-full bg-white/25">
          <span className="block h-full bg-white transition-[width] duration-100 ease-linear" style={{ width: j < i || (j === i && i === last) ? "100%" : j === i ? `${Math.min(100, (elapsed / MS) * 100)}%` : "0%" }} />
        </span>)}
      </div>
      <div className="mx-auto mt-3 flex max-w-xl items-center justify-between">
        <Logo dark className="h-5" />
        <div className="flex items-center gap-1">
          {i < last && <SkipButton fixed={false} esc={false} label="ข้ามทั้งหมด" onSkip={() => { setI(last); setK((x) => x + 1); }} className="min-h-9 px-3 text-xs" />}
          <button type="button" onClick={() => setPaused(!paused)} aria-label={paused ? "เล่นต่อ" : "หยุดชั่วคราว"} className="grid size-9 place-items-center rounded-full hover:bg-white/10">{paused ? <Play className="size-4" /> : <Pause className="size-4" />}</button>
          <Link to={PATH.progress} aria-label="ปิดสรุป" className="grid size-11 place-items-center rounded-full hover:bg-white/10"><X className="size-5" /></Link>
        </div>
      </div>
    </div>
    {/* tap left = back, right = next, hold = pause */}
    <div className="absolute inset-0 grid grid-cols-[1fr_2fr]" onPointerDown={() => setHeld(true)} onPointerUp={() => setHeld(false)} onPointerLeave={() => setHeld(false)}>
      <button type="button" aria-label="สไลด์ก่อนหน้า" onClick={() => go(-1)} className="cursor-w-resize" />
      <button type="button" aria-label="สไลด์ถัดไป" onClick={() => go(1)} className="cursor-e-resize" />
    </div>
    <AnimatePresence mode="wait">
      <motion.div key={i} initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }} transition={{ duration: 0.35 }}
        className="pointer-events-none absolute inset-0 px-6 pb-10 pt-24 [&_a]:pointer-events-auto [&_button]:pointer-events-auto">{slides[i].body}</motion.div>
    </AnimatePresence>
    <p className="pointer-events-none absolute inset-x-0 bottom-4 text-center text-xs text-white/40">แตะขวา = ถัดไป · แตะซ้าย = ย้อน · กดค้าง = หยุด</p>
  </div>;
}

function Center({ children }: { children: ReactNode }) {
  return <div className="mx-auto flex h-full max-w-xl flex-col items-center justify-center text-center">{children}</div>;
}
