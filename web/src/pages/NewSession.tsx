/* /new: set up a rehearsal (useNewSession). 1 target time (+ optional template) -> the round is created;
   2 topics: draft from the report PDF, a template, or typed; check and confirm, or skip (C1/C2 then unanalyzable);
   then the video step. Beside it: the real presentation day with a suggested plan, and what makes a clip analysable.
   Files are checked before anything is sent, and every button that is off says why. */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { motion } from "motion/react";
import { ArrowRight, CalendarClock, CheckCircle2, ChevronDown, FileText, Hand, LayoutTemplate, Lightbulb, Loader2, PencilLine, ScanFace, SkipForward, Sun, Volume2, X } from "lucide-react";
import { MAX_TARGET_MIN, useNewSession } from "@/useNewSession";
import { TEMPLATES } from "@/templates";
import { Button, Chip, cn } from "@/v2/ui";
import { Shell } from "@/v2/Shell";
import { ConfirmDialog, StatusStepper, ErrorPanel, HelpTip, PRACTICE_STEPS, useToast } from "@/v2/states";
import { StageLightsMini } from "@/v2/StageLights";
import { TopicEditor } from "@/v2/TopicEditor";
import { PREF, writePref } from "@/v2/prefs";
import { useShellData } from "@/v2/sessions";
import { PATH } from "@/v2/paths";
import { TARGET_PRESETS, daysUntil, isoDay, practicePlan, presentDay, thDate } from "@/v2/time";

const PDF_MAX_MB = 30; // api/app/boundary.py PDF_BYTES
const USE_FOR: Record<number, string> = { 5: "พิตช์ไอเดีย", 10: "สัมมนา", 15: "สอบโครงงาน", 20: "สอบโครงงานแบบยาว" };

function checkPdf(f: File): { what: string; why: string; todo: string } | null {
  const mb = f.size / 1024 ** 2;
  if (!/\.pdf$/i.test(f.name) && f.type !== "application/pdf") return { what: `ไฟล์ "${f.name}" ไม่ใช่ PDF`, why: "ระบบอ่านหัวข้อได้จากไฟล์ PDF เท่านั้น", todo: "บันทึกรายงานหรือสไลด์เป็น PDF แล้วเลือกใหม่" };
  if (mb > PDF_MAX_MB) return { what: "ไฟล์ PDF ใหญ่เกินไป", why: `ไฟล์นี้ ${mb.toFixed(0)} MB แต่รับได้ไม่เกิน ${PDF_MAX_MB} MB`, todo: "ลบรูปที่ไม่จำเป็น หรือส่งเฉพาะบทที่มีหัวข้อนำเสนอ" };
  return null;
}

