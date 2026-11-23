/* /sessions/:id/video: record on the simulated stage (useRecorder) or pick a file, check it, then send it to the
   analysis queue in chunks (useVideoUpload). A recording or an unsent clip is never dropped silently: leaving the
   page, switching mode or recording over a clip all ask first (useLeaveGuard, dialogs). */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Camera, CheckCircle2, CircleStop, Clock3, FileText, FileVideo, Loader2, Play, RefreshCw, Send, Upload, X } from "lucide-react";
import { ApiError, api } from "@/api";
import type { SessionInfo } from "@/contract";
import { fmtDuration } from "@/presentation";
import { useObjectUrl } from "@/useObjectUrl";
import { useVideoUpload, type Clip } from "@/useVideoUpload";
import { useLeaveGuard } from "@/useLeaveGuard";
import { CHECKLIST, COUNTDOWN_CHOICES, useRecorder } from "@/useRecorder";
import { Button, Chip, cn } from "@/v2/ui";
import { Shell } from "@/v2/Shell";
import { ConfirmDialog, EmptyState, ErrorPanel, PRACTICE_STEPS, Skeleton, StatusStepper } from "@/v2/states";
import { useSessions } from "@/v2/sessions";
import { PATH } from "@/v2/paths";

type Mode = "record" | "upload";
const VIDEO_EXTENSIONS = /\.(mp4|webm|mov)$/i;
const VIDEO_ACCEPT = ".mp4,.webm,.mov,video/mp4,video/webm,video/quicktime";
const VIDEO_MAX_MB = 512; // api/app/boundary.py VIDEO_BYTES
const BAND = 0.05;        // config/thresholds-v0.yaml T1 level 4: deviation_pct 5 (draft rubric v0.9)

export default function SessionVideo() {
  const { id = "" } = useParams();
  return <VideoStep key={id} id={id} />;
}

