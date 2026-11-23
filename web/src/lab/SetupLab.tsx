/* /lab/new: set up a rehearsal. Real presentation day -> countdown + suggested plan; target time; report PDF;
   record or upload. Files are checked before anything is sent (type, size), and the main button says why it is off. */
import { useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { ArrowDown, ArrowUp, CalendarClock, Camera, CheckCircle2, FileText, Hand, Lightbulb, PencilLine, Plus, ScanFace, Sun, Upload, Volume2, X } from "lucide-react";
import { Button, Chip, cn } from "@/v2/ui";
import { Shell } from "@/v2/Shell";
import { StatusStepper, ErrorPanel, HelpTip, PRACTICE_STEPS, useToast } from "@/v2/states";
import { StageLightsMini } from "@/v2/StageLights";
import { PREF, writePref } from "@/v2/prefs";
import { RESULT } from "./fixtures";
import { LAB_NOW, TARGET_PRESETS, daysUntil, practicePlan, presentDay, thDate, useLabShell } from "./demo";

const MAX_TARGET_MIN = 30;                       // same as useNewSession.ts (pipeline max clip length)
const VIDEO_TYPES = [".mp4", ".webm", ".mov"];   // same as SessionVideo.tsx VIDEO_ACCEPT
const VIDEO_MAX_MB = 512;                        // api/app/boundary.py VIDEO_BYTES
const PDF_MAX_MB = 30;                           // api/app/boundary.py PDF_BYTES
const USE_FOR: Record<number, string> = { 5: "พิตช์ไอเดีย", 10: "สัมมนา", 15: "สอบโครงงาน", 20: "สอบโครงงานแบบยาว" }; // one preset list (demo.ts TARGET_PRESETS)
const MAX_TOPICS = 15;  // config/thresholds-v0.yaml C2 max_topics
const MIN_TOPICS = 3;   // C2 unanalyzable.min_topics (C1 needs 4 clearly explained topics for a level)
const SAMPLE_TOPICS = RESULT.topics.map((t) => t.title); // demo stand-in for the LLM draft from the PDF
const ymd = (d: Date) => new Date(d.getTime() + 7 * 3600e3).toISOString().slice(0, 10);

type FileCheck = { ok: true; name: string; mb: number } | { ok: false; what: string; why: string; todo: string };

function checkFile(f: File, kind: "video" | "pdf"): FileCheck {
  const mb = f.size / 1024 ** 2, ext = f.name.slice(f.name.lastIndexOf(".")).toLowerCase();
  if (kind === "pdf") {
    if (ext !== ".pdf") return { ok: false, what: `ไฟล์ "${f.name}" ไม่ใช่ PDF`, why: "ระบบอ่านหัวข้อได้จากไฟล์ PDF เท่านั้น", todo: "บันทึกรายงานหรือสไลด์เป็น PDF แล้วเลือกใหม่" };
    if (mb > PDF_MAX_MB) return { ok: false, what: "ไฟล์ PDF ใหญ่เกินไป", why: `ไฟล์นี้ ${mb.toFixed(0)} MB แต่รับได้ไม่เกิน ${PDF_MAX_MB} MB`, todo: "ลบรูปที่ไม่จำเป็น หรือส่งเฉพาะบทที่มีหัวข้อนำเสนอ" };
  } else {
    if (!VIDEO_TYPES.includes(ext)) return { ok: false, what: `ไฟล์ "${f.name}" ไม่ใช่วิดีโอที่ระบบรับ`, why: `รับเฉพาะ ${VIDEO_TYPES.join(" ")}`, todo: "แปลงไฟล์เป็น .mp4 แล้วลองใหม่ หรืออัดจากกล้องในหน้านี้" };
    if (mb > VIDEO_MAX_MB) return { ok: false, what: "วิดีโอใหญ่เกินไป", why: `ไฟล์นี้ ${(mb / 1024).toFixed(1)} GB แต่รับได้ไม่เกิน ${VIDEO_MAX_MB} MB`, todo: "ลดความละเอียดเป็น 720p หรือ 480p ก่อนอัปโหลด (ระบบเก็บไว้แค่ 480p อยู่แล้ว)" };
  }
  return { ok: true, name: f.name, mb };
}

export default function SetupLab() {
  const shell = useLabShell();
  const nav = useNavigate();
  const toast = useToast();
  const [day, setDay] = useState(() => presentDay());
  const [minutes, setMinutes] = useState(15);
  const [pdf, setPdf] = useState<FileCheck | null>(null);
  const [video, setVideo] = useState<FileCheck | null>(null);
  const [topics, setTopics] = useState<string[] | null>(null);
  const pdfInput = useRef<HTMLInputElement>(null), videoInput = useRef<HTMLInputElement>(null);
  const validTarget = Number.isFinite(minutes) && minutes >= 1 && minutes <= MAX_TARGET_MIN;
  const left = daysUntil(day);
  const plan = useMemo(() => practicePlan(day), [day]);

  const changeDay = (v: string) => {
    if (!v) return;
    const d = new Date(`${v}T09:00:00+07:00`);
    setDay(d); writePref(PREF.presentDay, v);
    toast(`ตั้งวันพรีเซนต์เป็น ${thDate(d, { day: "numeric", month: "long" })} แล้ว`);
  };
  const blocked = !validTarget ? `ตั้งเวลาเป้าหมาย 1–${MAX_TARGET_MIN} นาทีก่อน` : null;

  return <Shell page="new" title="ซ้อมรอบใหม่" subtitle="ตั้งค่า 3 อย่าง แล้วเริ่มซ้อมได้เลย" {...shell}>
    <div className="card mb-5 p-5">
      <StatusStepper steps={PRACTICE_STEPS} current={0} className="mx-auto max-w-2xl" />
    </div>

    <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
      <div className="space-y-5 lg:col-span-7">
        {/* 1. target time */}
        <section className="card p-6">
          <StepTitle n={1} title="เวลาเป้าหมาย" done={validTarget} />
          <p className="mt-1 text-sm text-muted">ระบบเทียบช่วงที่คุณพูดจริงกับเวลานี้ (เกณฑ์ T1) <HelpTip href="/lab/how#T1">เกินหรือขาดคิดแบบเดียวกัน เช่น เป้า 15 นาที พูด 14 หรือ 16 นาที ต่างจากเป้า 6.7% เท่ากัน</HelpTip></p>
          <div className="mt-4 flex flex-wrap gap-2">
            {TARGET_PRESETS.map((m) => <button key={m} type="button" onClick={() => setMinutes(m)} aria-pressed={minutes === m}
              className={cn("rounded-full px-4 py-2 text-sm font-semibold transition-colors", minutes === m ? "bg-brand text-white" : "bg-surface text-muted hover:bg-brand-50 hover:text-brand")}>{m} นาที <span className="font-normal opacity-75">· {USE_FOR[m]}</span></button>)}
          </div>
          <label className="mt-4 flex items-center gap-3">
            <span className="text-sm text-muted">หรือกำหนดเอง</span>
            <input type="number" min={1} max={MAX_TARGET_MIN} step={0.5} value={Number.isFinite(minutes) ? minutes : ""} onChange={(e) => setMinutes(e.target.valueAsNumber)}
              aria-invalid={!validTarget} aria-describedby="target-hint"
              className={cn("h-11 w-24 rounded-xl bg-surface px-3 text-center font-semibold tabular-nums outline-none ring-1 ring-inset focus:ring-2", validTarget ? "ring-line focus:ring-brand" : "ring-navy focus:ring-navy")} />
            <span className="text-sm font-semibold">นาที</span>
          </label>
          <p id="target-hint" className={cn("mt-2 text-xs", validTarget ? "text-faint" : "font-semibold text-ink")}>{validTarget ? `ตั้งได้ 1–${MAX_TARGET_MIN} นาที (คลิปยาวสุดที่ระบบวิเคราะห์ได้)` : `⚠ กรุณาตั้งเวลาเป้าหมาย 1–${MAX_TARGET_MIN} นาที`}</p>
        </section>

        {/* 2. topics: drafted from the PDF or typed, then checked by the user */}
        <section className="card p-6">
          <StepTitle n={2} title="หัวข้อที่จะพูด (ไม่บังคับ)" done={topics != null && topics.filter((t) => t.trim()).length >= MIN_TOPICS} />
          <p className="mt-1 text-sm text-muted">ใส่ PDF รายงานหรือสไลด์ให้ระบบร่างหัวข้อ หรือพิมพ์เอง แล้วตรวจก่อนซ้อม ใช้วัดลำดับและความครอบคลุม (C1, C2) ถ้าข้าม สองเกณฑ์นี้จะขึ้น "วิเคราะห์ไม่ได้"</p>
          <input ref={pdfInput} type="file" accept="application/pdf,.pdf" className="sr-only" onChange={(e) => {
            const f = e.target.files?.[0]; if (f) { const c = checkFile(f, "pdf"); setPdf(c); if (c.ok) { setTopics(SAMPLE_TOPICS); toast("ร่างหัวข้อจาก PDF แล้ว (ตัวอย่าง) ตรวจและแก้ได้เลย"); } } e.target.value = "";
          }} />
          {pdf?.ok ? <FileRow icon={<FileText />} name={pdf.name} meta={`${pdf.mb.toFixed(1)} MB · ร่างหัวข้อแล้ว`} onClear={() => { setPdf(null); setTopics(null); }} />
            : <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
              <DropButton onClick={() => pdfInput.current?.click()} icon={<FileText />} title="เลือกไฟล์ PDF" note={`ไม่เกิน ${PDF_MAX_MB} MB · ระบบร่างหัวข้อให้`} />
              {topics == null && <Button variant="soft" className="h-auto min-h-14 rounded-2xl sm:mt-4" onClick={() => setTopics(["", "", ""])}><PencilLine />พิมพ์หัวข้อเอง</Button>}
            </div>}
          {pdf && !pdf.ok && <ErrorPanel className="mt-3" what={pdf.what} why={pdf.why} todo={pdf.todo} actions={<Button size="sm" variant="soft" onClick={() => pdfInput.current?.click()}>เลือกไฟล์ใหม่</Button>} />}
          {topics != null && <TopicEditor topics={topics} onChange={setTopics} />}
        </section>

        {/* 3. record or upload */}
        <section className="card p-6">
          <StepTitle n={3} title="ส่งคลิปซ้อม" />
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Choice icon={<Camera />} title="อัดจากกล้อง" body="มีนาฬิกาจับเวลาและวงเวลาเป้าหมายบนเวทีจำลอง" disabled={blocked} onClick={() => nav(`/lab/record?min=${minutes}`)} primary />
            <Choice icon={<Upload />} title="อัปโหลดคลิป" body={`${VIDEO_TYPES.join(" ")} ไม่เกิน ${VIDEO_MAX_MB} MB`} disabled={blocked} onClick={() => videoInput.current?.click()} />
          </div>
          <input ref={videoInput} type="file" accept={VIDEO_TYPES.join(",")} className="sr-only"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) { const c = checkFile(f, "video"); setVideo(c); if (c.ok) nav("/lab/waiting"); } e.target.value = ""; }} />
          {blocked && <p className="mt-3 text-xs font-semibold text-ink">ยังกดไม่ได้: {blocked}</p>}
          {video && !video.ok && <ErrorPanel className="mt-3" what={video.what} why={video.why} todo={video.todo} actions={<Button size="sm" variant="soft" onClick={() => videoInput.current?.click()}>เลือกไฟล์ใหม่</Button>} />}
          <p className="mt-4 text-xs text-faint">หน้านี้เป็นตัวอย่าง: ไฟล์ที่เลือกไม่ถูกส่งไปไหน</p>
        </section>
      </div>

      <div className="space-y-5 lg:col-span-5">
        {/* countdown to the real day */}
        <section id="day" className="relative scroll-mt-24 overflow-hidden rounded-panel bg-navy p-6 text-white shadow-lift">
          <div aria-hidden className="absolute -right-16 -top-20 size-56 rounded-full bg-brand/50 blur-3xl" />
          <div className="relative flex items-center justify-between gap-3">
            <Chip tone="glass"><CalendarClock />วันพรีเซนต์จริง</Chip>
            <StageLightsMini lights={shell.stage.lights} atRisk={shell.stage.atRisk} dark />
          </div>
          <div className="relative mt-4 flex items-end gap-3">
            <motion.p key={left} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="text-7xl font-bold leading-none tabular-nums text-lime">{Math.max(0, left)}</motion.p>
            <p className="pb-1.5 text-lg font-semibold">{left > 0 ? "วันก่อนขึ้นเวทีจริง" : left === 0 ? "วันนี้คือวันจริง!" : "วันนั้นผ่านไปแล้ว"}</p>
          </div>
          <label className="relative mt-4 flex flex-wrap items-center gap-2 text-sm text-white/75">
            วันที่
            <input type="date" value={ymd(day)} min={ymd(LAB_NOW)} onChange={(e) => changeDay(e.target.value)}
              className="h-10 rounded-xl bg-white/10 px-3 font-semibold text-white outline-none ring-1 ring-inset ring-white/20 [color-scheme:dark] focus:ring-lime" />
          </label>
          {plan.length > 0 && <>
            <p className="relative mt-6 text-sm font-semibold">แผนซ้อมที่แนะนำ {plan.length} รอบ</p>
            <ol className="relative mt-3 space-y-2">
              {plan.map((d, i) => { const today = daysUntil(d) === 0;
                return <li key={d.toISOString()} className={cn("flex items-center gap-3 rounded-xl px-3 py-2.5", today ? "bg-lime text-navy" : "bg-white/[0.07]")}>
                  <span className={cn("grid size-7 place-items-center rounded-full text-xs font-bold", today ? "bg-navy text-lime" : "bg-white/15")}>{i + 1}</span>
                  <span className="flex-1 text-sm font-semibold">{thDate(d, { weekday: "short", day: "numeric", month: "short" })}</span>
                  <span className={cn("text-xs", today ? "font-bold" : "text-white/60")}>{today ? "วันนี้" : `อีก ${daysUntil(d)} วัน`}</span>
                </li>; })}
            </ol>
            <p className="relative mt-3 text-xs text-white/55">เว้นราว 3 วันต่อรอบ รอบสุดท้ายก่อนวันจริง 1 วัน ซ้อมตามแผนนี้ไฟเวทีจะติดทุกสัปดาห์</p>
          </>}
        </section>

        {/* prevention: what makes a clip analysable */}
        <section className="card p-6">
          <p className="flex items-center gap-2 font-bold"><Lightbulb className="size-5 text-brand" />ก่อนอัด เช็ก 4 ข้อนี้</p>
          <p className="mt-1 text-sm text-muted">ถ้าระบบมองไม่เห็นหรือไม่ได้ยิน เกณฑ์นั้นจะขึ้น "วิเคราะห์ไม่ได้"</p>
          <ul className="mt-4 space-y-2.5 text-sm">
            {[[ScanFace, "เห็นใบหน้าอย่างน้อย 70% ของเวลา"], [Hand, "เห็นมือในกล้องอย่างน้อย 70% ของเวลา"], [Sun, "ห้องสว่าง ไม่ย้อนแสง"], [Volume2, "เงียบพอ ปิดพัดลมหรือแอร์ที่ดัง"]].map(([Icon, t]) => {
              const I = Icon as typeof Hand;
              return <li key={t as string} className="flex items-center gap-3 rounded-xl bg-surface px-3 py-2.5"><span className="grid size-8 place-items-center rounded-lg bg-brand-50 text-brand"><I className="size-4" /></span>{t as string}</li>;
            })}
          </ul>
          <Link to="/lab/help#film" className="mt-3 inline-block text-sm font-semibold text-brand hover:underline">วิธีตั้งกล้องแบบละเอียด →</Link>
        </section>
        <p className="text-center text-xs text-faint">คลิปยาวสุด {MAX_TARGET_MIN} นาที · ระบบไม่วัดอารมณ์ การสบตา หรือความหมายของท่ามือ</p>
      </div>
    </div>
  </Shell>;
}

