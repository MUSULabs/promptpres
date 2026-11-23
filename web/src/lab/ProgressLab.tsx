/* /lab/progress: monthly recap, compare two rounds, badges (behaviour only) and the share card. */
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { motion } from "motion/react";
import { ArrowLeftRight, ArrowRight, Award, PlayCircle, Share2 } from "lucide-react";
import { doneRuns } from "@/trend";
import { Button, Chip, SectionTitle } from "@/v2/ui";
import { Shell } from "@/v2/Shell";
import { Radar } from "@/v2/viz";
import { badges } from "@/v2/badges";
import { BadgeGrid } from "@/v2/BadgeGrid";
import { ShareCardMaker } from "@/v2/ShareCard";
import { PPre } from "@/v2/PPre";
import { HISTORY, RESULT } from "./fixtures";
import { LAB_NOW, monthSummary, presentDay, shareDataFor, thDate, useLabShell } from "./demo";

export default function ProgressLab() {
  const shell = useLabShell();
  const s = useMemo(() => monthSummary(HISTORY), []);
  const list = useMemo(() => badges(HISTORY, LAB_NOW, presentDay()), []);
  const share = useMemo(() => shareDataFor(HISTORY), []);
  const runs = useMemo(() => [...doneRuns(HISTORY)].reverse(), []);
  const [b, a] = runs;
  const crit = (lv: typeof b.levels) => RESULT.criteria.map((c) => ({ ...c, level: (lv?.[c.code] ?? null) as 1 | 2 | 3 | 4 | null }));
  const earned = list.filter((x) => x.earned).length;

  return <Shell page="progress" title="ความคืบหน้า" subtitle="สรุปเดือนนี้ ตราที่ได้ และการ์ดไว้แชร์" {...shell}>
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
      <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="relative overflow-hidden rounded-panel bg-navy-gradient p-6 text-white shadow-lift sm:p-8 lg:col-span-7">
        <div className="grid-lines absolute inset-0 opacity-60" />
        <div className="relative flex items-start justify-between gap-4">
          <div>
            <Chip tone="lime">สรุปประจำเดือน</Chip>
            <h2 className="mt-4 text-3xl font-bold sm:text-4xl">{s.label}<br /><span className="text-white/70">ของคุณบนเวที</span></h2>
          </div>
          <PPre pose="wave" size={96} color="white" className="hidden sm:block" />
        </div>
        <dl className="relative mt-6 grid grid-cols-3 gap-3">
          {[["รอบ", s.rounds], ["นาที", s.minutes], ["วันที่ซ้อม", s.days.length]].map(([k, v]) => <div key={k as string} className="rounded-2xl bg-white/[0.07] p-3 sm:p-4">
            <dd className="text-3xl font-bold text-lime sm:text-4xl">{v as number}</dd><dt className="text-xs text-white/65 sm:text-sm">{k as string}</dt></div>)}
        </dl>
        <Button asChild variant="lime" size="lg" className="relative mt-6"><Link to="/lab/recap"><PlayCircle />เปิดสรุปแบบสไลด์</Link></Button>
      </motion.section>

      <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }} className="card flex flex-col p-6 lg:col-span-5">
        <p className="flex items-center gap-2 font-bold"><ArrowLeftRight className="size-5 text-brand" />ห้องเทียบ 2 รอบ</p>
        <p className="mt-1 text-sm text-muted">วิดีโอเล่นคู่กัน และระดับแต่ละเกณฑ์วางเทียบกัน</p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          {[a, b].map((r, j) => r && <div key={r.session_id} className="rounded-2xl bg-surface p-3 text-center">
            <Radar criteria={crit(r.levels)} size={120} showLabels={false} className="mx-auto" />
            <p className="mt-1 text-xs font-semibold">{j === 0 ? "รอบก่อน" : "รอบล่าสุด"} · {thDate(r.created_at)}</p>
          </div>)}
        </div>
        <Button asChild className="mt-5 self-start" size="md"><Link to={`/lab/compare?a=${a?.session_id}&b=${b?.session_id}`}>เปิดห้องเทียบ <ArrowRight /></Link></Button>
      </motion.section>

      <section className="card p-6 lg:col-span-12">
        <SectionTitle eyebrow="ตราสะสม" title={`ได้แล้ว ${earned} จาก ${list.length} ตรา`}>
          <span className="flex items-center gap-1.5 text-xs text-muted"><Award className="size-4 text-brand" />ได้จากความสม่ำเสมอในการซ้อม ไม่ได้มาจากระดับผล</span>
        </SectionTitle>
        <BadgeGrid list={list} />
      </section>

      <section id="share" className="card scroll-mt-24 p-6 lg:col-span-12">
        <SectionTitle eyebrow="การ์ดแชร์" title="อวดความพยายามของคุณ"><Share2 className="size-5 text-brand" /></SectionTitle>
        <ShareCardMaker data={share} />
      </section>
    </div>
  </Shell>;
}
