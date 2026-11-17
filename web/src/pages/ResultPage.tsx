import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { COVERAGE_LABEL, CRITERION_NAME, SKILLS, VALUE_LABEL, fmtTime } from "../presentation";
import type { Criterion, CriterionMeta, Result, Skill, Topic } from "../contract";
import { useSessionResult } from "../useSessionResult";
import { Icon, Message, NotFound, PageHeading, Steps } from "../components/ui";
import { CoachPanel, LevelBand, TimeChip, readCard, type MediaState, type Seek } from "../components/ResultParts";
import { EventTimeline, TranscriptBox } from "../components/ResultTrace";
import SkillRadar from "../components/SkillRadar";
import { DeltaBadge } from "../components/Trend";
import { api } from "../api";
import { levelOf, MIXED_RUBRIC_NOTE, previousRun } from "../trend";
import type { SessionRow } from "../contract";

export default function ResultPage() {
  const { id = "" } = useParams();
  return <ResultView key={id} id={id} />;
}

function ResultView({ id }: { id: string }) {
  const { res, fb, meta, err, reconnecting, now } = useSessionResult(id);

  if (err?.status === 404) return <NotFound message="ไม่พบรอบซ้อมนี้" />;
  if (err?.status === 409) return <Message>{err.message} — <Link to={`/sessions/${id}/video`}>ไปขั้นวิดีโอ</Link></Message>;
  if (err) return <Message kind="error">โหลดผลไม่ได้: {err.message}</Message>;
  if (!res) return <Message>{reconnecting ? "ติดต่อเซิร์ฟเวอร์ไม่ได้ กำลังลองใหม่…" : "กำลังโหลดผลการซ้อม…"}</Message>;

  const waiting = res.status === "queued" || res.status === "processing";
  return (
    <section>
      <Steps current={3} />
      <PageHeading badge="ขั้นตอนที่ 03" title={waiting ? "สถานะการวิเคราะห์" : "ผลการซ้อม"}
        action={<Link className="button secondary" to="/"><Icon name="history" /> ประวัติการซ้อม</Link>}>
        รอบซ้อม <code>{res.session_id}</code>
      </PageHeading>
      {reconnecting && <Message>ติดต่อเซิร์ฟเวอร์ไม่ได้ กำลังลองใหม่…</Message>}
      {waiting && <AnalysisStatus result={res} now={now} />}
      {res.status === "failed" && (
        <div className="panel failure-state">
          <span className="state-icon"><Icon name="alert" /></span>
          <h2>วิเคราะห์ไม่สำเร็จทั้งรอบซ้อม</h2>
          <Message kind="error">{res.error}</Message>
          <Link className="button fit" to="/new"><Icon name="plus" /> เริ่มรอบซ้อมใหม่</Link>
          {res.video_url && <SessionPlayer url={res.video_url} />}
        </div>
      )}
      {res.status === "done" && <ResultDetails result={res} feedback={fb} metadata={meta} />}
    </section>
  );
}

function AnalysisStatus({ result, now }: { result: Result; now: number }) {
  const time = Math.max(0, (now - Date.parse(result.created_at)) / 1000);
  const processing = result.status === "processing";
  return (
    <div className="panel analysis-status" role="status">
      {processing ? <div className="processing-orb" aria-hidden="true">
        <span className="orb-ring orb-ring-one" /><span className="orb-ring orb-ring-two" />
        <span className="orb-glass"><Icon name="sparkles" /></span>
      </div> : <span className="state-icon"><Icon name="clock" /></span>}
      <span className={`status ${result.status}`}>{processing ? "กำลังวิเคราะห์" : "รอคิว"}</span>
      <h2>{processing ? "กำลังวิเคราะห์วิดีโอการซ้อม" : "อยู่ในคิว รอเครื่องวิเคราะห์"}</h2>
      <p className="muted">หน้านี้จะแสดงผลให้เองเมื่อวิเคราะห์เสร็จ</p>
      {processing && <ul className="dimension-pills" aria-label="ด้านที่ระบบวิเคราะห์">
        {SKILLS.map(({ key, label }) => <li key={key}>{label}</li>)}
      </ul>}
      <p className="refresh-pill"><Icon name="refresh" /> อัปเดตสถานะทุก 4 วินาที</p>
      {Number.isFinite(time) && <p className="muted" aria-live="off">เวลาตั้งแต่สร้างรอบ {fmtTime(Math.floor(time))}</p>}
    </div>
  );
}

const PLAYER_RETRY_MS = [2_000, 5_000, 10_000];   // a just-finished video may need a moment to reach the server

