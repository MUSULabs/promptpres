/* /sessions/:id: the result of one round (useSessionResult asks every 4 s until it is done).
   Before it is done: waiting / failed / not sent views. When done: a reveal (first time this round is opened,
   skippable), the stage-lights moment if this round lit this week's light, then the summary, skill map, evidence
   room (real video, timeline, transcript), coach, the 8 cards and the goals for the next round.
   Badges ↑ = ↓ compare with the previous finished round of a comparable rubric only (trend.ts previousRun). */
import { createContext, forwardRef, useCallback, useContext, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from "motion/react";
import confetti from "canvas-confetti";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeftRight, ArrowRight, Check, ChevronDown, Clapperboard, Clock3, Flag, Info, Lightbulb, Play, RefreshCw, Target, ThumbsUp, VideoOff, Wrench, Zap,
} from "lucide-react";
import { api } from "@/api";
import type { CriteriaMeta, Criterion, CriterionCode, CriterionMeta, Result, SessionRow, Skill, Topic, TranscriptItem } from "@/contract";
import { COVERAGE_LABEL, CRITERION_NAME, SKILLS, VALUE_LABEL, fmtDuration, fmtTime, splitClocks } from "@/presentation";
import { MIXED_RUBRIC_NOTE, previousRun } from "@/trend";
import { useSessionResult } from "@/useSessionResult";
import { Button, Chip, SectionTitle, SHORT_NAME, SKILL_STYLE, SkillIcon, cn } from "@/v2/ui";
import { Shell } from "@/v2/Shell";
import { PPre } from "@/v2/PPre";
import { CountUp, CoverageDonut, DeltaTag, LevelBadge, LevelMeter, MomentStrip, OrderFlow, Radar, ShareBar, SpeedRuler, TimeGauge } from "@/v2/viz";
import { StageLights } from "@/v2/StageLights";
import { EmptyState, ErrorPanel, HelpTip, Skeleton, SkipButton, useFocusTrap } from "@/v2/states";
import { useMissions } from "@/v2/prefs";
import { MAX_LIGHTS, firstOfItsWeek, stageLights, weekIndex, type StageState } from "@/v2/streak";
import { rehearsals, useSessions } from "@/v2/sessions";
import { PATH } from "@/v2/paths";
import { thDate } from "@/v2/time";
import { t1Bands } from "@/v2/criteriaMeta";
import { FailedView, NotSentView, WaitingView } from "./Waiting";

/** Jump the video to a time. null = no playable video: times are shown as text, not buttons. */
type Seek = ((s: number) => void) | null;
type Levels = Partial<Record<CriterionCode, number | null>>;

const TERM: Record<string, string> = {
  "ดีขึ้นจากรอบก่อน": "ระดับที่ระบบวัดได้ในรอบนี้สูงกว่ารอบก่อน (เกณฑ์รุ่นที่เทียบกันได้) ไม่ใช่หลักฐานว่าทักษะเพิ่มขึ้น อาจมาจากหัวข้อ ห้อง หรือกล้องที่ต่างกัน",
  "คงที่": "ระดับเท่ากับรอบก่อน (เกณฑ์รุ่นเดียวกัน)",
  "ลดลงจากรอบก่อน": "ระดับที่ระบบวัดได้ต่ำกว่ารอบก่อน ใช้เป็นสัญญาณให้ไปดูหลักฐาน ไม่ใช่คำตัดสิน หัวข้อ ห้อง หรือกล้องที่ต่างกันก็มีผล",
  "เทียบไม่ได้": "รอบก่อนวิเคราะห์เกณฑ์นี้ไม่ได้ หรือยังไม่มีรอบก่อนที่ใช้เกณฑ์รุ่นเดียวกัน",
  "วิเคราะห์ไม่ได้": "ระบบมีข้อมูลไม่พอจะวัดเกณฑ์นี้อย่างยุติธรรม เช่น มองไม่เห็นมือหรือใบหน้า จึงไม่ให้ระดับ (ไม่ใช่ระดับ 1) การ์ดจะบอกเหตุผล",
};

/* What the parts of the page share: config texts from the API, the previous round for the badges. */
interface Ctx {
  meta: CriteriaMeta; fb: Record<string, string>; metaStatus: "loading" | "ready" | "failed"; retryMeta: () => void;
  prev: Levels | undefined; prevRow: SessionRow | null;
}
const R = createContext<Ctx>({ meta: {}, fb: {}, metaStatus: "loading", retryMeta: () => {}, prev: undefined, prevRow: null });
const useR = () => useContext(R);

/** Short reading of a card: the interpret word for its level, plus slow/fast (range) or over/under (sign). */
function readCard(c: Criterion, meta?: CriterionMeta): { word: string; detail?: string } | null {
  const interpret = meta?.interpret;
  if (!interpret || c.status !== "ok" || c.level == null) return null;
  const word = interpret.levels[String(c.level)] ?? "";
  let detail: string | undefined;
  const key = meta?.scored_values[0];
  const band = key ? meta?.levels?.["4"]?.[key] : undefined;
  const value = key ? c.values[key] : null;
  if (interpret.range && Array.isArray(band) && value != null) {
    const [low, high] = band as [number, number];
    detail = value < low ? interpret.range.below : value > high ? interpret.range.above : interpret.range.within;
  }
  const signed = interpret.sign ? c.values[interpret.sign.key] : null;
  if (interpret.sign && signed != null && signed !== 0) detail = signed > 0 ? interpret.sign.above : interpret.sign.below;
  return { word, detail };
}

export default function ResultPage() {
  const { id = "" } = useParams();
  return <ResultRoute key={id} id={id} />;
}

