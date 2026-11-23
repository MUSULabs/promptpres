/* Demo state shared by the lab pages: a fixed "today", three practice histories for the stage lights,
   bell notifications, and the presentation-day plan. Synthetic only. */
import { useMemo } from "react";
import type { CriterionCode, SessionRow } from "@/contract";
import { compatibleRubric, doneRuns } from "@/trend";
import type { ShareData } from "@/v2/ShareCard";
import { countsAsPractice, stageLights, type StageState } from "@/v2/streak";
import type { Note } from "@/v2/Notifications";
import { DEFAULT_NAME, PREF, readPref, usePref } from "@/v2/prefs";
import { HISTORY } from "./fixtures";

export const LAB_NOW = new Date("2026-11-23T16:00:00+07:00"); // fixed so the demo always looks the same (a Monday)

export type Scenario = "steady" | "away" | "new";
export const SCENARIOS: { key: Scenario; label: string }[] = [
  { key: "steady", label: "ซ้อมสม่ำเสมอ" },
  { key: "away", label: "หายไป 2 สัปดาห์" },
  { key: "new", label: "ผู้ใช้ใหม่" },
];

export function historyFor(s: Scenario): SessionRow[] {
  if (s === "new") return [];
  if (s === "away") return HISTORY.filter((r) => r.created_at < "2026-11-05");
  return HISTORY;
}

const DAY = 864e5;
/** Every date on screen goes through here: Thai calendar (2569), Thai time zone whatever the device says. */
export const thDate = (d: Date | string, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }) =>
  new Date(d).toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok", ...opts });

/** One list of target-time presets for the whole app (minutes). */
export const TARGET_PRESETS = [5, 10, 15, 20] as const;

/** The real presentation day the user set (browser storage), or 10 days from "today" for the demo. */
export function presentDay(): Date {
  const saved = readPref(PREF.presentDay);
  const d = saved ? new Date(`${saved}T09:00:00+07:00`) : new Date(LAB_NOW.getTime() + 10 * DAY);
  return Number.isNaN(d.getTime()) ? new Date(LAB_NOW.getTime() + 10 * DAY) : d;
}

export function daysUntil(day: Date, now = LAB_NOW) {
  const a = Math.floor((now.getTime() + 7 * 3600e3) / DAY), b = Math.floor((day.getTime() + 7 * 3600e3) / DAY);
  return b - a;
}

/** Suggested rehearsal days before the real one: about one every 3 days, at most 4, the last one the day before. */
export function practicePlan(day: Date, now = LAB_NOW): Date[] {
  const left = daysUntil(day, now);
  if (left <= 0) return [];
  if (left === 1) return [new Date(now)];
  const n = Math.min(4, Math.max(1, Math.ceil((left - 1) / 3)));
  return Array.from({ length: n }, (_, i) => new Date(now.getTime() + Math.round(((i + 1) * (left - 1)) / n) * DAY));
}

export function notesFor(stage: StageState, rows: SessionRow[]): Note[] {
  const notes: Note[] = [];
  const done = rows.find((r) => r.status === "done");
  if (rows.some((r) => r.status === "processing")) notes.push({ id: "n-processing", kind: "info", title: "รอบซ้อม 23 พ.ย. 15:02 น. กำลังวิเคราะห์", body: "ปิดหน้าเว็บได้ ผลออกแล้วจะแจ้งตรงนี้", when: "เมื่อสักครู่", to: "/lab/waiting" });
  if (done) notes.push({ id: `n-result-${done.session_id}`, kind: "result", title: `ผลรอบซ้อม ${thDate(done.created_at)} ออกแล้ว`, body: "ดูระดับ 8 เกณฑ์และหลักฐานในวิดีโอ", when: "1 ชั่วโมงที่แล้ว", to: `/lab/result?id=${done.session_id}` });
  if (stage.atRisk) notes.push({ id: `n-risk-${stage.weeks.at(-1)?.week}`, kind: "stage", title: `ซ้อมภายใน ${stage.daysLeft} วันเพื่อรักษาไฟเวที`, body: "ถ้าไม่ซ้อมเลยทั้งสัปดาห์ ไฟจะหรี่ลง 1 ดวง", when: "วันนี้", to: "/lab/new" });
  else if (stage.practicedThisWeek) notes.push({ id: `n-lit-${stage.weeks.at(-1)?.week}`, kind: "stage", title: `ไฟเวทีสัปดาห์นี้ติดแล้ว (${stage.lights}/5)`, body: stage.streak > 1 ? `ซ้อมติดต่อกัน ${stage.streak} สัปดาห์` : undefined, when: "วันนี้", to: "/lab/dashboard" });
  const left = daysUntil(presentDay());
  if (left > 0) notes.push({ id: `n-day-${left}`, kind: "day", title: `อีก ${left} วันถึงวันพรีเซนต์จริง`, body: "ดูแผนซ้อมที่แนะนำ", when: "วันนี้", to: "/lab/new#day" });
  return notes;
}