/** Check the drafted topics before practising: rename, reorder, remove, add (3–15). */
function TopicEditor({ topics, onChange }: { topics: string[]; onChange: (t: string[]) => void }) {
  const filled = topics.filter((t) => t.trim()).length;
  const set = (i: number, v: string) => onChange(topics.map((t, j) => (j === i ? v : t)));
  const move = (i: number, d: number) => { const n = [...topics]; [n[i], n[i + d]] = [n[i + d], n[i]]; onChange(n); };
  return <div className="mt-4">
    <div className="flex items-center justify-between gap-3">
      <p className="text-sm font-semibold">ลำดับหัวข้อที่จะพูด</p>
      <span className={cn("text-xs", filled >= MIN_TOPICS ? "text-muted" : "font-semibold text-ink")}>{filled} หัวข้อ{filled < MIN_TOPICS && ` · ต้องมีอย่างน้อย ${MIN_TOPICS}`}</span>
    </div>
    <ol className="mt-2 space-y-2">
      {topics.map((t, i) => <li key={i} className="flex items-center gap-2">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand text-xs font-bold text-white">{i + 1}</span>
        <input value={t} onChange={(e) => set(i, e.target.value)} placeholder={`หัวข้อที่ ${i + 1}`} aria-label={`หัวข้อที่ ${i + 1}`} maxLength={120}
          className="h-10 min-w-0 flex-1 rounded-xl bg-surface px-3 text-sm outline-none ring-1 ring-inset ring-line focus:bg-white focus:ring-2 focus:ring-brand" />
        <span className="flex shrink-0">
          <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`เลื่อนหัวข้อที่ ${i + 1} ขึ้น`} className="grid size-8 place-items-center rounded-lg text-muted hover:bg-surface disabled:opacity-30"><ArrowUp className="size-4" /></button>
          <button type="button" onClick={() => move(i, 1)} disabled={i === topics.length - 1} aria-label={`เลื่อนหัวข้อที่ ${i + 1} ลง`} className="grid size-8 place-items-center rounded-lg text-muted hover:bg-surface disabled:opacity-30"><ArrowDown className="size-4" /></button>
          <button type="button" onClick={() => onChange(topics.filter((_, j) => j !== i))} aria-label={`ลบหัวข้อที่ ${i + 1}`} className="grid size-8 place-items-center rounded-lg text-muted hover:bg-surface"><X className="size-4" /></button>
        </span>
      </li>)}
    </ol>
    <Button size="sm" variant="soft" className="mt-3" disabled={topics.length >= MAX_TOPICS} title={topics.length >= MAX_TOPICS ? `ใส่ได้สูงสุด ${MAX_TOPICS} หัวข้อ` : undefined}
      onClick={() => onChange([...topics, ""])}><Plus />เพิ่มหัวข้อ</Button>
    <p className="mt-2 text-xs text-faint">เรียงตามที่ตั้งใจจะพูด ระบบเทียบลำดับนี้กับที่พูดจริง (C1 ให้ระดับเมื่ออธิบายชัดอย่างน้อย 4 หัวข้อ)</p>
  </div>;
}