function ResultRoute({ id }: { id: string }) {
  const data = useSessionResult(id);
  const { res, err, retry, reconnecting, now } = data;
  const frame = (title: string, body: ReactNode) => <Shell page="result" title={title}>{body}</Shell>;
  if (err?.status === 404) return frame("ไม่พบรอบซ้อม", <EmptyState pose="think" title="ไม่พบรอบซ้อมนี้" action={<Button asChild><Link to={PATH.history}>ไปที่ประวัติการซ้อม</Link></Button>}>ลิงก์อาจผิด หรือรอบนี้เป็นของบัญชีอื่น</EmptyState>);
  if (err?.status === 409) return <NotSentView id={id} />;
  if (err) return frame("ผลการซ้อม", <ErrorPanel what="โหลดผลไม่สำเร็จ" why={err.message} todo="ตรวจการเชื่อมต่อแล้วลองใหม่" actions={<Button size="sm" onClick={retry}><RefreshCw />ลองใหม่</Button>} />);
  if (!res) return frame("ผลการซ้อม", <div className="space-y-5" role="status" aria-label="กำลังโหลดผล">
    {reconnecting && <ErrorPanel tone="info" what="กำลังเชื่อมต่อใหม่…" todo="หน้านี้จะลองใหม่เอง" />}
    <Skeleton className="h-56 rounded-panel" /><Skeleton className="h-96 rounded-panel" /></div>);
  if (res.status === "queued" || res.status === "processing") return <WaitingView res={res} now={now} reconnecting={reconnecting} />;
  if (res.status === "failed") return <FailedView res={res} />;
  if (res.status !== "done") return <NotSentView id={id} />;
  return <ResultView result={res} data={data} />;
}

const SEEN = "pp-v2-reveal-seen"; // rounds whose reveal already played (this tab)
const seenReveal = (id: string) => { try { return (window.sessionStorage.getItem(SEEN) ?? "").split(",").includes(id); } catch { return false; } };
const rememberReveal = (id: string) => { try { const v = (window.sessionStorage.getItem(SEEN) ?? "").split(",").filter(Boolean); window.sessionStorage.setItem(SEEN, [...v, id].slice(-30).join(",")); } catch { /* storage blocked */ } };