function VideoStep({ id }: { id: string }) {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const { reload } = useSessions();
  const [info, setInfo] = useState<SessionInfo | null>(null);
  const [load, setLoad] = useState<"loading" | "missing" | string>("loading");
  const [attempt, setAttempt] = useState(0);
  const [mode, setMode] = useState<Mode>(params.get("via") === "file" ? "upload" : "record");
  const [clip, setClip] = useState<Clip | null>(null);
  const [recorderActive, setRecorderActive] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  const [pendingMode, setPendingMode] = useState<Mode | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const leaving = useRef(false);
  const modeButtons = useRef<Record<Mode, HTMLButtonElement | null>>({ record: null, upload: null });
  const clipUrl = useObjectUrl(mode === "upload" ? clip?.blob : null);
  const { send, sending, progress, error, setError, isSending } = useVideoUpload(id, () => {
    guard.release();
    reload(); // the dashboard and stage lights pick up the queued round at once
    nav(PATH.result(id));
  }, setInfo);
  const guard = useLeaveGuard(info?.status === "created" && (recorderActive || !!clip || sending));

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    setLoad("loading");
    api.session(id, signal).then((data) => { if (!signal.aborted) { setInfo(data); setLoad(""); } }).catch((e) => {
      if (signal.aborted) return;
      setLoad(e instanceof ApiError && e.status === 404 ? "missing" : String(e.message));
    });
    return () => controller.abort();
  }, [id, attempt]);

  const { blocker } = guard;
  useEffect(() => { if (blocker.state === "blocked") { leaving.current = false; setLeaveOpen(true); } else setLeaveOpen(false); }, [blocker.state]);

  function switchMode(next: Mode) {
    setClip(null); setRecorderActive(false); setPreviewError(false); setError(null); setMode(next);
  }
  function requestMode(next: Mode) {
    if (next === mode || isSending()) return;
    if (clip || recorderActive) setPendingMode(next); else switchMode(next);
  }
  function selectFile(file?: File) {
    if (!file || isSending()) return;
    if (!VIDEO_EXTENSIONS.test(file.name)) { setError("รองรับเฉพาะไฟล์ .mp4 .webm .mov แปลงไฟล์เป็น .mp4 แล้วลองใหม่ หรืออัดจากกล้องในหน้านี้"); return; }
    if (!file.size) { setError("ไฟล์ว่างเปล่า กรุณาเลือกไฟล์ใหม่"); return; }
    if (file.size > VIDEO_MAX_MB * 1024 ** 2) { setError(`ไฟล์นี้ ${(file.size / 1024 ** 3).toFixed(1)} GB แต่รับได้ไม่เกิน ${VIDEO_MAX_MB} MB ลดความละเอียดเป็น 720p หรือ 480p ก่อนอัปโหลด`); return; }
    setError(null); setPreviewError(false); setClip({ blob: file, name: file.name });
  }

  const shell = (body: ReactNode) => <Shell page="new" title="ซ้อมและส่งคลิป" subtitle={info ? `เวลาเป้าหมาย ${fmtDuration(info.target_duration_s)}` : undefined}>{body}</Shell>;
  if (load === "loading") return shell(<div className="space-y-4" role="status" aria-label="กำลังโหลดรอบซ้อม"><Skeleton className="h-14" /><Skeleton className="h-[420px] rounded-panel" /></div>);
  if (load === "missing") return shell(<EmptyState pose="think" title="ไม่พบรอบซ้อมนี้" action={<Button asChild><Link to={PATH.new}>ซ้อมรอบใหม่</Link></Button>}>ลิงก์อาจผิด หรือรอบนี้เป็นของบัญชีอื่น</EmptyState>);
  if (load || !info) return shell(<ErrorPanel what="โหลดรอบซ้อมไม่สำเร็จ" why={load || undefined} todo="ตรวจการเชื่อมต่อแล้วลองใหม่" actions={<Button size="sm" onClick={() => setAttempt((n) => n + 1)}><RefreshCw />ลองใหม่</Button>} />);
  if (info.status !== "created") return shell(<ErrorPanel tone="info" what="ส่งวิดีโอของรอบนี้แล้ว" todo="ดูสถานะการวิเคราะห์และผลได้ที่หน้าผล"
    actions={<Button size="sm" asChild><Link to={PATH.result(id)}>ดูสถานะและผล <ArrowRight /></Link></Button>} />);

  const topics = info.confirmed_topics ?? [];
  const percent = progress === null ? null : Math.floor(progress * 100);
  return shell(<>
    <div className="card mb-5 hidden p-5 md:block"><StatusStepper steps={PRACTICE_STEPS} current={1} busy={sending} className="mx-auto max-w-2xl" /></div>

    {/* what this round is set up with */}
    <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
      <Chip tone="soft"><Clock3 />เวลาเป้าหมาย {fmtDuration(info.target_duration_s)}</Chip>
      {topics.length > 0 ? <details className="group rounded-2xl bg-white px-3 py-1.5 shadow-card">
        <summary className="flex min-h-8 cursor-pointer list-none items-center gap-1.5 font-semibold"><FileText className="size-4 text-brand" />หัวข้อที่ยืนยัน {topics.length} หัวข้อ</summary>
        <ol className="mb-1 mt-2 list-decimal space-y-1 pl-6 text-muted">{topics.map((t, i) => <li key={t.id ?? i}>{t.title}</li>)}</ol>
      </details> : <Chip tone="line"><FileText />ข้ามหัวข้อ · C1–C2 จะวิเคราะห์ไม่ได้</Chip>}
    </div>

    <div className="mb-4 inline-flex rounded-full bg-white p-1 shadow-card" role="group" aria-label="โหมดวิดีโอ">
      {([["record", Camera, "อัดจากกล้องสด"], ["upload", Upload, "อัปโหลดไฟล์วิดีโอ"]] as const).map(([m, I, label]) =>
        <button key={m} ref={(el) => { modeButtons.current[m] = el; }} type="button" aria-pressed={mode === m} disabled={sending} onClick={() => requestMode(m)}
          className={cn("flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-semibold transition-colors disabled:opacity-50", mode === m ? "bg-brand text-white" : "text-muted hover:text-brand")}><I className="size-4" />{label}</button>)}
    </div>

    {mode === "record" ? <StageRecorder target={info.target_duration_s} disabled={sending} onActivityChange={setRecorderActive}
      onRecordingStart={() => { setClip(null); setError(null); }} onRecorded={(blob, name) => setClip({ blob, name })} />
      : <section className="grid gap-5 lg:grid-cols-2">
        <div className="card p-6">
          <h2 className="flex items-center gap-2 text-lg font-bold"><Upload className="size-5 text-brand" />เลือกและตรวจคลิป</h2>
          <label className={cn("mt-4 flex cursor-pointer items-center gap-4 rounded-2xl border-2 border-dashed border-brand-200 bg-brand-50/40 p-5 transition-colors hover:border-brand hover:bg-brand-50 focus-within:border-brand focus-within:ring-2 focus-within:ring-brand-300", sending && "pointer-events-none opacity-60")}>
            <input className="sr-only" type="file" accept={VIDEO_ACCEPT} disabled={sending} aria-label={clip ? "เปลี่ยนไฟล์วิดีโอ" : "เลือกไฟล์วิดีโอ"} aria-describedby="video-file-help"
              onChange={(e) => { selectFile(e.currentTarget.files?.[0]); e.currentTarget.value = ""; }} />
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-white text-brand shadow-card"><FileVideo className="size-5" /></span>
            <span><b className="block">{clip ? "เปลี่ยนไฟล์วิดีโอ" : "เลือกไฟล์วิดีโอ"}</b><span id="video-file-help" className="text-sm text-muted">ไฟล์ .mp4 / .webm / .mov ขนาดไม่เกิน {VIDEO_MAX_MB} MB</span></span>
          </label>
          {clip && <div className="mt-4 flex items-center gap-4 rounded-2xl bg-lime-200/50 p-4">
            <span className="grid size-11 place-items-center rounded-xl bg-white text-brand"><FileVideo className="size-5" /></span>
            <span className="min-w-0 flex-1"><b className="block truncate">{clip.name}</b><span className="text-sm text-muted">{(clip.blob.size / 1e6).toFixed(1)} MB</span></span>
            <button type="button" onClick={() => setClip(null)} disabled={sending} aria-label="เอาไฟล์ออก" className="grid size-10 place-items-center rounded-full text-muted hover:bg-white"><X className="size-4" /></button>
          </div>}
          <ul className="mt-5 space-y-1.5 text-sm text-muted">
            <li>• ตั้งกล้องแนวนอนให้นิ่ง ใช้ความละเอียด 720p เพื่อลดขนาดไฟล์</li>
            <li>• ยืนนำเสนอคนเดียว ให้เห็นศีรษะถึงเอวและมือ</li>
            <li>• พูดให้ได้ยินชัดในที่ที่มีเสียงรบกวนน้อย</li>
            <li>• ระบบเก็บคลิป 7 วันสำหรับ Guest และ 30 วันสำหรับสมาชิก ผลและคำแนะนำยังเปิดดูได้หลังลบคลิป</li>
          </ul>
        </div>
        <div className="card grid min-h-64 place-items-center overflow-hidden bg-navy p-0">
          {clipUrl ? <video key={clipUrl} className="aspect-video w-full bg-black" controls playsInline preload="metadata" src={clipUrl} aria-label="ตัวอย่างคลิปที่เลือก" onError={() => setPreviewError(true)} />
            : <p className="flex items-center gap-2 p-8 text-sm text-white/60"><FileVideo className="size-5" />ตัวอย่างวิดีโอก่อนส่ง</p>}
          {previewError && <p className="w-full bg-white p-3 text-sm text-muted">เบราว์เซอร์เปิดตัวอย่างไฟล์นี้ไม่ได้ คุณยังส่งไฟล์ให้ระบบตรวจสอบได้</p>}
        </div>
      </section>}

    {/* send */}
    <section className="card mt-5 p-5 sm:p-6" data-submit>
      {error && <ErrorPanel className="mb-4" what="ส่งวิดีโอไม่สำเร็จ" why={error} todo="กดส่งวิเคราะห์อีกครั้ง คลิปของคุณยังอยู่ในหน้านี้" />}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="font-bold">{sending ? percent === 100 ? "โอนไฟล์เสร็จแล้ว กำลังรอเซิร์ฟเวอร์" : "กำลังอัปโหลดวิดีโอ" : "ส่งวิดีโอเข้าคิววิเคราะห์"}</p>
          <p className="text-sm text-muted" role="status">{sending
            ? percent === null ? "กำลังส่งไฟล์…" : percent < 100 ? `โอนไฟล์แล้ว ${percent}% อย่าเพิ่งปิดหน้านี้` : "ระบบกำลังรับไฟล์เข้าคิว"
            : !clip ? (mode === "record" ? "อัดคลิปให้เสร็จก่อน แล้วกดส่ง" : "เลือกไฟล์วิดีโอก่อน แล้วกดส่ง") : recorderActive ? "หยุดอัดก่อนจึงส่งได้" : "ระบบเริ่มวิเคราะห์หลังได้รับไฟล์ ใช้เวลาราวความยาวคลิป"}</p>
        </div>
        <Button size="lg" variant="lime" disabled={!clip || recorderActive || sending} onClick={() => { if (clip && !recorderActive) void send(clip); }}>
          {sending ? <Loader2 className="animate-spin" /> : <Send />}ส่งวิเคราะห์</Button>
      </div>
      {sending && <div className="mt-4 h-2 overflow-hidden rounded-full bg-brand-50" role="progressbar" aria-label="ความคืบหน้าการอัปโหลดไฟล์" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined}>
        <div className={cn("h-full rounded-full bg-brand transition-[width]", percent === null && "w-1/3 animate-pulse")} style={percent === null ? undefined : { width: `${percent}%` }} />
      </div>}
    </section>

    <ConfirmDialog open={leaveOpen} title="ออกจากขั้นวิดีโอหรือไม่?" confirmLabel="ออกและทิ้งคลิป"
      onConfirm={() => { leaving.current = true; if (blocker.state === "blocked") blocker.proceed(); }}
      onClose={() => { setLeaveOpen(false); if (!leaving.current && blocker.state === "blocked") blocker.reset(); }}>
      {sending ? "การอัปโหลดวิดีโอจะถูกยกเลิก และต้องส่งใหม่ภายหลัง" : recorderActive ? "การอัดที่กำลังทำอยู่จะหยุด และคลิปนี้จะไม่ถูกเก็บไว้" : "คลิปที่เตรียมไว้ยังไม่ได้ส่งวิเคราะห์ ถ้าออกตอนนี้คลิปจะหายไป"}
    </ConfirmDialog>
    <ConfirmDialog open={pendingMode !== null} title="เปลี่ยนโหมดวิดีโอหรือไม่?" confirmLabel="เปลี่ยนโหมดและล้างคลิป"
      onConfirm={() => { const next = pendingMode; if (next && !isSending()) { switchMode(next); requestAnimationFrame(() => modeButtons.current[next]?.focus()); } }}
      onClose={() => setPendingMode(null)}>
      คลิปที่ยังไม่ได้ส่งหรือการอัดที่กำลังทำอยู่จะถูกล้างเมื่อเปลี่ยนโหมด
    </ConfirmDialog>
  </>);
}

