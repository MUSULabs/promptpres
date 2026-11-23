/* Dates on screen, the presentation-day plan and the month summary. Everything is counted in Thai time,
   whatever time zone the device says. */
import type { CriterionCode, SessionRow } from "@/contract";
import { compatibleRubric, doneRuns } from "@/trend";
import type { ShareData } from "./ShareCard";
import { countsAsPractice, stageLights } from "./streak";
import { PREF, readPref } from "./prefs";

const DAY = 864e5;
const TH = 7 * 3600e3;

/** Every date on screen goes through here: Thai calendar (2569), Thai time zone. */
export const thDate = (d: Date | string, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }) =>
  new Date(d).toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok", ...opts });
export const thTime = (d: Date | string) =>
  new Date(d).toLocaleTimeString("th-TH", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit" });

/** "เมื่อสักครู่ / 5 นาทีที่แล้ว / 3 ชั่วโมงที่แล้ว / 2 วันที่แล้ว / 12 พ.ย." */
export function ago(d: Date | string, now = new Date()): string {
  const s = Math.max(0, (now.getTime() - new Date(d).getTime()) / 1000);
  if (s < 90) return "เมื่อสักครู่";
  if (s < 3600) return `${Math.round(s / 60)} นาทีที่แล้ว`;
  if (s < 86400) return `${Math.round(s / 3600)} ชั่วโมงที่แล้ว`;
  if (s < 7 * 86400) return `${Math.round(s / 86400)} วันที่แล้ว`;
  return thDate(d);
}

/** One list of target-time presets for the whole app (minutes). */
export const TARGET_PRESETS = [5, 10, 15, 20] as const;

/** The real presentation day the user set (browser storage), or null. */
export function presentDay(): Date | null {
  const saved = readPref(PREF.presentDay);
  if (!saved) return null;
  const d = new Date(`${saved}T09:00:00+07:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function daysUntil(day: Date, now = new Date()) {
  return Math.floor((day.getTime() + TH) / DAY) - Math.floor((now.getTime() + TH) / DAY);
}

/** yyyy-mm-dd of a date in Thai time (for <input type="date">). */
export const isoDay = (d: Date) => new Date(d.getTime() + TH).toISOString().slice(0, 10);

/** Suggested rehearsal days before the real one: about one every 3 days, at most 4, the last one the day before. */
export function practicePlan(day: Date, now = new Date()): Date[] {
  const left = daysUntil(day, now);
  if (left <= 0) return [];
  if (left === 1) return [new Date(now)];
  const n = Math.min(4, Math.max(1, Math.ceil((left - 1) / 3)));
  return Array.from({ length: n }, (_, i) => new Date(now.getTime() + Math.round(((i + 1) * (left - 1)) / n) * DAY));
}

/* ---------- Month summary (recap slides, share card) ---------- */

const CODES8: CriterionCode[] = ["C1", "C2", "S1", "S2", "S3", "N1", "N2", "T1"];
const thParts = (d: Date) => { const x = new Date(d.getTime() + TH); return { y: x.getUTCFullYear(), m: x.getUTCMonth(), day: x.getUTCDate(), wd: x.getUTCDay(), h: x.getUTCHours() }; };
const WEEKDAY = ["วันอาทิตย์", "วันจันทร์", "วันอังคาร", "วันพุธ", "วันพฤหัสบดี", "วันศุกร์", "วันเสาร์"];
const SLOT = (h: number) => (h >= 5 && h < 12 ? "ช่วงเช้า" : h < 17 ? "ช่วงบ่าย" : h < 21 ? "ช่วงหัวค่ำ" : "ช่วงดึก");
const top = <T,>(xs: T[]) => { const c = new Map<T, number>(); xs.forEach((x) => c.set(x, (c.get(x) ?? 0) + 1)); return [...c.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]; };

export function monthSummary(rows: SessionRow[], now = new Date()) {
  const n = thParts(now);
  const sent = rows.filter((r) => r.source === "session" && countsAsPractice(r) && (({ y, m }) => y === n.y && m === n.m)(thParts(new Date(r.created_at))));
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
    first, last, comparable: done.length >= 2 && !!first && !!last && compatibleRubric(first.rubric_version, last.rubric_version), higher: cmp,
  };
}

export function shareDataFor(rows: SessionRow[], name: string, now = new Date()): ShareData {
  const s = monthSummary(rows, now), stage = stageLights(rows, now);
  return { title: s.label, name, rounds: s.rounds, minutes: s.minutes, lights: stage.lights, streak: stage.streak, levels: s.last?.levels ?? null };
}