function SessionPlayer({ url, video, onState }: {
  url: string; video?: React.Ref<HTMLVideoElement>; onState?: (state: MediaState) => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const [waiting, setWaiting] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => { setAttempt(0); setWaiting(false); setFailed(false); }, [url]);
  useEffect(() => {
    if (!waiting) return;
    const timer = setTimeout(() => { setWaiting(false); setAttempt((n) => n + 1); }, PLAYER_RETRY_MS[attempt]);
    return () => clearTimeout(timer);
  }, [waiting, attempt]);
  if (failed) return <Message>ไม่สามารถเปิดวิดีโอของรอบนี้ได้ หากรอบนี้พ้นระยะเก็บไฟล์วิดีโอแล้ว คะแนนและข้อเสนอแนะยังอยู่ครบ</Message>;
  const src = attempt ? `${url}${url.includes("?") ? "&" : "?"}retry=${attempt}` : url;
  return <>
    {waiting && <Message>กำลังลองเปิดวิดีโออีกครั้ง…</Message>}
    <video key={attempt} ref={video} className="video" controls playsInline preload="metadata" src={src}
      aria-label="วิดีโอการซ้อม" onLoadedMetadata={() => onState?.("ready")}
      onError={() => {
        if (attempt < PLAYER_RETRY_MS.length) { setWaiting(true); onState?.("loading"); return; }
        setFailed(true); onState?.("unavailable");
      }} />
  </>;
}

function ResultDetails({ result, feedback, metadata }: {
  result: Result; feedback: Record<string, string>; metadata: ReturnType<typeof useSessionResult>["meta"];
}) {
  const [filter, setFilter] = useState<Skill | "all">("all");
  const [media, setMedia] = useState<MediaState>(result.video_url ? "loading" : "unavailable");
  const video = useRef<HTMLVideoElement>(null);
  const [previous, setPrevious] = useState<SessionRow | null>(null);
  useEffect(() => {        // previous finished rehearsal (same rubric) for the delta badges; mocks have none
    if (result.session_id.startsWith("s_mock_")) return;
    const controller = new AbortController();
    api.sessions(controller.signal)
      .then((rows) => setPrevious(previousRun(rows, result.session_id, result.versions.rubric)))
      .catch(() => undefined);
    return () => controller.abort();
  }, [result.session_id, result.versions.rubric]);
  const byCode = Object.fromEntries(result.criteria.map((c) => [c.code, c]));
  const times = [
    ["ความยาวคลิป", result.duration_s],
    ["ช่วงนำเสนอจริง", byCode.T1?.values.speech_span_s],
    ["เวลาเป้าหมาย", result.target_duration_s],
  ] as const;

  function seek(seconds: number) {
    const player = video.current;
    if (!player || player.readyState < 1) return;
    player.currentTime = Math.max(0, Number.isFinite(player.duration) ? Math.min(seconds, player.duration) : seconds);
    void player.play().catch(() => undefined);
    player.scrollIntoView({
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "nearest",
    });
  }

  return (
    <>
      <SkillRadar criteria={result.criteria} />
      <dl className="result-times">
        {times.map(([label, value]) => <div className="panel" key={label}>
          <dt>{label}</dt><dd>{value == null ? "—" : fmtTime(value)}</dd>
        </div>)}
      </dl>
      <div className="result-workspace">
        <aside className="panel result-player">
          <h2><Icon name="video" /> วิดีโอการซ้อม</h2>
          {result.video_url ? <SessionPlayer url={result.video_url} video={video} onState={setMedia} />
            : <Message>รอบนี้ไม่มีวิดีโอสำหรับเปิดดู</Message>}
          <EventTimeline criteria={result.criteria} duration={result.duration_s} media={media} seek={seek} />
          <TranscriptBox sessionId={result.session_id} video={video} media={media} seek={seek} />
          <p className="muted">{media === "ready" ? "เลือกช่วงหลักฐานเพื่อไปยังจุดนั้นในวิดีโอ"
            : media === "loading" ? "รอวิดีโอพร้อมก่อนกระโดดไปยังหลักฐาน" : "ยังอ่านช่วงหลักฐานได้ แต่ไม่สามารถกระโดดเวลาได้"}</p>
          <p className="muted">รูบริก {result.versions.rubric ?? "—"} · ค่าตั้ง {result.versions.config ?? "—"}</p>
        </aside>
        <div className="result-content">
          <CoachPanel coach={result.coach} media={media} seek={seek} />
          <div className="section-heading"><h2>ผลรายเกณฑ์</h2><span className="tag">{result.criteria.length} เกณฑ์</span></div>
          <p className="muted">ผลแยกรายเกณฑ์ ไม่มีคะแนนรวม และไม่ใช่การให้เกรด</p>
          {previous && previous.rubric_version !== result.versions.rubric &&
            <p className="muted small cross-version-note">{MIXED_RUBRIC_NOTE}</p>}
          <div className="tabs filter-bar" role="group" aria-label="กรองผลตามด้าน">
            <button className="segment" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>ทั้งหมด</button>
            {SKILLS.map((s) => <button className="segment" key={s.key}
              aria-pressed={filter === s.key} onClick={() => setFilter(s.key)}>{s.label}</button>)}
          </div>
          {SKILLS.filter((s) => filter === "all" || filter === s.key).map((s) => (
            <section key={s.key} className="skill" aria-labelledby={`skill-${s.key}`}>
              <h3 id={`skill-${s.key}`}>{s.label}</h3>
              <div className={`cards${s.key === "content" || s.codes.length === 1 ? " cards-stack" : ""}`}>
                {s.codes.map((code) => {
                  const c = byCode[code];
                  return c && <Card key={code} c={c} feedback={c.feedback_id ? feedback[c.feedback_id] : undefined}
                    meta={metadata[code]} before={previous ? levelOf(previous, code) : undefined} crossVersion={!!previous && previous.rubric_version !== result.versions.rubric} topics={code === "C2" && c.status === "ok" ? result.topics : undefined}
                    media={media} seek={seek} />;
                })}
              </div>
            </section>
          ))}
        </div>
      </div>
    </>
  );
}

