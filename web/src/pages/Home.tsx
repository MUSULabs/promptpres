import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import type { FlowStatus, SessionRow } from "../contract";
import { fmtDuration } from "../presentation";
import { Icon, Message } from "../components/ui";
import { TrendPanel } from "../components/Trend";
import { PracticeMascot } from "../components/PracticeMascot";
import "./dashboard.css";

const STATUS_LABEL: Record<FlowStatus, string> = {
  created: "ยังไม่ส่งวิดีโอ", queued: "รอคิว", processing: "กำลังวิเคราะห์", done: "พร้อมดูผล", failed: "วิเคราะห์ไม่สำเร็จ",
};
const DATE = new Intl.DateTimeFormat("th-TH", { dateStyle: "medium" });
const CLOCK = new Intl.DateTimeFormat("th-TH", { hour: "2-digit", minute: "2-digit" });
const REFRESH_MS = 10_000;   // while a round is waiting or being analysed, the list asks again this often

function SessionLink({ row }: { row: SessionRow }) {
  return <Link className="session-open" to={`/sessions/${row.session_id}${row.status === "created" ? "/video" : ""}`}>
    {row.status === "created" ? "ทำต่อ" : row.status === "done" ? "ดูผล" : "ดูสถานะ"} <Icon name="arrow" />
  </Link>;
}

function SessionDate({ row }: { row: SessionRow }) {
  const date = new Date(row.created_at);
  return <time dateTime={row.created_at}>{DATE.format(date)}<span>{CLOCK.format(date)} น.</span></time>;
}

function FeaturedRound({ row }: { row: SessionRow }) {
  return <li>
    <div className="dashboard-round-meta">
      <SessionDate row={row} />
      <span className={`status ${row.status}`}>{STATUS_LABEL[row.status]}</span>
    </div>
    <SessionLink row={row} />
  </li>;
}

export default function Home() {
  const [rows, setRows] = useState<SessionRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [refresh, setRefresh] = useState(0);
  // A request still running is never cut off by the next timer tick: on an API slower than REFRESH_MS
  // every tick would cancel the one before it and the list would never update.
  const loading = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    loading.current = true;
    api.sessions(signal).then((data) => { if (!signal.aborted) { setRows(data); setErr(null); } })
      .catch((e) => { if (!signal.aborted) setErr(String(e.message)); })   // a failed refresh keeps the list shown
      .finally(() => { if (!signal.aborted) loading.current = false; });
    return () => { controller.abort(); loading.current = false; };
  }, [attempt, refresh]);
  const rehearsals = rows?.filter((row) => row.source === "session");
  const latest = rehearsals?.[0];
  const active = rehearsals?.filter((row) => row.status === "created" || row.status === "queued" || row.status === "processing");
  // Rounds in the queue or being analysed change on the server: keep their status current while the tab is shown.
  const analysing = !!rehearsals?.some((row) => row.status === "queued" || row.status === "processing");
  useEffect(() => {
    if (!analysing) return;
    const tick = () => { if (!document.hidden && !loading.current) setRefresh((n) => n + 1); };
    const timer = setInterval(tick, REFRESH_MS);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", tick); };
  }, [analysing]);

  return (
    <section className="dashboard">
      <div className="dashboard-hero">
        <div>
          <h1>พร้อมซ้อมนำเสนอ</h1>
          <p>อัดผ่านกล้องหรือเลือกคลิปที่มี แล้วกลับมาดูผลหลังซ้อม</p>
          <Link className="button action-yellow" to="/new"><Icon name="video" /> เริ่มซ้อม <Icon name="arrow" /></Link>
        </div>
        <div className="dashboard-art" aria-hidden="true">
          <svg viewBox="0 0 360 220" fill="none">
            <rect x="18" y="16" width="298" height="177" rx="13" stroke="currentColor" strokeWidth="2" />
            <path d="M18 48h298M43 78v-8h16m216 0h16v8M43 151v16h16m216 0h16v-16" stroke="currentColor" strokeWidth="2" />
            <circle cx="39" cy="32" r="4" fill="var(--brand-yellow)" />
            <path d="M51 32h35m229 157h24m-12-12v24" stroke="var(--brand-yellow)" strokeWidth="3" strokeLinecap="round" />
            <path d="M112 164h-45m31-10H67" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <PracticeMascot pose="default" />
        </div>
      </div>
      {latest && <div className="dashboard-rounds">
        <section aria-labelledby="dashboard-latest">
          <h2 id="dashboard-latest"><Icon name="history" /> รอบซ้อมล่าสุด</h2>
          <ul><FeaturedRound row={latest} /></ul>
        </section>
        <section aria-labelledby="dashboard-active">
          <h2 id="dashboard-active"><Icon name="clock" /> กำลังดำเนินการ</h2>
          {active?.length ? <ul>{active.map((row) => <FeaturedRound key={row.session_id} row={row} />)}</ul>
            : <p className="muted">ไม่มีรอบที่ยังดำเนินการ</p>}
        </section>
      </div>}
      {!rows && <div className="dashboard-history-state">
        {err ? <>
          <Message kind="error">โหลดรายการไม่ได้: {err}</Message>
          <button className="ghost" onClick={() => { setErr(null); setAttempt(attempt + 1); }}><Icon name="refresh" /> ลองใหม่</button>
        </> : <Message>กำลังโหลดประวัติการซ้อม…</Message>}
      </div>}
      {rows && <section className="dashboard-history" aria-labelledby="dashboard-history">
        <div className="section-heading"><h2 id="dashboard-history">ประวัติการซ้อม</h2>
          {rows.length > 0 && <span className="muted small">{rows.length} รอบ</span>}
        </div>
        {rows.length === 0 ? (
          <div className="panel dashboard-empty">
            <span className="state-icon"><Icon name="history" /></span>
            <div><h3>ยังไม่มีรอบซ้อม</h3><p className="muted">เมื่อเริ่มซ้อมแล้ว คุณกลับมาทำต่อหรือเปิดดูผลจากที่นี่ได้</p></div>
          </div>
        ) : (
          <ul className="session-list">
              {rows.map((r) => (
                <li className="session-card" key={r.session_id}>
                  <div className="session-card-heading">
                    <SessionDate row={r} />
                    <div className="badges">
                      {r.source === "mock" && <span className="tag">ตัวอย่าง</span>}
                      <span className={`status ${r.status}`}>{STATUS_LABEL[r.status]}</span>
                    </div>
                  </div>
                  <dl className="session-details">
                    <div><dt>ความยาวคลิป</dt><dd>{r.duration_s != null ? fmtDuration(r.duration_s) : "—"}</dd></div>
                    <div><dt>เวลาเป้าหมาย</dt><dd>{r.target_duration_s != null ? fmtDuration(r.target_duration_s) : "—"}</dd></div>
                    <div><dt>หัวข้อ</dt><dd>{r.topics_count}</dd></div>
                  </dl>
                  <SessionLink row={r} />
                </li>
              ))}
          </ul>
        )}
      </section>}
      {rows && <TrendPanel rows={rows} />}
    </section>
  );
}
