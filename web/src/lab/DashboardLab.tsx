import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "motion/react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowLeftRight, ArrowRight, ArrowUp, BarChart3, CalendarClock, CalendarDays, CheckCircle2, ChevronRight, Clock3, Flag, Lightbulb, Loader2, Mic, Table2, Upload } from "lucide-react";
import type { CriterionCode, SessionRow } from "@/contract";
import { fmtDuration } from "@/presentation";
import { doneRuns, previousRun } from "@/trend";
import { Button, Chip, SectionTitle, SHORT_NAME, cn } from "@/v2/ui";
import { Shell } from "@/v2/Shell";
import { CountUp, LEVEL_COLOR, Radar } from "@/v2/viz";
import { StageLights } from "@/v2/StageLights";
import { MAX_LIGHTS, countsAsPractice, stageLights, weekIndex, type StageState } from "@/v2/streak";
import { DashboardSkeleton, EmptyState, HelpTip, PRACTICE_STEPS } from "@/v2/states";
import { HOME_TOUR, Tour } from "@/v2/Tour";
import { PREF, readPref, usePref, useDisplayName, useMissions } from "@/v2/prefs";
import { RESULT } from "./fixtures";
import { LAB_NOW as NOW, SCENARIOS, TARGET_PRESETS, daysUntil, historyFor, notesFor, presentDay, thDate, type Scenario } from "./demo";

const CODES: CriterionCode[] = ["C1", "C2", "S1", "S2", "S3", "N1", "N2", "T1"];
const rise = (i: number) => ({ initial: { opacity: 0, y: 16 }, animate: { opacity: 1, y: 0 }, transition: { delay: 0.04 + i * 0.06, duration: 0.45, ease: [0.2, 0.7, 0.2, 1] as const } });

export default function DashboardLab() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [scenario, setScenario] = useState<Scenario>("steady");
  const [name] = useDisplayName();
  const [tour, setTour] = useState(() => params.get("tour") === "1" || !readPref(PREF.tourDone));
  // the Lab menu, Help, Settings and Ctrl+K can ask for the tour while this page is already open
  useEffect(() => { if (params.get("tour") === "1") setTour(true); }, [params]);
  const rows = useMemo(() => historyFor(scenario), [scenario]);
  const done = useMemo(() => [...doneRuns(rows)].reverse(), [rows]); // doneRuns is oldest first; tiles want newest first
  const stage = useMemo(() => stageLights(rows, NOW), [rows]);
  const notes = useMemo(() => notesFor(stage, rows), [stage, rows]);
  const running = rows.filter((r) => r.status === "queued" || r.status === "processing");
  const latest = done[0];
  const previous = latest ? previousRun(rows, latest.session_id, latest.rubric_version) ?? undefined : undefined; // same rubric only
  const sent = rows.filter(countsAsPractice);
  const totalMin = Math.round(sent.reduce((s, r) => s + (r.duration_s ?? 0), 0) / 60);
  // short loading state so the skeleton can be seen (real data would arrive from the API here)
  const [loading, setLoading] = useState(true);
  useEffect(() => { setLoading(true); const t = window.setTimeout(() => setLoading(false), 700); return () => window.clearTimeout(t); }, [scenario]);
  const closeTour = () => { setTour(false); if (params.get("tour")) nav("/lab/dashboard", { replace: true }); };

  const switcher = (mobile?: boolean) => <div role="group" aria-label="ข้อมูลตัวอย่าง" className={mobile ? "mb-4 flex gap-1 overflow-x-auto xl:hidden" : "hidden items-center gap-1 rounded-full bg-white p-1 shadow-card xl:flex"}>
    {SCENARIOS.map((s) => <button key={s.key} type="button" onClick={() => setScenario(s.key)}
      className={cn("whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold", scenario === s.key ? "bg-navy text-white" : mobile ? "bg-white text-muted" : "text-muted hover:text-ink")}>{mobile ? `ตัวอย่าง: ${s.label}` : s.label}</button>)}
  </div>;

  return <Shell page="home" title={`สวัสดี ${name}`} stage={stage} notes={notes} actions={switcher()}
    subtitle={`${thDate(NOW, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}${stage.streak > 1 ? ` · ซ้อมติดต่อกัน ${stage.streak} สัปดาห์` : ""}`}>
    {switcher(true)}
    {loading ? <DashboardSkeleton /> : done.length === 0 ? <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
      <StageTile stage={stage} rows={rows} />
      <StartTile className="lg:col-span-5" />
      <EmptyState className="lg:col-span-12" title="ยังไม่มีรอบซ้อม" action={<Button asChild variant="lime" size="lg"><Link to="/lab/new">ซ้อมรอบแรก <ArrowRight /></Link></Button>}>
        ซ้อมรอบแรกแล้วผล 8 เกณฑ์ แนวโน้ม ปฏิทิน และประวัติจะขึ้นที่นี่ ไม่ต้องกังวลเรื่องผล รอบแรกมีไว้รู้จักตัวเอง
      </EmptyState>
    </div> : <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
      <StageTile stage={stage} rows={rows} />
      <LatestTile row={latest} prev={previous} />
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-3 lg:col-span-12">
        <StatTile i={2} Icon={Mic} label="ส่งซ้อมแล้วทั้งหมด" value={sent.length} unit="รอบ" note={`ผลออกแล้ว ${done.length} รอบ · รวมเวลาคลิปซ้อม ${totalMin} นาที`} />
        <CountdownTile />
        <RunningTile rows={running} />
      </div>

      <TrendBoard runs={done} />
      <StartTile className="lg:col-span-4" />

      <CalendarHeat runs={done} />
      <MissionTile />

      <HistoryList rows={rows} />
    </div>}
    <Tour steps={HOME_TOUR} open={tour && !loading} onClose={closeTour} />
  </Shell>;
}

