/* Synthetic data for the dev-only /lab prototypes. Invented project, invented words — no participant data.
   Shapes follow src/contract.ts (Result Contract 1.3); texts for feedback/interpret are copied from config/feedback-v0.yaml. */
import type { CriterionCode, CriteriaMeta, Result, SessionRow, TranscriptItem } from "@/contract";

const D = 612; // clip seconds

export const RESULT: Result = {
  contract_version: "1.3",
  session_id: "s_lab_demo",
  status: "done",
  created_at: "2026-11-23T14:20:00+07:00",
  duration_s: D,
  target_duration_s: 600,
  video_url: null,
  versions: { rubric: "0.9", asr: "lab", llm: "lab", prompt: "coach-v2", config: "lab" },
  criteria: [
    { code: "C1", skill: "content", status: "ok", level: 3, values: { kendall_tau: 0.67, topics_ordered: 4, concordant_pairs: 5, swapped_pairs: 1 },
      evidence: [{ start_s: 14, end_s: 16, note: "เริ่มหัวข้อ ที่มาและปัญหา" }, { start_s: 330, end_s: 332, note: "หัวข้อ วิธีดำเนินการ มาก่อน งานที่เกี่ยวข้อง" }], feedback_id: "C1_L3", reason: null },
    { code: "C2", skill: "content", status: "ok", level: 3, values: { coverage_clear_pct: 80, clear: 4, brief: 0, not_mentioned: 1, topics_total: 5, quotes_rejected: 0 },
      evidence: [{ start_s: 14, end_s: 70, note: "ที่มาและปัญหา" }, { start_s: 120, end_s: 190, note: "วัตถุประสงค์" }, { start_s: 330, end_s: 350, note: "วิธีดำเนินการ" }, { start_s: 352, end_s: 400, note: "งานที่เกี่ยวข้อง" }], feedback_id: "C2_L3", reason: null },
    { code: "S1", skill: "speech", status: "ok", level: 3, values: { syllables_per_s: 6.3, articulation_time_s: 488 },
      evidence: [{ start_s: 402, end_s: 432, note: "ช่วงที่พูดเร็วที่สุด 7.1 พยางค์/วินาที" }], feedback_id: "S1_L3", reason: null },
    { code: "S2", skill: "speech", status: "ok", level: 2, values: { long_pauses_per_min: 2.9, max_pause_s: 5.1, long_pauses: 30 },
      evidence: [44, 118, 121, 196, 262, 265, 331, 390, 455, 520, 561].map((s, i) => ({ start_s: s, end_s: s + (i === 4 ? 5.1 : 2.4 + (i % 3) * 0.6), note: i === 4 ? "หยุด 5.1 วินาที (นานสุด)" : "หยุดยาว" })), feedback_id: "S2_L2", reason: null },
    { code: "S3", skill: "speech", status: "ok", level: 2, values: { fillers_per_min: 6.8, fillers: 69 },
      evidence: [22, 31, 58, 61, 63, 117, 160, 163, 199, 255, 259, 262, 300, 333, 335, 389, 392, 470, 476, 500, 540, 545, 590].map((s, i) => ({ start_s: s, end_s: s + 0.6, note: null, label: ["เอ่อ", "อ่า", "แบบว่า", "อืม", "ก็คือ"][i % 5] })), feedback_id: "S3_L2", reason: null },
    { code: "N1", skill: "body", status: "ok", level: 3, values: { long_still_per_min: 0.6, max_still_s: 18, hands_active_pct: 48, hands_visible_pct: 88 },
      evidence: [{ start_s: 210, end_s: 228, note: "มือนิ่ง 18 วินาที" }, { start_s: 470, end_s: 486, note: "มือนิ่ง 16 วินาที" }], feedback_id: "N1_L3", reason: null },
    { code: "N2", skill: "body", status: "ok", level: 4, values: { front_pct: 86, side_pct: 8, down_pct: 4, up_other_pct: 2, face_visible_pct: 97 },
      evidence: [{ start_s: 300, end_s: 309, note: "ก้มดูโน้ต 9 วินาที" }], feedback_id: "N2_L4", reason: null },
    { code: "T1", skill: "time", status: "ok", level: 3, values: { speech_span_s: 561, deviation_pct: 6.5, target_s: 600, diff_s: -39 },
      evidence: [{ start_s: 8, end_s: 569, note: "ช่วงนำเสนอ 9:21" }], feedback_id: "T1_L3", reason: null },
  ],
  topics: [
    { id: "t1", title: "ที่มาและปัญหา", order: 1, coverage: "clear", first_mention_s: 14, evidence_quote: "นักศึกษาหลายคนเลือกเมนูไม่ถูกเพราะไม่รู้สารอาหาร" },
    { id: "t2", title: "วัตถุประสงค์", order: 2, coverage: "clear", first_mention_s: 120, evidence_quote: "เป้าหมายคือแนะนำเมนูที่เหมาะกับเป้าหมายสุขภาพ" },
    { id: "t3", title: "งานที่เกี่ยวข้อง", order: 3, coverage: "clear", first_mention_s: 352, evidence_quote: "มีแอปคล้ายกันอยู่บ้าง แต่ยังไม่มีข้อมูลเมนูของโรงอาหารในมหาวิทยาลัย" },
    { id: "t4", title: "วิธีดำเนินการ", order: 4, coverage: "clear", first_mention_s: 330, evidence_quote: "เราเก็บข้อมูลเมนูจากโรงอาหารสามแห่ง" },
    { id: "t5", title: "ผลการทดลอง", order: 5, coverage: "not_mentioned", first_mention_s: null, evidence_quote: null },
  ],
  coach: {
    status: "ok", hidden_count: 0,
    items: [
      { kind: "strength", code: "N2", text: "หันหน้าเข้าหากล้องเกือบตลอด ผู้ชมเห็นใบหน้าชัดเจน", cite_s: [] },
      { kind: "strength", code: "C1", text: "เรียงหัวข้อตามแผนเกือบทั้งหมด เริ่มจากที่มาได้ชัดที่ [0:14]", cite_s: [14] },
      { kind: "focus", code: "S2", text: "หยุดเงียบ 5.1 วินาทีที่ [4:22] ตอนเปลี่ยนหัวข้อ ลองเตรียมประโยคเชื่อมไว้ล่วงหน้า", cite_s: [262] },
      { kind: "focus", code: "S3", text: "เสียงเติมถี่ช่วง [4:15] ถึง [4:22] ลองหยุดเงียบครึ่งวินาทีแทนคำว่า เอ่อ", cite_s: [255, 262] },
      { kind: "plan", code: "C2", text: "เพิ่มหัวข้อ ผลการทดลอง อย่างน้อย 2 ประโยค แล้วซ้อมช่วงเปลี่ยนหัวข้อ 2 รอบ", cite_s: [] },
      { kind: "plan", code: "S2", text: "ซ้อมช่วง [4:15] ถึง [4:30] ซ้ำจนพูดต่อได้โดยไม่ต้องหยุดนึก", cite_s: [255] },
    ],
  },
  error: null,
};

