/* The signed-in user's rounds (GET /api/sessions), loaded once for the whole app and shared by every page that
   needs history: dashboard, stage lights, bell, progress, recap, compare, settings and Ctrl+K.
   - while a round waits in the queue or is being analysed, ask again every 10 s (and when the tab is shown again);
   - a request still running is never cut off or repeated by the next tick (a slow API would never update);
   - a failed refresh keeps the list on screen and says so. */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "@/api";
import { useAuth } from "@/auth";
import type { Criterion, CriterionCode, SessionRow } from "@/contract";
import { RefreshCw } from "lucide-react";
import { Button, SKILL_OF } from "./ui";
import { ErrorPanel } from "./states";
import { doneRuns } from "@/trend";
import type { Note } from "./Notifications";
import { PATH } from "./paths";
import { stageLights, type StageState } from "./streak";
import { ago, daysUntil, presentDay, thDate, thTime } from "./time";
import { PREF, usePref } from "./prefs";

export const REFRESH_MS = 10_000;

interface Sessions {
  /** null until the first answer */ rows: SessionRow[] | null;
  /** message of the last failed load (the old list stays) */ error: string | null;
  reload: () => void;
}
const Ctx = createContext<Sessions>({ rows: null, error: null, reload: () => {} });
export const useSessions = () => useContext(Ctx);

export function SessionsProvider({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  const allowed = !!state && (!!state.user || !state.required);
  // a new account (login, logout, register) starts from an empty list
  return <Loader key={allowed ? state?.user?.id ?? "pilot" : "none"} enabled={allowed}>{children}</Loader>;
}

function Loader({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const [rows, setRows] = useState<SessionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const loading = useRef(false);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const { signal } = controller;
    loading.current = true;
    api.sessions(signal).then((data) => { if (!signal.aborted) { setRows(data); setError(null); } })
      .catch((e) => { if (!signal.aborted) setError(e instanceof Error ? e.message : "โหลดประวัติไม่สำเร็จ"); })
      .finally(() => { if (!signal.aborted) loading.current = false; });
    return () => { controller.abort(); loading.current = false; };
  }, [enabled, tick]);
  const analysing = !!rows?.some((r) => r.source === "session" && (r.status === "queued" || r.status === "processing"));
  useEffect(() => {
    if (!analysing) return;
    const again = () => { if (!document.hidden && !loading.current) setTick((n) => n + 1); };
    const timer = window.setInterval(again, REFRESH_MS);
    document.addEventListener("visibilitychange", again);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", again); };
  }, [analysing]);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  const value = useMemo(() => ({ rows, error, reload }), [rows, error, reload]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** The round list could not be loaded at all: say so and offer to try again, never an endless skeleton. */
export function ListLoadError({ className, dark }: { className?: string; dark?: boolean }) {
  const { error, reload } = useSessions();
  return <ErrorPanel className={className} dark={dark} what="โหลดประวัติการซ้อมไม่สำเร็จ" why={error ?? undefined}
    todo="ตรวจการเชื่อมต่อ แล้วกดลองใหม่" actions={<Button size="sm" onClick={reload}><RefreshCw />ลองใหม่</Button>} />;
}

/** The user's own rehearsals, newest first (no mock results). */
export function rehearsals(rows: SessionRow[] | null): SessionRow[] {
  return (rows ?? []).filter((r) => r.source === "session").sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export const roundName = (r: SessionRow) => `รอบ ${thDate(r.created_at, { day: "numeric", month: "short" })} ${thTime(r.created_at)} น.`;

/** Stage lights and bell for the app frame. */
export function useShellData(): { stage: StageState | undefined; notes: Note[]; latestDone: SessionRow | null } {
  const { rows } = useSessions();
  const [day] = usePref(PREF.presentDay, ""); // recount "N days to go" when the day changes
  return useMemo(() => {
    if (!rows) return { stage: undefined, notes: [], latestDone: null };
    const mine = rehearsals(rows), now = new Date();
    const stage = stageLights(mine, now);
    const latestDone = doneRuns(mine).at(-1) ?? null;
    const notes: Note[] = [];
    for (const r of mine.filter((x) => x.status === "queued" || x.status === "processing"))
      notes.push({ id: `n-run-${r.session_id}-${r.status}`, kind: "info", title: `${roundName(r)} ${r.status === "queued" ? "รอคิววิเคราะห์" : "กำลังวิเคราะห์"}`, body: "ปิดหน้าเว็บได้ ผลออกแล้วจะแจ้งตรงนี้", when: ago(r.created_at, now), to: PATH.result(r.session_id) });
    const recent = mine.filter((x) => now.getTime() - new Date(x.created_at).getTime() < 7 * 864e5);
    for (const r of recent.filter((x) => x.status === "done").slice(0, 3))
      notes.push({ id: `n-result-${r.session_id}`, kind: "result", title: `ผล${roundName(r)} ออกแล้ว`, body: "ดูระดับ 8 เกณฑ์และหลักฐานในวิดีโอ", when: ago(r.created_at, now), to: PATH.result(r.session_id) });
    for (const r of recent.filter((x) => x.status === "failed").slice(0, 2))
      notes.push({ id: `n-failed-${r.session_id}`, kind: "info", title: `${roundName(r)} วิเคราะห์ไม่สำเร็จ`, body: "ดูสาเหตุ แล้วซ้อมรอบใหม่ได้", when: ago(r.created_at, now), to: PATH.result(r.session_id) });
    const week = stage.weeks.at(-1)?.week;
    if (stage.atRisk) notes.push({ id: `n-risk-${week}`, kind: "stage", title: `ซ้อมภายใน ${stage.daysLeft} วันเพื่อรักษาไฟเวที`, body: "ถ้าไม่ซ้อมเลยทั้งสัปดาห์ ไฟจะหรี่ลง 1 ดวง", when: "สัปดาห์นี้", to: PATH.new });
    else if (stage.practicedThisWeek) notes.push({ id: `n-lit-${week}`, kind: "stage", title: `ไฟเวทีสัปดาห์นี้ติดแล้ว (${stage.lights}/5)`, body: stage.streak > 1 ? `ซ้อมติดต่อกัน ${stage.streak} สัปดาห์` : undefined, when: "สัปดาห์นี้", to: PATH.home });
    const pd = presentDay(), left = pd ? daysUntil(pd, now) : -1;
    if (left > 0) notes.push({ id: `n-day-${left}`, kind: "day", title: `อีก ${left} วันถึงวันพรีเซนต์จริง`, body: "ดูแผนซ้อมที่แนะนำ", when: "วันนี้", to: PATH.newDay });
    return { stage, notes, latestDone };
  }, [rows, day]);
}

const CODES: CriterionCode[] = ["C1", "C2", "S1", "S2", "S3", "N1", "N2", "T1"];
/** Radar input from a history row (levels only; a missing level = unanalyzable). */
export function rowCriteria(levels: Partial<Record<CriterionCode, number | null>>): Criterion[] {
  return CODES.map((code) => {
    const level = (levels[code] ?? null) as Criterion["level"];
    return { code, skill: SKILL_OF[code], status: level == null ? "unanalyzable" : "ok", level, values: {}, evidence: [], feedback_id: null, reason: null } as Criterion;
  });
}