/** Stage lights + bell for any Shell page in the lab. */
export function useLabShell(s: Scenario = "steady") {
  const [day] = usePref(PREF.presentDay, ""); // recount "N days to go" in the bell when the day changes
  return useMemo(() => {
    const rows = historyFor(s);
    const stage = stageLights(rows, LAB_NOW);
    return { stage, notes: notesFor(stage, rows) };
  }, [s, day]); // eslint-disable-line react-hooks/exhaustive-deps
}

/* ---------- Month summary (recap slides, share card) ---------- */

const CODES8: CriterionCode[] = ["C1", "C2", "S1", "S2", "S3", "N1", "N2", "T1"];
const thParts = (d: Date) => { const x = new Date(d.getTime() + 7 * 3600e3); return { y: x.getUTCFullYear(), m: x.getUTCMonth(), day: x.getUTCDate(), wd: x.getUTCDay(), h: x.getUTCHours() }; };
const WEEKDAY = ["วันอาทิตย์", "วันจันทร์", "วันอังคาร", "วันพุธ", "วันพฤหัสบดี", "วันศุกร์", "วันเสาร์"];
const SLOT = (h: number) => (h >= 5 && h < 12 ? "ช่วงเช้า" : h < 17 ? "ช่วงบ่าย" : h < 21 ? "ช่วงหัวค่ำ" : "ช่วงดึก");
const top = <T,>(xs: T[]) => { const c = new Map<T, number>(); xs.forEach((x) => c.set(x, (c.get(x) ?? 0) + 1)); return [...c.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]; };

export function monthSummary(rows: SessionRow[], now = LAB_NOW) {
  const n = thParts(now);
  const sent = rows.filter((r) => countsAsPractice(r) && (({ y, m }) => y === n.y && m === n.m)(thParts(new Date(r.created_at))));
  const done = doneRuns(sent); // oldest first
  const first = done[0], last = done.at(-1);
  const cmp = first && last && first !== last && compatibleRubric(first.rubric_version, last.rubric_version)
    ? CODES8.filter((c) => first.levels?.[c] != null && last.levels?.[c] != null && last.levels![c]! > first.levels![c]!) : [];
  return {
    label: thDate(now, { month: "long", year: "numeric" }),
    rounds: sent.length,
    minutes: Math.round(sent.reduce((s, r) => s + (r.duration_s ?? 0), 0) / 60),
    days: [...new Set(sent.map((r) => thParts(new Date(r.created_at)).day))].sort((a, b) => a - b),
    daysInMonth: new Date(Date.UTC(n.y, n.m + 1, 0)).getUTCDate(),
    today: n.day,
    topWeekday: top(sent.map((r) => WEEKDAY[thParts(new Date(r.created_at)).wd])),
    topSlot: top(sent.map((r) => SLOT(thParts(new Date(r.created_at)).h))),
    first, last, higher: cmp,
  };
}

export function shareDataFor(rows: SessionRow[]): ShareData {
  const s = monthSummary(rows), stage = stageLights(rows, LAB_NOW);
  return { title: s.label, name: readPref(PREF.name) ?? DEFAULT_NAME, rounds: s.rounds, minutes: s.minutes, lights: stage.lights, streak: stage.streak, levels: s.last?.levels ?? null };
}