/** Same round, but with one criterion the system could not analyse (to show that state). */
export const RESULT_PARTIAL: Result = {
  ...RESULT,
  session_id: "s_lab_partial",
  criteria: RESULT.criteria.map((c) => c.code === "N1"
    ? { ...c, status: "unanalyzable", level: null, values: { hands_visible_pct: 31 }, evidence: [], feedback_id: null, reason: "เห็นมือเพียง 31% ของเวลา ต้องเห็นอย่างน้อย 70% จึงจะวิเคราะห์ได้" }
    : c),
};

/** Levels of the previous finished round (same rubric), for the ↑ / = / ↓ badges. */
export const PREVIOUS_LEVELS: Partial<Record<CriterionCode, number | null>> = { C1: 2, C2: 3, S1: 3, S2: 2, S3: 1, N1: 2, N2: 4, T1: 2 };

export const META: CriteriaMeta = {
  C1: { scored_values: ["kendall_tau"], direction: "higher", interpret: { explain: "τ (Kendall's tau) บอกว่าลำดับที่พูดจริงตรงกับแผนแค่ไหน: 1 = ตรงทุกคู่, 0 = ไม่สัมพันธ์กัน, −1 = กลับลำดับทั้งหมด", levels: { 4: "เรียงตรงตามแผน", 3: "เรียงตามแผนเกือบทั้งหมด", 2: "สลับลำดับบางส่วน", 1: "ลำดับต่างจากแผนมาก" } } },
  C2: { scored_values: ["coverage_clear_pct"], direction: "higher", interpret: { explain: "% ของหัวข้อตามแผนที่อธิบายสาระชัดเจน (หัวข้อที่กล่าวถึงเพียงสั้น ๆ นับครึ่ง)", levels: { 4: "อธิบายครบเกือบทุกหัวข้อ", 3: "อธิบายครบเป็นส่วนใหญ่", 2: "ขาดไปราวครึ่งหนึ่ง", 1: "ขาดหัวข้อส่วนใหญ่" } } },
  S1: { scored_values: ["syllables_per_s"], direction: "range", levels: { "4": { syllables_per_s: [4.0, 6.0] } }, interpret: { explain: "จำนวนพยางค์ต่อวินาที นับเฉพาะช่วงที่พูดจริง ไม่รวมช่วงหยุดและเสียงเติม (เอ่อ อ่า อืม)", levels: { 4: "ความเร็วพอดี", 3: "ใกล้ช่วงที่เหมาะ", 2: "ออกนอกช่วงที่เหมาะ", 1: "ต่างจากช่วงที่เหมาะมาก" }, range: { below: "ช้ากว่าช่วงแนะนำ", within: "อยู่ในช่วงแนะนำ", above: "เร็วกว่าช่วงแนะนำ" } } },
  S2: { scored_values: ["long_pauses_per_min", "max_pause_s"], direction: "lower", interpret: { explain: "จำนวนครั้งต่อนาทีที่เงียบนานเกินเกณฑ์ และช่วงเงียบที่นานที่สุด", levels: { 4: "แทบไม่มีช่วงเงียบยาว", 3: "มีช่วงเงียบยาวบ้าง", 2: "เงียบยาวค่อนข้างบ่อย", 1: "เงียบยาวบ่อยมาก" } } },
  S3: { scored_values: ["fillers_per_min"], direction: "lower", interpret: { explain: "จำนวนเสียงเติมและคำติดปากตามบริบทต่อนาที เช่น เอ่อ แบบว่า; คำปกติในประโยคไม่นับ", levels: { 4: "เสียงเติมและคำติดปากน้อยมาก", 3: "มีเสียงเติมและคำติดปากบ้าง", 2: "เสียงเติมและคำติดปากค่อนข้างบ่อย", 1: "เสียงเติมและคำติดปากบ่อยมาก" } } },
  N1: { scored_values: ["long_still_per_min", "max_still_s"], direction: "lower", interpret: { explain: "วัดความต่อเนื่องของการขยับมือและช่วงมือนิ่งค้าง จากความเร็วข้อมือเทียบความกว้างไหล่ (ไม่ตีความความหมายของท่ามือ)", levels: { 4: "ใช้มือประกอบต่อเนื่อง", 3: "มือนิ่งค้างบ้าง", 2: "มือนิ่งค้างหลายช่วง", 1: "มือนิ่งค้างนานมาก" } } },
  N2: { scored_values: ["front_pct"], direction: "higher", interpret: { explain: "วัดทิศทางศีรษะที่หันเข้าหากล้อง/ผู้ฟัง รายงาน % เวลาที่หันตรง ไม่ใช่การสบตา", levels: { 4: "หันหน้าเข้าหากล้องเกือบตลอด", 3: "หันหน้าเข้าหากล้องเป็นส่วนใหญ่", 2: "หันข้างหรือก้มค่อนข้างมาก", 1: "หันหน้าเข้าหากล้องน้อย" } } },
  T1: { scored_values: ["deviation_pct"], direction: "lower", interpret: { explain: "% ที่ช่วงนำเสนอจริงต่างจากเวลาเป้าหมาย (เกินหรือขาดคิดแบบเดียวกัน)", levels: { 4: "ใกล้เวลาเป้าหมายมาก", 3: "ต่างจากเป้าหมายเล็กน้อย", 2: "ต่างจากเป้าหมายพอสมควร", 1: "ต่างจากเป้าหมายมาก" }, sign: { key: "diff_s", above: "ยาวกว่าเวลาเป้าหมาย", below: "สั้นกว่าเวลาเป้าหมาย" } } },
};