/* ---------- Stage lights ---------- */

function StageTile({ stage, rows }: { stage: StageState; rows: SessionRow[] }) {
  const [goal] = usePref(PREF.weeklyGoal, "1");
  const thisWeek = rows.filter((r) => countsAsPractice(r) && weekIndex(new Date(r.created_at)) === weekIndex(NOW)).length;
  const status = stage.rounds === 0 ? { t: "ซ้อมรอบแรกเพื่อจุดไฟดวงแรก", d: "ซ้อมอย่างน้อย 1 รอบต่อสัปดาห์ ไฟจะติดเพิ่มทีละดวง" }
    : stage.practicedThisWeek ? { t: stage.lights >= MAX_LIGHTS ? "ไฟครบ 5 ดวง เวทีสว่างเต็ม!" : "สัปดาห์นี้ไฟติดแล้ว", d: "ซ้อมเพิ่มได้ตามใจ สัปดาห์หน้าซ้อมอีก 1 รอบเพื่อรักษาไฟ" }
    : { t: `ซ้อมภายใน ${stage.daysLeft} วันเพื่อรักษาไฟ`, d: "ถ้าทั้งสัปดาห์ไม่ได้ซ้อม ไฟจะหรี่ลง 1 ดวง (ไม่ดับหมดทันที)" };
  return <motion.section {...rise(0)} data-tour="stage" className="relative overflow-hidden rounded-panel bg-navy p-5 text-white shadow-lift sm:p-6 lg:col-span-7">
    <div aria-hidden className="absolute -left-20 -top-24 size-72 rounded-full bg-brand/40 blur-3xl" />
    <div className="relative grid items-center gap-5 sm:grid-cols-[1.15fr_1fr]">
      <StageLights lights={stage.lights} atRisk={stage.atRisk} className="bg-navy-950/60 ring-1 ring-inset ring-white/10" />
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-lime"><Lightbulb className="size-4" />ไฟเวที
          <HelpTip dark href="/lab/help#faq">สัปดาห์ (จันทร์–อาทิตย์) ที่ซ้อมอย่างน้อย 1 รอบ ไฟติดเพิ่ม 1 ดวง ถ้าทั้งสัปดาห์ไม่ซ้อม ไฟหรี่ 1 ดวง นับจากความสม่ำเสมอ ไม่ใช่ระดับผล</HelpTip></p>
        <p className="mt-1 text-5xl font-bold leading-none tabular-nums"><CountUp to={stage.lights} /><span className="text-2xl text-white/50">/{MAX_LIGHTS}</span></p>
        <p className="mt-3 font-semibold">{status.t}</p>
        <p className="mt-0.5 text-sm text-white/65">{status.d}</p>
        <div className="mt-4 flex flex-wrap gap-1.5">
          <Chip tone="glass">ติดต่อกัน {stage.streak} สัปดาห์</Chip>
          <Chip tone="glass">สถิติสูงสุด {stage.best} สัปดาห์</Chip>
          <Link to="/lab/settings" title="เปลี่ยนเป้าได้ที่หน้าตั้งค่า"><Chip tone="glass">เป้า {goal} รอบ/สัปดาห์ · สัปดาห์นี้ {thisWeek}</Chip></Link>
          {stage.rounds > 0 && <Link to="/lab/progress" className="inline-flex items-center gap-1 rounded-full bg-lime px-3 py-1 text-xs font-semibold text-navy hover:bg-lime-300">ตราสะสม <ArrowRight className="size-3.5" /></Link>}
        </div>
        {!stage.practicedThisWeek && <Button asChild variant="lime" size="sm" className="mt-4"><Link to="/lab/new">ซ้อมรอบใหม่ <ArrowRight /></Link></Button>}
      </div>
    </div>
    {stage.weeks.length > 0 && <div className="relative mt-5 flex items-end justify-between gap-1 border-t border-white/10 pt-4" aria-label="8 สัปดาห์ล่าสุด">
      {stage.weeks.map((w) => <div key={w.week} className="flex flex-1 flex-col items-center gap-1.5">
        <span className="flex h-6 items-end gap-[2px]">{Array.from({ length: MAX_LIGHTS }, (_, i) => <span key={i} className={cn("w-1 rounded-full", i < w.lights ? "h-full bg-lime" : "h-1.5 bg-white/15")} />)}</span>
        <span className={cn("text-[10px]", w.current ? "font-bold text-lime" : w.practiced ? "text-white/70" : "text-white/35")}>{w.current ? "สัปดาห์นี้" : thDate(w.start)}</span>
      </div>)}
    </div>}
  </motion.section>;
}

