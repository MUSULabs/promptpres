import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Link, useParams } from "react-router-dom";
import { COVERAGE_LABEL, CRITERION_NAME, SKILLS, VALUE_LABEL, fmtDuration } from "../presentation";
import type { CoachItem, Criterion, CriterionCode, CriterionMeta, Result, Skill, Topic } from "../contract";
import { useSessionResult } from "../useSessionResult";
import { Icon, Message, NotFound, PageHeading, Steps } from "../components/ui";
import { PracticeMascot } from "../components/PracticeMascot";
import { LevelBand, TimeChip, readCard, type EvidencePoint, type MediaState, type Seek } from "../components/ResultParts";
import { CoachNotes, NextPractice, ResultCover } from "../components/ResultNotebook";
import { EventTimeline, TranscriptBox } from "../components/ResultTrace";
import SkillRadar from "../components/SkillRadar";
import { DeltaBadge } from "../components/Trend";
import { api } from "../api";
import { levelOf, MIXED_RUBRIC_NOTE, previousRun } from "../trend";
import type { SessionRow } from "../contract";
import "./result-notebook.css";

export default function ResultPage() {
  const { id = "" } = useParams();
  return <div className="result-route"><ResultView key={id} id={id} /></div>;
}

function ResultView({ id }: { id: string }) {
  const { res, fb, meta, metaStatus, retryMeta, err, retry, reconnecting, now } = useSessionResult(id);

  if (err?.status === 404) return <NotFound message="ไม่พบรอบซ้อมนี้" />;
  if (err?.status === 409) return <Message>{err.message} — <Link to={`/sessions/${id}/video`}>ไปขั้นวิดีโอ</Link></Message>;
  if (err) return <div className="result-load-error">
    <Message kind="error">โหลดผลไม่ได้: {err.message}</Message>
    <button className="ghost fit" onClick={retry}><Icon name="refresh" /> ลองใหม่</button>
  </div>;
  if (!res) return <Message>{reconnecting ? "ติดต่อเซิร์ฟเวอร์ไม่ได้ กำลังลองใหม่…" : "กำลังโหลดผลการซ้อม…"}</Message>;

  const waiting = res.status === "queued" || res.status === "processing";
  return (
    <section className="result-page">
      {res.status !== "done" && <Steps current={3} />}
      {res.status !== "done" && <PageHeading title={waiting ? "สถานะการวิเคราะห์" : "ผลการซ้อม"}>
        รอบซ้อมวันที่ <time dateTime={res.created_at}>{new Date(res.created_at).toLocaleString("th-TH")}</time>
      </PageHeading>}
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
      {res.status === "done" && <ResultDetails result={res} feedback={fb} metadata={meta}
        metaStatus={metaStatus} retryMeta={retryMeta} />}
    </section>
  );
}

