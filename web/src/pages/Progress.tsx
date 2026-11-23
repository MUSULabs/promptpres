/* /progress: this month in numbers, compare two rounds, badges (behaviour only) and the share card. All from the shared history. */
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
import { useAccount } from "@/auth";
import { compatibleRubric } from "@/trend";
import { DashboardSkeleton } from "@/v2/states";
import { ListLoadError, rehearsals, rowCriteria, useSessions } from "@/v2/sessions";
import { PATH } from "@/v2/paths";
import { monthSummary, presentDay, shareDataFor, thDate } from "@/v2/time";

export default function Progress() {
  const { rows, error } = useSessions();
  const { name } = useAccount();
  const mine = useMemo(() => rehearsals(rows), [rows]);
  const now = useMemo(() => new Date(), [rows]); // eslint-disable-line react-hooks/exhaustive-deps
  const s = useMemo(() => monthSummary(mine, now), [mine, now]);
  const list = useMemo(() => badges(mine, now, presentDay() ?? undefined), [mine, now]);
  const share = useMemo(() => shareDataFor(mine, name, now), [mine, name, now]);
  const runs = useMemo(() => [...doneRuns(mine)].reverse(), [mine]);
  const b = runs[0], a = runs.find((r) => r !== b && compatibleRubric(r.rubric_version, b?.rubric_version ?? null));
  const earned = list.filter((x) => x.earned).length;

  return <Shell page="progress" title="ความคืบหน้า" subtitle="สรุปเดือนนี้ ตราที่ได้ และการ์ดไว้แชร์">
    {rows === null ? (error ? <ListLoadError /> : <DashboardSkeleton />) : <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
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
        {s.rounds > 0 ? <Button asChild variant="lime" size="lg" className="relative mt-6"><Link to={PATH.recap}><PlayCircle />เปิดสรุปแบบสไลด์</Link></Button>
          : <p className="relative mt-6 text-sm text-white/70">ยังไม่มีรอบที่ส่งซ้อมในเดือนนี้ ซ้อม 1 รอบแล้วสรุปแบบสไลด์จะเปิดได้</p>}
      </motion.section>

      <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }} className="card flex flex-col p-6 lg:col-span-5">
        <p className="flex items-center gap-2 font-bold"><ArrowLeftRight className="size-5 text-brand" />ห้องเทียบ 2 รอบ</p>
        <p className="mt-1 text-sm text-muted">วิดีโอเล่นคู่กัน และระดับแต่ละเกณฑ์วางเทียบกัน</p>
        {!a || !b ? <p className="mt-4 rounded-2xl bg-surface p-4 text-sm text-muted">ต้องมีผลอย่างน้อย 2 รอบที่ใช้เกณฑ์รุ่นที่เทียบกันได้ ตอนนี้มีผล {runs.length} รอบ</p> : <>
        <div className="mt-4 grid grid-cols-2 gap-3">
          {[a, b].map((r, j) => r && <div key={r.session_id} className="rounded-2xl bg-surface p-3 text-center">
            <Radar criteria={rowCriteria(r.levels ?? {})} size={120} showLabels={false} className="mx-auto" />
            <p className="mt-1 text-xs font-semibold">{j === 0 ? "รอบก่อน" : "รอบล่าสุด"} · {thDate(r.created_at)}</p>
          </div>)}
        </div>
        <Button asChild className="mt-5 self-start" size="md"><Link to={PATH.compare(a.session_id, b.session_id)}>เปิดห้องเทียบ <ArrowRight /></Link></Button>
        </>}
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
    </div>}
  </Shell>;
}
