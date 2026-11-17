import { useEffect, useState, type RefObject } from "react";

/*
 * Pre-recording check of the room from the live camera + mic (browser only, nothing is uploaded).
 * These are hints that help the user tick the recording checklist; they never set a level or score.
 * Every 500 ms: one tiny video frame -> brightness, one mic buffer -> loudness (dBFS).
 */

export const SAMPLE_MS = 500;
export const STEADY_SAMPLES = 4;        // a check must pass this many samples in a row (2 s) before it auto-ticks
const HISTORY = 6;                      // samples kept (3 s)
const FRAME_W = 64, FRAME_H = 36;       // the frame is shrunk to this before reading pixels (cheap)
// middle third across, top two thirds down (whole pixels): where a framed presenter's face and chest are
const CENTRE_BOX: [number, number, number, number] =
  [Math.round(FRAME_W / 3), 0, Math.round((2 * FRAME_W) / 3), Math.round((2 * FRAME_H) / 3)];

export const LUMA_MIN = 60;             // DUMMY_VALUE: average brightness 0-255 below this = too dark (tune with real rooms)
export const LUMA_MAX = 200;            // DUMMY_VALUE: above this = washed out
export const BACKLIGHT_RATIO = 0.7;     // DUMMY_VALUE: centre (where the face is) darker than 70 % of the frame = probably backlit
export const MIC_ALIVE_DB = -60;        // DUMMY_VALUE: loudest sample of the last 3 s must be above this, else "no mic signal"
export const NOISE_MAX_DB = -45;        // DUMMY_VALUE: background (20th percentile of the last 3 s) above this = noisy room

export type CheckState = "ok" | "warn" | "wait";
export interface Check { state: CheckState; text: string }
export interface EnvChecks { landscape: Check; light: Check; sound: Check }
interface Sample { landscape: boolean | null; luma: number | null; centre: number | null; db: number | null }

const WAIT: Check = { state: "wait", text: "กำลังตรวจ…" };
export const NO_CHECKS: EnvChecks = { landscape: WAIT, light: WAIT, sound: WAIT };

/** Rec.709 luma of one RGBA pixel (0-255). */
const luma = (d: Uint8ClampedArray, i: number) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];

/** Average luma of a w x h RGBA image, or of the box [x0, x1) x [y0, y1) inside it. */
export function regionLuma(d: Uint8ClampedArray, w: number, h: number,
  box: [number, number, number, number] = [0, 0, w, h]): number {
  const [x0, y0, x1, y1] = box;
  let sum = 0, n = 0;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) { sum += luma(d, (y * w + x) * 4); n++; }
  return n ? sum / n : 0;
}

/** RMS level of one audio buffer in dBFS (silence -> -100). */
export function rmsDb(samples: Float32Array): number {
  let sum = 0;
  for (const s of samples) sum += s * s;
  const rms = Math.sqrt(sum / Math.max(samples.length, 1));
  return rms > 0 ? Math.max(20 * Math.log10(rms), -100) : -100;
}

/** p-th percentile (0-100) by nearest rank. */
export function percentile(xs: number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
}

/** One sample -> the three checks. Light and sound use the recent history so one odd frame/buffer does not flip them. */
export function judge(history: Sample[]): EnvChecks {
  const last = history[history.length - 1];
  if (!last) return NO_CHECKS;

  const landscape: Check = last.landscape === null ? WAIT
    : last.landscape ? { state: "ok", text: "ผ่าน (ภาพแนวนอน)" }
    : { state: "warn", text: "ภาพเป็นแนวตั้ง — หมุนกล้องเป็นแนวนอน" };

  let light: Check = WAIT;
  if (last.luma !== null && last.centre !== null) {
    const l = Math.round(last.luma);
    light = l < LUMA_MIN ? { state: "warn", text: `ภาพมืดเกินไป (ความสว่าง ${l}/255) — เปิดไฟหรือหันหน้าเข้าหาแสง` }
      : l > LUMA_MAX ? { state: "warn", text: `ภาพสว่างจ้าเกินไป (ความสว่าง ${l}/255)` }
      : last.centre < BACKLIGHT_RATIO * last.luma ? { state: "warn", text: "กลางภาพมืดกว่ารอบข้าง อาจยืนย้อนแสง — อย่าหันหลังให้หน้าต่าง" }
      : { state: "ok", text: `ผ่าน (ความสว่าง ${l}/255)` };
  }

  let sound: Check = WAIT;
  const dbs = history.map((s) => s.db).filter((d): d is number => d !== null);
  if (dbs.length === 0) sound = { state: "warn", text: "ไม่พบไมโครโฟนในสตรีมนี้" };   // no audio track / analyser
  else if (dbs.length >= 3) {
    const loudest = Math.max(...dbs), floor = Math.round(percentile(dbs, 20));
    sound = loudest < MIC_ALIVE_DB ? { state: "warn", text: "ไม่พบเสียงจากไมโครโฟน — ตรวจว่าไม่ได้ปิดเสียงไมค์" }
      : floor > NOISE_MAX_DB ? { state: "warn", text: `เสียงพื้นหลังดัง (${floor} dB) — ลองปิดพัดลม/แอร์ หรือย้ายไมค์ให้ใกล้ขึ้น` }
      : { state: "ok", text: `ผ่าน (เสียงพื้นหลัง ${floor} dB)` };
  }
  return { landscape, light, sound };
}

