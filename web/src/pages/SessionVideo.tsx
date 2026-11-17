import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ApiError, api } from "../api";
import type { SessionInfo } from "../contract";
import Recorder from "../components/Recorder";
import { Icon, Message, NotFound, PageHeading, Steps } from "../components/ui";
import { fmtTime } from "../presentation";
import { useObjectUrl } from "../useObjectUrl";
import { useVideoUpload, type Clip } from "../useVideoUpload";

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
  const { send, sending, progress, error, setError, isSending } = useVideoUpload(id, () => nav(`/sessions/${id}`), setInfo);
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
    dialog.current?.close();
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
    <section>
      <Steps current={2} />
      <PageHeading badge="ขั้นตอนที่ 02" title="เตรียมและส่งวิดีโอ">
        อัดจากกล้องหรือเลือกคลิปที่มีอยู่ แล้วดูตัวอย่างก่อนส่งวิเคราะห์
      </PageHeading>
      <p className="context-strip">
        <span><Icon name="clock" /> เป้าหมาย <strong>{fmtTime(info.target_duration_s)}</strong></span>
        <span><Icon name="document" /> {topics.length
          ? `ยืนยัน ${topics.length} หัวข้อ: ${topics.map((t) => t.title).join(" → ")}`
          : "ไม่ได้ยืนยันหัวข้อ (C1–C2 จะวิเคราะห์ไม่ได้)"}</span>
      </p>
      <div className="tabs" role="group" aria-label="โหมดวิดีโอ">
        <button ref={tab === "record" ? activeModeButton : undefined} className="segment" aria-pressed={tab === "record"}
          disabled={sending} onClick={() => requestMode("record")}><Icon name="camera" /> อัดจากกล้องสด</button>
        <button ref={tab === "upload" ? activeModeButton : undefined} className="segment" aria-pressed={tab === "upload"}
          disabled={sending} onClick={() => requestMode("upload")}><Icon name="upload" /> อัปโหลดไฟล์วิดีโอ</button>
      </div>

      {tab === "record" ? <Recorder disabled={sending} onActivityChange={setRecorderActive}
        onRecordingStart={() => { setClip(null); setError(null); }}
        onRecorded={(blob, name) => setClip({ blob, name })} /> : (
        <div className="grid2">
          <div className="panel">
            <h2><Icon name="upload" /> เลือกและตรวจคลิป</h2>
            <label className="file-field file-picker">
              <span className="button secondary"><Icon name="upload" /> {clip ? "เปลี่ยนไฟล์วิดีโอ" : "เลือกไฟล์วิดีโอ"}</span>
              <span className="muted">ไฟล์ .mp4 / .webm / .mov</span>
              <input className="sr-only" type="file" accept={VIDEO_ACCEPT} disabled={sending} onChange={(e) => {
                selectFile(e.currentTarget.files?.[0]);
                e.currentTarget.value = "";
              }} />
            </label>
            {clip && <div className="selected-file">
              <Icon name="video" />
              <div><strong>{clip.name}</strong><p className="muted">{(clip.blob.size / 1e6).toFixed(1)} MB</p></div>
            </div>}
            {clipUrl && <video key={clipUrl} className="video upload-preview" controls playsInline preload="metadata" src={clipUrl}
              aria-label="ตัวอย่างคลิปที่เลือก" onError={() => setPreviewError(true)} />}
            {!clipUrl && <div className="preview-wrap"><div className="preview-placeholder"><Icon name="video" /> ตัวอย่างวิดีโอจะแสดงที่นี่</div></div>}
            {previewError && <Message>เบราว์เซอร์เปิดตัวอย่างไฟล์นี้ไม่ได้ คุณยังส่งไฟล์ให้ระบบตรวจสอบได้</Message>}
          </div>
          <aside className="panel guidance">
            <span className="state-icon"><Icon name="sparkles" /></span>
            <h2>คำแนะนำคลิปที่นำมาอัปโหลด</h2>
            <ul>
              <li><Icon name="camera" /> ตั้งกล้องแนวนอนและวางให้นิ่ง</li>
              <li><Icon name="video" /> ยืนนำเสนอให้เห็นศีรษะถึงเอวและมือ</li>
              <li><Icon name="microphone" /> เสียงพูดชัดเจนและมีเสียงรบกวนน้อย</li>
              <li><Icon name="check" /> มีผู้นำเสนอเพียงคนเดียว</li>
              <li><Icon name="camera" /> อัดผ่านเบราว์เซอร์ (720p) หรือตั้งกล้องมือถือเป็น 720p เพื่อให้ไฟล์ไม่เกิน 512 MB</li>
              <li><Icon name="alert" /> ระบบออนไลน์เก็บไฟล์วิดีโอ 7 วันสำหรับผู้ทดลองใช้ และ 30 วันสำหรับสมาชิก คะแนนและข้อเสนอแนะยังอยู่ครบหลังลบวิดีโอ</li>
            </ul>
          </aside>
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

      <dialog ref={dialog} className="confirm-dialog" aria-labelledby="change-mode-title"
        aria-describedby="change-mode-description" onClose={() => { pendingMode.current = null; }}>
        <span className="state-icon"><Icon name="alert" /></span>
        <h2 id="change-mode-title">เปลี่ยนโหมดวิดีโอหรือไม่?</h2>
        <p id="change-mode-description">คลิปที่ยังไม่ได้ส่งหรือการอัดที่กำลังทำอยู่จะถูกล้างเมื่อเปลี่ยนโหมด</p>
        <div className="row">
          <button className="ghost" autoFocus onClick={() => dialog.current?.close()}>ยกเลิก</button>
          <button className="danger" onClick={confirmMode}>เปลี่ยนโหมดและล้างคลิป</button>
        </div>
      </dialog>
    </section>
  );
}