export const FEEDBACK: Record<string, string> = {
  C1_L3: "ลำดับส่วนใหญ่ตรงกับแผน มีบางคู่หัวข้อที่สลับกัน ดูจุดเวลาที่ระบบชี้เพื่อหาหัวข้อที่มาก่อนกำหนด แล้วซ้อมช่วงรอยต่อนั้นให้ตามแผน",
  C2_L3: "หัวข้อส่วนใหญ่ถูกอธิบายชัดเจน แต่ยังมีบางหัวข้อที่กล่าวถึงเพียงสั้น ๆ หรือไม่ได้พูดถึง ดูตารางหัวข้อบนการ์ดนี้ แล้วเพิ่มประโยคอธิบายสาระของหัวข้อนั้นอีก 1–2 ประโยค",
  S1_L3: "ความเร็วการพูดใกล้ช่วงที่เหมาะ แต่เร็วหรือช้ากว่าเล็กน้อย ดูคำอธิบายบนการ์ดว่าเร็วหรือช้า แล้วฟังช่วงเวลาที่ระบบชี้เพื่อปรับจังหวะในส่วนนั้น",
  S2_L2: "ช่วงหยุดเงียบยาวเกิดค่อนข้างบ่อยหรือนานหลายวินาที ลองฟังช่วงเวลาที่ระบบชี้ แล้วซ้อมส่วนนั้นซ้ำจนพูดต่อได้โดยไม่ต้องหยุดนึก",
  S3_L2: "เสียงเติมและคำติดปากเกิดค่อนข้างบ่อยจนอาจดึงความสนใจจากเนื้อหา ลองซ้อมช่วงที่ระบบชี้โดยตั้งใจหยุดเงียบครึ่งวินาทีแทนการเปล่งเสียงเติมและคำติดปาก",
  N1_L3: "มีช่วงที่มือนิ่งค้างนานอยู่บ้าง ดูเวลาที่ระบบชี้ แล้วลองใช้มือชี้สไลด์หรือนับประเด็นเมื่อเปลี่ยนเรื่อง",
  N2_L4: "คุณหันหน้าเข้าหากล้องเกือบตลอดเวลา ผู้ชมจึงเห็นใบหน้าชัดเจน รอบหน้ารักษาไว้ และหันไปดูสไลด์เพียงสั้น ๆ เมื่อจำเป็น",
  T1_L3: "เวลานำเสนอต่างจากเป้าหมายเล็กน้อย ดูบนการ์ดว่าเกินหรือขาด แล้วปรับหัวข้อที่ใช้เวลามากหรือน้อยกว่าที่ตั้งใจ 1 หัวข้อ",
};