export default function NewSession() {
  const [params] = useSearchParams();
  const asked = Number(params.get("min"));
  const via = params.get("via") === "camera" || params.get("via") === "file" ? params.get("via") : null;
  const { minutes, setMinutes, validTarget, session, topics, setTopics, draft, busy, error, problems, template,
    start, readPdf, addManualTopics, applyTemplate, goToVideo } = useNewSession(asked >= 1 && asked <= MAX_TARGET_MIN ? asked : 15);
  const topicsHeading = useRef<HTMLHeadingElement>(null);
  const pdfInput = useRef<HTMLInputElement>(null);
  const [pdfProblem, setPdfProblem] = useState<ReturnType<typeof checkPdf>>(null);
  const [skipping, setSkipping] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);

  useEffect(() => { if (session) topicsHeading.current?.focus(); }, [session]);
  const filled = topics?.filter((t) => t.title.trim()).length ?? 0;
  const confirmOff = busy ? "รอให้งานที่กำลังทำเสร็จก่อน" : !validTarget ? `ตั้งเวลาเป้าหมาย 1–${MAX_TARGET_MIN} นาทีก่อน` : problems.length ? problems.join(" · ") : null;

  return <Shell page="new" title="ซ้อมรอบใหม่" subtitle="ตั้งเวลาและหัวข้อ แล้วอัดหรืออัปโหลดคลิป">
    <div className="card mb-5 hidden p-5 md:block">
      <StatusStepper steps={PRACTICE_STEPS} current={0} busy={!!busy} className="mx-auto max-w-2xl" />
    </div>

    <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
      <div className="space-y-5 lg:col-span-7">
        {/* 1. target time (Enter in the number field = next) */}
        <form className="card p-5 sm:p-6" noValidate onSubmit={(e) => { e.preventDefault(); if (!session) void start(); }}>
          <StepTitle n={1} title="เวลาเป้าหมาย" done={!!session} />
          <p className="mt-1 hidden text-sm text-muted sm:block">ระบบเทียบช่วงที่คุณพูดจริงกับเวลานี้ (เกณฑ์ T1)</p>
          <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="เวลาที่ใช้บ่อย">
            {TARGET_PRESETS.map((m) => <button key={m} type="button" onClick={() => setMinutes(m)} aria-pressed={minutes === m} disabled={!!busy}
              className={cn("min-h-11 rounded-full px-4 text-sm font-semibold transition-colors", minutes === m ? "bg-brand text-white" : "bg-surface text-muted hover:bg-brand-50 hover:text-brand")}>
              {m} นาที<span className="hidden font-normal opacity-75 sm:inline"> · {USE_FOR[m]}</span></button>)}
          </div>
          <label className="mt-4 flex flex-wrap items-center gap-3">
            <span className="text-sm text-muted">เวลาเป้าหมายในการนำเสนอ<span className="sr-only"> (นาที)</span></span>
            <span className="flex items-center gap-2">
              <input type="number" min={1} max={MAX_TARGET_MIN} step={0.5} value={Number.isFinite(minutes) && minutes ? minutes : ""} onChange={(e) => setMinutes(Number(e.target.value))}
                aria-invalid={!validTarget} aria-describedby="target-hint" disabled={!!busy}
                className={cn("h-11 w-24 rounded-xl bg-surface px-3 text-center font-semibold tabular-nums outline-none ring-1 ring-inset focus:ring-2", validTarget ? "ring-line focus:ring-brand" : "ring-navy focus:ring-navy")} />
              <span aria-hidden className="text-sm font-semibold">นาที</span>
            </span>
          </label>
          <p id="target-hint" className={cn("mt-2 text-xs", validTarget ? "text-faint" : "font-semibold text-ink")}>{validTarget ? `ตั้งได้ 1–${MAX_TARGET_MIN} นาที (คลิปยาวสุดที่ระบบวิเคราะห์ได้)` : `⚠ กรุณาตั้งเวลาเป้าหมาย 1–${MAX_TARGET_MIN} นาที`}</p>
          {!session && error && <ErrorPanel className="mt-3" what="สร้างรอบซ้อมไม่สำเร็จ" why={error} todo="ลองกดอีกครั้ง" />}
          {!session && <Button type="submit" size="lg" className="mt-4 w-full sm:w-auto" disabled={!!busy || !validTarget}>
            {busy === "start" ? <><Loader2 className="animate-spin" />กำลังสร้างรอบ…</> : <>ไปตั้งหัวข้อ <ArrowRight /></>}</Button>}
          {session && <p className="mt-3 flex items-center gap-1.5 text-xs text-muted"><CheckCircle2 className="size-4 text-brand" />สร้างรอบซ้อมแล้ว เปลี่ยนเวลาได้จนกว่าจะไปขั้นวิดีโอ</p>}

          {/* templates: time + draft topics, all editable */}
          <div className="mt-5 border-t border-line pt-4">
            <button type="button" onClick={() => setTemplatesOpen(!templatesOpen)} aria-expanded={templatesOpen} className="flex min-h-11 w-full items-center gap-2 text-left text-sm font-semibold">
              <LayoutTemplate className="size-4 text-brand" />เลือกแม่แบบ<span className="font-normal text-faint">(ไม่บังคับ)</span>
              {template && <Chip tone="soft" className="ml-1">{template.label}</Chip>}
              <ChevronDown className={cn("ml-auto size-4 text-faint transition-transform", templatesOpen && "rotate-180")} />
            </button>
            {templatesOpen && <div role="group" aria-label="เลือกแม่แบบโครงสร้างการนำเสนอ" className="mt-2">
              <p className="text-xs text-muted">แม่แบบตั้งเวลาและร่างหัวข้อให้ แก้ต่อได้ทุกข้อ</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {TEMPLATES.map((t) => <button key={t.id} type="button" aria-pressed={template?.id === t.id} disabled={!!busy} onClick={() => applyTemplate(t.id)}
                  className={cn("rounded-2xl p-3 text-left transition-colors", template?.id === t.id ? "bg-brand text-white" : "bg-surface hover:bg-brand-50")}>
                  <b className="block text-sm">{t.label}</b>
                  <span className={cn("text-xs", template?.id === t.id ? "text-white/75" : "text-muted")}>{t.minutes} นาที · {t.topics.length} หัวข้อ</span>
                </button>)}
              </div>
              {template?.note && <p className="mt-2 text-xs text-muted">{template.note}</p>}
            </div>}
          </div>
        </form>

        {/* 2. topics */}
        {session ? <section className="card p-5 sm:p-6" aria-labelledby="topics-heading">
          <h2 ref={topicsHeading} id="topics-heading" tabIndex={-1} className="flex items-center gap-3 text-lg font-bold outline-none">
            <span className={cn("grid size-8 place-items-center rounded-full text-sm", filled >= session.topic_limits.min ? "bg-brand text-white" : "bg-brand-50 text-brand")}>2</span>หัวข้อที่จะนำเสนอ
          </h2>
          <p className="mt-1 text-sm text-muted">หัวข้อที่ยืนยันใช้วัดลำดับและความครอบคลุม (C1, C2) ถ้าข้าม สองเกณฑ์นี้จะขึ้น "วิเคราะห์ไม่ได้"</p>
          {session.pdf_enabled && !draft && <label className={cn("mt-4 flex w-full cursor-pointer items-center gap-4 rounded-2xl border-2 border-dashed border-brand-200 bg-brand-50/40 p-5 text-left transition-colors hover:border-brand hover:bg-brand-50 focus-within:border-brand focus-within:ring-2 focus-within:ring-brand-300", busy && "pointer-events-none opacity-60")}>
            <input ref={pdfInput} type="file" accept="application/pdf,.pdf" className="sr-only" aria-label="เลือก PDF รายงานหรือสไลด์โครงงาน" aria-describedby="pdf-help" disabled={!!busy}
              onChange={(e) => { const f = e.currentTarget.files?.[0]; e.currentTarget.value = ""; if (!f) return; const bad = checkPdf(f); setPdfProblem(bad); if (!bad) void readPdf(f); }} />
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-white text-brand shadow-card">{busy === "pdf" ? <Loader2 className="size-5 animate-spin" /> : <FileText className="size-5" />}</span>
            <span><b className="block">{busy === "pdf" ? "กำลังสกัดหัวข้อจาก PDF…" : "เลือก PDF รายงานหรือสไลด์โครงงาน"}</b><span id="pdf-help" className="text-sm text-muted">{busy === "pdf" ? "ใช้เวลาราว 5–15 วินาที" : `ไม่เกิน ${PDF_MAX_MB} MB · ระบบเสนอรายการหัวข้อให้แก้ไขก่อนยืนยัน`}</span></span>
          </label>}
          {draft && <FileRow name={draft.pdfName} meta="ร่างหัวข้อจาก PDF แล้ว" />}
          {pdfProblem && <ErrorPanel className="mt-3" what={pdfProblem.what} why={pdfProblem.why} todo={pdfProblem.todo} actions={<Button size="sm" variant="soft" onClick={() => pdfInput.current?.click()}>เลือกไฟล์ใหม่</Button>} />}
          {error && <ErrorPanel className="mt-3" what={busy === null && !topics && session.pdf_enabled ? "ทำต่อไม่สำเร็จ" : "บันทึกไม่สำเร็จ"} why={error} todo="ลองอีกครั้ง หรือพิมพ์หัวข้อเอง" />}

          {!topics && <div className="mt-4 flex flex-wrap gap-2">
            <Button variant={session.pdf_enabled ? "soft" : "primary"} disabled={!!busy} onClick={addManualTopics}><PencilLine />เพิ่มหัวข้อเอง</Button>
            <Button variant="ghost" disabled={!!busy || !validTarget} title={!validTarget ? `ตั้งเวลาเป้าหมาย 1–${MAX_TARGET_MIN} นาทีก่อน` : undefined} onClick={() => setSkipping(true)}><SkipForward />ข้ามหัวข้อ</Button>
          </div>}
          {topics && <>
            <p className="mt-4 text-sm text-muted">
              {draft ? "ร่างจาก PDF โดยแบบจำลองภาษา ตรวจและแก้ให้ตรงกับที่จะพูดจริง" : template ? `ร่างจากแม่แบบ "${template.label}" แก้ให้ตรงกับที่จะพูดจริง` : "พิมพ์หัวข้อตามลำดับที่ตั้งใจจะพูด"}
              {" "}เรียงด้วยปุ่ม ↑ ↓ (ลำดับนี้ใช้ตรวจเกณฑ์ C1)
            </p>
            {draft?.note && <ErrorPanel tone="info" className="mt-3" what={draft.note} />}
            <TopicEditor topics={topics} limits={session.topic_limits} onChange={setTopics} disabled={!!busy} />
            {problems.length > 0 && <p className="mt-3 text-sm font-semibold text-ink" role="status">⚠ {problems.join(" · ")}</p>}
            <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-5">
              <Button size="lg" disabled={!!confirmOff} title={confirmOff ?? undefined} onClick={() => void goToVideo(topics, via)}>
                {busy === "confirm" ? <><Loader2 className="animate-spin" />กำลังบันทึก…</> : <>ยืนยันหัวข้อ แล้วไปขั้นวิดีโอ<ArrowRight /></>}</Button>
              <Button variant="ghost" disabled={!!busy || !validTarget} onClick={() => setSkipping(true)}><SkipForward />ข้ามหัวข้อ</Button>
              {confirmOff && !busy && <p className="w-full text-xs text-muted">ยังกดยืนยันไม่ได้: {confirmOff}</p>}
            </div>
          </>}
        </section> : <section className="card p-5 opacity-70 sm:p-6" aria-label="หัวข้อที่จะนำเสนอ (ขั้นถัดไป)">
          <StepTitle n={2} title="หัวข้อที่จะพูด" />
          <p className="mt-1 text-sm text-muted">ตั้งเวลาแล้วกด "ไปตั้งหัวข้อ" เพื่อใส่ PDF หรือพิมพ์หัวข้อ</p>
        </section>}

        <section className="card p-5 opacity-70 sm:p-6" aria-label="ส่งคลิปซ้อม (ขั้นถัดไป)">
          <StepTitle n={3} title="อัดหรืออัปโหลดคลิป" />
          <p className="mt-1 text-sm text-muted">หลังยืนยันหรือข้ามหัวข้อ จะไปหน้าเวทีจำลอง อัดจากกล้องหรือเลือกไฟล์วิดีโอได้</p>
        </section>
      </div>

      <div className="space-y-5 lg:col-span-5">
        <DayCard />
        <section className="card p-6">
          <p className="flex items-center gap-2 font-bold"><Lightbulb className="size-5 text-brand" />ก่อนอัด เช็ก 4 ข้อนี้</p>
          <p className="mt-1 text-sm text-muted">ถ้าระบบมองไม่เห็นหรือไม่ได้ยิน เกณฑ์นั้นจะขึ้น "วิเคราะห์ไม่ได้"</p>
          <ul className="mt-4 space-y-2.5 text-sm">
            {([[ScanFace, "เห็นใบหน้าอย่างน้อย 70% ของเวลา"], [Hand, "เห็นมือในกล้องอย่างน้อย 70% ของเวลา"], [Sun, "ห้องสว่าง ไม่ย้อนแสง"], [Volume2, "เงียบพอ ปิดพัดลมหรือแอร์ที่ดัง"]] as const).map(([I, t]) =>
              <li key={t} className="flex items-center gap-3 rounded-xl bg-surface px-3 py-2.5"><span className="grid size-8 place-items-center rounded-lg bg-brand-50 text-brand"><I className="size-4" /></span>{t}</li>)}
          </ul>
          <Link to={PATH.film} className="mt-3 inline-block text-sm font-semibold text-brand hover:underline">วิธีตั้งกล้องแบบละเอียด →</Link>
        </section>
        <p className="text-center text-xs text-faint">คลิปยาวสุด {MAX_TARGET_MIN} นาที · ระบบไม่วัดอารมณ์ การสบตา หรือความหมายของท่ามือ</p>
      </div>
    </div>

    <ConfirmDialog open={skipping} onClose={() => setSkipping(false)} title="ข้ามการยืนยันหัวข้อหรือไม่?" confirmLabel="ข้ามและไปขั้นวิดีโอ" onConfirm={() => void goToVideo(null, via)}>
      ถ้าข้าม ระบบจะแสดง "วิเคราะห์ไม่ได้" ในเกณฑ์เนื้อหา C1 และ C2 เกณฑ์อื่นวิเคราะห์ตามปกติ
    </ConfirmDialog>
  </Shell>;
}

