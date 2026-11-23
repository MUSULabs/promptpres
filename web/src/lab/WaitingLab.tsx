/* /lab/waiting: what the system is doing right now. Upload % -> queue -> each skill in turn -> result ready.
   A demo switch shows the two failure paths (network drops during upload, analysis fails) with a clear way forward. */
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Bell, BookOpenText, CheckCircle2, Clock3, Loader2, Mic, PersonStanding, RotateCcw, Sparkles, UploadCloud, Users, WifiOff } from "lucide-react";
import { Button, Chip, cn } from "@/v2/ui";
import { Shell } from "@/v2/Shell";
import { ErrorPanel, PRACTICE_STEPS, StatusStepper } from "@/v2/states";
import { fmtDuration } from "@/presentation";
import { PPre } from "@/v2/PPre";
import { HISTORY } from "./fixtures";
import { thDate, useLabShell } from "./demo";

type Mode = "ok" | "offline" | "failed";
const JOBS = [
  { Icon: Mic, title: "ถอดเสียงและวัดการพูด", body: "ความเร็วพูด ช่วงหยุดยาว เสียงเติม" },
  { Icon: BookOpenText, title: "เทียบเนื้อหากับแผน", body: "ลำดับหัวข้อ และพูดครบแค่ไหน" },
  { Icon: PersonStanding, title: "ดูมือและทิศทางศีรษะ", body: "ทุกวินาทีของคลิป" },
  { Icon: Clock3, title: "วัดเวลาเทียบเป้า", body: "นับเฉพาะช่วงที่พูดจริง" },
  { Icon: Sparkles, title: "โค้ช AI เขียนคำแนะนำ", body: "อ้างเวลาจากหลักฐานเท่านั้น" },
];
const UPLOAD_MS = 4000, QUEUE_MS = 1800, JOB_MS = 1900;

