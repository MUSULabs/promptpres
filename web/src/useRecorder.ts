import { useEffect, useRef, useState } from "react";
import { useObjectUrl } from "./useObjectUrl";
import { STEADY_SAMPLES, useEnvCheck, type EnvChecks } from "./envCheck";

// Recording protocol (SPEC_V2 §7) as a checklist that must be ticked before recording. Rows with `auto` are
// checked from the live camera/mic (envCheck.ts) and ticked for the user once they pass steadily; the rest the
// user ticks (or uses "ติ๊กครบทุกข้อ"). Landscape is its own row so it can be auto-ticked honestly.
export const CHECKLIST: { text: string; auto?: keyof EnvChecks }[] = [
  { text: "วางกล้องแนวนอน", auto: "landscape" },
  { text: "ยืนนำเสนอ กล้องระดับอก ห่าง 1.5–2.5 เมตร ตั้งบนขาตั้งหรือที่วางนิ่ง ห้ามถือ" },
  { text: "เห็นศีรษะถึงเอว และเห็นมือทั้งสองข้างเมื่อยกขึ้น (ใช้เส้นประบนภาพช่วยกะ)" },
  { text: "แสงหันเข้าหน้า ไม่ยืนย้อนแสงหน้าต่าง", auto: "light" },
  { text: "ห้องเงียบ ไมโครโฟนห่างไม่เกิน 2 เมตร", auto: "sound" },
  { text: "ไม่มีผู้พูดคนอื่นในเสียงหรือในภาพ" },
];
export const COUNTDOWN_CHOICES = [0, 3, 5];   // seconds before recording starts (time to walk to the spot)

function releaseCamera(stream: MediaStream | null, preview: HTMLVideoElement | null) {
  stream?.getTracks().forEach((track) => track.stop());
  if (preview && preview.srcObject === stream) preview.srcObject = null;
}

// Chrome/Edge/Firefox record WebM; Safari records MP4. Pick the first type the browser supports.
const MIME_CANDIDATES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
  "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
  "video/mp4",
];

export function pickMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  return MIME_CANDIDATES.find((t) => MediaRecorder.isTypeSupported(t)) ?? null;
}