function CountdownTile() {
  const day = presentDay(), left = daysUntil(day);
  return <motion.div {...rise(3)} className="card flex flex-col p-5">
    <div className="flex items-center justify-between"><p className="text-sm text-muted">วันพรีเซนต์จริง</p><span className="grid size-9 place-items-center rounded-xl bg-lime text-navy"><CalendarClock className="size-5" /></span></div>
    <p className="mt-2 text-4xl font-bold leading-none">{left > 0 ? <><CountUp to={left} /><span className="ml-1.5 text-base font-semibold text-muted">วัน</span></> : <span className="text-2xl">วันนี้!</span>}</p>
    <Link to="/lab/new#day" className="mt-auto pt-4 text-xs font-semibold text-brand hover:underline">{thDate(day, { day: "numeric", month: "long" })} · ดูแผนซ้อม →</Link>
  </motion.div>;
}

/* ---------- Tiles ---------- */

function LatestTile({ row, prev }: { row?: SessionRow; prev?: SessionRow }) {
  if (!row?.levels) return null;
  const criteria = RESULT.criteria.map((c) => ({ ...c, level: (row.levels![c.code] ?? null) as 1 | 2 | 3 | 4 | null }));
  const up = CODES.filter((c) => row.levels![c] != null && prev?.levels?.[c] != null && row.levels![c]! > prev.levels![c]!);
  return <motion.div {...rise(1)} data-tour="latest" className="relative flex flex-col overflow-hidden rounded-panel bg-brand-gradient p-6 text-white shadow-glow lg:col-span-5">
    <div aria-hidden className="absolute -right-16 -top-16 size-56 rounded-full border-[24px] border-white/[0.07]" />
    <div className="relative flex items-center justify-between">
      <p className="font-semibold">รอบล่าสุด</p>
      <Chip tone="glass">{thDate(row.created_at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</Chip>
    </div>
    <div className="relative mt-2 flex items-center gap-4">
      <Radar criteria={criteria} previous={prev?.levels ?? undefined} size={150} showLabels={false} dark className="shrink-0" />
      <div className="min-w-0">
        <p className="text-5xl font-bold leading-none"><CountUp to={up.length} /></p>
        <p className="mt-1 flex items-center gap-1 text-sm text-white/75">เกณฑ์ดีขึ้นจากรอบก่อน<HelpTip dark href="/lab/how#levels">ระดับที่ระบบวัดได้ในรอบนี้สูงกว่ารอบก่อน (เกณฑ์รุ่นเดียวกัน) ไม่ใช่หลักฐานว่าทักษะเพิ่มขึ้น หัวข้อ ห้อง หรือกล้องที่ต่างกันก็มีผล</HelpTip></p>
        <div className="mt-3 flex flex-wrap gap-1.5">{up.map((c) => <Chip key={c} tone="lime"><ArrowUp />{SHORT_NAME[c]}</Chip>)}</div>
      </div>
    </div>
    <div className="relative mt-4 flex items-center justify-between gap-3 border-t border-white/15 pt-4">
      <p className="text-xs text-white/60">เส้นประ = รอบก่อนหน้า</p>
      <Button size="sm" variant="white" asChild><Link to={`/lab/result?id=${row.session_id}`}>ดูผลรอบนี้ <ArrowRight /></Link></Button>
    </div>
  </motion.div>;
}

function StatTile({ i, Icon, label, value, unit, note }: { i: number; Icon: typeof Mic; label: string; value: number; unit: string; note: string }) {
  return <motion.div {...rise(i)} className="card flex flex-col p-5">
    <div className="flex items-center justify-between"><p className="text-sm text-muted">{label}</p><span className="grid size-9 place-items-center rounded-xl bg-brand-50 text-brand"><Icon className="size-5" /></span></div>
    <p className="mt-2 text-4xl font-bold leading-none"><CountUp to={value} /><span className="ml-1.5 text-base font-semibold text-muted">{unit}</span></p>
    <p className="mt-auto pt-4 text-xs text-faint">{note}</p>
  </motion.div>;
}

function RunningTile({ rows }: { rows: SessionRow[] }) {
  const r = rows[0];
  const steps = PRACTICE_STEPS.slice(2).map((s) => s.label); // รอคิว → วิเคราะห์ → ผลออก (same names as the waiting page)
  const at = r ? (r.status === "processing" ? 1 : 0) : -1;
  return <motion.div {...rise(4)} className="card flex flex-col p-5">
    <div className="flex items-center justify-between"><p className="text-sm text-muted">กำลังวิเคราะห์</p><span className="grid size-9 place-items-center rounded-xl bg-brand-50 text-brand"><Loader2 className={cn("size-5", r && "animate-spin")} /></span></div>
    {r ? <>
      <Link to="/lab/waiting" className="mt-2 text-sm font-semibold hover:text-brand">คลิป {fmtDuration(r.duration_s ?? 0)} · ดูขั้นตอน →</Link>
      <ol className="mt-auto flex items-center pt-4">
        {steps.map((s, i) => <li key={s} className="flex flex-1 items-center last:flex-none">
          <span className="flex flex-col items-center gap-1 text-[10px] text-muted">
            <span className={cn("grid size-6 place-items-center rounded-full text-[10px] font-bold", i < at ? "bg-brand text-white" : i === at ? "bg-lime text-navy" : "bg-brand-50 text-faint")}>
              {i < at ? <CheckCircle2 className="size-3.5" /> : i + 1}</span>{s}
          </span>
          {i < steps.length - 1 && <span className={cn("mx-1 mb-4 h-0.5 flex-1 rounded-full", i < at ? "bg-brand" : "bg-line")} />}
        </li>)}
      </ol>
    </> : <p className="mt-2 text-sm text-muted">ไม่มีรอบที่รออยู่</p>}
  </motion.div>;
}

function StartTile({ className }: { className?: string }) {
  const [mins, setMins] = useState(15);
  return <motion.section id="start" data-tour="start" {...rise(4)} className={cn("card flex scroll-mt-24 flex-col p-6", className)}>
    <Chip tone="soft" className="self-start"><Mic />ซ้อมรอบใหม่</Chip>
    <h2 className="mt-3 text-xl font-bold leading-snug">อัดคลิปซ้อม แล้วรับผลครบ 8 เกณฑ์</h2>
    <p className="mt-1 text-sm text-muted">ตั้งเวลา ใส่หัวข้อจากรายงาน PDF แล้วอัดจากกล้องหรืออัปโหลดไฟล์</p>
    <p className="mt-5 text-xs font-semibold text-muted">เวลาเป้าหมาย</p>
    <div className="mt-2 grid grid-cols-4 gap-1.5 rounded-xl bg-surface p-1">
      {TARGET_PRESETS.map((m) => <button key={m} type="button" onClick={() => setMins(m)} aria-pressed={mins === m}
        className={cn("rounded-lg py-2 text-sm font-semibold leading-tight transition-colors", mins === m ? "bg-white text-brand shadow-card" : "text-muted hover:text-ink")}>{m}<span className="block text-[10px] font-medium">นาที</span></button>)}
    </div>
    <div className="mt-auto grid gap-2 pt-6">
      <Button size="lg" asChild><Link to={`/lab/record?min=${mins}`}><Mic />เริ่มอัดจากกล้อง</Link></Button>
      <Button size="lg" variant="soft" asChild><Link to="/lab/new"><Upload />อัปโหลดคลิป</Link></Button>
    </div>
  </motion.section>;
}

function MissionTile() {
  const plans = RESULT.coach?.items.filter((i) => i.kind === "plan") ?? [];
  const [done, toggle] = useMissions(); // same list and ticks as the result page
  const pct = plans.length ? done.length / plans.length : 0;
  return <section className="card p-6 lg:col-span-5">
    <div className="flex items-center justify-between">
      <p className="flex items-center gap-2 font-bold"><Flag className="size-5 text-brand" />เป้าหมายรอบถัดไป</p>
      <span className="text-sm font-semibold text-muted tabular-nums">{done.length}/{plans.length}</span>
    </div>
    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-brand-50"><motion.div className="h-full rounded-full bg-lime" animate={{ width: `${pct * 100}%` }} /></div>
    <ul className="mt-4 space-y-2">
      {plans.map((p, i) => { const on = done.includes(i);
        return <li key={i}><button type="button" aria-pressed={on} onClick={() => toggle(i)}
          className={cn("flex w-full gap-3 rounded-xl p-3 text-left text-sm leading-relaxed transition-colors", on ? "bg-lime-200/60 text-muted line-through" : "bg-surface hover:bg-brand-50")}>
          <span className={cn("mt-0.5 grid size-5 shrink-0 place-items-center rounded-md", on ? "bg-lime text-navy" : "bg-white ring-1 ring-inset ring-line")}>{on && <CheckCircle2 className="size-3.5" />}</span>
          {p.text.replace(/\[(\d{1,2}:\d{2})\]/g, "$1")}
        </button></li>; })}
    </ul>
  </section>;
}

/* ---------- Calendar heatmap ---------- */

function CalendarHeat({ runs }: { runs: SessionRow[] }) {
  const weeks = 20;
  const start = new Date(NOW); start.setDate(start.getDate() - ((start.getDay() + 6) % 7) - (weeks - 1) * 7); // weeks start on Monday, like the stage lights
  const count = (d: Date) => runs.filter((r) => new Date(r.created_at).toDateString() === d.toDateString()).length;
  const cells = Array.from({ length: weeks }, (_, w) => Array.from({ length: 7 }, (_, d) => { const x = new Date(start); x.setDate(start.getDate() + w * 7 + d); return x; }));
  return <section className="card p-6 lg:col-span-7">
    <div className="mb-4 flex items-center justify-between"><p className="flex items-center gap-2 font-bold"><CalendarDays className="size-5 text-brand" />ปฏิทินการซ้อม</p><span className="text-xs text-faint">{weeks} สัปดาห์ล่าสุด</span></div>
    <div className="overflow-x-auto pb-1">
      <div className="flex min-w-max gap-1.5">
        {cells.map((col, w) => <div key={w} className="flex flex-col gap-1.5">
          {col.map((d) => { const n = count(d), future = d > NOW;
            return <motion.div key={d.toISOString()} title={`${thDate(d.toISOString(), { day: "numeric", month: "short" })}: ${n} รอบ`}
              initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={{ delay: w * 0.02 }}
              className={cn("size-[18px] rounded-[5px]", future ? "bg-transparent ring-1 ring-inset ring-line" : n === 0 ? "bg-brand-50" : n === 1 ? "bg-level-3" : "bg-level-4")} />; })}
        </div>)}
      </div>
    </div>
    <div className="mt-4 flex items-center gap-2 text-xs text-muted"><span className="size-3 rounded bg-brand-50" />ไม่ได้ซ้อม<span className="ml-2 size-3 rounded bg-level-3" />1 รอบ<span className="ml-2 size-3 rounded bg-level-4" />2 รอบขึ้นไป</div>
  </section>;
}

/* ---------- Trend ---------- */

function TrendBoard({ runs }: { runs: SessionRow[] }) {
  const [pick, setPick] = useState<CriterionCode | null>("S3");
  const [view, setView] = useState<"chart" | "table">("chart");
  const chron = [...runs].reverse().slice(-8);
  const data = chron.map((r) => ({ name: thDate(r.created_at), ...r.levels }));
  return <section data-tour="trend" className="card p-6 lg:col-span-8">
    <SectionTitle eyebrow="แนวโน้มผลการฝึกซ้อมข้ามรอบ" title="ระดับรายเกณฑ์ที่ระบบวัดได้" className="mb-4">
      <div className="flex rounded-full bg-surface p-1">
        {([["chart", BarChart3, "กราฟ"], ["table", Table2, "ตาราง"]] as const).map(([k, Icon, l]) => <button key={k} onClick={() => setView(k)}
          className={cn("flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold", view === k ? "bg-white text-brand shadow-card" : "text-muted")}><Icon className="size-4" />{l}</button>)}
      </div>
    </SectionTitle>
    <div className="mb-4 flex flex-wrap gap-1.5">
      {CODES.map((c) => { const on = pick === c;
        return <button key={c} onClick={() => setPick(on ? null : c)} className={cn("rounded-full px-3 py-1 text-xs font-semibold transition-colors", on ? "bg-brand text-white" : "bg-surface text-muted hover:bg-brand-50 hover:text-brand")}>{SHORT_NAME[c]}</button>; })}
    </div>
    {view === "chart" ? <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 10, right: 12, left: -24, bottom: 0 }}>
          <CartesianGrid stroke="var(--color-line)" strokeDasharray="3 6" vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 11, fill: "var(--color-faint)" }} axisLine={false} tickLine={false} dy={6} />
          <YAxis domain={[1, 4]} ticks={[1, 2, 3, 4]} tick={{ fontSize: 11, fill: "var(--color-faint)" }} axisLine={false} tickLine={false} />
          <Tooltip cursor={{ stroke: "var(--color-brand-200)" }} contentStyle={{ border: "none", borderRadius: 12, boxShadow: "var(--shadow-lift)", fontFamily: "Prompt", fontSize: 12 }}
            formatter={(v, n) => [v == null ? "วิเคราะห์ไม่ได้" : `ระดับ ${v}`, SHORT_NAME[n as CriterionCode]]} />
          {CODES.map((c) => { const on = pick === c;
            return <Line key={c} type="linear" dataKey={c} stroke={on ? "var(--color-brand)" : "var(--color-brand-200)"} strokeWidth={on ? 3 : 1.5} strokeOpacity={pick == null || on ? 1 : 0.35}
              dot={on ? { r: 4.5, stroke: "white", strokeWidth: 2, fill: "var(--color-brand)" } : false} activeDot={on ? { r: 6 } : false} connectNulls={false} isAnimationActive animationDuration={900} />; })}
        </LineChart>
      </ResponsiveContainer>
    </div> : <TrendTable runs={chron} />}
    <p className="mt-3 text-xs text-faint">ระดับที่ระบบวัดได้ในแต่ละรอบ ไม่ใช่หลักฐานว่าทักษะเพิ่มขึ้น · เส้นขาด = รอบนั้นวิเคราะห์เกณฑ์นี้ไม่ได้</p>
  </section>;
}