/* Transcript: invented sentences every ~6 s, fillers at the S3 evidence times, pauses after the S2 evidence times. */
const LINES = [
  "สวัสดีครับ วันนี้กลุ่มเราจะมานำเสนอระบบแนะนำเมนูอาหาร", "เริ่มจากที่มาและปัญหาก่อนนะครับ", "นักศึกษาหลายคนเลือกเมนูไม่ถูกเพราะไม่รู้สารอาหาร",
  "เราเลยสำรวจเพื่อน ๆ ในคณะจำนวนหนึ่ง", "ส่วนใหญ่บอกว่าอยากได้ตัวช่วยตอนเลือกอาหาร", "ต่อไปเป็นวัตถุประสงค์ของโครงงาน",
  "เป้าหมายคือแนะนำเมนูที่เหมาะกับเป้าหมายสุขภาพ", "และต้องใช้ได้ง่ายบนมือถือ", "มีแอปคล้ายกันอยู่บ้าง", "แต่ยังไม่มีข้อมูลเมนูของโรงอาหารในมหาวิทยาลัย",
  "ผลการทดลองเบื้องต้นพบว่าผู้ใช้พอใจ", "ย้อนกลับมาที่วิธีดำเนินการครับ", "เราเก็บข้อมูลเมนูจากโรงอาหารสามแห่ง", "แล้วให้นักโภชนาการช่วยตรวจค่าสารอาหาร",
  "ระบบจะถามเป้าหมายของผู้ใช้ก่อน", "จากนั้นจัดอันดับเมนูที่เหมาะที่สุด", "หน้าจอหลักแสดงเมนูแนะนำสามรายการ", "ผู้ใช้กดดูรายละเอียดสารอาหารได้",
  "เราทดสอบกับเพื่อนในคณะสองสัปดาห์", "สรุปคือระบบช่วยให้เลือกเมนูได้เร็วขึ้น", "ขอบคุณครับ มีคำถามไหมครับ",
];
export const TRANSCRIPT: TranscriptItem[] = (() => {
  const items: TranscriptItem[] = [];
  const fillers = RESULT.criteria.find((c) => c.code === "S3")!.evidence;
  const pauses = RESULT.criteria.find((c) => c.code === "S2")!.evidence;
  let t = 8, li = 0;
  while (t < 604) {
    const f = fillers.find((e) => e.start_s >= t && e.start_s < t + 5.5);
    if (f) items.push({ start_s: f.start_s, end_s: f.end_s, text: f.label ?? "เอ่อ", is_filler: true, pause_after_s: null });
    const p = pauses.find((e) => e.start_s >= t && e.start_s < t + 6);
    const text = LINES[li % LINES.length];
    items.push({ start_s: t, end_s: t + 4.6, text, is_filler: false, pause_after_s: p ? +(p.end_s - p.start_s).toFixed(1) : null });
    t += p ? 6 + (p.end_s - p.start_s) : 6; li++;
  }
  return items.sort((a, b) => a.start_s - b.start_s);
})();

