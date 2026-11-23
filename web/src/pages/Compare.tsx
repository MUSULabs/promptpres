/* /compare?a=&b=: two rounds side by side. Both videos play and seek together (same second), and the
   8 criteria are laid out level against level. Only rounds with a comparable rubric are compared (trend.ts). */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { motion } from "motion/react";
import { ArrowLeftRight, ArrowRight, Pause, Play, RotateCcw } from "lucide-react";
import type { CriterionCode, SessionRow } from "@/contract";
import { CRITERION_NAME, SKILLS, fmtDuration } from "@/presentation";
import { compatibleRubric, doneRuns } from "@/trend";
import { Button, Chip, SKILL_STYLE, SkillIcon, cn } from "@/v2/ui";
import { Shell } from "@/v2/Shell";
import { DeltaTag, LEVEL_COLOR } from "@/v2/viz";
import { ErrorPanel, HelpTip } from "@/v2/states";
import { PPre } from "@/v2/PPre";
import { api } from "@/api";
import { DashboardSkeleton, EmptyState } from "@/v2/states";
import { ListLoadError, rehearsals, useSessions } from "@/v2/sessions";
import { PATH } from "@/v2/paths";
import { thDate } from "@/v2/time";

const label = (r: SessionRow) => `${thDate(r.created_at, { day: "numeric", month: "short", year: "2-digit" })}${r.duration_s != null ? ` · ${fmtDuration(r.duration_s)}` : ""}`;

export default function Compare() {
  const { rows, error } = useSessions();
  const runs = useMemo(() => [...doneRuns(rehearsals(rows))].reverse(), [rows]); // newest first
  const [params, setParams] = useSearchParams();
  if (rows === null) return <Shell page="history" title="เทียบ 2 รอบ">{error ? <ListLoadError /> : <DashboardSkeleton />}</Shell>;
  if (runs.length < 2) return <Shell page="history" title="เทียบ 2 รอบ">
    <EmptyState pose="think" title="ต้องมีผลอย่างน้อย 2 รอบ" action={<Button asChild variant="lime"><Link to={PATH.new}>ซ้อมรอบใหม่ <ArrowRight /></Link></Button>}>
      ตอนนี้มีผล {runs.length} รอบ ซ้อมอีกรอบแล้วกลับมาเทียบวิดีโอคู่กันได้ที่นี่
    </EmptyState>
  </Shell>;
  return <CompareRuns runs={runs} params={params} setParams={setParams} />;
}