function LevelCell({ v, className }: { v: number | null; className?: string }) {
  return <span className={cn("grid place-items-center rounded-lg text-xs font-bold tabular-nums", v == null ? "border-[1.5px] border-dashed border-faint text-faint" : v >= 3 ? "text-white" : "text-brand-800", className)}
    style={v != null ? { background: LEVEL_COLOR[v] } : undefined}>{v ?? "?"}</span>;
}

function TrendTable({ runs }: { runs: SessionRow[] }) {
  return <div className="overflow-x-auto">
    <table className="w-full min-w-[600px] text-sm">
      <thead><tr className="text-left text-xs text-faint"><th className="py-2 pr-3 font-medium">เกณฑ์</th>{runs.map((r) => <th key={r.session_id} className="px-1 py-2 text-center font-medium">{thDate(r.created_at)}</th>)}</tr></thead>
      <tbody>{CODES.map((c) => <tr key={c} className="border-t border-line">
        <td className="py-2 pr-3 font-medium">{SHORT_NAME[c]}</td>
        {runs.map((r, i) => { const v = r.levels?.[c] ?? null, before = i ? runs[i - 1].levels?.[c] ?? null : null;
          return <td key={r.session_id} className="px-1 py-1.5"><span className="flex items-center justify-center gap-0.5"><LevelCell v={v} className="size-7" />{before != null && v != null && v > before && <ArrowUp className="size-3 text-brand" />}</span></td>; })}
      </tr>)}</tbody>
    </table>
  </div>;
}