function ResultView({ result, data }: { result: Result; data: ReturnType<typeof useSessionResult> }) {
  const { rows, error: listError, reload } = useSessions();
  const mine = useMemo(() => rehearsals(rows), [rows]);
  const prevRow = useMemo(() => previousRun(mine, result.session_id, result.versions.rubric), [mine, result]);
  const ctx: Ctx = { meta: data.meta, fb: data.fb, metaStatus: data.metaStatus, retryMeta: data.retryMeta, prev: prevRow?.levels ?? undefined, prevRow };
  const stage = useMemo(() => stageLights(mine, new Date()), [mine]);
  // the stage-light moment belongs to the round that lit this week's light, not to an old round opened later
  const litThisRound = firstOfItsWeek(mine, result.session_id) && stage.practicedThisWeek
    && weekIndex(new Date(result.created_at)) === weekIndex(new Date());
  // The round list refreshes more slowly than this page: a round that has just finished may still be listed as
  // "processing", so the reveal would miss the previous round and this week's light. Ask once more, and start the
  // reveal when the list knows this round is done (or cannot be loaded).
  const listed = !!rows?.some((r) => r.session_id === result.session_id && r.status === "done");
  const [staleRows, setStaleRows] = useState<SessionRow[] | null | undefined>(undefined);
  useEffect(() => {
    if (rows && !listed && staleRows === undefined) { setStaleRows(rows); reload(); }
  }, [rows, listed, staleRows, reload]);
  const listReady = listed || listError != null || (rows !== null && staleRows !== undefined && rows !== staleRows);
  const [phase, setPhase] = useState<"reveal" | "stage" | "done">(() => (seenReveal(result.session_id) ? "done" : "reveal"));
  useEffect(() => { if (phase !== "reveal") rememberReveal(result.session_id); }, [phase, result.session_id]);
  const [filter, setFilter] = useState<Skill | "all">("all");
  const [active, setActive] = useState<CriterionCode | null>(null);
  const player = useVideo();
  const studio = useRef<HTMLDivElement>(null);
  const seek: Seek = player.ready ? (s) => { player.seek(s); studio.current?.scrollIntoView({ behavior: "smooth", block: "start" }); } : null;
  const date = thDate(result.created_at, { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const pick = (c: CriterionCode) => {
    setFilter("all"); setActive(c); // the card may be hidden by the skill filter: show all first
    window.setTimeout(() => document.getElementById(`card-${c}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 60);
  };

  return <R.Provider value={ctx}><Shell page="result" title="ผลการซ้อม" subtitle={`รอบวันที่ ${date}`}>
    <AnimatePresence>
      {phase === "reveal" && listReady && <Reveal key="r" result={result} onDone={() => setPhase(litThisRound ? "stage" : "done")} onSkip={() => setPhase("done")} />}
      {phase === "stage" && <StageMoment key="s" stage={stage} onDone={() => setPhase("done")} />}
    </AnimatePresence>

    <div className="mb-5 flex flex-wrap items-center gap-2 text-sm">
      <Button size="sm" variant="ghost" onClick={() => setPhase("reveal")}><RefreshCw />เล่นฉากเปิดผลอีกครั้ง</Button>
      {prevRow && <Button size="sm" variant="soft" asChild className="ml-auto"><Link to={PATH.compare(prevRow.session_id, result.session_id)}><ArrowLeftRight />เทียบกับรอบก่อน</Link></Button>}
    </div>
    {data.metaStatus === "failed" && <ErrorPanel tone="info" className="mb-5" what="โหลดคำอธิบายระดับและคำแนะนำไม่สำเร็จ" why="ระดับ ค่าที่วัดได้ และหลักฐานยังครบ แต่คำอ่านและคำแนะนำของแต่ละเกณฑ์ยังไม่ขึ้น"
      actions={<Button size="sm" variant="soft" onClick={data.retryMeta}><RefreshCw />ลองโหลดอีกครั้ง</Button>} />}

    <div className="space-y-6">
      <Hero result={result} seek={seek} />
      <SkillMap result={result} onPick={pick} />
      <div ref={studio} className="scroll-mt-24"><EvidenceStudio result={result} player={player} /></div>
      <CoachBoard result={result} seek={seek} />
      <Cards result={result} active={active} setActive={setActive} seek={seek} filter={filter} setFilter={setFilter} />
      <Mission result={result} seek={seek} />
    </div>
  </Shell></R.Provider>;
}

/* ---------- The real video: one <video>, retried a few times (a just-finished video may need a moment) ---------- */

const PLAYER_RETRY_MS = [2_000, 5_000, 10_000];

function useVideo() {
  const el = useRef<HTMLVideoElement | null>(null);
  const [t, setT] = useState(0);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const seek = useCallback((s: number) => {
    const v = el.current; if (!v) return;
    v.currentTime = Math.max(0, s);
    void v.play().catch(() => {}); // autoplay may be refused: the time still moves
    setT(v.currentTime);
  }, []);
  return { el, t, setT, ready, setReady, playing, setPlaying, seek };
}
type Player = ReturnType<typeof useVideo>;

function SessionVideo({ url, player }: { url: string; player: Player }) {
  const [attempt, setAttempt] = useState(0);
  const [waiting, setWaiting] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!waiting) return;
    const timer = setTimeout(() => { setWaiting(false); setAttempt((n) => n + 1); }, PLAYER_RETRY_MS[attempt]);
    return () => clearTimeout(timer);
  }, [waiting, attempt]);
  if (failed) return <div className="grid aspect-video place-items-center rounded-2xl bg-white/[0.06] p-6 text-center ring-1 ring-white/10">
    <div><VideoOff className="mx-auto size-8 text-white/60" /><p className="mt-3 text-sm text-white/80">เปิดวิดีโอของรอบนี้ไม่ได้ คุณยังอ่านเวลาในหลักฐานและข้อเสนอแนะได้</p>
      <Button size="sm" variant="outlineLight" className="mt-4" onClick={() => { setAttempt(0); setFailed(false); }}><RefreshCw />ลองเปิดวิดีโออีกครั้ง</Button></div>
  </div>;
  const src = attempt ? `${url}${url.includes("?") ? "&" : "?"}retry=${attempt}` : url;
  return <div className="relative">
    <video key={attempt} ref={player.el} className="aspect-video w-full rounded-2xl bg-black ring-1 ring-white/10" controls playsInline preload="metadata" src={src}
      aria-label="วิดีโอการซ้อม" onLoadedMetadata={() => player.setReady(true)} onTimeUpdate={(e) => player.setT(e.currentTarget.currentTime)}
      onPlay={() => player.setPlaying(true)} onPause={() => player.setPlaying(false)}
      onError={() => { player.setReady(false); if (attempt < PLAYER_RETRY_MS.length) { setWaiting(true); return; } setFailed(true); }} />
    {waiting && <p className="absolute inset-x-3 top-3 rounded-xl bg-navy/80 px-3 py-2 text-xs text-white backdrop-blur" role="status">กำลังลองเปิดวิดีโออีกครั้ง…</p>}
  </div>;
}

/** A time from the evidence: a button that seeks when the video plays, plain text otherwise. */
function TimeChip({ start, end, seek, note, className }: { start: number; end?: number; seek: Seek; note?: string | null; className?: string }) {
  const label = end == null || end - start < 0.05 ? fmtTime(start) : `${fmtTime(start)} – ${fmtTime(end)}`;
  const body = <><Play className="size-3 fill-current" /><span className="tabular-nums">{label}</span>{note && <span className="font-normal opacity-70">· {note}</span>}</>;
  return seek ? <button type="button" onClick={() => seek(start)} aria-label={`ไปยังเวลา ${label}${note ? ` ${note}` : ""}`}
    className={cn("inline-flex min-h-8 items-center gap-1 rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-brand shadow-card transition-colors hover:bg-brand hover:text-white", className)}>{body}</button>
    : <span className={cn("inline-flex min-h-8 items-center gap-1 rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-muted ring-1 ring-inset ring-line", className)} data-time-text>
      <Clock3 className="size-3" /><span className="tabular-nums">{label}</span>{note && <span className="font-normal opacity-70">· {note}</span>}</span>;
}

/* ---------- 1. Reveal ---------- */

function Reveal({ result, onDone, onSkip }: { result: Result; onDone: () => void; onSkip: () => void }) {
  const still = useReducedMotion();
  const ok = result.criteria.filter((c) => c.status === "ok").length;
  const { prev } = useR();
  const improved = result.criteria.filter((c) => c.level != null && prev?.[c.code] != null && c.level > prev[c.code]!);
  const box = useRef<HTMLDivElement>(null);
  useFocusTrap(box, useIsPresent());              // keyboard stays on the overlay until it starts to close
  const finish = useRef(onDone);
  finish.current = onDone;                       // the timer calls the latest one (the round list may refresh meanwhile)
  useEffect(() => {
    if (still) { finish.current(); return; }
    // celebrate finishing a round (practice), never a level going up
    const fire = window.setTimeout(() => {
      confetti({ particleCount: 110, spread: 80, origin: { y: 0.62 }, colors: ["#2823ef", "#d4f53c", "#ffffff", "#9491f7"], scalar: 0.9 });
    }, 1300);
    const end = window.setTimeout(() => finish.current(), 4600);
    return () => { window.clearTimeout(fire); window.clearTimeout(end); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return <motion.div ref={box} role="dialog" aria-modal="true" aria-label="ผลการซ้อมรอบนี้" className="bg-navy-gradient fixed inset-0 z-[60] grid place-items-center overflow-hidden px-6 text-white"
    initial={{ opacity: 1 }} exit={{ clipPath: "circle(0% at 50% 50%)", transition: { duration: 0.6, ease: [0.7, 0, 0.3, 1] } }}
    style={{ clipPath: "circle(150% at 50% 50%)" }}>
    <div className="grid-lines pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_70%)]" />
    <SkipButton onSkip={onSkip} label="ข้ามไปดูผล" />
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
  const before = stage.weeks.at(-2)?.lights ?? 0;
  const kept = before >= stage.lights; // already full last week: replay the power-up instead of claiming a new light
  const full = stage.lights >= MAX_LIGHTS;
  const box = useRef<HTMLDivElement>(null);
  useFocusTrap(box, useIsPresent());
  return <motion.div ref={box} className="fixed inset-0 z-[60] grid place-items-center overflow-y-auto bg-navy-950 px-5 py-10 text-white"
    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.4 } }} role="dialog" aria-modal="true" aria-label="ไฟเวทีสัปดาห์นี้">
    <SkipButton onSkip={onDone} />
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
  const { prev: PREVIOUS_LEVELS, prevRow } = useR();
  const t1 = result.criteria.find((c) => c.code === "T1");
  const focus = result.coach?.items.find((i) => i.kind === "focus");
  // every one of the 8 criteria lands in exactly one box
  const counts = result.criteria.reduce((a, c) => {
    const p = PREVIOUS_LEVELS?.[c.code];
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
          {result.duration_s != null && <Chip tone="glass"><Clapperboard />คลิป {fmtDuration(result.duration_s)}</Chip>}
          {t1?.values.speech_span_s != null && <Chip tone="glass"><Clock3 />พูดจริง {fmtDuration(t1.values.speech_span_s)}</Chip>}
          {result.target_duration_s != null && <Chip tone="glass"><Target />เป้าหมาย {fmtDuration(result.target_duration_s)}</Chip>}
        </div>
        <dl className="mt-7 grid grid-cols-2 gap-3 border-t border-white/15 pt-5 sm:grid-cols-4">
          {boxes.map(([l, n, hi]) => <div key={l}>
            <dt className="flex items-center gap-1 text-xs text-white/65">{l}<HelpTip dark href={`${PATH.how}#levels`}>{TERM[l]}</HelpTip></dt>
            <dd className={cn("text-3xl font-bold", hi && "text-lime")}><CountUp to={n} /><span className="ml-1 text-sm font-medium text-white/60">เกณฑ์</span></dd>
          </div>)}
        </dl>
        <p className="mt-3 text-xs text-white/55">{prevRow ? `เทียบกับรอบ ${thDate(prevRow.created_at)} ที่ใช้เกณฑ์รุ่นที่เทียบกันได้` : "ยังไม่มีรอบก่อนที่ใช้เกณฑ์รุ่นที่เทียบกันได้"} · ระดับที่ระบบวัดได้ ไม่ใช่หลักฐานว่าทักษะเพิ่มขึ้น</p>
        {prevRow && prevRow.rubric_version !== result.versions.rubric && <p className="mt-1 text-xs text-white/55" data-rubric-note>{MIXED_RUBRIC_NOTE}</p>}
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
    : seek ? <button key={i} type="button" onClick={() => seek(p.seconds)} aria-label={`ไปยังเวลา ${p.label} ที่โค้ชอ้าง`} className={cn("mx-0.5 inline-flex items-center gap-0.5 rounded-md px-1.5 text-[0.85em] font-semibold leading-snug tabular-nums transition-colors",
      dark ? "bg-lime text-navy hover:bg-lime-300" : "bg-brand-50 text-brand hover:bg-brand hover:text-white")}>
      <Play className="size-3 fill-current" />{p.label}</button>
    : <span key={i} className={cn("mx-0.5 rounded-md px-1.5 text-[0.85em] font-semibold tabular-nums", dark ? "bg-white/10" : "bg-surface text-muted")}>{p.label}</span>)}</>;
}

/* ---------- 3. Skill map ---------- */

function SkillMap({ result, onPick }: { result: Result; onPick: (c: CriterionCode) => void }) {
  const { prev } = useR();
  const by = (code: CriterionCode) => result.criteria.find((c) => c.code === code);
  return <section>
    <SectionTitle eyebrow="แผนที่ทักษะ" title="ภาพรวม 4 ทักษะในหน้าเดียว" />
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[400px_1fr]">
      <motion.div className="card flex flex-col items-center p-5" initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}>
        <p className="self-start font-bold">ระดับ 8 เกณฑ์</p>
        <p className="self-start text-xs text-muted">กดชื่อเกณฑ์เพื่อดูรายละเอียด</p>
        <Radar className="my-auto" criteria={result.criteria} previous={prev} size={360} onPick={onPick} />
        <div className="mt-2 flex flex-wrap justify-center gap-4 text-xs text-muted">
          <span className="flex items-center gap-1.5"><span className="h-1 w-5 rounded bg-brand" />รอบนี้</span>
          {prev && <span className="flex items-center gap-1.5"><span className="h-0 w-5 border-t-2 border-dashed border-faint" />รอบก่อน</span>}
          <span className="flex items-center gap-1.5"><span className="size-3 rounded-full border-[1.5px] border-dashed border-faint" />วิเคราะห์ไม่ได้</span>
        </div>
      </motion.div>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        {SKILLS.map((s, i) => <SkillTile key={s.key} skill={s.key} label={s.label} criteria={s.codes.map(by).filter((c): c is Criterion => !!c)} result={result} delay={i * 0.06} onPick={onPick} />)}
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
      {criteria.map((c) => <button key={c.code} type="button" onClick={() => onPick(c.code)} className="flex min-h-10 w-full items-center gap-3 rounded-lg px-1.5 py-1.5 text-left hover:bg-surface">
        <span className="w-24 shrink-0 text-sm font-medium">{SHORT_NAME[c.code]}</span>
        <LevelMeter level={c.level} size="sm" className="flex-1" />
        <span className="w-5 text-right text-sm font-bold tabular-nums">{c.level ?? "?"}</span>
      </button>)}
    </div>
  </motion.div>;
}

