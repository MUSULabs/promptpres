/* "ไฟเวที" (stage lights): a weekly practice streak that dims gently instead of resetting.
   Counts only WHEN rounds were sent (created_at), never their levels.
   Rules (owner, 23 Nov 2026):
   - weeks start on Monday, Thai time (UTC+7);
   - a week with at least one round sent turns one more light on (max 5);
   - a whole week with no round turns one light off (min 0);
   - the current week is not judged until it ends (no dimming yet, only a reminder). */
import type { SessionRow } from "@/contract";

export const MAX_LIGHTS = 5;
const DAY_MS = 864e5;
const TH_OFFSET_MS = 7 * 3600e3;

/** Week number (Monday start, Thai time). Day 0 of the epoch was a Thursday, so shift by 3 days. */
export function weekIndex(d: Date): number {
  const day = Math.floor((d.getTime() + TH_OFFSET_MS) / DAY_MS);
  return Math.floor((day + 3) / 7);
}

/** Monday 00:00 Thai time of a week number, as a Date. */
export function weekStart(week: number): Date {
  return new Date((week * 7 - 3) * DAY_MS - TH_OFFSET_MS);
}

/** Rounds that count as practice: sent to the system (not a failed upload, not an unsent draft). */
export function countsAsPractice(r: SessionRow): boolean {
  return r.status === "done" || r.status === "processing" || r.status === "queued";
}

export interface WeekMark { week: number; start: Date; practiced: boolean; lights: number; current: boolean }

export interface StageState {
  lights: number;            // 0..5 right now
  streak: number;            // practice weeks in a row (ends at the current week, or last week if this week is still open)
  best: number;              // longest run of practice weeks ever
  maxLights: number;         // most lights ever on at the end of a week
  comeback: boolean;         // practised again after a whole week away
  practicedThisWeek: boolean;
  atRisk: boolean;           // lights on, but nothing sent yet this week: one light dims if the week ends like this
  daysLeft: number;          // days left in the current week, today included (1..7)
  rounds: number;            // rounds that count
  weeks: WeekMark[];         // up to the last 8 weeks, oldest first
}

export function stageLights(rows: SessionRow[], now: Date): StageState {
  const practiced = new Set(rows.filter(countsAsPractice).map((r) => weekIndex(new Date(r.created_at))));
  const cur = weekIndex(now);
  const today = Math.floor((now.getTime() + TH_OFFSET_MS) / DAY_MS);
  const daysLeft = 7 - ((today + 3) % 7);
  const rounds = rows.filter(countsAsPractice).length;
  if (practiced.size === 0) return { lights: 0, streak: 0, best: 0, maxLights: 0, comeback: false, practicedThisWeek: false, atRisk: false, daysLeft, rounds, weeks: [] };

  const first = Math.min(...practiced);
  let lights = 0, run = 0, best = 0, maxLights = 0, missed = false, comeback = false;
  const marks: WeekMark[] = [];
  for (let w = first; w <= cur; w++) {
    const did = practiced.has(w);
    if (did) { lights = Math.min(MAX_LIGHTS, lights + 1); run++; best = Math.max(best, run); if (missed) comeback = true; missed = false; }
    else if (w < cur) { lights = Math.max(0, lights - 1); run = 0; missed = true; }
    maxLights = Math.max(maxLights, lights);
    marks.push({ week: w, start: weekStart(w), practiced: did, lights, current: w === cur });
  }
  const thisWeek = practiced.has(cur);
  return { lights, streak: run, best, maxLights, comeback, practicedThisWeek: thisWeek, atRisk: !thisWeek && lights > 0, daysLeft, rounds, weeks: marks.slice(-8) };
}

/** Was this round the first one sent in its week? (That round is the one that turned a light on.) */
export function firstOfItsWeek(rows: SessionRow[], sessionId: string): boolean {
  const me = rows.find((r) => r.session_id === sessionId);
  if (!me || !countsAsPractice(me)) return false;
  const w = weekIndex(new Date(me.created_at));
  const t = new Date(me.created_at).getTime();
  return !rows.some((r) => r.session_id !== sessionId && countsAsPractice(r) && weekIndex(new Date(r.created_at)) === w && new Date(r.created_at).getTime() < t);
}