/** The real presentation day (kept in this browser): countdown, suggested rehearsal days, stage lights. */
function DayCard() {
  const toast = useToast();
  const { stage } = useShellData();
  const [day, setDay] = useState(() => presentDay());
  const now = useMemo(() => new Date(), []);
  const left = day ? daysUntil(day, now) : null;
  const plan = useMemo(() => (day ? practicePlan(day, now) : []), [day, now]);
  const change = (v: string) => {
    if (!v) { setDay(null); writePref(PREF.presentDay, null); return; }
    const d = new Date(`${v}T09:00:00+07:00`);
    if (Number.isNaN(d.getTime())) return;
    setDay(d); writePref(PREF.presentDay, v);
    toast(`ตั้งวันพรีเซนต์เป็น ${thDate(d, { day: "numeric", month: "long" })} แล้ว`);
  };
  return <section id="day" className="relative scroll-mt-24 overflow-hidden rounded-panel bg-navy p-6 text-white shadow-lift">
    <div aria-hidden className="absolute -right-16 -top-20 size-56 rounded-full bg-brand/50 blur-3xl" />
    <div className="relative flex items-center justify-between gap-3">
      <Chip tone="glass"><CalendarClock />วันพรีเซนต์จริง</Chip>
      {stage && <StageLightsMini lights={stage.lights} atRisk={stage.atRisk} dark />}
    </div>
    {left == null ? <p className="relative mt-4 text-lg font-semibold">ตั้งวันขึ้นเวทีจริง แล้วระบบจะแนะนำวันซ้อมให้</p>
      : <div className="relative mt-4 flex items-end gap-3">
        <motion.p key={left} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="text-7xl font-bold leading-none tabular-nums text-lime">{Math.max(0, left)}</motion.p>
        <p className="pb-1.5 text-lg font-semibold">{left > 0 ? "วันก่อนขึ้นเวทีจริง" : left === 0 ? "วันนี้คือวันจริง!" : "วันนั้นผ่านไปแล้ว"}</p>
      </div>}
    <div className="relative mt-4 flex flex-wrap items-center gap-2 text-sm text-white/75">
      <label className="flex flex-wrap items-center gap-2">วันที่
        <input type="date" value={day ? isoDay(day) : ""} min={isoDay(now)} onChange={(e) => change(e.target.value)}
          className="h-11 rounded-xl bg-white/10 px-3 font-semibold text-white outline-none ring-1 ring-inset ring-white/20 [color-scheme:dark] focus:ring-lime" />
      </label>
      {day && <button type="button" onClick={() => change("")} className="inline-flex min-h-11 items-center gap-1 rounded-full px-3 text-xs text-white/60 hover:bg-white/10 hover:text-white"><X className="size-3.5" />ล้างวัน</button>}
      <HelpTip dark>เก็บไว้ในเบราว์เซอร์นี้เท่านั้น ไม่ส่งไปที่เซิร์ฟเวอร์</HelpTip>
    </div>
    {plan.length > 0 && <>
      <p className="relative mt-6 text-sm font-semibold">แผนซ้อมที่แนะนำ {plan.length} รอบ</p>
      <ol className="relative mt-3 space-y-2">
        {plan.map((d, i) => { const today = daysUntil(d, now) === 0;
          return <li key={d.toISOString()} className={cn("flex items-center gap-3 rounded-xl px-3 py-2.5", today ? "bg-lime text-navy" : "bg-white/[0.07]")}>
            <span className={cn("grid size-7 place-items-center rounded-full text-xs font-bold", today ? "bg-navy text-lime" : "bg-white/15")}>{i + 1}</span>
            <span className="flex-1 text-sm font-semibold">{thDate(d, { weekday: "short", day: "numeric", month: "short" })}</span>
            <span className={cn("text-xs", today ? "font-bold" : "text-white/60")}>{today ? "วันนี้" : `อีก ${daysUntil(d, now)} วัน`}</span>
          </li>; })}
      </ol>
      <p className="relative mt-3 text-xs text-white/55">เว้นราว 3 วันต่อรอบ รอบสุดท้ายก่อนวันจริง 1 วัน ซ้อมตามแผนนี้ไฟเวทีจะติดทุกสัปดาห์</p>
    </>}
  </section>;
}

function StepTitle({ n, title, done }: { n: number; title: string; done?: boolean }) {
  return <h2 className="flex items-center gap-3 text-lg font-bold">
    <span className={cn("grid size-8 place-items-center rounded-full text-sm", done ? "bg-brand text-white" : "bg-brand-50 text-brand")}>{done ? <CheckCircle2 className="size-4" /> : n}</span>{title}
  </h2>;
}

function FileRow({ name, meta, icon = <FileText /> }: { name: string; meta: string; icon?: ReactNode }) {
  return <div className="mt-4 flex items-center gap-4 rounded-2xl bg-lime-200/50 p-4">
    <span className="grid size-11 place-items-center rounded-xl bg-white text-brand [&_svg]:size-5">{icon}</span>
    <span className="min-w-0 flex-1"><b className="block truncate">{name}</b><span className="text-sm text-muted">{meta}</span></span>
  </div>;
}