function ValueList({ entries }: { entries: [string, number | null][] }) {
  return <dl className="values">
    {entries.map(([key, value]) => {
      const [label, unit] = VALUE_LABEL[key] ?? [key, ""];
      return <div key={key}><dt>{label}</dt><dd>{value ?? "—"} {value != null && unit && <small>{unit}</small>}</dd></div>;
    })}
  </dl>;
}

function Card({ c, feedback, meta, before, topics, media, seek, crossVersion }: {
  c: Criterion; feedback?: string; meta?: CriterionMeta; before?: number | null; crossVersion?: boolean; topics?: Topic[];
  media: MediaState; seek: Seek;
}) {
  const ok = c.status === "ok";
  const scored = meta?.scored_values;
  const reading = readCard(c, meta);
  const all = Object.entries(c.values);
  const main = scored ? all.filter(([key]) => scored.includes(key)) : [];
  const supporting = scored ? all.filter(([key]) => !scored.includes(key)) : [];
  return (
    <article className={`card ${ok ? `lvl${c.level}` : "na"}${c.code === "C2" ? " card-wide" : ""}`}>
      <header>
        <span className="code">{c.code}</span><h4>{CRITERION_NAME[c.code]}</h4>
        <span className="level">{ok ? `ระดับ ${c.level}/4` : "วิเคราะห์ไม่ได้"}</span>
      </header>
      <LevelBand level={ok ? c.level : null} />
      {before !== undefined && <DeltaBadge before={before} now={c.level} crossVersion={crossVersion} />}
      {reading && <p className="reading"><strong>{reading.word}</strong>
        {reading.detail && <span> · {reading.detail}</span>}</p>}
      {!ok && <p className="reason">เหตุผล: {c.reason}</p>}
      {!scored && all.length > 0 && <div>
        <p className="muted">ไม่ทราบว่าค่าใดใช้คิดระดับในผลรุ่นนี้</p><ValueList entries={all} />
      </div>}
      {main.length > 0 && <div className="primary-values"><ValueList entries={main} />
        {reading?.explain && <p className="muted small">{reading.explain}</p>}</div>}
      {ok && <p className="template"><strong>ข้อเสนอแนะ</strong> {feedback ?? "ไม่พบข้อความข้อเสนอแนะสำหรับผลรุ่นนี้"}</p>}
      {c.evidence.length > 0 && <div className="evidence">
        <h5>ช่วงเวลาหลักฐาน</h5>
        <ul>{c.evidence.map((e, i) => <li key={i}>
          <TimeChip start={e.start_s} end={e.end_s} media={media} seek={seek} />
          {(e.label || e.note) && <span>{e.label || e.note}</span>}
        </li>)}</ul>
      </div>}
      {topics && topics.length > 0 && <CoverageTable topics={topics} media={media} seek={seek} />}
      {supporting.length > 0 && <div className="supporting">
        <h5>ข้อมูลประกอบ — ไม่ใช้คิดระดับ</h5><ValueList entries={supporting} />
      </div>}
    </article>
  );
}

function CoverageTable({ topics, media, seek }: { topics: Topic[]; media: MediaState; seek: Seek }) {
  return (
    <table className="coverage-table" role="table">
      <caption>หัวข้อตามแผน</caption>
      <thead role="rowgroup"><tr role="row">
        <th scope="col" role="columnheader">หัวข้อ</th>
        <th scope="col" role="columnheader">สถานะ</th>
        <th scope="col" role="columnheader">คำพูดอ้างอิง</th>
        <th scope="col" role="columnheader">เวลา</th>
      </tr></thead>
      <tbody role="rowgroup">
        {[...topics].sort((a, b) => a.order - b.order).map((t) => <tr role="row" key={t.id}>
          <td role="cell"><span className="topic-number">{t.order}</span> <strong>{t.title}</strong></td>
          <td role="cell"><span className={`cov ${t.coverage}`}>{COVERAGE_LABEL[t.coverage]}</span></td>
          <td role="cell" className="quote">{t.evidence_quote ? <q>{t.evidence_quote}</q> : "—"}</td>
          <td role="cell">{t.first_mention_s != null ? <TimeChip start={t.first_mention_s} media={media} seek={seek} /> : "—"}</td>
        </tr>)}
      </tbody>
    </table>
  );
}
