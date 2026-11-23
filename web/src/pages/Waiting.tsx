/* What the result page shows before the result is ready: waiting in the queue or being analysed (the page asks
   again every 4 s, useSessionResult), or the analysis failed. Only what the system really knows is shown:
   the status, how long ago the round was sent, the clip length. No queue position, no fake per-step progress. */
import { Link } from "react-router-dom";
import { motion } from "motion/react";
import { ArrowRight, Bell, BookOpenText, Clock3, Mic, PersonStanding, Sparkles, WifiOff } from "lucide-react";
import type { Result } from "@/contract";
import { fmtDuration } from "@/presentation";
import { Button, Chip, cn } from "@/v2/ui";
import { Shell } from "@/v2/Shell";
import { EmptyState, ErrorPanel, PRACTICE_STEPS, StatusStepper } from "@/v2/states";
import { PPre } from "@/v2/PPre";
import { PATH } from "@/v2/paths";
import { thDate, thTime } from "@/v2/time";

const JOBS = [
  { Icon: Mic, title: "ถอดเสียงและวัดการพูด", body: "ความเร็วพูด ช่วงหยุดยาว เสียงเติม" },
  { Icon: BookOpenText, title: "เทียบเนื้อหากับแผน", body: "ลำดับหัวข้อ และพูดครบแค่ไหน" },
  { Icon: PersonStanding, title: "ดูมือและทิศทางศีรษะ", body: "ทุกวินาทีของคลิป" },
  { Icon: Clock3, title: "วัดเวลาเทียบเป้า", body: "นับเฉพาะช่วงที่พูดจริง" },
  { Icon: Sparkles, title: "โค้ช AI เขียนคำแนะนำ", body: "อ้างเวลาจากหลักฐานเท่านั้น" },
];

export function WaitingView({ res, now, reconnecting }: { res: Result; now: number; reconnecting: boolean }) {
  const queued = res.status === "queued";
  const since = Math.max(0, Math.round((now - new Date(res.created_at).getTime()) / 1000));
  const clip = res.duration_s ?? null;
  return <Shell page="result" title={queued ? "รอคิววิเคราะห์" : "กำลังวิเคราะห์"} subtitle={`รอบวันที่ ${thDate(res.created_at, { day: "numeric", month: "long" })} ${thTime(res.created_at)} น.`}>
    <div className="card mb-5 p-5"><StatusStepper steps={PRACTICE_STEPS} current={queued ? 2 : 3} busy className="mx-auto max-w-2xl" /></div>
    {reconnecting && <ErrorPanel tone="info" className="mb-5" what="กำลังเชื่อมต่อใหม่…" why="ติดต่อเซิร์ฟเวอร์ไม่ได้ชั่วคราว" todo="หน้านี้จะลองใหม่เอง ไม่ต้องทำอะไร รอบซ้อมของคุณยังอยู่ในระบบ" />}
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-12" role="status" aria-live="polite" data-waiting={res.status}>
      <section className="relative overflow-hidden rounded-panel bg-navy p-6 text-white shadow-lift sm:p-8 lg:col-span-7">
        <div aria-hidden className="absolute -right-24 -top-24 size-80 rounded-full bg-brand/50 blur-3xl" />
        <div className="relative flex flex-col items-center text-center sm:flex-row sm:items-center sm:gap-8 sm:text-left">
          <PPre pose="think" size={140} color="white" className="shrink-0" />
          <div className="mt-4 sm:mt-0">
            <Chip tone="lime">{queued ? "รอคิว" : "กำลังวิเคราะห์"}</Chip>
            <h2 className="mt-3 text-2xl font-bold leading-snug sm:text-3xl">{queued ? "รอบของคุณอยู่ในคิวแล้ว" : "ระบบกำลังดูคลิปของคุณ"}</h2>
            <p className="mt-2 text-white/70">{queued ? "เครื่องวิเคราะห์จะเริ่มเมื่อถึงคิว ช่วงที่มีคนใช้น้อยมักเริ่มภายในไม่กี่นาที" : `ใช้เวลาราวความยาวคลิป${clip ? ` (คลิปนี้ ${fmtDuration(clip)})` : ""}`}</p>
            <div className="mt-5 flex flex-wrap justify-center gap-2 sm:justify-start">
              <Chip tone="glass"><Clock3 />สร้างรอบนี้มาแล้ว {fmtDuration(since)}</Chip>
              {clip != null && <Chip tone="glass">คลิป {fmtDuration(clip)}</Chip>}
            </div>
          </div>
        </div>
        <p className="relative mt-6 flex items-start gap-2 rounded-2xl bg-white/[0.07] p-4 text-sm text-white/80"><Bell className="mt-0.5 size-4 shrink-0 text-lime" />ปิดหน้านี้ได้ ผลออกแล้วจะขึ้นในกระดิ่งแจ้งเตือนและหน้าหลัก หน้านี้อัปเดตเองทุก 4 วินาที</p>
      </section>
      <section className="card p-6 lg:col-span-5">
        <p className="font-bold">ระหว่างนี้ระบบจะ</p>
        <ul className="mt-4 space-y-2.5">
          {JOBS.map(({ Icon, title, body }, i) => <motion.li key={title} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.06 }}
            className="flex items-center gap-3 rounded-xl bg-surface p-3">
            <span className={cn("grid size-9 shrink-0 place-items-center rounded-lg", queued ? "bg-white text-faint" : "bg-brand-50 text-brand")}><Icon className="size-4" /></span>
            <span><b className="block text-sm">{title}</b><span className="text-xs text-muted">{body}</span></span>
          </motion.li>)}
        </ul>
        <p className="mt-4 text-xs text-faint">ระดับมาจากเกณฑ์ที่กำหนดไว้ โค้ช AI ไม่ได้เป็นผู้ตัดสินระดับ</p>
      </section>
    </div>
  </Shell>;
}

