import { useEffect, useRef, useState } from "react";
import { CHECKLIST, COUNTDOWN_CHOICES, useRecorder } from "../useRecorder";
import { Icon, Message } from "./ui";

/** Dashed head-to-waist outline over the preview: head near the top, waist at the bottom edge = right distance. */
function FramingGuide({ aspect }: { aspect: number }) {
  const h = 90, w = h * aspect, c = w / 2;
  const side = (s: 1 | -1) =>
    `M ${c + s * 5} 27 L ${c + s * 5} 31 C ${c + s * 14} 32 ${c + s * 25} 33 ${c + s * 27} 39 L ${c + s * 20} 86`;
  const shape = (
    <>
      <ellipse cx={c} cy={16} rx={8} ry={11} />
      <path d={side(-1)} />
      <path d={side(1)} />
      <path d={`M ${c - 20} 86 L ${c + 20} 86`} />
    </>
  );
  return (
    <svg className="guide" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <g fill="none" stroke="rgba(0,0,0,.45)" strokeWidth={1.6}>{shape}</g>
      <g fill="none" stroke="rgba(255,255,255,.9)" strokeWidth={0.8} strokeDasharray="3 2">{shape}</g>
    </svg>
  );
}

export default function Recorder(props: {
  onRecorded: (blob: Blob, filename: string) => void;
  onRecordingStart: () => void;
  onActivityChange: (active: boolean) => void;
  disabled: boolean;
}) {
  const { preview, stream, checked, recording, opening, finishing, elapsed, blob, err, countdownS, setCountdownS,
          count, mime, blobUrl, checks, openCamera, begin, stopCountdown, stop, toggle, tickAll, ready, live } =
    useRecorder(props);
  const [guide, setGuide] = useState(true);
  const [aspect, setAspect] = useState(16 / 9);
  const countdownControl = useRef<HTMLSelectElement>(null);
  const recordControl = useRef<HTMLButtonElement>(null);
  const stopControl = useRef<HTMLButtonElement>(null);
  const reviewControl = useRef<HTMLVideoElement>(null);
  const { onActivityChange } = props;
  const active = recording || count !== null;
  const reviewing = !!blobUrl && !stream;
  const clock = `${Math.floor(elapsed / 60)}:${String(Math.floor(elapsed % 60)).padStart(2, "0")}`;
  useEffect(() => { onActivityChange(active); }, [active, onActivityChange]);
  useEffect(() => {
    if (document.activeElement !== document.body) return;
    const next = reviewing ? reviewControl.current : active ? stopControl.current : countdownControl.current;
    next?.focus({ preventScroll: true });
  }, [active, recording, reviewing, stream]);

  return (
    <fieldset className="editor-fields" disabled={props.disabled}>
      <legend className="sr-only">สตูดิโออัดวิดีโอ</legend>
      <div className="grid2 recording-workspace">
        <div className="panel camera-panel">
          <header className="camera-heading">
            <h2><Icon name={reviewing ? "play" : "camera"} /> {reviewing ? "ตรวจคลิปก่อนส่ง" : "กล้องและไมโครโฟน"}</h2>
            {reviewing && blob && <span className="tag">{(blob.size / 1e6).toFixed(1)} MB</span>}
          </header>
          <div className="preview-wrap" data-reviewing={reviewing || undefined}>
            <video ref={preview} className="video" playsInline aria-label="ภาพจากกล้อง"
              onLoadedMetadata={(e) => {
                const v = e.currentTarget;
                if (v.videoWidth && v.videoHeight) setAspect(v.videoWidth / v.videoHeight);
              }} />
            {reviewing && <video ref={reviewControl} className="video review-video" controls playsInline src={blobUrl} aria-label="คลิปที่อัดไว้" />}
            {!stream && !reviewing && <div className="preview-placeholder"><Icon name="camera" /><span>เปิดกล้องเพื่อดูภาพก่อนอัด</span></div>}
            {recording && <div className="recording-readout">
              <span className="recording-label" role="status"><i /> กำลังอัด</span>
              <time className="recording-clock" dateTime={`PT${Math.floor(elapsed)}S`} aria-label={`เวลาที่อัด ${clock}`}>{clock}</time>
            </div>}
            {stream && !recording && guide && <FramingGuide aspect={aspect} />}
            {count !== null && <div className="countdown">{count}</div>}
          </div>
          {!mime && <Message kind="error">เบราว์เซอร์นี้อัดวิดีโอไม่ได้ ใช้โหมดอัปโหลดไฟล์แทนได้</Message>}
          {err && <Message kind="error">{err} {!reviewing && "ลองตรวจสิทธิ์ของเบราว์เซอร์ หรือใช้โหมดอัปโหลดไฟล์"}</Message>}
          <div className="camera-actions">
            {!stream && <button disabled={!mime || opening} onClick={openCamera}><Icon name="camera" />
              {opening ? "กำลังเปิดกล้อง…" : reviewing ? "เปิดกล้องเพื่ออัดใหม่" : "เปิดกล้อง"}
            </button>}
            {live && <label className="inline muted">นับถอยหลัง
              <select ref={countdownControl} value={countdownS} onChange={(e) => setCountdownS(Number(e.target.value))}>
                {COUNTDOWN_CHOICES.map((s) => <option key={s} value={s}>{s ? `${s} วินาที` : "ไม่นับ"}</option>)}
              </select>
            </label>}
            {live && <button ref={recordControl} disabled={!ready || !mime} onClick={begin}><Icon name="video" /> เริ่มอัด</button>}
            {count !== null && <button ref={stopControl} className="ghost" onClick={() => {
              stopCountdown();
              requestAnimationFrame(() => recordControl.current?.focus({ preventScroll: true }));
            }}>ยกเลิก (เริ่มใน {count})</button>}
            {recording && <button ref={stopControl} className="danger" onClick={stop} disabled={finishing}>
              <Icon name="stop" /> {finishing ? "กำลังเตรียมคลิป…" : "หยุดอัด"}
            </button>}
          </div>
          {live && !ready && <p className="muted small">ตรวจรายการจัดเฟรมให้ครบเพื่อเริ่มอัด</p>}
          {stream && !active && (
            <label className="check muted">
              <input type="checkbox" checked={guide} onChange={() => setGuide(!guide)} />
              แสดงเส้นช่วยจัดระยะ (ให้ศีรษะถึงเอวอยู่ในเส้นประ)
            </label>
          )}
          {live && <p className="muted small">หลังเริ่มอัด ให้เดินเข้าจุดยืนก่อนพูด ระบบนับเวลานำเสนอตั้งแต่คำแรก</p>}
        </div>
        <div className="panel recording-checks" hidden={active || reviewing}>
          <h2><Icon name="check" /> ตรวจการจัดเฟรมก่อนอัด</h2>
          {CHECKLIST.map((c, i) => {
            const status = c.auto && stream && !recording ? checks[c.auto] : null;
            return (
              <div key={i} className="checklist-item">
                <label className="check">
                  <input type="checkbox" checked={checked[i]} onChange={() => toggle(i)} />
                  {c.text}
                </label>
                {c.auto && (
                  <div className="auto-status">
                    <span className={`dot ${status ? status.state : "wait"}`} />
                    {status ? status.text : "ตรวจอัตโนมัติเมื่อเปิดกล้อง"}
                  </div>
                )}
              </div>
            );
          })}
          <button type="button" className="ghost" disabled={ready} onClick={tickAll}>ติ๊กครบทุกข้อ (ยืนยันพร้อมอัด)</button>
          {!ready && <p className="muted">ติ๊กครบทุกข้อจึงเริ่มอัดได้ — ข้อที่มีจุดสีระบบตรวจและติ๊กให้เองเมื่อผ่าน</p>}
        </div>
      </div>
    </fieldset>
  );
}