function AnalysisStatus({ result, now }: { result: Result; now: number }) {
  const time = Math.max(0, (now - Date.parse(result.created_at)) / 1000);
  const processing = result.status === "processing";
  return (
    <div className="panel analysis-status" role="status">
      <ol className="analysis-flow" aria-label="ลำดับสถานะการวิเคราะห์">
        <li><Icon name="check" /> รับวิดีโอแล้ว</li>
        <li aria-current={!processing ? "step" : undefined}>{processing && <Icon name="check" />} รอคิว</li>
        <li aria-current={processing ? "step" : undefined}>วิเคราะห์</li>
      </ol>
      <div className="analysis-message">
        <div>
          <h2>{processing ? "กำลังวิเคราะห์วิดีโอการซ้อม" : "อยู่ในคิว รอเครื่องวิเคราะห์"}</h2>
          <p className="muted">หน้านี้จะแสดงผลให้เองเมื่อวิเคราะห์เสร็จ</p>
        </div>
        {processing && <PracticeMascot pose="thinking" />}
      </div>
      {Number.isFinite(time) && <p className="muted small" aria-live="off">นับจากเริ่มตั้งค่ารอบนี้ {fmtDuration(time)}</p>}
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
  if (failed) return <div className="media-fallback">
    <Message>เปิดวิดีโอของรอบนี้ไม่ได้ คุณยังอ่านเวลาในหลักฐานและข้อเสนอแนะได้</Message>
    <button className="ghost fit" onClick={() => {
      setAttempt(0);
      setFailed(false);
      onState?.("loading");
    }}><Icon name="refresh" /> ลองเปิดวิดีโออีกครั้ง</button>
  </div>;
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

function notePoint(note?: CoachItem): EvidencePoint | null {
  const seconds = note?.cite_s[0];
  return seconds == null ? null : { seconds, code: note?.code ?? undefined };
}

type MetaStatus = ReturnType<typeof useSessionResult>["metaStatus"];

// Phones fold each card's measured values and evidence behind one disclosure (handoff 03: "Mobile: summarize
// first; details via accessible disclosure"). Same breakpoint as `@media (max-width: 759px)` in result-notebook.css.
const NARROW = "(max-width: 759px)";
function subscribeNarrow(change: () => void) {
  const query = matchMedia(NARROW);
  query.addEventListener("change", change);
  return () => query.removeEventListener("change", change);
}
const useNarrow = () => useSyncExternalStore(subscribeNarrow, () => matchMedia(NARROW).matches, () => false);

function ResultDetails({ result, feedback, metadata, metaStatus, retryMeta }: {
  result: Result; feedback: Record<string, string>; metadata: ReturnType<typeof useSessionResult>["meta"];
  metaStatus: MetaStatus; retryMeta: () => void;
}) {
  const [filter, setFilter] = useState<Skill | "all">("all");
  const [media, setMedia] = useState<MediaState>(result.video_url ? "loading" : "unavailable");
  const [note, setNote] = useState<CoachItem>();
  const [selection, setSelection] = useState<EvidencePoint | null>();
  const video = useRef<HTMLVideoElement>(null);
  const narrow = useNarrow();
  // Open folds live here (not in Card) so every seek to a criterion opens its details, even after the user closed them.
  const [openCards, setOpenCards] = useState<ReadonlySet<CriterionCode>>(() => new Set());
  const [announce, setAnnounce] = useState("");
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
  const notes = result.coach?.status === "ok" ? result.coach.items : [];
  const strengths = notes.filter((item) => item.kind === "strength");
  const focus = notes.filter((item) => item.kind === "focus");
  const plans = notes.filter((item) => item.kind === "plan");
  const active = note ?? focus[0] ?? strengths[0];
  const times = [
    ["ความยาวคลิป", result.duration_s],
    ["ช่วงนำเสนอจริง", byCode.T1?.values.speech_span_s],
    ["เวลาเป้าหมาย", result.target_duration_s],
  ] as const;

  function chooseNote(item: CoachItem) {
    setNote(item);
    setSelection(notePoint(item));
  }

  function toggleCard(code: CriterionCode, open: boolean) {
    setOpenCards((cards) => {
      if (cards.has(code) === open) return cards;
      const next = new Set(cards);
      if (open) next.add(code); else next.delete(code);
      return next;
    });
  }

  function seek(seconds: number, code?: CriterionCode) {
    const player = video.current;
    if (!player || player.readyState < 1) return;
    setSelection({ seconds, code });
    if (narrow && code) {
      toggleCard(code, true);
      setAnnounce(`เปิดรายละเอียดเกณฑ์ ${code} ${CRITERION_NAME[code]} แล้ว`);
    }
    player.currentTime = Math.max(0, Number.isFinite(player.duration) ? Math.min(seconds, player.duration) : seconds);
    void player.play().catch(() => undefined);
    player.scrollIntoView({
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "nearest",
    });
  }

  return (
    <div className="notebook-result">
      <ResultCover result={result} times={times} />
      <div className="notebook-frame notebook-body">
        <section aria-labelledby="result-review">
          <div className="review-heading">
            <h2 id="result-review" tabIndex={-1}>ทบทวนการซ้อม</h2>
            <a href="#result-criteria">ดูผลทั้ง 8 เกณฑ์ <Icon name="chevronDown" /></a>
          </div>
          <div className="notebook-spread">
            <CoachNotes kind="strength" notes={strengths} active={active} select={chooseNote} media={media} seek={seek} />
            <CoachNotes kind="focus" notes={focus} active={active} select={chooseNote} media={media} seek={seek} />
          </div>
        </section>
        <section className="notebook-player panel" aria-labelledby="result-evidence">
          <h2 id="result-evidence" tabIndex={-1}><Icon name="video" /> วิดีโอและหลักฐาน</h2>
          <div className="notebook-evidence-grid">
            <div>
              {result.video_url ? <SessionPlayer url={result.video_url} video={video} onState={setMedia} />
                : <Message>รอบนี้ไม่มีวิดีโอสำหรับเปิดดู คุณยังอ่านเวลาในหลักฐานและข้อเสนอแนะได้</Message>}
            </div>
            <div className="notebook-trace">
              <EventTimeline criteria={result.criteria} duration={result.duration_s} video={video} media={media}
                selection={selection === undefined ? notePoint(active) : selection} seek={seek} />
              <TranscriptBox sessionId={result.session_id} video={video} media={media} seek={seek} />
            </div>
          </div>
        </section>
        <NextPractice plans={plans} media={media} seek={seek}
          hasAvailableResults={result.criteria.some((criterion) => criterion.status === "ok")} />
        <section className="notebook-criteria" aria-labelledby="result-criteria">
          <div className="review-heading">
            <h2 id="result-criteria" tabIndex={-1}>ผลรายเกณฑ์</h2>
            <p className="muted small">รูบริก {result.versions.rubric ?? "—"} / ค่าตั้ง {result.versions.config ?? "—"}</p>
          </div>
          {narrow && <p className="sr-only" aria-live="polite">{announce}</p>}
          {metaStatus === "failed" && <div className="result-load-error">
            <Message kind="error">โหลดคำอธิบายระดับและข้อเสนอแนะรายเกณฑ์ไม่สำเร็จ ระดับและค่าที่วัดได้ด้านล่างยังถูกต้อง</Message>
            <button className="ghost fit" onClick={retryMeta}><Icon name="refresh" /> ลองใหม่</button>
          </div>}
          {previous && previous.rubric_version !== result.versions.rubric &&
            <p className="muted small cross-version-note">{MIXED_RUBRIC_NOTE}</p>}
          <details className="disclosure radar-disclosure">
            <summary>ดูกราฟเรดาร์ 8 เกณฑ์ <Icon name="chevronDown" /></summary>
            <SkillRadar criteria={result.criteria} />
          </details>
          <div className="tabs filter-bar" role="group" aria-label="กรองผลตามด้าน">
            <button className="segment" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>ทั้งหมด</button>
            {SKILLS.map((s) => <button className="segment" key={s.key}
              aria-pressed={filter === s.key} onClick={() => setFilter(s.key)}>{s.label}</button>)}
          </div>
          {SKILLS.filter((s) => filter === "all" || filter === s.key).map((s) => (
            <section key={s.key} className="skill" aria-labelledby={`skill-${s.key}`}>
              <h3 id={`skill-${s.key}`}>{s.label}</h3>
              <div className="cards">
                {s.codes.map((code) => {
                  const c = byCode[code];
                  return c && <Card key={code} c={c} feedback={c.feedback_id ? feedback[c.feedback_id] : undefined}
                    meta={metadata[code]} metaStatus={metaStatus} before={previous ? levelOf(previous, code) : undefined} crossVersion={!!previous && previous.rubric_version !== result.versions.rubric} topics={code === "C2" && c.status === "ok" ? result.topics : undefined}
                    media={media} seek={seek} narrow={narrow} open={openCards.has(code)}
                    onToggle={(open) => toggleCard(code, open)} />;
                })}
              </div>
            </section>
          ))}
        </section>
      </div>
    </div>
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

function Card({ c, feedback, meta, metaStatus, before, topics, media, seek, crossVersion, narrow, open, onToggle }: {
  c: Criterion; feedback?: string; meta?: CriterionMeta; metaStatus: MetaStatus; before?: number | null; crossVersion?: boolean;
  topics?: Topic[];
  media: MediaState; seek: Seek;
  narrow: boolean; open: boolean; onToggle: (open: boolean) => void;
}) {
  const ok = c.status === "ok";
  const scored = meta?.scored_values;
  const reading = readCard(c, meta);
  const all = Object.entries(c.values);
  const main = scored ? all.filter(([key]) => scored.includes(key)) : [];
  const supporting = scored ? all.filter(([key]) => !scored.includes(key)) : [];
  const head = <>
    <header>
      <span className="code">{c.code}</span><h4>{CRITERION_NAME[c.code]}</h4>
      <span className="level">{ok ? `ระดับ ${c.level}/4` : "วิเคราะห์ไม่ได้"}</span>
    </header>
    <LevelBand level={ok ? c.level : null} />
    {before !== undefined && <DeltaBadge before={before} now={c.level} crossVersion={crossVersion} />}
    {reading && <p className="reading"><strong>{reading.word}</strong>
      {reading.detail && <span> · {reading.detail}</span>}</p>}
    {!ok && <p className="reason">เหตุผล: {c.reason}</p>}
  </>;
  const values = <>
    {!scored && all.length > 0 && <div>
      <p className="muted small value-note">{metaStatus === "ready" ? "ไม่ทราบว่าค่าใดใช้คิดระดับในผลรุ่นนี้"
        : metaStatus === "loading" ? "กำลังโหลดว่าค่าใดใช้คิดระดับ…"
        : "โหลดคำอธิบายค่าไม่สำเร็จ ค่าด้านล่างวัดได้จริง แต่ยังแยกไม่ได้ว่าค่าใดใช้คิดระดับและค่าใดเป็นข้อมูลประกอบ"}</p>
      <ValueList entries={all} />
    </div>}
    {main.length > 0 && <div className="primary-values"><ValueList entries={main} />
      {reading?.explain && <p className="muted small">{reading.explain}</p>}</div>}
  </>;
  const template = ok && <p className="template"><strong>ข้อเสนอแนะ</strong> {feedback ?? (metaStatus === "loading" ? "กำลังโหลดข้อเสนอแนะ…"
    : metaStatus === "failed" ? "โหลดข้อเสนอแนะไม่สำเร็จ" : "ไม่พบข้อความข้อเสนอแนะสำหรับผลรุ่นนี้")}</p>;
  const evidence = c.evidence.length > 0 && <div className="evidence">
    <h5>ช่วงเวลาหลักฐาน</h5>
    <ul>{c.evidence.map((e, i) => <li key={i}>
      <TimeChip start={e.start_s} end={e.end_s} media={media} seek={(seconds) => seek(seconds, c.code)} />
      {(e.label || e.note) && <span>{e.label || e.note}</span>}
    </li>)}</ul>
  </div>;
  const coverage = topics && topics.length > 0 && <CoverageTable topics={topics} media={media} seek={seek} />;
  const supportingEl = supporting.length > 0 && <div className="supporting">
    <h5>ข้อมูลประกอบ — ไม่ใช้คิดระดับ</h5><ValueList entries={supporting} />
  </div>;
  const cls = `card ${ok ? `lvl${c.level}` : "na"}`;

  if (!narrow) return (
    <article className={cls} data-criterion={c.code}>
      {head}{values}{template}{evidence}{coverage}{supportingEl}
    </article>
  );

  // Phone: level, band, reading, reason and feedback stay in view; measured values and evidence fold.
  const valueCount = scored ? main.length : all.length;
  const evidenceCount = c.evidence.length;
  const topicCount = topics?.length ?? 0;
  const hasMore = valueCount + evidenceCount + topicCount + supporting.length > 0;
  const title = evidenceCount || topicCount ? (valueCount ? "ดูค่าที่วัดและหลักฐาน" : "ดูหลักฐาน")
    : valueCount ? "ดูค่าที่วัด" : "ดูข้อมูลประกอบ";
  const counts = [valueCount && `ค่าที่วัด ${valueCount} ค่า`, evidenceCount && `หลักฐาน ${evidenceCount} ช่วง`,
    topicCount && `หัวข้อตามแผน ${topicCount} หัวข้อ`, supporting.length && `ข้อมูลประกอบ ${supporting.length} ค่า`]
    .filter(Boolean).join(" · ");
  return (
    <article className={cls} data-criterion={c.code}>
      {head}{template}
      {hasMore && <details className="disclosure card-more" open={open} onToggle={(e) => onToggle(e.currentTarget.open)}>
        <summary>
          <span className="card-more-label">
            <span className="card-more-title">{title}<span className="sr-only"> ของเกณฑ์ {CRITERION_NAME[c.code]}</span></span>
            <small className="muted">{counts}</small>
          </span>
          <Icon name="chevronDown" />
        </summary>
        <div className="card-more-body">{values}{evidence}{coverage}{supportingEl}</div>
      </details>}
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
          <td role="cell">{t.first_mention_s != null ? <TimeChip start={t.first_mention_s} media={media}
            seek={(seconds) => seek(seconds, "C2")} /> : "—"}</td>
        </tr>)}
      </tbody>
    </table>
  );
}