export function FailedView({ res }: { res: Result }) {
  return <Shell page="result" title="วิเคราะห์ไม่สำเร็จ" subtitle={`รอบวันที่ ${thDate(res.created_at, { day: "numeric", month: "long" })} ${thTime(res.created_at)} น.`}>
    <div className="card mb-5 p-5"><StatusStepper steps={PRACTICE_STEPS} current={3} failedAt={3} className="mx-auto max-w-2xl" /></div>
    <div className="mx-auto max-w-2xl space-y-5" data-failed>
      <ErrorPanel what="ระบบวิเคราะห์รอบนี้ไม่สำเร็จ" why={res.error ?? "เกิดข้อผิดพลาดระหว่างวิเคราะห์"}
        todo="ตรวจว่าคลิปเปิดดูได้ มีเสียง และยาวไม่เกิน 30 นาที แล้วซ้อมรอบใหม่ รอบที่ไม่สำเร็จไม่ทำให้ไฟเวทีหรี่"
        actions={<>
          <Button size="sm" asChild><Link to={PATH.new}>ซ้อมรอบใหม่ <ArrowRight /></Link></Button>
          <Button size="sm" variant="soft" asChild><Link to={PATH.contact}>แจ้งปัญหา</Link></Button>
        </>} />
      <p className="flex items-center justify-center gap-2 text-center text-sm text-muted"><WifiOff className="size-4" />ถ้าเป็นซ้ำหลายรอบ แจ้งทีมพร้อมวันเวลาของรอบนี้</p>
    </div>
  </Shell>;
}

export function NotSentView({ id }: { id: string }) {
  return <Shell page="result" title="ยังไม่ได้ส่งวิดีโอ">
    <EmptyState pose="point" title="รอบนี้ยังไม่ได้ส่งวิดีโอ" action={<Button asChild><Link to={PATH.video(id)}>ไปขั้นวิดีโอ <ArrowRight /></Link></Button>}>
      อัดจากกล้องหรือเลือกไฟล์ แล้วกดส่งวิเคราะห์ ผลจะขึ้นที่หน้านี้
    </EmptyState>
  </Shell>;
}
