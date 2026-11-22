import { Link } from "react-router-dom";
import type { CoachItem, Result } from "../contract";
import { CRITERION_NAME, fmtTime } from "../presentation";
import { CoachText, type MediaState, type Seek } from "./ResultParts";
import { PracticeMascot } from "./PracticeMascot";
import { Icon } from "./ui";

export function ResultCover({ result, times }: {
  result: Result; times: ReadonlyArray<readonly [string, number | null | undefined]>;
}) {
  const available = result.criteria.filter((criterion) => criterion.status === "ok").length;
  const total = result.criteria.length;
  return (
    <header className="notebook-cover">
      <div className="notebook-frame cover-frame">
        <div>
          <div className="cover-index">
            <p><time dateTime={result.created_at}>{new Date(result.created_at).toLocaleDateString("th-TH", { dateStyle: "long" })}</time>
              {result.session_id.startsWith("s_mock_") && <span className="cover-demo">ข้อมูลตัวอย่าง</span>}</p>
          </div>
          <h1>ผลการซ้อม</h1>
          <p className="cover-result-status">{available === total ? "ผลพร้อมดูครบทุกเกณฑ์" : available > 0
            ? "มีผลบางเกณฑ์" : "รอบนี้ไม่มีเกณฑ์ที่วิเคราะห์ได้"}
            <span>วิเคราะห์ได้ {available} จาก {total} เกณฑ์</span>
          </p>
        </div>
        <dl className="result-times cover-times">
          {times.map(([label, value]) => <div key={label}>
            <dt>{label}</dt><dd>{value == null ? "—" : fmtTime(value)}</dd>
          </div>)}
        </dl>
      </div>
    </header>
  );
}

export function CoachNotes({ kind, notes, active, select, media, seek }: {
  kind: "strength" | "focus";
  notes: CoachItem[]; active?: CoachItem; select: (note: CoachItem) => void; media: MediaState; seek: Seek;
}) {
  const heading = kind === "strength" ? "สิ่งที่ทำได้ดี" : "สิ่งที่ควรปรับ";
  return (
    <section className="notebook-notes" aria-labelledby={`notes-${kind}`}>
      <h3 id={`notes-${kind}`}><Icon name={kind === "strength" ? "check" : "document"} /> {heading}</h3>
      {notes.length ? <ul className="note-index">
        {notes.map((note, index) => <li key={index}>
          {note.code && <strong className="note-source">{CRITERION_NAME[note.code]}</strong>}
          <p className="note-text" tabIndex={-1}>
            <CoachText text={note.text} media={media} seek={(seconds) => seek(seconds, note.code ?? undefined)} />
          </p>
          {note.cite_s.length > 0 && <button className="quiet" type="button" aria-pressed={active === note}
            onClick={(event) => {
              select(note);
              (event.currentTarget.previousElementSibling as HTMLElement | null)?.focus();
            }}>
            <Icon name="clock" /><span>เลือกช่วงหลักฐาน<span className="sr-only"> {note.code ? CRITERION_NAME[note.code] : heading}</span></span>
          </button>}
        </li>)}
      </ul> : <p className="muted">{kind === "strength"
        ? "รอบนี้ไม่มีสรุปจุดเด่นจากโค้ช คุณยังอ่านผลรายเกณฑ์ได้"
        : <>รอบนี้ไม่มีสรุปจุดที่ควรปรับจากโค้ช <a href="#result-criteria">เปิดข้อเสนอแนะรายเกณฑ์</a> เพื่อเลือกเรื่องที่จะฝึกต่อ</>}</p>}
    </section>
  );
}

export function NextPractice({ plans, media, seek, hasAvailableResults }: {
  plans: CoachItem[]; media: MediaState; seek: Seek; hasAvailableResults: boolean;
}) {
  return (
    <section className="next-practice" aria-labelledby="next-practice-title">
      <div>
        <h2 id="next-practice-title">เป้าหมายรอบถัดไป</h2>
        {plans.length ? <ul>
          {plans.map((note, index) => <li key={index}><CoachText text={note.text} media={media}
            seek={(seconds) => seek(seconds, note.code ?? undefined)} /></li>)}
        </ul> : <p>{hasAvailableResults ? "เลือกหนึ่งเรื่องจากข้อเสนอแนะรายเกณฑ์ แล้วลองใช้ในรอบถัดไป"
          : "อ่านเหตุผลที่วิเคราะห์ไม่ได้ในผลรายเกณฑ์ แล้วตรวจการตั้งค่ารอบซ้อมก่อนอัดใหม่"}</p>}
        <Link className="button action-yellow" to="/new">เริ่มซ้อมอีกครั้ง <Icon name="arrow" /></Link>
      </div>
      <PracticeMascot className="next-practice-mascot" pose="guiding" />
    </section>
  );
}
