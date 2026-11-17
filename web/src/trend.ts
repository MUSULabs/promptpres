// D-046 layer 3 (self-regulated learning loop): compare levels of the same criterion across rehearsals.
// Levels are compared one criterion at a time, between results of the same rubric version or of the
// eight-criterion drafts v0.7-v0.9 (D-050, compatibleRubric).
import type { CriterionCode, SessionRow } from "./contract";

export type Direction = "up" | "same" | "down" | null;

const CODES = ["C1", "C2", "S1", "S2", "S3", "N1", "N2", "T1"];

/** Every finished rehearsal of this user (no mocks), oldest first. */
export function doneRuns(rows: SessionRow[]): SessionRow[] {
  return rows.filter((r) => r.source === "session" && r.status === "done" && r.levels)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

/** Finished rehearsals that carry all 8 criteria; older results with another criterion set are
 *  left out of the comparison (they stay in the session list and are counted in the panel note). */
export function finishedRuns(rows: SessionRow[]): SessionRow[] {
  return doneRuns(rows).filter((r) => CODES.every((code) => Object.hasOwn(r.levels!, code)));
}

export function direction(before: number | null | undefined, now: number | null | undefined): Direction {
  if (before == null || now == null) return null;
  return now > before ? "up" : now < before ? "down" : "same";
}

/** The finished rehearsal right before `sessionId` with a comparable rubric version, if any. */
export function previousRun(rows: SessionRow[], sessionId: string, rubric: string | null): SessionRow | null {
  const runs = finishedRuns(rows);
  const index = runs.findIndex((r) => r.session_id === sessionId);
  if (index <= 0) return null;
  const earlier = runs.slice(0, index).filter((r) => compatibleRubric(r.rubric_version, rubric));
  return earlier[earlier.length - 1] ?? null;
}

export function levelOf(row: SessionRow | null, code: CriterionCode): number | null {
  return row?.levels?.[code] ?? null;
}

/** D-050 explicitly allows the three eight-criterion draft revisions to be shown together. */
export function compatibleRubric(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const drafts = ["v0.7", "v0.8", "v0.9"];
  return a === b || (drafts.includes(a) && drafts.includes(b));
}
export const MIXED_RUBRIC_NOTE = "หมายเหตุ: เปรียบเทียบระดับรายเกณฑ์ที่ระบบวัดได้ระหว่างรอบซ้อม (เกณฑ์ S3 ตั้งแต่รุ่น v0.9 รวมการตรวจคำติดปากตามบริบท)";
