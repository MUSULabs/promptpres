import { forwardRef, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import confetti from "canvas-confetti";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowLeftRight, ArrowRight, Check, ChevronDown, Clapperboard, Clock3, Flag, Info, Lightbulb, Pause, Play, RefreshCw, Target, ThumbsUp, Wrench, Zap,
} from "lucide-react";
import type { Criterion, CriterionCode, Result, Skill } from "@/contract";
import { CRITERION_NAME, SKILLS, VALUE_LABEL, fmtDuration, splitClocks } from "@/presentation";
import { Button, Chip, SectionTitle, SHORT_NAME, SKILL_STYLE, SkillIcon, cn } from "@/v2/ui";
import { Shell } from "@/v2/Shell";
import { PPre } from "@/v2/PPre";
import { CountUp, CoverageDonut, DeltaTag, LevelBadge, LevelMeter, MomentStrip, OrderFlow, Radar, ShareBar, SpeedRuler, TimeGauge } from "@/v2/viz";
import { StageLights } from "@/v2/StageLights";
import { ErrorPanel, HelpTip, useOverlayFlag } from "@/v2/states";
import { useMissions } from "@/v2/prefs";
import { MAX_LIGHTS, firstOfItsWeek, type StageState } from "@/v2/streak";
import { FEEDBACK, HISTORY, META, PREVIOUS_LEVELS, RESULT, RESULT_PARTIAL, TRANSCRIPT } from "./fixtures";
import { thDate, useLabShell } from "./demo";

type Seek = (s: number) => void;

