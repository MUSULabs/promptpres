// Building blocks of the result page (D-046 layers 2 and 3). No thresholds or feedback text here:
// level bands and interpretation words come from the API (config/), coach text from the worker.
import type { Coach, CoachKind, Criterion, CriterionMeta } from "../contract";
import { fmtTime, splitClocks } from "../presentation";
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
      aria-label={`ไปยังเวลา ${part.label} ที่โค้ชอ้าง`} onClick={() => seek(part.seconds)}>▶ {part.label}</button>
      : <span key={i} className="time time-unavailable">▶ {part.label}</span>)}</>;
}

const COACH_SECTIONS: [CoachKind, string][] = [
  ["strength", "จุดที่ทำได้ดี"], ["focus", "ควรโฟกัสปรับก่อน"], ["plan", "แผนฝึกซ้อมรอบถัดไป"],
];

/** Layer 3: evidence-grounded coach (worker/llm/coach.py). Hidden when the guard rejected it (coach = null). */
export function CoachPanel({ coach, media, seek }: { coach: Coach | null; media: MediaState; seek: Seek }) {
  if (!coach || coach.status !== "ok" || coach.items.length === 0) return null;
  return (
    <section className="panel coach" aria-labelledby="coach-title">
      <div className="section-heading">
        <h2 id="coach-title"><Icon name="sparkles" /> คำแนะนำจาก AI Coach</h2>
        <span className="tag">สรุปจากผลด้านล่าง ไม่เปลี่ยนระดับ</span>
      </div>
      <div className="coach-grid">
        {COACH_SECTIONS.map(([kind, label]) => {
          const items = coach.items.filter((item) => item.kind === kind);
          return items.length > 0 && <div key={kind} className={`coach-col coach-${kind}`}>
            <h3>{label}</h3>
            <ul>{items.map((item, i) => <li key={i}>
              {item.code && <span className="code">{item.code}</span>}{" "}
              <CoachText text={item.text} media={media} seek={seek} />
            </li>)}</ul>
          </div>;
        })}
      </div>
      <p className="muted small">ข้อความสร้างโดยแบบจำลองภาษาและผ่านการตรวจว่าเวลาที่อ้างตรงกับหลักฐานจริง</p>
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
