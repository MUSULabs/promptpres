/* Badges for practice BEHAVIOUR only (owner, 23 Nov 2026): how often, how long, how prepared.
   No badge is ever given for a result level, so badges never push anyone to "chase" a level. */
import type { SessionRow } from "@/contract";
import { countsAsPractice, stageLights, MAX_LIGHTS } from "./streak";

export type BadgeId = "first" | "weeks3" | "fullStage" | "rounds10" | "hour" | "planner" | "ready" | "comeback";

export interface Badge { id: BadgeId; title: string; desc: string; have: number; goal: number; earned: boolean }

const DAY = 864e5;

export function badges(rows: SessionRow[], now: Date, presentDay?: Date): Badge[] {
  const sent = rows.filter(countsAsPractice);
  const stage = stageLights(rows, now);
  const minutes = Math.round(sent.reduce((s, r) => s + (r.duration_s ?? 0), 0) / 60);
  const withTopics = sent.filter((r) => (r.topics_count ?? 0) > 0).length;
  const beforeDay = presentDay
    ? sent.filter((r) => { const t = new Date(r.created_at).getTime(); return t < presentDay.getTime() && t >= presentDay.getTime() - 14 * DAY; }).length
    : 0;
  const list: Omit<Badge, "earned">[] = [
    { id: "first", title: "ก้าวแรกบนเวที", desc: "ส่งรอบซ้อมรอบแรก", have: Math.min(1, sent.length), goal: 1 },
    { id: "weeks3", title: "ไฟติด 3 สัปดาห์", desc: "ซ้อมทุกสัปดาห์ 3 สัปดาห์ติดกัน", have: Math.min(3, stage.best), goal: 3 },
    { id: "fullStage", title: "เวทีสว่างเต็ม", desc: `จุดไฟเวทีครบ ${MAX_LIGHTS} ดวง`, have: stage.maxLights, goal: MAX_LIGHTS },
    { id: "rounds10", title: "ซ้อมครบ 10 รอบ", desc: "ส่งรอบซ้อมรวม 10 รอบ", have: Math.min(10, sent.length), goal: 10 },
    { id: "hour", title: "ชั่วโมงบนเวที", desc: "รวมเวลาคลิปซ้อม 60 นาที", have: Math.min(60, minutes), goal: 60 },
    { id: "planner", title: "นักวางแผน", desc: "ใส่หัวข้อจากรายงานก่อนซ้อม 3 รอบ", have: Math.min(3, withTopics), goal: 3 },
    { id: "ready", title: "พร้อมก่อนวันจริง", desc: "ซ้อม 3 รอบภายใน 14 วันก่อนวันพรีเซนต์", have: Math.min(3, beforeDay), goal: 3 },
    { id: "comeback", title: "กลับมาสู้", desc: "กลับมาซ้อมหลังหายไปทั้งสัปดาห์", have: stage.comeback ? 1 : 0, goal: 1 },
  ];
  return list.map((b) => ({ ...b, earned: b.have >= b.goal }));
}
