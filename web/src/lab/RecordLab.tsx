/* /lab/record: simulated stage for recording. Spotlight on the camera, big clock, target ring (lime = within 5% of the
   target, the level-4 band of the T1 draft rubric v0.9), audience silhouettes. Camera preview only: nothing is uploaded. */
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, Camera, CircleStop, FastForward, Play, RotateCcw, Send } from "lucide-react";
import { fmtDuration } from "@/presentation";
import { Button, Chip, cn, Logo } from "@/v2/ui";
import { ConfirmDialog, ErrorPanel, PRACTICE_STEPS, StatusStepper } from "@/v2/states";
import { PPre } from "@/v2/PPre";

type Phase = "ask" | "denied" | "ready" | "count" | "rec" | "done";
const BAND = 0.05; // config/thresholds-v0.yaml T1 level 4: deviation_pct 5 (DRAFT_VALUE)

export default function RecordLab() {
  const [params] = useSearchParams();
  const target = Math.min(30, Math.max(1, Number(params.get("min")) || 15)) * 60;
  const nav = useNavigate();
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [phase, setPhase] = useState<Phase>("ask");
  const [why, setWhy] = useState<"denied" | "nodevice" | "unsupported">("denied");
  const [demoCam, setDemoCam] = useState(false);
  const [count, setCount] = useState(3);
  const [t, setT] = useState(0);
  const [fast, setFast] = useState(false);
  const [confirm, setConfirm] = useState(false);

  const stopTracks = () => { stream.current?.getTracks().forEach((tr) => tr.stop()); stream.current = null; };
  useEffect(() => stopTracks, []);

  // leave-page warning while recording (same rule as V1 upload)
  useEffect(() => {
    if (phase !== "rec") return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [phase]);

  const openCamera = async () => {
    if (!navigator.mediaDevices?.getUserMedia) { setWhy("unsupported"); setPhase("denied"); return; }
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: true });
      stream.current = s;
      setDemoCam(false); setPhase("ready");
      requestAnimationFrame(() => { if (video.current) { video.current.srcObject = s; void video.current.play().catch(() => {}); } });
    } catch (e) {
      setWhy((e as DOMException)?.name === "NotFoundError" ? "nodevice" : "denied");
      setPhase("denied");
    }
  };

  useEffect(() => {
    if (phase !== "count") return;
    if (count === 0) { setPhase("rec"); return; }
    const id = window.setTimeout(() => setCount((c) => c - 1), 800);
    return () => window.clearTimeout(id);
  }, [phase, count]);

  useEffect(() => {
    if (phase !== "rec") return;
    const id = window.setInterval(() => setT((x) => x + (fast ? 30 : 1)), 1000);
    return () => window.clearInterval(id);
  }, [phase, fast]);

  const start = () => { setT(0); setCount(3); setPhase("count"); };
  const dev = (t - target) / target;
  const zone = t < target * (1 - BAND) ? "early" : t <= target * (1 + BAND) ? "in" : "over";
  const step = 1; // PRACTICE_STEPS: ซ้อมและส่งคลิป (sending moves on to the waiting page)

  return <div className="relative min-h-dvh overflow-hidden bg-navy-950 text-white">
    {/* spotlight cone */}
    <div aria-hidden className="pointer-events-none absolute left-1/2 top-0 h-[85vh] w-[90vw] max-w-[900px] -translate-x-1/2 opacity-60"
      style={{ background: "conic-gradient(from 180deg at 50% 0%, transparent 155deg, rgb(212 245 60 / 0.16) 172deg, rgb(212 245 60 / 0.22) 180deg, rgb(212 245 60 / 0.16) 188deg, transparent 205deg)" }} />
    <header className="relative z-10 flex items-center justify-between gap-3 px-4 py-4 sm:px-8">
      <Link to="/lab/new" aria-label="กลับไปตั้งค่า" className="flex items-center gap-2 text-sm text-white/70 hover:text-white"><ArrowLeft className="size-4" /><span className="hidden sm:inline">กลับไปตั้งค่า</span></Link>
      <Logo dark className="h-6" />
      <Chip tone="glass">เป้า {fmtDuration(target)}</Chip>
    </header>
    <StatusStepper dark steps={PRACTICE_STEPS} current={step} busy={phase === "rec"} className="relative z-10 mx-auto max-w-xl px-4" />

    <main className="relative z-10 mx-auto grid max-w-6xl grid-cols-1 items-center gap-8 px-4 pb-40 pt-6 sm:px-8 lg:grid-cols-[1fr_320px]">
      {/* the stage */}
      <div className="relative">
        <div className="relative aspect-video overflow-hidden rounded-panel bg-navy ring-1 ring-white/10 shadow-[0_40px_120px_-30px_rgb(212_245_60/0.25)]">
          <video ref={video} muted playsInline className={cn("absolute inset-0 size-full -scale-x-100 object-cover", (phase === "ask" || phase === "denied" || demoCam) && "hidden")} />
          {demoCam && <div className="absolute inset-0 grid place-items-center bg-[radial-gradient(60%_70%_at_50%_40%,color-mix(in_srgb,var(--color-brand)_35%,transparent),transparent)]"><PPre pose={phase === "rec" ? "point" : "idle"} size={150} color="white" /></div>}
          {phase === "ask" && <div className="absolute inset-0 grid place-items-center p-6 text-center">
            <div>
              <span className="mx-auto grid size-16 place-items-center rounded-2xl bg-white/10"><Camera className="size-7 text-lime" /></span>
              <p className="mt-4 text-xl font-bold">เปิดกล้องและไมโครโฟน</p>
              <p className="mx-auto mt-1 max-w-sm text-sm text-white/65">เบราว์เซอร์จะถามสิทธิ์ กด "อนุญาต" ภาพจะแสดงเฉพาะบนเครื่องนี้จนกว่าคุณจะกดส่ง</p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                <Button variant="lime" onClick={openCamera}><Camera />เปิดกล้อง</Button>
                <Button variant="outlineLight" onClick={() => { setDemoCam(true); setPhase("ready"); }}>ดูตัวอย่างโดยไม่ใช้กล้อง</Button>
              </div>
            </div>
          </div>}
          {phase === "denied" && <div className="absolute inset-0 grid place-items-center overflow-y-auto p-4 sm:p-8">
            <ErrorPanel dark className="max-w-lg"
              what={why === "unsupported" ? "เบราว์เซอร์นี้อัดวิดีโอไม่ได้" : why === "nodevice" ? "ไม่พบกล้องหรือไมโครโฟน" : "ยังไม่ได้รับสิทธิ์ใช้กล้อง"}
              why={why === "unsupported" ? "เบราว์เซอร์รุ่นนี้ไม่มีระบบอัดวิดีโอ" : why === "nodevice" ? "เครื่องนี้ไม่มีกล้อง หรือโปรแกรมอื่นใช้อยู่" : "กด \"ไม่อนุญาต\" ไว้ หรือเบราว์เซอร์บล็อกกล้องของเว็บนี้"}
              todo={why === "denied" ? "กดไอคอนแม่กุญแจข้างช่องที่อยู่เว็บ > อนุญาตกล้องและไมโครโฟน แล้วกดลองอีกครั้ง หรืออัดด้วยแอปกล้องแล้วอัปโหลดไฟล์แทน" : "ใช้ Chrome, Edge หรือ Safari รุ่นใหม่ หรืออัดด้วยแอปกล้องแล้วอัปโหลดไฟล์แทน"}
              actions={<><Button size="sm" variant="lime" onClick={openCamera}><RotateCcw />ลองอีกครั้ง</Button><Button size="sm" variant="outlineLight" asChild><Link to="/lab/new">อัปโหลดไฟล์แทน</Link></Button></>} />
          </div>}
          <AnimatePresence>
            {phase === "count" && <motion.div key={count} initial={{ scale: 1.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 grid place-items-center bg-navy-950/50 text-[9rem] font-bold leading-none text-lime">{count || "เริ่ม"}</motion.div>}
          </AnimatePresence>
          {phase === "rec" && <span className="absolute left-4 top-4 flex items-center gap-2 rounded-full bg-navy-950/70 px-3 py-1.5 text-xs font-semibold backdrop-blur"><span className="size-2.5 animate-pulse rounded-full bg-lime" />กำลังอัด</span>}
          {/* framing guide */}
          {(phase === "ready" || phase === "count") && <div aria-hidden className="pointer-events-none absolute inset-[12%_22%_0] rounded-t-[45%] border-2 border-dashed border-white/25" />}
          {phase === "ready" && <p className="absolute inset-x-0 bottom-3 text-center text-xs text-white/70">ยืนให้อยู่ในกรอบ เห็นหน้าและมือทั้งสองข้าง</p>}
        </div>
        {/* audience */}
        <div aria-hidden className="pointer-events-none -mt-6 flex justify-center gap-3 sm:gap-6">
          {Array.from({ length: 7 }, (_, i) => <span key={i} className="flex flex-col items-center opacity-80" style={{ transform: `translateY(${Math.abs(3 - i) * 4}px)` }}>
            <span className="size-7 rounded-full bg-navy-800 sm:size-9" /><span className="-mt-1 h-6 w-12 rounded-t-full bg-navy-800 sm:h-8 sm:w-16" />
          </span>)}
        </div>
      </div>

      {/* clock + ring */}
      <aside className="rounded-panel bg-white/[0.06] p-6 ring-1 ring-inset ring-white/10 backdrop-blur">
        <TargetRing t={t} target={target} />
        <p className={cn("mt-4 text-center text-sm font-semibold", zone === "in" ? "text-lime" : "text-white/80")}>
          {phase !== "rec" && phase !== "done" ? "กดเริ่มเมื่อพร้อม นับถอยหลัง 3 วินาที"
            : zone === "early" ? `อีก ${fmtDuration(target * (1 - BAND) - t)} จะถึงช่วงพอดี`
            : zone === "in" ? "อยู่ในช่วงพอดี ปิดท้ายได้เลย" : `เกินเป้า ${Math.round(dev * 100)}% แล้ว`}
        </p>
        <p className="mt-2 text-center text-[11px] text-white/45">นาฬิกานับเวลาอัด ส่วนระบบวัดช่วงที่พูดจริง ผลอาจต่างกันเล็กน้อย</p>
        {phase === "rec" && <button type="button" onClick={() => setFast(!fast)} className={cn("mx-auto mt-3 flex items-center gap-1.5 rounded-full px-3 py-1 text-xs", fast ? "bg-lime text-navy" : "bg-white/10 text-white/70")}><FastForward className="size-3.5" />ตัวอย่าง: เร่งเวลา ×30</button>}
      </aside>
    </main>

    {/* controls */}
    <div className="fixed inset-x-0 bottom-0 z-20 flex flex-wrap justify-center gap-3 bg-gradient-to-t from-navy-950 via-navy-950/90 to-transparent px-4 pb-6 pt-10">
      {phase === "ready" && <Button size="xl" variant="lime" onClick={start}><Play />เริ่มอัด</Button>}
      {phase === "rec" && <Button size="xl" variant="white" onClick={() => { setPhase("done"); setFast(false); }}><CircleStop className="text-brand" />หยุดอัด</Button>}
      {phase === "done" && <>
        <Button size="lg" variant="outlineLight" onClick={() => setConfirm(true)}><RotateCcw />อัดใหม่</Button>
        <Button size="lg" variant="lime" onClick={() => { stopTracks(); nav(`/lab/waiting?min=${target / 60}&clip=${t}`); }}><Send />ส่งวิเคราะห์ ({fmtDuration(t)})</Button>
      </>}
      {(phase === "ask" || phase === "denied") && <p className="text-sm text-white/55">ต้องเปิดกล้องก่อนจึงจะเริ่มอัดได้</p>}
    </div>
    <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} onConfirm={() => { setT(0); setPhase("ready"); }}
      title="ทิ้งคลิปนี้แล้วอัดใหม่?" confirmLabel="ทิ้งและอัดใหม่">คลิปยาว {fmtDuration(t)} ที่เพิ่งอัดจะหายไป และกู้คืนไม่ได้</ConfirmDialog>
  </div>;
}

function TargetRing({ t, target }: { t: number; target: number }) {
  const full = target * 1.2, R = 88, C = 2 * Math.PI * R;
  const at = (x: number) => Math.min(1, x / full);
  const bandFrom = at(target * (1 - BAND)), bandTo = at(target * (1 + BAND));
  return <div className="relative mx-auto aspect-square w-full max-w-[240px]">
    <svg viewBox="0 0 200 200" className="size-full -rotate-90">
      <circle cx="100" cy="100" r={R} fill="none" stroke="white" strokeOpacity="0.1" strokeWidth="12" />
      <circle cx="100" cy="100" r={R} fill="none" stroke="var(--color-lime)" strokeOpacity="0.35" strokeWidth="12"
        strokeDasharray={`${(bandTo - bandFrom) * C} ${C}`} strokeDashoffset={-bandFrom * C} />
      <motion.circle cx="100" cy="100" r={R} fill="none" stroke="var(--color-lime)" strokeWidth="12" strokeLinecap="round"
        strokeDasharray={C} animate={{ strokeDashoffset: C * (1 - at(t)) }} transition={{ duration: 0.6 }} />
    </svg>
    <div className="absolute inset-0 grid place-items-center text-center">
      <div>
        <p className="text-5xl font-bold tabular-nums">{fmtDuration(t)}</p>
        <p className="mt-1 text-xs text-white/60">เป้า {fmtDuration(target)} · ช่วงพอดี ±5%</p>
      </div>
    </div>
  </div>;
}
