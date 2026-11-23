/* Small per-browser preferences (tour seen, sound, cookie notice, presentation day, weekly goal).
   Browser storage can be missing or throw (private mode, blocked site data), so every access is guarded
   and the page must work without it. Every write tells the other components on the page (event "pp:pref"),
   so a presentation day saved in Settings shows in the bell at once. */
import { useCallback, useEffect, useState } from "react";

const EVENT = "pp:pref";
const memory = new Map<string, string | null>(); // fallback when storage is blocked

export function readPref(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return memory.get(key) ?? null; }
}

export function writePref(key: string, value: string | null) {
  memory.set(key, value);
  try {
    if (value == null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch { /* storage blocked: keep the in-memory value only */ }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: key }));
}

export function usePref(key: string, fallback: string): [string, (v: string) => void] {
  const [value, setValue] = useState(() => readPref(key) ?? fallback);
  useEffect(() => {
    const sync = (e: Event) => { if ((e as CustomEvent<string>).detail === key) setValue(readPref(key) ?? fallback); };
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, [key, fallback]);
  const set = useCallback((v: string) => { setValue(v); writePref(key, v); }, [key]);
  return [value, set];
}

export const PREF = {
  tourDone: "pp-v2-tour-done",
  sound: "pp-v2-sound",           // "on" | "off"
  cookieSeen: "pp-v2-cookie-seen",
  presentDay: "pp-v2-present-day", // yyyy-mm-dd
  weeklyGoal: "pp-v2-weekly-goal", // "1" | "2" | "3"
  readNotes: "pp-v2-read-notes",   // comma-separated ids
  missions: "pp-v2-missions",      // ticked "next round" goals, comma-separated indexes
} as const;

/** The "next round" checklist (the coach's plan of one round), shared by the dashboard and the result page.
    Ticks belong to that round: a newer round starts with none. Stored as "<session id>:0,2". */
export function useMissions(sessionId: string | null | undefined): [number[], (i: number) => void] {
  const [raw, setRaw] = usePref(PREF.missions, "");
  const [sid, list = ""] = raw.split(":");
  const done = sessionId && sid === sessionId && list ? list.split(",").map(Number).filter((n) => Number.isInteger(n)) : [];
  const toggle = (i: number) => { if (sessionId) setRaw(`${sessionId}:${(done.includes(i) ? done.filter((x) => x !== i) : [...done, i]).join(",")}`); };
  return [done, toggle];
}

/** A soft click for the stage lights. Browsers only allow sound after the user has clicked something;
    if they block it, nothing happens. */
export function playClick(index = 0) {
  if (readPref(PREF.sound) === "off") return;
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    if (ctx.state === "suspended") { void ctx.close(); return; }
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.value = 520 + index * 90;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.14);
    osc.onended = () => void ctx.close();
  } catch { /* no audio: fine */ }
}