/* A stand-in player so the evidence prototype works without a video file. Real pages keep the <video> element. */
function useFakePlayer(duration: number) {
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const last = useRef<number | null>(null);
  useEffect(() => {
    if (!playing) { last.current = null; return; }
    let raf = 0;
    const tick = (now: number) => {
      if (last.current != null) setT((x) => Math.min(duration, x + ((now - last.current!) / 1000) * 8)); // 8× so the demo moves
      last.current = now; raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, duration]);
  return { t, playing, toggle: () => setPlaying((p) => !p), seek: (s: number) => setT(Math.max(0, Math.min(duration, s))) };
}

const TERM: Record<string, string> = {
  "ดีขึ้นจากรอบก่อน": "ระดับที่ระบบวัดได้ในรอบนี้สูงกว่ารอบก่อน (รูบริกเดียวกัน) ไม่ใช่หลักฐานว่าทักษะเพิ่มขึ้น อาจมาจากหัวข้อ ห้อง หรือกล้องที่ต่างกัน",
  "คงที่": "ระดับเท่ากับรอบก่อน (เกณฑ์รุ่นเดียวกัน)",
  "ลดลงจากรอบก่อน": "ระดับที่ระบบวัดได้ต่ำกว่ารอบก่อน ใช้เป็นสัญญาณให้ไปดูหลักฐาน ไม่ใช่คำตัดสิน หัวข้อ ห้อง หรือกล้องที่ต่างกันก็มีผล",
  "เทียบไม่ได้": "รอบก่อนวิเคราะห์เกณฑ์นี้ไม่ได้ หรือยังไม่มีรอบก่อนที่ใช้เกณฑ์รุ่นเดียวกัน",
  "วิเคราะห์ไม่ได้": "ระบบมีข้อมูลไม่พอจะวัดเกณฑ์นี้อย่างยุติธรรม เช่น มองไม่เห็นมือหรือใบหน้า จึงไม่ให้ระดับ (ไม่ใช่ระดับ 1) การ์ดจะบอกเหตุผล",
};

export default function ResultLab() {
  const shell = useLabShell();
  const [params] = useSearchParams();
  const asked = HISTORY.find((r) => r.session_id === params.get("id"));
  // the lab has full detail for one round only; say so instead of silently showing another date
  const other = asked && asked.session_id !== RESULT.session_id ? asked : null;
  const [filter, setFilter] = useState<Skill | "all">("all");
  const [variant, setVariant] = useState<"ok" | "partial">("ok");
  const result = variant === "ok" ? RESULT : RESULT_PARTIAL;
  const [revealKey, setRevealKey] = useState(0);
  const [phase, setPhase] = useState<"reveal" | "stage" | "done">("reveal");
  const litThisRound = firstOfItsWeek(HISTORY, RESULT.session_id);
  const player = useFakePlayer(result.duration_s ?? 600);
  const studio = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<CriterionCode | null>(null);
  const seek: Seek = (s) => { player.seek(s); studio.current?.scrollIntoView({ behavior: "smooth", block: "start" }); };
  const date = thDate(result.created_at, { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const pick = (c: CriterionCode) => {
    setFilter("all"); setActive(c); // the card may be hidden by the skill filter: show all first
    window.setTimeout(() => document.getElementById(`card-${c}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 60);
  };

  return <Shell page="result" title="ผลการซ้อม" subtitle={`รอบวันที่ ${date}`} {...shell}>
    <AnimatePresence>
      {phase === "reveal" && <Reveal key={`r${revealKey}`} result={result} onDone={() => setPhase(litThisRound ? "stage" : "done")} />}
      {phase === "stage" && <StageMoment key={`s${revealKey}`} stage={shell.stage} onDone={() => setPhase("done")} />}
    </AnimatePresence>

    {other && <ErrorPanel tone="info" className="mb-5" what={`ตัวอย่างนี้มีรายละเอียดเฉพาะรอบ ${thDate(RESULT.created_at, { day: "numeric", month: "short" })}`}
      todo={`รอบ ${thDate(other.created_at, { day: "numeric", month: "short" })} ที่คุณกดมา ระบบจริงจะแสดงผลของรอบนั้น ส่วนหน้านี้แสดงรอบล่าสุดแทน`} />}
    <div className="mb-5 flex flex-wrap items-center gap-2 text-sm">
      <Chip tone="line">ข้อมูลตัวอย่าง</Chip>
      <div className="flex rounded-full bg-white p-1 shadow-card">
        {(["ok", "partial"] as const).map((v) => <button key={v} onClick={() => setVariant(v)}
          className={cn("rounded-full px-3 py-1 text-xs font-semibold transition-colors", variant === v ? "bg-brand text-white" : "text-muted hover:text-ink")}>
          {v === "ok" ? "วิเคราะห์ครบ" : "มีเกณฑ์วิเคราะห์ไม่ได้"}</button>)}
      </div>
      <Button size="sm" variant="ghost" onClick={() => { setPhase("reveal"); setRevealKey((k) => k + 1); }}><RefreshCw />เล่นฉากเปิดผลอีกครั้ง</Button>
      <Button size="sm" variant="soft" asChild className="ml-auto"><Link to="/lab/compare"><ArrowLeftRight />เทียบกับรอบก่อน</Link></Button>
    </div>

    <div className="space-y-6">
      <Hero result={result} seek={seek} />
      <SkillMap result={result} onPick={pick} />
      <div ref={studio} className="scroll-mt-24"><EvidenceStudio result={result} player={player} /></div>
      <CoachBoard result={result} seek={seek} />
      <Cards result={result} active={active} setActive={setActive} seek={seek} filter={filter} setFilter={setFilter} />
      <Mission result={result} seek={seek} />
    </div>
  </Shell>;
}

/* ---------- 1. Reveal ---------- */

function Reveal({ result, onDone }: { result: Result; onDone: () => void }) {
  const still = useReducedMotion();
  useOverlayFlag();
  const ok = result.criteria.filter((c) => c.status === "ok").length;
  const improved = result.criteria.filter((c) => c.level != null && PREVIOUS_LEVELS[c.code] != null && c.level > PREVIOUS_LEVELS[c.code]!);
  useEffect(() => {
    if (still) { onDone(); return; }
    // celebrate finishing a round (practice), never a level going up
    const fire = window.setTimeout(() => {
      confetti({ particleCount: 110, spread: 80, origin: { y: 0.62 }, colors: ["#2823ef", "#d4f53c", "#ffffff", "#9491f7"], scalar: 0.9 });
    }, 1300);
    const end = window.setTimeout(onDone, 4200);
    return () => { window.clearTimeout(fire); window.clearTimeout(end); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return <motion.div className="bg-navy-gradient fixed inset-0 z-[60] grid place-items-center overflow-hidden px-6 text-white"
    initial={{ opacity: 1 }} exit={{ clipPath: "circle(0% at 50% 50%)", transition: { duration: 0.6, ease: [0.7, 0, 0.3, 1] } }}
    style={{ clipPath: "circle(150% at 50% 50%)" }}>
    <div className="grid-lines pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_70%)]" />
    <div className="relative flex flex-col items-center text-center">
      <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 180, damping: 16 }}>
        <PPre pose="celebrate" size={160} color="white" />
      </motion.div>
      <motion.h1 className="mt-6 text-4xl font-bold sm:text-5xl" initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ delay: 0.35 }}>
        ซ้อมจบอีก 1 รอบ!
      </motion.h1>
      <motion.p className="mt-3 text-lg text-white/75" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.7 }}>
        วิเคราะห์ได้ <b className="text-lime"><CountUp to={ok} duration={0.8} /></b> จาก 8 เกณฑ์
        {improved.length > 0 && <> · ดีขึ้นจากรอบก่อน <b className="text-lime">{improved.length}</b> เกณฑ์</>}
      </motion.p>
      <motion.div className="mt-6 flex max-w-xl flex-wrap justify-center gap-2" initial="h" animate="s" variants={{ s: { transition: { staggerChildren: 0.07, delayChildren: 1 } } }}>
        {result.criteria.map((c) => <motion.span key={c.code} variants={{ h: { y: 8, opacity: 0 }, s: { y: 0, opacity: 1 } }}
          className={cn("rounded-full px-3 py-1 text-sm font-semibold", c.level == null ? "border border-dashed border-white/50 text-white/70" : "bg-white/10 ring-1 ring-inset ring-white/20")}>
          {SHORT_NAME[c.code]} <span className={c.level != null ? "text-lime" : undefined}>{c.level ?? "?"}</span>
        </motion.span>)}
      </motion.div>
      <Button variant="lime" size="lg" className="mt-8" onClick={onDone}>ดูผลเลย <ArrowRight /></Button>
    </div>
  </motion.div>;
}

/* ---------- 1b. Stage lights moment (first round of the week only) ---------- */

function StageMoment({ stage, onDone }: { stage: StageState; onDone: () => void }) {
  const [ready, setReady] = useState(false);
  useOverlayFlag();
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onDone(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onDone]);
  const before = stage.weeks.at(-2)?.lights ?? 0;
  const kept = before >= stage.lights; // already full last week: replay the power-up instead of claiming a new light
  const full = stage.lights >= MAX_LIGHTS;
  return <motion.div className="fixed inset-0 z-[60] grid place-items-center overflow-y-auto bg-navy-950 px-5 py-10 text-white"
    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.4 } }} role="dialog" aria-modal="true" aria-label="ไฟเวทีสัปดาห์นี้">
    <div className="w-full max-w-xl text-center">
      <p className="text-sm font-semibold text-lime">รอบแรกของสัปดาห์</p>
      <StageLights lights={stage.lights} sequence from={kept ? 0 : before} sound onDone={() => setReady(true)} className="mt-4 shadow-[0_40px_120px_-30px_rgb(212_245_60/0.35)]" />
      <motion.div initial={{ opacity: 0, y: 10 }} animate={ready ? { opacity: 1, y: 0 } : {}} className="mt-6">
        <h2 className="text-3xl font-bold sm:text-4xl">{kept && full ? "เวทียังสว่างเต็ม 5 ดวง!" : full ? "ไฟเวทีครบ 5 ดวง!" : `ไฟดวงที่ ${stage.lights} ติดแล้ว!`}</h2>
        <p className="mt-2 text-white/70">ซ้อมติดต่อกัน <b className="text-lime">{stage.streak}</b> สัปดาห์{stage.best > stage.streak ? ` · สถิติสูงสุด ${stage.best}` : stage.streak > 1 ? " · สถิติใหม่ของคุณ" : ""}</p>
        <p className="mt-1 text-xs text-white/45">ไฟเวทีนับจากความสม่ำเสมอในการซ้อม ไม่ใช่ระดับผล</p>
        <Button variant="lime" size="lg" className="mt-6" onClick={onDone}>ดูผลต่อ <ArrowRight /></Button>
      </motion.div>
    </div>
  </motion.div>;
}

/* ---------- 2. Hero ---------- */

function Hero({ result, seek }: { result: Result; seek: Seek }) {
  const t1 = result.criteria.find((c) => c.code === "T1");
  const focus = result.coach?.items.find((i) => i.kind === "focus");
  // every one of the 8 criteria lands in exactly one box
  const counts = result.criteria.reduce((a, c) => {
    const p = PREVIOUS_LEVELS[c.code];
    if (c.level == null) a.na++; else if (p == null) a.none++; else if (c.level > p) a.up++; else if (c.level < p) a.down++; else a.same++;
    return a;
  }, { up: 0, same: 0, down: 0, na: 0, none: 0 });
  const boxes: [string, number, boolean][] = [["ดีขึ้นจากรอบก่อน", counts.up, true], ["คงที่", counts.same, false], ["ลดลงจากรอบก่อน", counts.down, false], ["วิเคราะห์ไม่ได้", counts.na, false]];
  if (counts.none) boxes.push(["เทียบไม่ได้", counts.none, false]);
  return <section className="grid grid-cols-1 gap-5 lg:grid-cols-[1.5fr_1fr]">
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="relative overflow-hidden rounded-panel bg-brand-gradient p-6 text-white shadow-glow sm:p-8">
      <div aria-hidden className="absolute -right-20 -top-24 size-72 rounded-full border-[30px] border-white/[0.06]" />
      
      <div className="relative">
        <h2 className="text-3xl font-bold leading-tight sm:text-4xl">สรุปการซ้อมรอบนี้</h2>
        <p className="mt-2 max-w-lg text-sm text-white/70">ไม่มีคะแนนรวม แต่ละเกณฑ์มีระดับของตัวเอง 1–4 พร้อมหลักฐานจากวิดีโอที่กดดูได้ทุกจุด</p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Chip tone="glass"><Clapperboard />คลิป {fmtDuration(result.duration_s ?? 0)}</Chip>
          {t1?.values.speech_span_s != null && <Chip tone="glass"><Clock3 />พูดจริง {fmtDuration(t1.values.speech_span_s)}</Chip>}
          {result.target_duration_s != null && <Chip tone="glass"><Target />เป้าหมาย {fmtDuration(result.target_duration_s)}</Chip>}
        </div>
        <dl className="mt-7 grid grid-cols-2 gap-3 border-t border-white/15 pt-5 sm:grid-cols-4">
          {boxes.map(([l, n, hi]) => <div key={l}>
            <dt className="flex items-center gap-1 text-xs text-white/65">{l}<HelpTip dark href="/lab/how#levels">{TERM[l]}</HelpTip></dt>
            <dd className={cn("text-3xl font-bold", hi && "text-lime")}><CountUp to={n} /><span className="ml-1 text-sm font-medium text-white/60">เกณฑ์</span></dd>
          </div>)}
        </dl>
        <p className="mt-3 text-xs text-white/55">เทียบกับรอบ {thDate(HISTORY.find((r) => r.session_id === "s_lab_8")?.created_at ?? result.created_at)} ที่ใช้เกณฑ์รุ่นเดียวกัน · ระดับที่ระบบวัดได้ ไม่ใช่หลักฐานว่าทักษะเพิ่มขึ้น</p>
      </div>
    </motion.div>
    {focus && <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }} className="card relative flex flex-col overflow-hidden p-6">
      <Chip tone="soft" className="self-start"><Lightbulb />เรื่องที่อยากให้ลองก่อน</Chip>
      <p className="mt-4 text-lg font-semibold leading-relaxed"><CoachLine text={focus.text} seek={seek} /></p>
      <div className="mt-auto flex items-end justify-between gap-3 pt-6">
        <p className="text-xs text-faint">จากโค้ช AI · อ้างเวลาจากหลักฐานเท่านั้น</p>
        <PPre pose="point" size={76} className="-mb-2 shrink-0" />
      </div>
    </motion.div>}
  </section>;
}

function CoachLine({ text, seek, dark }: { text: string; seek: Seek; dark?: boolean }) {
  return <>{splitClocks(text).map((p, i) => typeof p === "string" ? <span key={i}>{p}</span>
    : <button key={i} onClick={() => seek(p.seconds)} className={cn("mx-0.5 inline-flex items-center gap-0.5 rounded-md px-1.5 text-[0.85em] font-semibold leading-snug tabular-nums transition-colors",
      dark ? "bg-lime text-navy hover:bg-lime-300" : "bg-brand-50 text-brand hover:bg-brand hover:text-white")}>
      <Play className="size-3 fill-current" />{p.label}</button>)}</>;
}

/* ---------- 3. Skill map ---------- */

function SkillMap({ result, onPick }: { result: Result; onPick: (c: CriterionCode) => void }) {
  const by = (code: CriterionCode) => result.criteria.find((c) => c.code === code)!;
  return <section>
    <SectionTitle eyebrow="แผนที่ทักษะ" title="ภาพรวม 4 ทักษะในหน้าเดียว" />
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[400px_1fr]">
      <motion.div className="card flex flex-col items-center p-5" initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}>
        <p className="self-start font-bold">ระดับ 8 เกณฑ์</p>
        <p className="self-start text-xs text-muted">กดชื่อเกณฑ์เพื่อดูรายละเอียด</p>
        <Radar className="my-auto" criteria={result.criteria} previous={PREVIOUS_LEVELS} size={360} onPick={onPick} />
        <div className="mt-2 flex flex-wrap justify-center gap-4 text-xs text-muted">
          <span className="flex items-center gap-1.5"><span className="h-1 w-5 rounded bg-brand" />รอบนี้</span>
          <span className="flex items-center gap-1.5"><span className="h-0 w-5 border-t-2 border-dashed border-faint" />รอบก่อน</span>
          <span className="flex items-center gap-1.5"><span className="size-3 rounded-full border-[1.5px] border-dashed border-faint" />วิเคราะห์ไม่ได้</span>
        </div>
      </motion.div>
      <div className="grid gap-5 sm:grid-cols-2">
        {SKILLS.map((s, i) => <SkillTile key={s.key} skill={s.key} label={s.label} criteria={s.codes.map(by)} result={result} delay={i * 0.06} onPick={onPick} />)}
      </div>
    </div>
  </section>;
}

function SkillTile({ skill, label, criteria, result, delay, onPick }: { skill: Skill; label: string; criteria: Criterion[]; result: Result; delay: number; onPick: (c: CriterionCode) => void }) {
  return <motion.div className="card flex flex-col p-5 transition-shadow hover:shadow-lift" initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}
    transition={{ delay, duration: 0.45 }}>
    <div className="flex items-center gap-3">
      <SkillIcon skill={skill} />
      <div><p className="font-bold leading-tight">{label}</p><p className="text-xs text-muted">{SKILL_STYLE[skill].tagline}</p></div>
    </div>
    <div className="my-4 flex-1"><SkillSummaryViz skill={skill} result={result} /></div>
    <div className="space-y-1 border-t border-line pt-3">
      {criteria.map((c) => <button key={c.code} onClick={() => onPick(c.code)} className="flex w-full items-center gap-3 rounded-lg px-1.5 py-1.5 text-left hover:bg-surface">
        <span className="w-24 shrink-0 text-sm font-medium">{SHORT_NAME[c.code]}</span>
        <LevelMeter level={c.level} size="sm" className="flex-1" />
        <span className="w-5 text-right text-sm font-bold tabular-nums">{c.level ?? "?"}</span>
      </button>)}
    </div>
  </motion.div>;
}

function SkillSummaryViz({ skill, result }: { skill: Skill; result: Result }) {
  const c = (code: CriterionCode) => result.criteria.find((x) => x.code === code)!;
  const d = result.duration_s ?? 600;
  if (skill === "content") return <CoverageDonut topics={result.topics} size={96} />;
  if (skill === "time") { const t = c("T1"); return t.values.speech_span_s != null && result.target_duration_s ? <TimeGauge span={t.values.speech_span_s} target={result.target_duration_s} className="mx-auto max-w-[210px]" /> : null; }
  if (skill === "speech") return <div className="space-y-2">
    <p className="text-xs text-muted">ช่วงหยุดยาว (บน) และเสียงเติม (ล่าง) ตลอดคลิป</p>
    <MomentStrip evidence={c("S2").evidence} duration={d} color="var(--color-brand-300)" />
    <MomentStrip evidence={c("S3").evidence} duration={d} color="var(--color-brand)" />
  </div>;
  const n2 = c("N2");
  return n2.status === "ok" ? <div><p className="mb-2 text-xs text-muted">ทิศทางศีรษะ (% ของเวลา)</p><HeadShare c={n2} /></div> : null;
}

function HeadShare({ c }: { c: Criterion }) {
  const v = c.values;
  return <ShareBar parts={[
    { label: "หันตรง", pct: v.front_pct ?? 0, color: "var(--color-brand)" },
    { label: "หันข้าง", pct: v.side_pct ?? 0, color: "var(--color-brand-300)" },
    { label: "ก้ม", pct: v.down_pct ?? 0, color: "var(--color-navy)" },
    { label: "อื่น ๆ", pct: v.up_other_pct ?? 0, color: "var(--color-brand-100)" },
  ]} />;
}

/* ---------- 4. Evidence studio ---------- */

const LANES: CriterionCode[] = ["C2", "S2", "S3", "N1", "N2"];

function EvidenceStudio({ result, player }: { result: Result; player: ReturnType<typeof useFakePlayer> }) {
  const d = result.duration_s ?? 600;
  const crit = (code: CriterionCode) => result.criteria.find((c) => c.code === code)!;
  const [hover, setHover] = useState<{ x: number; text: string } | null>(null);
  const bins = useMemo(() => {
    const n = 48, out = Array(n).fill(0) as number[];
    for (const code of ["S2", "S3"] as const) for (const e of crit(code).evidence) out[Math.min(n - 1, Math.floor((e.start_s / d) * n))]++;
    const max = Math.max(...out, 1); return out.map((v) => v / max);
  }, [result]); // eslint-disable-line react-hooks/exhaustive-deps
  const highlights = useMemo(() => buildHighlights(result), [result]);
  const pct = (s: number) => `${(s / d) * 100}%`;

  return <section className="relative overflow-hidden rounded-panel bg-navy p-5 text-white sm:p-7">
    <div aria-hidden className="absolute -left-32 -top-32 size-96 rounded-full bg-brand/40 blur-3xl" />
    <SectionTitle dark eyebrow="ห้องดูหลักฐาน" title="ทุกระดับมีหลักฐาน กดดูได้ทันที" className="relative" />
    <div className="relative grid grid-cols-1 gap-5 lg:grid-cols-[1fr_320px]">
      <div className="min-w-0 space-y-4">
        <FakeVideo t={player.t} duration={d} playing={player.playing} toggle={player.toggle} />
        <div className="relative rounded-2xl bg-white/[0.04] p-4 ring-1 ring-white/10" onMouseLeave={() => setHover(null)}>
          <div className="mb-2 flex items-center justify-between text-xs text-white/60"><span>ความหนาแน่นของช่วงหยุดและเสียงเติม</span><span className="tabular-nums">{fmtDuration(player.t)} / {fmtDuration(d)}</span></div>
          <div className="flex h-8 items-end gap-[2px]">
            {bins.map((v, i) => <motion.button key={i} type="button" aria-label={`ไปที่ ${fmtDuration((i / bins.length) * d)}`} onClick={() => player.seek((i / bins.length) * d)}
              className="flex-1 rounded-t-[2px] bg-lime hover:bg-white" style={{ opacity: 0.18 + v * 0.82 }}
              initial={{ height: 2 }} whileInView={{ height: `${10 + v * 90}%` }} viewport={{ once: true }} transition={{ delay: i * 0.01 }} />)}
          </div>
          <div className="relative mt-3 space-y-2">
            {LANES.map((code) => {
              const c = crit(code);
              return <div key={code} className="grid grid-cols-[80px_1fr] items-center gap-2">
                <span className="truncate text-xs font-medium text-white/75">{SHORT_NAME[code]}</span>
                <div className="relative h-6 rounded-md bg-white/[0.07]">
                  {c.status !== "ok" && <span className="absolute inset-0 grid place-items-center rounded-md border border-dashed border-white/35 text-[11px] text-white/55">วิเคราะห์ไม่ได้</span>}
                  {c.evidence.map((e, i) => <button key={i} type="button" onClick={() => player.seek(e.start_s)}
                    onMouseEnter={(ev) => setHover({ x: (ev.currentTarget.parentElement!.offsetLeft + ev.currentTarget.offsetLeft), text: `${fmtDuration(e.start_s)} · ${e.label ?? e.note ?? SHORT_NAME[code]}` })}
                    aria-label={`${SHORT_NAME[code]} ${fmtDuration(e.start_s)} ${e.label ?? e.note ?? ""}`}
                    className="absolute inset-y-1 rounded-[3px] bg-brand-300 transition-colors hover:bg-lime focus-visible:bg-lime"
                    style={{ left: pct(e.start_s), width: `max(5px, ${pct(e.end_s - e.start_s)})` }} />)}
                </div>
              </div>;
            })}
            <div className="pointer-events-none absolute inset-y-0 left-[88px] right-0">
              <div className="absolute inset-y-[-6px] w-0.5 rounded-full bg-lime shadow-[0_0_12px_var(--color-lime)]" style={{ left: pct(player.t) }} />
            </div>
            <AnimatePresence>{hover && <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="pointer-events-none absolute -top-9 z-10 whitespace-nowrap rounded-lg bg-white px-2 py-1 text-xs font-semibold text-ink shadow-lift" style={{ left: hover.x }}>{hover.text}</motion.div>}</AnimatePresence>
          </div>
        </div>
      </div>
      <div className="min-w-0 space-y-4">
        <div className="rounded-2xl bg-white/[0.04] p-4 ring-1 ring-white/10">
          <p className="mb-3 flex items-center gap-2 font-semibold"><Zap className="size-4 text-lime" />จุดที่ควรดู</p>
          <ol className="space-y-1.5">
            {highlights.map((h, i) => <li key={i}>
              <button onClick={() => player.seek(h.s)} className="group flex w-full items-center gap-3 rounded-xl p-2 text-left transition-colors hover:bg-white/10">
                <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-lime text-xs font-bold text-navy">{i + 1}</span>
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{h.title}</span><span className="text-xs text-white/55">{SHORT_NAME[h.code]} · {fmtDuration(h.s)}</span></span>
                <Play className="size-4 text-lime opacity-0 transition-opacity group-hover:opacity-100" />
              </button>
            </li>)}
          </ol>
        </div>
        <Transcript t={player.t} seek={player.seek} />
      </div>
    </div>
  </section>;
}

function buildHighlights(r: Result) {
  const c = (code: CriterionCode) => r.criteria.find((x) => x.code === code)!;
  const out: { s: number; code: CriterionCode; title: string }[] = [];
  const s2 = [...c("S2").evidence].sort((a, b) => (b.end_s - b.start_s) - (a.end_s - a.start_s))[0];
  if (s2) out.push({ s: s2.start_s, code: "S2", title: `เงียบนานสุด ${(s2.end_s - s2.start_s).toFixed(1)} วินาที` });
  const f = c("S3").evidence; let best = 0, at = 0;
  f.forEach((e, i) => { const n = f.filter((x) => x.start_s >= e.start_s && x.start_s < e.start_s + 20).length; if (n > best) { best = n; at = i; } });
  if (f[at]) out.push({ s: f[at].start_s, code: "S3", title: `เสียงเติมถี่ ${best} ครั้งใน 20 วินาที` });
  const n1 = c("N1"); if (n1.status === "ok" && n1.evidence[0]) out.push({ s: n1.evidence[0].start_s, code: "N1", title: n1.evidence[0].note ?? "มือนิ่งนาน" });
  const n2 = c("N2").evidence[0]; if (n2) out.push({ s: n2.start_s, code: "N2", title: n2.note ?? "หันออกจากกล้อง" });
  const s1 = c("S1").evidence[0]; if (s1) out.push({ s: s1.start_s, code: "S1", title: s1.note ?? "ช่วงพูดเร็ว" });
  return out.slice(0, 5);
}

function FakeVideo({ t, duration, playing, toggle }: { t: number; duration: number; playing: boolean; toggle: () => void }) {
  return <div className="relative aspect-video overflow-hidden rounded-2xl bg-brand-gradient ring-1 ring-white/10">
    <div className="grid-lines absolute inset-0" />
    <div className="absolute bottom-0 left-1/2 -translate-x-1/2 opacity-90"><PPre pose={playing ? "point" : "idle"} size={180} color="white" /></div>
    <div className="absolute left-4 top-4 flex items-center gap-2 rounded-full bg-navy/50 px-3 py-1 text-xs font-medium backdrop-blur"><span className="size-1.5 rounded-full bg-lime" />วิดีโอตัวอย่าง (จำลอง)</div>
    <button onClick={toggle} aria-label={playing ? "หยุด" : "เล่น"} className="absolute inset-0 grid place-items-center">
      <AnimatePresence>{!playing && <motion.span initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.6, opacity: 0 }} className="grid size-16 place-items-center rounded-full bg-lime text-navy shadow-lift"><Play className="size-7 translate-x-0.5 fill-current" /></motion.span>}</AnimatePresence>
    </button>
    <div className="absolute inset-x-0 bottom-0 flex items-center gap-3 bg-gradient-to-t from-navy/85 to-transparent px-4 pb-3 pt-10">
      <button onClick={toggle} aria-label={playing ? "หยุด" : "เล่น"}>{playing ? <Pause className="size-5" /> : <Play className="size-5" />}</button>
      <div className="h-1 flex-1 rounded-full bg-white/25"><div className="h-full rounded-full bg-lime" style={{ width: `${(t / duration) * 100}%` }} /></div>
      <span className="text-xs tabular-nums">{fmtDuration(t)}</span>
    </div>
  </div>;
}

function Transcript({ t, seek }: { t: number; seek: Seek }) {
  const box = useRef<HTMLDivElement>(null);
  const activeIdx = TRANSCRIPT.findIndex((x, i) => t >= x.start_s && t < (TRANSCRIPT[i + 1]?.start_s ?? Infinity));
  useEffect(() => {
    const el = box.current?.querySelector<HTMLElement>(`[data-i="${activeIdx}"]`);
    if (el && box.current) box.current.scrollTo({ top: el.offsetTop - box.current.clientHeight / 2, behavior: "smooth" });
  }, [activeIdx]);
  return <div className="rounded-2xl bg-white/[0.04] p-4 ring-1 ring-white/10">
    <p className="mb-2 font-semibold">บทพูด</p>
    <p className="mb-2 flex flex-wrap items-center gap-2 text-[11px] text-white/55"><span className="rounded bg-lime/85 px-1 text-navy">เอ่อ</span>เสียงเติม <span className="rounded bg-white/15 px-1">⏸ 4.2 วินาที</span>หยุดยาว</p>
    <div ref={box} className="relative h-56 overflow-y-auto pr-1 text-sm leading-7 text-white/85">
      {TRANSCRIPT.map((x, i) => <span key={i} data-i={i}>
        <button onClick={() => seek(x.start_s)} className={cn("rounded px-0.5 text-left transition-colors", x.is_filler ? "bg-lime/85 font-semibold text-navy" : "hover:bg-white/10",
          i === activeIdx && "bg-white text-navy")}>{x.text}</button>
        {x.pause_after_s != null && <span className="mx-1 rounded bg-white/15 px-1 text-[11px]">⏸ {x.pause_after_s} วินาที</span>}{" "}
      </span>)}
    </div>
  </div>;
}

/* ---------- 5. Coach board ---------- */

function CoachBoard({ result, seek }: { result: Result; seek: Seek }) {
  const items = result.coach?.items ?? [];
  const col = (kind: "strength" | "focus", title: string, Icon: typeof ThumbsUp, bar: string, tile: string) =>
    <div className="card p-5">
      <p className="mb-4 flex items-center gap-2.5 font-bold"><span className={cn("grid size-8 place-items-center rounded-lg", tile)}><Icon className="size-4" /></span>{title}</p>
      <div className="space-y-3">
        {items.filter((i) => i.kind === kind).map((it, i) => <motion.div key={i} className="relative rounded-xl bg-surface py-3 pl-5 pr-4"
          initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.08 }}>
          <span className={cn("absolute inset-y-3 left-0 w-1 rounded-full", bar)} />
          {it.code && <span className="mb-1 block text-xs font-semibold text-muted">{SHORT_NAME[it.code]}</span>}
          <p className="text-sm leading-relaxed"><CoachLine text={it.text} seek={seek} /></p>
        </motion.div>)}
      </div>
    </div>;
  return <section>
    <SectionTitle eyebrow="โค้ช AI" title="ทำได้ดี และเรื่องที่ควรปรับ">
      <span className="flex items-center gap-1.5 text-xs text-muted"><Info className="size-4" />สรุปจากการ์ด ไม่เปลี่ยนระดับ และอ้างเวลาจากหลักฐานเท่านั้น</span>
    </SectionTitle>
    <div className="grid gap-5 md:grid-cols-2">
      {col("strength", "ทำได้ดี", ThumbsUp, "bg-lime", "bg-lime text-navy")}
      {col("focus", "ควรปรับ", Wrench, "bg-brand", "bg-brand-50 text-brand")}
    </div>
  </section>;
}

/* ---------- 6. Criterion cards ---------- */

function Cards({ result, active, setActive, seek, filter, setFilter }: {
  result: Result; active: CriterionCode | null; setActive: (c: CriterionCode | null) => void; seek: Seek; filter: Skill | "all"; setFilter: (f: Skill | "all") => void;
}) {
  const shown = result.criteria.filter((c) => filter === "all" || c.skill === filter);
  return <section>
    <SectionTitle eyebrow="ผลรายเกณฑ์" title="เจาะลึกทีละเกณฑ์">
      <div className="flex flex-wrap gap-1 rounded-full bg-white p-1 shadow-card">
        {[{ key: "all" as const, label: "ทั้งหมด" }, ...SKILLS].map((s) => <button key={s.key} type="button" aria-pressed={filter === s.key} onClick={() => setFilter(s.key)}
          className={cn("rounded-full px-3 py-1 text-xs font-semibold transition-colors", filter === s.key ? "bg-brand text-white" : "text-muted hover:text-ink")}>{s.label}</button>)}
      </div>
    </SectionTitle>
    <motion.div layout className="grid items-start gap-5 md:grid-cols-2">
      <AnimatePresence>
        {shown.map((c) => <CriterionCard key={c.code} c={c} result={result} open={active === c.code} toggle={() => setActive(active === c.code ? null : c.code)} seek={seek} />)}
      </AnimatePresence>
    </motion.div>
  </section>;
}

// forwardRef: AnimatePresence measures each card when the skill filter removes it
const CriterionCard = forwardRef<HTMLElement, { c: Criterion; result: Result; open: boolean; toggle: () => void; seek: Seek }>(function CriterionCard({ c, result, open, toggle, seek }, ref) {
  const meta = META[c.code];
  const word = c.level != null ? meta?.interpret?.levels[String(c.level)] : undefined;
  const scored = new Set(meta?.scored_values ?? []);
  const values = Object.entries(c.values).filter(([, v]) => v != null);
  const na = c.status !== "ok";
  return <motion.article ref={ref} id={`card-${c.code}`} layout initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
    className={cn("scroll-mt-24 overflow-hidden rounded-panel", na ? "border-[1.5px] border-dashed border-faint bg-white/60" : "bg-white shadow-card", open && "ring-2 ring-brand md:col-span-2")}>
    <button onClick={toggle} aria-expanded={open} className="flex w-full items-start gap-4 p-5 text-left">
      <SkillIcon skill={c.skill} className={na ? "bg-surface text-faint" : undefined} />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2"><b className="text-base leading-tight sm:text-lg">{CRITERION_NAME[c.code]}</b><DeltaTag before={PREVIOUS_LEVELS[c.code]} now={c.level} /></span>
        <span className="mt-0.5 block text-sm text-muted">{na ? "วิเคราะห์ไม่ได้ในรอบนี้" : word}</span>
        {!na && <LevelMeter level={c.level} className="mt-3 max-w-xs" />}
      </span>
      <LevelBadge level={c.level} />
      <ChevronDown className={cn("mt-2.5 size-5 shrink-0 text-faint transition-transform", open && "rotate-180 text-brand")} />
    </button>
    {na ? <div className="mx-5 mb-5 flex gap-3 rounded-xl bg-surface p-3 text-sm text-muted"><Info className="mt-0.5 size-4 shrink-0" /><span>{c.reason}</span></div>
      : <div className="px-5 pb-5"><CardViz c={c} result={result} seek={seek} /></div>}
    <AnimatePresence initial={false}>
      {open && !na && <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
        <div className="grid gap-5 border-t border-line bg-surface/60 p-5 md:grid-cols-3">
          <div>
            <p className="mb-2 text-xs font-semibold text-muted">ค่าที่วัดได้</p>
            <dl className="space-y-2">{values.filter(([k]) => scored.has(k)).map(([k, v]) => <Val key={k} k={k} v={v!} strong />)}</dl>
            {values.some(([k]) => !scored.has(k)) && <>
              <p className="mb-2 mt-4 text-xs font-semibold text-muted">ข้อมูลประกอบ (ไม่ใช้ตัดสินระดับ)</p>
              <dl className="space-y-1.5">{values.filter(([k]) => !scored.has(k)).map(([k, v]) => <Val key={k} k={k} v={v!} />)}</dl>
            </>}
          </div>
          <div className="space-y-3 md:col-span-2">
            {meta?.interpret?.explain && <p className="flex gap-2 text-sm text-muted"><Info className="mt-0.5 size-4 shrink-0" />{meta.interpret.explain}</p>}
            {c.feedback_id && FEEDBACK[c.feedback_id] && <div className="rounded-xl bg-white p-4 shadow-card"><p className="mb-1 flex items-center gap-1.5 text-sm font-bold text-brand"><Lightbulb className="size-4" />คำแนะนำ</p><p className="text-sm leading-relaxed">{FEEDBACK[c.feedback_id]}</p></div>}
            {c.evidence.length > 0 && <div><p className="mb-2 text-xs font-semibold text-muted">หลักฐาน ({c.evidence.length})</p>
              <div className="flex flex-wrap gap-1.5">{c.evidence.slice(0, 12).map((e, i) => <button key={i} onClick={() => seek(e.start_s)}
                className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-brand shadow-card transition-colors hover:bg-brand hover:text-white"><Play className="size-3 fill-current" /><span className="tabular-nums">{fmtDuration(e.start_s)}</span>{(e.label ?? e.note) && <span className="font-normal opacity-70">· {e.label ?? e.note}</span>}</button>)}
                {c.evidence.length > 12 && <span className="self-center text-xs text-muted">และอีก {c.evidence.length - 12} จุด</span>}</div></div>}
          </div>
        </div>
      </motion.div>}
    </AnimatePresence>
  </motion.article>;
});

function Val({ k, v, strong }: { k: string; v: number; strong?: boolean }) {
  const [label, unit] = VALUE_LABEL[k] ?? [k, ""];
  return <div className="flex items-baseline justify-between gap-3 text-sm"><dt className="text-muted">{label}</dt>
    <dd className={cn("whitespace-nowrap tabular-nums", strong && "text-lg font-bold")}>{strong ? <CountUp to={v} decimals={Number.isInteger(v) ? 0 : 1} /> : v} <span className="text-xs font-normal text-muted">{unit}</span></dd></div>;
}

function CardViz({ c, result, seek }: { c: Criterion; result: Result; seek: Seek }): ReactNode {
  const d = result.duration_s ?? 600;
  switch (c.code) {
    case "C1": return <OrderFlow topics={result.topics} />;
    case "C2": return <CoverageDonut topics={result.topics} size={104} />;
    case "S1": { const band = META.S1?.levels?.["4"]?.syllables_per_s as [number, number] | undefined; return band ? <SpeedRuler value={c.values.syllables_per_s ?? 0} band={band} /> : null; }
    case "S2": case "S3": return <div><MomentStrip evidence={c.evidence} duration={d} onSeek={seek} />
      <p className="mt-1.5 text-xs text-muted">{c.code === "S2" ? `${c.values.long_pauses_per_min} ครั้ง/นาที · นานสุด ${c.values.max_pause_s} วินาที` : `${c.values.fillers_per_min} ครั้ง/นาที`} · กดแถบเพื่อดูช่วงนั้น</p></div>;
    case "N1": return <div><MomentStrip evidence={c.evidence} duration={d} onSeek={seek} />
      <p className="mt-1.5 text-xs text-muted">ช่วงมือนิ่งต่อเนื่อง {c.values.long_still_per_min} ครั้ง/นาที · นานสุด {c.values.max_still_s} วินาที</p></div>;
    case "N2": return <HeadShare c={c} />;
    case "T1": return c.values.speech_span_s != null && result.target_duration_s ? <TimeGauge span={c.values.speech_span_s} target={result.target_duration_s} className="max-w-[230px]" /> : null;
  }
}

/* ---------- 7. Mission ---------- */

function Mission({ result, seek }: { result: Result; seek: Seek }) {
  const plans = result.coach?.items.filter((i) => i.kind === "plan") ?? [];
  const [done, toggle] = useMissions(); // same ticks as the dashboard card
  const all = plans.length > 0 && plans.every((_, i) => done.includes(i));
  return <section className="relative overflow-hidden rounded-panel bg-navy p-6 text-white sm:p-10">
    <div className="grid-lines absolute inset-0 [mask-image:linear-gradient(to_right,transparent,black)]" />
    <div aria-hidden className="absolute -right-24 -top-24 size-80 rounded-full bg-brand/50 blur-3xl" />
    <div className="relative grid items-center gap-8 md:grid-cols-[1fr_auto]">
      <div>
        <Chip tone="lime"><Flag />เป้าหมายรอบถัดไป</Chip>
        <h2 className="mt-4 text-3xl font-bold sm:text-4xl">ซ้อมอีกรอบ โฟกัสทีละเรื่อง</h2>
        <ul className="mt-6 space-y-2.5">
          {plans.map((p, i) => { const on = done.includes(i);
            return <li key={i}>
              <label className={cn("flex cursor-pointer items-start gap-3 rounded-2xl p-4 transition-colors", on ? "bg-white/[0.04] text-white/50" : "bg-white/[0.08] hover:bg-white/[0.12]")}>
                <input type="checkbox" className="peer sr-only" checked={on} onChange={() => toggle(i)} />
                <span className={cn("mt-0.5 grid size-6 shrink-0 place-items-center rounded-lg peer-focus-visible:outline-3 peer-focus-visible:outline-lime", on ? "bg-lime text-navy" : "ring-1 ring-inset ring-white/40")}>
                  {on && <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }}><Check className="size-4" /></motion.span>}</span>
                <span className={cn("text-sm leading-relaxed", on && "line-through")}><CoachLine text={p.text} seek={seek} dark /></span>
              </label>
            </li>; })}
        </ul>
        <Button size="xl" variant="lime" className="mt-8" asChild><Link to="/lab/new">ซ้อมรอบใหม่ <ArrowRight /></Link></Button>
      </div>
      <PPre pose={all ? "celebrate" : "idle"} size={150} color="white" className="mx-auto" saySide="top" say={all ? "พร้อมแล้ว ไปซ้อมกัน" : undefined} />
    </div>
  </section>;
}