/** Camera recorder with the framing checklist; hands the finished clip to `onRecorded`. */
export function useRecorder({ onRecorded, onRecordingStart }: {
  onRecorded: (blob: Blob, filename: string) => void;
  onRecordingStart: () => void;
}) {
  const preview = useRef<HTMLVideoElement>(null);
  const camera = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [checked, setChecked] = useState<boolean[]>(CHECKLIST.map(() => false));
  const touched = useRef<boolean[]>(CHECKLIST.map(() => false));   // rows the user set by hand: never auto-ticked
  const [recording, setRecording] = useState(false);
  const [opening, setOpening] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [countdownS, setCountdownS] = useState(5);
  const [count, setCount] = useState<number | null>(null);         // seconds left before recording starts
  const countTimer = useRef<number | null>(null);
  const mime = pickMimeType();
  const mounted = useRef(true);
  const blobUrl = useObjectUrl(blob);
  // check the room only while the camera is on and before recording (the AudioContext is closed otherwise)
  const { checks, steady } = useEnvCheck(stream, preview, !!stream && !recording && count === null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      // leaving the page (or switching to the upload tab) mid-recording: stop the recorder and do NOT
      // hand the half-finished clip to the parent
      mounted.current = false;
      if (countTimer.current !== null) clearInterval(countTimer.current);
      const rec = recorder.current;
      if (rec) {
        rec.onstop = null;
        rec.ondataavailable = null;
        if (rec.state !== "inactive") rec.stop();
      }
      releaseCamera(camera.current, preview.current);
      camera.current = null;
    };
  }, []);
  useEffect(() => {
    if (!recording) return;
    const t0 = Date.now();
    const id = setInterval(() => setElapsed((Date.now() - t0) / 1000), 500);
    return () => clearInterval(id);
  }, [recording]);
  useEffect(() => {
    if (!stream) return;
    const tracks = stream.getTracks();
    function onDeviceEnded() {
      if (camera.current !== stream) return;
      setErr("กล้องหรือไมโครโฟนหลุดระหว่างใช้งาน");
      if (countTimer.current !== null) clearInterval(countTimer.current);
      countTimer.current = null;
      setCount(null);
      const rec = recorder.current;
      if (rec) {
        // Keep the data recorded so far and let the normal stop handler prepare it for review.
        if (rec.state !== "inactive") rec.stop();
        setFinishing(true);
        return;
      }
      releaseCamera(stream, preview.current);
      camera.current = null;
      setStream(null);
    }
    tracks.forEach((track) => track.addEventListener("ended", onDeviceEnded));
    return () => tracks.forEach((track) => track.removeEventListener("ended", onDeviceEnded));
  }, [stream]);
  // auto-tick a checked row once it has passed STEADY_SAMPLES in a row (never auto-untick: the user stays in control)
  useEffect(() => {
    setChecked((prev) => {
      const next = prev.map((v, i) => {
        const key = CHECKLIST[i].auto;
        return v || (!!key && !touched.current[i] && steady[key] >= STEADY_SAMPLES);
      });
      return next.some((v, i) => v !== prev[i]) ? next : prev;
    });
  }, [steady]);

  async function openCamera() {
    if (opening || camera.current) return;
    setOpening(true);
    setErr(null);
    let opened: MediaStream | undefined;
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true },
      });
      if (!mounted.current) {          // the user left while the browser was still asking: camera off
        releaseCamera(s, null);
        return;
      }
      opened = s;
      camera.current = s;
      setStream(s);
      if (preview.current) { preview.current.srcObject = s; preview.current.muted = true; await preview.current.play(); }
    } catch (e) {
      const name = e instanceof DOMException ? e.name : "";
      const why = name === "NotAllowedError" ? "ไม่ได้รับอนุญาตให้ใช้กล้อง/ไมโครโฟน"
        : name === "NotFoundError" ? "ไม่พบกล้องหรือไมโครโฟน"
        : name === "NotReadableError" ? "กล้องหรือไมโครโฟนถูกโปรแกรมอื่นใช้อยู่" : String(e);
      if (opened) {
        releaseCamera(opened, preview.current);
        if (camera.current === opened) camera.current = null;
        if (mounted.current) setStream(null);
      }
      if (mounted.current) setErr(`เปิดกล้อง/ไมโครโฟนไม่ได้: ${why}`);
    } finally {
      if (mounted.current) setOpening(false);
    }
  }

  function start() {
    if (!stream || !mime) return;
    chunks.current = [];
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 2_500_000 });
    } catch (e) {
      setErr(`เริ่มอัดไม่ได้: ${String(e)}`);
      return;
    }
    const recorded = stream;          // the stream this recording uses (state may change later)
    rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
    rec.onstop = () => {
      const b = new Blob(chunks.current, { type: mime.split(";")[0] });
      chunks.current = [];
      recorder.current = null;
      // clip is ready for review: release camera + mic now (light off), not when the page is left
      closeCamera(recorded);
      setStream(null);
      setRecording(false);
      setFinishing(false);
      if (b.size) {
        setBlob(b);
        onRecorded(b, `recording.${mime.startsWith("video/mp4") ? "mp4" : "webm"}`);
      } else {
        setErr("ไม่มีข้อมูลวิดีโอในคลิป กรุณาลองอัดใหม่");
      }
    };
    try {
      rec.start(1000);
    } catch (e) {
      setErr(`เริ่มอัดไม่ได้: ${String(e)}`);
      return;
    }
    setErr(null);
    setBlob(null);
    onRecordingStart();
    recorder.current = rec;
    setElapsed(0);
    setRecording(true);
  }

  function stopCountdown() {
    if (countTimer.current !== null) clearInterval(countTimer.current);
    countTimer.current = null;
    setCount(null);
  }

  /** "เริ่มอัด": count down first (time to walk to the spot), then start recording. */
  function begin() {
    if (!countdownS) { start(); return; }
    let left = countdownS;
    setCount(left);
    countTimer.current = window.setInterval(() => {
      left -= 1;
      if (left > 0) { setCount(left); return; }
      stopCountdown();
      start();
    }, 1000);
  }

  function stop() {
    const rec = recorder.current;
    if (!rec || rec.state === "inactive") return;
    rec.stop();
    setFinishing(true);
    // stop() queues the final data event; the devices can be released now.
    closeCamera(stream);
  }

  function closeCamera(recorded: MediaStream | null) {
    if (!recorded || camera.current !== recorded) return;
    releaseCamera(recorded, preview.current);
    camera.current = null;
  }

  function toggle(i: number) {
    touched.current[i] = true;
    setChecked(checked.map((v, j) => (j === i ? !v : v)));
  }

  function tickAll() {
    touched.current = CHECKLIST.map(() => true);
    setChecked(CHECKLIST.map(() => true));
  }

  const ready = checked.every(Boolean);
  const live = !!stream && !recording && count === null;

  return { preview, stream, checked, recording, opening, finishing, elapsed, blob, err, countdownS, setCountdownS,
           count, mime, blobUrl, checks, openCamera, begin, stopCountdown, stop, toggle, tickAll, ready, live };
}
