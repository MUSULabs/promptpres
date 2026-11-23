import type { Skill, CriterionCode, Topic } from "./contract";

export const SKILLS: { key: Skill; label: string; codes: CriterionCode[] }[] = [
  { key: "content", label: "เนื้อหา", codes: ["C1", "C2"] },
  { key: "speech", label: "การพูด", codes: ["S1", "S2", "S3"] },
  { key: "body", label: "ภาษากาย", codes: ["N1", "N2"] },
  { key: "time", label: "เวลา", codes: ["T1"] },
];

export const CRITERION_NAME: Record<CriterionCode, string> = {
  C1: "ลำดับหัวข้อเทียบกับแผน", C2: "ความครอบคลุมเชิงความหมาย", S1: "อัตราการพูด", S2: "การหยุดพูดยาว",
  S3: "เสียงเติมและคำติดปาก", N1: "การใช้ท่าทางมือประกอบการพูด", N2: "การหันหน้าสื่อสารกับผู้ฟัง", T1: "เวลาเทียบเป้าหมาย",
};

export const VALUE_LABEL: Record<string, [string, string]> = {
  kendall_tau: ["Kendall's tau", ""],
  coverage_clear_pct: ["ความครอบคลุมหัวข้อ", "%"],
  syllables_per_s: ["ความเร็ว", "พยางค์/วินาที"], articulation_time_s: ["เวลาพูด (ไม่รวมช่วงหยุด)", "วินาที"],
  long_pauses_per_min: ["หยุดยาว", "ครั้ง/นาที"], max_pause_s: ["หยุดนานสุด", "วินาที"],
  fillers_per_min: ["เสียงเติมและคำติดปาก", "ครั้ง/นาที"],
  long_still_per_min: ["ช่วงมือนิ่งต่อเนื่อง", "ครั้ง/นาที"], max_still_s: ["มือนิ่งนานสุด", "วินาที"],
  hands_active_pct: ["มือเคลื่อนไหว", "% ของเวลา"], hands_visible_pct: ["เห็นมือ", "% ของเวลา"],
  front_pct: ["หันตรง", "% ของเวลา"], side_pct: ["หันข้าง", "% ของเวลา"], down_pct: ["ก้ม", "% ของเวลา"],
  face_visible_pct: ["เห็นใบหน้า", "% ของเวลา"],
  speech_span_s: ["ช่วงนำเสนอ", "วินาที"], deviation_pct: ["ต่างจากเวลาเป้าหมาย", "%"],
  topics_ordered: ["หัวข้อที่ใช้ดูลำดับ (อธิบายชัดเจน)", "หัวข้อ"], concordant_pairs: ["คู่ที่เรียงตามแผน", "คู่"],
  swapped_pairs: ["คู่ที่สลับกับแผน", "คู่"],
  clear: ["อธิบายชัดเจน", "หัวข้อ"], brief: ["พูดถึงสั้น ๆ", "หัวข้อ"], not_mentioned: ["ไม่พูดถึง", "หัวข้อ"],
  topics_total: ["หัวข้อในแผน", "หัวข้อ"], quotes_rejected: ["ข้อความอ้างอิงที่ตรวจไม่พบใน transcript", "หัวข้อ"],
  syllables: ["จำนวนพยางค์", "พยางค์"], filler_words: ["เสียงเติมที่ตัดออก", "ครั้ง"],
  long_pauses: ["หยุดยาวทั้งหมด", "ครั้ง"],
  fillers: ["เสียงเติมที่นับ", "ครั้ง"], text_fillers: ["เสียงเติมจากข้อความ", "ครั้ง"],
  acoustic_candidates: ["ช่วงเสียงลากที่อาจเป็นเสียงเติม (ไม่นับ)", "ช่วง"],
  long_still_spans: ["ช่วงมือนิ่งต่อเนื่องทั้งหมด", "ช่วง"],
  up_other_pct: ["เงย/อื่น ๆ", "% ของเวลา"], analysed_s: ["เวลาที่วิเคราะห์", "วินาที"],
  target_s: ["เวลาเป้าหมาย", "วินาที"], diff_s: ["ต่างจากเป้าหมาย", "วินาที"],
};

/** One set of words for C2 topic coverage everywhere (card values, donut, topic table). */
export const COVERAGE_LABEL: Record<Topic["coverage"], string> = {
  clear: "อธิบายชัดเจน", brief: "พูดถึงสั้น ๆ", not_mentioned: "ไม่พูดถึง",
};

export function fmtTime(s: number): string {
  const tenths = Math.round(s * 10);
  const m = Math.floor(tenths / 600);
  return `${m}:${((tenths % 600) / 10).toFixed(1).padStart(4, "0")}`;
}

/** A length of time (clip, speech span, target) -> m:ss rounded to the second: "15:00", not "15:00.0".
 *  Evidence times keep fmtTime's tenths because they point at a moment in the video. */
export function fmtDuration(s: number): string {
  const t = Math.max(0, Math.round(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

/** Seconds -> m:ss (whole seconds), the clock format the AI coach quotes. */
export function fmtClock(s: number): string {
  const t = Math.max(0, Math.floor(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
}

export type ClockPart = string | { seconds: number; label: string };

/** Split coach text at [m:ss] / [mm:ss] (same rule as worker/llm/coach.py CLOCK) so times can become buttons. */
export function splitClocks(text: string): ClockPart[] {
  const parts: ClockPart[] = [];
  const clock = /\[(\d{1,2}):([0-5]\d)\]/g;
  let last = 0;
  for (let m = clock.exec(text); m; m = clock.exec(text)) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const seconds = Number(m[1]) * 60 + Number(m[2]);
    parts.push({ seconds, label: fmtClock(seconds) });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