/* History: 9 finished rounds over ~6 weeks + 1 round being analysed. Levels drift up to show the trend (system-measured levels). */
const H: [string, Partial<Record<CriterionCode, number | null>>, number][] = [
  ["2026-10-14T19:10:00+07:00", { C1: 1, C2: 2, S1: 2, S2: 1, S3: 1, N1: 1, N2: 3, T1: 1 }, 455],
  ["2026-10-17T20:05:00+07:00", { C1: 2, C2: 2, S1: 2, S2: 1, S3: 1, N1: null, N2: 3, T1: 2 }, 510],
  ["2026-10-24T18:40:00+07:00", { C1: 2, C2: 2, S1: 3, S2: 2, S3: 1, N1: 1, N2: 3, T1: 2 }, 548],
  ["2026-10-29T21:15:00+07:00", { C1: 2, C2: 3, S1: 3, S2: 2, S3: 2, N1: 2, N2: 3, T1: 2 }, 571],
  ["2026-11-03T19:30:00+07:00", { C1: 3, C2: 2, S1: 3, S2: 2, S3: 1, N1: 2, N2: 4, T1: 3 }, 590],
  ["2026-11-09T20:00:00+07:00", { C1: 3, C2: 3, S1: 4, S2: 3, S3: 2, N1: 2, N2: 4, T1: 3 }, 603],
  ["2026-11-14T17:45:00+07:00", { C1: 2, C2: 3, S1: 3, S2: 2, S3: 2, N1: 3, N2: 4, T1: 4 }, 598],
  ["2026-11-19T19:20:00+07:00", { C1: 2, C2: 3, S1: 3, S2: 2, S3: 1, N1: 2, N2: 4, T1: 2 }, 640],
  ["2026-11-23T14:20:00+07:00", { C1: 3, C2: 3, S1: 3, S2: 2, S3: 2, N1: 3, N2: 4, T1: 3 }, 612],
];
export const HISTORY: SessionRow[] = [
  { session_id: "s_lab_running", status: "processing", created_at: "2026-11-23T15:02:00+07:00", duration_s: 415, target_duration_s: 600, topics_count: 5, source: "session", levels: null, primary_values: null, rubric_version: null },
  ...H.map(([created_at, levels, duration_s], i) => ({
    session_id: i === H.length - 1 ? "s_lab_demo" : `s_lab_${i + 1}`, status: "done" as const, created_at, duration_s, target_duration_s: 600,
    topics_count: 5, source: "session" as const, levels, primary_values: null, rubric_version: "0.9",
  })).reverse(),
];