/* ---------- History ---------- */

function HistoryList({ rows }: { rows: SessionRow[] }) {
  return <section id="history" className="card scroll-mt-24 p-6 lg:col-span-12">
    <SectionTitle eyebrow="ประวัติการซ้อม" title={`ส่งซ้อมแล้ว ${rows.filter(countsAsPractice).length} รอบ`} className="mb-3">
      <Button asChild size="sm" variant="soft"><Link to="/lab/compare"><ArrowLeftRight />เทียบ 2 รอบ</Link></Button>
    </SectionTitle>
    <div className="hidden grid-cols-[9rem_1fr_12rem_1.5rem] gap-4 px-3 pb-2 text-xs text-faint md:grid"><span>วันที่</span><span>ระดับ 8 เกณฑ์</span><span>เทียบรอบก่อน</span><span /></div>
    <ul className="divide-y divide-line">
      {rows.map((r, i) => { const prev = previousRun(rows, r.session_id, r.rubric_version); const n = r.levels && prev?.levels ? countUp(prev, r) : 0;
        const to = r.status === "done" ? `/lab/result?id=${r.session_id}` : "/lab/waiting";
        return <motion.li key={r.session_id} initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={{ delay: Math.min(i, 6) * 0.04 }}>
          <Link to={to} className="group grid items-center gap-x-4 gap-y-2 rounded-xl px-3 py-3 transition-colors hover:bg-surface md:grid-cols-[9rem_1fr_12rem_1.5rem]">
            <div>
              <p className="font-semibold">{thDate(r.created_at, { day: "numeric", month: "short", year: "2-digit" })}</p>
              <p className="flex items-center gap-1 text-xs text-muted"><Clock3 className="size-3.5" />{fmtDuration(r.duration_s ?? 0)} · {r.topics_count} หัวข้อ</p>
            </div>
            {r.levels ? <div className="flex items-center gap-1" aria-label="ระดับ 8 เกณฑ์">
              {CODES.map((c) => <LevelCell key={c} v={r.levels![c] ?? null} className="h-7 min-w-7 flex-1" />)}
            </div> : <div><Chip tone="soft"><Loader2 className="animate-spin" />กำลังวิเคราะห์</Chip></div>}
            <div>{n > 0 && <Chip tone="lime"><ArrowUp />ดีขึ้นจากรอบก่อน {n} เกณฑ์</Chip>}</div>
            <ChevronRight className="hidden size-5 text-faint transition-transform group-hover:translate-x-1 group-hover:text-brand md:block" />
          </Link>
        </motion.li>; })}
    </ul>
    <p className="mt-3 px-3 text-xs text-faint">"ดีขึ้นจากรอบก่อน" = ระดับที่ระบบวัดได้สูงกว่ารอบก่อน ไม่ใช่หลักฐานว่าทักษะเพิ่มขึ้น</p>
  </section>;
}

function countUp(prev: SessionRow, row: SessionRow) {
  return CODES.filter((c) => row.levels?.[c] != null && prev.levels?.[c] != null && row.levels![c]! > prev.levels![c]!).length;
}