export default function WaitingLab() {
  const shell = useLabShell();
  const [params] = useSearchParams();
  const row = HISTORY.find((r) => r.status === "processing")!; // the round being analysed in the demo history
  const target = (Number(params.get("min")) || (row.target_duration_s ?? 600) / 60) * 60;
  const clip = Number(params.get("clip")) || row.duration_s || 0;
  const [mode, setMode] = useState<Mode>("ok");
  const [run, setRun] = useState(0);
  const [ms, setMs] = useState(0);
  const [paused, setPaused] = useState(false);

  const total = UPLOAD_MS + QUEUE_MS + JOBS.length * JOB_MS;
  const offlineAt = UPLOAD_MS * 0.62, failAt = UPLOAD_MS + QUEUE_MS + 2.5 * JOB_MS;

  useEffect(() => { setMs(0); setPaused(false); }, [mode, run]);
  useEffect(() => {
    if (paused || ms >= total) return;
    const id = window.setTimeout(() => {
      const next = ms + 100;
      if (mode === "offline" && ms < offlineAt && next >= offlineAt) { setMs(offlineAt); setPaused(true); return; }
      if (mode === "failed" && ms < failAt && next >= failAt) { setMs(failAt); setPaused(true); return; }
      setMs(next);
    }, 100);
    return () => window.clearTimeout(id);
  }, [ms, paused, mode, total, offlineAt, failAt]);

  const uploading = ms < UPLOAD_MS, queued = !uploading && ms < UPLOAD_MS + QUEUE_MS, finished = ms >= total;
  const job = Math.min(JOBS.length, Math.floor(Math.max(0, ms - UPLOAD_MS - QUEUE_MS) / JOB_MS));
  const step = uploading ? 1 : queued ? 2 : finished ? 4 : 3; // PRACTICE_STEPS: เตรียม, ซ้อมและส่งคลิป, รอคิว, วิเคราะห์, ผลออก
  const pct = Math.min(100, Math.round((ms / UPLOAD_MS) * 100));
  const etaMin = Math.max(1, Math.ceil(((total - ms) / total) * 12));
  const netDown = mode === "offline" && paused, failed = mode === "failed" && paused;

  // warn before leaving only while the video is still uploading
  useEffect(() => {
    if (!uploading || netDown) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [uploading, netDown]);

  return <Shell page="new" title={finished ? "ผลออกแล้ว" : "กำลังวิเคราะห์รอบซ้อม"} subtitle={`รอบซ้อม ${thDate(row.created_at, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} น. · คลิป ${fmtDuration(clip)} · เป้า ${fmtDuration(target)}`} {...shell}
    actions={<div className="hidden items-center gap-1 rounded-full bg-white p-1 shadow-card md:flex" role="group" aria-label="ตัวอย่างสถานะ">
      {([["ok", "ปกติ"], ["offline", "เน็ตหลุด"], ["failed", "วิเคราะห์ล้มเหลว"]] as const).map(([k, l]) => <button key={k} type="button" onClick={() => { setMode(k); setRun((r) => r + 1); }}
        className={cn("rounded-full px-3 py-1.5 text-xs font-semibold", mode === k ? "bg-navy text-white" : "text-muted hover:text-ink")}>{l}</button>)}
    </div>}>
    <div className="mb-4 flex gap-1 overflow-x-auto md:hidden">
      {([["ok", "ปกติ"], ["offline", "เน็ตหลุด"], ["failed", "ล้มเหลว"]] as const).map(([k, l]) => <button key={k} type="button" onClick={() => { setMode(k); setRun((r) => r + 1); }}
        className={cn("whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold", mode === k ? "bg-navy text-white" : "bg-white text-muted")}>ตัวอย่าง: {l}</button>)}
    </div>

    <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
      <section className="relative overflow-hidden rounded-panel bg-navy-gradient p-6 text-white shadow-lift sm:p-8 lg:col-span-8">
        <StatusStepper dark steps={PRACTICE_STEPS} current={step} busy={!paused && !finished}
          failedAt={netDown ? 1 : failed ? 3 : undefined} className="mx-auto max-w-xl" />

        <div className="mt-8 flex flex-col items-center text-center">
          <PPre pose={finished ? "celebrate" : paused ? "think" : uploading ? "idle" : "think"} size={120} color="white" />
          <AnimatePresence mode="wait">
            <motion.div key={`${step}-${paused}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-4">
              <p className="text-2xl font-bold">{netDown ? "การอัปโหลดหยุดชั่วคราว" : failed ? "วิเคราะห์ไม่สำเร็จ" : finished ? "ผลการซ้อมพร้อมแล้ว!" : uploading ? `กำลังส่งวิดีโอ ${pct}%` : queued ? "รอคิวเครื่องวิเคราะห์" : JOBS[job]?.title}</p>
              <p className="mt-1 text-sm text-white/65">{netDown ? "คลิปยังอยู่ในเครื่องคุณ ไม่ต้องอัดใหม่" : failed ? "คลิปของคุณยังอยู่ในระบบ" : finished ? "ดูระดับ 8 เกณฑ์และหลักฐานในวิดีโอได้เลย" : uploading ? "อย่าเพิ่งปิดหน้านี้จนกว่าจะส่งครบ" : `เหลือประมาณ ${etaMin} นาที · ปิดหน้านี้ได้ ผลออกแล้วจะแจ้งที่กระดิ่ง`}</p>
            </motion.div>
          </AnimatePresence>
          {uploading && <div className="mt-5 h-2 w-full max-w-sm overflow-hidden rounded-full bg-white/10"><motion.div className="h-full rounded-full bg-lime" animate={{ width: `${pct}%` }} transition={{ duration: 0.1 }} /></div>}
          {finished && <Button asChild size="lg" variant="lime" className="mt-6"><Link to="/lab/result">ดูผลการซ้อม <ArrowRight /></Link></Button>}
        </div>

        {netDown && <ErrorPanel dark className="mx-auto mt-6 max-w-xl" what="อินเทอร์เน็ตหลุดระหว่างส่งวิดีโอ" why="เครื่องของคุณขาดการเชื่อมต่อที่ 62%"
          todo="ระบบลองส่งซ้ำให้เองแล้วแต่ยังไม่สำเร็จ ตรวจ Wi-Fi หรือเน็ตมือถือ แล้วกดลองส่งอีกครั้ง" actions={<><Button size="sm" variant="lime" onClick={() => setPaused(false)}><UploadCloud />ลองส่งอีกครั้ง</Button><Chip tone="glass"><WifiOff />ออฟไลน์</Chip></>} />}
        {failed && <ErrorPanel dark className="mx-auto mt-6 max-w-xl" what="ระบบวิเคราะห์ขัดข้องระหว่างดูมือและทิศทางศีรษะ" why="เครื่องวิเคราะห์หยุดทำงานกลางคัน ไม่ใช่ความผิดของคลิปคุณ"
          todo="กดส่งวิเคราะห์อีกครั้ง ถ้ายังไม่ได้ แจ้งทีมพร้อมเวลาที่ซ้อม" actions={<><Button size="sm" variant="lime" onClick={() => setPaused(false)}><RotateCcw />ส่งวิเคราะห์อีกครั้ง</Button><Button size="sm" variant="outlineLight" asChild><Link to="/lab/help#contact">แจ้งปัญหา</Link></Button></>} />}
      </section>

      <div className="space-y-5 lg:col-span-4">
        <section className="card p-6">
          <p className="font-bold">ระบบกำลังทำอะไร</p>
          <ol className="mt-4 space-y-1">
            {JOBS.map((j, i) => { const done = step > 3 || (step === 3 && i < job), now = step === 3 && i === job, broke = failed && now;
              return <li key={j.title} className={cn("flex items-start gap-3 rounded-xl p-2.5 transition-colors", now && !broke && "bg-brand-50", broke && "bg-surface ring-1 ring-inset ring-dashed ring-faint")}>
                <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl", done ? "bg-brand text-white" : now ? "bg-lime text-navy" : "bg-surface text-faint")}>
                  {done ? <CheckCircle2 className="size-4" /> : now && !paused ? <Loader2 className="size-4 animate-spin" /> : <j.Icon className="size-4" />}
                </span>
                <span className="min-w-0"><b className={cn("block text-sm", !done && !now && "text-muted")}>{j.title}</b><span className="text-xs text-muted">{broke ? "หยุดที่ขั้นนี้" : j.body}</span></span>
              </li>; })}
          </ol>
        </section>
        <section className="card flex gap-3 p-5">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-navy text-lime"><Bell className="size-5" /></span>
          <p className="text-sm text-muted"><b className="block text-ink">ไม่ต้องเฝ้าหน้าจอ</b>หลังส่งวิดีโอครบ ปิดเว็บได้เลย ผลออกแล้วกระดิ่งมุมบนจะแจ้ง ไฟเวทีสัปดาห์นี้ติดตั้งแต่ส่งวิดีโอครบแล้ว</p>
        </section>
        <section className="card flex gap-3 p-5">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand"><Users className="size-5" /></span>
          <p className="text-sm text-muted"><b className="block text-ink">คิวตอนนี้</b>มี 2 รอบก่อนหน้าคุณ (ตัวอย่าง) เวลาวิเคราะห์ราว ๆ เท่ากับความยาวคลิป</p>
        </section>
      </div>
    </div>
  </Shell>;
}