function CompareRuns({ runs, params, setParams }: { runs: SessionRow[]; params: URLSearchParams; setParams: ReturnType<typeof useSearchParams>[1] }) {
  const a = runs.find((r) => r.session_id === params.get("a")) ?? runs[1];
  const b = runs.find((r) => r.session_id === params.get("b")) ?? runs[0];
  const [older, newer] = new Date(a.created_at) <= new Date(b.created_at) ? [a, b] : [b, a];
  const set = (k: "a" | "b", id: string) => { const p = new URLSearchParams(params); p.set(k, id); if (!p.get(k === "a" ? "b" : "a")) p.set(k === "a" ? "b" : "a", (k === "a" ? b : a).session_id); setParams(p, { replace: true }); };
  const same = a.session_id === b.session_id;
  const comparable = compatibleRubric(older.rubric_version, newer.rubric_version);

  const codes = SKILLS.flatMap((s) => s.codes);
  const count = { up: 0, same: 0, down: 0, na: 0 };
  codes.forEach((c) => { const x = older.levels?.[c], y = newer.levels?.[c]; if (x == null || y == null) count.na++; else if (y > x) count.up++; else if (y < x) count.down++; else count.same++; });

  return <Shell page="history" title="เทียบ 2 รอบ" subtitle="ดูวิดีโอคู่กัน และระดับแต่ละเกณฑ์วางเทียบกัน">
    <div className="grid grid-cols-1 items-end gap-3 md:grid-cols-[1fr_auto_1fr]">
      <Picker title="รอบ A" value={a.session_id} runs={runs} onChange={(id) => set("a", id)} />
      <Button variant="white" size="icon" className="mx-auto" aria-label="สลับรอบ A และ B" onClick={() => setParams({ a: b.session_id, b: a.session_id }, { replace: true })}><ArrowLeftRight /></Button>
      <Picker title="รอบ B" value={b.session_id} runs={runs} onChange={(id) => set("b", id)} />
    </div>

    {same ? <ErrorPanel tone="info" className="mt-5" what="เลือกรอบเดียวกันทั้งสองฝั่ง" todo="เปลี่ยนรอบ A หรือ B ให้เป็นคนละรอบ เพื่อดูความต่าง" />
      : !comparable ? <ErrorPanel tone="info" className="mt-5" what="สองรอบนี้ใช้เกณฑ์คนละรุ่น" why="ระดับจากเกณฑ์ต่างรุ่นเทียบกันตรง ๆ ไม่ได้" todo="เลือกรอบที่ใช้เกณฑ์รุ่นเดียวกัน" />
      : <>
        <SyncedVideos key={`${older.session_id}-${newer.session_id}`} older={older} newer={newer} />

        <section className="card mt-5 p-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-brand">ระดับรายเกณฑ์ที่ระบบวัดได้</p>
              <h2 className="text-xl font-bold">{thDate(older.created_at)} → {thDate(newer.created_at)}</h2>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Chip tone="lime">ดีขึ้นจากรอบก่อน {count.up}</Chip><Chip tone="soft">คงที่ {count.same}</Chip><Chip tone="line">ลดลงจากรอบก่อน {count.down}</Chip>
              {count.na > 0 && <Chip tone="line" className="border border-dashed border-faint">เทียบไม่ได้ {count.na}</Chip>}
            </div>
          </div>
          <div className="mt-5 space-y-5">
            {SKILLS.map((s) => <div key={s.key}>
              <p className="mb-2 flex items-center gap-2 text-sm font-semibold"><SkillIcon skill={s.key} className="size-8 rounded-lg [&_svg]:size-4" />{s.label}<span className="font-normal text-faint">· {SKILL_STYLE[s.key].tagline}</span></p>
              <ul className="divide-y divide-line rounded-2xl bg-surface">
                {s.codes.map((c, i) => <Row key={c} code={c} a={older.levels?.[c] ?? null} b={newer.levels?.[c] ?? null} i={i} />)}
              </ul>
            </div>)}
          </div>
          <p className="mt-4 flex items-center gap-1 text-xs text-faint">ระดับที่ระบบวัดได้ในแต่ละรอบ ไม่ใช่หลักฐานว่าทักษะเพิ่มขึ้น หัวข้อ ห้อง หรือกล้องที่ต่างกันก็ทำให้ระดับต่างได้
            <HelpTip href={PATH.faq}>ใช้ความต่างเป็นสัญญาณให้ไปดูหลักฐานในวิดีโอต่อ ไม่ใช่คำตัดสิน</HelpTip></p>
        </section>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-4 rounded-panel bg-navy p-6 text-white">
          <div className="flex items-center gap-4"><PPre pose="point" size={64} color="white" /><p><b className="block">อยากรู้ว่าต่างตรงไหน?</b><span className="text-sm text-white/70">เปิดผลรอบล่าสุดแล้วกดเวลาหลักฐานเพื่อดูช่วงนั้นในวิดีโอ</span></p></div>
          <Button asChild variant="lime"><Link to={PATH.result(newer.session_id)}>ดูผลรอบ {thDate(newer.created_at)} <ArrowRight /></Link></Button>
        </div>
      </>}
  </Shell>;
}

function Picker({ title, value, runs, onChange }: { title: string; value: string; runs: SessionRow[]; onChange: (id: string) => void }) {
  return <label className="card block p-4">
    <span className="text-xs font-semibold text-brand">{title}</span>
    <select value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 h-11 w-full rounded-xl bg-surface px-3 font-semibold outline-none ring-1 ring-inset ring-line focus:ring-2 focus:ring-brand">
      {runs.map((r) => <option key={r.session_id} value={r.session_id}>{label(r)}</option>)}
    </select>
  </label>;
}

function Cell({ v }: { v: number | null }) {
  return <span className={cn("grid size-9 place-items-center rounded-xl text-sm font-bold tabular-nums", v == null ? "border-[1.5px] border-dashed border-faint text-faint" : v >= 3 ? "text-white" : "text-brand-800")}
    style={v != null ? { background: LEVEL_COLOR[v] } : undefined} aria-label={v == null ? "วิเคราะห์ไม่ได้" : `ระดับ ${v}`}>{v ?? "?"}</span>;
}

function Row({ code, a, b, i }: { code: CriterionCode; a: number | null; b: number | null; i: number }) {
  return <motion.li initial={{ opacity: 0, x: -8 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.05 }}
    className="grid grid-cols-[1fr_auto] items-center gap-3 px-4 py-3 sm:grid-cols-[1fr_auto_9rem]">
    <span className="min-w-0 text-sm"><b className="mr-1.5 text-brand">{code}</b>{CRITERION_NAME[code]}</span>
    <span className="flex items-center gap-2"><Cell v={a} /><ArrowRight className="size-4 text-faint" /><Cell v={b} /></span>
    <span className="col-span-2 sm:col-span-1 sm:text-right">{a != null && b != null ? <DeltaTag before={a} now={b} /> : <span className="text-xs text-faint">เทียบไม่ได้ในรอบนี้</span>}</span>
  </motion.li>;
}

