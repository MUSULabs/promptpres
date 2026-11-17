import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import type { FlowStatus, SessionRow } from "../contract";
import { fmtTime } from "../presentation";
import { Icon, Message, PageHeading } from "../components/ui";
import { TrendPanel } from "../components/Trend";

const STATUS_LABEL: Record<FlowStatus, string> = {
  created: "ยังไม่ส่งวิดีโอ", queued: "รอคิว", processing: "กำลังวิเคราะห์", done: "เสร็จ", failed: "ล้มเหลว",
};

/** History of practice sessions, newest first, with a per-criterion level-change panel from 2 finished rounds (D-046; observed change, not skill progress). */
export default function Home() {
  const [rows, setRows] = useState<SessionRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    api.sessions(signal).then((data) => { if (!signal.aborted) setRows(data); })
      .catch((e) => { if (!signal.aborted) setErr(String(e.message)); });
    return () => controller.abort();
  }, [attempt]);

  return (
    <section>
      <PageHeading badge="PromptPre's · การซ้อมนำเสนอ" title="ประวัติการซ้อม"
        action={<Link className="button" to="/new"><Icon name="plus" /> ซ้อมใหม่</Link>}>
        กลับมาดูวิดีโอ ผลรายเกณฑ์ และหลักฐานจากแต่ละรอบซ้อม
      </PageHeading>
      {err && <>
        <Message kind="error">โหลดรายการไม่ได้: {err}</Message>
        <button className="ghost" onClick={() => { setErr(null); setAttempt(attempt + 1); }}><Icon name="refresh" /> ลองใหม่</button>
      </>}
      {!rows && !err && <Message>กำลังโหลดประวัติการซ้อม…</Message>}
      {rows && rows.length === 0 && (
        <div className="panel empty-state">
          <span className="state-icon"><Icon name="history" /></span>
          <h2>เริ่มต้นการซ้อมนำเสนอครั้งแรกของคุณ</h2>
          <p className="muted">หลังส่งวิดีโอ คุณสามารถกลับมาดูสถานะและผลของแต่ละรอบได้ที่นี่</p>
          <Link className="button" to="/new"><Icon name="plus" /> เริ่มรอบซ้อม</Link>
        </div>
      )}
      {rows && rows.length > 0 && (
        <>
          <TrendPanel rows={rows} />
          <div className="section-heading"><h2>รอบซ้อมล่าสุด</h2><span className="tag">{rows.length} รายการ</span></div>
          <ul className="session-list">
            {rows.map((r) => (
              <li className="session-card" key={r.session_id}>
                <div className="session-card-heading">
                  <time dateTime={r.created_at}>{new Date(r.created_at).toLocaleString("th-TH")}</time>
                  <div className="badges">
                    {r.source === "mock" && <span className="tag">ตัวอย่าง</span>}
                    <span className={`status ${r.status}`}>{STATUS_LABEL[r.status]}</span>
                  </div>
                </div>
                <dl className="session-details">
                  <div><dt>ความยาวคลิป</dt><dd>{r.duration_s != null ? fmtTime(r.duration_s) : "—"}</dd></div>
                  <div><dt>เวลาเป้าหมาย</dt><dd>{r.target_duration_s != null ? fmtTime(r.target_duration_s) : "—"}</dd></div>
                  <div><dt>หัวข้อ</dt><dd>{r.topics_count}</dd></div>
                </dl>
                <Link className="button secondary" to={`/sessions/${r.session_id}${r.status === "created" ? "/video" : ""}`}>
                  {r.status === "created" ? "ทำต่อ" : r.status === "done" ? "ดูผล" : "ดูสถานะ"} <Icon name="arrow" />
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