function SkillSummaryViz({ skill, result }: { skill: Skill; result: Result }) {
  const { meta } = useR();
  const c = (code: CriterionCode) => result.criteria.find((x) => x.code === code) ?? EMPTY(code);
  const d = clipLength(result);
  if (skill === "content") return result.topics.length > 0 && c("C2").status === "ok" ? <CoverageDonut topics={result.topics} size={96} /> : <p className="text-xs text-muted">ข้ามหัวข้อหรือวิเคราะห์เนื้อหาไม่ได้ในรอบนี้</p>;
  if (skill === "time") { const t = c("T1"); return t.values.speech_span_s != null && result.target_duration_s ? <TimeGauge span={t.values.speech_span_s} target={result.target_duration_s} bands={t1Bands(meta)} className="mx-auto max-w-[210px]" /> : null; }
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

/** Where evidence sits on a timeline: the clip length, or (if the length is missing) the end of the last evidence,
    so the marks keep their order and spacing instead of sitting on a made-up 10-minute clip. */
function clipLength(r: Result): number {
  return r.duration_s || Math.max(1, ...r.criteria.flatMap((c) => c.evidence.map((e) => e.end_s)));
}

const EMPTY = (code: CriterionCode): Criterion => ({ code, skill: "content", status: "unanalyzable", level: null, values: {}, evidence: [], feedback_id: null, reason: null });

function EvidenceStudio({ result, player }: { result: Result; player: Player }) {
  const d = clipLength(result);
  const crit = (code: CriterionCode) => result.criteria.find((c) => c.code === code) ?? EMPTY(code);
  const seek: Seek = player.ready ? player.seek : null;
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
        {result.video_url ? <SessionVideo url={result.video_url} player={player} />
          : <div className="grid aspect-video place-items-center rounded-2xl bg-white/[0.06] p-6 text-center ring-1 ring-white/10" data-no-video>
            <div><VideoOff className="mx-auto size-8 text-white/60" /><p className="mt-3 font-semibold">รอบนี้ไม่มีวิดีโอสำหรับเปิดดู</p>
              <p className="mt-1 text-sm text-white/65">ระบบลบวิดีโออัตโนมัติ (Guest 7 วัน สมาชิก 30 วัน) ผล หลักฐาน และคำแนะนำยังอ่านได้ครบ</p></div>
          </div>}
        <div className="relative rounded-2xl bg-white/[0.04] p-4 ring-1 ring-white/10" onMouseLeave={() => setHover(null)} aria-label="แถบเวลาหลักฐานทุกเกณฑ์" role="group" data-playing={player.playing ? "true" : "false"}>
          <div className="mb-2 flex items-center justify-between text-xs text-white/60"><span>ความหนาแน่นของช่วงหยุดและเสียงเติม</span><span className="tabular-nums">{fmtDuration(player.t)}{result.duration_s != null && <> / {fmtDuration(result.duration_s)}</>}</span></div>
          <div className="flex h-8 items-end gap-[2px]">
            {/* without a video the bars and markers only show where things happened: plain shapes, not buttons */}
            {bins.map((v, i) => { const bar = { className: "flex-1 rounded-t-[2px] bg-lime hover:bg-white", style: { opacity: 0.18 + v * 0.82 },
              initial: { height: 2 }, whileInView: { height: `${10 + v * 90}%` }, viewport: { once: true }, transition: { delay: i * 0.01 } };
              return seek ? <motion.button key={i} type="button" aria-label={`ไปที่ ${fmtDuration((i / bins.length) * d)}`} onClick={() => seek((i / bins.length) * d)} {...bar} />
                : <motion.span key={i} aria-hidden {...bar} />; })}
          </div>
          <div className="relative mt-3 space-y-2">
            {LANES.map((code) => {
              const c = crit(code);
              return <div key={code} className="grid grid-cols-[80px_1fr] items-center gap-2">
                <span className="truncate text-xs font-medium text-white/75">{SHORT_NAME[code]}</span>
                <div className="relative h-6 rounded-md bg-white/[0.07]">
                  {c.status !== "ok" && <span className="absolute inset-0 grid place-items-center rounded-md border border-dashed border-white/35 text-[11px] text-white/55">วิเคราะห์ไม่ได้</span>}
                  {c.evidence.map((e, i) => { const mark = {
                    onMouseEnter: (ev: MouseEvent<HTMLElement>) => setHover({ x: (ev.currentTarget.parentElement!.offsetLeft + ev.currentTarget.offsetLeft), text: `${fmtDuration(e.start_s)} · ${e.label ?? e.note ?? SHORT_NAME[code]}` }),
                    className: "absolute inset-y-1 rounded-[3px] bg-brand-300 transition-colors hover:bg-lime focus-visible:bg-lime",
                    style: { left: pct(e.start_s), width: `max(5px, ${pct(e.end_s - e.start_s)})` } };
                    return seek ? <button key={i} type="button" onClick={() => seek(e.start_s)} aria-label={`ไปยังเวลา ${fmtTime(e.start_s)} (${code} ${SHORT_NAME[code]}) ${e.label ?? e.note ?? ""}`} {...mark} />
                      : <span key={i} aria-hidden {...mark} />; })}
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
          {highlights.length === 0 && <p className="text-sm text-white/60">รอบนี้ไม่มีจุดเด่นจากหลักฐานให้ดู</p>}
          <ol className="space-y-1.5">
            {highlights.map((h, i) => {
              const body = <>
                <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-lime text-xs font-bold text-navy">{i + 1}</span>
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{h.title}</span><span className="text-xs text-white/55">{SHORT_NAME[h.code]} · {fmtDuration(h.s)}</span></span>
              </>;
              // without a playable video the list only names the moments (no buttons that do nothing)
              return <li key={i}>{seek
                ? <button type="button" onClick={() => seek(h.s)} className="group flex w-full items-center gap-3 rounded-xl p-2 text-left transition-colors hover:bg-white/10">
                  {body}<Play className="size-4 text-lime opacity-0 transition-opacity group-hover:opacity-100" /></button>
                : <div className="flex items-center gap-3 p-2">{body}</div>}</li>;
            })}
          </ol>
          {highlights.length > 0 && !seek && <p className="mt-2 text-xs text-white/55">{result.video_url ? "กดได้เมื่อวิดีโอโหลดเสร็จ" : "รอบนี้ไม่มีวิดีโอให้เปิด จึงดูได้เฉพาะเวลา"}</p>}
        </div>
        <Transcript id={result.session_id} t={player.t} seek={seek} />
      </div>
    </div>
  </section>;
}

function buildHighlights(r: Result) {
  const c = (code: CriterionCode) => r.criteria.find((x) => x.code === code) ?? EMPTY(code);
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

/** GET /api/sessions/{id}/transcript: fillers marked, long pauses shown, each phrase seeks the video. */
function Transcript({ id, t, seek }: { id: string; t: number; seek: Seek }) {
  const [items, setItems] = useState<TranscriptItem[] | null | "error">(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    setItems(null);
    api.transcript(id, c.signal).then(setItems).catch(() => { if (!c.signal.aborted) setItems("error"); });
    return () => c.abort();
  }, [id, attempt]);
  const box = useRef<HTMLDivElement>(null);
  const list = Array.isArray(items) ? items : [];
  const activeIdx = list.findIndex((x, i) => t >= x.start_s && t < (list[i + 1]?.start_s ?? Infinity));
  useEffect(() => {
    const el = box.current?.querySelector<HTMLElement>(`[data-i="${activeIdx}"]`);
    if (el && box.current) box.current.scrollTo({ top: el.offsetTop - box.current.clientHeight / 2, behavior: "smooth" });
  }, [activeIdx]);
  return <div className="rounded-2xl bg-white/[0.04] p-4 ring-1 ring-white/10" data-transcript>
    <p className="mb-2 font-semibold">บทพูดที่ถอดเสียง</p>
    <p className="mb-2 flex flex-wrap items-center gap-2 text-[11px] text-white/55"><mark className="rounded bg-lime/85 px-1 text-navy">เอ่อ</mark>เสียงเติม <span className="rounded bg-white/15 px-1">⏸ เงียบ 4.2 วินาที</span>หยุดยาว</p>
    {items === null ? <div className="space-y-2" role="status" aria-label="กำลังโหลดบทพูด">{[0, 1, 2, 3].map((i) => <Skeleton key={i} dark className="h-4" />)}</div>
      : items === "error" ? <div className="text-sm text-white/70">โหลดบทพูดไม่สำเร็จ <button type="button" onClick={() => setAttempt((n) => n + 1)} className="ml-1 font-semibold text-lime hover:underline">ลองใหม่</button></div>
      : list.length === 0 ? <p className="text-sm text-white/60">รอบนี้ไม่มีบทพูดที่ถอดเสียงได้</p>
      : <div ref={box} className="relative h-56 overflow-y-auto pr-1 text-sm leading-7 text-white/85">
        {list.map((x, i) => { const cls = cn("rounded px-0.5 text-left transition-colors", x.is_filler && "bg-lime/85 font-semibold text-navy", i === activeIdx && "bg-white text-navy");
          return <span key={i} data-i={i}>
            {seek ? <button type="button" onClick={() => seek(x.start_s)} data-playing={i === activeIdx || undefined} className={cn(cls, !x.is_filler && "hover:bg-white/10")}>{x.is_filler ? <mark className="bg-transparent text-inherit">{x.text}</mark> : x.text}</button>
              : <span className={cls}>{x.is_filler ? <mark className="bg-transparent text-inherit">{x.text}</mark> : x.text}</span>}
            {x.pause_after_s != null && <span className="mx-1 rounded bg-white/15 px-1 text-[11px]">⏸ เงียบ {x.pause_after_s.toFixed(1)} วินาที</span>}{" "}
          </span>; })}
      </div>}
  </div>;
}

/* ---------- 5. Coach board ---------- */

function CoachBoard({ result, seek }: { result: Result; seek: Seek }) {
  const items = result.coach?.items ?? [];
  const hidden = result.coach?.hidden_count ?? 0;
  const col = (kind: "strength" | "focus", title: string, region: string, Icon: typeof ThumbsUp, bar: string, tile: string) => {
    const mine = items.filter((i) => i.kind === kind);
    return <section className="card p-5" aria-label={region}>
      <p className="mb-4 flex items-center gap-2.5 font-bold"><span className={cn("grid size-8 place-items-center rounded-lg", tile)}><Icon className="size-4" /></span>{title}</p>
      {mine.length === 0 ? <div className="rounded-xl bg-surface p-4 text-sm text-muted">
        <p>{kind === "focus" ? "รอบนี้ไม่มีสรุปจุดที่ควรปรับจากโค้ช" : "รอบนี้ไม่มีสรุปจุดเด่นจากโค้ช"}</p>
        <a href="#result-criteria" className="mt-1 inline-block font-semibold text-brand hover:underline" onClick={(e) => { e.preventDefault(); history.replaceState(null, "", "#result-criteria"); const h = document.getElementById("result-criteria"); h?.scrollIntoView({ behavior: "smooth", block: "start" }); h?.focus({ preventScroll: true }); }}>เปิดข้อเสนอแนะรายเกณฑ์</a>
      </div>
        : <ul className="space-y-3">
          {mine.map((it, i) => <motion.li key={i} className="relative rounded-xl bg-surface py-3 pl-5 pr-4"
            initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.08 }}>
            <span className={cn("absolute inset-y-3 left-0 w-1 rounded-full", bar)} />
            {it.code && <span className="mb-1 block text-xs font-semibold text-muted">{SHORT_NAME[it.code]}</span>}
            <p className="text-sm leading-relaxed"><CoachLine text={it.text} seek={seek} /></p>
          </motion.li>)}
        </ul>}
    </section>;
  };
  return <section>
    <SectionTitle eyebrow="โค้ช AI" title="ทำได้ดี และเรื่องที่ควรปรับ">
      <span className="flex items-center gap-1.5 text-xs text-muted"><Info className="size-4" />สรุปจากการ์ด ไม่เปลี่ยนระดับ และอ้างเวลาจากหลักฐานเท่านั้น</span>
    </SectionTitle>
    {!result.coach && <p className="mb-3 text-sm text-muted">รอบนี้ไม่มีคำแนะนำจากโค้ช AI (โค้ชตอบไม่ผ่านการตรวจหลักฐาน หรือปิดไว้) ระดับและคำแนะนำรายเกณฑ์ด้านล่างยังครบ</p>}
    <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
      {col("strength", "ทำได้ดี", "สิ่งที่ทำได้ดี", ThumbsUp, "bg-lime", "bg-lime text-navy")}
      {col("focus", "ควรปรับ", "สิ่งที่ควรปรับ", Wrench, "bg-brand", "bg-brand-50 text-brand")}
    </div>
    {hidden > 0 && <p className="mt-2 text-xs text-faint">ซ่อนคำแนะนำที่เกินจำนวนไว้ {hidden} ข้อ</p>}
  </section>;
}

/* ---------- 6. Criterion cards ---------- */

function Cards({ result, active, setActive, seek, filter, setFilter }: {
  result: Result; active: CriterionCode | null; setActive: (c: CriterionCode | null) => void; seek: Seek; filter: Skill | "all"; setFilter: (f: Skill | "all") => void;
}) {
  const shown = result.criteria.filter((c) => filter === "all" || c.skill === filter);
  return <section id="result-criteria-section" className="scroll-mt-24">
    <h2 id="result-criteria" tabIndex={-1} className="sr-only">ผลรายเกณฑ์</h2>
    <SectionTitle eyebrow="ผลรายเกณฑ์" title="เจาะลึกทีละเกณฑ์">
      <div className="flex flex-wrap gap-1 rounded-full bg-white p-1 shadow-card">
        {[{ key: "all" as const, label: "ทั้งหมด" }, ...SKILLS].map((s) => <button key={s.key} type="button" aria-pressed={filter === s.key} onClick={() => setFilter(s.key)}
          className={cn("min-h-9 rounded-full px-3 py-1 text-xs font-semibold transition-colors", filter === s.key ? "bg-brand text-white" : "text-muted hover:text-ink")}>{s.label}</button>)}
      </div>
    </SectionTitle>
    <motion.div layout className="grid grid-cols-1 items-start gap-5 md:grid-cols-2">
      <AnimatePresence>
        {shown.map((c) => <CriterionCard key={c.code} c={c} result={result} open={active === c.code} toggle={() => setActive(active === c.code ? null : c.code)} seek={seek} />)}
      </AnimatePresence>
    </motion.div>
  </section>;
}

// forwardRef: AnimatePresence measures each card when the skill filter removes it
const CriterionCard = forwardRef<HTMLElement, { c: Criterion; result: Result; open: boolean; toggle: () => void; seek: Seek }>(function CriterionCard({ c, result, open, toggle, seek }, ref) {
  const { meta: all, fb, metaStatus, prev } = useR();
  const meta = all[c.code];
  const reading = readCard(c, meta);
  const scored = new Set(meta?.scored_values ?? []);
  const values = Object.entries(c.values).filter(([, v]) => v != null);
  const na = c.status !== "ok";
  return <motion.article ref={ref} id={`card-${c.code}`} layout initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
    data-criterion={c.code} data-level={c.level ?? "na"}
    className={cn("scroll-mt-24 overflow-hidden rounded-panel", na ? "border-[1.5px] border-dashed border-faint bg-white/60" : "bg-white shadow-card", open && "ring-2 ring-brand md:col-span-2")}>
    <button type="button" onClick={toggle} aria-expanded={open} className="flex w-full items-start gap-4 p-5 text-left">
      <SkillIcon skill={c.skill} className={na ? "bg-surface text-faint" : undefined} />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2"><b className="text-base leading-tight sm:text-lg">{CRITERION_NAME[c.code]}</b><DeltaTag before={prev?.[c.code]} now={c.level} /></span>
        <span className="mt-0.5 block text-sm text-muted" data-reading>{na ? "วิเคราะห์ไม่ได้ในรอบนี้" : reading ? [reading.word, reading.detail].filter(Boolean).join(" · ") : metaStatus === "loading" ? "กำลังโหลดคำอ่าน…" : `ระดับ ${c.level} จาก 4`}</span>
        {!na && <LevelMeter level={c.level} className="mt-3 max-w-xs" />}
      </span>
      <LevelBadge level={c.level} />
      <ChevronDown className={cn("mt-2.5 size-5 shrink-0 text-faint transition-transform", open && "rotate-180 text-brand")} />
    </button>
    {na ? <div className="mx-5 mb-5 flex gap-3 rounded-xl bg-surface p-3 text-sm text-muted"><Info className="mt-0.5 size-4 shrink-0" /><span>{c.reason ?? "ระบบมีข้อมูลไม่พอจะวัดเกณฑ์นี้ในรอบนี้"}</span></div>
      : <div className="px-5 pb-5"><CardViz c={c} result={result} seek={seek} /></div>}
    <AnimatePresence initial={false}>
      {open && !na && <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
        <div className="grid grid-cols-1 gap-5 border-t border-line bg-surface/60 p-5 md:grid-cols-3">
          <div>
            <p className="mb-2 text-xs font-semibold text-muted">ค่าที่วัดได้</p>
            {!meta ? <>{/* without the criteria metadata the page cannot tell which value set the level: say so, never call them all "supporting" */}
              <p className="mb-2 text-xs text-muted" data-values-unsplit>{metaStatus === "loading" ? "กำลังโหลดว่าค่าใดใช้คิดระดับ…" : "ยังแยกไม่ได้ว่าค่าใดใช้คิดระดับ (โหลดคำอธิบายเกณฑ์ไม่สำเร็จ)"}</p>
              <dl className="space-y-1.5" data-values>{values.map(([k, v]) => <Val key={k} k={k} v={v!} />)}</dl>
            </> : <>
            <dl className="space-y-2" data-values="scored">{values.filter(([k]) => scored.has(k)).map(([k, v]) => <Val key={k} k={k} v={v!} strong />)}</dl>
            {values.some(([k]) => !scored.has(k)) && <>
              <p className="mb-2 mt-4 text-xs font-semibold text-muted">ข้อมูลประกอบ (ไม่ใช้ตัดสินระดับ)</p>
              <dl className="space-y-1.5" data-values="supporting">{values.filter(([k]) => !scored.has(k)).map(([k, v]) => <Val key={k} k={k} v={v!} />)}</dl>
            </>}</>}
          </div>
          <div className="space-y-3 md:col-span-2">
            {meta?.interpret?.explain && <p className="flex gap-2 text-sm text-muted"><Info className="mt-0.5 size-4 shrink-0" />{meta.interpret.explain}</p>}
            {c.feedback_id && fb[c.feedback_id] && <div className="rounded-xl bg-white p-4 shadow-card" data-feedback><p className="mb-1 flex items-center gap-1.5 text-sm font-bold text-brand"><Lightbulb className="size-4" />คำแนะนำ</p><p className="text-sm leading-relaxed">{fb[c.feedback_id]}</p></div>}
            {c.feedback_id && !fb[c.feedback_id] && metaStatus === "failed" && <p className="text-sm text-muted">โหลดคำแนะนำไม่สำเร็จ ลองโหลดอีกครั้งจากแถบด้านบน</p>}
            {c.code === "C2" && result.topics.length > 0 && <TopicTable topics={result.topics} seek={seek} />}
            {c.evidence.length > 0 && <div><p className="mb-2 text-xs font-semibold text-muted">หลักฐาน ({c.evidence.length})</p>
              <div className="flex flex-wrap gap-1.5" data-evidence>{c.evidence.slice(0, 12).map((e, i) => <TimeChip key={i} start={e.start_s} end={e.end_s} seek={seek} note={e.label ?? e.note} />)}
                {c.evidence.length > 12 && <span className="self-center text-xs text-muted">และอีก {c.evidence.length - 12} จุด</span>}</div></div>}
          </div>
        </div>
      </motion.div>}
    </AnimatePresence>
  </motion.article>;
});


/** C2 in detail: each planned topic, how it was covered, the quote checked against the transcript and when it was
    first explained. Shown only when C2 was analysed, so a partial round never shows stored coverage labels. */
function TopicTable({ topics, seek }: { topics: Topic[]; seek: Seek }) {
  const rows = [...topics].sort((a, b) => a.order - b.order);
  return <div className="overflow-x-auto rounded-xl bg-white shadow-card">
    <table className="w-full text-left text-sm" aria-label="หัวข้อตามแผน">
      <caption className="px-4 pt-3 text-left text-xs font-semibold text-muted">หัวข้อตามแผน {rows.length} หัวข้อ</caption>
      <thead><tr className="text-xs text-muted"><th scope="col" className="px-4 py-2 font-medium">หัวข้อ</th><th scope="col" className="px-2 py-2 font-medium">ผล</th><th scope="col" className="px-4 py-2 font-medium">พูดครั้งแรก</th></tr></thead>
      <tbody>{rows.map((t) => <tr key={t.id} className="border-t border-line align-top">
        <th scope="row" className="px-4 py-2.5 font-medium">{t.order}. {t.title}
          {t.evidence_quote && <span className="mt-0.5 block text-xs font-normal text-muted">“{t.evidence_quote}”</span>}</th>
        <td className="whitespace-nowrap px-2 py-2.5"><span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", t.coverage === "clear" ? "bg-brand-50 text-brand" : t.coverage === "brief" ? "bg-surface text-ink" : "text-muted ring-1 ring-inset ring-line")}>{COVERAGE_LABEL[t.coverage]}</span></td>
        <td className="px-4 py-2.5">{t.first_mention_s != null ? <TimeChip start={t.first_mention_s} seek={seek} /> : <span className="text-xs text-faint">–</span>}</td>
      </tr>)}</tbody>
    </table>
  </div>;
}

function Val({ k, v, strong }: { k: string; v: number; strong?: boolean }) {
  const [label, unit] = VALUE_LABEL[k] ?? [k, ""];
  return <div className="flex items-baseline justify-between gap-3 text-sm"><dt className="text-muted">{label}</dt>
    <dd className={cn("whitespace-nowrap tabular-nums", strong && "text-lg font-bold")}>{strong ? <CountUp to={v} decimals={Number.isInteger(v) ? 0 : 1} /> : v} <span className="text-xs font-normal text-muted">{unit}</span></dd></div>;
}

/** A measured value for a sentence: a dash when it is missing, never "null". */
const num = (v: number | null | undefined) => (v == null ? "–" : String(v));

function CardViz({ c, result, seek }: { c: Criterion; result: Result; seek: Seek }): ReactNode {
  const { meta } = useR();
  const d = clipLength(result);
  switch (c.code) {
    case "C1": return result.topics.length ? <OrderFlow topics={result.topics} /> : null;
    case "C2": return result.topics.length ? <CoverageDonut topics={result.topics} size={104} /> : null;
    case "S1": { const band = meta.S1?.levels?.["4"]?.syllables_per_s as [number, number] | undefined; return band ? <SpeedRuler value={c.values.syllables_per_s ?? 0} band={band} /> : null; }
    case "S2": case "S3": return <div><MomentStrip evidence={c.evidence} duration={d} onSeek={seek ?? undefined} />
      <p className="mt-1.5 text-xs text-muted">{c.code === "S2" ? `${num(c.values.long_pauses_per_min)} ครั้ง/นาที · นานสุด ${num(c.values.max_pause_s)} วินาที` : `${num(c.values.fillers_per_min)} ครั้ง/นาที`}{seek ? " · กดแถบเพื่อดูช่วงนั้น" : ""}</p></div>;
    case "N1": return <div><MomentStrip evidence={c.evidence} duration={d} onSeek={seek ?? undefined} />
      <p className="mt-1.5 text-xs text-muted">ช่วงมือนิ่งต่อเนื่อง {num(c.values.long_still_per_min)} ครั้ง/นาที · นานสุด {num(c.values.max_still_s)} วินาที</p></div>;
    case "N2": return <HeadShare c={c} />;
    case "T1": return c.values.speech_span_s != null && result.target_duration_s ? <TimeGauge span={c.values.speech_span_s} target={result.target_duration_s} bands={t1Bands(meta)} className="max-w-[230px]" /> : null;
  }
}

/* ---------- 7. Mission ---------- */

function Mission({ result, seek }: { result: Result; seek: Seek }) {
  const plans = result.coach?.items.filter((i) => i.kind === "plan") ?? [];
  const [done, toggle] = useMissions(result.session_id); // same ticks as the dashboard card
  const all = plans.length > 0 && plans.every((_, i) => done.includes(i));
  return <section aria-label="เป้าหมายรอบถัดไป" className="relative overflow-hidden rounded-panel bg-navy p-6 text-white sm:p-10">
    <div className="grid-lines absolute inset-0 [mask-image:linear-gradient(to_right,transparent,black)]" />
    <div aria-hidden className="absolute -right-24 -top-24 size-80 rounded-full bg-brand/50 blur-3xl" />
    <div className="relative grid grid-cols-1 items-center gap-8 md:grid-cols-[1fr_auto]">
      <div>
        <Chip tone="lime"><Flag />เป้าหมายรอบถัดไป</Chip>
        <h2 className="mt-4 text-3xl font-bold sm:text-4xl">ซ้อมอีกรอบ โฟกัสทีละเรื่อง</h2>
        {plans.length === 0 && <p className="mt-3 text-white/70">รอบนี้ไม่มีแผนจากโค้ช ลองเลือก 1 เกณฑ์ที่อยากปรับจากการ์ดด้านบน แล้วซ้อมเฉพาะเรื่องนั้น</p>}
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
        <Button size="xl" variant="lime" className="mt-8" asChild><Link to={PATH.new}>เริ่มซ้อมอีกครั้ง <ArrowRight /></Link></Button>
      </div>
      <PPre pose={all ? "celebrate" : "idle"} size={150} color="white" className="mx-auto" saySide="top" say={all ? "พร้อมแล้ว ไปซ้อมกัน" : undefined} />
    </div>
  </section>;
}

