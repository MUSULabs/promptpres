import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiError, api } from "../api";
import type { SessionInfo } from "../contract";
import Recorder from "../components/Recorder";
import { ConfirmDialog, Icon, Message, NotFound, PageHeading, Steps } from "../components/ui";
import { fmtDuration } from "../presentation";
import { useObjectUrl } from "../useObjectUrl";
import { useVideoUpload, type Clip } from "../useVideoUpload";
import { useLeaveGuard } from "../useLeaveGuard";
import "./practice.css";

type VideoMode = "record" | "upload";
const VIDEO_EXTENSIONS = /\.(mp4|webm|mov)$/i;
const VIDEO_ACCEPT = ".mp4,.webm,.mov,video/mp4,video/webm,video/quicktime";

export default function SessionVideo() {
  const { id = "" } = useParams();
  return <VideoSetup key={id} id={id} />;
}

/** Step 2 of a practice: record in the browser or upload a file, then send it to the analysis queue. */
function VideoSetup({ id }: { id: string }) {
  const nav = useNavigate();
  const [info, setInfo] = useState<SessionInfo | null>(null);
  const [tab, setTab] = useState<VideoMode>("record");
  const [clip, setClip] = useState<Clip | null>(null);
  const [recorderActive, setRecorderActive] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  const clipUrl = useObjectUrl(tab === "upload" ? clip?.blob : null);
  const { send, sending, progress, error, setError, isSending } = useVideoUpload(id, () => {
    guard.release();
    nav(`/sessions/${id}`);
  }, setInfo);
  // Never drop a recording or an unsent clip silently (handoff 03): ask before leaving this step.
  const guard = useLeaveGuard(info?.status === "created" && (recorderActive || !!clip || sending));
  const leaveDialog = useRef<HTMLDialogElement>(null);
  const leaving = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const pendingMode = useRef<VideoMode | null>(null);
  const activeModeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    api.session(id, signal).then((data) => { if (!signal.aborted) setInfo(data); }).catch((e) => {
      if (signal.aborted) return;
      if (e instanceof ApiError && e.status === 404) setNotFound(true);
      else setLoadError(String(e.message));
    });
    return () => controller.abort();
  }, [id]);

  const { blocker } = guard;
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    leaving.current = false;
    if (!leaveDialog.current?.open) leaveDialog.current?.showModal();
  }, [blocker.state]);

  function switchMode(next: VideoMode) {
    setClip(null);
    setRecorderActive(false);
    setPreviewError(false);
    setError(null);
    setTab(next);
  }

  function requestMode(next: VideoMode) {
    if (next === tab || isSending()) return;
    if (clip || recorderActive) {
      pendingMode.current = next;
      dialog.current?.showModal();
    } else {
      switchMode(next);
    }
  }

  function confirmMode() {
    const next = pendingMode.current;
    if (next && !isSending()) {
      switchMode(next);
      requestAnimationFrame(() => activeModeButton.current?.focus());
    }
  }

  function selectFile(file?: File) {
    if (!file || isSending()) return;
    if (!VIDEO_EXTENSIONS.test(file.name) || !file.size) {
      setError(file.size ? "รองรับเฉพาะไฟล์ .mp4 .webm .mov" : "ไฟล์ว่างเปล่า กรุณาเลือกไฟล์ใหม่");
      return;
    }
    setError(null);
    setPreviewError(false);
    setClip({ blob: file, name: file.name });
  }

  if (notFound) return <NotFound message="ไม่พบรอบซ้อมนี้" />;
  if (loadError) return <Message kind="error">{loadError}</Message>;
  if (!info) return <Message>กำลังโหลดรอบซ้อม…</Message>;
  if (info.status !== "created") {
    return <Message>ส่งวิดีโอของรอบนี้แล้ว — <Link to={`/sessions/${id}`}>ดูสถานะและผล</Link></Message>;
  }
  const topics = info.confirmed_topics ?? [];
  const percent = progress === null ? null : Math.floor(progress * 100);

  return (
    <section className="video-page">
      <Steps current={2} />
      <PageHeading title={tab === "record" ? "ห้องซ้อมนำเสนอ" : "เตรียมวิดีโอจากไฟล์"} />
      <div className="context-strip">
        <p><Icon name="clock" /> เวลาเป้าหมาย <strong>{fmtDuration(info.target_duration_s)}</strong></p>
        {topics.length > 0 ? <details className="context-topics">
          <summary><Icon name="document" /> หัวข้อที่ยืนยัน {topics.length} หัวข้อ</summary>
          <ol>{topics.map((topic, index) => <li key={topic.id ?? index}>{topic.title}</li>)}</ol>
        </details> : <p><Icon name="document" /> ข้ามหัวข้อ · C1–C2 จะวิเคราะห์ไม่ได้</p>}
      </div>
      <div className="tabs video-modes" role="group" aria-label="โหมดวิดีโอ">
        <button ref={tab === "record" ? activeModeButton : undefined} className="segment" aria-pressed={tab === "record"}
          disabled={sending} onClick={() => requestMode("record")}><Icon name="camera" /> อัดจากกล้องสด</button>
        <button ref={tab === "upload" ? activeModeButton : undefined} className="segment" aria-pressed={tab === "upload"}
          disabled={sending} onClick={() => requestMode("upload")}><Icon name="upload" /> อัปโหลดไฟล์วิดีโอ</button>
      </div>

      {tab === "record" ? <Recorder disabled={sending} onActivityChange={setRecorderActive}
        onRecordingStart={() => { setClip(null); setError(null); }}
        onRecorded={(blob, name) => setClip({ blob, name })} /> : (
        <div className="panel upload-workspace">
          <div className="upload-selection">
            <h2><Icon name="upload" /> เลือกและตรวจคลิป</h2>
            <label className="file-field file-picker">
              <span className="button secondary"><Icon name="upload" /> {clip ? "เปลี่ยนไฟล์วิดีโอ" : "เลือกไฟล์วิดีโอ"}</span>
              <span className="muted small" id="video-file-help">ไฟล์ .mp4 / .webm / .mov ขนาดไม่เกิน 512 MB</span>
              <input className="sr-only" type="file" accept={VIDEO_ACCEPT} disabled={sending}
                aria-label={clip ? "เปลี่ยนไฟล์วิดีโอ" : "เลือกไฟล์วิดีโอ"} aria-describedby="video-file-help" onChange={(e) => {
                  selectFile(e.currentTarget.files?.[0]);
                  e.currentTarget.value = "";
                }} />
            </label>
            {clip && <div className="selected-file">
              <Icon name="video" />
              <div><strong>{clip.name}</strong><p className="muted">{(clip.blob.size / 1e6).toFixed(1)} MB</p></div>
            </div>}
          </div>
          <div className="upload-visual">
            {clipUrl && <video key={clipUrl} className="video upload-preview" controls playsInline preload="metadata" src={clipUrl}
              aria-label="ตัวอย่างคลิปที่เลือก" onError={() => setPreviewError(true)} />}
            {!clipUrl && <div className="preview-wrap"><div className="preview-placeholder"><Icon name="video" /> ตัวอย่างวิดีโอก่อนส่ง</div></div>}
            {previewError && <Message>เบราว์เซอร์เปิดตัวอย่างไฟล์นี้ไม่ได้ คุณยังส่งไฟล์ให้ระบบตรวจสอบได้</Message>}
          </div>
        </div>
      )}

      <div className="panel submit-panel">
        {error && <Message kind="error">{error}</Message>}
        <div className="submit-row">
          <div>
            <strong>{sending ? percent === 100 ? "โอนไฟล์เสร็จแล้ว กำลังรอเซิร์ฟเวอร์" : "กำลังอัปโหลดวิดีโอ" : "ส่งวิดีโอเข้าคิววิเคราะห์"}</strong>
            <p className="muted" role="status">{sending
              ? percent === null ? "กำลังส่งไฟล์…" : percent < 100 ? `โอนไฟล์แล้ว ${percent}%` : "ระบบกำลังรับไฟล์เข้าคิว"
              : "ระบบเริ่มวิเคราะห์หลังได้รับไฟล์"}</p>
          </div>
          <button disabled={!clip || recorderActive || sending}
            onClick={() => { if (clip && !recorderActive) void send(clip); }}>ส่งวิเคราะห์ <Icon name="arrow" /></button>
        </div>
        {sending && <progress aria-label="ความคืบหน้าการอัปโหลดไฟล์" max={1} value={progress ?? undefined} />}
      </div>

      {tab === "upload" && <details className="disclosure guidance">
        <summary>คำแนะนำสำหรับคลิปที่อัปโหลด <Icon name="chevronDown" /></summary>
        <ul>
          <li><Icon name="camera" /> ตั้งกล้องแนวนอนให้นิ่ง และใช้ความละเอียด 720p เพื่อลดขนาดไฟล์</li>
          <li><Icon name="video" /> ยืนนำเสนอคนเดียว ให้เห็นศีรษะถึงเอวและมือ</li>
          <li><Icon name="microphone" /> พูดให้ได้ยินชัดในที่ที่มีเสียงรบกวนน้อย</li>
          <li><Icon name="clock" /> ระบบออนไลน์เก็บคลิป 7 วันสำหรับผู้ทดลองใช้ และ 30 วันสำหรับสมาชิก ผลและข้อเสนอแนะยังเปิดดูได้หลังระบบลบคลิป</li>
        </ul>
      </details>}

      <ConfirmDialog dialogRef={leaveDialog} title="ออกจากขั้นวิดีโอหรือไม่?"
        description={sending ? "การอัปโหลดวิดีโอจะถูกยกเลิก และต้องส่งใหม่ภายหลัง"
          : recorderActive ? "การอัดที่กำลังทำอยู่จะหยุด และคลิปนี้จะไม่ถูกเก็บไว้"
          : "คลิปที่เตรียมไว้ยังไม่ได้ส่งวิเคราะห์ ถ้าออกตอนนี้คลิปจะหายไป"}
        confirmLabel="ออกและทิ้งคลิป"
        onConfirm={() => { leaving.current = true; if (blocker.state === "blocked") blocker.proceed(); }}
        onClose={() => { if (!leaving.current && blocker.state === "blocked") blocker.reset(); }} />
      <ConfirmDialog dialogRef={dialog} title="เปลี่ยนโหมดวิดีโอหรือไม่?"
        description="คลิปที่ยังไม่ได้ส่งหรือการอัดที่กำลังทำอยู่จะถูกล้างเมื่อเปลี่ยนโหมด"
        confirmLabel="เปลี่ยนโหมดและล้างคลิป" onConfirm={confirmMode}
        onClose={() => { pendingMode.current = null; }} />
    </section>
  );
}
