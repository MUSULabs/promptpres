import { useRef } from "react";
import type { CoachItem, Result } from "../contract";
import { CRITERION_NAME, fmtTime, splitClocks } from "../presentation";
import { CoachText, type MediaState, type Seek } from "./ResultParts";
import { Icon } from "./ui";

const NOTE_KIND = {
  focus: "สิ่งที่ควรฝึก",
  plan: "แผนฝึกซ้อมรอบถัดไป",
  strength: "จุดที่ทำได้ดี",
} as const;

export function ResultCover({ result, lead, times }: {
  result: Result; lead?: CoachItem; times: ReadonlyArray<readonly [string, number | null | undefined]>;
}) {
  return (
    <header className="notebook-cover">
      <div className="notebook-frame cover-frame">
        <div className="cover-index">
          <h1>ผลการซ้อม</h1>
          <p><time dateTime={result.created_at}>{new Date(result.created_at).toLocaleDateString("th-TH", { dateStyle: "long" })}</time>
            {result.session_id.startsWith("s_mock_") && <span className="cover-demo">ข้อมูลจำลอง</span>}</p>
        </div>
        <section className="cover-message" aria-labelledby="cover-title">
          <h2 id="cover-title">สิ่งที่ควรฝึกต่อ</h2>
          <p className="cover-advice">{lead
            ? splitClocks(lead.text).map((part) => typeof part === "string" ? part : part.label).join("")
            : "เปิดข้อเสนอแนะรายเกณฑ์ เพื่อเลือกสิ่งที่จะซ้อมรอบหน้า"}</p>
          {lead
            ? <a className="cover-action" href="#result-review">เปิดสมุดทบทวน <Icon name="chevronDown" /></a>
            : <a className="cover-action" href="#result-criteria">ดูผลทั้ง 8 เกณฑ์ <Icon name="chevronDown" /></a>}
        </section>
        <dl className="result-times cover-times">
          {times.map(([label, value]) => <div key={label}>
            <dt>{label}</dt><dd>{value == null ? "—" : fmtTime(value)}</dd>
          </div>)}
        </dl>
        <svg className="cover-mark" viewBox="0 0 490 340" fill="none" aria-hidden="true" focusable="false">
          <g stroke="#d6d6ff" opacity=".32">
            <path d="M39 20v291h433M39 253h433M39 197h433M39 141h433M39 85h433M127 20v291M215 20v291m88-291v291m88-291v291" />
            <path d="M39 315v10m44-10v6m44-6v10m44-10v6m44-6v10m44-10v6m44-6v10m44-10v6m44-6v10m44-10v6" />
          </g>
          <path className="cover-ink" pathLength="1" d="M8 280c58 5 105-18 163-62 55-42 115-94 181-98 47-3 72 14 56 44-22 41-110 68-167 45-41-17-39-59 1-93 45-38 137-55 232-48"
            stroke="#cfceff" strokeWidth="3" strokeLinecap="round" strokeDasharray="1" />
          <path d="M242 116v195m110-191v191" stroke="#fff" strokeDasharray="3 5" opacity=".62" />
          <g fill="#2823ef" stroke="#fff" strokeWidth="2"><circle cx="242" cy="116" r="7" /><circle cx="352" cy="120" r="7" /></g>
        </svg>
      </div>
    </header>
  );
}

export function CoachNotes({ notes, active, select, media, seek }: {
  notes: CoachItem[]; active?: CoachItem; select: (note: CoachItem) => void; media: MediaState; seek: Seek;
}) {
  const noteText = useRef<HTMLParagraphElement>(null);
  return (
    <section className="notebook-notes" aria-labelledby="notes-title">
      <header className="notes-header">
        <h3 id="notes-title">โน้ตจากโค้ช</h3>
        {notes.length > 0 && <span>AI Coach</span>}
      </header>
      {active && <>
        <div className="note-sheet">
          <div className="note-source">{active.code && <span>{active.code}</span>}
            <p>{active.code ? CRITERION_NAME[active.code] : NOTE_KIND[active.kind]}</p>
          </div>
          <p ref={noteText} className="note-text" tabIndex={-1}><CoachText text={active.text} media={media}
            seek={(seconds) => seek(seconds, active.code ?? undefined)} /></p>
        </div>
        {notes.length > 1 && <ul className="note-index" aria-label="เลือกโน้ต">
          {notes.map((note, i) => <li key={i}>
            <button type="button" aria-pressed={active === note} onClick={() => {
              select(note);
              requestAnimationFrame(() => noteText.current?.focus());
            }}>
              <span>{note.cite_s.length > 0 ? fmtTime(note.cite_s[0]) : <Icon name="document" />}</span>
              <span><strong>{note.code ? CRITERION_NAME[note.code] : NOTE_KIND[note.kind]}</strong>
                <small>{note.code ? NOTE_KIND[note.kind] : null}</small></span>
              <Icon name="arrow" />
            </button>
          </li>)}
        </ul>}
      </>}
      {!active && <p className="note-sheet">เปิดช่วงหลักฐานจากเส้นเวลา หรืออ่านข้อเสนอแนะในผลรายเกณฑ์</p>}
    </section>
  );
}