/* Both real videos driven together: play, pause and the slider move both to the same second. A round whose
   video was deleted (Guest 7 days, member 30 days) shows a note instead. */
function SyncedVideos({ older, newer }: { older: SessionRow; newer: SessionRow }) {
  const [urls, setUrls] = useState<(string | null | undefined)[]>([undefined, undefined]);
  // Keyed by the round ids: the history list refreshes every 10 s while a round is analysed, and each fetch
  // returns a newly signed video address, which would restart both videos.
  const ids = [older.session_id, newer.session_id] as const;
  useEffect(() => {
    const c = new AbortController();
    setUrls([undefined, undefined]);
    ids.forEach((id, i) => api.result(id, c.signal)
      .then((res) => setUrls((u) => { const n = [...u]; n[i] = res.video_url; return n; }))
      .catch(() => { if (!c.signal.aborted) setUrls((u) => { const n = [...u]; n[i] = null; return n; }); }));
    return () => c.abort();
  }, [ids[0], ids[1]]); // eslint-disable-line react-hooks/exhaustive-deps
  const vids = useRef<(HTMLVideoElement | null)[]>([null, null]);
  const max = Math.max(older.duration_s ?? 0, newer.duration_s ?? 0);
  const [t, setT] = useState(0), [playing, setPlaying] = useState(false);
  const each = (f: (v: HTMLVideoElement) => void) => vids.current.forEach((v) => { if (v) f(v); });
  const seekAll = (x: number) => { setT(x); each((v) => { v.currentTime = Math.min(x, v.duration || x); }); };
  const toggle = () => {
    if (playing) { each((v) => v.pause()); setPlaying(false); return; }
    if (t >= max) seekAll(0);
    each((v) => { if (v.currentTime < (v.duration || Infinity)) void v.play().catch(() => {}); });
    setPlaying(true);
  };
  const anyVideo = urls.some((u) => !!u);

  return <section className="mt-5 rounded-panel bg-navy p-4 text-white sm:p-6">
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {([["A", older], ["B", newer]] as const).map(([k, row], i) => { const d = row.duration_s ?? 0, ended = t >= d && d > 0, url = urls[i];
        return <div key={k}>
          <div className="relative aspect-video overflow-hidden rounded-2xl bg-black">
            {url ? <video ref={(el) => { vids.current[i] = el; }} src={url} playsInline preload="metadata" muted={i === 0} aria-label={`วิดีโอรอบ ${k}`} className="size-full object-contain"
              onTimeUpdate={(e) => { if (row.duration_s === max) setT(e.currentTarget.currentTime); }} onEnded={() => { if (row.duration_s === max) setPlaying(false); }} />
              : <div className="grid size-full place-items-center bg-white/[0.06] p-4 text-center text-sm text-white/70">{url === undefined ? "กำลังโหลดวิดีโอ…" : "รอบนี้ไม่มีวิดีโอให้ดู (ลบอัตโนมัติแล้ว หรือโหลดไม่สำเร็จ)"}</div>}
            <span className="absolute left-3 top-3 rounded-full bg-navy/70 px-3 py-1 text-xs font-semibold backdrop-blur">{k === "A" ? "ก่อน" : "หลัง"} · {thDate(row.created_at)}</span>
            {ended && url && <span className="absolute inset-0 grid place-items-center bg-navy/60 text-sm font-semibold">คลิปนี้จบที่ {fmtDuration(d)}</span>}
            <span className="absolute bottom-3 right-3 rounded-full bg-navy/70 px-2.5 py-0.5 text-xs tabular-nums backdrop-blur">{fmtDuration(Math.min(t, d))} / {fmtDuration(d)}</span>
          </div>
        </div>; })}
    </div>
    <div className="mt-4 flex items-center gap-3">
      <Button size="icon" variant="lime" disabled={!anyVideo} aria-label={playing ? "หยุดทั้งสองคลิป" : "เล่นทั้งสองคลิป"} onClick={toggle}>{playing ? <Pause /> : <Play className="fill-current" />}</Button>
      <input type="range" min={0} max={max || 1} step={1} value={t} disabled={!anyVideo} onChange={(e) => seekAll(Number(e.target.value))} aria-label="เลื่อนเวลาทั้งสองคลิป" className="h-2 flex-1 cursor-pointer accent-lime" />
      <Button size="icon" variant="outlineLight" disabled={!anyVideo} aria-label="กลับไปเริ่มต้น" onClick={() => { each((v) => v.pause()); setPlaying(false); seekAll(0); }}><RotateCcw /></Button>
    </div>
    <p className="mt-2 text-xs text-white/50">ทั้งสองคลิปเล่นและเลื่อนพร้อมกันที่วินาทีเดียวกัน (เสียงจากรอบ B)</p>
  </section>;
}