/* ---------- Simulated stage: camera, framing guide, countdown, clock against the target ---------- */

function StageRecorder(props: {
  target: number; disabled: boolean;
  onRecorded: (blob: Blob, filename: string) => void; onRecordingStart: () => void; onActivityChange: (active: boolean) => void;
}) {
  const { preview, stream, checked, recording, opening, finishing, elapsed, blob, err, countdownS, setCountdownS,
    count, mime, blobUrl, checks, openCamera, begin, stopCountdown, stop, toggle, tickAll, ready, live } = useRecorder(props);
  const [guide, setGuide] = useState(true);
  const [replace, setReplace] = useState(false);
  const recordControl = useRef<HTMLButtonElement>(null);
  const stopControl = useRef<HTMLButtonElement>(null);
  const countdownControl = useRef<HTMLSelectElement>(null);
  const reviewControl = useRef<HTMLVideoElement>(null);
  const { onActivityChange, target } = props;
  const active = recording || count !== null;
  const reviewing = !!blobUrl && !stream;
  const clock = fmtDuration(elapsed);
  useEffect(() => { onActivityChange(active); }, [active, onActivityChange]);
  useEffect(() => {
    if (document.activeElement !== document.body) return;
    const next = reviewing ? reviewControl.current : active ? stopControl.current : countdownControl.current;
    next?.focus({ preventScroll: true });
  }, [active, recording, reviewing, stream]);
  const zone = elapsed < target * (1 - BAND) ? "early" : elapsed <= target * (1 + BAND) ? "in" : "over";

  return <fieldset disabled={props.disabled} className="min-w-0">
    <legend className="sr-only">เวทีจำลองสำหรับอัดวิดีโอ</legend>
    <div className="relative overflow-hidden rounded-panel bg-navy-950 p-4 text-white shadow-lift sm:p-6">
      {/* spotlight */}
      <div aria-hidden className="pointer-events-none absolute left-1/2 top-0 h-full w-[90%] max-w-[900px] -translate-x-1/2 opacity-60"
        style={{ background: "conic-gradient(from 180deg at 50% 0%, transparent 155deg, rgb(212 245 60 / 0.14) 172deg, rgb(212 245 60 / 0.2) 180deg, rgb(212 245 60 / 0.14) 188deg, transparent 205deg)" }} />
      <div className="relative grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0">
          <div className="relative aspect-video overflow-hidden rounded-2xl bg-navy ring-1 ring-white/10 shadow-[0_40px_120px_-30px_rgb(212_245_60/0.25)]">
            <video ref={preview} className={cn("absolute inset-0 size-full -scale-x-100 object-cover", !stream && "hidden")} playsInline muted aria-label="ภาพจากกล้อง" />
            {reviewing && <video ref={reviewControl} className="absolute inset-0 size-full bg-black object-contain" controls playsInline src={blobUrl} aria-label="คลิปที่อัดไว้" />}
            {!stream && !reviewing && <div className="absolute inset-0 grid place-items-center p-6 text-center">
              <div>
                <span className="mx-auto grid size-16 place-items-center rounded-2xl bg-white/10"><Camera className="size-7 text-lime" /></span>
                <p className="mt-4 text-lg font-bold sm:text-xl">เปิดกล้องและไมโครโฟน</p>
                <p className="mx-auto mt-1 max-w-sm text-sm text-white/65">เบราว์เซอร์จะถามสิทธิ์ กด "อนุญาต" ภาพแสดงเฉพาะบนเครื่องนี้จนกว่าคุณจะกดส่ง</p>
              </div>
            </div>}
            {stream && !recording && guide && <div aria-hidden className="pointer-events-none absolute inset-[10%_24%_0] rounded-t-[45%] border-2 border-dashed border-white/40" />}
            <AnimatePresence>
              {count !== null && <motion.div key={count} initial={{ scale: 1.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ opacity: 0 }}
                className="absolute inset-0 grid place-items-center bg-navy-950/50 text-[7rem] font-bold leading-none text-lime sm:text-[9rem]">{count}</motion.div>}
            </AnimatePresence>
            {recording && <div className="absolute left-3 top-3 flex items-center gap-2">
              <span className="flex items-center gap-2 rounded-full bg-navy-950/75 px-3 py-1.5 text-xs font-semibold backdrop-blur" role="status"><span className="size-2.5 animate-pulse rounded-full bg-lime" />กำลังอัด</span>
              <time className="rounded-full bg-navy-950/75 px-3 py-1.5 text-xs font-bold tabular-nums backdrop-blur" dateTime={`PT${Math.floor(elapsed)}S`} aria-label={`เวลาที่อัด ${clock}`}>{clock}</time>
            </div>}
            {reviewing && blob && <span className="absolute right-3 top-3 rounded-full bg-navy-950/75 px-3 py-1 text-xs font-semibold">{(blob.size / 1e6).toFixed(1)} MB</span>}
          </div>
          {/* audience */}
          <div aria-hidden className="pointer-events-none -mt-5 flex justify-center gap-3 sm:gap-6">
            {Array.from({ length: 7 }, (_, i) => <span key={i} className="flex flex-col items-center opacity-80" style={{ transform: `translateY(${Math.abs(3 - i) * 4}px)` }}>
              <span className="size-6 rounded-full bg-navy-800 sm:size-8" /><span className="-mt-1 h-5 w-10 rounded-t-full bg-navy-800 sm:h-7 sm:w-14" />
            </span>)}
          </div>

          {!mime && <ErrorPanel dark className="mt-4" what="เบราว์เซอร์นี้อัดวิดีโอไม่ได้" todo="ใช้โหมดอัปโหลดไฟล์แทน หรือเปิดด้วย Chrome, Edge หรือ Safari รุ่นใหม่" />}
          {err && <ErrorPanel dark className="mt-4" what={err} todo={reviewing ? undefined : "กดไอคอนแม่กุญแจข้างช่องที่อยู่เว็บ > อนุญาตกล้องและไมโครโฟน แล้วลองอีกครั้ง หรือใช้โหมดอัปโหลดไฟล์"} />}

          <div className="mt-5 flex flex-wrap items-center gap-3">
            {!stream && <Button variant="lime" size="lg" disabled={!mime || opening} onClick={openCamera}>
              {opening ? <Loader2 className="animate-spin" /> : <Camera />}{opening ? "กำลังเปิดกล้อง…" : reviewing ? "เปิดกล้องเพื่ออัดใหม่" : "เปิดกล้อง"}</Button>}
            {live && <label className="flex items-center gap-2 text-sm text-white/75">นับถอยหลัง
              <select ref={countdownControl} value={countdownS} onChange={(e) => setCountdownS(Number(e.target.value))}
                className="h-11 rounded-xl bg-white/10 px-3 font-semibold text-white ring-1 ring-inset ring-white/20 [color-scheme:dark]">
                {COUNTDOWN_CHOICES.map((s) => <option key={s} value={s}>{s ? `${s} วินาที` : "ไม่นับ"}</option>)}
              </select>
            </label>}
            {live && <Button ref={recordControl} variant="lime" size="lg" disabled={!ready || !mime} onClick={() => (blob ? setReplace(true) : begin())}><Play />เริ่มอัด</Button>}
            {count !== null && <Button ref={stopControl} variant="outlineLight" size="lg" onClick={() => { stopCountdown(); requestAnimationFrame(() => recordControl.current?.focus({ preventScroll: true })); }}>ยกเลิก (เริ่มใน {count})</Button>}
            {recording && <Button ref={stopControl} variant="white" size="lg" onClick={stop} disabled={finishing}><CircleStop className="text-brand" />{finishing ? "กำลังเตรียมคลิป…" : "หยุดอัด"}</Button>}
          </div>
          {live && !ready && <p className="mt-2 text-sm text-white/60">ตรวจรายการจัดเฟรมให้ครบเพื่อเริ่มอัด</p>}
          {stream && !active && <label className="mt-3 flex min-h-11 items-center gap-2 text-sm text-white/70">
            <input type="checkbox" checked={guide} onChange={() => setGuide(!guide)} className="size-4 accent-lime" />แสดงเส้นช่วยจัดระยะ (ให้ศีรษะถึงเอวอยู่ในเส้นประ)</label>}
          {live && <p className="text-xs text-white/50">หลังเริ่มอัด ให้เดินเข้าจุดยืนก่อนพูด ระบบนับเวลานำเสนอตั้งแต่คำแรก</p>}
        </div>

        <aside className="min-w-0 space-y-4">
          <div className="rounded-2xl bg-white/[0.06] p-5 ring-1 ring-inset ring-white/10 backdrop-blur">
            <TargetRing t={elapsed} target={target} />
            <p className={cn("mt-3 text-center text-sm font-semibold", zone === "in" ? "text-lime" : "text-white/80")}>
              {!recording && !reviewing ? "กดเริ่มอัดเมื่อพร้อม"
                : zone === "early" ? `อีก ${fmtDuration(target * (1 - BAND) - elapsed)} จะถึงช่วงพอดี`
                : zone === "in" ? "อยู่ในช่วงพอดี ปิดท้ายได้เลย" : `เกินเป้า ${Math.round(((elapsed - target) / target) * 100)}% แล้ว`}
            </p>
            <p className="mt-1 text-center text-[11px] text-white/45">นาฬิกานับเวลาอัด ส่วนระบบวัดช่วงที่พูดจริง ผลอาจต่างกันเล็กน้อย</p>
          </div>
          {!active && !reviewing && <div className="rounded-2xl bg-white p-5 text-ink" data-checklist>
            <h2 className="flex items-center gap-2 font-bold"><CheckCircle2 className="size-5 text-brand" />ตรวจการจัดเฟรมก่อนอัด</h2>
            <ul className="mt-3 space-y-2">
              {CHECKLIST.map((c, i) => { const status = c.auto && stream && !recording ? checks[c.auto] : null;
                return <li key={i}>
                  <label className="flex min-h-11 cursor-pointer items-start gap-2.5 rounded-xl px-2 py-1.5 text-sm hover:bg-surface">
                    <input type="checkbox" checked={checked[i]} onChange={() => toggle(i)} className="mt-0.5 size-4 shrink-0 accent-brand" />{c.text}
                  </label>
                  {c.auto && <p className="ml-9 flex items-center gap-1.5 text-xs text-muted">
                    <span className={cn("size-2 rounded-full", status?.state === "ok" ? "bg-brand" : status?.state === "warn" ? "bg-navy ring-2 ring-lime" : "bg-line")} />
                    {status ? status.text : "ตรวจอัตโนมัติเมื่อเปิดกล้อง"}</p>}
                </li>; })}
            </ul>
            <Button type="button" variant="soft" size="sm" className="mt-3 w-full" disabled={ready} onClick={tickAll}>ติ๊กครบทุกข้อ (ยืนยันพร้อมอัด)</Button>
            {!ready && <p className="mt-2 text-xs text-muted">ติ๊กครบทุกข้อจึงเริ่มอัดได้ ข้อที่มีจุดสี ระบบตรวจและติ๊กให้เองเมื่อผ่าน</p>}
          </div>}
        </aside>
      </div>
    </div>
    <ConfirmDialog open={replace} onClose={() => setReplace(false)} onConfirm={begin} title="อัดใหม่แทนคลิปเดิมหรือไม่?" confirmLabel="อัดใหม่แทนคลิปเดิม">
      คลิปที่อัดไว้ก่อนหน้ายังไม่ได้ส่งวิเคราะห์ เมื่อเริ่มอัดใหม่ คลิปเดิมจะถูกแทนที่
    </ConfirmDialog>
  </fieldset>;
}

