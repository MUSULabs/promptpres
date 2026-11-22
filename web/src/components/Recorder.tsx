import { useEffect, useState } from "react";
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
  const { onActivityChange } = props;
  const active = recording || count !== null;
  useEffect(() => { onActivityChange(active); }, [active, onActivityChange]);

  return (
    <fieldset className="editor-fields" disabled={props.disabled}>
      <legend className="sr-only">สตูดิโออัดวิดีโอ</legend>
      <div className="grid2">
        <div className="panel">
          <h2><Icon name="camera" /> กล้องและไมโครโฟน</h2>
          {!mime && <Message kind="error">เบราว์เซอร์นี้อัดวิดีโอไม่ได้ (ไม่มี MediaRecorder ที่รองรับ) — ใช้โหมดอัปโหลดไฟล์แทน</Message>}
          {!stream && <button className="fit" disabled={!mime || opening} onClick={openCamera}><Icon name="camera" /> {opening ? "กำลังเปิดกล้อง…" : "เปิดกล้อง"}</button>}
          {err && <Message kind="error">{err} ลองตรวจสิทธิ์ของเบราว์เซอร์ หรือใช้โหมดอัปโหลดไฟล์</Message>}
          <div className="preview-wrap">
            <video ref={preview} className="video" playsInline aria-label="ภาพจากกล้อง"
              onLoadedMetadata={(e) => {
                const v = e.currentTarget;
                if (v.videoWidth && v.videoHeight) setAspect(v.videoWidth / v.videoHeight);
              }} />
            {!stream && <div className="preview-placeholder"><Icon name="camera" /><span>เปิดกล้องเพื่อดูภาพก่อนอัด</span></div>}
            {recording && <span className="recording-label"><i /> กำลังอัด</span>}
            {stream && !recording && guide && <FramingGuide aspect={aspect} />}
            {count !== null && <div className="countdown">{count}</div>}
          </div>
          {stream && !recording && (
            <label className="check muted">
              <input type="checkbox" checked={guide} onChange={() => setGuide(!guide)} />
              แสดงเส้นช่วยจัดระยะ (ให้ศีรษะถึงเอวอยู่ในเส้นประ)
            </label>
          )}
        </div>
        <div className="panel">
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
          {(live || active) && <div className="row">
            {live && (
              <label className="inline muted">นับถอยหลัง
                <select value={countdownS} onChange={(e) => setCountdownS(Number(e.target.value))}>
                  {COUNTDOWN_CHOICES.map((s) => <option key={s} value={s}>{s ? `${s} วินาที` : "ไม่นับ"}</option>)}
                </select>
              </label>
            )}
            {live && <button disabled={!ready || !mime} onClick={begin}>เริ่มอัด</button>}
            {count !== null && <button className="ghost" onClick={stopCountdown}>ยกเลิก (เริ่มใน {count})</button>}
            {recording && <button className="danger" onClick={stop} disabled={finishing}>
              {finishing ? "กำลังเตรียมคลิป…" : `หยุด (${Math.floor(elapsed / 60)}:${String(Math.floor(elapsed % 60)).padStart(2, "0")})`}
            </button>}
          </div>}
          {live && <p className="note">หลังเริ่มอัด ให้เดินเข้าจุดยืนก่อนพูด ระบบนับเวลานำเสนอตั้งแต่คำแรก</p>}
        </div>
      </div>

      {blob && (
        <div className="panel">
          <h2>ตรวจคลิปก่อนส่ง <span className="tag">{(blob.size / 1e6).toFixed(1)} MB</span></h2>
          <p className="muted">อัดใหม่ได้จากปุ่มเปิดกล้อง</p>
          {blobUrl && <video className="video" controls playsInline src={blobUrl} aria-label="คลิปที่อัดไว้" />}
        </div>
      )}
    </fieldset>
  );
}
