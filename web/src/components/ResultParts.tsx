// Building blocks of the result page (D-046 layers 2 and 3). No thresholds or feedback text here:
// level bands and interpretation words come from the API (config/), coach text from the worker.
import type { Coach, CoachKind, Criterion, CriterionMeta } from "../contract";
import { CRITERION_NAME, fmtTime, splitClocks } from "../presentation";
import { Icon } from "./ui";

export type Seek = (seconds: number) => void;
export type MediaState = "loading" | "ready" | "unavailable";

export function TimeChip({ start, end, media, seek, label: text }: {
  start: number; end?: number; media: MediaState; seek: Seek; label?: string;
}) {
  const label = text ?? (end == null ? fmtTime(start) : `${fmtTime(start)} – ${fmtTime(end)}`);
  return media === "ready" ? <button type="button" className="time" aria-label={`ไปยังเวลา ${label}`}
    onClick={() => seek(start)}><Icon name="clock" /> {label}</button> : (
    <span className="time time-unavailable"><Icon name="clock" /> {label}
      <span className="sr-only"> ({media === "loading" ? "วิดีโอยังไม่พร้อม" : "กระโดดเวลาไม่ได้"})</span>
    </span>
  );
}

/** Coach text with every [m:ss] turned into a ▶ m:ss button that seeks the video. */
function CoachText({ text, media, seek }: { text: string; media: MediaState; seek: Seek }) {
  return <>{splitClocks(text).map((part, i) => typeof part === "string" ? <span key={i}>{part}</span>
    : media === "ready" ? <button key={i} type="button" className="time coach-time"
      aria-label={`ไปยังเวลา ${part.label} ที่โค้ชอ้าง`} onClick={() => seek(part.seconds)}><Icon name="play" /> {part.label}</button>
      : <span key={i} className="time time-unavailable"><Icon name="clock" /> {part.label}</span>)}</>;
}

const COACH_SECTIONS: [CoachKind, string][] = [
  ["focus", "สิ่งที่ควรปรับเพิ่มเติม"], ["plan", "แผนฝึกซ้อมรอบถัดไป"], ["strength", "จุดที่ทำได้ดี"],
];

/** Surface the first suggested adjustment and keep the rest of the coach advice expandable. */
export function CoachPanel({ coach, media, seek }: { coach: Coach | null; media: MediaState; seek: Seek }) {
  const items = coach?.status === "ok" ? coach.items : [];
  const lead = items.find((item) => item.kind === "focus") ?? items.find((item) => item.kind === "plan");
  const remaining = items.filter((item) => item !== lead);
  const evidenceLink = <a className={lead ? "button" : "button secondary"} href="#result-evidence">
    <Icon name="video" /> {media === "unavailable" ? "ดูหลักฐาน" : "ดูวิดีโอและหลักฐาน"}
  </a>;
  const criteriaLink = <a className={lead ? "coach-link" : "button"} href="#result-criteria">
    ดูผลทั้ง 8 เกณฑ์
  </a>;

  return (
    <section className="panel coach" aria-labelledby="coach-title">
      <div className="coach-heading">
        <h2 id="coach-title">สิ่งที่ควรฝึกต่อ</h2>
        {items.length > 0 && <span className="muted small">AI Coach</span>}
      </div>
      {lead ? <div className="coach-lead">
        {lead.code && <strong><span className="coach-code">{lead.code}</span> {CRITERION_NAME[lead.code]}</strong>}
        <p><CoachText text={lead.text} media={media} seek={seek} /></p>
      </div> : <p>เปิดข้อเสนอแนะรายเกณฑ์เพื่อเลือกสิ่งที่จะลองปรับในการซ้อมครั้งถัดไป</p>}

      <div className="row result-jump-links">
        {lead ? <>{evidenceLink}{criteriaLink}</> : <>{criteriaLink}{evidenceLink}</>}
      </div>

      {remaining.length > 0 && <details className="disclosure coach-more">
        <summary>ดูคำแนะนำที่เหลือ <Icon name="chevronDown" /></summary>
        <div className="coach-groups">
          {COACH_SECTIONS.map(([kind, label]) => {
            const group = remaining.filter((item) => item.kind === kind);
            return group.length > 0 && <section key={kind} className="coach-group">
              <h3>{label}</h3>
              <ul>{group.map((item, i) => <li key={i}>
                {item.code && <strong>{item.code} </strong>}
                <CoachText text={item.text} media={media} seek={seek} />
              </li>)}</ul>
            </section>;
          })}
        </div>
      </details>}
    </section>
  );
}

/** The level the worker gave, placed on a 4-step band (1 = left, 4 = right). Never a total score. */
export function LevelBand({ level }: { level: 1 | 2 | 3 | 4 | null }) {
  const label = level == null ? "วิเคราะห์ไม่ได้ ไม่มีระดับ" : `ระดับ ${level} จาก 4`;
  return (
    <div className={`level-band${level == null ? " band-na" : ""}`} role="img" aria-label={label}>
      {[1, 2, 3, 4].map((step) => <span key={step} className={`band-step band-${step}${step === level ? " on" : ""}`}>
        {step}
      </span>)}
    </div>
  );
}

/** Short reading of a card: the interpret word for its level, plus slow/fast (range) or over/under (sign). */
export function readCard(c: Criterion, meta?: CriterionMeta): { word: string; detail?: string; explain?: string } | null {
  const interpret = meta?.interpret;
  if (!interpret || c.status !== "ok" || c.level == null) return null;
  const word = interpret.levels[String(c.level)] ?? "";
  let detail: string | undefined;
  const key = meta?.scored_values[0];
  const band = key ? meta?.levels?.["4"]?.[key] : undefined;
  const value = key ? c.values[key] : null;
  if (interpret.range && Array.isArray(band) && value != null) {
    const [low, high] = band;
    detail = value < low ? interpret.range.below : value > high ? interpret.range.above : interpret.range.within;
  }
  const signed = interpret.sign ? c.values[interpret.sign.key] : null;
  if (interpret.sign && signed != null && signed !== 0) detail = signed > 0 ? interpret.sign.above : interpret.sign.below;
  return { word, detail, explain: interpret.explain };
}