function TargetRing({ t, target }: { t: number; target: number }) {
  const full = target * 1.2, R = 88, C = 2 * Math.PI * R;
  const at = (x: number) => Math.min(1, x / full);
  const bandFrom = at(target * (1 - BAND)), bandTo = at(target * (1 + BAND));
  return <div className="relative mx-auto aspect-square w-full max-w-[220px]">
    <svg viewBox="0 0 200 200" className="size-full -rotate-90" aria-hidden>
      <circle cx="100" cy="100" r={R} fill="none" stroke="white" strokeOpacity="0.1" strokeWidth="12" />
      <circle cx="100" cy="100" r={R} fill="none" stroke="var(--color-lime)" strokeOpacity="0.35" strokeWidth="12" strokeDasharray={`${(bandTo - bandFrom) * C} ${C}`} strokeDashoffset={-bandFrom * C} />
      <motion.circle cx="100" cy="100" r={R} fill="none" stroke="var(--color-lime)" strokeWidth="12" strokeLinecap="round" strokeDasharray={C} animate={{ strokeDashoffset: C * (1 - at(t)) }} transition={{ duration: 0.6 }} />
    </svg>
    <div className="absolute inset-0 grid place-items-center text-center">
      <div><p className="text-4xl font-bold tabular-nums">{fmtDuration(t)}</p><p className="mt-1 text-xs text-white/60">เป้า {fmtDuration(target)} · ช่วงพอดี ±5%</p></div>
    </div>
  </div>;
}