function StepTitle({ n, title, done }: { n: number; title: string; done?: boolean }) {
  return <h2 className="flex items-center gap-3 text-lg font-bold">
    <span className={cn("grid size-8 place-items-center rounded-full text-sm", done ? "bg-brand text-white" : "bg-brand-50 text-brand")}>{done ? <CheckCircle2 className="size-4" /> : n}</span>{title}
  </h2>;
}

function DropButton({ onClick, icon, title, note }: { onClick: () => void; icon: ReactNode; title: string; note: string }) {
  return <button type="button" onClick={onClick} className="mt-4 flex w-full items-center gap-4 rounded-2xl border-2 border-dashed border-brand-200 bg-brand-50/40 p-5 text-left transition-colors hover:border-brand hover:bg-brand-50">
    <span className="grid size-11 place-items-center rounded-xl bg-white text-brand shadow-card [&_svg]:size-5">{icon}</span>
    <span><b className="block">{title}</b><span className="text-sm text-muted">{note}</span></span>
  </button>;
}

function FileRow({ icon, name, meta, onClear }: { icon: ReactNode; name: string; meta: string; onClear: () => void }) {
  return <div className="mt-4 flex items-center gap-4 rounded-2xl bg-lime-200/50 p-4">
    <span className="grid size-11 place-items-center rounded-xl bg-white text-brand [&_svg]:size-5">{icon}</span>
    <span className="min-w-0 flex-1"><b className="block truncate">{name}</b><span className="text-sm text-muted">{meta}</span></span>
    <button type="button" onClick={onClear} aria-label="เอาไฟล์ออก" className="grid size-9 place-items-center rounded-full text-muted hover:bg-white"><X className="size-4" /></button>
  </div>;
}

function Choice({ icon, title, body, onClick, disabled, primary }: { icon: ReactNode; title: string; body: string; onClick: () => void; disabled: string | null; primary?: boolean }) {
  return <button type="button" onClick={onClick} disabled={!!disabled} title={disabled ?? undefined}
    className={cn("group flex flex-col items-start gap-3 rounded-2xl p-5 text-left transition-[transform,box-shadow] disabled:cursor-not-allowed disabled:opacity-50",
      primary ? "bg-brand-gradient text-white shadow-glow enabled:hover:-translate-y-0.5" : "bg-surface ring-1 ring-inset ring-line enabled:hover:-translate-y-0.5 enabled:hover:shadow-card")}>
    <span className={cn("grid size-11 place-items-center rounded-xl [&_svg]:size-5", primary ? "bg-lime text-navy" : "bg-white text-brand shadow-card")}>{icon}</span>
    <span><b className="block text-lg">{title}</b><span className={cn("text-sm", primary ? "text-white/75" : "text-muted")}>{body}</span></span>
  </button>;
}
