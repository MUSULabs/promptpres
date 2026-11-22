// Building blocks of the result page (D-046 layers 2 and 3). No thresholds or feedback text here:
// level bands and interpretation words come from the API (config/), coach text from the worker.
import type { Criterion, CriterionCode, CriterionMeta } from "../contract";
import { fmtTime, splitClocks } from "../presentation";
import { Icon } from "./ui";

export type Seek = (seconds: number, code?: CriterionCode) => void;
export type EvidencePoint = { seconds: number; code?: CriterionCode };
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
export function CoachText({ text, media, seek }: { text: string; media: MediaState; seek: Seek }) {
  return <>{splitClocks(text).map((part, i) => typeof part === "string" ? <span key={i}>{part}</span>
    : media === "ready" ? <button key={i} type="button" className="time coach-time"
      aria-label={`ไปยังเวลา ${part.label} ที่โค้ชอ้าง`} onClick={() => seek(part.seconds)}><Icon name="play" /> {part.label}</button>
      : <span key={i} className="time time-unavailable"><Icon name="clock" /> {part.label}</span>)}</>;
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
