import { useEffect, useRef } from "react";
import TopicEditor from "../components/TopicEditor";
import { MAX_TARGET_MIN, useNewSession } from "../useNewSession";
import { ConfirmDialog, Icon, Message, PageHeading, Steps } from "../components/ui";
import { TEMPLATES } from "../templates";
import { PracticeMascot } from "../components/PracticeMascot";
import "./practice.css";

/** Step 1 of a practice: target time, PDF -> draft topics, edit and confirm (or skip C1/C2). */
export default function NewSession() {
  const { minutes, setMinutes, validTarget, session, topics, setTopics, draft, busy, error, problems, template,
    start, readPdf, addManualTopics, applyTemplate, goToVideo } = useNewSession();
  const topicsHeading = useRef<HTMLHeadingElement>(null);
  const skipDialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (session) topicsHeading.current?.focus();
  }, [session]);

  function skip() {
    skipDialog.current?.showModal();
  }

  return (
    <section className="practice-setup">
      <div className="setup-intro">
        <Steps current={1} />
        <PageHeading title="ตั้งค่ารอบซ้อม">
          กำหนดเวลาที่ต้องการใช้ แล้วเตรียมหัวข้อตามลำดับที่จะพูด
        </PageHeading>
        <div className="setup-art" aria-hidden="true">
          <svg viewBox="0 0 330 174" fill="none">
            <rect x="15" y="28" width="220" height="124" rx="12" stroke="currentColor" strokeWidth="2" />
            <path d="M15 54h220M35 78h30m-30 19h54m-54 19h40" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <circle cx="34" cy="41" r="4" fill="var(--brand-yellow)" />
            <path d="M252 48l10-9m-14-1 4-11m11 24 13-3" stroke="var(--brand-yellow)" strokeWidth="3" strokeLinecap="round" />
          </svg>
          <PracticeMascot pose="guiding" />
        </div>
      </div>
      <form className="panel setup-panel" noValidate onSubmit={(event) => {
        event.preventDefault();
        if (!session) void start();
      }}>
        <label className="target-field">
          <strong>เวลาเป้าหมายในการนำเสนอ<span className="sr-only"> (นาที)</span></strong>
          <span className="target-number">
            <input type="number" min={1} max={MAX_TARGET_MIN} step={0.5} value={minutes || ""}
              aria-invalid={!validTarget} aria-describedby="target-help" disabled={busy !== null}
              onChange={(event) => setMinutes(Number(event.target.value))} />
            <span aria-hidden="true">นาที</span>
          </span>
        </label>
        <p id="target-help" className={validTarget ? "muted small" : "error small"}>
          {validTarget ? `ตั้งได้ 1–${MAX_TARGET_MIN} นาที` : `กรุณาตั้งเวลาเป้าหมาย 1–${MAX_TARGET_MIN} นาที`}
        </p>

        {!session && error && <Message kind="error">{error}</Message>}
        {!session && <button type="submit" className="fit setup-next" disabled={busy !== null || !validTarget}>
          {busy === "start" ? "กำลังสร้างรอบ…" : "ไปตั้งหัวข้อ"} <Icon name="arrow" />
        </button>}
        <details className="disclosure template-picker">
          <summary>
            <span>เลือกแม่แบบ <span className="muted small">(ไม่บังคับ)</span></span>
            <Icon name="chevronDown" />
          </summary>
          <div className="templates" role="group" aria-label="เลือกแม่แบบโครงสร้างการนำเสนอ">
            <p className="muted">แม่แบบตั้งเวลาและร่างหัวข้อให้แก้ต่อได้</p>
            <div className="template-options">
              {TEMPLATES.map((t) => <button key={t.id} type="button" className="segment template-option"
                aria-pressed={template?.id === t.id} disabled={busy !== null} onClick={() => applyTemplate(t.id)}>
                <strong>{t.label}</strong>
                <span className="muted small">{t.minutes} นาที · {t.topics.length} หัวข้อ</span>
              </button>)}
            </div>
            {template?.note && <p className="muted small">{template.note}</p>}
          </div>
        </details>
        {template && <p className="muted small">แม่แบบที่เลือก <strong>{template.label}</strong></p>}
      </form>

      {session && (
        <section className="panel topics-panel" aria-labelledby="topics-heading">
          <h2 ref={topicsHeading} id="topics-heading" tabIndex={-1}><Icon name="document" /> หัวข้อที่จะนำเสนอ</h2>
          <p className="muted">หัวข้อที่ยืนยันจะใช้วิเคราะห์เกณฑ์เนื้อหา C1–C2</p>
          {session.pdf_enabled && <label className="file-field file-picker">
            <span className="button secondary"><Icon name="document" /> เลือก PDF รายงานหรือสไลด์โครงงาน</span>
            <span className="muted small" id="pdf-help">ระบบเสนอรายการหัวข้อให้แก้ไขก่อนยืนยัน</span>
            <input className="sr-only" type="file" accept="application/pdf" aria-label="เลือก PDF รายงานหรือสไลด์โครงงาน"
              aria-describedby="pdf-help" disabled={busy !== null}
              onChange={(e) => {
                const file = e.currentTarget.files?.[0];
                e.currentTarget.value = "";
                if (file) void readPdf(file);
              }} />
          </label>}
          {draft && <div className="selected-file"><Icon name="document" /><strong>{draft.pdfName}</strong></div>}
          {busy === "pdf" && <Message>กำลังสกัดหัวข้อจาก PDF…</Message>}
          {error && <Message kind="error">{error}</Message>}
          {!topics && (
            <div className="row">
              <button className={session.pdf_enabled ? "ghost" : undefined} disabled={busy !== null} onClick={addManualTopics}>
                เพิ่มหัวข้อเอง
              </button>
              <button className="quiet" disabled={busy !== null || !validTarget} onClick={skip}>ข้ามหัวข้อ</button>
            </div>
          )}
          {topics && (
            <>
              <p className="muted">
                {draft ? "ร่างจาก PDF โดยแบบจำลองภาษา — ตรวจและแก้ให้ตรงกับที่จะพูดจริง"
                  : template ? `ร่างจากแม่แบบ “${template.label}” — แก้ให้ตรงกับที่จะพูดจริง` : "พิมพ์หัวข้อตามลำดับที่ตั้งใจจะพูด"}
                {" "}เรียงลำดับด้วยปุ่ม ↑ ↓ (ลำดับนี้ใช้ตรวจเกณฑ์ C1)
              </p>
              {draft?.note && <Message>{draft.note}</Message>}
              <fieldset disabled={busy !== null} className="editor-fields">
                <legend className="sr-only">แก้ไขหัวข้อที่จะนำเสนอ</legend>
                <TopicEditor topics={topics} limits={session.topic_limits} onChange={setTopics} />
              </fieldset>
              {problems.length > 0 && <p className="error">{problems.join(" · ")}</p>}
              <div className="row">
                <button disabled={busy !== null || !validTarget || problems.length > 0} onClick={() => goToVideo(topics)}>
                  {busy === "confirm" ? "กำลังบันทึก…" : "ยืนยันหัวข้อ แล้วไปขั้นวิดีโอ"}
                  <Icon name="arrow" />
                </button>
                <button className="quiet" disabled={busy !== null || !validTarget} onClick={skip}>ข้ามหัวข้อ</button>
              </div>
            </>
          )}
        </section>
      )}
      <ConfirmDialog dialogRef={skipDialog} title="ข้ามการยืนยันหัวข้อหรือไม่?"
        description="ถ้าข้าม ระบบจะแสดงวิเคราะห์ไม่ได้ในเกณฑ์เนื้อหา C1 และ C2"
        confirmLabel="ข้ามและไปขั้นวิดีโอ" onConfirm={() => void goToVideo(null)} />
    </section>
  );
}