/** How many of the latest samples in a row passed `key` (used to auto-tick only after a steady pass). */
export function steadyCount(history: EnvChecks[], key: keyof EnvChecks): number {
  let n = 0;
  for (let i = history.length - 1; i >= 0 && history[i][key].state === "ok"; i--) n++;
  return n;
}

/**
 * Samples `stream` (via the <video> showing it) every SAMPLE_MS while `active`; returns the latest checks and
 * how long each has passed in a row. Stops and releases the AudioContext when inactive or unmounted.
 */
export function useEnvCheck(stream: MediaStream | null, video: RefObject<HTMLVideoElement>, active: boolean) {
  const [checks, setChecks] = useState<EnvChecks>(NO_CHECKS);
  const [steady, setSteady] = useState<Record<keyof EnvChecks, number>>({ landscape: 0, light: 0, sound: 0 });

  useEffect(() => {
    if (!stream || !active) { setChecks(NO_CHECKS); setSteady({ landscape: 0, light: 0, sound: 0 }); return; }
    const canvas = document.createElement("canvas");
    canvas.width = FRAME_W; canvas.height = FRAME_H;
    const g = canvas.getContext("2d", { willReadFrequently: true });

    let ctx: AudioContext | null = null, source: MediaStreamAudioSourceNode | null = null;
    let analyser: AnalyserNode | null = null, buf: Float32Array | null = null;
    if (stream.getAudioTracks().length) {
      try {
        ctx = new AudioContext();
        source = ctx.createMediaStreamSource(stream);
        analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        source.connect(analyser);                 // not connected to the speakers: no echo
        buf = new Float32Array(analyser.fftSize);
        if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
      } catch {
        source?.disconnect();
        if (ctx && ctx.state !== "closed") void ctx.close().catch(() => undefined);
        ctx = null;
        source = null;
        analyser = null;
      }
    }

    const samples: Sample[] = [], judged: EnvChecks[] = [];
    const id = setInterval(() => {
      const v = video.current;
      const s: Sample = { landscape: null, luma: null, centre: null, db: null };
      if (v && v.videoWidth && v.videoHeight) {
        s.landscape = v.videoWidth > v.videoHeight;
        if (g) {
          g.drawImage(v, 0, 0, FRAME_W, FRAME_H);
          const px = g.getImageData(0, 0, FRAME_W, FRAME_H).data;
          s.luma = regionLuma(px, FRAME_W, FRAME_H);
          s.centre = regionLuma(px, FRAME_W, FRAME_H, CENTRE_BOX);
        }
      }
      if (analyser && buf) { analyser.getFloatTimeDomainData(buf); s.db = rmsDb(buf); }
      samples.push(s); if (samples.length > HISTORY) samples.shift();
      const now = judge(samples);
      judged.push(now); if (judged.length > STEADY_SAMPLES) judged.shift();
      setChecks(now);
      setSteady({ landscape: steadyCount(judged, "landscape"), light: steadyCount(judged, "light"),
        sound: steadyCount(judged, "sound") });
    }, SAMPLE_MS);

    return () => {
      clearInterval(id);
      source?.disconnect();
      if (ctx && ctx.state !== "closed") void ctx.close().catch(() => undefined);
    };
  }, [stream, active, video]);

  return { checks, steady };
}
